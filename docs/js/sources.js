/* 点播源与订阅：校验、增删改、测活、健康退避与订阅同步。 */

import * as db from './db.js';
import { fetchSubscription, testSourceUrl } from './remote-api.js';

export const SOURCE_LIMIT = 50;
export const SUBSCRIPTION_LIMIT = 20;
export const MAX_SEARCH_SOURCES = 8;
export const FAILURE_THRESHOLD = 2;
export const COOLDOWN_MS = 10 * 60 * 1000;

export class SourceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SourceError';
    this.code = code || 'SOURCE_ERROR';
  }
}

let sourceCache = [];
let subscriptionCache = [];
let sourcesLoaded = false;
let subscriptionsLoaded = false;

export function hashedId(prefix, value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return prefix + hash.toString(36);
}

export function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return '网络源';
  }
}

function cleanName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return name || fallback;
}

function freshHealth() {
  return { failures: 0, cooldownUntil: 0, lastOkAt: 0 };
}

function sanitizeHealth(value) {
  if (!value || typeof value !== 'object') return freshHealth();
  return {
    failures: Math.max(0, Math.min(99, Number(value.failures) || 0)),
    cooldownUntil: Math.max(0, Number(value.cooldownUntil) || 0),
    lastOkAt: Math.max(0, Number(value.lastOkAt) || 0)
  };
}

function sanitizeSource(row) {
  if (!row || typeof row !== 'object' || row.authorized !== true) return null;
  const url = normalizeSourceUrl(row.url);
  if (!url) return null;

  const now = Date.now();
  const id = typeof row.id === 'string' && /^s_[a-zA-Z0-9_-]{1,80}$/.test(row.id)
    ? row.id
    : hashedId('s_', url);

  return {
    id,
    name: cleanName(row.name, hostOf(url)),
    url,
    detail: String(row.detail || '').slice(0, 120),
    enabled: row.enabled !== false,
    selected: row.selected !== false,
    authorized: true,
    authorizedAt: Number(row.authorizedAt) || now,
    origin: typeof row.origin === 'string' && row.origin ? row.origin.slice(0, 80) : 'manual',
    createdAt: Number(row.createdAt) || now,
    updatedAt: Number(row.updatedAt) || now,
    lastTest: row.lastTest && typeof row.lastTest === 'object'
      ? {
          ok: Boolean(row.lastTest.ok),
          ms: Math.max(0, Number(row.lastTest.ms) || 0),
          count: Math.max(0, Number(row.lastTest.count) || 0),
          at: Math.max(0, Number(row.lastTest.at) || 0),
          error: String(row.lastTest.error || '').slice(0, 120)
        }
      : null,
    health: sanitizeHealth(row.health)
  };
}

function sanitizeSubscription(row) {
  if (!row || typeof row !== 'object') return null;
  const url = normalizeSourceUrl(row.url);
  if (!url) return null;

  const now = Date.now();
  const id = typeof row.id === 'string' && /^sub_[a-zA-Z0-9_-]{1,80}$/.test(row.id)
    ? row.id
    : hashedId('sub_', url);

  return {
    id,
    name: cleanName(row.name, hostOf(url)),
    url,
    enabled: row.enabled !== false,
    lastSyncAt: Math.max(0, Number(row.lastSyncAt) || 0),
    lastSyncStatus: ['ok', 'error', 'unknown'].includes(row.lastSyncStatus) ? row.lastSyncStatus : 'unknown',
    lastError: String(row.lastError || '').slice(0, 160),
    sourceCount: Math.max(0, Number(row.sourceCount) || 0),
    createdAt: Number(row.createdAt) || now
  };
}

function dedupeById(list) {
  const byId = new Map();
  list.forEach((row) => {
    if (!row) return;
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      return;
    }
    if ((row.updatedAt || 0) > (existing.updatedAt || 0)) byId.set(row.id, row);
  });
  return Array.from(byId.values());
}

function dedupeByUrl(list) {
  const seen = new Set();
  return list.filter((row) => {
    if (!row || seen.has(row.url)) return false;
    seen.add(row.url);
    return true;
  });
}

export async function loadSources(options = {}) {
  if (sourcesLoaded && !options.force) return sourceCache.slice();

  const rows = await db.getAll('sources').catch(() => []);
  const cleaned = dedupeByUrl(dedupeById(rows.map(sanitizeSource)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, SOURCE_LIMIT);

  sourceCache = cleaned;
  sourcesLoaded = true;
  return sourceCache.slice();
}

export function cachedSources() {
  return sourceCache.slice();
}

export function getSource(id) {
  return sourceCache.find((source) => source.id === id) || null;
}

export function sourceCount() {
  return sourceCache.length;
}

function assertAuthorized(authorized) {
  if (authorized !== true) {
    throw new SourceError(
      '请先勾选授权确认：你已获得该源的使用授权，仅用于个人合法观看。',
      'AUTH_REQUIRED'
    );
  }
}

function validateNewUrl(rawUrl) {
  const url = normalizeSourceUrl(rawUrl);
  if (!url) {
    throw new SourceError('只支持 http / https 的 Apple CMS 接口地址', 'URL_INVALID');
  }
  return url;
}

export async function addSource(input = {}) {
  assertAuthorized(input.authorized);
  const url = validateNewUrl(input.url);
  await loadSources();

  if (sourceCache.some((source) => source.url === url)) {
    throw new SourceError('这个源已经添加过了', 'DUPLICATE');
  }
  if (sourceCache.length >= SOURCE_LIMIT) {
    throw new SourceError('最多只能添加 ' + SOURCE_LIMIT + ' 个源', 'LIMIT');
  }

  const now = Date.now();
  const row = {
    id: hashedId('s_', url),
    name: cleanName(input.name, hostOf(url)),
    url,
    detail: String(input.detail || '').slice(0, 120),
    enabled: true,
    selected: true,
    authorized: true,
    authorizedAt: now,
    origin: 'manual',
    createdAt: now,
    updatedAt: now,
    lastTest: null,
    health: freshHealth()
  };

  await db.put('sources', row);
  sourceCache = [row, ...sourceCache].slice(0, SOURCE_LIMIT);
  return row;
}

export async function updateSource(id, patch = {}) {
  await loadSources();
  const current = getSource(id);
  if (!current) throw new SourceError('这个源不存在或已被删除', 'NOT_FOUND');

  const next = { ...current, updatedAt: Date.now() };

  if (typeof patch.name === 'string') next.name = cleanName(patch.name, hostOf(current.url));
  if (typeof patch.detail === 'string') next.detail = patch.detail.slice(0, 120);
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.selected === 'boolean') next.selected = patch.selected;

  if (typeof patch.url === 'string') {
    const url = validateNewUrl(patch.url);
    if (url !== current.url) {
      assertAuthorized(patch.authorized);
      if (sourceCache.some((source) => source.id !== id && source.url === url)) {
        throw new SourceError('这个源已经添加过了', 'DUPLICATE');
      }
      next.url = url;
      next.authorizedAt = Date.now();
      next.lastTest = null;
      next.health = freshHealth();
    }
  }

  await db.put('sources', next);
  sourceCache = sourceCache.map((source) => (source.id === id ? next : source));
  return next;
}

export async function removeSource(id) {
  await loadSources();
  if (!getSource(id)) return false;
  await db.remove('sources', id);
  sourceCache = sourceCache.filter((source) => source.id !== id);
  return true;
}

export async function setSourceEnabled(id, enabled) {
  return updateSource(id, { enabled: Boolean(enabled) });
}

export async function setSourceSelected(id, selected) {
  return updateSource(id, { selected: Boolean(selected) });
}

export async function recordTestResult(id, result) {
  await loadSources();
  const current = getSource(id);
  if (!current) return null;

  const now = Date.now();
  const ok = Boolean(result && result.ok);
  const next = {
    ...current,
    updatedAt: now,
    lastTest: {
      ok,
      ms: Math.max(0, Number(result && result.ms) || 0),
      count: Math.max(0, Number(result && result.count) || 0),
      at: now,
      error: ok ? '' : String((result && result.error) || '测试失败').slice(0, 120)
    },
    health: ok
      ? { failures: 0, cooldownUntil: 0, lastOkAt: now }
      : { ...sanitizeHealth(current.health), failures: 0, cooldownUntil: 0 }
  };

  await db.put('sources', next);
  sourceCache = sourceCache.map((source) => (source.id === id ? next : source));
  return next;
}

export async function testSource(id, options = {}) {
  await loadSources();
  const source = getSource(id);
  if (!source) throw new SourceError('这个源不存在或已被删除', 'NOT_FOUND');

  let result;
  try {
    result = await testSourceUrl(source.url, options);
  } catch (error) {
    result = { ok: false, error: error.message || '测试失败' };
  }

  return recordTestResult(id, result);
}

/*
 * 搜索成功后清零；连续两次失败进入 10 分钟冷却，避免反复等待超时。
 */
export async function recordSearchOutcome(id, ok) {
  await loadSources();
  const current = getSource(id);
  if (!current) return null;

  const now = Date.now();
  const health = sanitizeHealth(current.health);

  if (ok) {
    health.failures = 0;
    health.cooldownUntil = 0;
    health.lastOkAt = now;
  } else {
    health.failures += 1;
    if (health.failures >= FAILURE_THRESHOLD) {
      health.cooldownUntil = now + COOLDOWN_MS;
      health.failures = 0;
    }
  }

  const next = { ...current, health };
  await db.put('sources', next);
  sourceCache = sourceCache.map((source) => (source.id === id ? next : source));
  return next;
}

export function searchableSources() {
  const now = Date.now();
  const enabled = sourceCache.filter(
    (source) => source.enabled && source.selected && source.authorized
  );
  const ready = enabled.filter((source) => (source.health.cooldownUntil || 0) <= now);
  const cooling = enabled.filter((source) => (source.health.cooldownUntil || 0) > now);

  return {
    ready: ready.slice(0, MAX_SEARCH_SOURCES),
    cooling,
    overflow: Math.max(0, ready.length - MAX_SEARCH_SOURCES),
    total: enabled.length
  };
}

/* ---------- 订阅 ---------- */

export async function loadSubscriptions(options = {}) {
  if (subscriptionsLoaded && !options.force) return subscriptionCache.slice();

  const rows = await db.getAll('subscriptions').catch(() => []);
  subscriptionCache = dedupeByUrl(dedupeById(rows.map(sanitizeSubscription)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, SUBSCRIPTION_LIMIT);

  subscriptionsLoaded = true;
  return subscriptionCache.slice();
}

export async function reloadAll() {
  sourcesLoaded = false;
  subscriptionsLoaded = false;
  await Promise.all([loadSources({ force: true }), loadSubscriptions({ force: true })]);
}

export function cachedSubscriptions() {
  return subscriptionCache.slice();
}

export function getSubscription(id) {
  return subscriptionCache.find((sub) => sub.id === id) || null;
}

export async function addSubscription(input = {}) {
  assertAuthorized(input.authorized);
  const url = validateNewUrl(input.url);
  await loadSubscriptions();

  if (subscriptionCache.some((sub) => sub.url === url)) {
    throw new SourceError('这个订阅已经添加过了', 'DUPLICATE');
  }
  if (subscriptionCache.length >= SUBSCRIPTION_LIMIT) {
    throw new SourceError('最多只能添加 ' + SUBSCRIPTION_LIMIT + ' 个订阅', 'LIMIT');
  }

  const now = Date.now();
  const row = {
    id: hashedId('sub_', url),
    name: cleanName(input.name, hostOf(url)),
    url,
    enabled: true,
    lastSyncAt: 0,
    lastSyncStatus: 'unknown',
    lastError: '',
    sourceCount: 0,
    createdAt: now
  };

  await db.put('subscriptions', row);
  subscriptionCache = [row, ...subscriptionCache].slice(0, SUBSCRIPTION_LIMIT);
  return row;
}

export async function removeSubscription(id, options = {}) {
  await loadSubscriptions();
  const sub = getSubscription(id);
  if (!sub) return false;

  await db.remove('subscriptions', id);
  subscriptionCache = subscriptionCache.filter((row) => row.id !== id);

  if (options.removeSources !== false) {
    await loadSources();
    const origin = 'sub:' + id;
    const removed = sourceCache.filter((source) => source.origin === origin);
    await Promise.all(removed.map((source) => db.remove('sources', source.id)));
    sourceCache = sourceCache.filter((source) => source.origin !== origin);
  }

  return true;
}

function subscriptionOrigin(id) {
  return 'sub:' + id;
}

/*
 * 用订阅内容整体替换该订阅导入的源；手动源优先，同名 URL 不覆盖。
 * 同步失败只记录状态，旧源保持可用。
 */
export async function syncSubscription(id) {
  await Promise.all([loadSources(), loadSubscriptions()]);
  const sub = getSubscription(id);
  if (!sub) throw new SourceError('这个订阅不存在', 'NOT_FOUND');

  const origin = subscriptionOrigin(id);

  try {
    const data = await fetchSubscription(sub.url);
    const incoming = (Array.isArray(data && data.sources) ? data.sources : [])
      .map((entry) => ({
        name: cleanName(entry && entry.name, ''),
        url: normalizeSourceUrl(entry && entry.url),
        detail: String((entry && entry.detail) || '').slice(0, 120)
      }))
      .filter((entry) => entry.url);

    const manualUrls = new Set(
      sourceCache.filter((source) => source.origin !== origin).map((source) => source.url)
    );
    const previous = new Map(
      sourceCache.filter((source) => source.origin === origin).map((source) => [source.url, source])
    );

    const now = Date.now();
    const nextSources = [];
    const seen = new Set();

    for (const entry of incoming) {
      if (seen.has(entry.url) || manualUrls.has(entry.url)) continue;
      seen.add(entry.url);

      const prior = previous.get(entry.url);
      nextSources.push({
        id: prior ? prior.id : hashedId('s_', entry.url),
        name: entry.name || (prior && prior.name) || hostOf(entry.url),
        url: entry.url,
        detail: entry.detail,
        enabled: prior ? prior.enabled !== false : true,
        selected: prior ? prior.selected !== false : true,
        authorized: true,
        authorizedAt: (prior && prior.authorizedAt) || now,
        origin,
        createdAt: (prior && prior.createdAt) || now,
        updatedAt: now,
        lastTest: (prior && prior.lastTest) || null,
        health: prior ? sanitizeHealth(prior.health) : freshHealth()
      });
    }

    const others = sourceCache.filter((source) => source.origin !== origin);
    const room = Math.max(0, SOURCE_LIMIT - others.length);
    const kept = nextSources.slice(0, room);
    const droppedForLimit = nextSources.length - kept.length;

    const stale = sourceCache.filter(
      (source) => source.origin === origin && !seen.has(source.url)
    );

    await Promise.all([
      ...kept.map((source) => db.put('sources', source)),
      ...stale.map((source) => db.remove('sources', source.id))
    ]);

    sourceCache = others.concat(kept).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const updated = {
      ...sub,
      lastSyncAt: now,
      lastSyncStatus: 'ok',
      lastError: '',
      sourceCount: kept.length
    };
    await db.put('subscriptions', updated);
    subscriptionCache = subscriptionCache.map((row) => (row.id === id ? updated : row));

    return {
      ok: true,
      subscription: updated,
      added: kept.filter((source) => !previous.has(source.url)).length,
      removed: stale.length,
      total: kept.length,
      skipped: Math.max(0, Number(data && data.skipped) || 0),
      truncated: Math.max(0, Number(data && data.truncated) || 0),
      droppedForLimit,
      warnings: Array.isArray(data && data.warnings) ? data.warnings.slice(0, 10) : []
    };
  } catch (error) {
    const updated = {
      ...sub,
      lastSyncStatus: 'error',
      lastError: String(error.message || '同步失败').slice(0, 160)
    };
    await db.put('subscriptions', updated);
    subscriptionCache = subscriptionCache.map((row) => (row.id === id ? updated : row));
    throw error instanceof SourceError
      ? error
      : new SourceError(updated.lastError, 'SYNC_FAILED');
  }
}

export async function syncEnabledSubscriptions() {
  await loadSubscriptions();
  const targets = subscriptionCache.filter((sub) => sub.enabled);
  const results = [];

  for (const sub of targets) {
    try {
      results.push(await syncSubscription(sub.id));
    } catch (error) {
      results.push({ ok: false, subscription: getSubscription(sub.id), error: error.message });
    }
  }

  return results;
}

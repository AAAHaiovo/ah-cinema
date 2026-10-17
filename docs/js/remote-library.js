/* 远程搜索结果分组、详情缓存与“在线”条目的恢复。 */

import * as db from './db.js';
import * as catalog from './catalog.js';
import { fetchDetail, RemoteError } from './remote-api.js';

export const REMOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REMOTE_STALE_MS = 6 * 60 * 60 * 1000;
export const REMOTE_EXPIRY_MARGIN_MS = 2 * 60 * 60 * 1000;
export const REMOTE_MAX_ITEMS = 50;

let records = new Map();
let loaded = false;

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_:：·—–.,，。!！?？'"“”‘’（）()\[\]【】《》〈〉「」『』<>\/\\|+&~@#$%^*=]+/g, '');
}

export function yearOf(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? Math.floor(year) : null;
}

function toGroupKey(title, year) {
  return normalizeTitle(title) + '|' + (year ? String(year) : '');
}

/*
 * 按“规范化标题 + 年份”分组；同一标题若只有一组带年份，
 * 把缺年份的条目并入该组，避免不同源字段缺失导致一条影片拆成两行。
 */
export function groupSearchResults(results, sourceRows) {
  const sourceMap = new Map(
    (Array.isArray(sourceRows) ? sourceRows : []).map((source) => [source.id, source])
  );

  const groups = new Map();

  (Array.isArray(results) ? results : []).forEach((entry) => {
    if (!entry || !entry.name || !entry.vodId || !entry.sourceId) return;
    const source = sourceMap.get(entry.sourceId);
    if (!source || !source.url) return;

    const year = yearOf(entry.year);
    const title = String(entry.name).trim().slice(0, 120);
    const titleKey = normalizeTitle(title);
    if (!titleKey) return;

    const key = toGroupKey(title, year);
    let group = groups.get(key);

    if (!group) {
      group = {
        key,
        titleKey,
        title,
        year,
        pic: '',
        typeName: '',
        area: '',
        remarks: '',
        sources: []
      };
      groups.set(key, group);
    }

    if (!group.pic && /^https:\/\//i.test(String(entry.pic || ''))) group.pic = entry.pic;
    if (!group.typeName && entry.typeName) group.typeName = String(entry.typeName).slice(0, 40);
    if (!group.area && entry.area) group.area = String(entry.area).slice(0, 40);
    if (!group.remarks && entry.remarks) group.remarks = String(entry.remarks).slice(0, 60);

    if (group.sources.some((ref) => ref.sourceId === entry.sourceId && ref.vodId === String(entry.vodId))) {
      return;
    }

    group.sources.push({
      sourceId: entry.sourceId,
      sourceName: source.name || entry.sourceName || '',
      url: source.url,
      vodId: String(entry.vodId),
      name: title,
      remarks: String(entry.remarks || '').slice(0, 60),
      year
    });
  });

  // 合并同一标题下“无年份”的组。
  const byTitle = new Map();
  groups.forEach((group) => {
    const list = byTitle.get(group.titleKey) || [];
    list.push(group);
    byTitle.set(group.titleKey, list);
  });

  const merged = [];
  byTitle.forEach((list) => {
    if (list.length === 1) {
      merged.push(list[0]);
      return;
    }

    const withYear = list.filter((group) => group.year);
    const withoutYear = list.filter((group) => !group.year);

    if (withYear.length === 1 && withoutYear.length) {
      const target = withYear[0];
      withoutYear.forEach((group) => {
        group.sources.forEach((ref) => {
          if (!target.sources.some((existing) => existing.sourceId === ref.sourceId && existing.vodId === ref.vodId)) {
            target.sources.push(ref);
          }
        });
        if (!target.pic && group.pic) target.pic = group.pic;
        if (!target.remarks && group.remarks) target.remarks = group.remarks;
        if (!target.typeName && group.typeName) target.typeName = group.typeName;
        if (!target.area && group.area) target.area = group.area;
      });
      merged.push(target);
    } else {
      merged.push(...list);
    }
  });

  merged.forEach((group) => {
    group.count = group.sources.length;
    group.sourceIds = Array.from(new Set(group.sources.map((ref) => ref.sourceId)));
  });

  merged.sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    if (Boolean(b.pic) !== Boolean(a.pic)) return b.pic ? 1 : -1;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });

  return merged;
}

function proxyExpirySeconds(item) {
  const list = [];
  (item.sources || []).forEach((source) => list.push(source));
  (item.episodes || []).forEach((episode) => {
    (episode.sources || []).forEach((source) => list.push(source));
  });

  let earliest = 0;
  list.forEach((source) => {
    const src = String((source && source.src) || '');
    if (!src.includes('/api/proxy?')) return;
    try {
      const url = new URL(src, location.origin);
      const exp = Number(url.searchParams.get('exp'));
      if (Number.isFinite(exp) && exp > 0) {
        earliest = earliest ? Math.min(earliest, exp) : exp;
      }
    } catch (error) {
      /* 忽略无法解析的地址。 */
    }
  });

  return earliest;
}

export function isRemoteItem(item) {
  return Boolean(item && item.remote === true);
}

export function isStale(record, now = Date.now()) {
  if (!record || !record.item) return true;
  if (now - (record.fetchedAt || 0) > REMOTE_STALE_MS) return true;

  const expiry = proxyExpirySeconds(record.item);
  if (expiry && expiry * 1000 - now < REMOTE_EXPIRY_MARGIN_MS) return true;
  return false;
}

function sanitizeRecord(row) {
  if (!row || typeof row !== 'object' || !row.item) return null;

  const item = catalog.normalizeItem({
    ...row.item,
    remote: true,
    remoteSource: row.item.remoteSource || row.source || null
  });
  if (!item || !item.id || !item.title) return null;

  const fetchedAt = Number(row.fetchedAt) || 0;
  if (!fetchedAt || Date.now() - fetchedAt > REMOTE_TTL_MS) return null;

  return {
    id: item.id,
    item,
    source: row.source && typeof row.source === 'object'
      ? {
          id: String(row.source.id || item.remoteSource && item.remoteSource.id || ''),
          name: String(row.source.name || ''),
          url: String(row.source.url || '')
        }
      : null,
    vodId: String(row.vodId || item.remoteVodId || ''),
    fetchedAt,
    expiresAt: Math.min(Number(row.expiresAt) || 0, fetchedAt + REMOTE_TTL_MS) || fetchedAt + REMOTE_TTL_MS
  };
}

function syncCatalog() {
  catalog.setRemoteItems(Array.from(records.values()).map((record) => record.item));
}

export async function loadRemoteLibrary(options = {}) {
  if (loaded && !options.force) return Array.from(records.values());

  const rows = await db.getAll('remote').catch(() => []);
  const next = new Map();
  const expired = [];

  rows.forEach((row) => {
    const record = sanitizeRecord(row);
    if (!record) {
      if (row && row.id) expired.push(row.id);
      return;
    }
    if (record.expiresAt <= Date.now()) {
      expired.push(record.id);
      return;
    }
    next.set(record.id, record);
  });

  const sorted = Array.from(next.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, REMOTE_MAX_ITEMS);

  const overflow = Array.from(next.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(REMOTE_MAX_ITEMS);

  records = new Map(sorted.map((record) => [record.id, record]));
  loaded = true;
  syncCatalog();

  const pruneIds = expired.concat(overflow.map((record) => record.id));
  if (pruneIds.length) {
    await Promise.all(pruneIds.map((id) => db.remove('remote', id).catch(() => {})));
  }

  return Array.from(records.values());
}

export async function saveRemoteItem(payload = {}) {
  const item = catalog.normalizeItem({
    ...(payload.item || {}),
    remote: true,
    remoteSource: payload.source
      ? { id: payload.source.id, name: payload.source.name, url: payload.source.url }
      : (payload.item && payload.item.remoteSource) || null,
    remoteVodId: payload.vodId || (payload.item && payload.item.remoteVodId) || ''
  });

  if (!item || !item.id || !item.title) {
    throw new RemoteError('详情数据不完整，无法保存', { code: 'BAD_ITEM' });
  }

  const fetchedAt = Date.now();
  const record = {
    id: item.id,
    item,
    source: payload.source || (item.remoteSource || null),
    vodId: String(payload.vodId || item.remoteVodId || ''),
    fetchedAt,
    expiresAt: fetchedAt + REMOTE_TTL_MS
  };

  records.set(record.id, record);
  loaded = true;
  syncCatalog();

  const ordered = Array.from(records.values()).sort((a, b) => b.fetchedAt - a.fetchedAt);
  const overflow = ordered.slice(REMOTE_MAX_ITEMS);
  overflow.forEach((entry) => records.delete(entry.id));

  await db.put('remote', record).catch(() => {});
  if (overflow.length) {
    await Promise.all(overflow.map((entry) => db.remove('remote', entry.id).catch(() => {})));
  }

  return item;
}

export function getRemoteRecord(id) {
  return records.get(id) || null;
}

export function remoteRecordCount() {
  return records.size;
}

export async function removeRemoteRecord(id) {
  records.delete(id);
  catalog.removeRemoteItem(id);
  await db.remove('remote', id).catch(() => {});
}

/*
 * 搜索结果 -> 详情：拉取该源详情，写入缓存并返回可路由的 item。
 */
export async function fetchRemoteGroup(group, sourceRef, options = {}) {
  if (!group || !Array.isArray(group.sources) || !group.sources.length) {
    throw new RemoteError('没有可用的来源', { code: 'NO_SOURCE' });
  }

  const ref = sourceRef || group.sources[0];
  if (!ref || !ref.url) {
    throw new RemoteError('缺少源地址，无法获取详情', { code: 'NO_SOURCE_URL' });
  }

  const data = await fetchDetail(
    { id: ref.sourceId, name: ref.sourceName, url: ref.url },
    ref.vodId,
    options
  );

  if (!data || data.ok !== true || !data.item) {
    throw new RemoteError('这个源没有返回详情', { code: 'EMPTY_DETAIL' });
  }

  const item = await saveRemoteItem({
    item: data.item,
    source: { id: ref.sourceId, name: ref.sourceName, url: ref.url },
    vodId: ref.vodId
  });

  return item;
}

export async function refreshRemoteItem(id, options = {}) {
  const record = getRemoteRecord(id);
  if (!record || !record.source || !record.source.url) {
    throw new RemoteError('缓存里找不到这个在线片源', { code: 'NOT_FOUND' });
  }

  const data = await fetchDetail(record.source, record.vodId, options);
  if (!data || data.ok !== true || !data.item) {
    throw new RemoteError('这个源没有返回详情', { code: 'EMPTY_DETAIL' });
  }

  return saveRemoteItem({
    item: data.item,
    source: record.source,
    vodId: record.vodId
  });
}

/* 后台刷新过期缓存，不阻塞页面。 */
export function refreshIfStale(record) {
  if (!record || !isStale(record)) return Promise.resolve(record ? record.item : null);
  return refreshRemoteItem(record.id).catch(() => null);
}

export function searchSummary(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const sourceIds = new Set();
  list.forEach((group) => group.sourceIds.forEach((id) => sourceIds.add(id)));
  return { groups: list.length, sources: sourceIds.size };
}

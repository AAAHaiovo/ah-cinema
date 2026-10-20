/* 应用状态：设置、观看进度、收藏、搜索记录。 */

import * as db from './db.js';

export const DEFAULT_SETTINGS = {
  theme: 'auto',
  pageSize: 24,
  defaultRate: 1,
  autoplayNext: true,
  apiBase: '',
  remoteSearch: true,
  hlsProxySegments: false
};

export const ALLOWED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const ALLOWED_PAGE_SIZES = [12, 24, 48];

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  progress: new Map(),
  favorites: new Map(),
  searches: [],
  ui: {
    searchQuery: ''
  }
};

export function progressKey(itemId, episodeId) {
  return String(itemId) + '|' + (episodeId ? String(episodeId) : '');
}

function sanitizeSettings(input) {
  const next = { ...DEFAULT_SETTINGS, ...(input || {}) };

  if (!['auto', 'light', 'dark'].includes(next.theme)) next.theme = 'auto';
  if (!ALLOWED_PAGE_SIZES.includes(Number(next.pageSize))) next.pageSize = 24;
  else next.pageSize = Number(next.pageSize);

  if (!ALLOWED_RATES.includes(Number(next.defaultRate))) next.defaultRate = 1;
  else next.defaultRate = Number(next.defaultRate);

  next.autoplayNext = Boolean(next.autoplayNext);
  next.remoteSearch = next.remoteSearch !== false;
  next.hlsProxySegments = Boolean(next.hlsProxySegments);
  next.apiBase = sanitizeApiBase(next.apiBase);
  return next;
}

/* 服务地址只保留 http(s) origin + 可选路径；去掉尾斜杠与末尾 /api。 */
function sanitizeApiBase(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    url.hash = '';
    url.search = '';
    let base = url.origin + url.pathname.replace(/\/+$/, '');
    if (/\/api$/i.test(base)) base = base.slice(0, -4);
    return base.slice(0, 300);
  } catch (error) {
    return '';
  }
}

function validProgress(record) {
  return Boolean(
    record &&
      typeof record.id === 'string' &&
      typeof record.itemId === 'string' &&
      Number.isFinite(record.time) &&
      record.time >= 0
  );
}

function validFavorite(record) {
  return Boolean(record && typeof record.id === 'string' && record.id);
}

function validSearch(record) {
  return Boolean(record && typeof record.id === 'string' && record.id.trim());
}

export async function loadState() {
  const [progressRows, favoriteRows, settingsRows, searchRows] = await Promise.all([
    db.getAll('progress'),
    db.getAll('favorites'),
    db.getAll('settings'),
    db.getAll('searches')
  ]);

  state.progress = new Map(progressRows.filter(validProgress).map((record) => [record.id, record]));
  state.favorites = new Map(favoriteRows.filter(validFavorite).map((record) => [record.id, record]));

  const savedSettings = settingsRows.find((record) => record && record.id === 'app');
  state.settings = sanitizeSettings(savedSettings);

  state.searches = searchRows
    .filter(validSearch)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 10);

  try {
    localStorage.setItem('ah-theme', state.settings.theme);
  } catch (error) {
    /* 忽略私密模式限制。 */
  }

  return state;
}

export async function saveSettings(patch) {
  state.settings = sanitizeSettings({ ...state.settings, ...(patch || {}) });

  try {
    localStorage.setItem('ah-theme', state.settings.theme);
  } catch (error) {
    /* 忽略。 */
  }

  await db.put('settings', { id: 'app', ...state.settings });
  return state.settings;
}

export function getProgress(itemId, episodeId) {
  return state.progress.get(progressKey(itemId, episodeId)) || null;
}

export function latestProgressForItem(itemId) {
  let latest = null;
  state.progress.forEach((record) => {
    if (record.itemId !== itemId) return;
    if (!latest || (record.updatedAt || 0) > (latest.updatedAt || 0)) {
      latest = record;
    }
  });
  return latest;
}

export function latestProgressList() {
  const byItem = new Map();

  state.progress.forEach((record) => {
    if (!record || !record.itemId) return;
    const current = byItem.get(record.itemId);
    if (!current || (record.updatedAt || 0) > (current.updatedAt || 0)) {
      byItem.set(record.itemId, record);
    }
  });

  return Array.from(byItem.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function historyCount() {
  return latestProgressList().length;
}

export async function saveProgress({ itemId, episodeId = null, time, duration, completed = false }) {
  if (!itemId || !Number.isFinite(time)) return null;
  if (time < 1) return null;

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = safeDuration > 0 ? Math.min(time, safeDuration) : Math.max(0, time);
  const done = Boolean(completed) || (safeDuration > 0 && safeTime >= safeDuration - 1.5);

  const record = {
    id: progressKey(itemId, episodeId),
    itemId,
    episodeId: episodeId || null,
    time: safeTime,
    duration: safeDuration,
    completed: done,
    updatedAt: Date.now()
  };

  state.progress.set(record.id, record);
  await db.put('progress', record);
  return record;
}

/* 外部播放器无法回传进度，只记录“打开过”，避免伪造观看位置。 */
export async function markOpened({ itemId, episodeId = null }) {
  if (!itemId) return null;

  const record = {
    id: progressKey(itemId, episodeId),
    itemId,
    episodeId: episodeId || null,
    time: 0,
    duration: 0,
    completed: false,
    external: true,
    updatedAt: Date.now()
  };

  state.progress.set(record.id, record);
  await db.put('progress', record);
  return record;
}

export async function removeProgress(id) {
  state.progress.delete(id);
  await db.remove('progress', id);
}

export async function clearHistory() {
  state.progress.clear();
  await db.clear('progress');
}

export async function removeProgressForItem(itemId) {
  if (!itemId) return;

  const ids = [];
  state.progress.forEach((record, id) => {
    if (record.itemId === itemId) ids.push(id);
  });

  ids.forEach((id) => state.progress.delete(id));
  await Promise.all(ids.map((id) => db.remove('progress', id)));
}

export function isFavorite(itemId) {
  return state.favorites.has(itemId);
}

export function favoriteCount() {
  return state.favorites.size;
}

export function favoriteIds() {
  return Array.from(state.favorites.values())
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    .map((record) => record.id);
}

export async function toggleFavorite(itemId) {
  if (!itemId) return false;

  if (state.favorites.has(itemId)) {
    state.favorites.delete(itemId);
    await db.remove('favorites', itemId);
    return false;
  }

  const record = { id: itemId, addedAt: Date.now() };
  state.favorites.set(itemId, record);
  await db.put('favorites', record);
  return true;
}

export async function removeFavorite(itemId) {
  if (!itemId || !state.favorites.has(itemId)) return false;
  state.favorites.delete(itemId);
  await db.remove('favorites', itemId);
  return true;
}

export function recentSearches() {
  return state.searches.slice();
}

export async function addSearch(query) {
  const value = String(query || '').trim().slice(0, 80);
  if (!value) return state.searches;

  const next = [
    { id: value, at: Date.now() },
    ...state.searches.filter((record) => record.id !== value)
  ].slice(0, 10);

  const removed = state.searches.filter((record) => !next.some((entry) => entry.id === record.id));
  state.searches = next;

  await Promise.all([
    ...next.map((record) => db.put('searches', record)),
    ...removed.map((record) => db.remove('searches', record.id))
  ]);

  return state.searches;
}

export async function removeSearches(ids) {
  const values = Array.from(new Set(
    (Array.isArray(ids) ? ids : [ids])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  if (!values.length) return state.searches;

  const removed = new Set(values);
  state.searches = state.searches.filter((record) => !removed.has(record.id));
  await Promise.all(values.map((id) => db.remove('searches', id)));
  return state.searches;
}

export async function clearSearches() {
  state.searches = [];
  await db.clear('searches');
}

export async function exportData() {
  const [sourceRows, subscriptionRows] = await Promise.all([
    db.getAll('sources').catch(() => []),
    db.getAll('subscriptions').catch(() => [])
  ]);

  return {
    app: 'AH 影视',
    schema: 2,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings },
    progress: Array.from(state.progress.values()),
    favorites: Array.from(state.favorites.values()),
    searches: state.searches.slice(),
    // 只导出已确认授权的源；不含访问口令，也不含远程详情缓存。
    sources: sourceRows
      .filter((row) => row && row.authorized === true && typeof row.url === 'string')
      .map((row) => ({
        id: row.id,
        name: row.name || '',
        url: row.url,
        detail: row.detail || '',
        enabled: row.enabled !== false,
        selected: row.selected !== false,
        authorized: true,
        authorizedAt: Number(row.authorizedAt) || 0,
        origin: row.origin || 'manual',
        createdAt: Number(row.createdAt) || 0,
        updatedAt: Number(row.updatedAt) || 0
      })),
    subscriptions: subscriptionRows
      .filter((row) => row && typeof row.url === 'string')
      .map((row) => ({
        id: row.id,
        name: row.name || '',
        url: row.url,
        enabled: row.enabled !== false,
        lastSyncAt: Number(row.lastSyncAt) || 0,
        createdAt: Number(row.createdAt) || 0
      }))
  };
}

function sanitizeImportedProgress(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(validProgress)
    .slice(0, 5000)
    .map((row) => ({
      id: row.id,
      itemId: row.itemId,
      episodeId: row.episodeId || null,
      time: Math.max(0, Number(row.time) || 0),
      duration: Math.max(0, Number(row.duration) || 0),
      completed: Boolean(row.completed),
      updatedAt: Number(row.updatedAt) || Date.now()
    }));
}

function sanitizeImportedFavorites(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(validFavorite)
    .slice(0, 5000)
    .map((row) => ({
      id: row.id,
      addedAt: Number(row.addedAt) || Date.now()
    }));
}

function sanitizeImportedSearches(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(validSearch)
    .slice(0, 50)
    .map((row) => ({
      id: String(row.id).slice(0, 80),
      at: Number(row.at) || Date.now()
    }));
}

function hashedId(prefix, value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return prefix + hash.toString(36);
}

function normalizeImportedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    url.hash = '';
    const text = url.toString();
    if (/\/at\/xml\/$/i.test(url.pathname)) return text;
    return text.replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function sanitizeImportedSources(rows) {
  const seen = new Set();
  const list = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== 'object' || row.authorized !== true) return;
    const url = normalizeImportedUrl(row.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (list.length >= 50) return;

    const id = typeof row.id === 'string' && /^s_[a-zA-Z0-9_-]{1,80}$/.test(row.id)
      ? row.id
      : hashedId('s_', url);

    list.push({
      id,
      name: String(row.name || '').slice(0, 60),
      url,
      detail: String(row.detail || '').slice(0, 120),
      enabled: row.enabled !== false,
      selected: row.selected !== false,
      authorized: true,
      authorizedAt: Number(row.authorizedAt) || Date.now(),
      origin: typeof row.origin === 'string' ? row.origin.slice(0, 80) : 'manual',
      createdAt: Number(row.createdAt) || Date.now(),
      updatedAt: Date.now(),
      lastTest: null,
      health: { failures: 0, cooldownUntil: 0, lastOkAt: 0 }
    });
  });

  return list;
}

function sanitizeImportedSubscriptions(rows) {
  const seen = new Set();
  const list = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const url = normalizeImportedUrl(row.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (list.length >= 20) return;

    const id = typeof row.id === 'string' && /^sub_[a-zA-Z0-9_-]{1,80}$/.test(row.id)
      ? row.id
      : hashedId('sub_', url);

    list.push({
      id,
      name: String(row.name || '').slice(0, 60),
      url,
      enabled: row.enabled !== false,
      lastSyncAt: Number(row.lastSyncAt) || 0,
      lastSyncStatus: 'unknown',
      lastError: '',
      sourceCount: 0,
      createdAt: Number(row.createdAt) || Date.now()
    });
  });

  return list;
}

export async function importData(payload) {
  if (!payload || typeof payload !== 'object' || payload.app !== 'AH 影视') {
    throw new Error('这不是 AH 影视的备份文件');
  }

  const progress = sanitizeImportedProgress(payload.progress);
  const favorites = sanitizeImportedFavorites(payload.favorites);
  const searches = sanitizeImportedSearches(payload.searches);
  const hasSources = Array.isArray(payload.sources) || Array.isArray(payload.subscriptions);
  const sources = sanitizeImportedSources(payload.sources);
  const subscriptions = sanitizeImportedSubscriptions(payload.subscriptions);

  const stores = ['progress', 'favorites', 'searches'].concat(hasSources ? ['sources', 'subscriptions'] : []);
  await db.clearMany(stores);
  await db.bulkPut('progress', progress);
  await db.bulkPut('favorites', favorites);
  await db.bulkPut('searches', searches);
  if (hasSources) {
    await db.bulkPut('sources', sources);
    await db.bulkPut('subscriptions', subscriptions);
  }

  if (payload.settings && typeof payload.settings === 'object') {
    await saveSettings(payload.settings);
  }

  await loadState();
  return {
    progress: progress.length,
    favorites: favorites.length,
    searches: searches.length,
    sources: hasSources ? sources.length : 0,
    subscriptions: hasSources ? subscriptions.length : 0
  };
}

export async function storageEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      return await navigator.storage.estimate();
    }
  } catch (error) {
    /* 忽略。 */
  }
  return null;
}

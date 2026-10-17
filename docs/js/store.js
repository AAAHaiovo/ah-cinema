/* 应用状态：设置、观看进度、收藏、搜索记录。 */

import * as db from './db.js';

export const DEFAULT_SETTINGS = {
  theme: 'auto',
  pageSize: 24,
  defaultRate: 1,
  autoplayNext: true
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
  return next;
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

export async function removeProgress(id) {
  state.progress.delete(id);
  await db.remove('progress', id);
}

export async function clearHistory() {
  state.progress.clear();
  await db.clear('progress');
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

export async function clearSearches() {
  state.searches = [];
  await db.clear('searches');
}

export async function exportData() {
  return {
    app: 'AH 影视',
    schema: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings },
    progress: Array.from(state.progress.values()),
    favorites: Array.from(state.favorites.values()),
    searches: state.searches.slice()
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

export async function importData(payload) {
  if (!payload || typeof payload !== 'object' || payload.app !== 'AH 影视') {
    throw new Error('这不是 AH 影视的备份文件');
  }

  const progress = sanitizeImportedProgress(payload.progress);
  const favorites = sanitizeImportedFavorites(payload.favorites);
  const searches = sanitizeImportedSearches(payload.searches);

  await db.clearMany(['progress', 'favorites', 'searches']);
  await db.bulkPut('progress', progress);
  await db.bulkPut('favorites', favorites);
  await db.bulkPut('searches', searches);

  if (payload.settings && typeof payload.settings === 'object') {
    await saveSettings(payload.settings);
  }

  await loadState();
  return { progress: progress.length, favorites: favorites.length, searches: searches.length };
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

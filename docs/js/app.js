/* AH 影视入口：启动、主题、路由渲染、全局交互与 PWA。 */

import { loadCatalog, getItem, getEpisode, setCustomItems } from './catalog.js';
import {
  state,
  loadState,
  saveSettings,
  toggleFavorite,
  removeProgress,
  removeProgressForItem,
  removeFavorite,
  clearHistory,
  clearSearches,
  addSearch,
  exportData,
  importData,
  storageEstimate
} from './store.js';

import {
  loadLocalItems,
  addLocalFile,
  addLocalUrl,
  addLocalEmbed,
  classifyLink,
  removeLocalItem,
  titleFromUrl,
  fileSizeLimit,
  isHlsUrl
} from './local-library.js';

import {
  parseRoute,
  resolveRoute,
  routeKey,
  tabForRoute,
  isTabbedRoute,
  href
} from './router.js';

import {
  toast,
  openPrompt,
  openConfirm,
  openSheet,
  closeOverlay,
  debounce,
  formatBytes,
  icon,
  isStandalone
} from './ui.js';

import {
  renderHome,
  renderSearch,
  renderSearchResults,
  renderHistory,
  renderFavorites,
  renderLocal,
  renderMe,
  renderSettings,
  renderAbout,
  renderDetail,
  renderNotFound,
  renderBootError,
  renderRemoteSection,
  renderHomeBrowse,
  emptyRemoteState
} from './views.js';

import { renderSources } from './sources-view.js';
import {
  setupSourcesPage,
  setSourcesRefreshHandler,
  isSourcesAction,
  isSourcesForm,
  handleSourcesAction,
  handleSourcesSubmit,
  handleSourcesChange
} from './sources-controller.js';
import {
  loadSources,
  loadSubscriptions,
  cachedSources,
  searchableSources,
  recordSearchOutcome
} from './sources.js';
import { isConfigured, searchSources, browseSources, fetchCategories } from './remote-api.js';
import {
  loadRemoteLibrary,
  groupSearchResults,
  fetchRemoteGroup,
  getRemoteRecord,
  isStale,
  refreshIfStale,
  refreshRemoteItem
} from './remote-library.js';

import { playerPage, mountPlayer } from './player.js';

const els = {
  splash: document.getElementById('splash'),
  splashSub: document.getElementById('splash-sub'),
  view: document.getElementById('view'),
  header: document.getElementById('app-header'),
  tabbar: document.getElementById('tabbar'),
  themeToggle: document.getElementById('theme-toggle')
};

const themeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

let booted = false;
let bootFailed = false;
let currentRoute = null;
let currentRouteKey = '';
let currentCleanup = null;
let deferredInstallPrompt = null;
const scrollMemory = new Map();

try {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
} catch (error) {
  /* 忽略。 */
}

/* ---------- 主题 ---------- */

function resolvedTheme() {
  if (state.settings.theme === 'light') return 'light';
  if (state.settings.theme === 'dark') return 'dark';
  return themeQuery && themeQuery.matches ? 'dark' : 'light';
}

function syncThemeChoices() {
  document.querySelectorAll('[data-action="theme-choice"]').forEach((button) => {
    const active = button.getAttribute('data-theme-value') === state.settings.theme;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function applyTheme() {
  const mode = resolvedTheme();
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.colorScheme = mode;

  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#000000' : '#F5F5F7');

  const statusMeta = document.getElementById('meta-status-bar');
  if (statusMeta) statusMeta.setAttribute('content', mode === 'dark' ? 'black' : 'default');

  if (els.themeToggle) {
    els.themeToggle.innerHTML = icon(mode === 'dark' ? 'sun' : 'moon');
    els.themeToggle.setAttribute('aria-label', mode === 'dark' ? '切换到白天模式' : '切换到黑夜模式');
  }

  syncThemeChoices();
}

function updateThemeFromHeader() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  saveSettings({ theme: next }).catch(() => {});
  applyTheme();
  toast(next === 'dark' ? '已切换到黑夜模式' : '已切换到白天模式');
}

/* ---------- 启动 ---------- */

function hideSplash() {
  if (!els.splash) return;
  els.splash.classList.add('is-hidden');
  els.splash.setAttribute('aria-hidden', 'true');
}

function failBoot(error) {
  if (bootFailed) return;
  bootFailed = true;
  booted = false;
  document.documentElement.dataset.booted = '1';

  if (els.splashSub) els.splashSub.textContent = '加载失败，请检查网络后刷新';
  window.setTimeout(hideSplash, 600);

  if (els.header) els.header.hidden = true;
  if (els.tabbar) els.tabbar.hidden = true;
  document.body.classList.add('no-tabbar');

  if (els.view) {
    els.view.innerHTML = renderBootError(error && error.message ? error.message : '请检查网络连接后重试。');
    try {
      els.view.focus({ preventScroll: true });
    } catch (focusError) {
      /* 忽略。 */
    }
  }

  console.error('[AH 影视] 启动失败', error);
}

async function boot() {
  try {
    await Promise.all([loadCatalog(), loadState()]);

    try {
      setCustomItems(await loadLocalItems());
    } catch (error) {
      console.warn('[AH 影视] 我的视频加载失败', error);
      setCustomItems([]);
    }

    await Promise.all([
      loadSources().catch((error) => {
        console.warn('[AH 影视] 源加载失败', error);
      }),
      loadSubscriptions().catch((error) => {
        console.warn('[AH 影视] 订阅加载失败', error);
      }),
      loadRemoteLibrary().catch((error) => {
        console.warn('[AH 影视] 在线内容缓存加载失败', error);
      })
    ]);

    setSourcesRefreshHandler(renderRoute);

    booted = true;
    document.documentElement.dataset.booted = '1';
    applyTheme();
    setupGlobalListeners();
    setupPwa();

    if (!location.hash) {
      try {
        history.replaceState(null, '', '#/');
      } catch (error) {
        /* 忽略。 */
      }
    }

    renderRoute();
    hideSplash();
    document.body.classList.add('is-ready');
  } catch (error) {
    failBoot(error);
  }
}

/* ---------- 路由 ---------- */

function setDocumentTitle(resolved) {
  const base = 'AH 影视';
  const simpleTitles = {
    home: base,
    search: '搜索 · ' + base,
    history: '观看历史 · ' + base,
    favorites: '收藏 · ' + base,
    local: '我的视频 · ' + base,
    me: '我的 · ' + base,
    sources: '源管理 · ' + base,
    settings: '设置 · ' + base,
    about: '关于 · ' + base,
    notfound: '页面不存在 · ' + base
  };

  if (resolved.name === 'detail') {
    const item = getItem(resolved.itemId);
    document.title = item ? item.title + ' · ' + base : '页面不存在 · ' + base;
    return;
  }

  if (resolved.name === 'player') {
    const item = getItem(resolved.itemId);
    document.title = item ? '正在播放 · ' + item.title : '页面不存在 · ' + base;
    return;
  }

  document.title = simpleTitles[resolved.name] || base;
}

function updateActiveTab(tabName) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.getAttribute('data-tab') === tabName;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

function renderRoute() {
  if (!els.view) return;

  closeOverlay();

  const route = parseRoute();
  const resolved = resolveRoute(route);
  const nextKey = routeKey(route);

  if (currentRoute && isTabbedRoute(currentRoute.name) && !document.body.classList.contains('no-tabbar')) {
    scrollMemory.set(currentRouteKey, window.scrollY || 0);
  }

  if (currentCleanup) {
    try {
      currentCleanup();
    } catch (error) {
      console.error('[AH 影视] 播放器清理失败', error);
    }
    currentCleanup = null;
  }

  if (currentRoute && currentRoute.name === 'search' && resolved.name !== 'search') {
    abortRemoteSearch();
    remoteState = remoteBaseState(remoteState.query);
    lastRemoteQuery = '';
  }

  currentRoute = resolved;
  currentRouteKey = nextKey;

  const tabbed = isTabbedRoute(resolved.name);
  const playerItem = resolved.name === 'player' ? getItem(resolved.itemId) : null;

  document.body.classList.toggle('no-tabbar', !tabbed);
  document.body.classList.toggle('player-active', Boolean(playerItem));
  if (els.header) els.header.hidden = !tabbed;
  if (els.tabbar) els.tabbar.hidden = !tabbed;
  updateActiveTab(tabForRoute(resolved.name));

  let html = '';
  let playerSetup = null;

  if (resolved.name === 'home') {
    html = renderHome(route);
  } else if (resolved.name === 'search') {
    html = renderSearch(route);
  } else if (resolved.name === 'history') {
    html = renderHistory();
  } else if (resolved.name === 'favorites') {
    html = renderFavorites(route);
  } else if (resolved.name === 'local') {
    html = renderLocal();
  } else if (resolved.name === 'me') {
    html = renderMe();
  } else if (resolved.name === 'sources') {
    html = renderSources(route);
  } else if (resolved.name === 'settings') {
    html = renderSettings();
  } else if (resolved.name === 'about') {
    html = renderAbout();
  } else if (resolved.name === 'detail') {
    html = renderDetail(resolved.itemId);
  } else if (resolved.name === 'player') {
    const episode = playerItem ? getEpisode(playerItem, resolved.episodeId) : null;
    const badEpisode = Boolean(playerItem && resolved.episodeId && playerItem.episodes.length && !episode);

    if (!playerItem || badEpisode) {
      html = renderNotFound();
    } else {
      html = playerPage(playerItem, episode);
      playerSetup = { item: playerItem, episode };
    }
  } else {
    html = renderNotFound();
  }

  setDocumentTitle(resolved);
  els.view.innerHTML = html;

  if (resolved.name === 'home') {
    ensureBrowse();
  }

  if (resolved.name === 'search') {
    ensureRemoteForRoute(state.ui.searchQuery);
    renderRemote();
  }

  if (resolved.name === 'detail') {
    const detailItem = getItem(resolved.itemId);
    const record = detailItem && detailItem.remote ? getRemoteRecord(detailItem.id) : null;
    if (record && isStale(record)) {
      refreshIfStale(record).then((item) => {
        if (item && currentRoute && currentRoute.name === 'detail' && currentRoute.itemId === item.id) {
          renderRoute();
        }
      }).catch(() => {});
    }
  }

  if (playerSetup) {
    try {
      currentCleanup = mountPlayer(playerSetup.item, playerSetup.episode);
    } catch (error) {
      console.error('[AH 影视] 播放器初始化失败', error);
      toast('播放器初始化失败，请刷新页面后重试');
      currentCleanup = null;
    }
  }

  if (resolved.name === 'settings') updateStorageUsage();
  if (resolved.name === 'me') updateInstallButton();
  if (resolved.name === 'sources') {
    setupSourcesPage().catch((error) => {
      console.warn('[AH 影视] 连接检测失败', error);
    });
  }
  syncThemeChoices();

  const savedScroll = tabbed ? (scrollMemory.get(nextKey) || 0) : 0;
  window.requestAnimationFrame(() => {
    window.scrollTo(0, savedScroll);
    try {
      els.view.focus({ preventScroll: true });
    } catch (error) {
      /* 忽略。 */
    }
  });
}

function onHashChange() {
  if (!booted) return;
  try {
    renderRoute();
  } catch (error) {
    console.error('[AH 影视] 页面渲染失败', error);
    toast('页面加载失败，请刷新后重试');
  }
}

/* ---------- 搜索 ---------- */

function applySearch(query, options = {}) {
  const updateUrl = options.updateUrl !== false;
  const persist = options.persist === true;
  const value = String(query == null ? '' : query);

  state.ui.searchQuery = value;

  const input = document.getElementById('search-input');
  if (input && input.value !== value) input.value = value;

  const results = document.getElementById('search-results');
  if (results) results.innerHTML = renderSearchResults(value);

  const clear = document.querySelector('.search-clear');
  if (clear) clear.hidden = !value;

  if (updateUrl) {
    const target = href('/search', value.trim() ? { q: value } : {});
    if (location.hash !== target) {
      try {
        history.replaceState(null, '', target);
      } catch (error) {
        /* 忽略。 */
      }
    }
    currentRouteKey = routeKey(parseRoute());
  }

  if (persist) {
    const trimmed = value.trim();
    if (trimmed) addSearch(trimmed).catch(() => {});
  }

  if (options.remote) {
    runRemoteSearch(value, { force: true }).catch(() => {});
  } else {
    const trimmed = value.trim();
    if (trimmed !== remoteState.query || remoteAbort) {
      resetRemote(trimmed);
    }
  }
}

/* ---------- 网络搜索 ---------- */

let remoteState = emptyRemoteState('');
let remoteAbort = null;
let remoteRunId = 0;
let lastRemoteQuery = '';

function remoteBaseState(query) {
  const next = emptyRemoteState(query);
  next.configured = isConfigured();
  return next;
}

function renderRemote() {
  const section = document.getElementById('remote-section');
  if (!section) return;
  section.innerHTML = renderRemoteSection(remoteState);
}

function abortRemoteSearch() {
  if (remoteAbort) remoteAbort.abort();
  remoteAbort = null;
  remoteRunId += 1;
}

function resetRemote(query) {
  abortRemoteSearch();
  remoteState = remoteBaseState(query);
  if (!String(query || '').trim()) lastRemoteQuery = '';
  renderRemote();
}

async function runRemoteSearch(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) {
    resetRemote('');
    return;
  }

  if (!options.force && q === lastRemoteQuery) return;

  abortRemoteSearch();
  remoteState = remoteBaseState(q);
  lastRemoteQuery = q;
  renderRemote();

  if (!isConfigured()) {
    remoteState.status = 'unconfigured';
    renderRemote();
    return;
  }

  const now = Date.now();
  const enabled = cachedSources().filter(
    (source) => source.enabled && source.selected && source.authorized
  );
  remoteState.sourceCount = enabled.length;

  const statusMap = new Map();
  enabled.forEach((source) => {
    statusMap.set(source.id, {
      sourceId: source.id,
      sourceName: source.name,
      state: (source.health && source.health.cooldownUntil > now) ? 'cooling' : 'pending',
      count: 0,
      ms: 0,
      error: ''
    });
  });
  remoteState.statuses = Array.from(statusMap.values());

  if (!enabled.length) {
    remoteState.status = 'no-sources';
    renderRemote();
    return;
  }

  const searchable = searchableSources();
  if (!searchable.ready.length) {
    remoteState.status = 'cooling';
    renderRemote();
    return;
  }

  const readyIds = new Set(searchable.ready.map((source) => source.id));
  statusMap.forEach((status) => {
    if (!readyIds.has(status.sourceId) && status.state === 'pending') status.state = 'skipped';
  });

  remoteState.status = 'loading';
  remoteState.statuses = Array.from(statusMap.values());
  renderRemote();

  const runId = ++remoteRunId;
  const controller = new AbortController();
  remoteAbort = controller;
  const results = [];

  try {
    await searchSources({ q, sources: searchable.ready }, {
      signal: controller.signal,
      onEvent(event) {
        if (runId !== remoteRunId || !event) return;

        if (event.type === 'source') {
          const status = statusMap.get(event.sourceId) || {
            sourceId: event.sourceId,
            sourceName: event.sourceName || '源',
            state: 'pending',
            count: 0,
            ms: 0,
            error: ''
          };

          status.state = event.ok ? 'ok' : 'error';
          status.count = Math.max(0, Number(event.count) || 0);
          status.ms = Math.max(0, Number(event.ms) || 0);
          status.error = event.ok ? '' : (event.timedOut ? '超时' : (event.error || '失败'));

          if (!statusMap.has(event.sourceId)) statusMap.set(event.sourceId, status);
          if (event.ok && Array.isArray(event.items)) results.push(...event.items);

          remoteState.statuses = Array.from(statusMap.values());
          remoteState.results = results;
          remoteState.groups = groupSearchResults(results, cachedSources());
          renderRemote();

          recordSearchOutcome(event.sourceId, Boolean(event.ok)).catch(() => {});
          return;
        }

        if (event.type === 'done') {
          remoteState.status = remoteState.groups.length ? 'done' : 'empty';
          renderRemote();
        }
      }
    });

    if (runId !== remoteRunId) return;
    if (remoteState.status === 'loading') {
      remoteState.status = remoteState.groups.length ? 'done' : 'empty';
      renderRemote();
    }
  } catch (error) {
    if (runId !== remoteRunId) return;
    if (error && error.code === 'ABORTED') return;
    remoteState.status = 'error';
    remoteState.error = error && error.message ? error.message : '网络搜索失败';
    renderRemote();
  } finally {
    if (runId === remoteRunId) remoteAbort = null;
  }
}

function ensureRemoteForRoute(query) {
  const q = String(query || '').trim();
  if (!q) {
    resetRemote('');
    return;
  }
  if (q === lastRemoteQuery) return;
  runRemoteSearch(q).catch(() => {});
}

/* ---------- 首页片库 ---------- */

/* 与 server/handlers/browse.js 的 MAX_PAGE 保持一致。 */
const BROWSE_MAX_PAGE = 20;

let browseState = emptyBrowseState();
let browseAbort = null;
let browseRunId = 0;
let browseKey = '';

function emptyBrowseState() {
  return {
    status: 'idle',
    groups: [],
    rawItems: [],
    statuses: [],
    error: '',
    page: 1,
    pagecount: 1,
    loading: false,
    categories: [],
    categoriesLoaded: false,
    category: '',
    fetchingKey: '',
    failedKey: ''
  };
}

/*
 * 把各源的分类合并成一份目录：
 * [{ name: '动作', types: { 源id: 'type_id' }, count: 出现该分类的源数 }]
 */
function buildCategoryList(data) {
  const byName = new Map();

  (data.sources || []).forEach((entry) => {
    if (!entry.ok || !Array.isArray(entry.classes)) return;
    entry.classes.forEach((cls) => {
      if (!cls || !cls.id || !cls.name) return;
      let category = byName.get(cls.name);
      if (!category) {
        category = { name: cls.name, types: {}, count: 0 };
        byName.set(cls.name, category);
      }
      if (!category.types[entry.sourceId]) {
        category.types[entry.sourceId] = String(cls.id);
        category.count += 1;
      }
    });
  });

  return Array.from(byName.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, 16);
}

function browseSourceKey(sources) {
  return sources.map((source) => source.id).sort().join(',');
}

function renderBrowse() {
  const section = document.getElementById('home-browse');
  if (!section) return;
  section.innerHTML = renderHomeBrowse(browseState);
}

function abortBrowse() {
  if (browseAbort) browseAbort.abort();
  browseAbort = null;
  browseRunId += 1;
}

async function loadCategories(runId) {
  const sources = searchableSources().ready;
  if (!sources.length) return [];

  try {
    const data = await fetchCategories({ sources });
    if (runId !== browseRunId) return [];
    return buildCategoryList(data);
  } catch (error) {
    /* 分类失败不阻塞片库；用户仍可看「全部」。 */
    return [];
  }
}

function ensureBrowse() {
  if (!isConfigured()) {
    browseState = emptyBrowseState();
    browseState.status = 'unconfigured';
    renderBrowse();
    return;
  }

  const enabled = cachedSources().filter(
    (source) => source.enabled && source.selected && source.authorized
  );
  if (!enabled.length) {
    browseState = emptyBrowseState();
    browseState.status = 'no-sources';
    renderBrowse();
    return;
  }

  const searchable = searchableSources();
  if (!searchable.ready.length) {
    browseState = emptyBrowseState();
    browseState.status = 'cooling';
    renderBrowse();
    return;
  }

  const key = browseSourceKey(searchable.ready);
  if (
    key === browseKey &&
    browseState.categoriesLoaded &&
    (browseState.groups.length || browseState.status === 'loading')
  ) {
    renderBrowse();
    return;
  }

  browseKey = key;
  abortBrowse();
  const runId = ++browseRunId;
  browseState = emptyBrowseState();
  browseState.status = 'loading';
  renderBrowse();

  loadCategories(runId).then((categories) => {
    if (runId !== browseRunId) return;
    browseState.categories = categories;
    browseState.categoriesLoaded = true;
    loadBrowse(1, '').catch(() => {});
  });
}

async function loadBrowse(page, categoryName) {
  const ready = searchableSources().ready;
  if (!ready.length) {
    browseState.status = 'cooling';
    renderBrowse();
    return;
  }

  const category = String(categoryName || '');
  const categoryEntry = browseState.categories.find((entry) => entry.name === category);
  const sources = category
    ? ready
        .filter((source) => categoryEntry && categoryEntry.types[source.id])
        .map((source) => Object.assign({}, source, { typeId: categoryEntry.types[source.id] }))
    : ready;

  abortBrowse();
  const runId = ++browseRunId;

  const categories = browseState.categories;
  browseState = Object.assign(emptyBrowseState(), {
    categories,
    categoriesLoaded: true,
    category,
    status: 'loading',
    page: Math.max(1, page)
  });
  renderBrowse();

  if (!sources.length) {
    browseState.status = 'empty';
    browseState.page = 1;
    browseState.pagecount = 1;
    renderBrowse();
    return;
  }

  const controller = new AbortController();
  browseAbort = controller;

  try {
    const data = await browseSources({ page, sources }, { signal: controller.signal });
    if (runId !== browseRunId) return;

    const items = [];
    const statuses = [];
    let pagecount = 1;

    data.sources.forEach((entry) => {
      statuses.push({
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        state: entry.ok ? 'ok' : 'error',
        count: Math.max(0, Number(entry.count) || 0),
        ms: Math.max(0, Number(entry.ms) || 0),
        error: entry.ok ? '' : (entry.timedOut ? '超时' : (entry.error || '失败'))
      });
      if (entry.ok && Array.isArray(entry.items)) items.push(...entry.items);
      if (entry.ok) pagecount = Math.max(pagecount, Number(entry.pagecount) || 1);
      recordSearchOutcome(entry.sourceId, Boolean(entry.ok)).catch(() => {});
    });

    browseState.rawItems = items;
    browseState.groups = groupSearchResults(items, cachedSources());
    browseState.statuses = statuses;
    browseState.page = Math.min(BROWSE_MAX_PAGE, Math.max(1, Number(data.page) || page));
    browseState.pagecount = Math.min(BROWSE_MAX_PAGE, pagecount);
    browseState.loading = false;

    if (!browseState.groups.length) {
      const failed = statuses.filter((entry) => entry.state === 'error');
      if (failed.length === statuses.length && failed.length > 0) {
        browseState.status = 'error';
        browseState.error = '所有源都没有返回数据：' + failed[0].error;
      } else {
        browseState.status = 'empty';
      }
    } else {
      browseState.status = 'done';
    }

    renderBrowse();
  } catch (error) {
    if (runId !== browseRunId) return;
    if (error && error.code === 'ABORTED') return;
    browseState.status = 'error';
    browseState.error = error && error.message ? error.message : '片库加载失败';
    browseState.loading = false;
    renderBrowse();
  } finally {
    if (runId === browseRunId) browseAbort = null;
  }
}

function refreshBrowse() {
  browseKey = '';
  abortBrowse();
  browseState = emptyBrowseState();
  ensureBrowse();
}

function browsePrev() {
  if (browseState.status === 'loading' || browseState.page <= 1) return;
  loadBrowse(browseState.page - 1, browseState.category).catch(() => {});
}

function browseNext() {
  if (browseState.status === 'loading' || browseState.page >= browseState.pagecount) return;
  loadBrowse(browseState.page + 1, browseState.category).catch(() => {});
}

function selectBrowseCategory(name) {
  const next = String(name || '');
  if (next === browseState.category && browseState.status !== 'error') return;
  loadBrowse(1, next).catch(() => {});
}

async function openBrowseGroup(key) {
  await openRemoteGroup(key, browseState, renderBrowse);
}

async function openRemoteGroup(key, sourceState = remoteState, render = renderRemote) {
  const group = (sourceState.groups || []).find((entry) => entry.key === key);
  if (!group || !group.sources.length) return;

  let ref = group.sources[0];
  if (group.sources.length > 1) {
    const choice = await openSheet({
      title: '选择来源 · ' + group.title,
      options: group.sources.map((source) => ({
        value: source.sourceId,
        label: (source.sourceName || '源') + (source.remarks ? ' · ' + source.remarks : '')
      }))
    });
    if (choice === null) return;
    ref = group.sources.find((source) => source.sourceId === choice) || ref;
  }

  sourceState.fetchingKey = key;
  sourceState.failedKey = '';
  render();
  toast('正在获取详情…', 5000);

  try {
    const item = await fetchRemoteGroup(group, ref);
    sourceState.fetchingKey = '';
    render();

    if (currentRoute && (currentRoute.name === 'search' || currentRoute.name === 'home')) {
      location.hash = '#/title/' + encodeURIComponent(item.id);
    }
    if (item.episodes && item.episodes.length) toast('已获取 ' + item.episodes.length + ' 集');
  } catch (error) {
    sourceState.fetchingKey = '';
    sourceState.failedKey = key;
    render();
    toast(error && error.message ? error.message : '获取详情失败');
  }
}

const debouncedSearch = debounce(() => {
  const input = document.getElementById('search-input');
  if (!input) return;
  applySearch(input.value, { updateUrl: true, persist: false });
}, 180);

function handleSearchChip(value) {
  const query = String(value || '');
  if (!currentRoute || currentRoute.name !== 'search') {
    location.hash = href('/search', { q: query });
    return;
  }
  applySearch(query, { updateUrl: true, persist: true, remote: true });
}

function rememberSearchResultClick(event) {
  if (!currentRoute || currentRoute.name !== 'search') return;
  const link = event.target.closest('a[href^="#/title/"]');
  if (!link) return;

  const input = document.getElementById('search-input');
  const query = String(input ? input.value : state.ui.searchQuery || '').trim();
  if (query) addSearch(query).catch(() => {});
}

/* ---------- 数据与 PWA ---------- */

async function updateStorageUsage() {
  const element = document.getElementById('storage-usage');
  if (!element) return;

  const estimate = await storageEstimate();
  if (!element.isConnected) return;

  if (estimate && Number.isFinite(estimate.usage)) {
    element.textContent = formatBytes(estimate.usage);
    if (Number.isFinite(estimate.quota) && estimate.quota > 0) {
      element.setAttribute('title', '浏览器可用配额约 ' + formatBytes(estimate.quota));
    }
  } else {
    element.textContent = '未知';
  }
}

function updateInstallButton() {
  const button = document.getElementById('install-button');
  if (!button) return;
  button.hidden = isStandalone() || !deferredInstallPrompt;
}

async function installApp() {
  if (!deferredInstallPrompt) {
    toast('请用浏览器菜单里的“安装应用”或“添加到主屏幕”');
    return;
  }

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;

  try {
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice && choice.outcome === 'accepted') toast('安装请求已提交');
  } catch (error) {
    toast('安装失败，请用浏览器菜单安装');
  }

  updateInstallButton();
}

function setupPwa() {
  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('[AH 影视] Service Worker 注册失败', error);
    });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/* ---------- 导入 / 导出 ---------- */

function downloadJson(data) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = 'AH影视-备份-' + stamp + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function handleExport() {
  try {
    const data = await exportData();
    downloadJson(data);
    toast('备份已导出');
  } catch (error) {
    toast('导出失败，请再试一次');
  }
}

async function handleImportFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  if (file.size > 8 * 1024 * 1024) {
    toast('备份文件太大，无法导入');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    toast('这个文件不是有效的 JSON 备份');
    return;
  }

  if (!payload || payload.app !== 'AH 影视') {
    toast('这不是 AH 影视的备份文件');
    return;
  }

  const confirmed = await openConfirm({
    title: '导入备份？',
    description: '导入会覆盖当前的观看历史、收藏和搜索记录。这个操作不能撤销。',
    confirmText: '导入',
    danger: true
  });

  if (!confirmed) return;

  try {
    const result = await importData(payload);
    applyTheme();
    toast('已导入：' + result.progress + ' 条进度 · ' + result.favorites + ' 条收藏');
    renderRoute();
  } catch (error) {
    toast(error && error.message ? error.message : '导入失败');
  }
}

/* ---------- 我的视频 ---------- */

async function refreshLocalItems() {
  setCustomItems(await loadLocalItems());
}

function localFileInput() {
  return document.getElementById('local-file-input');
}

async function chooseLocalSource() {
  const choice = await openSheet({
    title: '添加视频',
    options: [
      { value: 'url', label: '粘贴视频链接（直链 / B站）' },
      { value: 'file', label: '从设备选择视频文件' }
    ]
  });

  if (choice === 'file') {
    const input = localFileInput();
    if (input) input.click();
  } else if (choice === 'url') {
    await addLocalUrlFlow();
  }
}

function linkTypeError(classified) {
  if (classified.kind === 'empty') return '先粘贴一个链接';
  return '只支持 http:// 或 https:// 开头的视频地址';
}

async function addLocalUrlFlow() {
  const url = await openPrompt({
    title: '粘贴视频链接',
    description: '支持视频文件直链（.mp4 / .webm / .m3u8）和哔哩哔哩视频页链接。网页、会员页面无法解析；App 不会下载或转存。',
    placeholder: 'https://example.com/movie.mp4',
    inputMode: 'url',
    confirmText: '下一步',
    validate: (value) => {
      if (!/^https?:\/\//i.test(value)) return '请输入以 http:// 或 https:// 开头的地址';
      try {
        new URL(value);
      } catch (error) {
        return '这个网址格式不对';
      }
      return '';
    }
  });

  if (url === null) return;

  const classified = classifyLink(url);
  if (classified.kind === 'invalid' || classified.kind === 'empty') {
    toast(linkTypeError(classified));
    return;
  }

  if (classified.kind === 'page') {
    const proceed = await openConfirm({
      title: '这个链接不是视频文件',
      description: '它可能会播放失败。App 不能解析网页或平台会员页面；仍要添加并尝试吗？',
      confirmText: '仍要添加'
    });
    if (!proceed) return;
  }

  const defaultTitle = classified.kind === 'embed'
    ? 'B站视频 ' + classified.bvid
    : titleFromUrl(classified.url);

  const title = await openPrompt({
    title: '给这个视频起个名字',
    value: defaultTitle,
    placeholder: '例如：我的旅行视频',
    inputMode: 'text',
    confirmText: '添加'
  });

  if (title === null) return;

  try {
    const item = classified.kind === 'embed'
      ? await addLocalEmbed({ bvid: classified.bvid, page: classified.page, title })
      : await addLocalUrl({ url: classified.url, title });

    await refreshLocalItems();
    toast(classified.kind === 'embed'
      ? '已添加 B 站链接'
      : isHlsUrl(classified.url)
        ? '已添加（HLS：Safari 原生，Chrome 用 hls.js）'
        : '已添加：' + item.title);
    location.hash = '#/title/' + encodeURIComponent(item.id);
  } catch (error) {
    toast(error && error.message ? error.message : '添加失败');
  }
}

async function handleLocalFileInput(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  const looksVideo = /^video\//i.test(file.type || '') || /\.(mp4|m4v|webm|mov|ogv|ogg|mkv)$/i.test(file.name || '');
  if (!looksVideo) {
    toast('请选择一个视频文件');
    return;
  }

  if (file.size > fileSizeLimit()) {
    toast('文件超过 2 GB，建议先压缩，或改用“添加网址”');
    return;
  }

  const defaultTitle = String(file.name || '本机视频').replace(/\.[^.]+$/, '') || '本机视频';
  const title = await openPrompt({
    title: '添加本机视频',
    description: '文件只保存在这台设备，不会上传。读取封面可能需要几秒。',
    value: defaultTitle,
    inputMode: 'text',
    confirmText: '添加'
  });

  if (title === null) return;

  toast('正在读取视频信息…', 8000);

  try {
    const item = await addLocalFile({ file, title });
    await refreshLocalItems();
    toast('已添加：' + item.title);
    location.hash = '#/title/' + encodeURIComponent(item.id);
  } catch (error) {
    toast(error && error.message ? error.message : '添加失败');
  }
}

async function removeLocalFlow(id) {
  const item = getItem(id);
  if (!item || !item.local) return;

  const confirmed = await openConfirm({
    title: '移除“' + item.title + '”？',
    description: item.localKind === 'file'
      ? '会删除浏览器里保存的副本，原文件不受影响。观看进度和收藏也会一起清理。'
      : '只会删除这条记录，不会影响原始网址。观看进度和收藏也会一起清理。',
    confirmText: '移除',
    danger: true
  });

  if (!confirmed) return;

  try {
    await removeLocalItem(id);
    await removeProgressForItem(id);
    await removeFavorite(id);
    await refreshLocalItems();
  } catch (error) {
    toast('移除失败，请再试一次');
    return;
  }

  toast('已移除');
  renderRoute();
}

/* ---------- 全局事件 ---------- */

async function onDocumentClick(event) {
  const searchChip = event.target.closest('[data-search-query]');
  if (searchChip) {
    event.preventDefault();
    handleSearchChip(searchChip.getAttribute('data-search-query') || '');
    return;
  }

  const actionElement = event.target.closest('[data-action]');

  if (!actionElement) {
    const tab = event.target.closest('.tab');
    if (tab && tab.getAttribute('href') === location.hash) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    rememberSearchResultClick(event);
    return;
  }

  event.preventDefault();
  const action = actionElement.getAttribute('data-action');

  if (isSourcesAction(action)) {
    await handleSourcesAction(actionElement);
    return;
  }

  if (action === 'remote-open') {
    await openRemoteGroup(actionElement.getAttribute('data-group-key') || '');
    return;
  }

  if (action === 'browse-open') {
    await openBrowseGroup(actionElement.getAttribute('data-group-key') || '');
    return;
  }

  if (action === 'browse-refresh') {
    refreshBrowse();
    return;
  }

  if (action === 'browse-prev') {
    browsePrev();
    return;
  }

  if (action === 'browse-next') {
    browseNext();
    return;
  }

  if (action === 'browse-category') {
    selectBrowseCategory(actionElement.getAttribute('data-category') || '');
    return;
  }

  if (action === 'remote-retry') {
    await runRemoteSearch(remoteState.query, { force: true });
    return;
  }

  if (action === 'toggle-theme') {
    updateThemeFromHeader();
  } else if (action === 'theme-choice') {
    const value = actionElement.getAttribute('data-theme-value');
    if (!['auto', 'light', 'dark'].includes(value)) return;
    saveSettings({ theme: value }).catch(() => {});
    applyTheme();
    toast(value === 'auto' ? '已跟随系统主题' : value === 'light' ? '已切换到白天模式' : '已切换到黑夜模式');
  } else if (action === 'page-size') {
    const size = Number(actionElement.getAttribute('data-size'));
    saveSettings({ pageSize: size }).catch(() => {});
    document.querySelectorAll('[data-action="page-size"]').forEach((button) => {
      const active = Number(button.getAttribute('data-size')) === Number(state.settings.pageSize);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    toast('每页显示 ' + state.settings.pageSize + ' 部');
  } else if (action === 'set-rate') {
    /* select 的 change 由 onDocumentChange 处理。 */
  } else if (action === 'toggle-autoplay') {
    const next = !state.settings.autoplayNext;
    saveSettings({ autoplayNext: next }).catch(() => {});
    actionElement.classList.toggle('is-on', next);
    actionElement.setAttribute('aria-checked', String(next));
    toast(next ? '已开启自动连播' : '已关闭自动连播');
  } else if (action === 'export') {
    await handleExport();
  } else if (action === 'import') {
    const input = document.getElementById('import-file');
    if (input) input.click();
  } else if (action === 'add-local') {
    await chooseLocalSource();
  } else if (action === 'local-add-file') {
    const input = localFileInput();
    if (input) input.click();
  } else if (action === 'local-add-url') {
    await addLocalUrlFlow();
  } else if (action === 'remove-local') {
    await removeLocalFlow(actionElement.getAttribute('data-local-id'));
  } else if (action === 'clear-history') {
    const confirmed = await openConfirm({
      title: '清空观看历史？',
      description: '所有影片的播放进度都会被删除，收藏不受影响。',
      confirmText: '清空',
      danger: true
    });
    if (!confirmed) return;
    try {
      await clearHistory();
    } catch (error) {
      toast('清空失败，请再试一次');
      return;
    }
    toast('观看历史已清空');
    renderRoute();
  } else if (action === 'clear-searches') {
    if (currentRoute && currentRoute.name === 'settings') {
      const confirmed = await openConfirm({
        title: '清空搜索记录？',
        description: '最近搜索会被删除，不影响观看历史和收藏。',
        confirmText: '清空',
        danger: true
      });
      if (!confirmed) return;
    }

    try {
      await clearSearches();
    } catch (error) {
      toast('清空失败，请再试一次');
      return;
    }

    toast('搜索记录已清空');

    if (currentRoute && currentRoute.name === 'search') {
      if (!state.ui.searchQuery) {
        const results = document.getElementById('search-results');
        if (results) results.innerHTML = renderSearchResults('');
      }
    } else {
      renderRoute();
    }
  } else if (action === 'refresh-remote') {
    const id = actionElement.getAttribute('data-item-id') || '';
    if (!id) return;
    actionElement.disabled = true;
    toast('正在刷新片源…', 5000);
    try {
      await refreshRemoteItem(id);
      toast('片源已刷新');
      renderRoute();
    } catch (error) {
      actionElement.disabled = false;
      toast(error && error.message ? error.message : '刷新失败，请稍后再试');
    }
  } else if (action === 'remove-progress') {
    const id = actionElement.getAttribute('data-progress-id');
    if (!id) return;
    try {
      await removeProgress(id);
    } catch (error) {
      toast('移除失败，请再试一次');
      return;
    }
    toast('已移除这条记录');
    renderRoute();
  } else if (action === 'toggle-synopsis') {
    const synopsis = document.getElementById('synopsis');
    if (!synopsis) return;
    const clamped = synopsis.classList.toggle('is-clamped');
    actionElement.textContent = clamped ? '展开' : '收起';
    actionElement.setAttribute('aria-expanded', String(!clamped));
  } else if (action === 'favorite') {
    const itemId = actionElement.getAttribute('data-item-id');
    if (!itemId) return;

    let nowFavorite;
    try {
      nowFavorite = await toggleFavorite(itemId);
    } catch (error) {
      toast('收藏操作失败，请再试一次');
      return;
    }

    document.querySelectorAll('[data-action="favorite"]').forEach((button) => {
      if (button.getAttribute('data-item-id') !== itemId) return;
      const hasText = Boolean(button.querySelector('span'));
      button.classList.toggle('is-active', nowFavorite);
      button.setAttribute('aria-pressed', String(nowFavorite));
      button.setAttribute('aria-label', nowFavorite ? '取消收藏' : '收藏');
      button.innerHTML = icon(nowFavorite ? 'heartFill' : 'heart') +
        (hasText ? '<span>' + (nowFavorite ? '已收藏' : '收藏') + '</span>' : '');
    });

    toast(nowFavorite ? '已加入收藏' : '已取消收藏');
  } else if (action === 'back') {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  } else if (action === 'jump-page') {
    const totalPages = Math.max(1, Number(actionElement.getAttribute('data-total-pages')) || 1);
    const currentPage = Math.max(1, Number(actionElement.getAttribute('data-current')) || 1);
    const value = await openPrompt({
      title: '跳转到第几页',
      description: '当前第 ' + currentPage + ' 页，共 ' + totalPages + ' 页',
      value: String(currentPage),
      inputMode: 'numeric',
      confirmText: '跳转',
      validate: (input) => {
        const page = Number(input);
        if (!Number.isInteger(page) || page < 1 || page > totalPages) {
          return '请输入 1 到 ' + totalPages + ' 之间的页码';
        }
        return '';
      }
    });

    if (value === null) return;
    const page = Number(value);
    if (page === currentPage) return;

    const base = actionElement.getAttribute('data-base') || '/';
    const params = new URLSearchParams(actionElement.getAttribute('data-query') || '');
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));

    const query = params.toString();
    location.hash = '#' + base + (query ? '?' + query : '');
  } else if (action === 'clear-search') {
    if (currentRoute && currentRoute.name === 'search') {
      applySearch('', { updateUrl: true, persist: false });
    } else {
      location.hash = href('/search');
    }
  } else if (action === 'install') {
    await installApp();
  } else if (action === 'retry-boot') {
    location.reload();
  }

  rememberSearchResultClick(event);
}

async function onDocumentChange(event) {
  const target = event.target;

  if (await handleSourcesChange(target)) return;

  if (target.id === 'setting-rate') {
    const rate = Number(target.value);
    saveSettings({ defaultRate: rate }).catch(() => {});
    toast('默认倍速已设为 ' + String(rate) + '×');
  } else if (target.id === 'import-file') {
    await handleImportFile(target);
  } else if (target.id === 'local-file-input') {
    await handleLocalFileInput(target);
  }
}

function onDocumentInput(event) {
  if (event.target.id !== 'search-input') return;

  state.ui.searchQuery = event.target.value;
  const clear = document.querySelector('.search-clear');
  if (clear) clear.hidden = !event.target.value;
  debouncedSearch();
}

function onDocumentSubmit(event) {
  const formId = event.target.getAttribute ? event.target.getAttribute('id') : event.target.id;
  if (isSourcesForm(formId)) {
    event.preventDefault();
    handleSourcesSubmit(event.target).catch((error) => {
      console.error('[AH 影视] 源表单提交失败', error);
      toast('操作失败，请再试一次');
    });
    return;
  }

  if (formId !== 'search-form') return;
  event.preventDefault();

  const input = document.getElementById('search-input');
  const query = input ? input.value : '';
  applySearch(query, { updateUrl: true, persist: true, remote: true });
  if (input) input.blur();
}

function onResourceError(event) {
  const target = event.target;
  if (target && target.tagName === 'IMG') {
    target.remove();
  }
}

function setupGlobalListeners() {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('input', onDocumentInput);
  document.addEventListener('submit', onDocumentSubmit);
  document.addEventListener('error', onResourceError, true);
  window.addEventListener('hashchange', onHashChange);

  window.addEventListener('offline', () => toast('已离线：已经缓存的界面仍然可以打开'));
  window.addEventListener('online', () => toast('网络已恢复'));

  if (themeQuery) {
    const onSchemeChange = () => {
      if (state.settings.theme === 'auto') applyTheme();
    };

    if (typeof themeQuery.addEventListener === 'function') themeQuery.addEventListener('change', onSchemeChange);
    else if (typeof themeQuery.addListener === 'function') themeQuery.addListener(onSchemeChange);
  }
}

/* ---------- 启动监听 ---------- */

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  toast('已安装 AH 影视');
});

window.addEventListener('error', (event) => {
  if (booted || bootFailed) return;
  if (event.target && event.target !== window && event.target.tagName) return;
  failBoot(event.error || new Error(event.message || '脚本运行错误'));
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

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
  renderBootError
} from './views.js';

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
  applySearch(query, { updateUrl: true, persist: true });
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

/* 首页“粘贴链接”入口：识别 B 站页面与视频直链，添加后直接进入播放器。 */
async function playPastedLink(raw) {
  const value = String(raw || '').trim();
  const classified = classifyLink(value);

  if (classified.kind === 'empty' || classified.kind === 'invalid') {
    toast(linkTypeError(classified));
    return;
  }

  if (classified.kind === 'page') {
    const proceed = await openConfirm({
      title: '这个链接不是视频文件',
      description: 'App 只能直接播放视频文件直链（.mp4 / .webm / .m3u8 等）和哔哩哔哩视频页。网页、网盘或平台会员页面无法解析。仍要尝试播放吗？',
      confirmText: '仍要尝试'
    });
    if (!proceed) return;
  }

  try {
    const item = classified.kind === 'embed'
      ? await addLocalEmbed({ bvid: classified.bvid, page: classified.page })
      : await addLocalUrl({ url: classified.url });

    await refreshLocalItems();

    const input = document.getElementById('link-input');
    if (input) input.value = '';

    if (classified.kind === 'embed') toast('正在打开 B 站官方播放器');
    else if (isHlsUrl(classified.url)) toast('HLS 只有 Safari / iPhone 原生支持');
    else toast('正在打开：' + item.title);

    location.hash = '#/watch/' + encodeURIComponent(item.id);
  } catch (error) {
    toast(error && error.message ? error.message : '无法打开这个链接');
  }
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
        ? '已添加（HLS 仅 Safari / iPhone 原生支持）'
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
  if (event.target.id === 'link-form') {
    event.preventDefault();
    const input = document.getElementById('link-input');
    const value = input ? input.value : '';
    if (input) input.blur();
    playPastedLink(value);
    return;
  }

  if (event.target.id !== 'search-form') return;
  event.preventDefault();

  const input = document.getElementById('search-input');
  const query = input ? input.value : '';
  applySearch(query, { updateUrl: true, persist: true });
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

/* 页面视图：首页 / 片库 / 搜索 / 历史 / 收藏 / 我的 / 设置 / 详情 / 关于。 */

import {
  allItems,
  getItem,
  getMeta,
  categories,
  filterItems,
  searchItems,
  relatedItems,
  paginate,
  getEpisode,
  sourcesFor,
  embedFor,
  categoryLabel
} from './catalog.js';

import {
  state,
  getProgress,
  latestProgressForItem,
  latestProgressList,
  favoriteIds,
  isFavorite,
  favoriteCount,
  historyCount,
  recentSearches,
  ALLOWED_RATES,
  ALLOWED_PAGE_SIZES
} from './store.js';

import {
  escapeHtml,
  icon,
  posterCard,
  posterMedia,
  posterPlaceholder,
  continueCard,
  emptyState,
  pagination,
  formatTime,
  formatDuration,
  formatRuntime,
  formatRelative,
  formatEpisodeLabel,
  itemMeta,
  playLabel,
  watchHref,
  progressPercent,
  safeAssetUrl,
  safeExternalUrl,
  isIOS,
  isStandalone,
  badgeFor
} from './ui.js';

import { href } from './router.js';

const APP_VERSION = '0.2.0';

function pageHeading(title, subtitle, action = '') {
  return '<div class="page-title-row">' +
    '<div><h1 class="page-title">' + escapeHtml(title) + '</h1>' +
    (subtitle ? '<p class="page-sub">' + escapeHtml(subtitle) + '</p>' : '') +
    '</div>' +
    (action || '') +
    '</div>';
}

function gridFor(items, options = {}) {
  return '<div class="poster-grid">' +
    items.map((item) => {
      const progress = options.withProgress === false ? null : latestProgressForItem(item.id);
      return posterCard(item, { ...options, progress });
    }).join('') +
    '</div>';
}

function thumbMedia(item) {
  const src = safeAssetUrl(item.poster);
  return posterPlaceholder(item) + (src ? '<img src="' + escapeHtml(src) + '" alt="" loading="lazy" decoding="async">' : '');
}

function licenseLine(item) {
  const source = item.source || '开放片源';
  const license = item.license || '开放授权';
  const licenseUrl = safeExternalUrl(item.licenseUrl);
  const sourceUrl = safeExternalUrl(item.sourceUrl);

  return '<li><strong>' + escapeHtml(item.title) + '</strong> · ' +
    (sourceUrl ? '<a class="text-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source) + '</a>' : escapeHtml(source)) +
    ' · ' +
    (licenseUrl ? '<a class="text-link" href="' + escapeHtml(licenseUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(license) + '</a>' : escapeHtml(license)) +
    '</li>';
}

export function renderHome(route) {
  const items = allItems();
  const meta = getMeta();
  const page = route.params.get('page');
  const paged = paginate(items, page, state.settings.pageSize);

  if (!items.length) {
    return '<div class="page">' +
      pageHeading('首页', 'AH 影视') +
      emptyState({
        title: '片库还是空的',
        text: '检查一下网络，或者稍后刷新页面。',
        action: '<button class="btn btn-primary" type="button" data-action="retry-boot">重新加载</button>'
      }) +
      '</div>';
  }

  const continueItems = latestProgressList()
    .filter((record) => !record.completed && !record.external)
    .map((record) => {
      const item = getItem(record.itemId);
      if (!item) return null;
      const episode = getEpisode(item, record.episodeId);
      return { item, record, episode };
    })
    .filter(Boolean)
    .slice(0, 8);

  const continueSection = continueItems.length
    ? '<section class="section">' +
        '<div class="section-head"><h2 class="section-title">继续观看</h2><a class="section-link" href="#/history">全部</a></div>' +
        '<div class="continue-row">' +
        continueItems.map(({ item, record, episode }) => continueCard(item, record, episode)).join('') +
        '</div>' +
      '</section>'
    : '';

  const notice = meta.notice || '示例片库只包含公共领域 / 开放授权影片。';

  return '<div class="page home-page">' +
    pageHeading('首页', '合法开放影片 · 共 ' + items.length + ' 部',
      '<a class="icon-btn" href="#/search" aria-label="搜索">' + icon('search') + '</a>') +
    continueSection +
    '<section class="section">' +
      '<div class="section-head"><h2 class="section-title">全部影片</h2><span class="section-note">共 ' + items.length + ' 部</span></div>' +
      gridFor(paged.items) +
      pagination({
        page: paged.page,
        totalPages: paged.totalPages,
        totalItems: paged.totalItems,
        basePath: '/',
        params: {}
      }) +
    '</section>' +
    '<p class="foot-note">' + escapeHtml(notice) + '<br>片库会继续扩充；当前版本优先把播放与浏览体验做稳。</p>' +
    '</div>';
}

export function renderLibrary(route) {
  const all = allItems();
  const cats = categories();
  const requested = route.params.get('category') || 'all';
  const active = cats.some((cat) => cat.key === requested) ? requested : 'all';
  const list = filterItems(active);
  const paged = paginate(list, route.params.get('page'), state.settings.pageSize);
  const activeLabel = cats.find((cat) => cat.key === active)?.label || '全部';

  const chips = '<div class="chip-row" role="tablist" aria-label="片库分类">' +
    cats.map((cat) => {
      const visit = cat.key === 'all' ? href('/library') : href('/library', { category: cat.key });
      const selected = cat.key === active;
      return '<a class="chip' + (selected ? ' is-active' : '') + '" href="' + visit + '" role="tab" aria-selected="' + selected + '">' +
        escapeHtml(cat.label) + '<span class="chip-count">' + cat.count + '</span>' +
        '</a>';
    }).join('') +
    '</div>';

  const empty = emptyState({
    title: '这个分类还没有影片',
    text: '先看看全部片库，或者换一个分类。',
    action: '<a class="btn btn-secondary" href="#/library">查看全部</a>'
  });

  const baseParams = active === 'all' ? {} : { category: active };

  return '<div class="page">' +
    pageHeading('片库', '共 ' + list.length + ' 部 · ' + activeLabel + ' · 第 ' + paged.page + ' / ' + paged.totalPages + ' 页') +
    chips +
    (list.length ? gridFor(paged.items) + pagination({
      page: paged.page,
      totalPages: paged.totalPages,
      totalItems: paged.totalItems,
      basePath: '/library',
      params: baseParams
    }) : empty) +
    '</div>';
}

export function renderSearchResults(query) {
  const value = String(query || '').trim();

  if (!value) {
    const recent = recentSearches();
    const recentSection = recent.length
      ? '<section class="section">' +
          '<div class="section-head"><h2 class="section-title">最近搜索</h2><button class="text-btn" type="button" data-action="clear-searches">清除</button></div>' +
          '<div class="recent-list">' +
          recent.map((record) => '<button class="recent-chip" type="button" data-search-query="' + escapeHtml(record.id) + '">' + escapeHtml(record.id) + '</button>').join('') +
          '</div>' +
        '</section>'
      : '';

    const hints = ['大雄兔', 'Sintel', '花', '动画'];

    return recentSection +
      '<div class="search-hints">' +
      '<strong>试试搜索</strong>' +
      '<div class="recent-list">' +
      hints.map((hint) => '<button class="recent-chip" type="button" data-search-query="' + escapeHtml(hint) + '">' + escapeHtml(hint) + '</button>').join('') +
      '</div>' +
      '</div>';
  }

  const results = searchItems(value);

  if (!results.length) {
    return '<div class="search-summary">没有找到匹配的影片</div>' +
      emptyState({
        title: '没有找到',
        text: '没有匹配“' + value + '”的影片。试试片名、原名或标签。',
        action: '<button class="btn btn-secondary" type="button" data-action="clear-search">清空搜索</button>'
      });
  }

  return '<div class="search-summary">找到 ' + results.length + ' 个结果</div>' + gridFor(results);
}

export function renderSearch(route) {
  const fromRoute = route.params.get('q');
  state.ui.searchQuery = fromRoute === null ? '' : fromRoute;
  const query = state.ui.searchQuery || '';

  return '<div class="page search-page">' +
    pageHeading('搜索', '按片名、原名或标签查找') +
    '<form class="search-box" id="search-form" role="search" autocomplete="off">' +
      icon('search') +
      '<input id="search-input" type="search" name="q" inputmode="search" enterkeyhint="search" placeholder="搜索片名、原名或标签" aria-label="搜索影片" value="' + escapeHtml(query) + '">' +
      '<button class="search-clear" type="button" data-action="clear-search" aria-label="清空搜索"' + (query ? '' : ' hidden') + '>' + icon('close') + '</button>' +
    '</form>' +
    '<div id="search-results">' + renderSearchResults(query) + '</div>' +
    '</div>';
}

export function renderHistory() {
  const records = latestProgressList()
    .map((record) => {
      const item = getItem(record.itemId);
      if (!item) return null;
      return { record, item, episode: getEpisode(item, record.episodeId) };
    })
    .filter(Boolean);

  const clearButton = records.length
    ? '<button class="text-btn danger" type="button" data-action="clear-history">清空</button>'
    : '';

  const list = records.map(({ record, item, episode }) => {
    const percent = progressPercent(record);
    const status = record.external
      ? '在哔哩哔哩播放器打开'
      : record.completed
        ? '已看完' + (record.duration > 0 ? ' · ' + formatTime(record.duration) : '')
        : '看到 ' + formatTime(record.time) + (record.duration > 0 ? ' / ' + formatTime(record.duration) : '');
    const episodeLabel = formatEpisodeLabel(episode);

    return '<div class="history-row">' +
      '<a class="history-link" href="' + watchHref(item, record.episodeId) + '">' +
        '<div class="history-thumb">' +
          thumbMedia(item) +
          '<div class="history-progress"><i style="width:' + percent.toFixed(2) + '%"></i></div>' +
        '</div>' +
        '<div class="history-main">' +
          '<div class="history-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="history-sub">' + escapeHtml((episodeLabel ? episodeLabel + ' · ' : '') + status) + '</div>' +
          '<div class="history-time">' + escapeHtml(formatRelative(record.updatedAt)) + '</div>' +
        '</div>' +
      '</a>' +
      '<button class="icon-btn history-remove" type="button" data-action="remove-progress" data-progress-id="' + escapeHtml(record.id) + '" aria-label="移除这条记录">' + icon('trash') + '</button>' +
      '</div>';
  }).join('');

  return '<div class="page">' +
    pageHeading('历史', records.length ? records.length + ' 部看过' : '播放进度会自动记录在这里', clearButton) +
    (records.length ? '<div class="history-list">' + list + '</div>' : emptyState({
      title: '还没有观看记录',
      text: '打开一部影片，看到一半退出，下次就能从这里接着看。',
      action: '<a class="btn btn-primary" href="#/">去首页看看</a>'
    })) +
    '</div>';
}

export function renderFavorites(route) {
  const items = favoriteIds()
    .map((id) => getItem(id))
    .filter(Boolean);
  const paged = paginate(items, route.params.get('page'), state.settings.pageSize);

  return '<div class="page">' +
    pageHeading('收藏', items.length ? '共 ' + items.length + ' 部' : '把想看的影片留在这里') +
    (items.length
      ? gridFor(paged.items) + pagination({
          page: paged.page,
          totalPages: paged.totalPages,
          totalItems: paged.totalItems,
          basePath: '/favorites',
          params: {}
        })
      : emptyState({
          title: '还没有收藏',
          text: '在影片详情页点一下心形，影片就会出现在这里。',
          action: '<a class="btn btn-primary" href="#/library">去片库逛逛</a>'
        })) +
    '</div>';
}

export function renderMe() {
  const installed = isStandalone();
  const ios = isIOS();
  const installText = installed
    ? '你现在以独立 App 方式运行。'
    : ios
      ? 'iPhone：用 Safari 打开，点底部分享按钮，再选“添加到主屏幕”。'
      : 'Windows：用 Chrome / Edge 打开，点地址栏右侧的安装图标，或浏览器菜单里的“安装 AH 影视”。';

  return '<div class="page">' +
    pageHeading('我的') +
    '<div class="profile-card">' +
      '<img class="profile-icon" src="./icons/icon-192.png" alt="AH 影视图标">' +
      '<div class="profile-main"><div class="profile-name">AH 影视</div><div class="profile-sub">个人合法影视库 · v' + APP_VERSION + '</div></div>' +
      '<a class="icon-btn" href="#/settings" aria-label="设置">' + icon('gear') + '</a>' +
    '</div>' +
    '<div class="stat-grid">' +
      '<a class="stat" href="#/favorites"><b>' + favoriteCount() + '</b><span>收藏</span></a>' +
      '<a class="stat" href="#/history"><b>' + historyCount() + '</b><span>历史</span></a>' +
      '<a class="stat" href="#/library"><b>' + allItems().length + '</b><span>片库</span></a>' +
    '</div>' +
    '<div class="menu-group">' +
      '<a class="menu-row" href="#/favorites">' + icon('heart') + '<span class="menu-label">我的收藏</span><span class="menu-value">' + favoriteCount() + '</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/history">' + icon('clock') + '<span class="menu-label">观看历史</span><span class="menu-value">' + historyCount() + '</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/settings">' + icon('gear') + '<span class="menu-label">设置</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/about">' + icon('info') + '<span class="menu-label">关于 AH 影视</span>' + icon('chevronRight', 'chevron') + '</a>' +
    '</div>' +
    '<div class="tip-card">' +
      '<div class="tip-title">' + (installed ? '已安装到主屏幕' : '安装到主屏幕') + '</div>' +
      '<p>' + escapeHtml(installText) + '</p>' +
      (!installed ? '<button class="btn btn-secondary btn-small" type="button" data-action="install" id="install-button" hidden>立即安装</button>' : '') +
    '</div>' +
    '<p class="legal-note">只播放公共领域、开放授权或你拥有明确使用权的影片。不提供盗版片源，不绕过 DRM。片源与授权信息可以在每部影片的详情页查看。</p>' +
    '</div>';
}

export function renderSettings() {
  const settings = state.settings;
  const themeOptions = [
    { value: 'auto', label: '跟随系统' },
    { value: 'light', label: '白天' },
    { value: 'dark', label: '黑夜' }
  ];

  const themeButtons = themeOptions.map((option) =>
    '<button type="button" data-action="theme-choice" data-theme-value="' + option.value + '" class="' + (settings.theme === option.value ? 'is-active' : '') + '" aria-pressed="' + (settings.theme === option.value) + '">' + option.label + '</button>'
  ).join('');

  const sizeButtons = ALLOWED_PAGE_SIZES.map((size) =>
    '<button type="button" data-action="page-size" data-size="' + size + '" class="' + (Number(settings.pageSize) === size ? 'is-active' : '') + '" aria-pressed="' + (Number(settings.pageSize) === size) + '">' + size + '</button>'
  ).join('');

  const rateOptions = ALLOWED_RATES.map((rate) =>
    '<option value="' + rate + '"' + (Number(settings.defaultRate) === rate ? ' selected' : '') + '>' + String(rate) + '×</option>'
  ).join('');

  return '<div class="page settings-page">' +
    pageHeading('设置', '外观、播放与本地数据') +
    '<div class="settings-caption">外观</div>' +
    '<section class="settings-group">' +
      '<div class="settings-block">' +
        '<div class="settings-label">主题</div>' +
        '<div class="segmented segmented-wide" role="group" aria-label="主题">' + themeButtons + '</div>' +
      '</div>' +
    '</section>' +
    '<div class="settings-caption">浏览</div>' +
    '<section class="settings-group">' +
      '<div class="settings-block">' +
        '<div class="settings-label">每页海报数量</div>' +
        '<div class="segmented segmented-wide" role="group" aria-label="每页海报数量">' + sizeButtons + '</div>' +
      '</div>' +
    '</section>' +
    '<div class="settings-caption">播放</div>' +
    '<section class="settings-group">' +
      '<div class="settings-row">' +
        '<span class="settings-icon">' + icon('speed') + '</span>' +
        '<span class="settings-label">默认倍速</span>' +
        '<select class="select" id="setting-rate" aria-label="默认倍速">' + rateOptions + '</select>' +
      '</div>' +
      '<div class="settings-row">' +
        '<span class="settings-icon">' + icon('list') + '</span>' +
        '<span class="settings-label">自动连播下一集</span>' +
        '<button type="button" class="switch ' + (settings.autoplayNext ? 'is-on' : '') + '" data-action="toggle-autoplay" role="switch" aria-checked="' + Boolean(settings.autoplayNext) + '" aria-label="自动连播下一集"><span></span></button>' +
      '</div>' +
    '</section>' +
    '<div class="settings-caption">数据</div>' +
    '<section class="settings-group">' +
      '<button class="settings-row" type="button" data-action="export">' +
        '<span class="settings-icon">' + icon('download') + '</span><span class="settings-label">导出备份</span><span class="settings-value">JSON</span>' +
      '</button>' +
      '<button class="settings-row" type="button" data-action="import">' +
        '<span class="settings-icon">' + icon('upload') + '</span><span class="settings-label">导入备份</span><span class="settings-value">JSON</span>' +
      '</button>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
      '<div class="settings-row">' +
        '<span class="settings-icon">' + icon('database') + '</span><span class="settings-label">本地数据占用</span><span class="settings-value" id="storage-usage">计算中…</span>' +
      '</div>' +
      '<button class="settings-row danger" type="button" data-action="clear-history">' +
        '<span class="settings-icon">' + icon('trash') + '</span><span class="settings-label">清空观看历史</span><span class="settings-value">' + historyCount() + ' 条</span>' +
      '</button>' +
      '<button class="settings-row danger" type="button" data-action="clear-searches">' +
        '<span class="settings-icon">' + icon('trash') + '</span><span class="settings-label">清空搜索记录</span><span class="settings-value">' + recentSearches().length + ' 条</span>' +
      '</button>' +
    '</section>' +
    '<div class="settings-caption">关于</div>' +
    '<section class="settings-group">' +
      '<a class="settings-row" href="#/about">' +
        '<span class="settings-icon">' + icon('info') + '</span><span class="settings-label">关于 AH 影视</span><span class="settings-value">v' + APP_VERSION + '</span>' + icon('chevronRight', 'chevron') +
      '</a>' +
    '</section>' +
    '<p class="settings-foot">观看进度、收藏与设置保存在这台设备的浏览器里（优先使用 IndexedDB）。换设备或清理浏览器数据前，请先导出备份。</p>' +
    '</div>';
}

export function renderAbout() {
  const meta = getMeta();
  const items = allItems();

  const seen = new Set();
  const licenseRows = [];

  items.forEach((item) => {
    const key = (item.source || '') + '|' + (item.license || '');
    if (seen.has(key)) return;
    seen.add(key);
    licenseRows.push(licenseLine(item));
  });

  return '<div class="page about-page">' +
    '<div class="about-hero">' +
      '<img class="about-icon" src="./icons/icon-192.png" alt="AH 影视图标">' +
      '<h1>AH 影视</h1>' +
      '<p>个人合法影视库 · v' + APP_VERSION + '</p>' +
    '</div>' +
    '<section class="info-card">' +
      '<h2>关于这个 App</h2>' +
      '<p>AH 影视是一个静态 PWA：Windows 浏览器和 iPhone 主屏幕都能打开，不需要后端，不需要登录。浏览、搜索、收藏、观看历史和播放进度都保存在本机。</p>' +
      '<p>' + escapeHtml(meta.notice || '当前片库只包含公共领域 / 开放授权影片。') + '</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>AH 标识</h2>' +
      '<div class="brand-preview"><span class="brand-mark" aria-hidden="true"></span><div class="brand-preview-text">品牌红 #C92F36 配白色 AH；深色界面下保持同一套标记。</div></div>' +
      '<p>App 图标使用品牌红底 + 白色 AH；界面顶栏、启动页和空状态使用同一套标记，播放画面上不加水印。</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>片源与授权</h2>' +
      '<ul class="license-list">' + licenseRows.join('') + '</ul>' +
      '<p>部分公共领域电影通过哔哩哔哩官方嵌入式播放器观看，视频仍托管在哔哩哔哩，本 App 不转存、不下载、不重新分发。</p>' +
      '<p>影片版权归原作者 / 出品方所有。本 App 只做个人观看与播放，不重新分发片源；如需转载或商用，请遵守对应授权条款。</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>边界</h2>' +
      '<p>不接入盗版站、未授权聚合源、破解接口，也不绕过 DRM。主流新片和热剧仍应去官方平台观看；这个 App 负责整理你能合法播放的内容。</p>' +
      '<p>如果某条哔哩哔哩视频被上传者删除或设为不可播放，播放页会无法加载；可以用右上角的“在 B 站打开”查看原页面。</p>' +
    '</section>' +
    '<p class="about-foot">Made for personal use · AH 影视 · 2026</p>' +
    '</div>';
}

function renderEpisodes(item, latest) {
  if (!Array.isArray(item.episodes) || !item.episodes.length) return '';

  const groups = new Map();
  item.episodes.forEach((episode, index) => {
    const season = Number(episode.season) || 1;
    if (!groups.has(season)) groups.set(season, []);
    groups.get(season).push({ episode, index });
  });

  const seasons = Array.from(groups.entries()).sort(([a], [b]) => a - b);

  return '<section class="detail-section">' +
    '<h2>选集 <span class="section-note">共 ' + item.episodes.length + ' 集</span></h2>' +
    seasons.map(([season, list]) => {
      const buttons = list
        .sort((a, b) => (Number(a.episode.episode) || a.index + 1) - (Number(b.episode.episode) || b.index + 1))
        .map(({ episode, index }) => {
          const number = episode.episode || index + 1;
          const record = getProgress(item.id, episode.id);
          const percent = progressPercent(record);
          const current = latest && latest.episodeId === episode.id;
          return '<a class="episode-btn' + (current ? ' is-current' : '') + '" href="' + watchHref(item, episode.id) + '" title="' + escapeHtml(episode.title || ('第 ' + number + ' 集')) + '">' +
            '<span>第 ' + escapeHtml(String(number)) + ' 集</span>' +
            (percent > 0 ? '<span class="ep-progress"><i style="width:' + percent.toFixed(2) + '%"></i></span>' : '') +
            '</a>';
        }).join('');

      return '<div class="season-block">' +
        (seasons.length > 1 || season > 1 ? '<h3 class="season-title">第 ' + season + ' 季</h3>' : '') +
        '<div class="episode-grid">' + buttons + '</div>' +
        '</div>';
    }).join('') +
    '</section>';
}

export function renderDetail(itemId) {
  const item = getItem(itemId);

  if (!item) {
    return renderNotFound();
  }

  const latest = latestProgressForItem(item.id);
  const episode = getEpisode(item, latest?.episodeId);
  const favorite = isFavorite(item.id);
  const meta = itemMeta(item);
  const sources = sourcesFor(item, episode);
  const embed = embedFor(item, episode);
  const poster = safeAssetUrl(item.poster);
  const synopsis = item.synopsis || '暂无简介。';
  const longSynopsis = synopsis.length > 120;

  const playTarget = latest && !latest.completed
    ? watchHref(item, latest.episodeId)
    : (item.episodes.length ? watchHref(item, item.episodes[0].id) : watchHref(item));
  const label = embed
    ? (latest && !latest.completed ? '再次打开（B 站）' : '播放（B 站）')
    : playLabel(item, latest, episode);

  const backdropStyle = poster
    ? ' style="background-image:url(\'' + escapeHtml(poster) + '\')"'
    : '';

  const badge = badgeFor(item);
  const sourceUrl = safeExternalUrl(item.sourceUrl);
  const licenseUrl = safeExternalUrl(item.licenseUrl);

  const episodeSection = renderEpisodes(item, latest);

  const infoRows = [
    ['片源', sourceUrl
      ? '<a class="text-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.source || '原始页面') + '</a>'
      : escapeHtml(item.source || '—')],
    ['授权', licenseUrl
      ? '<a class="text-link" href="' + escapeHtml(licenseUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.license || '开放授权') + '</a>'
      : escapeHtml(item.license || '—')],
    ['清晰度', embed
      ? 'B 站播放器内可选'
      : escapeHtml(sources.map((source) => source.quality || source.label).filter(Boolean).join(' / ') || '原画')],
    ['字幕', embed
      ? '以 B 站播放器为准'
      : (item.subtitles && item.subtitles.length ? escapeHtml(item.subtitles.map((subtitle) => subtitle.label || '字幕').join(' / ')) : '暂无字幕')],
    ...(item.uploader ? [['上传者', escapeHtml(item.uploader)]] : []),
    ...(embed ? [['播放方式', '哔哩哔哩官方嵌入式播放器']] : [])
  ];

  const related = relatedItems(item, 6);
  const relatedSection = related.length
    ? '<section class="detail-section">' +
        '<h2>相关影片</h2>' +
        '<div class="related-grid">' +
        related.map((entry) => posterCard(entry, { progress: latestProgressForItem(entry.id) })).join('') +
        '</div>' +
      '</section>'
    : '';

  return '<div class="detail-page">' +
    '<div class="detail-topbar">' +
      '<button class="icon-btn" type="button" data-action="back" aria-label="返回">' + icon('chevronLeft') + '</button>' +
      '<button class="icon-btn detail-fav' + (favorite ? ' is-active' : '') + '" type="button" data-action="favorite" data-item-id="' + escapeHtml(item.id) + '" aria-pressed="' + favorite + '" aria-label="' + (favorite ? '取消收藏' : '收藏') + '">' + icon(favorite ? 'heartFill' : 'heart') + '</button>' +
    '</div>' +
    '<div class="detail-hero">' +
      '<div class="detail-backdrop"' + backdropStyle + '></div>' +
      '<div class="detail-hero-inner">' +
        '<div class="detail-poster">' + posterMedia(item, { eager: true, badge: false }) + '</div>' +
        '<div class="detail-info">' +
          '<h1 class="detail-title">' + escapeHtml(item.title) + '</h1>' +
          (item.originalTitle && item.originalTitle !== item.title ? '<p class="detail-original">' + escapeHtml(item.originalTitle) + '</p>' : '') +
          (meta.length ? '<div class="detail-meta">' + meta.map((part) => '<span>' + escapeHtml(part) + '</span>').join('') + '</div>' : '') +
          (badge || item.license ? '<span class="detail-badge">' + escapeHtml(badge || item.license) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="detail-body">' +
      '<div class="detail-actions">' +
        '<a class="btn btn-primary detail-play" href="' + playTarget + '">' + icon('play') + '<span>' + escapeHtml(label) + '</span></a>' +
        '<button class="btn btn-secondary detail-fav' + (favorite ? ' is-active' : '') + '" type="button" data-action="favorite" data-item-id="' + escapeHtml(item.id) + '" aria-pressed="' + favorite + '">' + icon(favorite ? 'heartFill' : 'heart') + '<span>' + (favorite ? '已收藏' : '收藏') + '</span></button>' +
      '</div>' +
      (latest && !latest.completed && !latest.external ? '<div class="detail-progress-note">' + icon('clock') + '<span>上次看到 ' + escapeHtml(formatTime(latest.time)) + (episode ? ' · ' + escapeHtml(formatEpisodeLabel(episode)) : '') + '</span></div>' : '') +
      (embed ? '<div class="detail-progress-note detail-embed-note">' + icon('info') + '<span>本片通过哔哩哔哩官方嵌入式播放器播放；清晰度、倍速与字幕请使用播放器内控件。本 App 不转存视频。</span></div>' : '') +
      '<section class="detail-section">' +
        '<h2>简介</h2>' +
        '<p class="synopsis' + (longSynopsis ? ' is-clamped' : '') + '" id="synopsis">' + escapeHtml(synopsis) + '</p>' +
        (longSynopsis ? '<button class="text-btn synopsis-toggle" type="button" data-action="toggle-synopsis" aria-expanded="false">展开</button>' : '') +
      '</section>' +
      episodeSection +
      '<section class="detail-section">' +
        '<h2>片源与授权</h2>' +
        '<dl class="info-list">' +
        infoRows.map(([key, value]) => '<div class="info-row"><dt>' + escapeHtml(key) + '</dt><dd>' + value + '</dd></div>').join('') +
        '</dl>' +
      '</section>' +
      relatedSection +
      '<p class="foot-note">' + escapeHtml(item.title) + ' · ' + escapeHtml(item.license || '开放授权') + '。仅用于个人观看，请遵守原始授权条款。</p>' +
    '</div>' +
    '</div>';
}

export function renderNotFound() {
  return '<div class="page">' +
    pageHeading('页面不存在') +
    emptyState({
      title: '找不到这个页面',
      text: '链接可能已经失效，或者影片不在当前片库里。',
      action: '<a class="btn btn-primary" href="#/">回到首页</a>'
    }) +
    '</div>';
}

export function renderBootError(message) {
  return '<div class="page">' +
    pageHeading('AH 影视') +
    emptyState({
      title: '片库加载失败',
      text: message || '请检查网络连接后重试。',
      action: '<button class="btn btn-primary" type="button" data-action="retry-boot">重新加载</button>'
    }) +
    '</div>';
}

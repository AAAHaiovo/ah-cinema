/* 页面视图：首页 / 片库 / 搜索 / 历史 / 收藏 / 我的 / 设置 / 详情 / 关于。 */

import {
  getItem,
  getMeta,
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
  formatBytes,
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

import { localItems, localCount } from './local-library.js';
import { cachedSources } from './sources.js';

const APP_VERSION = '1.2.0';

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

function browseChip(label, options = {}) {
  const action = options.action || 'browse-sub';
  const attr = options.attr || 'data-sub';
  const value = options.value === undefined || options.value === null ? '' : String(options.value);
  const classes = [options.cell ? 'category-cell' : 'category-chip'];
  if (options.active) classes.push('is-active');

  return '<button class="' + classes.join(' ') + '" type="button" data-action="' + action + '" ' +
    attr + '="' + escapeHtml(value) + '"' + (options.active ? ' aria-pressed="true"' : '') + '>' +
    escapeHtml(label) + '</button>';
}

function browseExpandButton(expanded) {
  return '<button class="browse-expand' + (expanded ? ' is-open' : '') + '" type="button" ' +
    'data-action="browse-expand" aria-expanded="' + (expanded ? 'true' : 'false') + '" ' +
    'aria-controls="browse-category-panel">' +
    '<span>' + (expanded ? '收起' : '展开') + '</span>' +
    icon('chevronDown', 'browse-expand-icon') +
    '</button>';
}

/* iOS「查看全部」式面板：在吸顶分类栏内展开网格，不弹层、不依赖列表滚动。 */
function browseCategoryPanel(group, selectedSub) {
  const cells = [
    browseChip('全部', { value: '', active: !selectedSub, cell: true })
  ].concat(
    group.children.map((child) => browseChip(child.name, {
      value: child.name,
      active: child.name === selectedSub,
      cell: true
    }))
  );

  return '<div class="browse-category-panel" id="browse-category-panel">' +
    '<div class="browse-category-head">' +
      '<span>' + escapeHtml(group.name) + '全部分类</span>' +
      '<span class="browse-category-total">' + group.children.length + ' 个类型</span>' +
    '</div>' +
    '<div class="browse-category-grid">' + cells.join('') + '</div>' +
  '</div>';
}

function browseScrollButton(direction, row) {
  const left = direction < 0;
  return '<button class="browse-scroll" type="button" data-action="browse-scroll" data-dir="' +
    (left ? '-1' : '1') + '" data-row="' + row + '" aria-label="' +
    (left ? '向左查看更多分类' : '向右查看更多分类') + '">' + (left ? '‹' : '›') + '</button>';
}

function browseFilterMeta(view) {
  const loading = view.status === 'loading' || view.loading;
  const total = Math.max(0, Number(view.totalWorks) || 0);
  const page = Math.max(1, Number(view.page) || 1);
  const pagecount = Math.max(1, Number(view.pagecount) || 1);
  const sourceCount = Math.max(0, Number(view.sourceCount) || 0);
  const parts = [];

  if (total > 0) {
    parts.push('<span class="browse-count" title="各源合计，可能重复">约 ' +
      Number(total).toLocaleString('zh-CN') + ' 部</span>');
  }
  if (sourceCount > 0) parts.push('<span>' + sourceCount + ' 个源</span>');
  if (!loading && (pagecount > 1 || total > 0)) {
    parts.push('<span>第 ' + page + ' / ' + pagecount + ' 页</span>');
  }
  if (loading) {
    parts.push('<span class="browse-loading-text"><span class="loading-spinner" aria-hidden="true"></span>加载中</span>');
  }
  if (!parts.length) return '';

  return '<div class="browse-filter-meta">' +
    parts.join('<span class="browse-meta-dot" aria-hidden="true">·</span>') +
    '</div>';
}

function browseFilterBar(view) {
  const tree = view.tree && Array.isArray(view.tree.groups) ? view.tree : { groups: [] };
  const groups = tree.groups;
  const selectedGroup = String(view.topGroup || '');
  const selectedSub = String(view.subCategory || '');
  const meta = browseFilterMeta(view);

  if (!groups.length) {
    return meta ? '<div class="browse-filterbar is-meta-only">' + meta + '</div>' : '';
  }

  const group = groups.find((entry) => entry.key === selectedGroup) || null;
  const topChips = [
    browseChip('全部', { action: 'browse-top', attr: 'data-group', value: '', active: !selectedGroup })
  ].concat(
    groups.map((entry) => browseChip(entry.name, {
      action: 'browse-top',
      attr: 'data-group',
      value: entry.key,
      active: entry.key === selectedGroup
    }))
  );

  let subRow = '';
  let categoryPanel = '';
  if (group && Array.isArray(group.children) && group.children.length) {
    const children = group.children;
    const expanded = Boolean(view.expanded);
    const visible = children.slice(0, 9);
    if (selectedSub && !visible.some((child) => child.name === selectedSub)) {
      const activeChild = children.find((child) => child.name === selectedSub);
      if (activeChild) visible.push(activeChild);
    }

    const subChips = [
      browseChip('全部', { action: 'browse-sub', attr: 'data-sub', value: '', active: !selectedSub })
    ].concat(
      visible.map((child) => browseChip(child.name, {
        action: 'browse-sub',
        attr: 'data-sub',
        value: child.name,
        active: child.name === selectedSub
      }))
    );

    subRow = '<div class="browse-filter-row" data-row="sub">' +
      browseScrollButton(-1, 'sub') +
      '<div class="browse-categories" id="browse-sub-categories" aria-label="' +
        escapeHtml(group.name) + '子分类">' + subChips.join('') + '</div>' +
      browseScrollButton(1, 'sub') +
      (children.length > 9 ? browseExpandButton(expanded) : '') +
      '</div>';

    if (expanded) categoryPanel = browseCategoryPanel(group, selectedSub);
  }

  return '<div class="browse-filterbar">' +
    '<div class="browse-filter-row" data-row="top">' +
      browseScrollButton(-1, 'top') +
      '<div class="browse-categories" id="browse-top-categories" aria-label="影片一级分类">' +
        topChips.join('') + '</div>' +
      browseScrollButton(1, 'top') +
    '</div>' +
    subRow +
    categoryPanel +
    meta +
    '</div>';
}

function browsePager(view) {
  const page = Math.max(1, Number(view.page) || 1);
  const pagecount = Math.max(1, Number(view.pagecount) || 1);
  if (pagecount <= 1) return '';

  const busy = view.status === 'loading' || view.loading;
  return '<div class="browse-pager">' +
    '<button class="btn btn-secondary btn-small" type="button" data-action="browse-prev"' +
      (busy || page <= 1 ? ' disabled' : '') + '>上一页</button>' +
    '<span class="browse-page-status">第 ' + page + ' / ' + pagecount + ' 页</span>' +
    '<button class="btn btn-secondary btn-small" type="button" data-action="browse-next"' +
      (busy || page >= pagecount ? ' disabled' : '') + '>下一页</button>' +
    '<button class="btn btn-secondary btn-small" type="button" data-action="browse-jump" data-current="' +
      page + '" data-total="' + pagecount + '"' + (busy ? ' disabled' : '') + '>跳转</button>' +
    '</div>';
}

function browseEmptyText(view) {
  const group = view.tree && Array.isArray(view.tree.groups)
    ? view.tree.groups.find((entry) => entry.key === view.topGroup)
    : null;
  const label = view.subCategory || (group ? group.name : '');
  if (view.page > 1) return '这一页没有数据，可能已经到该分类末尾。';
  return label ? '「' + escapeHtml(label) + '」分类下暂时没有影片。' : '这些源暂时没有返回影片。';
}

export function renderHomeBrowse(browse) {
  const view = browse || {};
  const groups = Array.isArray(view.groups) ? view.groups : [];
  const status = view.status || 'idle';
  const bar = browseFilterBar(view);

  if (status === 'unconfigured') {
    return '<div class="remote-notice">' +
      '<strong>还没有连接服务</strong>' +
      '<p>GitHub Pages 版需要先填写服务地址和访问口令，首页才能从源里加载影片。</p>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">去源管理配置</a>' +
      '</div>';
  }

  if (status === 'no-sources') {
    return '<div class="remote-notice">' +
      '<strong>还没有可用的源</strong>' +
      '<p>源管理默认是空的。只添加你自己已授权、仅用于个人合法观看的 Apple CMS 接口。</p>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">去添加源</a>' +
      '</div>';
  }

  if (status === 'cooling') {
    return '<div class="remote-notice">' +
      '<strong>所有启用的源都在冷却中</strong>' +
      '<p>连续加载失败后，源会暂停 10 分钟。可以稍后刷新，或到源管理测试源。</p>' +
      '<div class="form-actions"><button class="btn btn-secondary btn-small" type="button" data-action="browse-refresh">重试</button>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">源管理</a></div>' +
      '</div>';
  }

  if (status === 'error') {
    return bar + '<div class="remote-notice remote-error">' +
      '<strong>片库加载失败</strong>' +
      '<p>' + escapeHtml(view.error || '请稍后重试。') + '</p>' +
      '<div class="form-actions"><button class="btn btn-secondary btn-small" type="button" data-action="browse-refresh">重试</button>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">检查源与服务</a></div>' +
      '</div>';
  }

  if (!groups.length) {
    if (status === 'loading' || status === 'idle') {
      return bar + '<div class="remote-loading"><span class="loading-spinner" aria-hidden="true"></span>正在从源里加载影片…</div>';
    }
    return bar + '<div class="remote-empty">' + browseEmptyText(view) + '</div>' + browsePager(view);
  }

  const statuses = Array.isArray(view.statuses) ? view.statuses : [];
  const problems = statuses.filter((statusItem) => statusItem.state === 'error' || statusItem.partial);
  const chips = problems.length
    ? '<div class="remote-status">' + problems.map(remoteStatusChip).join('') + '</div>'
    : '';
  const loading = status === 'loading' || view.loading;
  const loadingLine = loading
    ? '<div class="browse-loading-inline"><span class="loading-spinner" aria-hidden="true"></span>正在加载第 ' +
      Math.max(1, Number(view.page) || 1) + ' 页…</div>'
    : '';
  const total = Math.max(0, Number(view.totalWorks) || 0);
  const countNote = total > 0
    ? '<p class="browse-count-note">约 ' + Number(total).toLocaleString('zh-CN') +
      ' 部，各源合计，可能重复。</p>'
    : '';

  return bar + chips + loadingLine +
    '<div class="remote-grid">' + groups.map((group) => remoteCard(group, view, 'browse-open')).join('') + '</div>' +
    countNote + browsePager(view);
}

export function renderHomeHero(groups) {
  const list = (Array.isArray(groups) ? groups : groups ? [groups] : [])
    .filter(Boolean)
    .slice(0, 3);

  if (!list.length) {
    return '<section class="hero hero--empty">' +
      '<div class="hero-empty-inner">' +
        '<span class="brand-mark" aria-hidden="true"></span>' +
        '<h2>把片源加进来</h2>' +
        '<p>添加你自己已授权的 Apple CMS 源，首页就会变成你的私人放映室。</p>' +
        '<a class="btn btn-primary btn-small" href="#/sources">去源管理</a>' +
      '</div>' +
    '</section>';
  }

  const slides = list.map((group, index) => {
    const poster = /^https:\/\//i.test(group.pic || '') ? group.pic : '';
    const meta = [group.year, group.typeName, group.area].filter(Boolean);
    const remarks = String(group.remarks || '').trim();
    const key = escapeHtml(group.key || '');
    const names = Array.from(new Set((group.sources || [])
      .map((ref) => ref.sourceName)
      .filter(Boolean)))
      .slice(0, 3)
      .join(' · ');

    return '<div class="hero-slide' + (index === 0 ? ' is-on' : '') + (poster ? '' : ' hero-slide--no-image') + '" data-hero-slide="' + index + '">' +
      (poster ? '<img class="hero-img" src="' + escapeHtml(poster) + '" alt="" loading="eager" decoding="async">' : '') +
      '<div class="hero-scrim"></div>' +
      '<div class="hero-body">' +
        '<div class="eyebrow hero-eyebrow">本周精选 · ' + escapeHtml(names || '来自你的源') + '</div>' +
        '<h1 class="hero-title">' + escapeHtml(group.title || '未命名影片') + '</h1>' +
        (meta.length ? '<div class="hero-meta">' + meta.map((part) => '<span>' + escapeHtml(part) + '</span>').join('') + '</div>' : '') +
        (remarks ? '<p class="hero-desc">' + escapeHtml(remarks) + '</p>' : '') +
        '<div class="hero-actions">' +
          '<button class="btn btn-light btn-large" type="button" data-action="browse-open" data-group-key="' + key + '">' + icon('play') + '播放</button>' +
          '<button class="btn btn-glass btn-large" type="button" data-action="browse-open" data-group-key="' + key + '">详情</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const dots = list.length > 1
    ? '<div class="hero-dots">' + list.map((_, index) =>
        '<button class="hero-dot' + (index === 0 ? ' is-on' : '') + '" type="button" data-hero-go="' + index + '" aria-label="第 ' + (index + 1) + ' 部"><i></i></button>'
      ).join('') + '</div>'
    : '';

  return '<section class="hero billboard" id="home-hero-carousel">' + slides + dots + '</section>';
}

export function renderHome(route) {
  const items = localItems();
  const meta = getMeta();
  const mineCount = items.length;

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
        '<div class="section-head"><h2 class="section-title">继续观看' +
          '<span class="section-hint">' + continueItems.length + ' 部未看完</span>' +
        '</h2><a class="section-link" href="#/history">全部' + icon('chevronRight') + '</a></div>' +
        '<div class="continue-row">' +
        continueItems.map(({ item, record, episode }) => continueCard(item, record, episode)).join('') +
        '</div>' +
      '</section>'
    : '';

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const dateLabel = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 周' + week;
  const sub = (continueItems.length ? continueItems.length + ' 部待续 · ' : '') + '来自你添加的源';

  const mineEntry = '<a class="mine-entry" href="#/local">' +
    '<span class="mine-entry-icon">' + icon('film') + '</span>' +
    '<span class="mine-entry-main">' +
      '<span class="mine-entry-title">我的视频</span>' +
      '<span class="mine-entry-sub">本机文件与粘贴的链接' + (mineCount ? ' · ' + mineCount + ' 个' : '') + '</span>' +
    '</span>' +
    icon('chevronRight', 'chevron') +
    '</a>';

  return '<div class="page home-page">' +
    '<div class="home-head">' +
      '<div>' +
        '<div class="eyebrow">' + greeting + ' · ' + dateLabel + '</div>' +
        '<h1 class="page-title">放映室</h1>' +
        '<p class="page-sub">' + escapeHtml(sub) + '</p>' +
      '</div>' +
      '<a class="home-add" href="#/local">' + icon('plus') + '<span>添加视频</span></a>' +
    '</div>' +
    '<div id="home-hero">' + renderHomeHero([]) + '</div>' +
    continueSection +
    '<section class="section">' +
      '<div class="section-head"><h2 class="section-title">最新影片' +
        '<span class="section-hint">来自你添加的源</span>' +
      '</h2><button class="text-btn" type="button" data-action="browse-refresh">刷新</button></div>' +
      '<div id="home-browse" class="home-browse">' + renderHomeBrowse({ status: 'loading', groups: [] }) + '</div>' +
    '</section>' +
    mineEntry +
    '<p class="foot-note">' + escapeHtml(meta.notice || '本 App 只播放你自己提供的内容，不提供、不抓取任何片源。') + '</p>' +
    '</div>';
}

export function renderSearchResults(query) {
  const value = String(query || '').trim();

  if (!value) {
    const recent = recentSearches();
    const recentSection = recent.length
      ? '<section class="section recent-section">' +
          '<div class="section-head">' +
            '<h2 class="section-title">最近搜索</h2>' +
            '<div class="section-actions recent-actions">' +
              '<button class="text-btn" type="button" data-action="search-manage">清除</button>' +
              '<button class="text-btn recent-clear-all" type="button" data-action="clear-all-searches">全部清除</button>' +
            '</div>' +
            '<div class="section-actions recent-manage-actions" hidden>' +
              '<button class="text-btn" type="button" data-action="delete-selected-searches" disabled>删除选中</button>' +
              '<button class="text-btn" type="button" data-action="cancel-search-manage">取消</button>' +
            '</div>' +
          '</div>' +
          '<div class="recent-list">' +
          recent.map((record) =>
            '<button class="recent-chip" type="button" data-search-query="' + escapeHtml(record.id) + '" aria-pressed="false">' +
              '<span class="recent-check" aria-hidden="true">' + icon('check') + '</span>' +
              '<span class="recent-label">' + escapeHtml(record.id) + '</span>' +
            '</button>'
          ).join('') +
          '</div>' +
        '</section>'
      : '';

    const hints = localItems().slice(0, 6).map((item) => item.title);
    if (!hints.length) return recentSection;

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
    return '';
  }

  return '<div class="search-summary">找到 ' + results.length + ' 个结果</div>' +
    gridFor(results);
}

export function emptyRemoteState(query = '') {
  return {
    query: String(query || ''),
    status: 'idle',
    configured: true,
    sourceCount: 0,
    groups: [],
    results: [],
    statuses: [],
    error: '',
    total: 0,
    fetchingKey: '',
    failedKey: ''
  };
}

function remoteStatusChip(status) {
  const name = status.sourceName || '源';
  let text = name;
  let tone = 'idle';

  if (status.state === 'pending') text = name + ' · 搜索中…';
  else if (status.partial) {
    text = name + ' · 部分分类失败';
    tone = 'error';
  } else if (status.state === 'ok') {
    text = name + ' · ' + (status.count || 0) + ' 条';
    tone = 'ok';
  } else if (status.state === 'cooling') text = name + ' · 冷却中';
  else if (status.state === 'skipped') text = name + ' · 未参与';
  else {
    text = name + ' · ' + (status.error || '失败');
    tone = 'error';
  }

  return '<span class="remote-chip is-' + tone + '">' + escapeHtml(text) + '</span>';
}

function remoteCard(group, remote, action = 'remote-open') {
  const busy = remote.fetchingKey === group.key;
  const failed = remote.failedKey === group.key;
  const names = Array.from(new Set(group.sources.map((ref) => ref.sourceName).filter(Boolean)));
  const note = names.slice(0, 3).join(' · ') + (names.length > 3 ? ' 等 ' + names.length + ' 个' : '');
  const meta = [group.year, group.typeName, group.area].filter(Boolean).join(' · ');
  const remarks = String(group.remarks || '').trim();
  const poster = /^https:\/\//i.test(group.pic || '') ? group.pic : '';

  return '<button type="button" class="remote-card' + (busy ? ' is-busy' : '') + '" data-action="' + action + '" data-group-key="' + escapeHtml(group.key) + '"' + (busy ? ' aria-busy="true"' : '') + '>' +
    '<div class="poster-media">' +
      posterPlaceholder({ title: group.title }) +
      (poster ? '<img src="' + escapeHtml(poster) + '" alt="" loading="lazy" decoding="async">' : '') +
    '</div>' +
    '<div class="poster-title">' + escapeHtml(group.title) + '</div>' +
    (meta ? '<div class="poster-meta">' + escapeHtml(meta) + '</div>' : '') +
    (remarks ? '<div class="poster-meta">' + escapeHtml(remarks) + '</div>' : '') +
    (note ? '<div class="remote-card-note">' + escapeHtml(note) + '</div>' : '') +
    (busy ? '<div class="remote-card-note is-loading">正在获取详情…</div>' : '') +
    (failed ? '<div class="remote-card-note is-error">获取失败，点击重试</div>' : '') +
    '</button>';
}

export function renderRemoteSection(remote) {
  const state = remote || emptyRemoteState();
  const query = String(state.query || '').trim();
  if (!query) return '';

  if (state.status === 'unconfigured') {
    return '<div class="remote-notice">' +
      '<strong>多源搜索还没有连接服务</strong>' +
      '<p>GitHub Pages 版需要先填写 Vercel 服务地址和访问口令。浏览器直接请求源站会被跨域限制，所以需要一个代理服务。</p>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">去源管理配置</a>' +
      '</div>';
  }

  if (state.status === 'no-sources') {
    return '<div class="remote-notice">' +
      '<strong>还没有可用的源</strong>' +
      '<p>源管理默认是空的。只添加你自己已授权、仅用于个人合法观看的 Apple CMS 接口。</p>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">去添加源</a>' +
      '</div>';
  }

  if (state.status === 'cooling') {
    return '<div class="remote-notice">' +
      '<strong>所有启用的源都在冷却中</strong>' +
      '<p>连续搜索失败后，源会暂停 10 分钟，避免反复等待超时。可以稍后再试，或到源管理测试源。</p>' +
      '<div class="form-actions"><button class="btn btn-secondary btn-small" type="button" data-action="remote-retry">重试</button>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">源管理</a></div>' +
      '</div>';
  }

  if (state.status === 'idle') {
    return '<div class="remote-notice remote-hint">' +
      '<p>按回车键，或点击最近搜索，同时搜索已启用的网络源（最多 8 个）。</p>' +
      '</div>';
  }

  if (state.status === 'error') {
    return '<div class="remote-notice remote-error">' +
      '<strong>网络搜索失败</strong>' +
      '<p>' + escapeHtml(state.error || '请稍后重试。') + '</p>' +
      '<div class="form-actions"><button class="btn btn-secondary btn-small" type="button" data-action="remote-retry">重试</button>' +
      '<a class="btn btn-secondary btn-small" href="#/sources">检查源与服务</a></div>' +
      '</div>';
  }

  const statuses = Array.isArray(state.statuses) ? state.statuses : [];
  const chips = statuses.length
    ? '<div class="remote-status">' + statuses.map(remoteStatusChip).join('') + '</div>'
    : '';

  if (state.status === 'loading') {
    return chips + '<div class="remote-loading"><span class="loading-spinner" aria-hidden="true"></span>正在搜索网络源…</div>';
  }

  if (!state.groups.length) {
    return chips + '<div class="remote-empty">' + escapeHtml(query) + ' 没有找到网络结果。</div>';
  }

  return chips +
    '<div class="remote-grid">' + state.groups.map((group) => remoteCard(group, state)).join('') + '</div>';
}

export function renderSearch(route) {
  const fromRoute = route.params.get('q');
  state.ui.searchQuery = fromRoute === null ? '' : fromRoute;
  const query = state.ui.searchQuery || '';

  return '<div class="page search-page">' +
    pageHeading('搜索', '本地链接 · 网络源') +
    '<form class="search-box" id="search-form" role="search" autocomplete="off">' +
      icon('search') +
      '<input id="search-input" type="search" name="q" inputmode="search" enterkeyhint="search" placeholder="输入片名，回车搜索网络源" aria-label="搜索" value="' + escapeHtml(query) + '">' +
      '<button class="search-clear" type="button" data-action="clear-search" aria-label="清空搜索"' + (query ? '' : ' hidden') + '>' + icon('close') + '</button>' +
    '</form>' +
    '<div id="search-results">' + renderSearchResults(query) + '</div>' +
    '<div id="remote-section" class="remote-section">' + renderRemoteSection(emptyRemoteState(query)) + '</div>' +
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
      text: '打开一个链接，看到一半退出，下次就能从这里接着看。',
      action: '<a class="btn btn-primary" href="#/">去首页粘贴链接</a>'
    })) +
    '</div>';
}

export function renderFavorites(route) {
  const items = favoriteIds()
    .map((id) => getItem(id))
    .filter(Boolean);
  const paged = paginate(items, route.params.get('page'), state.settings.pageSize);

  return '<div class="page">' +
    pageHeading('收藏', items.length ? '共 ' + items.length + ' 个' : '把想看的视频留在这里') +
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
          text: '在视频详情页点一下心形，视频就会出现在这里。',
          action: '<a class="btn btn-primary" href="#/">去首页看看</a>'
        })) +
    '</div>';
}

export function renderLocal() {
  const items = localItems();

  const rows = items.map((item) => {
    const kind = item.localKind === 'file'
      ? '本机文件' + (item.fileSize > 0 ? ' · ' + formatBytes(item.fileSize) : '')
      : item.localKind === 'embed'
        ? 'B 站官方嵌入' + (item.embed ? ' · ' + item.embed.bvid : '')
        : '网络地址' + (item.host ? ' · ' + item.host : '') + (item.isHls ? ' · HLS' : '');

    return '<div class="history-row local-row">' +
      '<a class="history-link" href="' + watchHref(item) + '">' +
        '<div class="history-thumb">' + thumbMedia(item) + '</div>' +
        '<div class="history-main">' +
          '<div class="history-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="history-sub">' + escapeHtml(kind) + '</div>' +
        '</div>' +
      '</a>' +
      '<button class="icon-btn history-remove" type="button" data-action="remove-local" data-local-id="' + escapeHtml(item.id) + '" aria-label="移除 ' + escapeHtml(item.title) + '">' + icon('trash') + '</button>' +
      '</div>';
  }).join('');

  const empty = emptyState({
    title: '还没有添加内容',
    text: '粘贴一个视频直链或 B 站视频页链接，也可以从设备选择本机视频。内容只保存在这台设备。',
    action: '<div class="local-empty-actions">' +
      '<button class="btn btn-primary" type="button" data-action="local-add-url">粘贴链接</button>' +
      '<button class="btn btn-secondary" type="button" data-action="local-add-file">选择本机视频</button>' +
      '</div>'
  });

  return '<div class="page local-page">' +
    pageHeading('我的视频', '链接与本机文件 · 共 ' + items.length + ' 个',
      '<button class="btn btn-primary btn-small" type="button" data-action="add-local">添加</button>') +
    (items.length
      ? '<div class="local-actions">' +
          '<button class="btn btn-primary btn-small" type="button" data-action="local-add-url">' + icon('external') + '<span>粘贴链接</span></button>' +
          '<button class="btn btn-secondary btn-small" type="button" data-action="local-add-file">' + icon('upload') + '<span>选择本机视频</span></button>' +
        '</div>' +
        '<div class="history-list local-list">' + rows + '</div>'
      : empty) +
    '<input type="file" id="local-file-input" accept="video/*,.mp4,.m4v,.webm,.mov,.ogv,.mkv" hidden>' +
    '<details class="local-help">' +
      '<summary>使用说明</summary>' +
      '<div class="tip-card">' +
        '<p>视频直链请填完整地址，例如 https://…/movie.mp4。HLS（.m3u8）在 Safari / iPhone 上原生播放，桌面 Chrome / Edge 会自动加载 hls.js；MP4（H.264 + AAC）兼容性最好。</p>' +
        '<p>B 站链接支持普通投稿视频页（含 BV 号），通过 B 站官方嵌入式播放器打开；番剧、会员内容可能无法嵌入。</p>' +
        '<p>网页链接、网盘分享页和平台会员页面不能直接播放，App 也不会去解析或抓取。</p>' +
        '<p>在 HTTPS 页面里，http:// 地址可能被浏览器当作混合内容拦截；局域网 NAS 建议改用 https。本机文件保存在浏览器里，不上传，也不写进 JSON 备份。</p>' +
      '</div>' +
    '</details>' +
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
      '<span class="profile-icon" aria-hidden="true"><span class="brand-mark"></span></span>' +
      '<div class="profile-main"><div class="profile-name">AH 影视</div><div class="profile-sub">粘贴链接播放 · v' + APP_VERSION + '</div></div>' +
      '<a class="icon-btn" href="#/settings" aria-label="设置">' + icon('gear') + '</a>' +
    '</div>' +
    '<div class="stat-grid">' +
      '<a class="stat" href="#/favorites"><b>' + favoriteCount() + '</b><span>收藏</span></a>' +
      '<a class="stat" href="#/history"><b>' + historyCount() + '</b><span>历史</span></a>' +
      '<a class="stat" href="#/local"><b>' + localCount() + '</b><span>我的视频</span></a>' +
    '</div>' +
    '<div class="settings-caption menu-caption">我的内容</div>' +
    '<div class="menu-group">' +
      '<a class="menu-row" href="#/local">' + icon('film') + '<span class="menu-label">我的视频</span><span class="menu-value">' + localCount() + '</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/sources">' + icon('server') + '<span class="menu-label">源管理</span><span class="menu-value">' + cachedSources().length + ' 个源</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row menu-row--rose" href="#/favorites">' + icon('heart') + '<span class="menu-label">我的收藏</span><span class="menu-value">' + favoriteCount() + '</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/history">' + icon('clock') + '<span class="menu-label">观看历史</span><span class="menu-value">' + historyCount() + '</span>' + icon('chevronRight', 'chevron') + '</a>' +
    '</div>' +
    '<div class="settings-caption menu-caption">应用</div>' +
    '<div class="menu-group">' +
      '<a class="menu-row" href="#/settings">' + icon('gear') + '<span class="menu-label">设置</span>' + icon('chevronRight', 'chevron') + '</a>' +
      '<a class="menu-row" href="#/about">' + icon('info') + '<span class="menu-label">关于 AH 影视</span>' + icon('chevronRight', 'chevron') + '</a>' +
    '</div>' +
    '<div class="tip-card">' +
      '<div class="tip-title">' + (installed ? '已安装到主屏幕' : '安装到主屏幕') + '</div>' +
      '<p>' + escapeHtml(installText) + '</p>' +
      (!installed ? '<button class="btn btn-secondary btn-small" type="button" data-action="install" id="install-button" hidden>立即安装</button>' : '') +
    '</div>' +
    '<p class="legal-note">App 本身不提供任何片源：只播放你粘贴的视频直链、B 站官方嵌入和本机文件。不抓取网页、不解析会员内容、不绕过 DRM。请只添加你有权观看的内容。</p>' +
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
    '<div class="settings-caption">在线内容</div>' +
    '<section class="settings-group">' +
      '<a class="settings-row" href="#/sources">' +
        '<span class="settings-icon">' + icon('server') + '</span><span class="settings-label">源管理与订阅</span><span class="settings-value">' + cachedSources().length + ' 个源</span>' + icon('chevronRight', 'chevron') +
      '</a>' +
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
    '<p class="settings-foot">观看进度、收藏、设置和添加的链接保存在这台设备的浏览器里（优先使用 IndexedDB）。本机文件也只保存在这台设备，不会写进 JSON 备份；清理浏览器数据前请保留原文件。</p>' +
    '</div>';
}

export function renderAbout() {
  const meta = getMeta();

  return '<div class="page about-page">' +
    '<div class="about-hero">' +
      '<img class="about-icon" src="./icons/icon-192.png" alt="AH 影视图标">' +
      '<h1>AH 影视</h1>' +
      '<p>粘贴链接播放 · v' + APP_VERSION + '</p>' +
    '</div>' +
    '<section class="info-card">' +
      '<h2>关于这个 App</h2>' +
      '<p>AH 影视是一个静态 PWA：Windows 浏览器和 iPhone 主屏幕都能打开，不需要登录。App 不内置任何影片，只播放你自己粘贴的链接、添加的本机文件，以及你自己配置的已授权点播源。</p>' +
      '<p>多源搜索需要可选的代理服务（推荐同源部署在 Vercel）：浏览器直接请求源站会被跨域和混合内容限制。代理只请求你填写的 Apple CMS JSON，不抓取网页。</p>' +
      '<p>' + escapeHtml(meta.notice || '本 App 不提供、不抓取任何片源。') + '</p>' +
      '<p>观看历史、收藏、播放进度和设置都保存在这台设备的浏览器里。</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>能播放什么</h2>' +
      '<p><strong>视频文件直链</strong>：以 .mp4、.webm、.m3u8 等结尾的地址，直接在 App 内播放。HLS（.m3u8）在 Safari / iPhone 上原生播放，桌面 Chrome / Edge 会自动加载 hls.js。</p>' +
      '<p><strong>哔哩哔哩视频页</strong>：含 BV 号的普通投稿视频，通过 B 站官方嵌入式播放器打开；番剧、会员与地区限制内容可能无法嵌入。</p>' +
      '<p><strong>本机文件</strong>：从设备选择视频文件，存入浏览器 IndexedDB，只在这台设备可用，不上传。</p>' +
      '<p><strong>不能播放</strong>：网页、网盘分享页、平台会员页面等。App 不做网页解析、不抓取播放地址、不绕过会员或 DRM。</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>AH 标识</h2>' +
      '<div class="brand-preview"><span class="brand-mark" aria-hidden="true"></span><div class="brand-preview-text">白色底 + 品牌红 #C92F36 的 AH；深色界面下使用同一套标记。</div></div>' +
      '<p>App 图标使用白色底 + 品牌红 AH；界面顶栏、启动页和空状态使用同一套标记，播放画面上不加水印。</p>' +
    '</section>' +
    '<section class="info-card">' +
      '<h2>边界</h2>' +
      '<p>App 本身不提供任何影视资源，也不内置、不推荐、不代找盗版站、未授权聚合源或破解接口。你粘贴的链接和添加的点播源都由你自己负责，请确保你有权观看；不要用这个 App 传播或重新分发内容。</p>' +
      '<p>源管理默认是空的，添加任何源都必须主动确认授权。App 只请求 Apple CMS 的 JSON 数据，不抓取网页、不解析会员内容、不绕过 DRM，也不下载或转存视频。</p>' +
      '<p>如果某个链接失效、需要登录、限制跨域或被平台删除，播放器会报错，这是对方服务器的限制，App 无法绕过。</p>' +
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

  return '<div class="detail-block">' +
    '<div class="detail-block__title">选集<span>共 ' + item.episodes.length + ' 集</span>' +
      (item.episodes.length > 4
        ? '<button class="text-btn eps-toggle" type="button" data-action="toggle-episodes" aria-expanded="false">展开全部</button>'
        : '') +
    '</div>' +
    seasons.map(([season, list]) => {
      const buttons = list
        .sort((a, b) => (Number(a.episode.episode) || a.index + 1) - (Number(b.episode.episode) || b.index + 1))
        .map(({ episode, index }) => {
          const number = episode.episode || index + 1;
          const record = getProgress(item.id, episode.id);
          const current = latest && latest.episodeId === episode.id;
          const status = record && record.time > 0
            ? (record.completed ? '已看完' : '看到 ' + formatTime(record.time))
            : '未观看';
          const name = episode.title || ('第 ' + number + ' 集');
          return '<a class="ep' + (current ? ' is-on' : '') + '" href="' + watchHref(item, episode.id) + '">' +
            '<span class="ep__no">' + String(number).padStart(2, '0') + '</span>' +
            '<span class="ep__body"><span class="ep__name">' + escapeHtml(name) + '</span>' +
            '<span class="ep__dur">' + escapeHtml(status) + '</span></span>' +
            '<span class="ep__play">' + icon('play') + '</span></a>';
        }).join('');

      return (seasons.length > 1 || season > 1 ? '<div class="season-title">第 ' + season + ' 季</div>' : '') +
        '<div class="eps">' + buttons + '</div>';
    }).join('') +
    '</div>';
}

export function renderDetail(itemId) {
  const item = getItem(itemId);

  if (!item) {
    return renderNotFound();
  }

  const latest = latestProgressForItem(item.id);
  const episode = getEpisode(item, latest?.episodeId);
  const favorite = isFavorite(item.id);
  const sources = sourcesFor(item, episode);
  const embed = embedFor(item, episode);
  const poster = safeAssetUrl(item.poster);
  const synopsis = item.synopsis || '暂无简介。';
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];

  const playTarget = latest && !latest.completed
    ? watchHref(item, latest.episodeId)
    : (episodes.length ? watchHref(item, episodes[0].id) : watchHref(item));
  const label = embed
    ? (latest && !latest.completed ? '再次打开' : '播放（B 站）')
    : item.local
      ? (latest && !latest.completed ? '继续播放' : '播放视频')
      : playLabel(item, latest, episode);

  const qualityText = embed
    ? 'B 站播放器内可选'
    : item.local
      ? (item.isHls ? 'HLS 原始地址' : '原始文件')
      : (sources.map((source) => source.quality || source.label).filter(Boolean).join(' / ') || '原画');
  const subtitleText = embed
    ? '以 B 站播放器为准'
    : item.local
      ? '按文件内嵌字幕'
      : (item.subtitles && item.subtitles.length
        ? item.subtitles.map((subtitle) => subtitle.label || '字幕').join(' / ')
        : '暂无字幕');
  const badge = badgeFor(item);
  const flags = [badge, item.subtitles && item.subtitles.length ? '中文字幕' : ''].filter(Boolean);
  const metaParts = itemMeta(item);
  if (item.area && !metaParts.includes(item.area)) metaParts.push(item.area);
  const score = Number(item.score || item.rating || 0);
  const tags = Array.from(new Set([
    item.typeName,
    item.area,
    badge
  ].filter(Boolean))).slice(0, 4);

  const typeName = item.typeName || categoryLabel(item.category);
  const runtimeText = episodes.length ? '全 ' + episodes.length + ' 集' : formatRuntime(item);
  const sourceName = item.local
    ? (item.localKind === 'file'
      ? (item.fileName || '本机文件')
      : item.localKind === 'embed'
        ? ('bilibili.com · ' + (item.embed ? item.embed.bvid : ''))
        : (item.host || '网络地址'))
    : ((item.remoteSource && item.remoteSource.name) || item.source || '');
  const playMode = embed ? 'B 站官方嵌入' : item.local
    ? (item.localKind === 'file' ? '本机文件' : item.localKind === 'embed' ? 'B 站嵌入' : '网络地址')
    : '在线播放';
  const license = item.license || (item.local ? '个人使用' : '');

  const movieFacts = [
    ['导演', item.director || ''],
    ['主演', item.actors || ''],
    ['地区', item.area || ''],
    ['类型', typeName || ''],
    ['年份', item.year ? String(item.year) : ''],
    ['片长', runtimeText && runtimeText !== '—' ? runtimeText : ''],
    ['上传者', item.uploader || '']
  ].filter(([, value]) => value);
  const sourceFacts = [
    ['来源', sourceName],
    ['清晰度', qualityText],
    ['字幕', subtitleText],
    ['播放方式', playMode],
    ['授权', license]
  ].filter(([, value]) => value);
  const fact = ([key, value]) => '<div class="fact"><span class="fact__k">' + escapeHtml(key) + '</span><span class="fact__v">' + escapeHtml(value) + '</span></div>';
  const flagsHtml = flags.map((value) => '<span class="detail__flag">' + escapeHtml(value) + '</span>').join('');
  const metaHtml = metaParts.length
    ? '<div class="detail__meta">' + metaParts.map((part, index) =>
        (index ? '<i class="dot"></i>' : '') + '<span>' + escapeHtml(part) + '</span>'
      ).join('') +
      (score > 0 ? '<span class="detail__score">' + icon('star') + score.toFixed(1) + '</span>' : '') +
    '</div>'
    : '';

  const related = relatedItems(item, 6);
  const similarSection = related.length
    ? '<div class="detail__similar"><div class="sec__head"><h2 class="sec__title">相似推荐</h2>' +
        '<a class="sec__more" href="#/search">更多' + icon('chevronRight') + '</a></div>' +
        '<div class="grid-posters">' + related.map((entry) => posterCard(entry, { progress: latestProgressForItem(entry.id) })).join('') + '</div>' +
      '</div>'
    : '';

  return '<div class="detail">' +
    '<div class="detail__hero">' +
      (poster ? '<img src="' + escapeHtml(poster) + '" alt="">' : '<div class="detail__hero-fallback"></div>') +
      '<button class="detail__back" type="button" data-action="back" aria-label="返回">' + icon('chevronLeft') + '</button>' +
      (flags.length ? '<div class="detail__flags">' + flagsHtml + '</div>' : '') +
    '</div>' +
    '<div class="detail__wrap">' +
      '<div class="detail__poster">' + posterMedia(item, { eager: true, badge: false }) + '</div>' +
      '<div class="detail__main">' +
        '<h1 class="detail__title">' + escapeHtml(item.title) + '</h1>' +
        (item.originalTitle && item.originalTitle !== item.title ? '<div class="detail__en">' + escapeHtml(item.originalTitle) + '</div>' : '') +
        metaHtml +
        '<p class="detail__desc">' + escapeHtml(synopsis) + '</p>' +
        (tags.length ? '<div class="detail__tags">' + tags.map((tag) => '<span class="chip chip--static">' + escapeHtml(tag) + '</span>').join('') + '</div>' : '') +
        '<div class="detail__acts detail-actions">' +
          '<a class="btn btn-primary btn-large detail-play" href="' + playTarget + '">' + icon('play') + escapeHtml(label) + '</a>' +
          '<button class="btn btn-ghost btn-large" type="button" data-action="favorite" data-item-id="' + escapeHtml(item.id) + '" aria-pressed="' + favorite + '">' +
            icon(favorite ? 'heartFill' : 'heart') + (favorite ? '已收藏' : '收藏') +
          '</button>' +
          '<button class="btn btn-ghost btn-large" type="button" data-action="share">' + icon('share') + '分享</button>' +
        '</div>' +
        (latest && !latest.completed && !latest.external ? '<div class="detail-progress-note detail-last-watch">' + icon('clock') + '<span>上次看到 ' + escapeHtml(formatTime(latest.time)) + (episode ? ' · ' + escapeHtml(formatEpisodeLabel(episode)) : '') + '</span></div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail__cols">' +
      '<div>' +
        renderEpisodes(item, latest) +
        '<div class="detail-block"><div class="detail-block__title">片源与授权' +
          (item.remote ? '<button class="text-btn detail-refresh" type="button" data-action="refresh-remote" data-item-id="' + escapeHtml(item.id) + '">刷新片源</button>' : '') +
        '</div><div class="facts">' + sourceFacts.map(fact).join('') + '</div></div>' +
      '</div>' +
      '<aside>' +
        '<div class="detail-block"><div class="detail-block__title">影片资料</div>' +
          '<div class="facts">' + movieFacts.map(fact).join('') + '</div></div>' +
      '</aside>' +
    '</div>' +
    similarSection +
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

/* 通用 UI 片段与交互：图标、海报卡、分页、Toast、弹窗、底部面板。 */

import { categoryLabel } from './catalog.js';

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chevronLeft: '<path d="M14.5 5 8 12l6.5 7"/>',
  chevronRight: '<path d="M9.5 5 16 12l-6.5 7"/>',
  chevronDown: '<path d="M6 9.5 12 15l6-5.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  play: '<path d="M9.1 5.7v12.6L19 12z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  pause: '<rect x="7.4" y="5" width="3.5" height="14" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.1" y="5" width="3.5" height="14" rx="1.6" fill="currentColor" stroke="none"/>',
  /* ±10 秒沿用 Material Icons 的 replay_10 / forward_10（Apache-2.0）。
     关键差别：标准图的圆环是闭合的，实心大箭头压在左上（后退）/ 右上（前进）的环上；
     旧版在圆环顶部留一个缺口、再挂一个小三角，缩小后缺口像个缺口、三角像个凸起。 */
  rewind: '<path fill="currentColor" stroke="none" d="M11.99 5V1l-5 5l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6s-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8s-3.58-8-8-8z"/><path fill="currentColor" stroke="none" d="M10.89 16h-.85v-3.26l-1.01.31v-.69l1.77-.63h.09V16zm4.28-1.76c0 .32-.03.6-.1.82s-.17.42-.29.57s-.28.26-.45.33s-.37.1-.59.1s-.41-.03-.59-.1s-.33-.18-.46-.33s-.23-.34-.3-.57s-.11-.5-.11-.82v-.74c0-.32.03-.6.1-.82s.17-.42.29-.57s.28-.26.45-.33s.37-.1.59-.1s.41.03.59.1s.33.18.46.33s.23.34.3.57s.11.5.11.82v.74zm-.85-.86c0-.19-.01-.35-.04-.48s-.07-.23-.12-.31s-.11-.14-.19-.17s-.16-.05-.25-.05s-.18.02-.25.05s-.14.09-.19.17s-.09.18-.12.31s-.04.29-.04.48v.97c0 .19.01.35.04.48s.07.24.12.32s.11.14.19.17s.16.05.25.05s.18-.02.25-.05s.14-.09.19-.17s.09-.19.11-.32s.04-.29.04-.48v-.97z"/>',
  forward: '<path fill="currentColor" stroke="none" d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6s2.69-6 6-6v4l5-5l-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8s8-3.58 8-8h-2z"/><path fill="currentColor" stroke="none" d="M10.86 15.94v-4.27h-.09L9 12.3v.69l1.01-.31v3.26zm1.39-2.5v.74c0 1.9 1.31 1.82 1.44 1.82c.14 0 1.44.09 1.44-1.82v-.74c0-1.9-1.31-1.82-1.44-1.82c-.14 0-1.44-.09-1.44 1.82zm2.04-.12v.97c0 .77-.21 1.03-.59 1.03s-.6-.26-.6-1.03v-.97c0-.75.22-1.01.59-1.01c.38-.01.6.26.6 1.01z"/>',
  volume: '<path d="M4.6 9.4h3.1l4.2-3.6v12.4l-4.2-3.6H4.6z"/><path d="M15.2 9.2a4.1 4.1 0 0 1 0 5.6"/><path d="M17.7 6.7a7.5 7.5 0 0 1 0 10.6"/>',
  volumeMute: '<path d="M4.6 9.4h3.1l4.2-3.6v12.4l-4.2-3.6H4.6z"/><path d="m16.2 9.6 4.6 4.8M20.8 9.6l-4.6 4.8"/>',
  fullscreen: '<path d="M4.5 9.2V4.5h4.7M14.8 4.5h4.7v4.7M19.5 14.8v4.7h-4.7M9.2 19.5H4.5v-4.7"/>',
  exitFullscreen: '<path d="M4.5 9.2h4.7V4.5M19.5 9.2h-4.7V4.5M14.8 19.5v-4.7h4.7M9.2 19.5v-4.7H4.5"/>',
  rotate: '<rect x="3.5" y="8.8" width="14.2" height="9.6" rx="2"/><path d="M13.4 5.2a7.4 7.4 0 0 1 7.1 7.1"/><path d="M20.5 9v3.5H17"/>',
  quality: '<path d="M5 16.5v-4M9.5 16.5V8M14 16.5v-6M18.5 16.5V6"/>',
  speed: '<path d="M12 13.5l3.4-3.4"/><path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.2 10.2a2.4 2.4 0 1 0 0 3.6"/><path d="M17.2 10.2a2.4 2.4 0 1 0 0 3.6"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.2 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.2 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19.5h14"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7" ry="3"/><path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.5 3.4-5.5 7-5.5s6.3 2 7 5.5"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 4.5v15M17 4.5v15M3.5 9h3.5M3.5 15h3.5M17 9h3.5M17 15h3.5"/>',
  external: '<path d="M14 4.5h5.5V10M19 5l-8 8"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5h5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5v5h-5"/>',
  alert: '<path d="M12 4 21 20H3z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  gear: '<path d="M9.32 5.53A7 7 0 0 1 10.43 5.18L10.54 2.77A9.35 9.35 0 0 1 13.46 2.77L13.57 5.18A7 7 0 0 1 14.68 5.53A7 7 0 0 1 15.71 6.06L17.5 4.44A9.35 9.35 0 0 1 19.56 6.5L17.94 8.29A7 7 0 0 1 18.47 9.32A7 7 0 0 1 18.82 10.43L21.23 10.54A9.35 9.35 0 0 1 21.23 13.46L18.82 13.57A7 7 0 0 1 18.47 14.68A7 7 0 0 1 17.94 15.71L19.56 17.5A9.35 9.35 0 0 1 17.5 19.56L15.71 17.94A7 7 0 0 1 14.68 18.47A7 7 0 0 1 13.57 18.82L13.46 21.23A9.35 9.35 0 0 1 10.54 21.23L10.43 18.82A7 7 0 0 1 9.32 18.47A7 7 0 0 1 8.29 17.94L6.5 19.56A9.35 9.35 0 0 1 4.44 17.5L6.06 15.71A7 7 0 0 1 5.53 14.68A7 7 0 0 1 5.18 13.57L2.77 13.46A9.35 9.35 0 0 1 2.77 10.54L5.18 10.43A7 7 0 0 1 5.53 9.32A7 7 0 0 1 6.06 8.29L4.44 6.5A9.35 9.35 0 0 1 6.5 4.44L8.29 6.06A7 7 0 0 1 9.32 5.53Z"/><circle cx="12" cy="12" r="3"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4.5L20 8.5 15.5 4 4 15.5z"/><path d="M13.5 6 18 10.5"/>',
  shield: '<path d="M12 3.5 20 6v6c0 4.5-3.4 7.4-8 8.5-4.6-1.1-8-4-8-8.5V6z"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>'
};

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char];
  });
}

export function icon(name, className = '') {
  const body = ICONS[name] || '';
  return '<svg class="icon ' + className + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

export function safeAssetUrl(value) {
  const url = String(value || '');
  if (!url) return '';
  if (/^(https?:\/\/|assets\/|icons\/|data:image\/)/i.test(url)) return url;
  if (url.startsWith('./')) return url.slice(2);
  return '';
}

export function safeExternalUrl(value) {
  const url = String(value || '');
  return /^https?:\/\//i.test(url) ? url : '';
}

export function formatTime(seconds) {
  let total = Math.floor(Number(seconds) || 0);
  if (total < 0) total = 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }
  return minutes + ':' + String(secs).padStart(2, '0');
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return total + ' 秒';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return hours + ' 小时' + (minutes ? ' ' + minutes + ' 分' : '');
  }

  return minutes + ' 分' + (secs ? ' ' + secs + ' 秒' : '');
}

export function formatRuntime(item) {
  if (!item) return '—';
  if (Number(item.runtimeSeconds) > 0) return formatDuration(item.runtimeSeconds);
  return item.runtime || '—';
}

export function formatRelative(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';

  const now = new Date();
  const date = new Date(value);
  const diff = now.getTime() - value;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + ' 分钟前';

  const time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  const sameDay = now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() && now.getDate() === date.getDate();
  if (sameDay) return '今天 ' + time;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYesterday = yesterday.getFullYear() === date.getFullYear() && yesterday.getMonth() === date.getMonth() && yesterday.getDate() === date.getDate();
  if (isYesterday) return '昨天 ' + time;

  if (now.getFullYear() === date.getFullYear()) {
    return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
  }

  return date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return (size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)) + ' ' + units[index];
}

export function progressPercent(record) {
  if (!record) return 0;
  if (record.completed) return 100;
  if (!record.duration || record.duration <= 0) return 0;
  return Math.max(0, Math.min(100, (record.time / record.duration) * 100));
}

export function formatEpisodeLabel(episode) {
  if (!episode) return '';
  const number = episode.episode || episode.number;
  const parts = [];
  if (number) parts.push('第 ' + number + ' 集');
  if (episode.title) parts.push(episode.title);
  return parts.join(' · ');
}

export function itemMeta(item) {
  if (!item) return [];
  const parts = [];

  if (item.year) parts.push(String(item.year));
  if (item.category) parts.push(categoryLabel(item.category));
  if (item.kind === 'series' && Array.isArray(item.episodes) && item.episodes.length) {
    parts.push('共 ' + item.episodes.length + ' 集');
  }
  const runtime = formatRuntime(item);
  if (runtime && runtime !== '—') parts.push(runtime);

  return parts;
}

export function badgeFor(item) {
  if (!item) return '';
  if (item.local) {
    if (item.localKind === 'file') return '本机';
    if (item.localKind === 'embed') return 'B站';
    return '网址';
  }
  if (item.remote) return '在线';
  if (Array.isArray(item.tags) && item.tags.includes('预告片')) return '预告片';
  if (item.license === 'CC0 1.0') return 'CC0';
  const first = Array.isArray(item.sources) ? item.sources[0] : null;
  if (first && first.quality && /1080/.test(first.quality)) return '1080P';
  return '';
}

export function titleHref(item) {
  return '#/title/' + encodeURIComponent(item.id);
}

export function watchHref(item, episodeId) {
  return '#/watch/' + encodeURIComponent(item.id) + (episodeId ? '/' + encodeURIComponent(episodeId) : '');
}

export function playLabel(item, record, episode) {
  if (!record || record.completed) {
    if (item && Array.isArray(item.tags) && item.tags.includes('预告片')) return '播放预告';
    return '开始播放';
  }
  const label = episode ? formatEpisodeLabel(episode) : '';
  return '继续观看 ' + (label ? label + ' · ' : '') + formatTime(record.time);
}

export function posterPlaceholder(item) {
  return '<div class="poster-placeholder" aria-hidden="true">' +
    '<span class="brand-mark"></span>' +
    '<span class="poster-ph-title">' + escapeHtml(item.title) + '</span>' +
    '</div>';
}

export function posterMedia(item, options = {}) {
  const src = safeAssetUrl(item.poster);
  const badge = options.badge === false ? '' : (options.badge || badgeFor(item));
  const duration = Number(item.runtimeSeconds) > 0 && item.kind !== 'series'
    ? '<span class="poster-duration">' + escapeHtml(formatTime(item.runtimeSeconds)) + '</span>'
    : '';
  const progress = options.progress;
  const showProgress = progress && progress.time > 0;
  const percent = showProgress ? progressPercent(progress) : 0;
  const loading = options.eager ? 'eager' : 'lazy';

  return '<div class="poster-media">' +
    posterPlaceholder(item) +
    (src ? '<img src="' + escapeHtml(src) + '" alt="" loading="' + loading + '" decoding="async" draggable="false">' : '') +
    (badge ? '<span class="poster-badge">' + escapeHtml(badge) + '</span>' : '') +
    duration +
    (showProgress ? '<div class="poster-progress"><i style="width:' + percent.toFixed(2) + '%"></i></div>' : '') +
    '</div>';
}

export function posterCard(item, options = {}) {
  const meta = [item.year, item.local ? '' : categoryLabel(item.category)].filter(Boolean).join(' · ');
  return '<a class="poster-card" href="' + titleHref(item) + '" aria-label="' + escapeHtml(item.title) + '">' +
    posterMedia(item, options) +
    '<div class="poster-title" title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</div>' +
    (meta ? '<div class="poster-meta">' + escapeHtml(meta) + '</div>' : '') +
    '</a>';
}

export function continueCard(item, record, episode) {
  const src = safeAssetUrl(item.poster);
  const percent = progressPercent(record);
  const sub = '看到 ' + formatTime(record.time) +
    (episode ? ' · ' + formatEpisodeLabel(episode) : '') +
    (record.duration > 0 ? ' / ' + formatTime(record.duration) : '');

  return '<a class="continue-card" href="' + watchHref(item, record.episodeId) + '">' +
    '<div class="continue-thumb">' +
    posterPlaceholder(item) +
    (src ? '<img src="' + escapeHtml(src) + '" alt="" loading="lazy" decoding="async">' : '') +
    '<div class="continue-play"><span>' + icon('play') + '</span></div>' +
    '<div class="continue-progress"><i style="width:' + percent.toFixed(2) + '%"></i></div>' +
    '</div>' +
    '<div class="continue-title">' + escapeHtml(item.title) + '</div>' +
    '<div class="continue-sub">' + escapeHtml(sub) + '</div>' +
    '</a>';
}

export function emptyState({ title, text, action = '', mark = true }) {
  return '<div class="empty">' +
    (mark ? '<span class="empty-mark brand-mark" aria-hidden="true"></span>' : '') +
    '<h3>' + escapeHtml(title) + '</h3>' +
    '<p>' + escapeHtml(text) + '</p>' +
    (action || '') +
    '</div>';
}

export function pagination({ page, totalPages, totalItems, basePath, params = {} }) {
  const prevParams = { ...params, page: page - 1 };
  const nextParams = { ...params, page: page + 1 };
  const query = new URLSearchParams(params).toString();
  const base = escapeHtml(basePath);

  const prev = page > 1
    ? '<a class="page-btn" href="#' + escapeHtml(basePath) + '?' + escapeHtml(new URLSearchParams(prevParams).toString()) + '" aria-label="上一页">' + icon('chevronLeft') + '</a>'
    : '<span class="page-btn is-disabled" aria-hidden="true">' + icon('chevronLeft') + '</span>';

  const next = page < totalPages
    ? '<a class="page-btn" href="#' + escapeHtml(basePath) + '?' + escapeHtml(new URLSearchParams(nextParams).toString()) + '" aria-label="下一页">' + icon('chevronRight') + '</a>'
    : '<span class="page-btn is-disabled" aria-hidden="true">' + icon('chevronRight') + '</span>';

  return '<nav class="pagination" aria-label="分页">' +
    prev +
    '<span class="page-status">第 ' + page + ' / ' + totalPages + ' 页 · 共 ' + totalItems + ' 项</span>' +
    next +
    '<button class="page-btn page-jump" type="button" data-action="jump-page" data-total-pages="' + totalPages + '" data-base="' + base + '" data-query="' + escapeHtml(query) + '" data-current="' + page + '">跳页</button>' +
    '</nav>';
}

let toastTimer = null;

export function toast(message, timeout = 2200) {
  const element = document.getElementById('toast');
  if (!element) return;

  element.textContent = String(message || '');
  element.classList.add('is-visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.classList.remove('is-visible');
    toastTimer = null;
  }, timeout);
}

export function debounce(fn, wait = 150) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

let activeOverlayClose = null;

function closeActiveOverlay() {
  if (activeOverlayClose) {
    const close = activeOverlayClose;
    activeOverlayClose = null;
    close();
  }
}

export function closeOverlay() {
  closeActiveOverlay();
}

function createBackdrop(className, onClick) {
  const backdrop = document.createElement('div');
  backdrop.className = className;
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClick();
  });
  return backdrop;
}

function focusSoon(element) {
  window.requestAnimationFrame(() => {
    try {
      element.focus({ preventScroll: true });
      if (typeof element.select === 'function') element.select();
    } catch (error) {
      /* 忽略。 */
    }
  });
}

export function openPrompt({ title, description = '', value = '', placeholder = '', confirmText = '确定', cancelText = '取消', inputMode = 'numeric', validate }) {
  closeActiveOverlay();

  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(null);
      return;
    }

    const previousFocus = document.activeElement;
    const backdrop = createBackdrop('dialog-backdrop', () => close(null));
    const dialog = document.createElement('form');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = '<h3>' + escapeHtml(title) + '</h3>' +
      (description ? '<p>' + escapeHtml(description) + '</p>' : '') +
      '<input type="text" inputmode="' + escapeHtml(inputMode) + '" autocomplete="off" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '">' +
      '<div class="dialog-error" role="alert"></div>' +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn btn-secondary" data-cancel>' + escapeHtml(cancelText) + '</button>' +
      '<button type="submit" class="btn btn-primary">' + escapeHtml(confirmText) + '</button>' +
      '</div>';

    const input = dialog.querySelector('input');
    const error = dialog.querySelector('.dialog-error');

    function cleanup() {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      if (activeOverlayClose === cleanup) activeOverlayClose = null;
      try {
        if (previousFocus && typeof previousFocus.focus === 'function') {
          previousFocus.focus({ preventScroll: true });
        }
      } catch (error) {
        /* 忽略。 */
      }
    }

    function close(result) {
      cleanup();
      resolve(result);
    }

    function submit() {
      const raw = input ? input.value.trim() : '';
      const message = typeof validate === 'function' ? validate(raw) : '';
      if (message) {
        if (error) error.textContent = message;
        focusSoon(input);
        return;
      }
      close(raw);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    }

    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });

    dialog.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    document.addEventListener('keydown', onKeydown);

    backdrop.appendChild(dialog);
    root.appendChild(backdrop);
    activeOverlayClose = () => close(null);
    focusSoon(input);
  });
}

export function openConfirm({ title, description = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  closeActiveOverlay();

  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(false);
      return;
    }

    const previousFocus = document.activeElement;
    const backdrop = createBackdrop('dialog-backdrop', () => close(false));
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = '<h3>' + escapeHtml(title) + '</h3>' +
      (description ? '<p>' + escapeHtml(description) + '</p>' : '') +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn btn-secondary" data-cancel>' + escapeHtml(cancelText) + '</button>' +
      '<button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-confirm>' + escapeHtml(confirmText) + '</button>' +
      '</div>';

    function cleanup() {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      if (activeOverlayClose === cleanup) activeOverlayClose = null;
      try {
        if (previousFocus && typeof previousFocus.focus === 'function') {
          previousFocus.focus({ preventScroll: true });
        }
      } catch (error) {
        /* 忽略。 */
      }
    }

    function close(result) {
      cleanup();
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
    }

    dialog.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    dialog.querySelector('[data-confirm]').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeydown);

    backdrop.appendChild(dialog);
    root.appendChild(backdrop);
    activeOverlayClose = () => close(false);
    focusSoon(dialog.querySelector('[data-confirm]'));
  });
}

export function openSheet({ title, options = [], value = null, className = '' }) {
  closeActiveOverlay();

  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(null);
      return;
    }

    const previousFocus = document.activeElement;
    /* 让弹层样式可以同时作用到背板（例如播放器里的侧边浮卡只压暗一点）。 */
    const backdrop = createBackdrop('sheet-backdrop' + (className ? ' ' + className + '-backdrop' : ''), () => close(null));
    const sheet = document.createElement('div');
    sheet.className = 'sheet' + (className ? ' ' + className : '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    const list = options.map((option) => {
      const active = value !== null && String(option.value) === String(value);
      return '<button type="button" class="sheet-option' + (active ? ' is-active' : '') + '" data-value="' + escapeHtml(option.value) + '">' +
        '<span>' + escapeHtml(option.label) + '</span>' +
        (active ? icon('check') : '') +
        '</button>';
    }).join('');

    sheet.innerHTML = '<div class="sheet-title">' + escapeHtml(title) + '</div>' +
      '<div class="sheet-list">' + list + '</div>' +
      '<button type="button" class="sheet-cancel" data-cancel>取消</button>';

    function cleanup() {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      if (activeOverlayClose === cleanup) activeOverlayClose = null;
      try {
        if (previousFocus && typeof previousFocus.focus === 'function') {
          previousFocus.focus({ preventScroll: true });
        }
      } catch (error) {
        /* 忽略。 */
      }
    }

    function close(result) {
      cleanup();
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    }

    sheet.querySelectorAll('[data-value]').forEach((button) => {
      button.addEventListener('click', () => close(button.getAttribute('data-value')));
    });
    sheet.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    document.addEventListener('keydown', onKeydown);

    backdrop.appendChild(sheet);
    root.appendChild(backdrop);
    activeOverlayClose = () => close(null);
    focusSoon(sheet.querySelector('[data-value]'));
  });
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

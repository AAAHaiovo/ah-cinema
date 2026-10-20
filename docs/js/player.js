/* 播放页：自定义控制层、清晰度、倍速、断点续播、全屏、字幕与快捷键。 */

import { sourcesFor, embedFor, embedPlayerUrl, embedWatchUrl } from './catalog.js';
import { state, getProgress, saveProgress, markOpened } from './store.js';
import {
  escapeHtml,
  icon,
  formatTime,
  formatEpisodeLabel,
  safeAssetUrl,
  safeExternalUrl,
  openSheet,
  isIOS
} from './ui.js';
import { navigate } from './router.js';
import { resolveSourceUrl } from './remote-api.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/* 剩余时间，iOS 播放器风格：-04:03。 */
function formatRemaining(seconds) {
  const text = formatTime(Math.max(0, Number(seconds) || 0));
  const parts = text.split(':');
  if (parts.length === 2 && parts[0].length < 2) return '-0' + text;
  return '-' + text;
}

/*
 * 每次从影片简介进入播放页都重置横竖屏；
 * 只有同一次观看里选集 / 自动连播才沿用当前横屏状态。
 */
let pendingLandscape = null;

let hlsPromise = null;

/* hls.js 按需加载：Safari 用原生 HLS，其他浏览器用 hls.js。 */
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsPromise) return hlsPromise;

  hlsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/hls.min.js';
    script.async = true;
    script.onload = () => {
      if (window.Hls) resolve(window.Hls);
      else reject(new Error('hls.js 加载失败'));
    };
    script.onerror = () => reject(new Error('hls.js 加载失败'));
    document.head.appendChild(script);
  }).catch((error) => {
    hlsPromise = null;
    throw error;
  });

  return hlsPromise;
}

function looksLikeHls(source) {
  if (!source) return false;
  if (source.isHls) return true;
  return /\.m3u8(?:$|[?#])/i.test(String(source.src || ''));
}

/* 代理地址里的 u= 才是真正的上游；诊断和扩展名判断都看它。 */
function upstreamUrl(src) {
  try {
    const url = new URL(src, location.href);
    if (/\/api\/proxy\/?$/.test(url.pathname)) {
      const target = url.searchParams.get('u');
      if (target) return target;
    }
    return url.href;
  } catch (error) {
    return String(src || '');
  }
}

function sourcePath(src) {
  try {
    return new URL(upstreamUrl(src)).pathname;
  } catch (error) {
    return String(src || '');
  }
}

function isStaticVideoUrl(src) {
  return /\.(mp4|m4v|webm|mov|ogv|ogg|mkv)$/i.test(sourcePath(src));
}

function isHlsContentType(type) {
  return /(mpegurl|x-mpegurl|vnd\.apple\.mpegurl)/i.test(String(type || ''));
}

function sourceHost(src) {
  try {
    return new URL(upstreamUrl(src)).host;
  } catch (error) {
    return '';
  }
}

/* 失败后探测 Content-Type：用来区分“编码不支持”和“返回了网页/接口”。 */
async function probeSource(src) {
  if (!src) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(src, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal
    });
    return {
      status: response.status,
      type: String(response.headers.get('content-type') || '').toLowerCase()
    };
  } catch (error) {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function mediaErrorMessage(code, src, info) {
  const host = sourceHost(src);
  const where = host ? '（' + host + '）' : '';

  if (code === 2) return '网络错误：视频没有加载成功。请检查网络，或换一个线路。' + where;
  if (code === 3) return '视频解码失败：文件可能损坏，或当前设备不支持它的编码。请换一个线路。' + where;

  if (code === 4) {
    const type = info ? String(info.type || '') : '';
    const status = info ? Number(info.status) || 0 : 0;

    if (status >= 400) {
      return '源站拒绝了请求（HTTP ' + status + '），可能是防盗链、链接过期或需要网站解析。请换一个线路。' + where;
    }
    if (/text\/html|application\/(json|xml)|text\/plain/i.test(type)) {
      return '这个地址返回的是网页或接口数据，不是视频流。这类线路需要网页解析或防盗链，App 不支持。请换一个线路。' + where;
    }
    if (/^video\//i.test(type)) {
      return '这个视频的编码当前浏览器无法播放（常见于 H.265/HEVC 或 MKV）。请换一个 H.264 线路，或在 iPhone/iPad 的 Safari 里打开。' + where;
    }
    return '这个地址不是浏览器能直接播放的视频流，可能是 H.265/HEVC、MKV、防盗链或网页解析线路。请换一个线路，或在 iPhone/iPad 的 Safari 里打开。' + where;
  }

  return '片源加载失败，请检查网络后重试。';
}

function formatRate(rate) {
  return String(Number(rate) || 1) + '×';
}

function qualityOf(source) {
  return (source && (source.quality || source.label)) || '原画';
}

function subtitlesFor(item, episode) {
  const fromEpisode = episode && Array.isArray(episode.subtitles) ? episode.subtitles : [];
  const fromItem = Array.isArray(item.subtitles) ? item.subtitles : [];
  return (fromEpisode.length ? fromEpisode : fromItem).filter((subtitle) => subtitle && safeAssetUrl(subtitle.src));
}

function embedPage(item, episode, embed) {
  const subtitle = episode
    ? formatEpisodeLabel(episode)
    : (item.originalTitle || '');
  const watchUrl = safeExternalUrl(embedWatchUrl(embed));

  return '<div class="player-page embed-page" id="player-page">' +
    '<div class="embed-topbar">' +
      '<button class="pbtn embed-back" type="button" data-paction="back" aria-label="返回">' + icon('chevronLeft') + '</button>' +
      '<div class="embed-headings">' +
        '<div class="embed-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="embed-sub">' + escapeHtml(subtitle ? subtitle + ' · 哔哩哔哩' : '哔哩哔哩') + '</div>' +
      '</div>' +
      (watchUrl ? '<a class="embed-open" href="' + escapeHtml(watchUrl) + '" target="_blank" rel="noopener noreferrer">在 B 站打开</a>' : '') +
    '</div>' +
    '<div class="embed-stage">' +
      '<iframe class="embed-frame" src="' + escapeHtml(embedPlayerUrl(embed)) + '" title="' + escapeHtml(item.title + ' · 哔哩哔哩播放器') + '" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>' +
    '</div>' +
    '<div class="embed-foot">' +
      '<span>片源由哔哩哔哩提供 · ' + escapeHtml(item.license || '公共领域') + '</span>' +
      '<span>清晰度 / 倍速 / 字幕请用画面内控件</span>' +
    '</div>' +
    '</div>';
}

function mountEmbedPlayer(item, episode) {
  const page = document.getElementById('player-page');
  if (!page) return () => {};

  const controller = new AbortController();
  const signal = controller.signal;
  let cleaned = false;

  function goBack() {
    if (history.length > 1) {
      history.back();
      return;
    }
    location.hash = '#/title/' + encodeURIComponent(item.id);
  }

  page.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-paction]');
    if (!actionButton) return;
    event.preventDefault();
    if (actionButton.getAttribute('data-paction') === 'back') goBack();
  }, { signal });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') goBack();
  }, { signal });

  markOpened({ itemId: item.id, episodeId: episode ? episode.id : null }).catch(() => {
    /* 记录“打开过”失败不打断观看。 */
  });

  return () => {
    if (cleaned) return;
    cleaned = true;
    controller.abort();
  };
}

export function playerPage(item, episode) {
  const embed = embedFor(item, episode);
  if (embed) return embedPage(item, episode, embed);

  const sources = sourcesFor(item, episode);
  const subtitles = subtitlesFor(item, episode);
  const poster = safeAssetUrl(item.poster);
  const subtitle = episode
    ? formatEpisodeLabel(episode)
    : (item.originalTitle || item.source || '');
  const quality = qualityOf(sources[0]);
  const initialRate = state.settings.defaultRate;

  const tracks = subtitles.map((track, index) =>
    '<track kind="subtitles" label="' + escapeHtml(track.label || ('字幕 ' + (index + 1))) + '" srclang="' + escapeHtml(track.srclang || 'zh') + '" src="' + escapeHtml(safeAssetUrl(track.src)) + '">'
  ).join('');

  return '<div class="player-page" id="player-page">' +
    '<div class="player-stage" id="player-stage">' +
      '<video id="player-video" class="player-video" playsinline webkit-playsinline preload="metadata" poster="' + escapeHtml(poster) + '">' +
        tracks +
      '</video>' +

      '<div class="player-buffering" id="player-buffering" hidden><span class="player-spinner" aria-hidden="true"></span></div>' +

      '<div class="player-error" id="player-error" hidden>' +
        '<div class="player-error-icon" aria-hidden="true">!</div>' +
        '<h2>片源加载失败</h2>' +
        '<p id="player-error-text">请检查网络连接后重试。影片本身仍在片库中，稍后可以再试。</p>' +
        '<div class="player-error-actions">' +
          '<button class="pbtn-text" type="button" data-paction="retry">重试</button>' +
          '<button class="pbtn-text" type="button" data-paction="line">换线路</button>' +
          '<button class="pbtn-text" type="button" data-paction="back">返回</button>' +
        '</div>' +
      '</div>' +

      '<div class="player-overlay" id="player-overlay">' +
        '<div class="player-top">' +
          '<div class="player-headings">' +
            '<div class="player-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="player-subtitle">' + escapeHtml(subtitle) + '</div>' +
          '</div>' +
          /* 右上角：投屏 + 关闭。 */
          '<div class="player-top-actions">' +
            '<button class="pbtn pbtn-cast" type="button" data-paction="cast" id="player-cast" aria-label="投屏">' + icon('cast') + '</button>' +
            '<button class="pbtn pbtn-close" type="button" data-paction="back" aria-label="关闭播放器">' + icon('close') + '</button>' +
          '</div>' +
        '</div>' +

        /* 画面居中：后退 / 播放暂停 / 前进，竖向排列。 */
        '<div class="player-center">' +
          '<button class="pbtn pbtn-seek" type="button" data-paction="rewind" aria-label="后退 10 秒">' + icon('rewind') + '</button>' +
          '<button class="pbtn pbtn-play" type="button" data-paction="toggle" id="player-play" aria-label="播放">' + icon('play') + '</button>' +
          '<button class="pbtn pbtn-seek" type="button" data-paction="forward" aria-label="前进 10 秒">' + icon('forward') + '</button>' +
        '</div>' +

        /* 右侧竖向音量条，底部扬声器键同时是静音键。 */
        '<div class="player-volume" id="player-volume" aria-label="音量">' +
          '<div class="player-volume-track" id="player-volume-track" role="slider" tabindex="0" aria-label="音量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">' +
            '<div class="player-volume-rail">' +
              '<span class="player-volume-fill" id="player-volume-fill"></span>' +
              '<span class="player-volume-thumb" id="player-volume-thumb"></span>' +
            '</div>' +
          '</div>' +
          '<button class="pbtn pbtn-volume" type="button" data-paction="mute" id="player-mute" aria-label="静音">' + icon('volume') + '</button>' +
        '</div>' +

        '<div class="player-bottom">' +
          /* 左下角菜单组：线路 / 清晰度 / 倍速 / 字幕 / 选集 / 横竖屏。 */
          '<div class="player-menu" id="player-menu">' +
            '<button class="pbtn pbtn-label pbtn-line" type="button" data-paction="line" id="player-line" aria-label="切换线路">' + icon('line') + '<span>线路</span></button>' +
            '<button class="pbtn pbtn-label" type="button" data-paction="quality" id="player-quality" aria-label="清晰度">' + escapeHtml(quality) + '</button>' +
            '<button class="pbtn pbtn-label" type="button" data-paction="speed" id="player-speed" aria-label="倍速">' + escapeHtml(formatRate(initialRate)) + '</button>' +
            (subtitles.length ? '<button class="pbtn pbtn-menu-icon" type="button" data-paction="cc" id="player-cc" aria-label="字幕">' + icon('cc') + '</button>' : '') +
            (item.episodes && item.episodes.length ? '<button class="pbtn pbtn-menu-icon" type="button" data-paction="episodes" aria-label="选集">' + icon('list') + '</button>' : '') +
            '<button class="pbtn pbtn-menu-icon pbtn-display" type="button" data-paction="display" id="player-rotate" aria-label="横屏播放" aria-pressed="false">' + icon('rotate') + '</button>' +
          '</div>' +
          /* 底部横向进度条：左当前时间，右剩余时长。 */
          '<div class="player-scrub-row">' +
            '<span class="player-time" id="player-current">0:00</span>' +
            '<input class="player-scrub" id="player-scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">' +
            '<span class="player-time" id="player-duration">-0:00</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      (item.episodes && item.episodes.length
        ? '<div class="player-drawer" id="player-drawer" hidden>' +
            '<button class="player-drawer-scrim" type="button" data-paction="close-episodes" aria-label="关闭选集" tabindex="-1"></button>' +
            '<aside class="player-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="player-drawer-title">' +
              '<div class="player-drawer-head">' +
                '<div class="player-drawer-heading">' +
                  '<h2 class="player-drawer-title" id="player-drawer-title">选集</h2>' +
                  '<p class="player-drawer-meta">共 ' + item.episodes.length + ' 集</p>' +
                '</div>' +
                '<button class="pbtn player-drawer-close" type="button" data-paction="close-episodes" aria-label="关闭">' + icon('close') + '</button>' +
              '</div>' +
              '<div class="player-episode-list" id="player-episode-list">' +
                item.episodes.map((entry, index) => {
                  const active = Boolean(episode && entry.id === episode.id);
                  const label = formatEpisodeLabel(entry) || ('第 ' + (index + 1) + ' 集');
                  return '<button class="player-episode' + (active ? ' is-current' : '') + '" type="button" data-episode-id="' + escapeHtml(entry.id) + '"' +
                    (active ? ' aria-current="true"' : '') + '>' +
                    '<span class="player-episode-index">' + (index + 1) + '</span>' +
                    '<span class="player-episode-label">' + escapeHtml(label) + '</span>' +
                    (active ? '<span class="player-episode-now">正在播放</span>' : '') +
                  '</button>';
                }).join('') +
              '</div>' +
            '</aside>' +
          '</div>'
        : '') +

      '<div class="player-toast" id="player-toast" role="status" aria-live="polite"></div>' +
    '</div>' +
    '</div>';
}

export function mountPlayer(item, episode) {
  const embed = embedFor(item, episode);
  if (embed) return mountEmbedPlayer(item, episode);

  const page = document.getElementById('player-page');
  if (!page) return () => {};

  const stage = document.getElementById('player-stage');
  const video = document.getElementById('player-video');
  const overlay = document.getElementById('player-overlay');
  const playButton = document.getElementById('player-play');
  const scrub = document.getElementById('player-scrub');
  const currentLabel = document.getElementById('player-current');
  const durationLabel = document.getElementById('player-duration');
  const qualityButton = document.getElementById('player-quality');
  const speedButton = document.getElementById('player-speed');
  const lineButton = document.getElementById('player-line');
  const castButton = document.getElementById('player-cast');
  const muteButton = document.getElementById('player-mute');
  const displayButton = document.getElementById('player-rotate');
  const volumeTrack = document.getElementById('player-volume-track');
  const volumeFill = document.getElementById('player-volume-fill');
  const volumeThumb = document.getElementById('player-volume-thumb');
  const buffering = document.getElementById('player-buffering');
  const errorBox = document.getElementById('player-error');
  const errorText = document.getElementById('player-error-text');
  const playerToast = document.getElementById('player-toast');
  const ccButton = document.getElementById('player-cc');

  if (!stage || !video || !overlay) return () => {};

  const sources = sourcesFor(item, episode);
  const subtitles = subtitlesFor(item, episode);
  const controller = new AbortController();
  const signal = controller.signal;

  const startRecord = getProgress(item.id, episode ? episode.id : null);
  const initialRate = state.settings.defaultRate;
  const statusBarMeta = document.getElementById('meta-status-bar');
  const previousStatusBar = statusBarMeta ? statusBarMeta.getAttribute('content') : null;
  const themeMeta = document.getElementById('meta-theme-color');
  const previousThemeColor = themeMeta ? themeMeta.getAttribute('content') : null;
  /* 播放页始终黑底：状态栏跟随播放器，离开时恢复。 */
  if (statusBarMeta) statusBarMeta.setAttribute('content', 'black-translucent');
  if (themeMeta) themeMeta.setAttribute('content', '#000');

  let sourceIndex = 0;
  let currentSource = sources[0] || null;
  let hideTimer = null;
  let toastTimer = null;
  let nextTimer = null;
  let lastSavedAt = 0;
  let cleaned = false;
  let resumeApplied = false;
  let forcedLandscape = false;
  let drawerOpen = false;
  let drawerTimer = null;
  let mediaSessionCleanup = null;
  let hls = null;
  let attachSeq = 0;
  let hlsFallbackTried = false;
  let proxyFallbackTried = false;
  let expectingMedia = false;
  let volumeLevel = 1;
  let draggingVolume = false;
  let wasLandscapeViewport = isLandscapeViewport();

  function destroyHls() {
    if (!hls) return;
    try {
      hls.destroy();
    } catch (error) {
      /* 忽略。 */
    }
    hls = null;
  }

  function hlsFatalMessage(Hls, data) {
    const details = String((data && data.details) || '');

    if (data && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (details === 'manifestParsingError') {
        return '这个线路返回的不是有效的 HLS 清单（常见于网页解析线路）。请换一个线路。';
      }
      if (details === 'manifestLoadError' || details === 'manifestLoadTimeOut') {
        return 'HLS 清单加载失败：源站可能限制跨域、需要防盗链，或链接已失效。可尝试在源管理开启“HLS 分片走代理”，或换一个线路。';
      }
      if (details === 'fragLoadError' || details === 'fragLoadTimeOut') {
        return 'HLS 分片加载失败：源站可能限制跨域或防盗链。可尝试开启“HLS 分片走代理”，或换一个线路。';
      }
      return 'HLS 网络加载失败。请稍后重试或换一个线路。';
    }

    if (data && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      if (details === 'bufferAddCodecError' || details === 'manifestIncompatibleCodecsError') {
        return '这个线路的视频编码浏览器不支持（常见于 H.265/HEVC）。请换一个线路，或用 iPhone/iPad 的 Safari 打开。';
      }
      return 'HLS 解码失败，请换一个线路。';
    }

    return 'HLS 播放失败，请稍后重试或换一个线路。';
  }

  /* 直连与代理确实是两个不同地址时，才值得重试。 */
  function proxyFallbackUrl(source) {
    if (!source || !source.proxySrc) return '';
    const direct = resolveSourceUrl(source.src);
    const proxy = resolveSourceUrl(source.proxySrc);
    return proxy && proxy !== direct ? proxy : '';
  }

  /* 直连被跨域 / 防盗链挡住时，自动改用签名代理；只重试一次。 */
  function retryWithProxy() {
    if (proxyFallbackTried || !proxyFallbackUrl(currentSource)) return false;
    proxyFallbackTried = true;
    const seekTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    showToast('直连不稳定，改用代理线路…', 2400);
    attachCurrentSource({ useProxy: true, seekTime, autoplay: true }).catch(() => {});
    return true;
  }

  /* HLS 装载统一入口；失败时自己给出提示并返回 false。 */
  async function attachHlsSource(src, seq) {
    let Hls = null;
    try {
      Hls = await loadHls();
    } catch (error) {
      if (seq !== attachSeq) return false;
      hideBuffering();
      showError('hls.js 加载失败，无法播放 HLS。请检查网络后重试。');
      return false;
    }

    if (seq !== attachSeq) return false;

    if (!Hls || !Hls.isSupported()) {
      hideBuffering();
      showError('当前浏览器无法播放 HLS。请换一个线路，或改用 Safari / 系统播放器打开。');
      return false;
    }

    hls = new Hls({ enableWorker: true });
    expectingMedia = true;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (seq !== attachSeq || !hls) return;
      hls.loadSource(src);
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (seq !== attachSeq || !hls || !data || !data.fatal) return;
      /* 直连失败（跨域 / 防盗链）时自动退回签名代理，只重试一次。 */
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryWithProxy()) return;
      showError(hlsFatalMessage(Hls, data));
    });

    return true;
  }

  /*
   * 直链报“格式不支持”时再判断一次：
   * 没有扩展名的地址可能其实是 HLS；返回 text/html/JSON 则是网页解析线路。
   */
  async function handleUnsupportedSource(url, code) {
    const seq = attachSeq;
    expectingMedia = false;
    const info = await probeSource(url);
    if (seq !== attachSeq) return;

    const type = info ? String(info.type || '') : '';
    const ambiguous = !info || !type || /octet-stream/i.test(type);
    const hlsHint = isHlsContentType(type) || (ambiguous && !isStaticVideoUrl(url));

    if (hlsHint) {
      showBuffering();
      await attachHlsSource(url, seq);
      return;
    }

    hideBuffering();
    showError(mediaErrorMessage(code, url, info) + '（错误 ' + code + '）');
  }

  /*
   * 按当前 currentSource 装载媒体：MP4 直链、Safari 原生 HLS、其他浏览器 hls.js。
   * ready 回调只触发一次，供切源时恢复进度。
   */
  async function attachCurrentSource(options = {}) {
    const seq = ++attachSeq;
    const source = currentSource;
    if (!source) return;

    destroyHls();
    hideError();
    showBuffering();
    hlsFallbackTried = false;
    if (!options.useProxy) proxyFallbackTried = false;
    expectingMedia = false;

    try {
      video.removeAttribute('src');
      video.load();
    } catch (error) {
      /* 忽略。 */
    }

    /*
     * 默认直连 HTTPS（分片不再逐个穿过函数，播放明显更快）。
     * 只有用户开启「HLS 分片走代理」，或直连失败后自动重试时才用 proxySrc。
     */
    const useProxy = Boolean(options.useProxy) || Boolean(state.settings && state.settings.hlsProxySegments);
    const chosen = useProxy && source.proxySrc ? source.proxySrc : source.src;
    const src = resolveSourceUrl(chosen, { forceSegProxy: useProxy });
    const rate = Number(options.rate) || video.playbackRate || initialRate;
    const seekTime = Number(options.seekTime) || 0;
    const autoplay = Boolean(options.autoplay);

    const applyReady = () => {
      if (seq !== attachSeq) return;
      hideBuffering();
      video.playbackRate = rate;
      if (seekTime > 1) {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = duration > 0 ? Math.min(seekTime, duration - 0.5) : seekTime;
      }
      updateQualityLabel();
      updateSpeedLabel();
      updateProgressUI();
      if (typeof options.onReady === 'function') options.onReady();
      if (autoplay) video.play().catch(() => {});
    };

    video.addEventListener('loadedmetadata', applyReady, { once: true, signal });

    if (looksLikeHls(source)) {
      const nativeHls = video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl');
      if (nativeHls) {
        expectingMedia = true;
        video.src = src;
        video.load();
        return;
      }

      await attachHlsSource(src, seq);
      return;
    }

    expectingMedia = true;
    video.src = src;
    video.load();
  }

  if (sources.length > 1) {
    try {
      const savedQuality = localStorage.getItem('ah-quality');
      const savedIndex = sources.findIndex((source) => qualityOf(source) === savedQuality);
      if (savedIndex >= 0) sourceIndex = savedIndex;
    } catch (error) {
      /* 忽略。 */
    }
  }

  currentSource = sources[sourceIndex] || null;

  function showToast(message, timeout = 1800) {
    if (!playerToast) return;
    playerToast.textContent = String(message || '');
    playerToast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      playerToast.classList.remove('is-visible');
      toastTimer = null;
    }, timeout);
  }

  function showBuffering() {
    if (buffering) buffering.hidden = false;
    stage.classList.add('is-buffering');
  }

  function hideBuffering() {
    if (buffering) buffering.hidden = true;
    stage.classList.remove('is-buffering');
  }

  function showError(message) {
    hideBuffering();
    if (errorText) errorText.textContent = message;
    if (errorBox) errorBox.hidden = false;
  }

  function hideError() {
    if (errorBox) errorBox.hidden = true;
  }

  function showControls(autoHide = true) {
    overlay.classList.remove('is-hidden');
    stage.classList.remove('is-idle');
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (autoHide && !video.paused && !video.ended) {
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        hideControls();
      }, 3000);
    }
  }

  function hideControls() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    overlay.classList.add('is-hidden');
    stage.classList.add('is-idle');
  }

  function toggleControls() {
    if (overlay.classList.contains('is-hidden')) showControls();
    else hideControls();
  }

  function updatePlayButton() {
    const playing = !video.paused && !video.ended;
    if (playButton) {
      playButton.innerHTML = icon(playing ? 'pause' : 'play');
      playButton.classList.toggle('is-playing', playing);
      playButton.setAttribute('aria-label', playing ? '暂停' : '播放');
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      } catch (error) {
        /* 忽略。 */
      }
    }
  }

  function updateProgressUI() {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const percent = duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;

    if (currentLabel) currentLabel.textContent = formatTime(time);
    if (durationLabel) durationLabel.textContent = formatRemaining(duration - time);
    if (scrub) {
      scrub.value = String(Math.round(percent * 10));
      scrub.style.setProperty('--progress', percent.toFixed(2) + '%');
      scrub.setAttribute('aria-valuetext', formatTime(time) + ' / ' + formatTime(duration));
      scrub.disabled = duration <= 0;
    }

    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function' && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: video.playbackRate || 1,
          position: Math.min(time, duration)
        });
      } catch (error) {
        /* 某些浏览器不支持或状态被拒绝。 */
      }
    }
  }

  function saveNow(completed = false) {
    if (!video || !Number.isFinite(video.currentTime)) return;
    if (video.currentTime < 1) return;

    saveProgress({
      itemId: item.id,
      episodeId: episode ? episode.id : null,
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      completed
    }).catch(() => {
      /* 存储失败不打断播放。 */
    });

    lastSavedAt = Date.now();
  }

  function togglePlay() {
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          showToast('无法开始播放，请再点一次');
        });
      }
    } else {
      video.pause();
    }
  }

  function seekBy(delta) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    let next = video.currentTime + delta;
    next = Math.max(0, next);
    if (duration > 0) next = Math.min(duration, next);
    video.currentTime = next;
    updateProgressUI();
    showToast(delta < 0 ? '已后退 10 秒' : '已前进 10 秒', 1200);
  }

  /* 音量条是自绘的：iOS 不允许网页控制媒体音量，界面仍按用户拖动显示。 */
  function updateVolumeUI() {
    const level = video.muted ? 0 : volumeLevel;
    const percent = Math.max(0, Math.min(100, Math.round(level * 100)));
    if (volumeFill) volumeFill.style.height = percent + '%';
    if (volumeThumb) volumeThumb.style.bottom = percent + '%';
    if (volumeTrack) {
      volumeTrack.setAttribute('aria-valuenow', String(percent));
      volumeTrack.setAttribute('aria-valuetext', percent + '%');
    }
  }

  function updateMuteButton() {
    if (muteButton) {
      muteButton.innerHTML = icon(video.muted || volumeLevel <= 0 ? 'volumeMute' : 'volume');
      muteButton.setAttribute('aria-label', video.muted ? '取消静音' : '静音');
      muteButton.classList.toggle('is-active', video.muted || volumeLevel <= 0);
    }
    updateVolumeUI();
  }

  function setVolume(level) {
    const next = Math.max(0, Math.min(1, level));
    volumeLevel = next;
    try {
      video.volume = next;
    } catch (error) {
      /* iOS 会忽略音量写入，界面照样更新。 */
    }
    video.muted = next === 0;
    updateMuteButton();
  }

  function volumeLevelFromEvent(event) {
    if (!volumeTrack) return volumeLevel;
    const rect = volumeTrack.getBoundingClientRect();
    if (!rect.height) return volumeLevel;
    return Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height));
  }

  function onVolumePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    draggingVolume = true;
    showControls(false);
    try {
      volumeTrack.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 合成事件没有真实 pointerId。 */
    }
    setVolume(volumeLevelFromEvent(event));
    event.preventDefault();
  }

  function onVolumePointerMove(event) {
    if (!draggingVolume) return;
    setVolume(volumeLevelFromEvent(event));
    event.preventDefault();
  }

  function onVolumePointerUp() {
    if (!draggingVolume) return;
    draggingVolume = false;
    showControls();
    showToast('音量 ' + Math.round(volumeLevel * 100) + '%', 1000);
  }

  function onVolumeKeydown(event) {
    const handled = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'];
    if (!handled.includes(event.key)) return;
    /* 阻止冒泡到播放器的全局快捷键，否则一次按键会调整两次音量。 */
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      setVolume(volumeLevel + 0.05);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      setVolume(volumeLevel - 0.05);
    } else if (event.key === 'Home') {
      setVolume(0);
    } else {
      setVolume(1);
    }
  }

  function onVolumeChange() {
    /* iOS 的 volume 恒为 1，不能拿它覆盖用户拖出来的界面值。 */
    if (!draggingVolume && !isIOS() && !video.muted) {
      volumeLevel = Number.isFinite(video.volume) ? video.volume : volumeLevel;
    }
    updateMuteButton();
  }

  function updateSpeedLabel() {
    if (speedButton) speedButton.textContent = formatRate(video.playbackRate || initialRate);
  }

  function updateQualityLabel() {
    if (qualityButton && currentSource) qualityButton.textContent = qualityOf(currentSource);
  }

  function isNativeFullscreen() {
    return Boolean(video.webkitDisplayingFullscreen);
  }

  /*
   * 一个按钮管「横屏 / 全屏」：
   * 竖屏时先转横屏；已经是横屏就进全屏；全屏或强制横屏时再点则退出。
   * 这样不会再出现旋转和全屏两个按钮挤在一起、功能重复的问题。
   */
  function updateDisplayButton() {
    if (!displayButton) return;
    const fullscreenActive = Boolean(document.fullscreenElement) || isNativeFullscreen();
    const active = fullscreenActive || forcedLandscape;
    let iconName = 'rotate';
    let label = '横屏播放';

    if (fullscreenActive) {
      iconName = 'exitFullscreen';
      label = '退出全屏';
    } else if (forcedLandscape) {
      iconName = 'rotate';
      label = '恢复竖屏';
    } else if (isLandscapeViewport()) {
      iconName = 'fullscreen';
      label = '全屏';
    }

    displayButton.innerHTML = icon(iconName);
    displayButton.classList.toggle('is-active', active);
    displayButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    displayButton.setAttribute('aria-label', label);
  }

  function toggleDisplayMode() {
    /* 强制横屏时一次点击同时退出全屏和旋转，避免剩一个“看不见的横屏”。 */
    if (forcedLandscape) {
      exitAutoFullscreen();
      setForcedLandscape(false);
      return;
    }
    if (isNativeFullscreen()) {
      exitNativeFullscreen();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (!isLandscapeViewport()) {
      /* 切到横屏的同时进入全屏；桌面/安卓可用，iOS 会自动退回 CSS 横屏。 */
      setForcedLandscape(true);
      return;
    }
    toggleFullscreen();
  }

  function toggleMute() {
    if (video.muted || volumeLevel <= 0) {
      if (volumeLevel <= 0) volumeLevel = 1;
      try {
        video.volume = volumeLevel;
      } catch (error) {
        /* 忽略。 */
      }
      video.muted = false;
      updateMuteButton();
      showToast('已取消静音');
      return;
    }
    video.muted = true;
    updateMuteButton();
    showToast('已静音');
  }

  function exitNativeFullscreen() {
    if (!isNativeFullscreen()) return;
    try {
      video.webkitExitFullscreen();
    } catch (error) {
      /* 忽略。 */
    }
  }

  /*
   * iOS 只允许视频原生全屏（能隐藏状态栏，但使用系统控件）；
   * 其他浏览器让整页进入全屏，保留自定义横屏布局，避免全屏后变成竖屏。
   */
  function fallbackNativeFullscreen() {
    if (typeof video.webkitEnterFullscreen !== 'function') {
      showToast('当前浏览器不支持全屏');
      return;
    }

    /* 不再限制必须在物理横屏时才允许全屏，避免横屏下按钮点了没反应。 */
    try {
      video.webkitEnterFullscreen();
      showControls();
    } catch (error) {
      showToast('当前浏览器不支持全屏');
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }

    if (isNativeFullscreen()) {
      exitNativeFullscreen();
      return;
    }

    /* iPhone / iPad 的网页全屏藏不掉状态栏，只有原生视频全屏可以。 */
    if (isIOS() && typeof video.webkitEnterFullscreen === 'function') {
      fallbackNativeFullscreen();
      return;
    }

    if (typeof document.documentElement.requestFullscreen === 'function') {
      /* 全屏根元素，dialog-root 里的线路 / 倍速浮卡在全屏中依然可见。 */
      const request = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      Promise.resolve(request).catch(fallbackNativeFullscreen);
      return;
    }

    fallbackNativeFullscreen();
  }

  /* 投屏：优先 Remote Playback，iOS 退回 AirPlay 选择器。 */
  function openCast() {
    showControls();
    if (video.remote && typeof video.remote.prompt === 'function') {
      try {
        Promise.resolve(video.remote.prompt()).catch(() => {
          showToast('没有找到可投屏的设备');
        });
        return;
      } catch (error) {
        /* 个别浏览器会同步抛错，继续尝试 iOS 的 AirPlay。 */
      }
    }
    if (isIOS() && typeof video.webkitShowPlaybackTargetPicker === 'function') {
      try {
        video.webkitShowPlaybackTargetPicker();
        return;
      } catch (error) {
        /* 继续给提示。 */
      }
    }
    showToast('当前设备不支持投屏');
  }

  function isLandscapeViewport() {
    if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
    return window.innerWidth > window.innerHeight;
  }

  function setStatusBar(style) {
    if (statusBarMeta) statusBarMeta.setAttribute('content', style);
  }

  /* 横屏全屏时用透明状态栏；回到竖屏恢复原生黑底状态栏。 */
  function updateOrientationState() {
    const landscape = isLandscapeViewport();
    page.classList.toggle('is-landscape-viewport', landscape);
    const immersive = landscape || forcedLandscape || Boolean(document.fullscreenElement);
    setStatusBar(immersive ? 'black-translucent' : 'black');
    updateDisplayButton();
  }

  /*
   * 切到横屏时尝试进入全屏。浏览器通常要求用户手势，
   * 旋转手机触发的 resize 可能被拒绝，失败就静默保持 CSS 横屏。
   */
  function requestAutoFullscreen() {
    if (isIOS()) return;
    if (document.fullscreenElement || isNativeFullscreen()) return;
    if (typeof document.documentElement.requestFullscreen !== 'function') return;

    const request = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    Promise.resolve(request).then(() => {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }).catch(() => {});
  }

  function exitAutoFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (error) {
      /* 忽略。 */
    }
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      try {
        screen.orientation.unlock();
      } catch (error) {
        /* 未锁定过会抛错。 */
      }
    }
  }

  function setForcedLandscape(next, options) {
    const opts = options || {};
    const enabled = Boolean(next) && !isLandscapeViewport();
    forcedLandscape = enabled;
    page.classList.toggle('is-landscape', enabled);
    /* 选集等弹层在 dialog-root 里，需要跟着一起转，才能和画面方向一致。 */
    document.body.classList.toggle('player-forced-landscape', enabled);
    updateOrientationState();

    if (enabled) requestAutoFullscreen();
    else if (!opts.keepFullscreen) exitAutoFullscreen();

    if (opts.toast !== false) {
      showToast(enabled ? '横屏播放，向左转手机观看' : '已恢复竖屏');
    }
    if (opts.controls !== false) showControls();
  }

  function toggleForcedLandscape() {
    if (forcedLandscape) {
      setForcedLandscape(false);
      return;
    }

    if (isLandscapeViewport()) {
      showToast('当前已经是横屏');
      showControls();
      return;
    }

    setForcedLandscape(true);
  }

  function onViewportResize() {
    const landscape = isLandscapeViewport();

    if (forcedLandscape && landscape) {
      /* 手机真的转到横屏了，撤掉 CSS 旋转，改用原生横屏；
         不退出刚进入的全屏，否则自动全屏会被立刻撤销。 */
      setForcedLandscape(false, { toast: false, keepFullscreen: true });
      showToast('已切换为横屏', 1400);
    } else if (landscape && !wasLandscapeViewport) {
      /* 物理转到横屏：尽量进入全屏（没有用户手势时浏览器会拒绝）。 */
      requestAutoFullscreen();
      setStatusBar('black-translucent');
    } else if (!landscape && wasLandscapeViewport) {
      exitAutoFullscreen();
      setStatusBar('black');
    }

    wasLandscapeViewport = landscape;
    updateOrientationState();
  }

  /* 新进入播放页时清掉上一次的横屏 / 全屏状态，避免沿用上次的朝向。 */
  function resetOrientation() {
    forcedLandscape = false;
    page.classList.remove('is-landscape');
    page.classList.remove('is-landscape-viewport');
    document.body.classList.remove('player-forced-landscape');
    exitAutoFullscreen();
    wasLandscapeViewport = isLandscapeViewport();
    updateOrientationState();

    if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
      try {
        video.webkitExitFullscreen();
      } catch (error) {
        /* 忽略。 */
      }
    }
  }

  async function openLines() {
    if (!sources.length) {
      showToast('没有可用线路');
      return;
    }

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    const value = await openSheet({
      title: '线路',
      className: 'sheet-side',
      value: String(sourceIndex),
      options: sources.map((source, index) => ({
        value: String(index),
        label: '线路 ' + (index + 1) + ' · ' + (source.label || qualityOf(source))
      }))
    });

    showControls();

    if (value === null) return;
    const nextIndex = Number(value);
    if (!Number.isInteger(nextIndex) || nextIndex === sourceIndex) return;
    switchSource(nextIndex);
  }

  async function openQuality() {
    if (!sources.length) {
      showToast('没有可用片源');
      return;
    }

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    const qualities = [];
    sources.forEach((source) => {
      const quality = qualityOf(source);
      if (!qualities.includes(quality)) qualities.push(quality);
    });

    const currentQuality = currentSource ? qualityOf(currentSource) : (qualities[0] || '');
    const value = await openSheet({
      title: '清晰度',
      className: 'sheet-side',
      value: currentQuality,
      options: qualities.map((quality) => ({
        value: quality,
        label: quality
      }))
    });

    showControls();

    if (value === null || value === currentQuality) return;
    const nextIndex = sources.findIndex((source) => qualityOf(source) === value);
    if (nextIndex >= 0) switchSource(nextIndex);
  }

  async function openSpeed() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    const current = String(video.playbackRate || initialRate);
    const value = await openSheet({
      title: '倍速',
      className: 'sheet-side',
      value: current,
      options: SPEEDS.map((speed) => ({
        value: String(speed),
        label: formatRate(speed)
      }))
    });

    showControls();

    if (value === null) return;
    const rate = Number(value);
    if (!Number.isFinite(rate)) return;
    video.playbackRate = rate;
    updateSpeedLabel();
    showToast('已切换到 ' + formatRate(rate));
  }

  /* 选集从右侧滑出：竖向排列，当前集尽量滚到列表中间。 */
  function centerCurrentEpisode() {
    const drawer = document.getElementById('player-drawer');
    if (!drawer) return;
    const list = drawer.querySelector('.player-episode-list');
    if (!list) return;

    const current = list.querySelector('.player-episode.is-current');
    if (!current) {
      list.scrollTop = 0;
      return;
    }

    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    /* 前面的集数不够时 target 为负，钳到 0，自然从顶部开始。 */
    const target = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
    list.scrollTop = Math.max(0, Math.min(max, target));
  }

  function openEpisodes() {
    if (!item.episodes || !item.episodes.length) return;

    const drawer = document.getElementById('player-drawer');
    if (!drawer) return;

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (drawerTimer) {
      clearTimeout(drawerTimer);
      drawerTimer = null;
    }

    drawerOpen = true;
    drawer.hidden = false;
    /* 先让浏览器完成一帧布局，再打开过渡类，滑入动画才会生效。 */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!drawerOpen) return;
        drawer.classList.add('is-open');
        centerCurrentEpisode();
      });
    });
  }

  function closeEpisodes() {
    const drawer = document.getElementById('player-drawer');
    if (!drawer || !drawerOpen) return;

    drawerOpen = false;
    drawer.classList.remove('is-open');
    if (drawerTimer) clearTimeout(drawerTimer);
    drawerTimer = window.setTimeout(() => {
      drawerTimer = null;
      if (!drawerOpen) drawer.hidden = true;
    }, 280);
    showControls();
  }

  function selectEpisode(nextId) {
    if (!nextId) return;
    closeEpisodes();
    if (episode && nextId === episode.id) return;
    /* 选集替换当前历史记录，返回键才能回到简介，而不是上一集。 */
    pendingLandscape = forcedLandscape;
    navigate('/watch/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(nextId), {
      replace: true
    });
  }

  function switchSource(nextIndex) {
    if (nextIndex < 0 || nextIndex >= sources.length) return;

    const wasPlaying = !video.paused && !video.ended;
    const previousTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const rate = video.playbackRate || initialRate;

    sourceIndex = nextIndex;
    currentSource = sources[nextIndex];

    attachCurrentSource({
      seekTime: previousTime,
      rate,
      autoplay: wasPlaying,
      onReady() {
        showToast('已切换到 ' + qualityOf(currentSource));
      }
    }).catch(() => {});

    try {
      localStorage.setItem('ah-quality', qualityOf(currentSource));
    } catch (error) {
      /* 忽略。 */
    }
  }

  function toggleCC() {
    const tracks = Array.from(video.textTracks || []).filter((track) => track.kind === 'subtitles' || track.kind === 'captions');
    if (!tracks.length) {
      showToast('当前影片没有字幕');
      return;
    }

    const showing = tracks.some((track) => track.mode === 'showing');
    tracks.forEach((track, index) => {
      track.mode = showing ? 'disabled' : (index === 0 ? 'showing' : 'disabled');
    });

    if (ccButton) {
      ccButton.classList.toggle('is-active', !showing);
      ccButton.setAttribute('aria-label', showing ? '开启字幕' : '关闭字幕');
    }

    showToast(showing ? '字幕已关闭' : '字幕已开启');
  }

  function retry() {
    if (!currentSource) return;
    hideError();
    hideBuffering();
    attachCurrentSource({
      seekTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      autoplay: true
    }).catch(() => {});
  }

  function goBack() {
    saveNow(video.ended);

    if (history.length > 1) {
      history.back();
      return;
    }

    location.hash = '#/title/' + encodeURIComponent(item.id);
  }

  function onPageClick(event) {
    const episodeButton = event.target.closest('[data-episode-id]');
    if (episodeButton) {
      event.preventDefault();
      selectEpisode(episodeButton.getAttribute('data-episode-id'));
      return;
    }

    const actionButton = event.target.closest('[data-paction]');
    if (actionButton) {
      event.preventDefault();
      const action = actionButton.getAttribute('data-paction');

      if (action === 'back') goBack();
      else if (action === 'toggle') togglePlay();
      else if (action === 'rewind') seekBy(-10);
      else if (action === 'forward') seekBy(10);
      else if (action === 'line') openLines();
      else if (action === 'quality') openQuality();
      else if (action === 'speed') openSpeed();
      else if (action === 'episodes') openEpisodes();
      else if (action === 'close-episodes') closeEpisodes();
      else if (action === 'cc') toggleCC();
      else if (action === 'mute') toggleMute();
      else if (action === 'cast') openCast();
      else if (action === 'display') toggleDisplayMode();
      else if (action === 'rotate') toggleForcedLandscape();
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'retry') retry();
      return;
    }

    if (event.target.closest('.player-error')) return;

    if (event.target.closest('.player-volume, .player-drawer, .pbtn, input, button, .sheet, .dialog')) return;

    toggleControls();
  }

  function onKeydown(event) {
    const target = event.target;
    if (target && target.closest && target.closest('input, textarea, select')) return;

    if (drawerOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEpisodes();
      }
      return;
    }

    const dialogRoot = document.getElementById('dialog-root');
    if (dialogRoot && dialogRoot.childElementCount) return;

    if (event.code === 'Space' && target && target.closest && target.closest('button, a, [role="button"]')) {
      return;
    }

    if (event.code === 'Space' || event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(-10);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekBy(10);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setVolume(volumeLevel + 0.1);
      showToast('音量 ' + Math.round(volumeLevel * 100) + '%');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setVolume(volumeLevel - 0.1);
      showToast('音量 ' + Math.round(volumeLevel * 100) + '%');
    } else if (event.key === 'f' || event.key === 'F') {
      toggleFullscreen();
    } else if (event.key === 'r' || event.key === 'R') {
      toggleForcedLandscape();
    } else if (event.key === 'm' || event.key === 'M') {
      toggleMute();
    } else if (event.key === 'Escape') {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  function onVisibilityChange() {
    if (document.hidden) saveNow(video.ended);
  }

  function onPageHide() {
    saveNow(video.ended);
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      const poster = safeAssetUrl(item.poster);
      const artworkSrc = poster ? new URL(poster, location.href).href : new URL('./icons/icon-512.png', location.href).href;
      const artworkType = /\.svg(\?|$)/i.test(artworkSrc) ? 'image/svg+xml' : 'image/png';

      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.title,
          artist: 'AH 影视',
          album: episode ? formatEpisodeLabel(episode) : (item.originalTitle || ''),
          artwork: [{ src: artworkSrc, sizes: '512x512', type: artworkType }]
        });
      }

      const handlers = {
        play: () => video.play().catch(() => {}),
        pause: () => video.pause(),
        seekbackward: (details) => seekBy(-(details && details.seekOffset ? details.seekOffset : 10)),
        seekforward: (details) => seekBy(details && details.seekOffset ? details.seekOffset : 10),
        seekto: (details) => {
          if (details && Number.isFinite(details.seekTime)) video.currentTime = details.seekTime;
        }
      };

      Object.entries(handlers).forEach(([action, handler]) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
          /* 该浏览器不支持这个 action。 */
        }
      });

      mediaSessionCleanup = () => {
        Object.keys(handlers).forEach((action) => {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch (error) {
            /* 忽略。 */
          }
        });
        try {
          navigator.mediaSession.metadata = null;
        } catch (error) {
          /* 忽略。 */
        }
      };
    } catch (error) {
      /* 忽略。 */
    }
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;

    saveNow(video.ended);
    destroyHls();
    attachSeq += 1;
    expectingMedia = false;
    try {
      video.pause();
    } catch (error) {
      /* 忽略。 */
    }
    try {
      video.removeAttribute('src');
      video.load();
    } catch (error) {
      /* 忽略。 */
    }

    if (hideTimer) clearTimeout(hideTimer);
    if (toastTimer) clearTimeout(toastTimer);
    if (nextTimer) clearTimeout(nextTimer);
    if (drawerTimer) clearTimeout(drawerTimer);
    drawerOpen = false;

    draggingVolume = false;
    exitAutoFullscreen();
    exitNativeFullscreen();

    if (mediaSessionCleanup) mediaSessionCleanup();
    if (statusBarMeta) {
      if (previousStatusBar === null) statusBarMeta.removeAttribute('content');
      else statusBarMeta.setAttribute('content', previousStatusBar);
    }
    if (themeMeta) {
      if (previousThemeColor === null) themeMeta.removeAttribute('content');
      else themeMeta.setAttribute('content', previousThemeColor);
    }
    page.classList.remove('is-landscape');
    page.classList.remove('is-landscape-viewport');
    document.body.classList.remove('player-forced-landscape');
    controller.abort();
  }

  page.addEventListener('click', onPageClick, { signal });
  document.addEventListener('keydown', onKeydown, { signal });
  document.addEventListener('visibilitychange', onVisibilityChange, { signal });
  window.addEventListener('pagehide', onPageHide, { signal });
  window.addEventListener('resize', onViewportResize, { signal });
  document.addEventListener('fullscreenchange', updateOrientationState, { signal });
  document.addEventListener('webkitfullscreenchange', updateOrientationState, { signal });

  const keepLandscape = pendingLandscape;
  pendingLandscape = null;
  resetOrientation();
  if (keepLandscape) setForcedLandscape(true, { toast: false, controls: false });

  video.addEventListener('webkitbeginfullscreen', updateDisplayButton, { signal });
  video.addEventListener('webkitendfullscreen', updateDisplayButton, { signal });

  video.addEventListener('loadedmetadata', () => {
    hideBuffering();
    hideError();
    video.playbackRate = video.playbackRate && video.playbackRate !== 1 ? video.playbackRate : initialRate;
    updateMuteButton();
    updateSpeedLabel();
    updateQualityLabel();
    updateProgressUI();

    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    if (!resumeApplied) {
      resumeApplied = true;

      if (startRecord && !startRecord.completed && startRecord.time > 5) {
        if (duration <= 0 || startRecord.time < duration - 5) {
          video.currentTime = startRecord.time;
          showToast('已从上次位置继续', 2400);
        }
      } else if (startRecord && startRecord.completed) {
        showToast('上次已看完，从头播放', 2400);
      }
    }

    updateProgressUI();
  }, { signal });

  video.addEventListener('play', () => {
    updatePlayButton();
    showControls();
    hideBuffering();
  }, { signal });

  video.addEventListener('pause', () => {
    updatePlayButton();
    showControls(false);
    saveNow(video.ended);
  }, { signal });

  video.addEventListener('playing', () => {
    hideBuffering();
    updatePlayButton();
    showControls();
  }, { signal });

  video.addEventListener('waiting', () => {
    if (!video.paused) showBuffering();
  }, { signal });

  video.addEventListener('canplay', hideBuffering, { signal });

  video.addEventListener('timeupdate', () => {
    updateProgressUI();
    if (!video.paused && Date.now() - lastSavedAt > 5000) {
      saveNow(false);
    }
  }, { signal });

  video.addEventListener('seeked', () => {
    updateProgressUI();
    if (video.paused) saveNow(video.ended);
  }, { signal });

  video.addEventListener('volumechange', onVolumeChange, { signal });
  video.addEventListener('ratechange', updateSpeedLabel, { signal });

  video.addEventListener('ended', () => {
    updatePlayButton();
    showControls(false);
    saveNow(true);

    const index = episode ? item.episodes.findIndex((entry) => entry.id === episode.id) : -1;
    const next = index >= 0 && item.episodes ? item.episodes[index + 1] : null;

    if (next && state.settings.autoplayNext) {
      showToast('即将播放下一集…', 1400);
      nextTimer = window.setTimeout(() => {
        pendingLandscape = forcedLandscape;
        navigate('/watch/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(next.id), {
          replace: true
        });
      }, 1400);
    } else {
      showToast('已播放完毕', 2000);
    }
  }, { signal });

  video.addEventListener('error', () => {
    /* HLS.js 会给出更具体的原因，避免重复弹错误。 */
    if (hls || !expectingMedia) return;

    const code = video.error ? video.error.code : 0;
    if (!code) return;

    hideBuffering();
    const failedSrc = video.currentSrc || video.src || resolveSourceUrl(currentSource && currentSource.src);

    if (code === 4 && !hlsFallbackTried) {
      hlsFallbackTried = true;
      handleUnsupportedSource(failedSrc, code).catch(() => {
        hideBuffering();
        showError(mediaErrorMessage(code, failedSrc, null) + '（错误 ' + code + '）');
      });
      return;
    }

    /* Safari 原生 HLS 直连失败：退回代理再试一次。 */
    if (code === 2 && currentSource && currentSource.isHls && retryWithProxy()) return;

    showError(mediaErrorMessage(code, failedSrc, null) + '（错误 ' + code + '）');
  }, { signal });

  scrub.addEventListener('input', () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return;
    const ratio = Number(scrub.value) / 1000;
    video.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    updateProgressUI();
    showControls(false);
  }, { signal });

  scrub.addEventListener('change', () => saveNow(video.ended), { signal });

  if (volumeTrack) {
    volumeTrack.addEventListener('pointerdown', onVolumePointerDown, { signal });
    volumeTrack.addEventListener('pointermove', onVolumePointerMove, { signal });
    volumeTrack.addEventListener('pointerup', onVolumePointerUp, { signal });
    volumeTrack.addEventListener('pointercancel', onVolumePointerUp, { signal });
    volumeTrack.addEventListener('keydown', onVolumeKeydown, { signal });
  }

  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') showControls();
  }, { signal });

  if (qualityButton) qualityButton.disabled = sources.length === 0;
  if (lineButton) lineButton.disabled = sources.length === 0;
  volumeLevel = Number.isFinite(video.volume) ? video.volume : 1;
  wasLandscapeViewport = isLandscapeViewport();
  updateOrientationState();
  updateMuteButton();
  updateSpeedLabel();
  updateQualityLabel();
  updateProgressUI();
  updatePlayButton();
  updateDisplayButton();
  setupMediaSession();

  if (!sources.length) {
    showError('这部影片暂时没有可播放的片源。');
    return cleanup;
  }

  const errorQualityButton = errorBox ? errorBox.querySelector('[data-paction="quality"]') : null;
  if (errorQualityButton && sources.length <= 1) errorQualityButton.hidden = true;

  attachCurrentSource().catch(() => {});

  return cleanup;
}

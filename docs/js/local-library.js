/* 我的视频：本机文件与直接网址。文件只存本机 IndexedDB，不上传、不转存。 */

import * as db from './db.js';

const FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const records = new Map();
const objectUrls = new Map();

function makeId(kind) {
  return 'local-' + kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function cleanTitle(value, fallback) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return text || fallback || '我的视频';
}

function fileTitle(file) {
  const name = String((file && file.name) || '本机视频');
  return name.replace(/\.[^.]+$/, '') || '本机视频';
}

function hostOf(url) {
  try {
    return new URL(url).host || '';
  } catch (error) {
    return '';
  }
}

function sourceFor(record) {
  if (record.kind === 'file') {
    if (!record.blob) return [];
    let url = objectUrls.get(record.id);
    if (!url) {
      url = URL.createObjectURL(record.blob);
      objectUrls.set(record.id, url);
    }
    return [{ src: url, quality: '本机', label: '本机文件' }];
  }

  if (!record.url) return [];
  return [{ src: record.url, quality: '原始', label: '网络地址' }];
}

function toItem(record) {
  const isFile = record.kind === 'file';
  const host = isFile ? '' : hostOf(record.url);
  const synopsis = isFile
    ? '你自己添加的本机视频「' + (record.name || record.title) + '」。文件只保存在这台设备。'
    : '你自己添加的网络视频，来源 ' + (host || '网络地址') + '。';

  return {
    id: record.id,
    title: record.title,
    originalTitle: '',
    year: null,
    category: 'local',
    kind: 'local',
    local: true,
    localKind: record.kind,
    synopsis,
    poster: record.poster || '',
    source: isFile ? '本机文件' : '网络地址',
    sourceUrl: '',
    license: '自有 / 授权内容',
    licenseUrl: '',
    sources: sourceFor(record),
    subtitles: [],
    episodes: [],
    tags: ['我的视频'],
    genres: [],
    aliases: [record.name, host].filter(Boolean),
    runtimeSeconds: Number(record.duration) > 0 ? Number(record.duration) : 0,
    fileName: isFile ? (record.name || '') : '',
    fileSize: isFile ? (Number(record.size) || 0) : 0,
    host,
    isHls: !isFile && isHlsUrl(record.url),
    createdAt: Number(record.createdAt) || 0
  };
}

export function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(String(url || ''));
}

export function fileSizeLimit() {
  return FILE_MAX_BYTES;
}

export function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const name = decodeURIComponent(last).replace(/\.[^.]+$/, '');
    return name || parsed.hostname || '网络视频';
  } catch (error) {
    return '网络视频';
  }
}

export function localItems() {
  return Array.from(records.values())
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map(toItem);
}

export function localCount() {
  return records.size;
}

export async function loadLocalItems() {
  const rows = await db.getAll('custom');
  const next = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row.id !== 'string') return;
    if (row.kind !== 'file' && row.kind !== 'url') return;
    if (typeof row.title !== 'string' || !row.title.trim()) return;
    next.set(row.id, row);
  });

  records.clear();
  next.forEach((record, id) => records.set(id, record));

  /* 已经删除的条目释放 object URL，避免长时间占用内存。 */
  objectUrls.forEach((url, id) => {
    if (!next.has(id)) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  });

  return localItems();
}

export async function addLocalFile({ file, title }) {
  if (!file || typeof file.size !== 'number') {
    throw new Error('没有选择视频文件');
  }

  if (file.size <= 0) {
    throw new Error('这个文件是空的');
  }

  if (file.size > FILE_MAX_BYTES) {
    throw new Error('文件超过 2 GB。建议先压缩，或改用“添加网址”');
  }

  if (!(await db.isAvailable())) {
    throw new Error('这个浏览器不能保存本机视频，请改用“添加网址”');
  }

  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      await navigator.storage.persist();
    }
  } catch (error) {
    /* 持久化申请失败不影响这次保存。 */
  }

  const probe = await probeFile(file);
  const record = {
    id: makeId('file'),
    kind: 'file',
    title: cleanTitle(title, fileTitle(file)),
    blob: file,
    name: file.name || '',
    size: file.size,
    mime: file.type || '',
    duration: probe.duration,
    poster: probe.poster,
    createdAt: Date.now()
  };

  try {
    await db.put('custom', record);
  } catch (error) {
    if (error && (error.name === 'QuotaExceededError' || /quota/i.test(String(error.message || '')))) {
      throw new Error('浏览器存储空间不足，没能保存这个文件。可以改用“添加网址”，或先删掉一些本机视频');
    }
    throw new Error('保存到本机失败，请重试');
  }

  records.set(record.id, record);
  return toItem(record);
}

export async function addLocalUrl({ url, title }) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (error) {
    throw new Error('这个网址格式不对');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持以 http:// 或 https:// 开头的网址');
  }

  const record = {
    id: makeId('url'),
    kind: 'url',
    title: cleanTitle(title, titleFromUrl(parsed.href)),
    url: parsed.href,
    createdAt: Date.now()
  };

  await db.put('custom', record);
  records.set(record.id, record);
  return toItem(record);
}

export async function removeLocalItem(id) {
  await db.remove('custom', id);

  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }

  records.delete(id);
}

/* 从视频里取一帧做 2:3 封面；失败就交给默认占位图，不阻塞添加。 */
function probeFile(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    let duration = 0;
    let hardTimeout = null;
    let captureTimer = null;

    function finish(poster) {
      if (settled) return;
      settled = true;
      if (hardTimeout) clearTimeout(hardTimeout);
      if (captureTimer) clearTimeout(captureTimer);

      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
      } catch (error) {
        /* 忽略。 */
      }
      video.removeAttribute('src');
      try {
        video.load();
      } catch (error) {
        /* 忽略。 */
      }
      URL.revokeObjectURL(objectUrl);
      resolve({ poster: poster || '', duration });
    }

    function capture() {
      if (settled || !video.videoWidth || !video.videoHeight) return;

      try {
        const width = 360;
        const height = 540;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          finish('');
          return;
        }

        const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
        const drawWidth = video.videoWidth * scale;
        const drawHeight = video.videoHeight * scale;
        context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        finish(canvas.toDataURL('image/jpeg', 0.8));
      } catch (error) {
        finish('');
      }
    }

    hardTimeout = window.setTimeout(() => finish(''), 8000);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.addEventListener('loadedmetadata', () => {
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (duration > 0.2) {
        try {
          video.currentTime = Math.min(2, duration / 3);
        } catch (error) {
          /* 某些格式不能跳转，等下面的兜底。 */
        }
      }
      captureTimer = window.setTimeout(capture, 2200);
    });

    video.addEventListener('seeked', () => {
      if (captureTimer) {
        clearTimeout(captureTimer);
        captureTimer = null;
      }
      window.setTimeout(capture, 80);
    });

    video.addEventListener('loadeddata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0.2) {
        window.setTimeout(capture, 120);
      }
    });

    video.addEventListener('error', () => finish(''));
    video.src = objectUrl;
  });
}

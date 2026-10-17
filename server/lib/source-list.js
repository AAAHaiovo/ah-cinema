'use strict';

/*
 * 订阅解析：LibreTV-SourceList / 裸数组 / {name,sources} / TVBox {sites}。
 * 只接受 JSON CMS 类型；不导入直播源；拒绝成人标记与非法协议。
 */

const { cleanText, normalizeSourceUrl } = require('./text');

const MAX_SOURCES = 50;

function looksLikeCmsSite(site) {
  if (!site || typeof site !== 'object') return false;
  if (site.isAdult === true) return false;

  const type = site.type;
  if (type !== undefined && type !== null && type !== '') {
    const number = Number(type);
    if (number !== 1) return false;
  }

  if (site.jar || site.spider || site.ext) return false;
  return true;
}

function siteToSource(site, index) {
  if (!looksLikeCmsSite(site)) return null;

  const url = normalizeSourceUrl(site.api || site.url || site.data);
  if (!url) return null;

  const name = cleanText(site.name || site.title || site.key, 60) || '订阅源 ' + (index + 1);
  const detail = cleanText(site.detail || site.remark || '', 120);

  return { name, url, detail };
}

function entryToSource(entry, index) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.isAdult === true) return null;

  const url = normalizeSourceUrl(entry.url || entry.api);
  if (!url) return null;

  const name = cleanText(entry.name || entry.title, 60) || '订阅源 ' + (index + 1);
  const detail = cleanText(entry.detail || entry.remark || '', 120);

  return { name, url, detail };
}

/*
 * 返回 { name, sources, skipped, truncated, warnings }。
 * 无法识别的整体格式直接抛错，由 handler 转成 400。
 */
function parseSubscription(payload) {
  let entries = null;
  let name = '';
  let isSites = false;

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (payload && typeof payload === 'object') {
    name = cleanText(payload.name || payload.title, 80);
    if (Array.isArray(payload.sources)) {
      entries = payload.sources;
    } else if (Array.isArray(payload.sites)) {
      entries = payload.sites;
      isSites = true;
    }
  }

  if (!entries) {
    const error = new Error('订阅格式不支持');
    error.code = 'SUBSCRIPTION_FORMAT';
    error.status = 400;
    throw error;
  }

  const sources = [];
  const seen = new Set();
  let skipped = 0;

  entries.forEach((entry, index) => {
    const source = isSites ? siteToSource(entry, index) : entryToSource(entry, index);
    if (!source) {
      skipped += 1;
      return;
    }
    if (seen.has(source.url)) {
      skipped += 1;
      return;
    }
    seen.add(source.url);
    if (sources.length >= MAX_SOURCES) return;
    sources.push(source);
  });

  const truncated = Math.max(0, entries.length - skipped - sources.length);
  const warnings = [];
  if (skipped > 0) warnings.push('已跳过 ' + skipped + ' 条格式或协议不支持的条目');
  if (truncated > 0) warnings.push('超过 ' + MAX_SOURCES + ' 条上限，已截断 ' + truncated + ' 条');

  return { name, sources, skipped, truncated, warnings };
}

module.exports = {
  MAX_SOURCES,
  parseSubscription,
  looksLikeCmsSite
};

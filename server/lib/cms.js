'use strict';

/*
 * Apple CMS（MacCMS v10）JSON 解析。
 * 只处理 ?ac=videolist 返回的 JSON，不抓取 HTML 详情页。
 */

const { cleanText, safeHttpUrl, truncate } = require('./text');
const { parseCmsXml, looksLikeXml, XmlError } = require('./xml');
const config = require('./config');

class CmsError extends Error {
  constructor(code, message, status = 502) {
    super(message || '上游数据格式不正确');
    this.name = 'CmsError';
    this.code = code || 'CMS_INVALID';
    this.status = status;
  }
}

function intOr(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function withParams(base, params) {
  const url = new URL(base);
  Object.keys(params).forEach((key) => {
    url.searchParams.set(key, String(params[key]));
  });
  return url.toString();
}

function searchUrl(base, query, page) {
  return withParams(base, { ac: 'videolist', wd: String(query), pg: String(page) });
}

/* 不带关键词，Apple CMS 通常返回最新入库的影片列表；t 为分类 id。 */
function browseUrl(base, page, typeId) {
  const params = { ac: 'videolist', pg: String(page) };
  if (typeId) params.t = String(typeId);
  return withParams(base, params);
}

/* ac=list 返回分类（class）与最新列表，用于取分类目录。 */
function listUrl(base) {
  return withParams(base, { ac: 'list' });
}

function detailUrl(base, vodId) {
  return withParams(base, { ac: 'videolist', ids: String(vodId) });
}

function isAdultText(text) {
  const value = String(text || '');
  return config.adultKeywords.some((keyword) => value.includes(keyword));
}

function isAdultEntry(raw) {
  const fields = [raw.type_name, raw.vod_class, raw.vod_sub, raw.vod_area, raw.vod_lang]
    .filter(Boolean)
    .join(' ');
  return isAdultText(fields);
}

function detectCmsFormat(text) {
  const raw = String(text === undefined || text === null ? '' : text)
    .replace(/^﻿/, '')
    .trim();
  if (!raw) return '';
  if (raw[0] === '{' || raw[0] === '[') return 'json';
  if (looksLikeXml(raw)) return 'xml';
  return '';
}

/*
 * Apple CMS 接口可能是 JSON，也可能是标准 XML（/at/xml/）。
 * 按正文首字符自动识别，并统一成 JSON 接口的对象形状。
 */
function parseCmsPayload(text) {
  const raw = String(text === undefined || text === null ? '' : text)
    .replace(/^﻿/, '')
    .trim();

  if (!raw) throw new CmsError('CMS_INVALID', '源站返回了空内容');

  const format = detectCmsFormat(raw);
  if (format === 'json') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new CmsError('CMS_INVALID', '源站返回的不是有效 JSON');
    }
  }

  if (format === 'xml') {
    try {
      return parseCmsXml(raw);
    } catch (error) {
      if (error instanceof XmlError) {
        throw new CmsError('CMS_INVALID', '源站返回的 XML 格式不正确：' + error.message);
      }
      throw error;
    }
  }

  throw new CmsError('CMS_INVALID', '源站返回的格式无法识别（既不是 JSON，也不是 XML）');
}

/*
 * 解析 ac=list 返回的 class 分类。
 * 返回 [{ id, name, parent }]，丢弃成人分类与重复 id。
 */
function parseClassList(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CmsError('CMS_INVALID', '上游返回的不是 Apple CMS JSON');
  }

  const raw = data.class;
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  const seen = new Set();
  const classes = [];

  list.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = entry.type_id === undefined || entry.type_id === null ? '' : String(entry.type_id).trim();
    const name = cleanText(entry.type_name, 40);
    if (!id || !name || seen.has(id) || isAdultText(name)) return;
    seen.add(id);
    classes.push({
      id,
      name,
      parent: intOr(entry.type_pid, 0)
    });
  });

  return classes;
}

function normalizeSearchItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const vodId = raw.vod_id === undefined || raw.vod_id === null ? '' : String(raw.vod_id).trim();
  const name = cleanText(raw.vod_name, 200);
  if (!vodId || !name) return null;

  return {
    vodId,
    name,
    pic: /^https:\/\//i.test(String(raw.vod_pic || '')) ? safeHttpUrl(raw.vod_pic) : '',
    year: intOr(raw.vod_year, null),
    /* 保留源站的真实分类 id，供服务端校验源站是否真的按 t 过滤。 */
    typeId: cleanText(raw.type_id !== undefined ? raw.type_id : raw.typeId, 20),
    typePid: cleanText(raw.type_pid !== undefined ? raw.type_pid : raw.typePid, 20),
    typeName: cleanText(raw.type_name, 40),
    area: cleanText(raw.vod_area, 40),
    remarks: cleanText(raw.vod_remarks, 60)
  };
}

/*
 * 返回 { items, page, pagecount, total, listIsArray }。
 * list 为 null / 缺失时 items 为空，listIsArray 为 false。
 */
function parseSearchResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CmsError('CMS_INVALID', '上游返回的不是 Apple CMS JSON');
  }

  const listIsArray = Array.isArray(data.list);
  const rawList = listIsArray ? data.list : [];
  const items = rawList
    .filter((raw) => raw && typeof raw === 'object' && !isAdultEntry(raw))
    .map(normalizeSearchItem)
    .filter(Boolean);

  return {
    items,
    page: intOr(data.page, 1),
    pagecount: intOr(data.pagecount, 0),
    total: intOr(data.total, items.length),
    listIsArray
  };
}

/*
 * 解析 vod_play_from + vod_play_url。
 * 返回 [{ name, episodes: [{ name, url }] }]，丢弃非 http(s) 地址。
 */
function parsePlayLines(playFrom, playUrl) {
  const froms = String(playFrom || '').split('$$$');
  const groups = String(playUrl || '').split('$$$');
  const lines = [];

  groups.forEach((group, index) => {
    const lineName = cleanText(froms[index], 40) || '线路 ' + (index + 1);
    const episodes = [];

    String(group || '')
      .split('#')
      .forEach((entry, episodeIndex) => {
        const raw = String(entry || '').trim();
        if (!raw) return;

        const dollar = raw.indexOf('$');
        const rawName = dollar >= 0 ? raw.slice(0, dollar) : '';
        const rawUrl = dollar >= 0 ? raw.slice(dollar + 1) : raw;
        const url = safeHttpUrl(rawUrl);
        if (!url) return;

        episodes.push({
          name: cleanText(rawName, 80) || '第 ' + (episodeIndex + 1) + ' 集',
          url
        });
      });

    if (episodes.length) lines.push({ name: lineName, episodes });
  });

  return lines;
}

function isHlsUrl(url) {
  try {
    return /\.m3u8$/i.test(new URL(url).pathname);
  } catch (error) {
    return /\.m3u8(?:$|[?#])/i.test(String(url || ''));
  }
}

function isHlsLine(lineName, url) {
  return /m3u8|hls/i.test(String(lineName || '')) || isHlsUrl(url);
}

function guessKind(lines) {
  const maxEpisodes = lines.reduce((max, line) => Math.max(max, line.episodes.length), 0);
  return maxEpisodes > 1 ? 'series' : 'movie';
}

function buildRemoteId(sourceId, vodId) {
  return 'remote_' + sourceId + '_' + vodId;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return '';
  }
}

/*
 * 把上游播放地址转成客户端可用的 source：
 * - HTTPS 一律优先直连，避免 HLS 分片逐个穿过函数代理导致卡顿；
 * - HTTP（HTTPS 页面会拦截）继续走签名代理；
 * - proxySrc 始终附带，作为跨域 / 防盗链失败时的兜底。
 */
function makeSource(lineName, url, proxyUrl) {
  const isHls = isHlsLine(lineName, url);
  const needsProxy = /^http:\/\//i.test(url);
  const proxy = typeof proxyUrl === 'function' ? proxyUrl(url) : url;
  const src = needsProxy ? proxy : url;

  return {
    src,
    proxySrc: proxy,
    quality: lineName,
    label: lineName,
    isHls
  };
}

/*
 * 把详情 JSON 转成客户端 item schema。
 * options: { source: {id,name,url}, vodId, proxyUrl(url) }
 */
function buildDetailItem(data, options) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.list) || !data.list.length) {
    throw new CmsError('CMS_NOT_FOUND', '这个源没有找到该影片', 404);
  }

  const raw = data.list.find((entry) => entry && typeof entry === 'object');
  if (!raw) throw new CmsError('CMS_NOT_FOUND', '这个源没有找到该影片', 404);

  const source = options.source || {};
  const sourceId = String(source.id || '');
  const sourceName = cleanText(source.name, 60) || hostOf(source.url) || '网络源';
  const vodId = String(options.vodId || raw.vod_id || '').trim();
  if (!sourceId || !vodId) throw new CmsError('CMS_INVALID', '上游缺少影片 ID');

  const title = cleanText(raw.vod_name, 200);
  if (!title) throw new CmsError('CMS_INVALID', '上游缺少影片标题');

  const lines = parsePlayLines(raw.vod_play_from, raw.vod_play_url);
  const kind = guessKind(lines);
  const proxyUrl = typeof options.proxyUrl === 'function' ? options.proxyUrl : (url) => url;
  const poster = /^https:\/\//i.test(String(raw.vod_pic || '')) ? safeHttpUrl(raw.vod_pic) : '';

  const genres = [cleanText(raw.type_name, 40), cleanText(raw.vod_area, 40), cleanText(raw.vod_lang, 40)].filter(
    (value, index, list) => value && list.indexOf(value) === index
  );

  const item = {
    id: buildRemoteId(sourceId, vodId),
    title,
    year: intOr(raw.vod_year, null),
    category: kind,
    kind,
    sources: [],
    episodes: [],
    poster,
    tags: ['在线'],
    genres,
    aliases: [],
    embed: null,
    synopsis: cleanText(raw.vod_content || raw.vod_blurb, 2000),
    remarks: cleanText(raw.vod_remarks, 80),
    director: cleanText(raw.vod_director, 120),
    actors: cleanText(raw.vod_actor, 240),
    area: cleanText(raw.vod_area, 40),
    typeName: cleanText(raw.type_name, 40),
    source: sourceName,
    sourceUrl: String(source.url || ''),
    license: '',
    remote: true,
    remoteSource: { id: sourceId, name: sourceName, url: String(source.url || '') },
    remoteVodId: vodId
  };

  if (!lines.length) {
    throw new CmsError('CMS_NO_PLAYABLE', '这个源没有提供可播放地址', 422);
  }

  if (kind === 'movie') {
    item.sources = lines.map((line) => makeSource(line.name, line.episodes[0].url, proxyUrl));
  } else {
    const maxEpisodes = Math.max(...lines.map((line) => line.episodes.length));
    for (let index = 0; index < maxEpisodes; index += 1) {
      const sources = [];
      let episodeName = '';

      lines.forEach((line) => {
        const episode = line.episodes[index];
        if (!episode) return;
        if (!episodeName) episodeName = episode.name;
        sources.push(makeSource(line.name, episode.url, proxyUrl));
      });

      if (!sources.length) continue;

      item.episodes.push({
        id: 'ep' + (index + 1),
        episode: index + 1,
        title: truncate(episodeName, 80),
        sources
      });
    }
  }

  return item;
}

module.exports = {
  CmsError,
  searchUrl,
  browseUrl,
  listUrl,
  detailUrl,
  detectCmsFormat,
  parseCmsPayload,
  parseSearchResponse,
  parseClassList,
  parsePlayLines,
  parsePlayFrom: parsePlayLines,
  isHlsUrl,
  buildRemoteId,
  buildDetailItem,
  guessKind
};

'use strict';

/* handler 共用的小工具：源校验、CMS JSON 解析、错误文案。 */

const crypto = require('crypto');
const config = require('../lib/config');
const { ApiError } = require('../lib/http');
const { validateUrlSync, SsrfError } = require('../lib/ssrf');
const { isLoopbackRequest } = require('../lib/auth');
const { FetchError } = require('../lib/safe-fetch');
const { CmsError } = require('../lib/cms');
const { cleanText, stripTrailingSlash } = require('../lib/text');

function allowPrivateFor(req) {
  return config.devAllowPrivate && isLoopbackRequest(req);
}

function normalizeSource(raw, allowPrivate) {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError(400, 'SOURCE_INVALID', '源格式不正确');
  }

  let url;
  try {
    url = validateUrlSync(String(raw.url || ''), { allowPrivate });
  } catch (error) {
    if (error instanceof SsrfError) {
      throw new ApiError(400, error.code, '源地址不被允许：' + error.message);
    }
    throw error;
  }

  const normalizedUrl = stripTrailingSlash(url.toString());
  let fallbackName = '';
  try {
    fallbackName = new URL(normalizedUrl).host;
  } catch (error) {
    fallbackName = '网络源';
  }

  const id = String(raw.id || '').trim();
  const safeId = /^[a-zA-Z0-9_-]{1,80}$/.test(id)
    ? id
    : 's_' + crypto.createHash('sha1').update(normalizedUrl).digest('hex').slice(0, 12);

  return {
    id: safeId,
    name: cleanText(raw.name, 60) || fallbackName,
    url: normalizedUrl
  };
}

function parseCmsJson(text) {
  try {
    return JSON.parse(String(text || '').replace(/^﻿/, ''));
  } catch (error) {
    throw new CmsError('CMS_INVALID', '源站返回的不是有效 JSON');
  }
}

function ensureUpstreamOk(response) {
  if (response.status < 200 || response.status >= 300) {
    throw new FetchError('UPSTREAM_HTTP', '源站返回 HTTP ' + response.status, 502);
  }
}

function upstreamErrorMessage(error, timedOut) {
  if (timedOut || (error && (error.code === 'UPSTREAM_TIMEOUT' || error.code === 'ABORTED'))) {
    return '请求超时（>' + Math.round(config.searchSourceTimeoutMs / 1000) + 's）';
  }
  if (!error) return '搜索失败';

  switch (error.code) {
    case 'DNS_FAILED':
      return '域名解析失败';
    case 'URL_PRIVATE_BLOCKED':
    case 'URL_HOST_BLOCKED':
      return '源地址不被允许';
    case 'UPSTREAM_TLS_ERROR':
      return '源站 HTTPS 证书异常';
    case 'UPSTREAM_UNREACHABLE':
      return '无法连接源站';
    case 'PAYLOAD_TOO_LARGE':
      return '源站响应内容过大';
    case 'TOO_MANY_REDIRECTS':
      return '源站重定向次数过多';
    case 'HTTPS_DOWNGRADE':
      return '源站试图降级到 HTTP';
    case 'UPSTREAM_HTTP':
      return error.message || '源站返回错误状态';
    case 'CMS_INVALID':
      return '源站返回格式不正确';
    case 'CMS_NOT_FOUND':
      return '这个源没有找到该影片';
    case 'CMS_NO_PLAYABLE':
      return '这个源没有提供可播放地址';
    default:
      return '搜索失败';
  }
}

module.exports = {
  allowPrivateFor,
  normalizeSource,
  parseCmsJson,
  ensureUpstreamOk,
  upstreamErrorMessage
};

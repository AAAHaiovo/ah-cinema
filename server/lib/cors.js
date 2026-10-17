'use strict';

/* CORS：默认只允许 GitHub Pages 与本地预览；同源请求始终放行。 */

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function forwardedHost(req) {
  const value = req && req.headers ? req.headers['x-forwarded-host'] : '';
  return String(value || '').split(',')[0].trim();
}

function forwardedProto(req) {
  const value = req && req.headers ? req.headers['x-forwarded-proto'] : '';
  const raw = String(value || '').split(',')[0].trim().toLowerCase();
  return raw === 'http' || raw === 'https' ? raw : '';
}

function headerHost(req) {
  const forwarded = forwardedHost(req);
  const host = forwarded || (req && req.headers ? req.headers.host : '');
  return String(host || '').split(',')[0].trim();
}

function requestOrigin(req) {
  const host = headerHost(req);
  if (!host) return '';
  // 反向代理后面（如 EdgeOne）如果没有 x-forwarded-proto，按 https 处理，避免同源误判。
  const proto =
    forwardedProto(req) ||
    (forwardedHost(req) ? 'https' : '') ||
    (req && req.socket && req.socket.encrypted ? 'https' : 'http');
  return proto + '://' + host;
}

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/:(80|443)$/, '');
}

function originHost(origin) {
  try {
    return normalizeHost(new URL(String(origin)).host);
  } catch (error) {
    return '';
  }
}

function isSameOrigin(req, origin) {
  if (!origin) return false;
  if (stripSlash(origin) === stripSlash(requestOrigin(req))) return true;

  // 某些 CDN / 函数平台把 Host 换成内部地址，公开域名在 x-forwarded-host 或 Origin 里。
  // 只比较 host（忽略协议），并接受浏览器明确标记的 same-origin 请求。
  const host = normalizeHost(headerHost(req));
  if (host && originHost(origin) === host) return true;

  const site = String((req && req.headers && req.headers['sec-fetch-site']) || '').toLowerCase();
  return site === 'same-origin';
}

function isAllowedOrigin(req, config, origin) {
  if (!origin) return true;
  if (isSameOrigin(req, origin)) return true;
  return config.allowedOrigins.includes(stripSlash(origin));
}

function applyHeaders(req, res, config, { wildcard = false } = {}) {
  if (wildcard) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const origin = req && req.headers ? req.headers.origin : '';
    if (origin && isAllowedOrigin(req, config, origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, range');
  res.setHeader('Access-Control-Expose-Headers', 'content-length, content-range, accept-ranges');
}

/*
 * 处理预检。返回 true 表示请求已被响应。
 */
function handlePreflight(req, res, config, options = {}) {
  if (req.method !== 'OPTIONS') return false;

  const origin = req.headers.origin || '';
  if (!options.wildcard && !isAllowedOrigin(req, config, origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: '来源不被允许', code: 'ORIGIN_NOT_ALLOWED' }));
    return true;
  }

  applyHeaders(req, res, config, options);
  res.statusCode = 204;
  res.end();
  return true;
}

/* 非预检请求的来源校验。 */
function checkOrigin(req, config, options = {}) {
  if (options.wildcard) return true;
  const origin = req.headers.origin || '';
  if (!origin) return true;
  return isAllowedOrigin(req, config, origin);
}

module.exports = {
  requestOrigin,
  isSameOrigin,
  isAllowedOrigin,
  applyHeaders,
  handlePreflight,
  checkOrigin
};

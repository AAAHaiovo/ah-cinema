'use strict';

/* CORS：默认只允许 GitHub Pages 与本地预览；同源请求始终放行。 */

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function headerHost(req) {
  const forwarded = req && req.headers ? req.headers['x-forwarded-host'] : '';
  const host = forwarded || (req && req.headers ? req.headers.host : '');
  return String(host || '').split(',')[0].trim();
}

function requestOrigin(req) {
  const host = headerHost(req);
  if (!host) return '';
  const forwardedProto = req && req.headers ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const proto = forwardedProto || (req && req.socket && req.socket.encrypted ? 'https' : 'http');
  return proto + '://' + host;
}

function isSameOrigin(req, origin) {
  return Boolean(origin) && stripSlash(origin) === stripSlash(requestOrigin(req));
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

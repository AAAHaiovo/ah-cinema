'use strict';

/* Bearer 口令校验。先 SHA-256 再定长比较，避免长度与内容时序泄漏。 */

const crypto = require('crypto');
const { isLoopbackAddress } = require('./ssrf');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value === undefined || value === null ? '' : value)).digest();
}

function safeEqual(left, right) {
  const a = sha256(left);
  const b = sha256(right);
  return crypto.timingSafeEqual(a, b);
}

function requestAddress(req) {
  const forwarded = req && req.headers ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  if (forwarded) return forwarded;
  return req && req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
}

function isLoopbackRequest(req) {
  const address = requestAddress(req);
  if (!address) return false;
  return isLoopbackAddress(address) || address === '::ffff:127.0.0.1';
}

function readBearer(req) {
  const header = req && req.headers ? req.headers.authorization : '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  return match ? match[1].trim() : '';
}

/*
 * 返回 { ok, status, code, message }。调用方统一转成 JSON 错误。
 */
function checkAuth(req, config) {
  if (!config.authRequired) return { ok: true };
  if (config.devNoAuth && isLoopbackRequest(req)) return { ok: true };

  const token = readBearer(req);
  if (!token) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: '缺少访问口令' };
  }
  if (!safeEqual(token, config.apiToken)) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: '访问口令不正确' };
  }
  return { ok: true };
}

module.exports = {
  sha256,
  safeEqual,
  readBearer,
  isLoopbackRequest,
  checkAuth
};

'use strict';

/*
 * 代理地址签名：sig = hex(HMAC-SHA256(secret, exp + "\n" + url))
 * 签名 URL 本身是能力凭证，所以 /api/proxy 不再要求 Bearer 口令。
 */

const crypto = require('crypto');

class SignError extends Error {
  constructor(code, message, status) {
    super(message || '签名无效');
    this.name = 'SignError';
    this.code = code || 'SIGNATURE_INVALID';
    this.status = status || 403;
  }
}

function computeSignature(secret, url, exp) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(String(exp) + '\n' + String(url))
    .digest('hex');
}

function verifySignature(secret, url, exp, sig) {
  if (typeof sig !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sig)) {
    throw new SignError('SIGNATURE_INVALID', '签名无效', 403);
  }

  const expected = computeSignature(secret, url, exp);
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(sig.toLowerCase(), 'hex');

  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new SignError('SIGNATURE_INVALID', '签名无效', 403);
  }

  return true;
}

/*
 * 生成站内代理路径（相对 /api/proxy）。调用方决定前缀。
 */
function createProxyPath(secret, url, { ttlSeconds = 43200, now = Date.now(), ttlMs } = {}) {
  const seconds = ttlMs
    ? Math.max(1, Math.ceil(ttlMs / 1000))
    : Math.max(1, Number(ttlSeconds) || 43200);
  const exp = Math.floor(now / 1000) + seconds;
  const sig = computeSignature(secret, url, exp);
  return '/api/proxy?u=' + encodeURIComponent(url) + '&exp=' + exp + '&sig=' + sig;
}

/*
 * 校验查询参数，返回原始目标 URL。
 */
function verifyProxyParams(secret, { u, exp, sig }, { now = Date.now() } = {}) {
  if (typeof u !== 'string' || !u) {
    throw new SignError('SIGNATURE_INVALID', '缺少代理地址', 403);
  }
  if (u.length > 4096) {
    throw new SignError('SIGNATURE_INVALID', '代理地址过长', 403);
  }

  const expNumber = Number(exp);
  if (!Number.isInteger(expNumber) || expNumber <= 0) {
    throw new SignError('SIGNATURE_INVALID', '链接已失效', 403);
  }

  verifySignature(secret, u, expNumber, sig);

  if (expNumber * 1000 <= now) {
    throw new SignError('SIGNATURE_EXPIRED', '链接已过期，请刷新片源', 410);
  }

  return { url: u, exp: expNumber };
}

/* 解析 Proxy 返回的签名地址，用于前端判断是否已是代理。 */
function isProxyPath(value) {
  return typeof value === 'string' && /^\/api\/proxy\?/i.test(value);
}

module.exports = {
  SignError,
  computeSignature,
  verifySignature,
  createProxyPath,
  verifyProxyParams,
  isProxyPath
};

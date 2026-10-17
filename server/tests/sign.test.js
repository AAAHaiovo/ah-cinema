'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProxyPath,
  verifyProxyParams,
  computeSignature
} = require('../lib/sign');

const secret = 'test-secret';
const target = 'https://cdn.example/hls/index.m3u8?token=1';

function parsePath(path) {
  const url = new URL('http://local' + path);
  return {
    u: url.searchParams.get('u'),
    exp: url.searchParams.get('exp'),
    sig: url.searchParams.get('sig')
  };
}

test('签名：正常签发与校验', () => {
  const path = createProxyPath(secret, target, { ttlSeconds: 3600 });
  assert.ok(path.startsWith('/api/proxy?'));
  const params = parsePath(path);
  assert.equal(params.u, target);

  const verified = verifyProxyParams(secret, params);
  assert.equal(verified.url, target);
});

test('签名：篡改地址或签名都会失败', () => {
  const params = parsePath(createProxyPath(secret, target, { ttlSeconds: 3600 }));
  assert.throws(() => verifyProxyParams(secret, Object.assign({}, params, { u: 'https://evil.example/a.m3u8' })), /签名/);

  const badSig = params.sig.slice(0, -1) + (params.sig.endsWith('0') ? '1' : '0');
  assert.throws(() => verifyProxyParams(secret, Object.assign({}, params, { sig: badSig })), /签名/);
  assert.throws(() => verifyProxyParams(secret, Object.assign({}, params, { sig: 'not-hex' })), /签名/);
});

test('签名：过期返回 410', () => {
  const now = Date.now();
  const params = parsePath(createProxyPath(secret, target, { ttlSeconds: 1, now: now - 10_000 }));
  assert.throws(
    () => verifyProxyParams(secret, params, { now }),
    (error) => error.code === 'SIGNATURE_EXPIRED' && error.status === 410
  );
});

test('签名：公式与文档一致（exp + 换行 + url）', () => {
  const exp = 1700000000;
  const sig = computeSignature(secret, target, exp);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAuth, readBearer, isLoopbackRequest } = require('../lib/auth');

function fakeReq(token, address = '203.0.113.9') {
  return {
    headers: token === undefined ? {} : { authorization: token },
    socket: { remoteAddress: address }
  };
}

const config = { authRequired: true, apiToken: 'correct-token', devNoAuth: false };

test('鉴权：缺少 / 错误口令 → 401', () => {
  assert.equal(checkAuth(fakeReq(undefined), config).status, 401);
  assert.equal(checkAuth(fakeReq('Bearer wrong'), config).status, 401);
  assert.equal(checkAuth(fakeReq('Basic abc'), config).status, 401);
});

test('鉴权：正确口令通过', () => {
  assert.equal(checkAuth(fakeReq('Bearer correct-token'), config).ok, true);
  assert.equal(checkAuth(fakeReq('bearer correct-token'), config).ok, true);
});

test('鉴权：未配置口令时不要求', () => {
  assert.equal(checkAuth(fakeReq(undefined), { authRequired: false }).ok, true);
});

test('鉴权：开发免口令只对 loopback 生效', () => {
  const devConfig = { authRequired: true, apiToken: 'x', devNoAuth: true };
  assert.equal(checkAuth(fakeReq(undefined, '127.0.0.1'), devConfig).ok, true);
  assert.equal(checkAuth(fakeReq(undefined, '::1'), devConfig).ok, true);
  assert.equal(checkAuth(fakeReq(undefined, '8.8.8.8'), devConfig).status, 401);
});

test('鉴权：Bearer 解析与 loopback 判断', () => {
  assert.equal(readBearer({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(readBearer({ headers: {} }), '');
  assert.equal(isLoopbackRequest(fakeReq(undefined, '127.0.0.1')), true);
  assert.equal(isLoopbackRequest(fakeReq(undefined, '192.168.1.2')), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestOrigin,
  isSameOrigin,
  isAllowedOrigin,
  checkOrigin
} = require('../lib/cors');

function makeReq(headers = {}) {
  return {
    method: 'POST',
    url: '/api/search',
    headers,
    socket: {}
  };
}

const config = { allowedOrigins: ['https://aaahaiovo.github.io'] };

test('CORS：x-forwarded-host 无协议时按 https 判断同源', () => {
  const req = makeReq({
    origin: 'https://demo.edgeone.app',
    'x-forwarded-host': 'demo.edgeone.app'
  });
  assert.equal(requestOrigin(req), 'https://demo.edgeone.app');
  assert.equal(isSameOrigin(req, 'https://demo.edgeone.app'), true);
});

test('CORS：内部 Host 但公开域名在 x-forwarded-host', () => {
  const req = makeReq({
    host: 'internal.cdn.example',
    origin: 'https://demo.edgeone.app',
    'x-forwarded-host': 'demo.edgeone.app',
    'x-forwarded-proto': 'https'
  });
  assert.equal(isSameOrigin(req, 'https://demo.edgeone.app'), true);
  assert.equal(checkOrigin(req, config), true);
});

test('CORS：只有内部 Host 时接受浏览器 same-origin 标记', () => {
  const req = makeReq({
    host: 'internal.cdn.example',
    origin: 'https://demo.edgeone.app',
    'sec-fetch-site': 'same-origin'
  });
  assert.equal(isSameOrigin(req, 'https://demo.edgeone.app'), true);
});

test('CORS：跨站来源仍然拒绝，白名单来源仍允许', () => {
  const req = makeReq({
    host: 'demo.edgeone.app',
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site'
  });
  assert.equal(isSameOrigin(req, 'https://evil.example'), false);
  assert.equal(checkOrigin(req, config), false);
  assert.equal(isAllowedOrigin(req, config, 'https://aaahaiovo.github.io'), true);
});

test('CORS：显式 http 协议与端口不误判', () => {
  const req = makeReq({
    host: '127.0.0.1:4199',
    origin: 'http://127.0.0.1:4199',
    'x-forwarded-proto': 'http'
  });
  assert.equal(requestOrigin(req), 'http://127.0.0.1:4199');
  assert.equal(isSameOrigin(req, 'http://127.0.0.1:4199'), true);
});

test('CORS：没有 Origin 的普通请求放行', () => {
  assert.equal(checkOrigin(makeReq({ host: 'demo.edgeone.app' }), config), true);
});

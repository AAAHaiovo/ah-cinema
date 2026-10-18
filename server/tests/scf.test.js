'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main_handler } = require('../../tools/scf-entry');

test('SCF：health 事件返回 JSON', async () => {
  const res = await main_handler({
    httpMethod: 'GET',
    path: '/api/health',
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /application\/json/);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.apiVersion, 1);
});

test('SCF：未知路径返回统一 404 JSON', async () => {
  const res = await main_handler({
    httpMethod: 'GET',
    path: '/api/nope',
    headers: {}
  });
  assert.equal(res.statusCode, 404);
  const data = JSON.parse(res.body);
  assert.equal(data.code, 'NOT_FOUND');
});

test('SCF：CORS 预检允许 GitHub Pages', async () => {
  const res = await main_handler({
    httpMethod: 'OPTIONS',
    path: '/api/search',
    headers: {
      origin: 'https://aaahaiovo.github.io',
      'access-control-request-method': 'POST'
    }
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://aaahaiovo.github.io');
});

test('SCF：不带 /api 前缀也能命中', async () => {
  const res = await main_handler({
    httpMethod: 'GET',
    path: '/health',
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('SCF：超大请求体返回 413', async () => {
  const body = JSON.stringify({ q: 'x'.repeat(100 * 1024), sources: [] });
  const res = await main_handler({
    httpMethod: 'POST',
    path: '/api/search',
    headers: { 'content-type': 'application/json' },
    body
  });
  assert.equal(res.statusCode, 413);
  assert.equal(JSON.parse(res.body).code, 'BODY_TOO_LARGE');
});

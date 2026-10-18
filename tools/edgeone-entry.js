'use strict';

/*
 * 腾讯云 EdgeOne Pages 的 Node 函数入口。
 * 把现有的 /api/* handler 原样挂到 Express 上，复用同一套鉴权、CORS、限流和错误处理。
 * 由 tools/build-edgeone.js 打包成 cloud-functions/api/[[default]].js。
 */

const express = require('express');
const { sendJson } = require('../server/lib/http');

const ROUTES = {
  '/health': require('../server/handlers/health'),
  '/browse': require('../server/handlers/browse'),
  '/search': require('../server/handlers/search'),
  '/detail': require('../server/handlers/detail'),
  '/source-test': require('../server/handlers/source-test'),
  '/subscription': require('../server/handlers/subscription'),
  '/proxy': require('../server/handlers/proxy')
};

function parseUrl(raw) {
  try {
    const url = new URL(String(raw || '/'), 'http://local');
    return { pathname: url.pathname, search: url.search };
  } catch (error) {
    return null;
  }
}

function normalizePath(pathname) {
  let value = pathname || '/';
  // EdgeOne 可能把 /api 保留在 req.url 里，也可能已经剥掉；两种都兼容。
  while (value === '/api' || value.startsWith('/api/')) {
    value = value.slice(4) || '/';
  }
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value || '/';
}

const app = express();
app.disable('x-powered-by');

// 不挂 express.json()：handler 里的 readJson 需要自己读取原始请求流。
app.use((req, res) => {
  const parsed = parseUrl(req.url);
  if (!parsed) {
    sendJson(res, 400, { error: '请求地址不正确', code: 'BAD_REQUEST' });
    return;
  }

  const pathname = normalizePath(parsed.pathname);
  const handler = ROUTES[pathname];
  if (!handler) {
    sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
    return;
  }

  // handler 只需要路径和查询串；统一成 /search?q=... 的形式。
  req.url = pathname + parsed.search;

  Promise.resolve(handler(req, res)).catch(() => {
    if (!res.writableEnded) {
      sendJson(res, 500, { error: '服务暂时不可用', code: 'INTERNAL_ERROR' });
    }
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  sendJson(res, 500, { error: '服务暂时不可用', code: 'INTERNAL_ERROR' });
});

module.exports = app;

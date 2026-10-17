'use strict';

/*
 * 在本地模拟 EdgeOne Pages：docs/ 静态文件 + /api/* 打包后的 Node 函数。
 * 用法：node tools/edgeone-local.js 4199
 */

const http = require('http');
const { createStaticHandler } = require('./serve');

let app;
try {
  app = require('../cloud-functions/api/[[default]].js');
} catch (error) {
  console.error('[edgeone-local] 找不到打包文件，请先运行：npm run build:edgeone');
  process.exit(1);
}

const port = Number(process.argv[2] || 4199);
const handleStatic = createStaticHandler();

http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch (error) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    app(req, res);
    return;
  }

  handleStatic(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log('EdgeOne 本地模拟：http://127.0.0.1:' + port + '/');
  console.log('API：http://127.0.0.1:' + port + '/api/health');
});

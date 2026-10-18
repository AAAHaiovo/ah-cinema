'use strict';

/*
 * 本地一体化服务器：docs/ 静态文件 + /api/*。
 * 开发示例：
 *   AH_ENV=development AH_DEV_ALLOW_PRIVATE=1 AH_DEV_NO_AUTH=1 node tools/ah-server.js 4173
 */

const http = require('http');
const { createStaticHandler } = require('./serve');
const { sendJson } = require('../server/lib/http');

const ROUTES = {
  '/api/health': require('../server/handlers/health'),
  '/api/browse': require('../server/handlers/browse'),
  '/api/categories': require('../server/handlers/categories'),
  '/api/search': require('../server/handlers/search'),
  '/api/detail': require('../server/handlers/detail'),
  '/api/source-test': require('../server/handlers/source-test'),
  '/api/subscription': require('../server/handlers/subscription'),
  '/api/proxy': require('../server/handlers/proxy')
};

const port = Number(process.argv[2] || 4173);
const handleStatic = createStaticHandler();

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch (error) {
    sendJson(res, 400, { error: '请求地址不正确', code: 'BAD_REQUEST' });
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const handler = ROUTES[pathname];
    if (!handler) {
      sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
      return;
    }
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { error: '服务暂时不可用', code: 'INTERNAL_ERROR' });
    });
    return;
  }

  handleStatic(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log('AH 影视本地服务：http://127.0.0.1:' + port + '/');
  console.log('API：http://127.0.0.1:' + port + '/api/health');
});

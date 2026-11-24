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

/* 云平台（Render 等）通过 PORT 注入端口，并要求监听 0.0.0.0；
   本地开发默认仍只监听 127.0.0.1，避免把开发服务暴露到局域网。 */
const port = Number(process.env.PORT || process.argv[2] || 4173);
const host = process.env.HOST || (process.env.AH_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
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

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log('AH 影视服务：http://' + shown + ':' + port + '/');
  console.log('API：http://' + shown + ':' + port + '/api/health');
});

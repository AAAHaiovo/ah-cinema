'use strict';

/*
 * 本地合法 Apple CMS 模拟源，仅用于开发与 E2E。
 * 数据全部自造，视频为 CC0 示例片；不接受外网请求，也不部署到线上。
 *
 * 用法：node tools/mock-cms.js [port]   （默认 4180）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 4180);
const fixtures = path.resolve(__dirname, 'fixtures');
const data = JSON.parse(fs.readFileSync(path.join(fixtures, 'mock-cms.json'), 'utf8'));
const TYPES = {
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function originOf(req) {
  return 'http://' + (req.headers.host || '127.0.0.1:' + port);
}

/* 把数据里的 /media/... 展开成绝对地址，Apple CMS 客户端只接受绝对 URL。 */
function expandItem(item, origin) {
  const playUrl = String(item.vod_play_url || '')
    .split('$$$')
    .map((group) =>
      group
        .split('#')
        .map((entry) => entry.replace(/(\$)(\/[^#$]*)/g, (match, dollar, rest) => dollar + origin + rest))
        .join('#')
    )
    .join('$$$');

  return Object.assign({}, item, {
    vod_play_url: playUrl,
    vod_pic: item.vod_pic && item.vod_pic.startsWith('/') ? origin + item.vod_pic : item.vod_pic || ''
  });
}

function searchPayload(sourceKey, query, page, origin) {
  const source = data.sources[sourceKey];
  if (!source) return { code: 0, msg: 'unknown source', list: null };

  const text = String(query || '').trim().toLowerCase();
  const matches = source.items.filter((item) => !text || String(item.vod_name).toLowerCase().includes(text));
  const limit = 20;
  const total = matches.length;
  const pagecount = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pagecount);
  const slice = matches.slice((safePage - 1) * limit, safePage * limit);

  return {
    code: 1,
    msg: '数据列表',
    page: safePage,
    pagecount,
    limit: String(limit),
    total,
    list: slice.map((item) => expandItem(item, origin))
  };
}

function detailPayload(sourceKey, ids, origin) {
  const source = data.sources[sourceKey];
  if (!source) return { code: 0, msg: 'unknown source', list: null };

  const wanted = new Set(String(ids || '').split(',').map((id) => id.trim()));
  const list = source.items.filter((item) => wanted.has(String(item.vod_id))).map((item) => expandItem(item, origin));
  return { code: 1, msg: '数据列表', page: 1, pagecount: 1, total: list.length, list };
}

function sendMedia(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    let start = match[1] === '' ? stat.size - Number(match[2]) : Number(match[1]);
    let end = match[1] !== '' && match[2] !== '' ? Number(match[2]) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendPoster(res, name) {
  const title = name.replace(/\.svg$/i, '').replace(/[^a-z0-9-]/gi, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<rect width="300" height="450" fill="#1f3a35"/>
<circle cx="150" cy="180" r="70" fill="#e9c46a"/>
<text x="150" y="330" fill="#f6f1e7" font-family="sans-serif" font-size="24" text-anchor="middle">${title || 'AH'}</text>
<text x="150" y="370" fill="#9cc5b6" font-family="sans-serif" font-size="14" text-anchor="middle">LOCAL FIXTURE</text>
</svg>`;
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(svg);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, originOf(req));
  } catch (error) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'range, content-type'
    });
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
    res.end();
    return;
  }

  const origin = originOf(req);
  const pathname = url.pathname;

  if (pathname === '/api.php/provide/vod' || pathname === '/api2.php/provide/vod') {
    const sourceKey = pathname.slice(1);
    const ac = url.searchParams.get('ac');
    if (ac !== 'videolist') {
      sendJson(res, 200, { code: 0, msg: 'unsupported ac', list: null });
      return;
    }
    if (url.searchParams.get('ids')) {
      sendJson(res, 200, detailPayload(sourceKey, url.searchParams.get('ids'), origin));
      return;
    }
    sendJson(res, 200, searchPayload(sourceKey, url.searchParams.get('wd'), url.searchParams.get('pg'), origin));
    return;
  }

  if (pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'mock-cms', port });
    return;
  }

  if (pathname.startsWith('/poster/')) {
    sendPoster(res, path.basename(pathname));
    return;
  }

  if (pathname.startsWith('/media/')) {
    const filePath = path.resolve(fixtures, 'cc0', path.basename(pathname));
    if (!filePath.startsWith(path.resolve(fixtures, 'cc0') + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    sendMedia(req, res, filePath);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log('Mock Apple CMS: http://127.0.0.1:' + port + '/api.php/provide/vod');
});

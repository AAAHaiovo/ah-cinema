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

function sendXml(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

/* 支持 /api.php/provide/vod、/api2.php/provide/vod 以及 /at/xml/ 目录式接口。 */
function sourceRoute(pathname) {
  const match = /^\/(api\d*\.php)\/provide\/vod(\/at\/xml\/?)?\/?$/.exec(pathname);
  if (!match) return null;
  return { key: match[1] + '/provide/vod', xml: Boolean(match[2]) };
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

/* 把 fixture 里的 generated 长尾条目展开，用于测试超过 20 页的翻页。 */
function sourceItems(source, origin) {
  const items = Array.isArray(source.items) ? source.items.slice() : [];

  (Array.isArray(source.generated) ? source.generated : []).forEach((spec) => {
    const count = Math.max(0, Math.min(500, Number(spec.count) || 0));
    for (let index = 1; index <= count; index += 1) {
      items.push({
        vod_id: Number(spec.type_id) * 1000 + index,
        vod_name: String(spec.prefix || '测试影片') + ' ' + index,
        vod_year: String(spec.year || ''),
        type_id: spec.type_id,
        type_name: spec.type_name,
        vod_area: '中国',
        vod_remarks: String(spec.type_name || '') + ' ' + index,
        vod_pic: '/poster/long-tail.svg',
        vod_play_from: '直连',
        vod_play_url: '正片$/media/flower.mp4'
      });
    }
  });

  return items.map((item) => expandItem(item, origin));
}

function searchPayload(sourceKey, query, page, typeId, origin) {
  const source = data.sources[sourceKey];
  if (!source) return { code: 0, msg: 'unknown source', list: null };

  const text = String(query || '').trim().toLowerCase();
  const type = String(typeId || '').trim();
  /* ignoreType 模拟不实现 t 参数的源：无论 t 是什么都返回全部影片。 */
  const ignoreType = Boolean(source.ignoreType);
  const matches = sourceItems(source, origin).filter((item) => {
    if (type && !ignoreType && String(item.type_id) !== type) return false;
    return !text || String(item.vod_name).toLowerCase().includes(text);
  });
  /* 故意把每页压到 4 条，方便测试翻页。 */
  const limit = 4;
  const total = matches.length;
  const pagecount = Math.max(1, Math.ceil(total / limit));
  /* 超出末页时返回空列表，和真实 CMS 一致，避免把上一页内容重复一遍。 */
  const safePage = Math.max(1, Number(page) || 1);
  const slice = matches.slice((safePage - 1) * limit, safePage * limit);

  return {
    code: 1,
    msg: '数据列表',
    page: safePage,
    pagecount,
    limit: String(limit),
    total,
    list: slice
  };
}

function listPayload(sourceKey) {
  const source = data.sources[sourceKey];
  if (!source) return { code: 0, msg: 'unknown source', class: null };

  return {
    code: 1,
    msg: '数据列表',
    class: Array.isArray(source.classes) ? source.classes : []
  };
}

function detailPayload(sourceKey, ids, origin) {
  const source = data.sources[sourceKey];
  if (!source) return { code: 0, msg: 'unknown source', list: null };

  const wanted = new Set(String(ids || '').split(',').map((id) => id.trim()));
  const list = sourceItems(source, origin).filter((item) => wanted.has(String(item.vod_id)));
  return { code: 1, msg: '数据列表', page: 1, pagecount: 1, total: list.length, list };
}

/* ---------- XML 序列化（Apple CMS /at/xml/ 兼容） ---------- */

function xmlText(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlCdata(value) {
  return '<![CDATA[' + String(value === undefined || value === null ? '' : value).replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
}

function videoXml(item) {
  const from = String(item.vod_play_from || '').split('$$$');
  const urls = String(item.vod_play_url || '').split('$$$');
  const lines = from
    .map((flag, index) => '<dd flag="' + xmlText(flag) + '">' + xmlCdata(urls[index] || '') + '</dd>')
    .join('');

  return '<video>' +
    '<id>' + xmlText(item.vod_id) + '</id>' +
    '<tid>' + xmlText(item.type_id) + '</tid>' +
    '<name>' + xmlText(item.vod_name) + '</name>' +
    '<type>' + xmlText(item.type_name) + '</type>' +
    '<pic>' + xmlText(item.vod_pic) + '</pic>' +
    '<lang>' + xmlText(item.vod_lang) + '</lang>' +
    '<area>' + xmlText(item.vod_area) + '</area>' +
    '<year>' + xmlText(item.vod_year) + '</year>' +
    '<note>' + xmlCdata(item.vod_remarks || '') + '</note>' +
    '<des>' + xmlCdata(item.vod_content || '') + '</des>' +
    (lines ? '<dl>' + lines + '</dl>' : '') +
    '</video>';
}

function xmlPayload(payload) {
  const classes = Array.isArray(payload.class)
    ? '<class>' + payload.class.map((cls) =>
        '<ty id="' + xmlText(cls.type_id) + '" pid="' + xmlText(cls.type_pid || 0) + '">' +
        xmlText(cls.type_name) + '</ty>'
      ).join('') + '</class>'
    : '';
  const list = Array.isArray(payload.list)
    ? '<list page="' + xmlText(payload.page || 1) + '" pagecount="' + xmlText(payload.pagecount || 1) +
      '" pagesize="' + xmlText(payload.limit || payload.list.length) + '" recordcount="' +
      xmlText(payload.total || payload.list.length) + '">' +
      payload.list.map(videoXml).join('') + '</list>'
    : '';

  return '<?xml version="1.0" encoding="utf-8"?>\n<rss version="5.1">' + classes + list + '</rss>';
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

  const route = sourceRoute(pathname);
  if (route) {
    const sourceKey = route.key;
    const ac = url.searchParams.get('ac');
    const xml = route.xml || url.searchParams.get('at') === 'xml';
    const send = (payload) => {
      if (xml) sendXml(res, 200, xmlPayload(payload));
      else sendJson(res, 200, payload);
    };

    if (ac === 'list') {
      send(listPayload(sourceKey));
      return;
    }
    if (ac !== 'videolist' && ac !== 'detail') {
      send({ code: 0, msg: 'unsupported ac', list: null });
      return;
    }
    if (url.searchParams.get('ids')) {
      send(detailPayload(sourceKey, url.searchParams.get('ids'), origin));
      return;
    }
    send(searchPayload(
      sourceKey,
      url.searchParams.get('wd'),
      url.searchParams.get('pg'),
      url.searchParams.get('t'),
      origin
    ));
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

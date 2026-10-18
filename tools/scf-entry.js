'use strict';

/*
 * 腾讯云 SCF（事件函数 + 函数 URL）入口。
 *
 * 函数 URL 的事件与 API Gateway 类似：
 *   { httpMethod, path, headers, queryString, body, isBase64Encoded }
 * 返回值：
 *   { statusCode, headers, body, isBase64Encoded }
 *
 * 这里把事件适配成 Node 的 req/res，直接复用 server/handlers 下的实现，
 * 不引入 Express，也不依赖平台的请求体解析。
 */

const { Readable, Writable } = require('stream');
const { sendJson } = require('../server/lib/http');

const ROUTES = {
  '/health': require('../server/handlers/health'),
  '/search': require('../server/handlers/search'),
  '/detail': require('../server/handlers/detail'),
  '/source-test': require('../server/handlers/source-test'),
  '/subscription': require('../server/handlers/subscription'),
  '/proxy': require('../server/handlers/proxy')
};

// SCF 函数 URL 的单次响应大小上限与 EdgeOne 一致，按 6 MB 估算。
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'x-accel-buffering'
]);

const TEXT_TYPE =
  /^(text\/|application\/(json|javascript|xml|x-ndjson)|application\/vnd\.apple\.mpegurl|image\/svg\+xml)/i;

function normalizePath(pathname) {
  let value = pathname || '/';
  while (value === '/api' || value.startsWith('/api/')) {
    value = value.slice(4) || '/';
  }
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value || '/';
}

function queryOf(event) {
  const params = new URLSearchParams();
  const source =
    event && event.queryString && typeof event.queryString === 'object'
      ? event.queryString
      : event && event.queryStringParameters && typeof event.queryStringParameters === 'object'
        ? event.queryStringParameters
        : null;
  if (!source) return '';
  Object.keys(source).forEach((name) => {
    const value = source[name];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) params.append(name, String(item));
      });
    } else if (value !== undefined && value !== null) {
      params.append(name, String(value));
    }
  });
  return params.toString();
}

function normalizeHeaders(event) {
  const headers = {};
  const source = event && event.headers && typeof event.headers === 'object' ? event.headers : {};
  Object.keys(source).forEach((name) => {
    const value = source[name];
    if (value === undefined || value === null) return;
    headers[String(name).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  if (!headers['x-forwarded-for'] && headers['x-scf-remote-addr']) {
    headers['x-forwarded-for'] = headers['x-scf-remote-addr'];
  }
  return headers;
}

/* Node 的 ServerResponse 替身：只收集状态、头和响应体，不发网络包。 */
class CaptureResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.aborted = false;
    this._headersSent = false;
  }

  get headersSent() {
    return this._headersSent;
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  }

  removeHeader(name) {
    delete this.headers[String(name).toLowerCase()];
  }

  writeHead(status, headers) {
    this.statusCode = Number(status) || this.statusCode;
    if (headers && typeof headers === 'object') {
      Object.keys(headers).forEach((name) => this.setHeader(name, headers[name]));
    }
    this._headersSent = true;
    return this;
  }

  write(chunk, encoding, callback) {
    this._headersSent = true;
    return super.write(chunk, encoding, callback);
  }

  end(chunk, encoding, callback) {
    this._headersSent = true;
    return super.end(chunk, encoding, callback);
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  _destroy(error, callback) {
    // 正常 end 之后 Writable 也会自动 destroy，这不算中断。
    if (!this.writableEnded) this.aborted = true;
    callback(error);
  }
}

function toScfResponse(res, method) {
  const status = res.statusCode || 200;
  const headers = {};
  Object.keys(res.headers).forEach((name) => {
    const value = res.headers[name];
    if (HOP_HEADERS.has(name) || value === undefined || value === null) return;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  if (res.aborted) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: '片源响应超过当前部署的单次响应大小上限或连接中断',
        code: 'RESPONSE_ABORTED'
      })
    };
  }

  const buffer = Buffer.concat(res.chunks);
  if (buffer.length > MAX_RESPONSE_BYTES) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: '片源响应超过当前部署的单次响应大小上限',
        code: 'PROXY_RESPONSE_TOO_LARGE'
      })
    };
  }

  if (method === 'HEAD' || status === 204 || status === 304) {
    return { statusCode: status, headers, body: '' };
  }

  const contentType = String(headers['content-type'] || '');
  if (!contentType || TEXT_TYPE.test(contentType)) {
    return { statusCode: status, headers, body: buffer.toString('utf8') };
  }

  return {
    statusCode: status,
    headers,
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
}

async function main_handler(event) {
  const method = String((event && event.httpMethod) || 'GET').toUpperCase();
  const path = String((event && event.path) || '/') || '/';
  const search = queryOf(event);
  const parsed = new URL(path + (search ? (path.includes('?') ? '&' : '?') + search : ''), 'http://scf.local');
  const pathname = normalizePath(parsed.pathname);

  const handler = ROUTES[pathname];
  if (!handler) {
    const notFound = new CaptureResponse();
    sendJson(notFound, 404, { error: '接口不存在', code: 'NOT_FOUND' });
    return toScfResponse(notFound, method);
  }

  const rawBody = typeof event.body === 'string' ? event.body : '';
  const body = event.isBase64Encoded ? Buffer.from(rawBody, 'base64') : Buffer.from(rawBody, 'utf8');
  const headers = normalizeHeaders(event);
  const remote = String(headers['x-scf-remote-addr'] || headers['x-forwarded-for'] || '').split(',')[0].trim();

  const req = new Readable({ read() {} });
  req.method = method;
  req.url = pathname + parsed.search;
  req.headers = headers;
  req.httpVersion = '1.1';
  req.socket = { remoteAddress: remote, encrypted: true };
  req.connection = req.socket;
  req.push(body.length ? body : null);
  req.push(null);

  const res = new CaptureResponse();

  try {
    await handler(req, res);
  } catch (error) {
    if (!res.writableEnded) {
      sendJson(res, 500, { error: '服务暂时不可用', code: 'INTERNAL_ERROR' });
    }
  }

  // 代理/流式接口在 pipe 后可能还没结束，等它写完再打包返回。
  if (!res.writableEnded) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 20000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      res.once('finish', done);
      res.once('close', done);
    });
  }

  return toScfResponse(res, method);
}

exports.main_handler = main_handler;

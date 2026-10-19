'use strict';

/*
 * 受控上游请求：逐跳校验 URL 与 DNS，把已校验的 IP 固定给连接，
 * 手动处理重定向并拒绝 HTTPS → HTTP 降级，统一超时与大小上限。
 */

const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const { resolveTarget } = require('./ssrf');
const config = require('./config');

class FetchError extends Error {
  constructor(code, message, status = 502) {
    super(message || '上游请求失败');
    this.name = 'FetchError';
    this.code = code || 'UPSTREAM_ERROR';
    this.status = status;
  }
}

function stripBrackets(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
}

function makeLookup(addresses) {
  return (hostname, options, callback) => {
    let opts = options;
    let done = callback;
    if (typeof opts === 'function') {
      done = opts;
      opts = {};
    }

    if (opts && opts.all) {
      done(
        null,
        addresses.map((record) => ({ address: record.address, family: record.family }))
      );
      return;
    }

    done(null, addresses[0].address, addresses[0].family);
  };
}

function defaultHeaders(extra) {
  return Object.assign(
    {
      'user-agent': config.userAgent,
      accept: '*/*',
      'accept-encoding': 'identity'
    },
    extra || {}
  );
}

function requestOnce(target, opts) {
  const url = target.url;
  const isHttps = url.protocol === 'https:';
  const hostname = stripBrackets(url.hostname);
  const tlsHostname = net.isIP(hostname) ? '' : hostname;
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let abortCleanup = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortCleanup) abortCleanup();
      fn(value);
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: opts.method || 'GET',
        headers: defaultHeaders(opts.headers),
        lookup: makeLookup(target.addresses),
        servername: isHttps && tlsHostname ? tlsHostname : undefined,
        agent: false,
        timeout: opts.timeoutMs
      },
      (res) => {
        const status = Number(res.statusCode) || 0;
        const headers = res.headers || {};
        let stream = res;

        const encoding = String(headers['content-encoding'] || '').toLowerCase();
        if (encoding && encoding !== 'identity') {
          const decoder =
            encoding === 'gzip'
              ? zlib.createGunzip()
              : encoding === 'deflate'
                ? zlib.createInflate()
                : encoding === 'br'
                  ? zlib.createBrotliDecompress()
                  : null;

          if (decoder) {
            delete headers['content-encoding'];
            delete headers['content-length'];
            res.on('error', (error) => decoder.destroy(error));
            res.pipe(decoder);
            stream = decoder;
          }
        }

        finish(resolve, {
          status,
          headers,
          stream,
          url,
          request: req
        });
      }
    );

    req.on('error', (error) => {
      if (error && error.code && String(error.code).startsWith('ERR_TLS')) {
        finish(reject, new FetchError('UPSTREAM_TLS_ERROR', '上游 HTTPS 证书校验失败', 502));
        return;
      }
      if (error instanceof FetchError) finish(reject, error);
      else finish(reject, new FetchError('UPSTREAM_UNREACHABLE', '无法连接上游服务器', 502));
    });

    req.setTimeout(opts.timeoutMs || 15000, () => {
      req.destroy(new FetchError('UPSTREAM_TIMEOUT', '请求超时', 504));
    });

    const signal = opts.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy(new FetchError('ABORTED', '请求已取消', 499));
      } else {
        const onAbort = () => req.destroy(new FetchError('ABORTED', '请求已取消', 499));
        signal.addEventListener('abort', onAbort, { once: true });
        abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
    }

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/*
 * 打开上游流，自动跟随最多 config.redirectMax 次重定向。
 * 返回 { status, headers, stream, url, request }。
 */
async function open(rawUrl, opts = {}) {
  const allowPrivate = Boolean(opts.allowPrivate);
  const maxRedirects = Number.isInteger(opts.maxRedirects) ? opts.maxRedirects : config.redirectMax;
  let current = String(rawUrl);
  let hops = 0;

  for (;;) {
    const target = await resolveTarget(current, { allowPrivate });
    const response = await requestOnce(target, opts);
    const location = response.headers.location;

    const redirect = [301, 302, 303, 307, 308].includes(response.status) && location;
    if (!redirect) {
      return Object.assign({}, response, { url: target.url.toString() });
    }

    if (hops >= maxRedirects) {
      response.stream.resume();
      response.request.destroy();
      throw new FetchError('TOO_MANY_REDIRECTS', '上游重定向次数过多', 502);
    }

    let next;
    try {
      next = new URL(String(location), target.url);
    } catch (error) {
      response.stream.resume();
      response.request.destroy();
      throw new FetchError('INVALID_REDIRECT', '上游重定向地址无效', 502);
    }

    if (target.url.protocol === 'https:' && next.protocol === 'http:') {
      response.stream.resume();
      response.request.destroy();
      throw new FetchError('HTTPS_DOWNGRADE', '上游试图降级到 HTTP，已拒绝', 502);
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      response.stream.resume();
      response.request.destroy();
      throw new FetchError('INVALID_REDIRECT', '上游重定向协议不被允许', 502);
    }

    response.stream.resume();
    response.request.destroy();
    current = next.toString();
    hops += 1;
  }
}

function readAll(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    stream.on('data', (chunk) => {
      size += chunk.length;
      if (maxBytes && size > maxBytes) {
        stream.destroy();
        settle(reject, new FetchError('PAYLOAD_TOO_LARGE', '上游响应内容过大', 502));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => settle(resolve, Buffer.concat(chunks)));
    stream.on('error', (error) => {
      if (error instanceof FetchError) settle(reject, error);
      else settle(reject, new FetchError('UPSTREAM_ABORTED', '上游连接中断', 502));
    });
    stream.on('aborted', () => settle(reject, new FetchError('UPSTREAM_ABORTED', '上游连接中断', 502)));
  });
}

/*
 * 缓冲整个响应（带大小上限）。非 2xx 也会返回，由调用方决定如何处理。
 */
async function fetchBuffer(rawUrl, opts = {}) {
  const response = await open(rawUrl, opts);
  const maxBytes = opts.maxBytes || config.jsonMaxBytes;

  try {
    const body = opts.method === 'HEAD' ? Buffer.alloc(0) : await readAll(response.stream, maxBytes);
    return {
      status: response.status,
      headers: response.headers,
      body,
      url: response.url
    };
  } catch (error) {
    response.request.destroy();
    throw error;
  }
}

/*
 * 解编码：优先响应头 charset，其次 XML 声明。
 * 国内部分 Apple CMS XML 会声明 gbk；Node 20 的 TextDecoder 支持它。
 */
function detectCharset(headers, body) {
  const contentType = String((headers && headers['content-type']) || '');
  const headerMatch = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
  if (headerMatch) return headerMatch[1];

  const head = body.subarray(0, 256).toString('latin1');
  const xmlMatch = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  return xmlMatch ? xmlMatch[1] : '';
}

function decodeBody(body, headers) {
  const charset = detectCharset(headers, body);
  if (!charset || /^utf-?8$/i.test(charset)) return body.toString('utf8');

  try {
    return new TextDecoder(charset).decode(body);
  } catch (error) {
    return body.toString('utf8');
  }
}

async function fetchText(rawUrl, opts = {}) {
  const result = await fetchBuffer(rawUrl, opts);
  return {
    status: result.status,
    headers: result.headers,
    text: decodeBody(result.body, result.headers),
    url: result.url
  };
}

module.exports = {
  FetchError,
  open,
  readAll,
  fetchBuffer,
  fetchText
};

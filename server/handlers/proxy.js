'use strict';

/*
 * 签名代理：m3u8 重写为可播放地址，分片/MP4 流式转发。
 * 只接受服务端签发的 URL，签名 URL 本身就是能力凭证（不要求 Bearer 口令）。
 */

const config = require('../lib/config');
const { createRoute } = require('../lib/route');
const { ApiError } = require('../lib/http');
const { open, readAll } = require('../lib/safe-fetch');
const { createProxyPath, verifyProxyParams } = require('../lib/sign');
const { rewritePlaylist, isM3u8ContentType, isM3u8Url } = require('../lib/m3u8');
const { validateUrlSync } = require('../lib/ssrf');
const { allowPrivateFor } = require('./_common');

const PASS_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag'
];

function copyHeaders(res, headers) {
  PASS_HEADERS.forEach((name) => {
    if (headers[name] !== undefined) res.setHeader(name, headers[name]);
  });
}

function safeDestroy(request) {
  try {
    request.destroy();
  } catch (error) {
    /* 已经关闭。 */
  }
}

module.exports = createRoute(
  async (req, res) => {
    const requestUrl = new URL(req.url, 'http://local');
    const verified = verifyProxyParams(config.signingSecret, {
      u: requestUrl.searchParams.get('u'),
      exp: requestUrl.searchParams.get('exp'),
      sig: requestUrl.searchParams.get('sig')
    });

    const targetUrl = verified.url;
    const allowPrivate = allowPrivateFor(req);
    validateUrlSync(targetUrl, { allowPrivate });

    const segProxy = requestUrl.searchParams.get('seg') === 'proxy';
    const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
    const headers = {};

    if (req.headers.range) headers.range = String(req.headers.range);
    if (segProxy) {
      try {
        headers.referer = new URL(targetUrl).origin + '/';
      } catch (error) {
        /* 无 Referer。 */
      }
    }

    let upstream;
    try {
      upstream = await open(targetUrl, {
        method,
        headers,
        timeoutMs: config.proxyTimeoutMs,
        maxRedirects: config.redirectMax,
        allowPrivate
      });
    } catch (error) {
      throw error;
    }

    const contentType = String(upstream.headers['content-type'] || '');
    const looksLikePlaylist =
      isM3u8ContentType(contentType) ||
      (isM3u8Url(targetUrl) && !/^video\/|^audio\//i.test(contentType));

    const onClose = () => {
      // Serverless 运行时可能提前触发 close；只在确实没写完时中断上游。
      if (!res.writableEnded) safeDestroy(upstream.request);
    };
    res.on('close', onClose);

    // EdgeOne 等平台有单次响应大小上限；提前用 Content-Length 拦截，避免传到一半才失败。
    const declaredLength = Number(upstream.headers['content-length']);
    if (method === 'GET' && Number.isFinite(declaredLength) && declaredLength > config.proxyMaxBytes) {
      safeDestroy(upstream.request);
      res.removeListener('close', onClose);
      throw new ApiError(
        502,
        'PROXY_RESPONSE_TOO_LARGE',
        '片源响应超过当前部署的单次响应大小上限'
      );
    }

    try {
      if (method === 'GET' && upstream.status === 200 && looksLikePlaylist) {
        const body = await readAll(upstream.stream, config.m3u8MaxBytes);
        const remainingMs = Math.max(10 * 60 * 1000, verified.exp * 1000 - Date.now());

        const text = rewritePlaylist(body.toString('utf8'), upstream.url, {
          proxySegments: segProxy,
          makeProxyUrl: (childUrl) => {
            const path = createProxyPath(config.signingSecret, childUrl, { ttlMs: remainingMs });
            return segProxy ? path + '&seg=proxy' : path;
          }
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(text);
        return;
      }

      res.statusCode = upstream.status || 502;
      copyHeaders(res, upstream.headers);

      if (method === 'HEAD') {
        upstream.stream.resume();
        safeDestroy(upstream.request);
        res.end();
        return;
      }

      let bytes = 0;
      let aborted = false;

      upstream.stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > config.proxyMaxBytes && !aborted) {
          aborted = true;
          safeDestroy(upstream.request);
          res.destroy();
        }
      });

      upstream.stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });

      upstream.stream.pipe(res);
    } catch (error) {
      safeDestroy(upstream.request);
      throw error;
    } finally {
      res.once('finish', () => {
        res.removeListener('close', onClose);
      });
    }
  },
  {
    auth: false,
    wildcardCors: true,
    rateKey: 'proxy',
    methods: ['GET', 'HEAD', 'OPTIONS']
  }
);

'use strict';

/* 订阅拉取：只接受 JSON（LibreTV-SourceList / 裸数组 / TVBox CMS），不解析 HTML。 */

const config = require('../lib/config');
const { createRoute } = require('../lib/route');
const { readJson, sendJson, ApiError } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const { validateUrlSync, SsrfError } = require('../lib/ssrf');
const { parseSubscription } = require('../lib/source-list');
const { allowPrivateFor, parseCmsJson } = require('./_common');

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);

    if (body.authorized !== true) {
      throw new ApiError(400, 'AUTHORIZATION_REQUIRED', '请先确认你已获得该订阅的使用授权');
    }

    const allowPrivate = allowPrivateFor(req);

    let url;
    try {
      url = validateUrlSync(String(body.url || ''), { allowPrivate }).toString();
    } catch (error) {
      if (error instanceof SsrfError) {
        throw new ApiError(400, error.code, '订阅地址不被允许：' + error.message);
      }
      throw error;
    }

    const response = await fetchText(url, {
      timeoutMs: config.subscriptionTimeoutMs,
      maxBytes: config.subscriptionMaxBytes,
      allowPrivate
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(502, 'SUBSCRIPTION_HTTP', '订阅地址返回 HTTP ' + response.status);
    }

    const payload = parseCmsJson(response.text);
    const parsed = parseSubscription(payload);

    sendJson(res, 200, Object.assign({ ok: true }, parsed));
  },
  { auth: true, rateKey: 'subscription', methods: ['POST', 'OPTIONS'] }
);

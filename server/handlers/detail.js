'use strict';

/* 远程详情：只请求 Apple CMS ?ac=videolist&ids=，不抓 HTML 页面。 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson, ApiError } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const { createProxyPath } = require('../lib/sign');
const {
  allowPrivateFor,
  normalizeSource,
  parseCmsJson,
  ensureUpstreamOk
} = require('./_common');

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);
    const allowPrivate = allowPrivateFor(req);
    const source = normalizeSource(body.source, allowPrivate);
    const vodId = String(body.id || '').trim();

    if (!vodId || vodId.length > 120) {
      throw new ApiError(400, 'VOD_ID_REQUIRED', '缺少影片 ID');
    }

    const response = await fetchText(cms.detailUrl(source.url, vodId), {
      timeoutMs: config.detailTimeoutMs,
      maxBytes: config.jsonMaxBytes,
      allowPrivate
    });
    ensureUpstreamOk(response);

    const data = parseCmsJson(response.text);
    const makeProxyUrl = (target) =>
      createProxyPath(config.signingSecret, target, { ttlSeconds: config.proxyTtlSeconds });

    const item = cms.buildDetailItem(data, { source, vodId, proxyUrl: makeProxyUrl });

    sendJson(res, 200, {
      ok: true,
      item,
      fetchedAt: Date.now()
    });
  },
  { auth: true, rateKey: 'detail', methods: ['POST', 'OPTIONS'] }
);

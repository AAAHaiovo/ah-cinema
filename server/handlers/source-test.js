'use strict';

/* 单源测活：请求第一页搜索，能解析出 list 数组即视为可用。 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson, ApiError } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const { validateUrlSync, SsrfError } = require('../lib/ssrf');
const { allowPrivateFor, parseCmsJson, upstreamErrorMessage } = require('./_common');
const { stripTrailingSlash } = require('../lib/text');

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return '';
  }
}

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);
    const allowPrivate = allowPrivateFor(req);

    let url;
    try {
      url = stripTrailingSlash(validateUrlSync(String(body.url || ''), { allowPrivate }).toString());
    } catch (error) {
      if (error instanceof SsrfError) {
        throw new ApiError(400, error.code, '源地址不被允许：' + error.message);
      }
      throw error;
    }

    const startedAt = Date.now();

    try {
      const response = await fetchText(cms.searchUrl(url, '测试', 1), {
        timeoutMs: config.testTimeoutMs,
        maxBytes: config.jsonMaxBytes,
        allowPrivate
      });

      if (response.status < 200 || response.status >= 300) {
        sendJson(res, 200, {
          ok: false,
          ms: Date.now() - startedAt,
          error: '源站返回 HTTP ' + response.status
        });
        return;
      }

      const data = parseCmsJson(response.text);
      const parsed = cms.parseSearchResponse(data);

      if (!parsed.listIsArray) {
        sendJson(res, 200, {
          ok: false,
          ms: Date.now() - startedAt,
          error: '源站没有返回 Apple CMS 的 list 列表'
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        ms: Date.now() - startedAt,
        count: parsed.items.length,
        name: hostOf(url)
      });
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        ms: Date.now() - startedAt,
        error: upstreamErrorMessage(error, false)
      });
    }
  },
  { auth: true, rateKey: 'sourceTest', methods: ['POST', 'OPTIONS'] }
);

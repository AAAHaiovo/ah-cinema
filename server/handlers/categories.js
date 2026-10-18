'use strict';

/*
 * 分类目录：并行请求每个源，解析 Apple CMS 的 ?ac=list 返回的 class 数组。
 * 单源失败不影响其他源；前端按分类名称合并，并按源映射各自的 type_id。
 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const {
  allowPrivateFor,
  normalizeSourceList,
  parseCmsJson,
  ensureUpstreamOk,
  upstreamErrorMessage
} = require('./_common');

async function classesOne(source, { allowPrivate, signal }) {
  const startedAt = Date.now();
  const response = await fetchText(cms.listUrl(source.url), {
    timeoutMs: config.searchSourceTimeoutMs,
    maxBytes: config.jsonMaxBytes,
    allowPrivate,
    signal
  });
  ensureUpstreamOk(response);

  const classes = cms.parseClassList(parseCmsJson(response.text));
  return { classes, ms: Date.now() - startedAt };
}

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);
    const allowPrivate = allowPrivateFor(req);
    const sources = normalizeSourceList(body.sources, allowPrivate);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.searchTotalTimeoutMs);

    const onClientGone = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClientGone);

    try {
      const results = await Promise.all(
        sources.map(async (source) => {
          const startedAt = Date.now();
          try {
            const result = await classesOne(source, {
              allowPrivate,
              signal: controller.signal
            });
            return {
              sourceId: source.id,
              sourceName: source.name,
              ok: true,
              ms: result.ms,
              count: result.classes.length,
              classes: result.classes
            };
          } catch (error) {
            return {
              sourceId: source.id,
              sourceName: source.name,
              ok: false,
              ms: Date.now() - startedAt,
              count: 0,
              classes: [],
              timedOut: controller.signal.aborted,
              error: upstreamErrorMessage(error, controller.signal.aborted)
            };
          }
        })
      );

      const total = results.reduce((sum, result) => sum + result.classes.length, 0);
      sendJson(res, 200, { ok: true, total, sources: results });
    } finally {
      clearTimeout(timer);
      res.removeListener('close', onClientGone);
    }
  },
  { auth: true, rateKey: 'search', methods: ['POST', 'OPTIONS'] }
);

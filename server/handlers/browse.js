'use strict';

/*
 * 首页片库：并行拉取每个已启用源的最新影片列表。
 * 使用 Apple CMS 的 ?ac=videolist&pg=N（不带关键词），单源失败不影响其他源。
 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson, ApiError } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const {
  allowPrivateFor,
  normalizeSource,
  parseCmsJson,
  ensureUpstreamOk,
  upstreamErrorMessage
} = require('./_common');

const MAX_PAGE = 20;

function normalizeSources(rawList, allowPrivate) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new ApiError(400, 'SOURCES_REQUIRED', '请先添加并启用至少一个源');
  }
  if (rawList.length > config.maxSources) {
    throw new ApiError(400, 'TOO_MANY_SOURCES', '一次最多使用 ' + config.maxSources + ' 个源');
  }

  const seen = new Set();
  const sources = [];
  rawList.forEach((raw) => {
    const source = normalizeSource(raw, allowPrivate);
    if (seen.has(source.url)) return;
    seen.add(source.url);
    sources.push(source);
  });

  if (!sources.length) {
    throw new ApiError(400, 'SOURCES_REQUIRED', '请先添加并启用至少一个源');
  }
  return sources;
}

async function browseOne(source, page, { allowPrivate, signal }) {
  const startedAt = Date.now();
  const response = await fetchText(cms.browseUrl(source.url, page), {
    timeoutMs: config.searchSourceTimeoutMs,
    maxBytes: config.jsonMaxBytes,
    allowPrivate,
    signal
  });
  ensureUpstreamOk(response);

  const parsed = cms.parseSearchResponse(parseCmsJson(response.text));
  return {
    items: parsed.items.map((entry) =>
      Object.assign({}, entry, { sourceId: source.id, sourceName: source.name })
    ),
    pagecount: parsed.pagecount,
    ms: Date.now() - startedAt
  };
}

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);
    const page = Math.min(Math.max(1, Number.parseInt(body.page, 10) || 1), MAX_PAGE);
    const allowPrivate = allowPrivateFor(req);
    const sources = normalizeSources(body.sources, allowPrivate);

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
            const result = await browseOne(source, page, {
              allowPrivate,
              signal: controller.signal
            });
            return {
              sourceId: source.id,
              sourceName: source.name,
              ok: true,
              page,
              pagecount: result.pagecount,
              ms: result.ms,
              count: result.items.length,
              items: result.items
            };
          } catch (error) {
            return {
              sourceId: source.id,
              sourceName: source.name,
              ok: false,
              page,
              pagecount: 0,
              ms: Date.now() - startedAt,
              count: 0,
              items: [],
              timedOut: controller.signal.aborted,
              error: upstreamErrorMessage(error, controller.signal.aborted)
            };
          }
        })
      );

      const total = results.reduce((sum, result) => sum + result.items.length, 0);
      sendJson(res, 200, { ok: true, page, total, sources: results });
    } finally {
      clearTimeout(timer);
      res.removeListener('close', onClientGone);
    }
  },
  { auth: true, rateKey: 'search', methods: ['POST', 'OPTIONS'] }
);

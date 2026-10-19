'use strict';

/* 多源并行搜索。默认 NDJSON 流式返回，单源失败不影响其他源。 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson, startNdjson, writeNdjson, endNdjson, ApiError } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const {
  allowPrivateFor,
  normalizeSource,
  parseCmsPayload,
  ensureUpstreamOk,
  upstreamErrorMessage
} = require('./_common');

function normalizeSources(rawList, allowPrivate) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new ApiError(400, 'SOURCES_REQUIRED', '请先添加并启用至少一个源');
  }
  if (rawList.length > config.maxSources) {
    throw new ApiError(400, 'TOO_MANY_SOURCES', '一次最多搜索 ' + config.maxSources + ' 个源');
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

async function searchOne(source, query, { allowPrivate, signal, flags }) {
  const startedAt = Date.now();
  const items = [];
  let page = 1;
  let pagecount = 1;

  while (page <= config.searchMaxPages) {
    if (signal.aborted) {
      flags.timedOut = true;
      throw new Error('aborted');
    }

    const response = await fetchText(cms.searchUrl(source.url, query, page), {
      timeoutMs: config.searchSourceTimeoutMs,
      maxBytes: config.jsonMaxBytes,
      allowPrivate,
      signal
    });
    ensureUpstreamOk(response);

    const parsed = cms.parseSearchResponse(parseCmsPayload(response.text));
    parsed.items.forEach((entry) => {
      items.push(Object.assign({}, entry, { sourceId: source.id, sourceName: source.name }));
    });

    pagecount = parsed.pagecount;
    if (!parsed.items.length || page >= pagecount) break;
    page += 1;
  }

  return { items, ms: Date.now() - startedAt };
}

async function runSource(source, query, context) {
  const { allowPrivate, totalSignal } = context;
  const controller = new AbortController();
  const flags = { timedOut: false };
  const onAbort = () => {
    flags.timedOut = true;
    controller.abort();
  };

  if (totalSignal.aborted) onAbort();
  else totalSignal.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(() => {
    flags.timedOut = true;
    controller.abort();
  }, config.searchSourceTimeoutMs);

  try {
    const result = await searchOne(source, query, {
      allowPrivate,
      signal: controller.signal,
      flags
    });
    return { ok: true, ms: result.ms, items: result.items };
  } catch (error) {
    return {
      ok: false,
      timedOut: flags.timedOut,
      error: upstreamErrorMessage(error, flags.timedOut)
    };
  } finally {
    clearTimeout(timer);
    totalSignal.removeEventListener('abort', onAbort);
  }
}

module.exports = createRoute(
  async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const wantsStream =
      url.searchParams.get('stream') !== '0' &&
      !/application\/json/i.test(String(req.headers.accept || ''));

    const body = await readJson(req, config.bodyMaxBytes);
    const query = String(body.q || '').trim();
    if (!query) throw new ApiError(400, 'QUERY_REQUIRED', '请输入搜索关键词');
    if (query.length > 80) throw new ApiError(400, 'QUERY_TOO_LONG', '搜索关键词太长');

    const allowPrivate = allowPrivateFor(req);
    const sources = normalizeSources(body.sources, allowPrivate);

    const totalController = new AbortController();
    const totalTimer = setTimeout(() => {
      totalController.abort();
    }, config.searchTotalTimeoutMs);

    const onClientGone = () => {
      if (!res.writableEnded) totalController.abort();
    };
    res.on('close', onClientGone);

    const seen = new Set();
    const results = [];
    let total = 0;
    let okCount = 0;
    let failCount = 0;

    if (wantsStream) {
      startNdjson(res);
      writeNdjson(res, { type: 'start', sources: sources.length });
    }

    try {
      await Promise.all(
        sources.map(async (source) => {
          const result = await runSource(source, query, {
            allowPrivate,
            totalSignal: totalController.signal
          });

          if (result.ok) {
            const unique = [];
            result.items.forEach((item) => {
              const key = source.id + '_' + item.vodId;
              if (seen.has(key)) return;
              seen.add(key);
              unique.push(item);
            });

            total += unique.length;
            okCount += 1;

            const payload = {
              sourceId: source.id,
              sourceName: source.name,
              ok: true,
              ms: result.ms,
              count: unique.length,
              items: unique
            };
            results.push(payload);
            if (wantsStream) writeNdjson(res, Object.assign({ type: 'source' }, payload));
          } else {
            failCount += 1;
            const payload = {
              sourceId: source.id,
              sourceName: source.name,
              ok: false,
              timedOut: Boolean(result.timedOut),
              error: result.error,
              count: 0,
              items: []
            };
            results.push(payload);
            if (wantsStream) writeNdjson(res, Object.assign({ type: 'source' }, payload));
          }
        })
      );

      if (wantsStream) {
        writeNdjson(res, { type: 'done', total, okCount, failCount });
        endNdjson(res);
      } else {
        sendJson(res, 200, { ok: true, total, okCount, failCount, results });
      }
    } finally {
      clearTimeout(totalTimer);
      res.removeListener('close', onClientGone);
    }
  },
  { auth: true, rateKey: 'search', methods: ['POST', 'OPTIONS'] }
);

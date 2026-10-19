'use strict';

/*
 * 首页片库：并行拉取每个已启用源的最新影片列表。
 *
 * 一个源可能对应多个分类 type_id（例如「电影 → 全部」要聚合该组所有子类型）。
 * Apple CMS 一次只接受一个 t，所以这里按 type_id 拆成任务、限制并发后合并。
 * 单源失败不影响其他源；部分分类失败时仍返回已成功的数据。
 */

const config = require('../lib/config');
const cms = require('../lib/cms');
const { createRoute } = require('../lib/route');
const { readJson, sendJson } = require('../lib/http');
const { fetchText } = require('../lib/safe-fetch');
const {
  allowPrivateFor,
  normalizeSourceList,
  parseCmsPayload,
  ensureUpstreamOk,
  upstreamErrorMessage
} = require('./_common');

async function fetchType(source, page, typeId, { allowPrivate, signal }) {
  const startedAt = Date.now();
  const response = await fetchText(cms.browseUrl(source.url, page, typeId), {
    timeoutMs: config.searchSourceTimeoutMs,
    maxBytes: config.jsonMaxBytes,
    allowPrivate,
    signal
  });
  ensureUpstreamOk(response);

  const parsed = cms.parseSearchResponse(parseCmsPayload(response.text));
  return { parsed, ms: Date.now() - startedAt };
}

/* 小并发池：避免一次聚合几十个分类时把源站打爆。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.min(Math.max(1, Number(limit) || 1), items.length || 1);

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
}

module.exports = createRoute(
  async (req, res) => {
    const body = await readJson(req, config.bodyMaxBytes);
    const requestedPage = Number.parseInt(body.page, 10);
    const page = Number.isFinite(requestedPage)
      ? Math.min(Math.max(1, requestedPage), config.browseMaxPage)
      : 1;
    const allowPrivate = allowPrivateFor(req);
    const sources = normalizeSourceList(body.sources, allowPrivate);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.browseTotalTimeoutMs);

    const onClientGone = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClientGone);

    try {
      const tasks = [];
      sources.forEach((source) => {
        const typeIds =
          Array.isArray(source.typeIds) && source.typeIds.length ? source.typeIds : [''];
        typeIds.forEach((typeId) => tasks.push({ source, typeId }));
      });

      const taskResults = await mapLimit(tasks, config.browseConcurrency, async (task) => {
        try {
          const result = await fetchType(task.source, page, task.typeId, {
            allowPrivate,
            signal: controller.signal
          });
          return {
            ok: true,
            source: task.source,
            typeId: task.typeId,
            parsed: result.parsed,
            ms: result.ms
          };
        } catch (error) {
          return {
            ok: false,
            source: task.source,
            typeId: task.typeId,
            error,
            timedOut: controller.signal.aborted,
            ms: 0
          };
        }
      });

      const bySource = new Map();
      sources.forEach((source) => {
        bySource.set(source.id, {
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          page,
          pagecount: 0,
          total: 0,
          count: 0,
          items: [],
          typeCount: 0,
          okTypes: 0,
          failedTypes: 0,
          partial: false,
          ms: 0,
          timedOut: false,
          error: ''
        });
      });

      taskResults.forEach((result) => {
        const entry = bySource.get(result.source.id);
        if (!entry) return;

        entry.typeCount += 1;
        entry.ms = Math.max(entry.ms, Number(result.ms) || 0);

        if (result.ok) {
          entry.okTypes += 1;
          entry.pagecount = Math.max(entry.pagecount, Number(result.parsed.pagecount) || 0);
          entry.total += Math.max(
            0,
            Number(result.parsed.total) || 0,
            result.parsed.items.length
          );
          result.parsed.items.forEach((item) => {
            entry.items.push(
              Object.assign({}, item, { sourceId: entry.sourceId, sourceName: entry.sourceName })
            );
          });
          return;
        }

        entry.failedTypes += 1;
        if (result.timedOut) entry.timedOut = true;
        if (!entry.error) {
          entry.error = upstreamErrorMessage(
            result.error,
            result.timedOut || controller.signal.aborted
          );
        }
      });

      const results = sources.map((source) => {
        const entry = bySource.get(source.id);
        const seen = new Set();

        entry.items = entry.items.filter((item) => {
          if (!item.vodId || seen.has(item.vodId)) return false;
          seen.add(item.vodId);
          return true;
        });
        entry.count = entry.items.length;
        entry.ok = entry.okTypes > 0;
        entry.partial = entry.okTypes > 0 && entry.failedTypes > 0;
        entry.pagecount = entry.ok ? Math.max(1, entry.pagecount) : 0;
        entry.total = entry.ok ? entry.total : 0;
        entry.error = entry.error || (entry.partial ? '部分分类加载失败' : '');

        if (!entry.ok) {
          entry.items = [];
          entry.count = 0;
          entry.pagecount = 0;
          entry.total = 0;
          entry.error = entry.error || (entry.timedOut ? '请求超时' : '加载失败');
        }

        return entry;
      });

      const total = results.reduce((sum, result) => sum + result.items.length, 0);
      const worksTotal = results.reduce(
        (sum, result) => sum + (result.ok ? result.total : 0),
        0
      );

      sendJson(res, 200, { ok: true, page, total, worksTotal, sources: results });
    } finally {
      clearTimeout(timer);
      res.removeListener('close', onClientGone);
    }
  },
  { auth: true, rateKey: 'search', methods: ['POST', 'OPTIONS'] }
);

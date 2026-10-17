'use strict';

/* best-effort 内存限流；Serverless 多实例下只作为补充，不当成强保证。 */

const buckets = new Map();
const MAX_BUCKETS = 5000;

function nowMs() {
  return Date.now();
}

function cleanup(now) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (!bucket || bucket.resetAt <= now) buckets.delete(key);
  }
}

/*
 * 返回 { ok, remaining, retryAfterSeconds }。
 */
function hit(key, limit, windowMs) {
  const now = nowMs();
  const safeLimit = Math.max(1, Number(limit) || 1);
  const window = Math.max(1000, Number(windowMs) || 60000);
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + window };
    buckets.set(key, bucket);
    cleanup(now);
  }

  bucket.count += 1;

  if (bucket.count > safeLimit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  return {
    ok: true,
    remaining: safeLimit - bucket.count,
    retryAfterSeconds: 0
  };
}

function reset() {
  buckets.clear();
}

module.exports = { hit, reset };

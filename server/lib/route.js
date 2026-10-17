'use strict';

/* 统一包装 API handler：CORS、方法、缺口令、鉴权、限流、错误与日志。 */

const config = require('./config');
const { checkAuth } = require('./auth');
const { applyHeaders, handlePreflight, checkOrigin } = require('./cors');
const { ApiError, sendError, clientIp, logRequest } = require('./http');
const rateLimit = require('./rate-limit');

function createRoute(handler, options = {}) {
  const methods = options.methods || ['GET', 'HEAD', 'OPTIONS'];
  const wildcard = Boolean(options.wildcardCors);

  return async function routeHandler(req, res) {
    const startedAt = Date.now();
    let status = 200;

    try {
      if (handlePreflight(req, res, config, { wildcard })) {
        status = 204;
        return;
      }

      applyHeaders(req, res, config, { wildcard });

      if (!checkOrigin(req, config, { wildcard })) {
        throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '来源不被允许');
      }

      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持这个请求方法');
      }

      if (options.requireConfigured !== false && !config.configured) {
        throw new ApiError(503, 'NOT_CONFIGURED', '服务端还没有配置访问口令或签名密钥');
      }

      if (options.auth) {
        const result = checkAuth(req, config);
        if (!result.ok) throw new ApiError(result.status, result.code, result.message);
      }

      if (options.rateKey) {
        const limit = config.rateLimits[options.rateKey];
        if (limit) {
          const result = rateLimit.hit(
            options.rateKey + ':' + clientIp(req),
            limit.limit,
            limit.windowMs
          );
          if (!result.ok) {
            res.setHeader('Retry-After', String(result.retryAfterSeconds));
            throw new ApiError(429, 'RATE_LIMITED', '请求太频繁了，请稍后再试');
          }
        }
      }

      await handler(req, res);
    } catch (error) {
      status = error && error.status ? error.status : 500;
      sendError(res, error);

      if (config.mode !== 'production') {
        const code = (error && error.code) || 'INTERNAL_ERROR';
        console.warn('[api] ' + req.method + ' ' + String(req.url || '').split('?')[0] + ' → ' + code);
      }
    } finally {
      logRequest(req, status, startedAt);
    }
  };
}

module.exports = { createRoute };

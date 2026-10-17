'use strict';

/* HTTP 辅助：统一错误、JSON body 限长、NDJSON 输出、客户端 IP。 */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = Number(status) || 500;
    this.code = code || 'REQUEST_FAILED';
  }
}

function applyBaseHeaders(res) {
  if (!res.headersSent) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
}

function sendJson(res, status, data, headers) {
  if (res.writableEnded) return;
  applyBaseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (headers) {
    Object.keys(headers).forEach((name) => res.setHeader(name, headers[name]));
  }
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  if (res.writableEnded) return;

  // 已经进入流式响应时无法再改状态码，只能结束连接。
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: error.message, code: error.code });
    return;
  }

  if (error && error.status && error.code) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    sendJson(res, status, { error: error.message || '请求失败', code: error.code });
    return;
  }

  // 不把内部堆栈返回给浏览器，也不写日志里的敏感信息。
  sendJson(res, 500, { error: '服务暂时不可用，请稍后重试', code: 'INTERNAL_ERROR' });
}

function parseJsonText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw new ApiError(400, 'INVALID_JSON', '请求内容不是有效 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_JSON', '请求内容格式不正确');
  }
  return parsed;
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Vercel Node 运行时可能已经解析过 body，此时直接复用。
    if (req.body !== undefined && req.body !== null) {
      try {
        if (Buffer.isBuffer(req.body)) resolve(parseJsonText(req.body.toString('utf8')));
        else if (typeof req.body === 'string') resolve(req.body.trim() ? parseJsonText(req.body) : {});
        else if (typeof req.body === 'object') resolve(req.body);
        else reject(new ApiError(400, 'INVALID_JSON', '请求内容格式不正确'));
      } catch (error) {
        reject(error);
      }
      return;
    }

    const limit = Math.max(1, Number(maxBytes) || 64 * 1024);
    const chunks = [];
    let size = 0;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        settle(reject, new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        settle(resolve, {});
        return;
      }
      try {
        settle(resolve, parseJsonText(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        settle(reject, error);
      }
    });

    req.on('error', () => {
      settle(reject, new ApiError(400, 'REQUEST_ABORTED', '请求中断'));
    });
  });
}

function startNdjson(res) {
  applyBaseHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function writeNdjson(res, payload) {
  if (res.writableEnded) return;
  res.write(JSON.stringify(payload) + '\n');
}

function endNdjson(res) {
  if (!res.writableEnded) res.end();
}

function clientIp(req) {
  const forwarded = String((req && req.headers && req.headers['x-forwarded-for']) || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;
  if (req && req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
  return 'unknown';
}

/* 只记录方法、路径、状态与耗时，不打印 token / 签名 / 完整上游地址。 */
function logRequest(req, status, startedAt) {
  const ms = Date.now() - startedAt;
  const path = String((req && req.url) || '').split('?')[0];
  console.log('[' + new Date().toISOString() + '] ' + (req.method || 'GET') + ' ' + path + ' ' + status + ' ' + ms + 'ms');
}

module.exports = {
  ApiError,
  sendJson,
  sendError,
  readJson,
  startNdjson,
  writeNdjson,
  endNdjson,
  clientIp,
  logRequest
};

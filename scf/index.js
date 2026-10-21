"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// server/lib/http.js
var require_http = __commonJS({
  "server/lib/http.js"(exports2, module2) {
    "use strict";
    var ApiError = class extends Error {
      constructor(status, code, message) {
        super(message || "\u8BF7\u6C42\u5931\u8D25");
        this.name = "ApiError";
        this.status = Number(status) || 500;
        this.code = code || "REQUEST_FAILED";
      }
    };
    function applyBaseHeaders(res) {
      if (!res.headersSent) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
      }
    }
    function sendJson2(res, status, data, headers) {
      if (res.writableEnded) return;
      applyBaseHeaders(res);
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      if (headers) {
        Object.keys(headers).forEach((name) => res.setHeader(name, headers[name]));
      }
      res.end(JSON.stringify(data));
    }
    function sendError(res, error) {
      if (res.writableEnded) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        sendJson2(res, error.status, { error: error.message, code: error.code });
        return;
      }
      if (error && error.status && error.code) {
        const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
        sendJson2(res, status, { error: error.message || "\u8BF7\u6C42\u5931\u8D25", code: error.code });
        return;
      }
      sendJson2(res, 500, { error: "\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", code: "INTERNAL_ERROR" });
    }
    function parseJsonText(text) {
      let parsed;
      try {
        parsed = JSON.parse(String(text || ""));
      } catch (error) {
        throw new ApiError(400, "INVALID_JSON", "\u8BF7\u6C42\u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ApiError(400, "INVALID_JSON", "\u8BF7\u6C42\u5185\u5BB9\u683C\u5F0F\u4E0D\u6B63\u786E");
      }
      return parsed;
    }
    function readJson(req, maxBytes) {
      return new Promise((resolve, reject) => {
        if (req.body !== void 0 && req.body !== null) {
          try {
            if (Buffer.isBuffer(req.body)) resolve(parseJsonText(req.body.toString("utf8")));
            else if (typeof req.body === "string") resolve(req.body.trim() ? parseJsonText(req.body) : {});
            else if (typeof req.body === "object") resolve(req.body);
            else reject(new ApiError(400, "INVALID_JSON", "\u8BF7\u6C42\u5185\u5BB9\u683C\u5F0F\u4E0D\u6B63\u786E"));
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
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > limit) {
            settle(reject, new ApiError(413, "BODY_TOO_LARGE", "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927"));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (!chunks.length) {
            settle(resolve, {});
            return;
          }
          try {
            settle(resolve, parseJsonText(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            settle(reject, error);
          }
        });
        req.on("error", () => {
          settle(reject, new ApiError(400, "REQUEST_ABORTED", "\u8BF7\u6C42\u4E2D\u65AD"));
        });
      });
    }
    function startNdjson(res) {
      applyBaseHeaders(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
    }
    function writeNdjson(res, payload) {
      if (res.writableEnded) return;
      res.write(JSON.stringify(payload) + "\n");
    }
    function endNdjson(res) {
      if (!res.writableEnded) res.end();
    }
    function clientIp(req) {
      const forwarded = String(req && req.headers && req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (forwarded) return forwarded;
      if (req && req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
      return "unknown";
    }
    function logRequest(req, status, startedAt) {
      const ms = Date.now() - startedAt;
      const path = String(req && req.url || "").split("?")[0];
      console.log("[" + (/* @__PURE__ */ new Date()).toISOString() + "] " + (req.method || "GET") + " " + path + " " + status + " " + ms + "ms");
    }
    module2.exports = {
      ApiError,
      sendJson: sendJson2,
      sendError,
      readJson,
      startNdjson,
      writeNdjson,
      endNdjson,
      clientIp,
      logRequest
    };
  }
});

// server/lib/config.js
var require_config = __commonJS({
  "server/lib/config.js"(exports2, module2) {
    "use strict";
    var explicitMode = String(process.env.AH_ENV || "").trim().toLowerCase();
    var MODE = explicitMode || (process.env.VERCEL || process.env.NODE_ENV === "production" ? "production" : "development");
    var IS_PRODUCTION = MODE === "production";
    var IS_VERCEL = Boolean(process.env.VERCEL);
    function stringEnv(name, fallback = "") {
      const value = process.env[name];
      return typeof value === "string" ? value.trim() : fallback;
    }
    function intEnv(name, fallback, min, max) {
      const raw = stringEnv(name);
      if (!raw) return fallback;
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value)) return fallback;
      return Math.min(max, Math.max(min, value));
    }
    function boolEnv(name) {
      const raw = stringEnv(name).toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    }
    function splitList(raw) {
      return String(raw || "").split(",").map((entry) => entry.trim().replace(/\/+$/, "")).filter(Boolean);
    }
    var apiToken = stringEnv("AH_API_TOKEN");
    var signingSecret = stringEnv("AH_SIGNING_SECRET");
    var devSigningSecret = "ah-dev-only-insecure-signing-secret";
    var missingEnv = [];
    if (IS_PRODUCTION) {
      if (!apiToken) missingEnv.push("AH_API_TOKEN");
      if (!signingSecret) missingEnv.push("AH_SIGNING_SECRET");
    }
    var defaultOrigins = [
      "https://aaahaiovo.github.io",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ];
    var allowedOrigins = Array.from(new Set(defaultOrigins.concat(splitList(process.env.AH_ALLOWED_ORIGINS))));
    var config = {
      mode: MODE,
      isProduction: IS_PRODUCTION,
      isVercel: IS_VERCEL,
      version: "0.8.10",
      apiVersion: 1,
      apiToken,
      signingSecret: signingSecret || devSigningSecret,
      hasSigningSecret: Boolean(signingSecret),
      authRequired: Boolean(apiToken),
      // 仅开发环境、仅 loopback 请求可跳过口令 / 允许私网地址。
      devNoAuth: !IS_PRODUCTION && boolEnv("AH_DEV_NO_AUTH"),
      devAllowPrivate: !IS_PRODUCTION && boolEnv("AH_DEV_ALLOW_PRIVATE"),
      missingEnv,
      configured: missingEnv.length === 0,
      allowedOrigins,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AH-Cinema/0.8.10",
      maxSources: 8,
      searchMaxPages: intEnv("AH_SEARCH_MAX_PAGES", 2, 1, 5),
      searchSourceTimeoutMs: 5e3,
      searchTotalTimeoutMs: 8e3,
      browseMaxPage: 1e5,
      browseTotalTimeoutMs: 18e3,
      browseConcurrency: intEnv("AH_BROWSE_CONCURRENCY", 6, 1, 12),
      detailTimeoutMs: 6e3,
      testTimeoutMs: 5e3,
      subscriptionTimeoutMs: 8e3,
      proxyTimeoutMs: 15e3,
      redirectMax: 3,
      bodyMaxBytes: 64 * 1024,
      jsonMaxBytes: 2 * 1024 * 1024,
      subscriptionMaxBytes: 100 * 1024,
      m3u8MaxBytes: 2 * 1024 * 1024,
      posterMaxBytes: 0,
      proxyTtlSeconds: intEnv("AH_PROXY_TTL_SECONDS", 43200, 60, 86400),
      proxyMaxBytes: intEnv("AH_PROXY_MAX_BYTES", 20 * 1024 * 1024, 1024, 100 * 1024 * 1024),
      proxySegmentTtlSeconds: 6 * 60 * 60,
      rateLimits: {
        search: { limit: 60, windowMs: 60 * 1e3 },
        detail: { limit: 120, windowMs: 60 * 1e3 },
        sourceTest: { limit: 30, windowMs: 60 * 1e3 },
        subscription: { limit: 20, windowMs: 60 * 1e3 },
        proxy: { limit: 1200, windowMs: 60 * 1e3 }
      },
      // 明显的成人分类，直接丢弃（不做标题相关性过滤）。
      adultKeywords: ["\u4F26\u7406", "\u60C5\u8272", "\u8272\u60C5", "\u6210\u4EBA", "\u4E09\u7EA7", "\u91CC\u756A", "\u65E0\u7801", "\u6709\u7801", "\u4E2D\u6587\u5B57\u5E55\u65E0\u7801"]
    };
    module2.exports = config;
  }
});

// server/lib/ssrf.js
var require_ssrf = __commonJS({
  "server/lib/ssrf.js"(exports2, module2) {
    "use strict";
    var dns = require("dns").promises;
    var net = require("net");
    var SsrfError = class extends Error {
      constructor(code, message) {
        super(message || "\u8BF7\u6C42\u5730\u5740\u4E0D\u88AB\u5141\u8BB8");
        this.name = "SsrfError";
        this.code = code || "URL_BLOCKED";
        this.status = 403;
      }
    };
    var BLOCKED_HOSTNAMES = [
      "localhost",
      "metadata",
      "metadata.google.internal",
      "instance-data"
    ];
    var BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];
    var BLOCKED_IPV4_RANGES = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4]
    ];
    function ipv4ToInt(ip) {
      const parts = String(ip || "").split(".");
      if (parts.length !== 4) return null;
      let value = 0;
      for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const number = Number(part);
        if (number > 255) return null;
        value = value * 256 + number;
      }
      return value >>> 0;
    }
    function intToIpv4(value) {
      return [
        value >>> 24 & 255,
        value >>> 16 & 255,
        value >>> 8 & 255,
        value & 255
      ].join(".");
    }
    function inIpv4Range(value, base, bits) {
      const baseValue = ipv4ToInt(base);
      if (baseValue === null) return false;
      const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    }
    function isPrivateIPv4(ip) {
      const value = ipv4ToInt(ip);
      if (value === null) return false;
      return BLOCKED_IPV4_RANGES.some(([base, bits]) => inIpv4Range(value, base, bits));
    }
    function isLoopbackIPv4(ip) {
      const value = ipv4ToInt(ip);
      if (value === null) return false;
      return inIpv4Range(value, "127.0.0.0", 8);
    }
    function parseIPv6(input) {
      let text = String(input || "").toLowerCase();
      const zone = text.indexOf("%");
      if (zone >= 0) text = text.slice(0, zone);
      if (!text || !/^[0-9a-f:.]+$/.test(text)) return null;
      if (text.includes(".")) {
        const index = text.lastIndexOf(":");
        if (index < 0) return null;
        const v4 = ipv4ToInt(text.slice(index + 1));
        if (v4 === null) return null;
        text = text.slice(0, index + 1) + (v4 >>> 16 & 65535).toString(16) + ":" + (v4 & 65535).toString(16);
      }
      const halves = text.split("::");
      if (halves.length > 2) return null;
      const head = halves[0] ? halves[0].split(":") : [];
      const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
      if (halves.length === 1) {
        if (head.length !== 8) return null;
      } else if (head.length + tail.length > 8) {
        return null;
      }
      const missing = 8 - head.length - tail.length;
      const groups = halves.length === 2 ? head.concat(new Array(missing).fill("0"), tail) : head;
      if (groups.length !== 8) return null;
      const parsed = [];
      for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        parsed.push(Number.parseInt(group, 16));
      }
      return parsed;
    }
    function embeddedIPv4(groups) {
      return intToIpv4((groups[6] << 16 | groups[7]) >>> 0);
    }
    function isPrivateIPv6(ip) {
      const groups = parseIPv6(ip);
      if (!groups) return false;
      const allZero = groups.every((group) => group === 0);
      if (allZero) return true;
      if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
      if ((groups[0] & 65024) === 64512) return true;
      if ((groups[0] & 65472) === 65152) return true;
      if ((groups[0] & 65280) === 65280) return true;
      if (groups[0] === 8193 && groups[1] === 3512) return true;
      const firstFiveZero = groups.slice(0, 5).every((group) => group === 0);
      if (firstFiveZero && groups[5] === 65535) {
        return isPrivateIPv4(embeddedIPv4(groups));
      }
      if (groups[0] === 100 && groups[1] === 65435 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
        return isPrivateIPv4(embeddedIPv4(groups));
      }
      return false;
    }
    function isLoopbackIPv6(ip) {
      const groups = parseIPv6(ip);
      if (!groups) return false;
      return groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
    }
    function stripBrackets(hostname) {
      return String(hostname || "").replace(/^\[/, "").replace(/\]$/, "");
    }
    function isBlockedHostname(hostname) {
      const host = stripBrackets(hostname).toLowerCase();
      if (!host) return true;
      if (BLOCKED_HOSTNAMES.includes(host)) return true;
      return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
    }
    function isPrivateAddress(ip) {
      const value = String(ip || "").replace(/^\[/, "").replace(/\]$/, "");
      const family = net.isIP(value);
      if (family === 4) return isPrivateIPv4(value);
      if (family === 6) return isPrivateIPv6(value);
      return false;
    }
    function isLoopbackAddress(ip) {
      const value = String(ip || "").replace(/^\[/, "").replace(/\]$/, "");
      const family = net.isIP(value);
      if (family === 4) return isLoopbackIPv4(value);
      if (family === 6) return isLoopbackIPv6(value);
      return false;
    }
    function parseUrl(raw) {
      if (typeof raw !== "string" || !raw.trim()) {
        throw new SsrfError("URL_INVALID", "\u5730\u5740\u4E0D\u80FD\u4E3A\u7A7A");
      }
      if (raw.length > 4096) {
        throw new SsrfError("URL_INVALID", "\u5730\u5740\u8FC7\u957F");
      }
      let url;
      try {
        url = new URL(raw.trim());
      } catch (error) {
        throw new SsrfError("URL_INVALID", "\u5730\u5740\u683C\u5F0F\u4E0D\u6B63\u786E");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new SsrfError("URL_PROTOCOL_BLOCKED", "\u53EA\u652F\u6301 http \u6216 https \u5730\u5740");
      }
      if (url.username || url.password) {
        throw new SsrfError("URL_CREDENTIALS_BLOCKED", "\u5730\u5740\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u5BC6\u7801");
      }
      const hostname = stripBrackets(url.hostname).toLowerCase();
      if (isBlockedHostname(hostname)) {
        throw new SsrfError("URL_HOST_BLOCKED", "\u8FD9\u4E2A\u5730\u5740\u4E0D\u88AB\u5141\u8BB8");
      }
      return url;
    }
    function addressAllowed(address, allowPrivate) {
      if (!isPrivateAddress(address)) return true;
      return Boolean(allowPrivate) && isLoopbackAddress(address);
    }
    function validateUrlSync(raw, { allowPrivate = false } = {}) {
      const url = parseUrl(raw);
      const hostname = stripBrackets(url.hostname);
      if (net.isIP(hostname) && !addressAllowed(hostname, allowPrivate)) {
        throw new SsrfError("URL_PRIVATE_BLOCKED", "\u4E0D\u80FD\u8BBF\u95EE\u5185\u7F51\u5730\u5740");
      }
      return url;
    }
    async function resolveTarget(raw, { allowPrivate = false } = {}) {
      const url = validateUrlSync(raw, { allowPrivate });
      const hostname = stripBrackets(url.hostname);
      if (net.isIP(hostname)) {
        return {
          url,
          addresses: [{ address: hostname, family: net.isIP(hostname) }]
        };
      }
      let records;
      try {
        records = await dns.lookup(hostname, { all: true, verbatim: true });
      } catch (error) {
        throw new SsrfError("DNS_FAILED", "\u57DF\u540D\u89E3\u6790\u5931\u8D25");
      }
      if (!Array.isArray(records) || records.length === 0) {
        throw new SsrfError("DNS_FAILED", "\u57DF\u540D\u89E3\u6790\u5931\u8D25");
      }
      const addresses = records.map((record) => ({
        address: record.address,
        family: record.family || net.isIP(record.address)
      }));
      const blocked = addresses.find((record) => !addressAllowed(record.address, allowPrivate));
      if (blocked) {
        throw new SsrfError("URL_PRIVATE_BLOCKED", "\u4E0D\u80FD\u8BBF\u95EE\u5185\u7F51\u5730\u5740");
      }
      return { url, addresses };
    }
    module2.exports = {
      SsrfError,
      ipv4ToInt,
      isPrivateIPv4,
      isLoopbackIPv4,
      parseIPv6,
      isPrivateIPv6,
      isLoopbackIPv6,
      isPrivateAddress,
      isLoopbackAddress,
      isBlockedHostname,
      parseUrl,
      validateUrlSync,
      resolveTarget
    };
  }
});

// server/lib/auth.js
var require_auth = __commonJS({
  "server/lib/auth.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    var { isLoopbackAddress } = require_ssrf();
    function sha256(value) {
      return crypto.createHash("sha256").update(String(value === void 0 || value === null ? "" : value)).digest();
    }
    function safeEqual(left, right) {
      const a = sha256(left);
      const b = sha256(right);
      return crypto.timingSafeEqual(a, b);
    }
    function requestAddress(req) {
      const forwarded = req && req.headers ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
      if (forwarded) return forwarded;
      return req && req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
    }
    function isLoopbackRequest(req) {
      const address = requestAddress(req);
      if (!address) return false;
      return isLoopbackAddress(address) || address === "::ffff:127.0.0.1";
    }
    function readBearer(req) {
      const header = req && req.headers ? req.headers.authorization : "";
      const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
      return match ? match[1].trim() : "";
    }
    function checkAuth(req, config) {
      if (!config.authRequired) return { ok: true };
      if (config.devNoAuth && isLoopbackRequest(req)) return { ok: true };
      const token = readBearer(req);
      if (!token) {
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "\u7F3A\u5C11\u8BBF\u95EE\u53E3\u4EE4" };
      }
      if (!safeEqual(token, config.apiToken)) {
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "\u8BBF\u95EE\u53E3\u4EE4\u4E0D\u6B63\u786E" };
      }
      return { ok: true };
    }
    module2.exports = {
      sha256,
      safeEqual,
      readBearer,
      isLoopbackRequest,
      checkAuth
    };
  }
});

// server/lib/cors.js
var require_cors = __commonJS({
  "server/lib/cors.js"(exports2, module2) {
    "use strict";
    function stripSlash(value) {
      return String(value || "").replace(/\/+$/, "");
    }
    function forwardedHost(req) {
      const value = req && req.headers ? req.headers["x-forwarded-host"] : "";
      return String(value || "").split(",")[0].trim();
    }
    function forwardedProto(req) {
      const value = req && req.headers ? req.headers["x-forwarded-proto"] : "";
      const raw = String(value || "").split(",")[0].trim().toLowerCase();
      return raw === "http" || raw === "https" ? raw : "";
    }
    function headerHost(req) {
      const forwarded = forwardedHost(req);
      const host = forwarded || (req && req.headers ? req.headers.host : "");
      return String(host || "").split(",")[0].trim();
    }
    function requestOrigin(req) {
      const host = headerHost(req);
      if (!host) return "";
      const proto = forwardedProto(req) || (forwardedHost(req) ? "https" : "") || (req && req.socket && req.socket.encrypted ? "https" : "http");
      return proto + "://" + host;
    }
    function normalizeHost(host) {
      return String(host || "").toLowerCase().replace(/:(80|443)$/, "");
    }
    function originHost(origin) {
      try {
        return normalizeHost(new URL(String(origin)).host);
      } catch (error) {
        return "";
      }
    }
    function isSameOrigin(req, origin) {
      if (!origin) return false;
      if (stripSlash(origin) === stripSlash(requestOrigin(req))) return true;
      const host = normalizeHost(headerHost(req));
      if (host && originHost(origin) === host) return true;
      const site = String(req && req.headers && req.headers["sec-fetch-site"] || "").toLowerCase();
      return site === "same-origin";
    }
    function isAllowedOrigin(req, config, origin) {
      if (!origin) return true;
      if (isSameOrigin(req, origin)) return true;
      return config.allowedOrigins.includes(stripSlash(origin));
    }
    function applyHeaders(req, res, config, { wildcard = false } = {}) {
      if (wildcard) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else {
        const origin = req && req.headers ? req.headers.origin : "";
        if (origin && isAllowedOrigin(req, config, origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
        }
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, range");
      res.setHeader("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges");
    }
    function handlePreflight(req, res, config, options = {}) {
      if (req.method !== "OPTIONS") return false;
      const origin = req.headers.origin || "";
      if (!options.wildcard && !isAllowedOrigin(req, config, origin)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "\u6765\u6E90\u4E0D\u88AB\u5141\u8BB8", code: "ORIGIN_NOT_ALLOWED" }));
        return true;
      }
      applyHeaders(req, res, config, options);
      res.statusCode = 204;
      res.end();
      return true;
    }
    function checkOrigin(req, config, options = {}) {
      if (options.wildcard) return true;
      const origin = req.headers.origin || "";
      if (!origin) return true;
      return isAllowedOrigin(req, config, origin);
    }
    module2.exports = {
      requestOrigin,
      isSameOrigin,
      isAllowedOrigin,
      applyHeaders,
      handlePreflight,
      checkOrigin
    };
  }
});

// server/lib/rate-limit.js
var require_rate_limit = __commonJS({
  "server/lib/rate-limit.js"(exports2, module2) {
    "use strict";
    var buckets = /* @__PURE__ */ new Map();
    var MAX_BUCKETS = 5e3;
    function nowMs() {
      return Date.now();
    }
    function cleanup(now) {
      if (buckets.size <= MAX_BUCKETS) return;
      for (const [key, bucket] of buckets) {
        if (!bucket || bucket.resetAt <= now) buckets.delete(key);
      }
    }
    function hit(key, limit, windowMs) {
      const now = nowMs();
      const safeLimit = Math.max(1, Number(limit) || 1);
      const window = Math.max(1e3, Number(windowMs) || 6e4);
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
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1e3))
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
    module2.exports = { hit, reset };
  }
});

// server/lib/route.js
var require_route = __commonJS({
  "server/lib/route.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var { checkAuth } = require_auth();
    var { applyHeaders, handlePreflight, checkOrigin } = require_cors();
    var { ApiError, sendError, clientIp, logRequest } = require_http();
    var rateLimit = require_rate_limit();
    function createRoute(handler, options = {}) {
      const methods = options.methods || ["GET", "HEAD", "OPTIONS"];
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
            throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "\u6765\u6E90\u4E0D\u88AB\u5141\u8BB8");
          }
          if (!methods.includes(req.method)) {
            res.setHeader("Allow", methods.join(", "));
            throw new ApiError(405, "METHOD_NOT_ALLOWED", "\u4E0D\u652F\u6301\u8FD9\u4E2A\u8BF7\u6C42\u65B9\u6CD5");
          }
          if (options.requireConfigured !== false && !config.configured) {
            throw new ApiError(503, "NOT_CONFIGURED", "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u914D\u7F6E\u8BBF\u95EE\u53E3\u4EE4\u6216\u7B7E\u540D\u5BC6\u94A5");
          }
          if (options.auth) {
            const result = checkAuth(req, config);
            if (!result.ok) throw new ApiError(result.status, result.code, result.message);
          }
          if (options.rateKey) {
            const limit = config.rateLimits[options.rateKey];
            if (limit) {
              const result = rateLimit.hit(
                options.rateKey + ":" + clientIp(req),
                limit.limit,
                limit.windowMs
              );
              if (!result.ok) {
                res.setHeader("Retry-After", String(result.retryAfterSeconds));
                throw new ApiError(429, "RATE_LIMITED", "\u8BF7\u6C42\u592A\u9891\u7E41\u4E86\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
              }
            }
          }
          await handler(req, res);
        } catch (error) {
          status = error && error.status ? error.status : 500;
          sendError(res, error);
          if (config.mode !== "production") {
            const code = error && error.code || "INTERNAL_ERROR";
            console.warn("[api] " + req.method + " " + String(req.url || "").split("?")[0] + " \u2192 " + code);
          }
        } finally {
          logRequest(req, status, startedAt);
        }
      };
    }
    module2.exports = { createRoute };
  }
});

// server/handlers/health.js
var require_health = __commonJS({
  "server/handlers/health.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var { createRoute } = require_route();
    var { sendJson: sendJson2 } = require_http();
    module2.exports = createRoute(
      async (req, res) => {
        sendJson2(res, 200, {
          ok: config.configured,
          version: config.version,
          apiVersion: config.apiVersion,
          authRequired: config.authRequired,
          proxyReady: config.hasSigningSecret || !config.isProduction,
          missingEnv: config.missingEnv
        });
      },
      { auth: false, requireConfigured: false, methods: ["GET", "HEAD", "OPTIONS"] }
    );
  }
});

// server/lib/text.js
var require_text = __commonJS({
  "server/lib/text.js"(exports2, module2) {
    "use strict";
    var NAMED_ENTITIES = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
      hellip: "\u2026",
      mdash: "\u2014",
      ndash: "\u2013",
      middot: "\xB7",
      laquo: "\xAB",
      raquo: "\xBB",
      ldquo: "\u201C",
      rdquo: "\u201D",
      lsquo: "\u2018",
      rsquo: "\u2019"
    };
    function decodeEntities(input) {
      return String(input === void 0 || input === null ? "" : input).replace(
        /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
        (match, body) => {
          if (body[0] === "#") {
            const hex = body[1] === "x" || body[1] === "X";
            const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code) || code <= 0 || code > 1114111) return match;
            try {
              return String.fromCodePoint(code);
            } catch (error) {
              return match;
            }
          }
          const named = NAMED_ENTITIES[body.toLowerCase()];
          return named === void 0 ? match : named;
        }
      );
    }
    function stripHtml(input) {
      if (input === void 0 || input === null) return "";
      let text = String(input);
      text = text.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ");
      text = text.replace(/<br\s*\/?>/gi, "\n");
      text = text.replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n");
      text = text.replace(/<[^>]*>/g, " ");
      text = decodeEntities(text);
      text = text.replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
      return text;
    }
    function truncate(input, max) {
      const text = String(input === void 0 || input === null ? "" : input);
      const limit = Math.max(0, Number(max) || 0);
      if (!limit) return text;
      const chars = Array.from(text);
      if (chars.length <= limit) return text;
      return chars.slice(0, limit).join("") + "\u2026";
    }
    function cleanText(input, max) {
      return truncate(stripHtml(input), max);
    }
    function safeHttpUrl(value) {
      const raw = String(value === void 0 || value === null ? "" : value).trim();
      if (!raw) return "";
      try {
        const url = new URL(raw);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        if (url.username || url.password) return "";
        return url.toString();
      } catch (error) {
        return "";
      }
    }
    function stripTrailingSlash(value) {
      return String(value || "").replace(/\/+$/, "");
    }
    function normalizeSourceUrl(value) {
      const safe = safeHttpUrl(value);
      if (!safe) return "";
      try {
        const url = new URL(safe);
        url.hash = "";
        const text = url.toString();
        if (/\/at\/xml\/$/i.test(url.pathname)) return text;
        return stripTrailingSlash(text);
      } catch (error) {
        return stripTrailingSlash(safe);
      }
    }
    function normalizeTitle(value) {
      return String(value || "").toLowerCase().replace(/[\s　]+/g, "").replace(/[·・:：\-—_.,，。!！?？'"“”‘’()（）\[\]【】]/g, "");
    }
    module2.exports = {
      decodeEntities,
      stripHtml,
      truncate,
      cleanText,
      safeHttpUrl,
      stripTrailingSlash,
      normalizeSourceUrl,
      normalizeTitle
    };
  }
});

// server/lib/xml.js
var require_xml = __commonJS({
  "server/lib/xml.js"(exports2, module2) {
    "use strict";
    var { decodeEntities } = require_text();
    var XmlError = class extends Error {
      constructor(message, code = "XML_INVALID") {
        super(message || "XML \u683C\u5F0F\u4E0D\u6B63\u786E");
        this.name = "XmlError";
        this.code = code;
      }
    };
    var MAX_DEPTH = 64;
    var MAX_ELEMENTS = 2e5;
    var TOKEN_RE = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/g;
    var ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    function localName(name) {
      return String(name || "").split(":").pop().toLowerCase();
    }
    function parseAttrs(source) {
      const attrs = {};
      ATTR_RE.lastIndex = 0;
      let match;
      while (match = ATTR_RE.exec(String(source || ""))) {
        attrs[localName(match[1])] = decodeEntities(match[2] !== void 0 ? match[2] : match[3]);
      }
      return attrs;
    }
    function createElement(name, attrs) {
      return { name, attrs: attrs || {}, children: [], text: "" };
    }
    function appendText(element, value, cdata) {
      if (!value) return;
      element.text += cdata ? value : decodeEntities(value);
    }
    function parseXml(source) {
      const raw = String(source === void 0 || source === null ? "" : source).replace(/^﻿/, "");
      if (!raw.trim()) throw new XmlError("XML \u5185\u5BB9\u4E3A\u7A7A");
      const declarations = raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
      if (declarations.includes("<!")) {
        throw new XmlError("\u4E0D\u652F\u6301 DOCTYPE \u6216\u5B9E\u4F53\u58F0\u660E", "XML_UNSAFE");
      }
      const documentRoot = createElement("#document");
      const stack = [documentRoot];
      let lastIndex = 0;
      let elementCount = 0;
      TOKEN_RE.lastIndex = 0;
      let match;
      while (match = TOKEN_RE.exec(raw)) {
        const between = raw.slice(lastIndex, match.index);
        if (between) appendText(stack[stack.length - 1], between, false);
        lastIndex = TOKEN_RE.lastIndex;
        if (match[1] !== void 0) {
          appendText(stack[stack.length - 1], match[1], true);
          continue;
        }
        if (match[2] === void 0) continue;
        const closing = match[2] === "/";
        const tagName = match[3];
        const attrsText = match[4] || "";
        const selfClosing = match[5] === "/";
        if (closing) {
          if (stack.length <= 1) throw new XmlError("\u51FA\u73B0\u591A\u4F59\u7684\u7ED3\u675F\u6807\u7B7E\uFF1A" + tagName);
          const current = stack.pop();
          if (localName(current.name) !== localName(tagName)) {
            throw new XmlError("\u6807\u7B7E\u672A\u6B63\u786E\u95ED\u5408\uFF1A" + current.name + " / " + tagName);
          }
          continue;
        }
        elementCount += 1;
        if (elementCount > MAX_ELEMENTS) throw new XmlError("XML \u5143\u7D20\u8FC7\u591A");
        const element = createElement(tagName, parseAttrs(attrsText));
        stack[stack.length - 1].children.push(element);
        if (!selfClosing) {
          if (stack.length >= MAX_DEPTH) throw new XmlError("XML \u5D4C\u5957\u8FC7\u6DF1");
          stack.push(element);
        }
      }
      const tail = raw.slice(lastIndex);
      if (tail) appendText(stack[stack.length - 1], tail, false);
      if (stack.length !== 1) {
        throw new XmlError("XML \u6807\u7B7E\u672A\u95ED\u5408\uFF1A" + stack[stack.length - 1].name);
      }
      if (!documentRoot.children.length) throw new XmlError("XML \u6CA1\u6709\u6839\u5143\u7D20");
      const preferred = documentRoot.children.find(
        (element) => ["rss", "root", "xml", "response"].includes(localName(element.name))
      );
      return preferred || documentRoot.children[0];
    }
    function childrenNamed(element, names) {
      const wanted = new Set(names.map(localName));
      return element.children.filter((child) => wanted.has(localName(child.name)));
    }
    function childNamed(element, names) {
      return childrenNamed(element, names)[0] || null;
    }
    function attrNamed(element, names) {
      for (const name of names) {
        const key = localName(name);
        if (element.attrs[key] !== void 0 && element.attrs[key] !== null) {
          return String(element.attrs[key]);
        }
      }
      return "";
    }
    function textNamed(element, names) {
      const child = childNamed(element, names);
      return child ? String(child.text || "").trim() : "";
    }
    function valueNamed(element, names) {
      const fromAttr = attrNamed(element, names);
      if (fromAttr) return fromAttr;
      return textNamed(element, names);
    }
    function intValue(value, fallback) {
      const number = Number.parseInt(String(value === void 0 || value === null ? "" : value), 10);
      return Number.isFinite(number) ? number : fallback;
    }
    function extractPlay(element) {
      const groups = [];
      const sources = childrenNamed(element, ["dl", "play", "plays", "playlist"]);
      const entries = [];
      sources.forEach((container) => {
        entries.push(...childrenNamed(container, ["dd", "url", "episode"]));
      });
      if (!entries.length) entries.push(...childrenNamed(element, ["dd"]));
      entries.forEach((entry, index) => {
        const from = attrNamed(entry, ["flag", "from", "name", "line"]) || "\u7EBF\u8DEF " + (index + 1);
        const text = String(entry.text || "").trim();
        if (text) groups.push({ from, text });
      });
      if (groups.length) {
        return {
          from: groups.map((group) => group.from).join("$$$"),
          url: groups.map((group) => group.text).join("$$$")
        };
      }
      return {
        from: valueNamed(element, ["vod_play_from", "play_from", "from"]),
        url: valueNamed(element, ["vod_play_url", "play_url", "url"])
      };
    }
    function videoToCms(element) {
      const vodId = valueNamed(element, ["id", "vod_id", "vid"]);
      const name = valueNamed(element, ["name", "vod_name", "title"]);
      if (!vodId || !name) return null;
      const typeName = valueNamed(element, ["type", "type_name", "class", "vod_class"]);
      const play = extractPlay(element);
      return {
        vod_id: vodId,
        vod_name: name,
        vod_pic: valueNamed(element, ["pic", "vod_pic", "poster", "img"]),
        vod_year: valueNamed(element, ["year", "vod_year"]),
        type_id: valueNamed(element, ["tid", "type_id", "typeid"]),
        type_name: typeName,
        vod_class: typeName,
        vod_area: valueNamed(element, ["area", "vod_area"]),
        vod_lang: valueNamed(element, ["lang", "vod_lang", "language"]),
        vod_remarks: valueNamed(element, ["note", "remarks", "vod_remarks"]),
        vod_actor: valueNamed(element, ["actor", "vod_actor", "stars"]),
        vod_director: valueNamed(element, ["director", "vod_director"]),
        vod_content: valueNamed(element, ["des", "content", "vod_content", "blurb", "vod_blurb", "intro", "description"]),
        vod_play_from: play.from,
        vod_play_url: play.url
      };
    }
    function xmlToCms(root) {
      if (!root) throw new XmlError("XML \u6CA1\u6709\u6839\u5143\u7D20");
      const classContainer = childNamed(root, ["class", "classes", "types"]);
      const tyElements = classContainer ? childrenNamed(classContainer, ["ty", "type", "class", "item"]) : childrenNamed(root, ["ty", "type"]);
      const classList = [];
      tyElements.forEach((element) => {
        const id = valueNamed(element, ["id", "type_id", "tid"]);
        const name = (String(element.text || "").trim() || textNamed(element, ["name", "type_name"])).trim();
        if (!id || !name) return;
        const parent = valueNamed(element, ["pid", "parent", "type_pid"]);
        classList.push({
          type_id: id,
          type_name: name,
          type_pid: parent || "0"
        });
      });
      const listElement = childNamed(root, ["list", "videolist", "videos"]);
      let list = null;
      let page = 1;
      let pagecount = 0;
      let total = 0;
      if (listElement) {
        page = intValue(valueNamed(listElement, ["page"]), 1);
        pagecount = intValue(valueNamed(listElement, ["pagecount", "page_count", "pages"]), 0);
        total = intValue(valueNamed(listElement, ["recordcount", "total", "count"]), 0);
        const videoElements = childrenNamed(listElement, ["video", "vod", "item", "movie"]);
        list = videoElements.map(videoToCms).filter(Boolean);
        if (!total) total = list.length;
        if (!pagecount && list.length) pagecount = 1;
      }
      return { class: classList, list, page, pagecount, total };
    }
    function parseCmsXml(source) {
      return xmlToCms(parseXml(source));
    }
    function looksLikeXml(source) {
      const text = String(source || "").replace(/^﻿/, "").trimStart();
      return text.startsWith("<");
    }
    module2.exports = {
      XmlError,
      parseXml,
      xmlToCms,
      parseCmsXml,
      looksLikeXml
    };
  }
});

// server/lib/cms.js
var require_cms = __commonJS({
  "server/lib/cms.js"(exports2, module2) {
    "use strict";
    var { cleanText, safeHttpUrl, truncate } = require_text();
    var { parseCmsXml, looksLikeXml, XmlError } = require_xml();
    var config = require_config();
    var CmsError = class extends Error {
      constructor(code, message, status = 502) {
        super(message || "\u4E0A\u6E38\u6570\u636E\u683C\u5F0F\u4E0D\u6B63\u786E");
        this.name = "CmsError";
        this.code = code || "CMS_INVALID";
        this.status = status;
      }
    };
    function intOr(value, fallback) {
      const number = Number.parseInt(value, 10);
      return Number.isFinite(number) ? number : fallback;
    }
    function withParams(base, params) {
      const url = new URL(base);
      Object.keys(params).forEach((key) => {
        url.searchParams.set(key, String(params[key]));
      });
      return url.toString();
    }
    function searchUrl(base, query, page) {
      return withParams(base, { ac: "videolist", wd: String(query), pg: String(page) });
    }
    function browseUrl(base, page, typeId) {
      const params = { ac: "videolist", pg: String(page) };
      if (typeId) params.t = String(typeId);
      return withParams(base, params);
    }
    function listUrl(base) {
      return withParams(base, { ac: "list" });
    }
    function detailUrl(base, vodId) {
      return withParams(base, { ac: "videolist", ids: String(vodId) });
    }
    function isAdultText(text) {
      const value = String(text || "");
      return config.adultKeywords.some((keyword) => value.includes(keyword));
    }
    function isAdultEntry(raw) {
      const fields = [raw.type_name, raw.vod_class, raw.vod_sub, raw.vod_area, raw.vod_lang].filter(Boolean).join(" ");
      return isAdultText(fields);
    }
    function detectCmsFormat(text) {
      const raw = String(text === void 0 || text === null ? "" : text).replace(/^﻿/, "").trim();
      if (!raw) return "";
      if (raw[0] === "{" || raw[0] === "[") return "json";
      if (looksLikeXml(raw)) return "xml";
      return "";
    }
    function parseCmsPayload(text) {
      const raw = String(text === void 0 || text === null ? "" : text).replace(/^﻿/, "").trim();
      if (!raw) throw new CmsError("CMS_INVALID", "\u6E90\u7AD9\u8FD4\u56DE\u4E86\u7A7A\u5185\u5BB9");
      const format = detectCmsFormat(raw);
      if (format === "json") {
        try {
          return JSON.parse(raw);
        } catch (error) {
          throw new CmsError("CMS_INVALID", "\u6E90\u7AD9\u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON");
        }
      }
      if (format === "xml") {
        try {
          return parseCmsXml(raw);
        } catch (error) {
          if (error instanceof XmlError) {
            throw new CmsError("CMS_INVALID", "\u6E90\u7AD9\u8FD4\u56DE\u7684 XML \u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A" + error.message);
          }
          throw error;
        }
      }
      throw new CmsError("CMS_INVALID", "\u6E90\u7AD9\u8FD4\u56DE\u7684\u683C\u5F0F\u65E0\u6CD5\u8BC6\u522B\uFF08\u65E2\u4E0D\u662F JSON\uFF0C\u4E5F\u4E0D\u662F XML\uFF09");
    }
    function parseClassList(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new CmsError("CMS_INVALID", "\u4E0A\u6E38\u8FD4\u56DE\u7684\u4E0D\u662F Apple CMS JSON");
      }
      const raw = data.class;
      const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
      const seen = /* @__PURE__ */ new Set();
      const classes = [];
      list.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const id = entry.type_id === void 0 || entry.type_id === null ? "" : String(entry.type_id).trim();
        const name = cleanText(entry.type_name, 40);
        if (!id || !name || seen.has(id) || isAdultText(name)) return;
        seen.add(id);
        classes.push({
          id,
          name,
          parent: intOr(entry.type_pid, 0)
        });
      });
      return classes;
    }
    function normalizeSearchItem(raw) {
      if (!raw || typeof raw !== "object") return null;
      const vodId = raw.vod_id === void 0 || raw.vod_id === null ? "" : String(raw.vod_id).trim();
      const name = cleanText(raw.vod_name, 200);
      if (!vodId || !name) return null;
      return {
        vodId,
        name,
        pic: /^https:\/\//i.test(String(raw.vod_pic || "")) ? safeHttpUrl(raw.vod_pic) : "",
        year: intOr(raw.vod_year, null),
        /* 保留源站的真实分类 id，供服务端校验源站是否真的按 t 过滤。 */
        typeId: cleanText(raw.type_id !== void 0 ? raw.type_id : raw.typeId, 20),
        typePid: cleanText(raw.type_pid !== void 0 ? raw.type_pid : raw.typePid, 20),
        typeName: cleanText(raw.type_name, 40),
        area: cleanText(raw.vod_area, 40),
        remarks: cleanText(raw.vod_remarks, 60)
      };
    }
    function parseSearchResponse(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new CmsError("CMS_INVALID", "\u4E0A\u6E38\u8FD4\u56DE\u7684\u4E0D\u662F Apple CMS JSON");
      }
      const listIsArray = Array.isArray(data.list);
      const rawList = listIsArray ? data.list : [];
      const items = rawList.filter((raw) => raw && typeof raw === "object" && !isAdultEntry(raw)).map(normalizeSearchItem).filter(Boolean);
      return {
        items,
        page: intOr(data.page, 1),
        pagecount: intOr(data.pagecount, 0),
        total: intOr(data.total, items.length),
        listIsArray
      };
    }
    function parsePlayLines(playFrom, playUrl) {
      const froms = String(playFrom || "").split("$$$");
      const groups = String(playUrl || "").split("$$$");
      const lines = [];
      groups.forEach((group, index) => {
        const lineName = cleanText(froms[index], 40) || "\u7EBF\u8DEF " + (index + 1);
        const episodes = [];
        String(group || "").split("#").forEach((entry, episodeIndex) => {
          const raw = String(entry || "").trim();
          if (!raw) return;
          const dollar = raw.indexOf("$");
          const rawName = dollar >= 0 ? raw.slice(0, dollar) : "";
          const rawUrl = dollar >= 0 ? raw.slice(dollar + 1) : raw;
          const url = safeHttpUrl(rawUrl);
          if (!url) return;
          episodes.push({
            name: cleanText(rawName, 80) || "\u7B2C " + (episodeIndex + 1) + " \u96C6",
            url
          });
        });
        if (episodes.length) lines.push({ name: lineName, episodes });
      });
      return lines;
    }
    function isHlsUrl(url) {
      try {
        return /\.m3u8$/i.test(new URL(url).pathname);
      } catch (error) {
        return /\.m3u8(?:$|[?#])/i.test(String(url || ""));
      }
    }
    function isHlsLine(lineName, url) {
      return /m3u8|hls/i.test(String(lineName || "")) || isHlsUrl(url);
    }
    function guessKind(lines) {
      const maxEpisodes = lines.reduce((max, line) => Math.max(max, line.episodes.length), 0);
      return maxEpisodes > 1 ? "series" : "movie";
    }
    function buildRemoteId(sourceId, vodId) {
      return "remote_" + sourceId + "_" + vodId;
    }
    function hostOf(url) {
      try {
        return new URL(url).host;
      } catch (error) {
        return "";
      }
    }
    function makeSource(lineName, url, proxyUrl) {
      const isHls = isHlsLine(lineName, url);
      const needsProxy = /^http:\/\//i.test(url);
      const proxy = typeof proxyUrl === "function" ? proxyUrl(url) : url;
      const src = needsProxy ? proxy : url;
      return {
        src,
        proxySrc: proxy,
        quality: lineName,
        label: lineName,
        isHls
      };
    }
    function buildDetailItem(data, options) {
      if (!data || typeof data !== "object" || !Array.isArray(data.list) || !data.list.length) {
        throw new CmsError("CMS_NOT_FOUND", "\u8FD9\u4E2A\u6E90\u6CA1\u6709\u627E\u5230\u8BE5\u5F71\u7247", 404);
      }
      const raw = data.list.find((entry) => entry && typeof entry === "object");
      if (!raw) throw new CmsError("CMS_NOT_FOUND", "\u8FD9\u4E2A\u6E90\u6CA1\u6709\u627E\u5230\u8BE5\u5F71\u7247", 404);
      const source = options.source || {};
      const sourceId = String(source.id || "");
      const sourceName = cleanText(source.name, 60) || hostOf(source.url) || "\u7F51\u7EDC\u6E90";
      const vodId = String(options.vodId || raw.vod_id || "").trim();
      if (!sourceId || !vodId) throw new CmsError("CMS_INVALID", "\u4E0A\u6E38\u7F3A\u5C11\u5F71\u7247 ID");
      const title = cleanText(raw.vod_name, 200);
      if (!title) throw new CmsError("CMS_INVALID", "\u4E0A\u6E38\u7F3A\u5C11\u5F71\u7247\u6807\u9898");
      const lines = parsePlayLines(raw.vod_play_from, raw.vod_play_url);
      const kind = guessKind(lines);
      const proxyUrl = typeof options.proxyUrl === "function" ? options.proxyUrl : (url) => url;
      const poster = /^https:\/\//i.test(String(raw.vod_pic || "")) ? safeHttpUrl(raw.vod_pic) : "";
      const genres = [cleanText(raw.type_name, 40), cleanText(raw.vod_area, 40), cleanText(raw.vod_lang, 40)].filter(
        (value, index, list) => value && list.indexOf(value) === index
      );
      const item = {
        id: buildRemoteId(sourceId, vodId),
        title,
        year: intOr(raw.vod_year, null),
        category: kind,
        kind,
        sources: [],
        episodes: [],
        poster,
        tags: ["\u5728\u7EBF"],
        genres,
        aliases: [],
        embed: null,
        synopsis: cleanText(raw.vod_content || raw.vod_blurb, 2e3),
        remarks: cleanText(raw.vod_remarks, 80),
        director: cleanText(raw.vod_director, 120),
        actors: cleanText(raw.vod_actor, 240),
        area: cleanText(raw.vod_area, 40),
        typeName: cleanText(raw.type_name, 40),
        source: sourceName,
        sourceUrl: String(source.url || ""),
        license: "",
        remote: true,
        remoteSource: { id: sourceId, name: sourceName, url: String(source.url || "") },
        remoteVodId: vodId
      };
      if (!lines.length) {
        throw new CmsError("CMS_NO_PLAYABLE", "\u8FD9\u4E2A\u6E90\u6CA1\u6709\u63D0\u4F9B\u53EF\u64AD\u653E\u5730\u5740", 422);
      }
      if (kind === "movie") {
        item.sources = lines.map((line) => makeSource(line.name, line.episodes[0].url, proxyUrl));
      } else {
        const maxEpisodes = Math.max(...lines.map((line) => line.episodes.length));
        for (let index = 0; index < maxEpisodes; index += 1) {
          const sources = [];
          let episodeName = "";
          lines.forEach((line) => {
            const episode = line.episodes[index];
            if (!episode) return;
            if (!episodeName) episodeName = episode.name;
            sources.push(makeSource(line.name, episode.url, proxyUrl));
          });
          if (!sources.length) continue;
          item.episodes.push({
            id: "ep" + (index + 1),
            episode: index + 1,
            title: truncate(episodeName, 80),
            sources
          });
        }
      }
      return item;
    }
    module2.exports = {
      CmsError,
      searchUrl,
      browseUrl,
      listUrl,
      detailUrl,
      detectCmsFormat,
      parseCmsPayload,
      parseSearchResponse,
      parseClassList,
      parsePlayLines,
      parsePlayFrom: parsePlayLines,
      isHlsUrl,
      buildRemoteId,
      buildDetailItem,
      guessKind
    };
  }
});

// server/lib/type-filter.js
var require_type_filter = __commonJS({
  "server/lib/type-filter.js"(exports2, module2) {
    "use strict";
    function filterByRequestedTypes(items, typeIds) {
      const list = Array.isArray(items) ? items : [];
      const allowed = new Set((Array.isArray(typeIds) ? typeIds : []).map(String));
      if (!allowed.size) return list;
      const matched = list.filter((item) => !item.typeId || allowed.has(String(item.typeId)));
      return matched.length ? matched : list;
    }
    module2.exports = { filterByRequestedTypes };
  }
});

// server/lib/safe-fetch.js
var require_safe_fetch = __commonJS({
  "server/lib/safe-fetch.js"(exports2, module2) {
    "use strict";
    var http = require("http");
    var https = require("https");
    var net = require("net");
    var zlib = require("zlib");
    var { resolveTarget } = require_ssrf();
    var config = require_config();
    var FetchError = class extends Error {
      constructor(code, message, status = 502) {
        super(message || "\u4E0A\u6E38\u8BF7\u6C42\u5931\u8D25");
        this.name = "FetchError";
        this.code = code || "UPSTREAM_ERROR";
        this.status = status;
      }
    };
    function stripBrackets(hostname) {
      return String(hostname || "").replace(/^\[/, "").replace(/\]$/, "");
    }
    function makeLookup(addresses) {
      return (hostname, options, callback) => {
        let opts = options;
        let done = callback;
        if (typeof opts === "function") {
          done = opts;
          opts = {};
        }
        if (opts && opts.all) {
          done(
            null,
            addresses.map((record) => ({ address: record.address, family: record.family }))
          );
          return;
        }
        done(null, addresses[0].address, addresses[0].family);
      };
    }
    function defaultHeaders(extra) {
      return Object.assign(
        {
          "user-agent": config.userAgent,
          accept: "*/*",
          "accept-encoding": "identity"
        },
        extra || {}
      );
    }
    function requestOnce(target, opts) {
      const url = target.url;
      const isHttps = url.protocol === "https:";
      const hostname = stripBrackets(url.hostname);
      const tlsHostname = net.isIP(hostname) ? "" : hostname;
      const transport = isHttps ? https : http;
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        let abortCleanup = null;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (abortCleanup) abortCleanup();
          fn(value);
        };
        const req = transport.request(
          {
            protocol: url.protocol,
            hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: opts.method || "GET",
            headers: defaultHeaders(opts.headers),
            lookup: makeLookup(target.addresses),
            servername: isHttps && tlsHostname ? tlsHostname : void 0,
            agent: false,
            timeout: opts.timeoutMs
          },
          (res) => {
            const status = Number(res.statusCode) || 0;
            const headers = res.headers || {};
            let stream = res;
            const encoding = String(headers["content-encoding"] || "").toLowerCase();
            if (encoding && encoding !== "identity") {
              const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() : encoding === "br" ? zlib.createBrotliDecompress() : null;
              if (decoder) {
                delete headers["content-encoding"];
                delete headers["content-length"];
                res.on("error", (error) => decoder.destroy(error));
                res.pipe(decoder);
                stream = decoder;
              }
            }
            finish(resolve, {
              status,
              headers,
              stream,
              url,
              request: req
            });
          }
        );
        req.on("error", (error) => {
          if (error && error.code && String(error.code).startsWith("ERR_TLS")) {
            finish(reject, new FetchError("UPSTREAM_TLS_ERROR", "\u4E0A\u6E38 HTTPS \u8BC1\u4E66\u6821\u9A8C\u5931\u8D25", 502));
            return;
          }
          if (error instanceof FetchError) finish(reject, error);
          else finish(reject, new FetchError("UPSTREAM_UNREACHABLE", "\u65E0\u6CD5\u8FDE\u63A5\u4E0A\u6E38\u670D\u52A1\u5668", 502));
        });
        req.setTimeout(opts.timeoutMs || 15e3, () => {
          req.destroy(new FetchError("UPSTREAM_TIMEOUT", "\u8BF7\u6C42\u8D85\u65F6", 504));
        });
        const signal = opts.signal;
        if (signal) {
          if (signal.aborted) {
            req.destroy(new FetchError("ABORTED", "\u8BF7\u6C42\u5DF2\u53D6\u6D88", 499));
          } else {
            const onAbort = () => req.destroy(new FetchError("ABORTED", "\u8BF7\u6C42\u5DF2\u53D6\u6D88", 499));
            signal.addEventListener("abort", onAbort, { once: true });
            abortCleanup = () => signal.removeEventListener("abort", onAbort);
          }
        }
        if (opts.body) req.write(opts.body);
        req.end();
      });
    }
    async function open(rawUrl, opts = {}) {
      const allowPrivate = Boolean(opts.allowPrivate);
      const maxRedirects = Number.isInteger(opts.maxRedirects) ? opts.maxRedirects : config.redirectMax;
      let current = String(rawUrl);
      let hops = 0;
      for (; ; ) {
        const target = await resolveTarget(current, { allowPrivate });
        const response = await requestOnce(target, opts);
        const location = response.headers.location;
        const redirect = [301, 302, 303, 307, 308].includes(response.status) && location;
        if (!redirect) {
          return Object.assign({}, response, { url: target.url.toString() });
        }
        if (hops >= maxRedirects) {
          response.stream.resume();
          response.request.destroy();
          throw new FetchError("TOO_MANY_REDIRECTS", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", 502);
        }
        let next;
        try {
          next = new URL(String(location), target.url);
        } catch (error) {
          response.stream.resume();
          response.request.destroy();
          throw new FetchError("INVALID_REDIRECT", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u5730\u5740\u65E0\u6548", 502);
        }
        if (target.url.protocol === "https:" && next.protocol === "http:") {
          response.stream.resume();
          response.request.destroy();
          throw new FetchError("HTTPS_DOWNGRADE", "\u4E0A\u6E38\u8BD5\u56FE\u964D\u7EA7\u5230 HTTP\uFF0C\u5DF2\u62D2\u7EDD", 502);
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          response.stream.resume();
          response.request.destroy();
          throw new FetchError("INVALID_REDIRECT", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u534F\u8BAE\u4E0D\u88AB\u5141\u8BB8", 502);
        }
        response.stream.resume();
        response.request.destroy();
        current = next.toString();
        hops += 1;
      }
    }
    function readAll(stream, maxBytes) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (maxBytes && size > maxBytes) {
            stream.destroy();
            settle(reject, new FetchError("PAYLOAD_TOO_LARGE", "\u4E0A\u6E38\u54CD\u5E94\u5185\u5BB9\u8FC7\u5927", 502));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => settle(resolve, Buffer.concat(chunks)));
        stream.on("error", (error) => {
          if (error instanceof FetchError) settle(reject, error);
          else settle(reject, new FetchError("UPSTREAM_ABORTED", "\u4E0A\u6E38\u8FDE\u63A5\u4E2D\u65AD", 502));
        });
        stream.on("aborted", () => settle(reject, new FetchError("UPSTREAM_ABORTED", "\u4E0A\u6E38\u8FDE\u63A5\u4E2D\u65AD", 502)));
      });
    }
    async function fetchBuffer(rawUrl, opts = {}) {
      const response = await open(rawUrl, opts);
      const maxBytes = opts.maxBytes || config.jsonMaxBytes;
      try {
        const body = opts.method === "HEAD" ? Buffer.alloc(0) : await readAll(response.stream, maxBytes);
        return {
          status: response.status,
          headers: response.headers,
          body,
          url: response.url
        };
      } catch (error) {
        response.request.destroy();
        throw error;
      }
    }
    function detectCharset(headers, body) {
      const contentType = String(headers && headers["content-type"] || "");
      const headerMatch = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
      if (headerMatch) return headerMatch[1];
      const head = body.subarray(0, 256).toString("latin1");
      const xmlMatch = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
      return xmlMatch ? xmlMatch[1] : "";
    }
    function decodeBody(body, headers) {
      const charset = detectCharset(headers, body);
      if (!charset || /^utf-?8$/i.test(charset)) return body.toString("utf8");
      try {
        return new TextDecoder(charset).decode(body);
      } catch (error) {
        return body.toString("utf8");
      }
    }
    async function fetchText(rawUrl, opts = {}) {
      const result = await fetchBuffer(rawUrl, opts);
      return {
        status: result.status,
        headers: result.headers,
        text: decodeBody(result.body, result.headers),
        url: result.url
      };
    }
    module2.exports = {
      FetchError,
      open,
      readAll,
      fetchBuffer,
      fetchText
    };
  }
});

// server/handlers/_common.js
var require_common = __commonJS({
  "server/handlers/_common.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    var config = require_config();
    var { ApiError } = require_http();
    var { validateUrlSync, SsrfError } = require_ssrf();
    var { isLoopbackRequest } = require_auth();
    var { FetchError } = require_safe_fetch();
    var { CmsError, parseCmsPayload } = require_cms();
    var { cleanText, normalizeSourceUrl } = require_text();
    var MAX_TYPE_IDS = 64;
    function allowPrivateFor(req) {
      return config.devAllowPrivate && isLoopbackRequest(req);
    }
    function normalizeSource(raw, allowPrivate) {
      if (!raw || typeof raw !== "object") {
        throw new ApiError(400, "SOURCE_INVALID", "\u6E90\u683C\u5F0F\u4E0D\u6B63\u786E");
      }
      let url;
      try {
        url = validateUrlSync(String(raw.url || ""), { allowPrivate });
      } catch (error) {
        if (error instanceof SsrfError) {
          throw new ApiError(400, error.code, "\u6E90\u5730\u5740\u4E0D\u88AB\u5141\u8BB8\uFF1A" + error.message);
        }
        throw error;
      }
      const normalizedUrl = normalizeSourceUrl(url.toString());
      let fallbackName = "";
      try {
        fallbackName = new URL(normalizedUrl).host;
      } catch (error) {
        fallbackName = "\u7F51\u7EDC\u6E90";
      }
      const id = String(raw.id || "").trim();
      const safeId = /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : "s_" + crypto.createHash("sha1").update(normalizedUrl).digest("hex").slice(0, 12);
      return {
        id: safeId,
        name: cleanText(raw.name, 60) || fallbackName,
        url: normalizedUrl
      };
    }
    function normalizeTypeIds(raw) {
      const values = [];
      if (raw && typeof raw === "object") {
        if (Array.isArray(raw.typeIds)) values.push(...raw.typeIds);
        if (raw.typeId !== void 0) values.push(raw.typeId);
      }
      const seen = /* @__PURE__ */ new Set();
      const ids = [];
      values.forEach((value) => {
        const id = String(value === void 0 || value === null ? "" : value).trim();
        if (!/^\d{1,10}$/.test(id) || seen.has(id)) return;
        seen.add(id);
        if (ids.length < MAX_TYPE_IDS) ids.push(id);
      });
      return ids;
    }
    function normalizeSourceList(rawList, allowPrivate, options = {}) {
      const max = Number(options.max) || config.maxSources;
      if (!Array.isArray(rawList) || rawList.length === 0) {
        throw new ApiError(400, "SOURCES_REQUIRED", "\u8BF7\u5148\u6DFB\u52A0\u5E76\u542F\u7528\u81F3\u5C11\u4E00\u4E2A\u6E90");
      }
      if (rawList.length > max) {
        throw new ApiError(400, "TOO_MANY_SOURCES", "\u4E00\u6B21\u6700\u591A\u4F7F\u7528 " + max + " \u4E2A\u6E90");
      }
      const seen = /* @__PURE__ */ new Set();
      const sources = [];
      rawList.forEach((raw) => {
        const source = normalizeSource(raw, allowPrivate);
        if (seen.has(source.url)) return;
        seen.add(source.url);
        const typeIds = normalizeTypeIds(raw);
        if (typeIds.length) source.typeIds = typeIds;
        sources.push(source);
      });
      if (!sources.length) {
        throw new ApiError(400, "SOURCES_REQUIRED", "\u8BF7\u5148\u6DFB\u52A0\u5E76\u542F\u7528\u81F3\u5C11\u4E00\u4E2A\u6E90");
      }
      return sources;
    }
    function parseCmsJson(text) {
      try {
        return JSON.parse(String(text || "").replace(/^﻿/, ""));
      } catch (error) {
        throw new CmsError("CMS_INVALID", "\u6E90\u7AD9\u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON");
      }
    }
    function ensureUpstreamOk(response) {
      if (response.status < 200 || response.status >= 300) {
        throw new FetchError("UPSTREAM_HTTP", "\u6E90\u7AD9\u8FD4\u56DE HTTP " + response.status, 502);
      }
    }
    function upstreamErrorMessage(error, timedOut) {
      if (timedOut || error && (error.code === "UPSTREAM_TIMEOUT" || error.code === "ABORTED")) {
        return "\u8BF7\u6C42\u8D85\u65F6\uFF08>" + Math.round(config.searchSourceTimeoutMs / 1e3) + "s\uFF09";
      }
      if (!error) return "\u641C\u7D22\u5931\u8D25";
      switch (error.code) {
        case "DNS_FAILED":
          return "\u57DF\u540D\u89E3\u6790\u5931\u8D25";
        case "URL_PRIVATE_BLOCKED":
        case "URL_HOST_BLOCKED":
          return "\u6E90\u5730\u5740\u4E0D\u88AB\u5141\u8BB8";
        case "UPSTREAM_TLS_ERROR":
          return "\u6E90\u7AD9 HTTPS \u8BC1\u4E66\u5F02\u5E38";
        case "UPSTREAM_UNREACHABLE":
          return "\u65E0\u6CD5\u8FDE\u63A5\u6E90\u7AD9";
        case "PAYLOAD_TOO_LARGE":
          return "\u6E90\u7AD9\u54CD\u5E94\u5185\u5BB9\u8FC7\u5927";
        case "TOO_MANY_REDIRECTS":
          return "\u6E90\u7AD9\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A";
        case "HTTPS_DOWNGRADE":
          return "\u6E90\u7AD9\u8BD5\u56FE\u964D\u7EA7\u5230 HTTP";
        case "UPSTREAM_HTTP":
          return error.message || "\u6E90\u7AD9\u8FD4\u56DE\u9519\u8BEF\u72B6\u6001";
        case "CMS_INVALID":
          return "\u6E90\u7AD9\u8FD4\u56DE\u683C\u5F0F\u4E0D\u6B63\u786E";
        case "CMS_NOT_FOUND":
          return "\u8FD9\u4E2A\u6E90\u6CA1\u6709\u627E\u5230\u8BE5\u5F71\u7247";
        case "CMS_NO_PLAYABLE":
          return "\u8FD9\u4E2A\u6E90\u6CA1\u6709\u63D0\u4F9B\u53EF\u64AD\u653E\u5730\u5740";
        default:
          return "\u641C\u7D22\u5931\u8D25";
      }
    }
    module2.exports = {
      allowPrivateFor,
      normalizeSource,
      normalizeSourceList,
      normalizeTypeIds,
      parseCmsJson,
      parseCmsPayload,
      ensureUpstreamOk,
      upstreamErrorMessage
    };
  }
});

// server/handlers/browse.js
var require_browse = __commonJS({
  "server/handlers/browse.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var cms = require_cms();
    var { filterByRequestedTypes } = require_type_filter();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2 } = require_http();
    var { fetchText } = require_safe_fetch();
    var {
      allowPrivateFor,
      normalizeSourceList,
      parseCmsPayload,
      ensureUpstreamOk,
      upstreamErrorMessage
    } = require_common();
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
    async function mapLimit(items, limit, worker) {
      const results = new Array(items.length);
      let cursor = 0;
      const size = Math.min(Math.max(1, Number(limit) || 1), items.length || 1);
      await Promise.all(
        Array.from({ length: size }, async () => {
          for (; ; ) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
          }
        })
      );
      return results;
    }
    module2.exports = createRoute(
      async (req, res) => {
        const body = await readJson(req, config.bodyMaxBytes);
        const requestedPage = Number.parseInt(body.page, 10);
        const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), config.browseMaxPage) : 1;
        const allowPrivate = allowPrivateFor(req);
        const sources = normalizeSourceList(body.sources, allowPrivate);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.browseTotalTimeoutMs);
        const onClientGone = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClientGone);
        try {
          const tasks = [];
          sources.forEach((source) => {
            const typeIds = Array.isArray(source.typeIds) && source.typeIds.length ? source.typeIds : [""];
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
          const bySource = /* @__PURE__ */ new Map();
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
              error: ""
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
              filterByRequestedTypes(result.parsed.items, result.source.typeIds).forEach((item) => {
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
            const seen = /* @__PURE__ */ new Set();
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
            entry.error = entry.error || (entry.partial ? "\u90E8\u5206\u5206\u7C7B\u52A0\u8F7D\u5931\u8D25" : "");
            if (!entry.ok) {
              entry.items = [];
              entry.count = 0;
              entry.pagecount = 0;
              entry.total = 0;
              entry.error = entry.error || (entry.timedOut ? "\u8BF7\u6C42\u8D85\u65F6" : "\u52A0\u8F7D\u5931\u8D25");
            }
            return entry;
          });
          const total = results.reduce((sum, result) => sum + result.items.length, 0);
          const worksTotal = results.reduce(
            (sum, result) => sum + (result.ok ? result.total : 0),
            0
          );
          sendJson2(res, 200, { ok: true, page, total, worksTotal, sources: results });
        } finally {
          clearTimeout(timer);
          res.removeListener("close", onClientGone);
        }
      },
      { auth: true, rateKey: "search", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/handlers/categories.js
var require_categories = __commonJS({
  "server/handlers/categories.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var cms = require_cms();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2 } = require_http();
    var { fetchText } = require_safe_fetch();
    var {
      allowPrivateFor,
      normalizeSourceList,
      parseCmsPayload,
      ensureUpstreamOk,
      upstreamErrorMessage
    } = require_common();
    async function classesOne(source, { allowPrivate, signal }) {
      const startedAt = Date.now();
      const response = await fetchText(cms.listUrl(source.url), {
        timeoutMs: config.searchSourceTimeoutMs,
        maxBytes: config.jsonMaxBytes,
        allowPrivate,
        signal
      });
      ensureUpstreamOk(response);
      const classes = cms.parseClassList(parseCmsPayload(response.text));
      return { classes, ms: Date.now() - startedAt };
    }
    module2.exports = createRoute(
      async (req, res) => {
        const body = await readJson(req, config.bodyMaxBytes);
        const allowPrivate = allowPrivateFor(req);
        const sources = normalizeSourceList(body.sources, allowPrivate);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.searchTotalTimeoutMs);
        const onClientGone = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClientGone);
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
          sendJson2(res, 200, { ok: true, total, sources: results });
        } finally {
          clearTimeout(timer);
          res.removeListener("close", onClientGone);
        }
      },
      { auth: true, rateKey: "search", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/handlers/search.js
var require_search = __commonJS({
  "server/handlers/search.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var cms = require_cms();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2, startNdjson, writeNdjson, endNdjson, ApiError } = require_http();
    var { fetchText } = require_safe_fetch();
    var {
      allowPrivateFor,
      normalizeSource,
      parseCmsPayload,
      ensureUpstreamOk,
      upstreamErrorMessage
    } = require_common();
    function normalizeSources(rawList, allowPrivate) {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        throw new ApiError(400, "SOURCES_REQUIRED", "\u8BF7\u5148\u6DFB\u52A0\u5E76\u542F\u7528\u81F3\u5C11\u4E00\u4E2A\u6E90");
      }
      if (rawList.length > config.maxSources) {
        throw new ApiError(400, "TOO_MANY_SOURCES", "\u4E00\u6B21\u6700\u591A\u641C\u7D22 " + config.maxSources + " \u4E2A\u6E90");
      }
      const seen = /* @__PURE__ */ new Set();
      const sources = [];
      rawList.forEach((raw) => {
        const source = normalizeSource(raw, allowPrivate);
        if (seen.has(source.url)) return;
        seen.add(source.url);
        sources.push(source);
      });
      if (!sources.length) {
        throw new ApiError(400, "SOURCES_REQUIRED", "\u8BF7\u5148\u6DFB\u52A0\u5E76\u542F\u7528\u81F3\u5C11\u4E00\u4E2A\u6E90");
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
          throw new Error("aborted");
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
      else totalSignal.addEventListener("abort", onAbort, { once: true });
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
        totalSignal.removeEventListener("abort", onAbort);
      }
    }
    module2.exports = createRoute(
      async (req, res) => {
        const url = new URL(req.url, "http://local");
        const wantsStream = url.searchParams.get("stream") !== "0" && !/application\/json/i.test(String(req.headers.accept || ""));
        const body = await readJson(req, config.bodyMaxBytes);
        const query = String(body.q || "").trim();
        if (!query) throw new ApiError(400, "QUERY_REQUIRED", "\u8BF7\u8F93\u5165\u641C\u7D22\u5173\u952E\u8BCD");
        if (query.length > 80) throw new ApiError(400, "QUERY_TOO_LONG", "\u641C\u7D22\u5173\u952E\u8BCD\u592A\u957F");
        const allowPrivate = allowPrivateFor(req);
        const sources = normalizeSources(body.sources, allowPrivate);
        const totalController = new AbortController();
        const totalTimer = setTimeout(() => {
          totalController.abort();
        }, config.searchTotalTimeoutMs);
        const onClientGone = () => {
          if (!res.writableEnded) totalController.abort();
        };
        res.on("close", onClientGone);
        const seen = /* @__PURE__ */ new Set();
        const results = [];
        let total = 0;
        let okCount = 0;
        let failCount = 0;
        if (wantsStream) {
          startNdjson(res);
          writeNdjson(res, { type: "start", sources: sources.length });
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
                  const key = source.id + "_" + item.vodId;
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
                if (wantsStream) writeNdjson(res, Object.assign({ type: "source" }, payload));
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
                if (wantsStream) writeNdjson(res, Object.assign({ type: "source" }, payload));
              }
            })
          );
          if (wantsStream) {
            writeNdjson(res, { type: "done", total, okCount, failCount });
            endNdjson(res);
          } else {
            sendJson2(res, 200, { ok: true, total, okCount, failCount, results });
          }
        } finally {
          clearTimeout(totalTimer);
          res.removeListener("close", onClientGone);
        }
      },
      { auth: true, rateKey: "search", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/lib/sign.js
var require_sign = __commonJS({
  "server/lib/sign.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    var SignError = class extends Error {
      constructor(code, message, status) {
        super(message || "\u7B7E\u540D\u65E0\u6548");
        this.name = "SignError";
        this.code = code || "SIGNATURE_INVALID";
        this.status = status || 403;
      }
    };
    function computeSignature(secret, url, exp) {
      return crypto.createHmac("sha256", String(secret || "")).update(String(exp) + "\n" + String(url)).digest("hex");
    }
    function verifySignature(secret, url, exp, sig) {
      if (typeof sig !== "string" || !/^[0-9a-fA-F]{64}$/.test(sig)) {
        throw new SignError("SIGNATURE_INVALID", "\u7B7E\u540D\u65E0\u6548", 403);
      }
      const expected = computeSignature(secret, url, exp);
      const left = Buffer.from(expected, "hex");
      const right = Buffer.from(sig.toLowerCase(), "hex");
      if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        throw new SignError("SIGNATURE_INVALID", "\u7B7E\u540D\u65E0\u6548", 403);
      }
      return true;
    }
    function createProxyPath(secret, url, { ttlSeconds = 43200, now = Date.now(), ttlMs } = {}) {
      const seconds = ttlMs ? Math.max(1, Math.ceil(ttlMs / 1e3)) : Math.max(1, Number(ttlSeconds) || 43200);
      const exp = Math.floor(now / 1e3) + seconds;
      const sig = computeSignature(secret, url, exp);
      return "/api/proxy?u=" + encodeURIComponent(url) + "&exp=" + exp + "&sig=" + sig;
    }
    function verifyProxyParams(secret, { u, exp, sig }, { now = Date.now() } = {}) {
      if (typeof u !== "string" || !u) {
        throw new SignError("SIGNATURE_INVALID", "\u7F3A\u5C11\u4EE3\u7406\u5730\u5740", 403);
      }
      if (u.length > 4096) {
        throw new SignError("SIGNATURE_INVALID", "\u4EE3\u7406\u5730\u5740\u8FC7\u957F", 403);
      }
      const expNumber = Number(exp);
      if (!Number.isInteger(expNumber) || expNumber <= 0) {
        throw new SignError("SIGNATURE_INVALID", "\u94FE\u63A5\u5DF2\u5931\u6548", 403);
      }
      verifySignature(secret, u, expNumber, sig);
      if (expNumber * 1e3 <= now) {
        throw new SignError("SIGNATURE_EXPIRED", "\u94FE\u63A5\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5237\u65B0\u7247\u6E90", 410);
      }
      return { url: u, exp: expNumber };
    }
    function isProxyPath(value) {
      return typeof value === "string" && /^\/api\/proxy\?/i.test(value);
    }
    module2.exports = {
      SignError,
      computeSignature,
      verifySignature,
      createProxyPath,
      verifyProxyParams,
      isProxyPath
    };
  }
});

// server/handlers/detail.js
var require_detail = __commonJS({
  "server/handlers/detail.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var cms = require_cms();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2, ApiError } = require_http();
    var { fetchText } = require_safe_fetch();
    var { createProxyPath } = require_sign();
    var {
      allowPrivateFor,
      normalizeSource,
      parseCmsPayload,
      ensureUpstreamOk
    } = require_common();
    module2.exports = createRoute(
      async (req, res) => {
        const body = await readJson(req, config.bodyMaxBytes);
        const allowPrivate = allowPrivateFor(req);
        const source = normalizeSource(body.source, allowPrivate);
        const vodId = String(body.id || "").trim();
        if (!vodId || vodId.length > 120) {
          throw new ApiError(400, "VOD_ID_REQUIRED", "\u7F3A\u5C11\u5F71\u7247 ID");
        }
        const response = await fetchText(cms.detailUrl(source.url, vodId), {
          timeoutMs: config.detailTimeoutMs,
          maxBytes: config.jsonMaxBytes,
          allowPrivate
        });
        ensureUpstreamOk(response);
        const data = parseCmsPayload(response.text);
        const makeProxyUrl = (target) => createProxyPath(config.signingSecret, target, { ttlSeconds: config.proxyTtlSeconds });
        const item = cms.buildDetailItem(data, { source, vodId, proxyUrl: makeProxyUrl });
        sendJson2(res, 200, {
          ok: true,
          item,
          fetchedAt: Date.now()
        });
      },
      { auth: true, rateKey: "detail", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/handlers/source-test.js
var require_source_test = __commonJS({
  "server/handlers/source-test.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var cms = require_cms();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2, ApiError } = require_http();
    var { fetchText } = require_safe_fetch();
    var { validateUrlSync, SsrfError } = require_ssrf();
    var { allowPrivateFor, parseCmsPayload, upstreamErrorMessage } = require_common();
    var { normalizeSourceUrl } = require_text();
    function hostOf(url) {
      try {
        return new URL(url).host;
      } catch (error) {
        return "";
      }
    }
    module2.exports = createRoute(
      async (req, res) => {
        const body = await readJson(req, config.bodyMaxBytes);
        const allowPrivate = allowPrivateFor(req);
        let url;
        try {
          url = normalizeSourceUrl(validateUrlSync(String(body.url || ""), { allowPrivate }).toString());
        } catch (error) {
          if (error instanceof SsrfError) {
            throw new ApiError(400, error.code, "\u6E90\u5730\u5740\u4E0D\u88AB\u5141\u8BB8\uFF1A" + error.message);
          }
          throw error;
        }
        const startedAt = Date.now();
        try {
          const response = await fetchText(cms.searchUrl(url, "\u6D4B\u8BD5", 1), {
            timeoutMs: config.testTimeoutMs,
            maxBytes: config.jsonMaxBytes,
            allowPrivate
          });
          if (response.status < 200 || response.status >= 300) {
            sendJson2(res, 200, {
              ok: false,
              ms: Date.now() - startedAt,
              error: "\u6E90\u7AD9\u8FD4\u56DE HTTP " + response.status
            });
            return;
          }
          const data = parseCmsPayload(response.text);
          const parsed = cms.parseSearchResponse(data);
          if (!parsed.listIsArray) {
            sendJson2(res, 200, {
              ok: false,
              ms: Date.now() - startedAt,
              error: "\u6E90\u7AD9\u6CA1\u6709\u8FD4\u56DE Apple CMS \u7684 list \u5217\u8868"
            });
            return;
          }
          sendJson2(res, 200, {
            ok: true,
            ms: Date.now() - startedAt,
            count: parsed.items.length,
            format: cms.detectCmsFormat(response.text),
            name: hostOf(url)
          });
        } catch (error) {
          sendJson2(res, 200, {
            ok: false,
            ms: Date.now() - startedAt,
            error: upstreamErrorMessage(error, false)
          });
        }
      },
      { auth: true, rateKey: "sourceTest", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/lib/source-list.js
var require_source_list = __commonJS({
  "server/lib/source-list.js"(exports2, module2) {
    "use strict";
    var { cleanText, normalizeSourceUrl } = require_text();
    var MAX_SOURCES = 50;
    function looksLikeCmsSite(site) {
      if (!site || typeof site !== "object") return false;
      if (site.isAdult === true) return false;
      const type = site.type;
      if (type !== void 0 && type !== null && type !== "") {
        const number = Number(type);
        if (number !== 1) return false;
      }
      if (site.jar || site.spider || site.ext) return false;
      return true;
    }
    function siteToSource(site, index) {
      if (!looksLikeCmsSite(site)) return null;
      const url = normalizeSourceUrl(site.api || site.url || site.data);
      if (!url) return null;
      const name = cleanText(site.name || site.title || site.key, 60) || "\u8BA2\u9605\u6E90 " + (index + 1);
      const detail = cleanText(site.detail || site.remark || "", 120);
      return { name, url, detail };
    }
    function entryToSource(entry, index) {
      if (!entry || typeof entry !== "object") return null;
      if (entry.isAdult === true) return null;
      const url = normalizeSourceUrl(entry.url || entry.api);
      if (!url) return null;
      const name = cleanText(entry.name || entry.title, 60) || "\u8BA2\u9605\u6E90 " + (index + 1);
      const detail = cleanText(entry.detail || entry.remark || "", 120);
      return { name, url, detail };
    }
    function parseSubscription(payload) {
      let entries = null;
      let name = "";
      let isSites = false;
      if (Array.isArray(payload)) {
        entries = payload;
      } else if (payload && typeof payload === "object") {
        name = cleanText(payload.name || payload.title, 80);
        if (Array.isArray(payload.sources)) {
          entries = payload.sources;
        } else if (Array.isArray(payload.sites)) {
          entries = payload.sites;
          isSites = true;
        }
      }
      if (!entries) {
        const error = new Error("\u8BA2\u9605\u683C\u5F0F\u4E0D\u652F\u6301");
        error.code = "SUBSCRIPTION_FORMAT";
        error.status = 400;
        throw error;
      }
      const sources = [];
      const seen = /* @__PURE__ */ new Set();
      let skipped = 0;
      entries.forEach((entry, index) => {
        const source = isSites ? siteToSource(entry, index) : entryToSource(entry, index);
        if (!source) {
          skipped += 1;
          return;
        }
        if (seen.has(source.url)) {
          skipped += 1;
          return;
        }
        seen.add(source.url);
        if (sources.length >= MAX_SOURCES) return;
        sources.push(source);
      });
      const truncated = Math.max(0, entries.length - skipped - sources.length);
      const warnings = [];
      if (skipped > 0) warnings.push("\u5DF2\u8DF3\u8FC7 " + skipped + " \u6761\u683C\u5F0F\u6216\u534F\u8BAE\u4E0D\u652F\u6301\u7684\u6761\u76EE");
      if (truncated > 0) warnings.push("\u8D85\u8FC7 " + MAX_SOURCES + " \u6761\u4E0A\u9650\uFF0C\u5DF2\u622A\u65AD " + truncated + " \u6761");
      return { name, sources, skipped, truncated, warnings };
    }
    module2.exports = {
      MAX_SOURCES,
      parseSubscription,
      looksLikeCmsSite
    };
  }
});

// server/handlers/subscription.js
var require_subscription = __commonJS({
  "server/handlers/subscription.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var { createRoute } = require_route();
    var { readJson, sendJson: sendJson2, ApiError } = require_http();
    var { fetchText } = require_safe_fetch();
    var { validateUrlSync, SsrfError } = require_ssrf();
    var { parseSubscription } = require_source_list();
    var { allowPrivateFor, parseCmsJson } = require_common();
    module2.exports = createRoute(
      async (req, res) => {
        const body = await readJson(req, config.bodyMaxBytes);
        if (body.authorized !== true) {
          throw new ApiError(400, "AUTHORIZATION_REQUIRED", "\u8BF7\u5148\u786E\u8BA4\u4F60\u5DF2\u83B7\u5F97\u8BE5\u8BA2\u9605\u7684\u4F7F\u7528\u6388\u6743");
        }
        const allowPrivate = allowPrivateFor(req);
        let url;
        try {
          url = validateUrlSync(String(body.url || ""), { allowPrivate }).toString();
        } catch (error) {
          if (error instanceof SsrfError) {
            throw new ApiError(400, error.code, "\u8BA2\u9605\u5730\u5740\u4E0D\u88AB\u5141\u8BB8\uFF1A" + error.message);
          }
          throw error;
        }
        const response = await fetchText(url, {
          timeoutMs: config.subscriptionTimeoutMs,
          maxBytes: config.subscriptionMaxBytes,
          allowPrivate
        });
        if (response.status < 200 || response.status >= 300) {
          throw new ApiError(502, "SUBSCRIPTION_HTTP", "\u8BA2\u9605\u5730\u5740\u8FD4\u56DE HTTP " + response.status);
        }
        const payload = parseCmsJson(response.text);
        const parsed = parseSubscription(payload);
        sendJson2(res, 200, Object.assign({ ok: true }, parsed));
      },
      { auth: true, rateKey: "subscription", methods: ["POST", "OPTIONS"] }
    );
  }
});

// server/lib/m3u8.js
var require_m3u8 = __commonJS({
  "server/lib/m3u8.js"(exports2, module2) {
    "use strict";
    function isM3u8ContentType(value) {
      return /mpegurl|m3u8/i.test(String(value || ""));
    }
    function isM3u8Url(value) {
      try {
        return /\.m3u8$/i.test(new URL(value).pathname);
      } catch (error) {
        return /\.m3u8(?:$|[?#])/i.test(String(value || ""));
      }
    }
    function isProxyPath(value) {
      return /^\/api\/proxy\?/i.test(String(value || ""));
    }
    function resolveAbsolute(uri, baseUrl) {
      try {
        return new URL(uri, baseUrl);
      } catch (error) {
        return null;
      }
    }
    function rewritePlaylist(text, baseUrl, options = {}) {
      const makeProxyUrl = typeof options.makeProxyUrl === "function" ? options.makeProxyUrl : null;
      const proxySegments = Boolean(options.proxySegments);
      const rewriteUri = (uri) => {
        const raw = String(uri || "").trim();
        if (!raw || /^data:/i.test(raw) || isProxyPath(raw)) return uri;
        const absolute = resolveAbsolute(raw, baseUrl);
        if (!absolute) return uri;
        if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return uri;
        const shouldProxy = proxySegments || absolute.protocol === "http:";
        if (!shouldProxy || !makeProxyUrl) return absolute.toString();
        return makeProxyUrl(absolute.toString());
      };
      return String(text || "").split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith("#")) {
          if (!/URI="/i.test(trimmed)) return line;
          return line.replace(/URI="([^"]*)"/gi, (match, uri) => 'URI="' + rewriteUri(uri) + '"');
        }
        return rewriteUri(trimmed);
      }).join("\n");
    }
    module2.exports = {
      isM3u8ContentType,
      isM3u8Url,
      isProxyPath,
      rewritePlaylist
    };
  }
});

// server/handlers/proxy.js
var require_proxy = __commonJS({
  "server/handlers/proxy.js"(exports2, module2) {
    "use strict";
    var config = require_config();
    var { createRoute } = require_route();
    var { ApiError } = require_http();
    var { open, readAll } = require_safe_fetch();
    var { createProxyPath, verifyProxyParams } = require_sign();
    var { rewritePlaylist, isM3u8ContentType, isM3u8Url } = require_m3u8();
    var { validateUrlSync } = require_ssrf();
    var { allowPrivateFor } = require_common();
    var PASS_HEADERS = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
      "last-modified",
      "etag"
    ];
    function copyHeaders(res, headers) {
      PASS_HEADERS.forEach((name) => {
        if (headers[name] !== void 0) res.setHeader(name, headers[name]);
      });
    }
    function safeDestroy(request) {
      try {
        request.destroy();
      } catch (error) {
      }
    }
    module2.exports = createRoute(
      async (req, res) => {
        const requestUrl = new URL(req.url, "http://local");
        const verified = verifyProxyParams(config.signingSecret, {
          u: requestUrl.searchParams.get("u"),
          exp: requestUrl.searchParams.get("exp"),
          sig: requestUrl.searchParams.get("sig")
        });
        const targetUrl = verified.url;
        const allowPrivate = allowPrivateFor(req);
        validateUrlSync(targetUrl, { allowPrivate });
        const segProxy = requestUrl.searchParams.get("seg") === "proxy";
        const method = req.method === "HEAD" ? "HEAD" : "GET";
        const headers = {};
        if (req.headers.range) headers.range = String(req.headers.range);
        if (segProxy) {
          try {
            headers.referer = new URL(targetUrl).origin + "/";
          } catch (error) {
          }
        }
        let upstream;
        try {
          upstream = await open(targetUrl, {
            method,
            headers,
            timeoutMs: config.proxyTimeoutMs,
            maxRedirects: config.redirectMax,
            allowPrivate
          });
        } catch (error) {
          throw error;
        }
        const contentType = String(upstream.headers["content-type"] || "");
        const looksLikePlaylist = isM3u8ContentType(contentType) || isM3u8Url(targetUrl) && !/^video\/|^audio\//i.test(contentType);
        const onClose = () => {
          if (!res.writableEnded) safeDestroy(upstream.request);
        };
        res.on("close", onClose);
        const declaredLength = Number(upstream.headers["content-length"]);
        if (method === "GET" && Number.isFinite(declaredLength) && declaredLength > config.proxyMaxBytes) {
          safeDestroy(upstream.request);
          res.removeListener("close", onClose);
          throw new ApiError(
            502,
            "PROXY_RESPONSE_TOO_LARGE",
            "\u7247\u6E90\u54CD\u5E94\u8D85\u8FC7\u5F53\u524D\u90E8\u7F72\u7684\u5355\u6B21\u54CD\u5E94\u5927\u5C0F\u4E0A\u9650"
          );
        }
        try {
          if (method === "GET" && upstream.status === 200 && looksLikePlaylist) {
            const body = await readAll(upstream.stream, config.m3u8MaxBytes);
            const remainingMs = Math.max(10 * 60 * 1e3, verified.exp * 1e3 - Date.now());
            const text = rewritePlaylist(body.toString("utf8"), upstream.url, {
              proxySegments: segProxy,
              makeProxyUrl: (childUrl) => {
                const path = createProxyPath(config.signingSecret, childUrl, { ttlMs: remainingMs });
                return segProxy ? path + "&seg=proxy" : path;
              }
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(text);
            return;
          }
          res.statusCode = upstream.status || 502;
          copyHeaders(res, upstream.headers);
          if (method === "HEAD") {
            upstream.stream.resume();
            safeDestroy(upstream.request);
            res.end();
            return;
          }
          let bytes = 0;
          let aborted = false;
          upstream.stream.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > config.proxyMaxBytes && !aborted) {
              aborted = true;
              safeDestroy(upstream.request);
              res.destroy();
            }
          });
          upstream.stream.on("error", () => {
            if (!res.writableEnded) res.end();
          });
          upstream.stream.pipe(res);
        } catch (error) {
          safeDestroy(upstream.request);
          throw error;
        } finally {
          res.once("finish", () => {
            res.removeListener("close", onClose);
          });
        }
      },
      {
        auth: false,
        wildcardCors: true,
        rateKey: "proxy",
        methods: ["GET", "HEAD", "OPTIONS"]
      }
    );
  }
});

// tools/scf-entry.js
var { Readable, Writable } = require("stream");
var { sendJson } = require_http();
var ROUTES = {
  "/health": require_health(),
  "/browse": require_browse(),
  "/categories": require_categories(),
  "/search": require_search(),
  "/detail": require_detail(),
  "/source-test": require_source_test(),
  "/subscription": require_subscription(),
  "/proxy": require_proxy()
};
var MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
var HOP_HEADERS = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "x-accel-buffering"
]);
var TEXT_TYPE = /^(text\/|application\/(json|javascript|xml|x-ndjson)|application\/vnd\.apple\.mpegurl|image\/svg\+xml)/i;
function normalizePath(pathname) {
  let value = pathname || "/";
  while (value === "/api" || value.startsWith("/api/")) {
    value = value.slice(4) || "/";
  }
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value || "/";
}
function queryOf(event) {
  const params = new URLSearchParams();
  const source = event && event.queryString && typeof event.queryString === "object" ? event.queryString : event && event.queryStringParameters && typeof event.queryStringParameters === "object" ? event.queryStringParameters : null;
  if (!source) return "";
  Object.keys(source).forEach((name) => {
    const value = source[name];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== void 0 && item !== null) params.append(name, String(item));
      });
    } else if (value !== void 0 && value !== null) {
      params.append(name, String(value));
    }
  });
  return params.toString();
}
function normalizeHeaders(event) {
  const headers = {};
  const source = event && event.headers && typeof event.headers === "object" ? event.headers : {};
  Object.keys(source).forEach((name) => {
    const value = source[name];
    if (value === void 0 || value === null) return;
    headers[String(name).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  });
  if (!headers["x-forwarded-for"] && headers["x-scf-remote-addr"]) {
    headers["x-forwarded-for"] = headers["x-scf-remote-addr"];
  }
  return headers;
}
var CaptureResponse = class extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.aborted = false;
    this._headersSent = false;
  }
  get headersSent() {
    return this._headersSent;
  }
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }
  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  }
  removeHeader(name) {
    delete this.headers[String(name).toLowerCase()];
  }
  writeHead(status, headers) {
    this.statusCode = Number(status) || this.statusCode;
    if (headers && typeof headers === "object") {
      Object.keys(headers).forEach((name) => this.setHeader(name, headers[name]));
    }
    this._headersSent = true;
    return this;
  }
  write(chunk, encoding, callback) {
    this._headersSent = true;
    return super.write(chunk, encoding, callback);
  }
  end(chunk, encoding, callback) {
    this._headersSent = true;
    return super.end(chunk, encoding, callback);
  }
  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }
  _destroy(error, callback) {
    if (!this.writableEnded) this.aborted = true;
    callback(error);
  }
};
function toScfResponse(res, method) {
  const status = res.statusCode || 200;
  const headers = {};
  Object.keys(res.headers).forEach((name) => {
    const value = res.headers[name];
    if (HOP_HEADERS.has(name) || value === void 0 || value === null) return;
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  });
  if (res.aborted) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "\u7247\u6E90\u54CD\u5E94\u8D85\u8FC7\u5F53\u524D\u90E8\u7F72\u7684\u5355\u6B21\u54CD\u5E94\u5927\u5C0F\u4E0A\u9650\u6216\u8FDE\u63A5\u4E2D\u65AD",
        code: "RESPONSE_ABORTED"
      })
    };
  }
  const buffer = Buffer.concat(res.chunks);
  if (buffer.length > MAX_RESPONSE_BYTES) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "\u7247\u6E90\u54CD\u5E94\u8D85\u8FC7\u5F53\u524D\u90E8\u7F72\u7684\u5355\u6B21\u54CD\u5E94\u5927\u5C0F\u4E0A\u9650",
        code: "PROXY_RESPONSE_TOO_LARGE"
      })
    };
  }
  if (method === "HEAD" || status === 204 || status === 304) {
    return { statusCode: status, headers, body: "" };
  }
  const contentType = String(headers["content-type"] || "");
  if (!contentType || TEXT_TYPE.test(contentType)) {
    return { statusCode: status, headers, body: buffer.toString("utf8") };
  }
  return {
    statusCode: status,
    headers,
    body: buffer.toString("base64"),
    isBase64Encoded: true
  };
}
async function main_handler(event) {
  const method = String(event && event.httpMethod || "GET").toUpperCase();
  const path = String(event && event.path || "/") || "/";
  const search = queryOf(event);
  const parsed = new URL(path + (search ? (path.includes("?") ? "&" : "?") + search : ""), "http://scf.local");
  const pathname = normalizePath(parsed.pathname);
  const handler = ROUTES[pathname];
  if (!handler) {
    const notFound = new CaptureResponse();
    sendJson(notFound, 404, { error: "\u63A5\u53E3\u4E0D\u5B58\u5728", code: "NOT_FOUND" });
    return toScfResponse(notFound, method);
  }
  const rawBody = typeof event.body === "string" ? event.body : "";
  const body = event.isBase64Encoded ? Buffer.from(rawBody, "base64") : Buffer.from(rawBody, "utf8");
  const headers = normalizeHeaders(event);
  const remote = String(headers["x-scf-remote-addr"] || headers["x-forwarded-for"] || "").split(",")[0].trim();
  const req = new Readable({ read() {
  } });
  req.method = method;
  req.url = pathname + parsed.search;
  req.headers = headers;
  req.httpVersion = "1.1";
  req.socket = { remoteAddress: remote, encrypted: true };
  req.connection = req.socket;
  req.push(body.length ? body : null);
  req.push(null);
  const res = new CaptureResponse();
  try {
    await handler(req, res);
  } catch (error) {
    if (!res.writableEnded) {
      sendJson(res, 500, { error: "\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528", code: "INTERNAL_ERROR" });
    }
  }
  if (!res.writableEnded) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2e4);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      res.once("finish", done);
      res.once("close", done);
    });
  }
  return toScfResponse(res, method);
}
exports.main_handler = main_handler;

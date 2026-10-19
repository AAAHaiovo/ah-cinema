'use strict';

/*
 * 服务端配置。所有值只从环境变量读取，缺省值按“安全优先”设置。
 * 生产环境缺少访问口令或签名密钥时不提供任何受保护接口。
 */

const explicitMode = String(process.env.AH_ENV || '').trim().toLowerCase();
const MODE =
  explicitMode ||
  ((process.env.VERCEL || process.env.NODE_ENV === 'production') ? 'production' : 'development');
const IS_PRODUCTION = MODE === 'production';
const IS_VERCEL = Boolean(process.env.VERCEL);

function stringEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
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
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function splitList(raw) {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const apiToken = stringEnv('AH_API_TOKEN');
const signingSecret = stringEnv('AH_SIGNING_SECRET');
const devSigningSecret = 'ah-dev-only-insecure-signing-secret';

const missingEnv = [];
if (IS_PRODUCTION) {
  if (!apiToken) missingEnv.push('AH_API_TOKEN');
  if (!signingSecret) missingEnv.push('AH_SIGNING_SECRET');
}

const defaultOrigins = [
  'https://aaahaiovo.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
];

const allowedOrigins = Array.from(new Set(defaultOrigins.concat(splitList(process.env.AH_ALLOWED_ORIGINS))));

const config = {
  mode: MODE,
  isProduction: IS_PRODUCTION,
  isVercel: IS_VERCEL,
  version: '0.8.2',
  apiVersion: 1,

  apiToken,
  signingSecret: signingSecret || devSigningSecret,
  hasSigningSecret: Boolean(signingSecret),

  authRequired: Boolean(apiToken),
  // 仅开发环境、仅 loopback 请求可跳过口令 / 允许私网地址。
  devNoAuth: !IS_PRODUCTION && boolEnv('AH_DEV_NO_AUTH'),
  devAllowPrivate: !IS_PRODUCTION && boolEnv('AH_DEV_ALLOW_PRIVATE'),

  missingEnv,
  configured: missingEnv.length === 0,

  allowedOrigins,

  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AH-Cinema/0.8.2',

  maxSources: 8,
  searchMaxPages: intEnv('AH_SEARCH_MAX_PAGES', 2, 1, 5),
  searchSourceTimeoutMs: 5000,
  searchTotalTimeoutMs: 8000,
  browseMaxPage: 100000,
  browseTotalTimeoutMs: 18000,
  browseConcurrency: intEnv('AH_BROWSE_CONCURRENCY', 6, 1, 12),
  detailTimeoutMs: 6000,
  testTimeoutMs: 5000,
  subscriptionTimeoutMs: 8000,
  proxyTimeoutMs: 15000,

  redirectMax: 3,
  bodyMaxBytes: 64 * 1024,
  jsonMaxBytes: 2 * 1024 * 1024,
  subscriptionMaxBytes: 100 * 1024,
  m3u8MaxBytes: 2 * 1024 * 1024,
  posterMaxBytes: 0,

  proxyTtlSeconds: intEnv('AH_PROXY_TTL_SECONDS', 43200, 60, 86400),
  proxyMaxBytes: intEnv('AH_PROXY_MAX_BYTES', 20 * 1024 * 1024, 1024, 100 * 1024 * 1024),
  proxySegmentTtlSeconds: 6 * 60 * 60,

  rateLimits: {
    search: { limit: 60, windowMs: 60 * 1000 },
    detail: { limit: 120, windowMs: 60 * 1000 },
    sourceTest: { limit: 30, windowMs: 60 * 1000 },
    subscription: { limit: 20, windowMs: 60 * 1000 },
    proxy: { limit: 1200, windowMs: 60 * 1000 }
  },

  // 明显的成人分类，直接丢弃（不做标题相关性过滤）。
  adultKeywords: ['伦理', '情色', '色情', '成人', '三级', '里番', '无码', '有码', '中文字幕无码']
};

module.exports = config;

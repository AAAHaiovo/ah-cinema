/* 远程服务客户端：API 地址、访问口令、JSON 请求与 NDJSON 流式搜索。 */

import { state } from './store.js';

export const TOKEN_KEY = 'ah-api-token';
export const MAX_TOKEN_LENGTH = 200;

export class RemoteError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RemoteError';
    this.code = options.code || '';
    this.status = Number(options.status) || 0;
    this.timedOut = Boolean(options.timedOut);
  }
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch (error) {
    return '';
  }
}

function safeStorageSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (error) {
    /* 私密模式忽略。 */
  }
}

export function getToken() {
  return safeStorageGet(TOKEN_KEY).trim();
}

export function setToken(value) {
  const token = String(value || '').trim().slice(0, MAX_TOKEN_LENGTH);
  safeStorageSet(TOKEN_KEY, token);
  return token;
}

export function clearToken() {
  safeStorageSet(TOKEN_KEY, '');
}

export function hasToken() {
  return Boolean(getToken());
}

export function isGitHubPages() {
  return /(^|\.)github\.io$/i.test(location.hostname);
}

/*
 * apiBase 为空时：Vercel / 本地开发用同源；GitHub Pages 视为未配置，
 * 避免把请求打到 Pages 上必然 404 的 /api/。
 */
export function apiOrigin() {
  const base = String(state.settings.apiBase || '').trim();
  if (base) return base;
  if (isGitHubPages()) return '';
  return location.origin;
}

export function isConfigured() {
  return Boolean(apiOrigin());
}

export function apiUrl(path) {
  const origin = apiOrigin();
  const suffix = String(path || '');
  const normalized = suffix.startsWith('/') ? suffix : '/' + suffix;
  if (!origin) return normalized;
  return origin + normalized;
}

export function apiLabel() {
  const origin = apiOrigin();
  if (!origin) return '未配置服务地址';
  try {
    const url = new URL(origin);
    return url.host + (url.pathname.replace(/\/+$/, '') || '');
  } catch (error) {
    return origin;
  }
}

/* 服务端返回的 /api/proxy 路径要拼到 API origin；必要时追加分片代理。 */
export function resolveSourceUrl(src) {
  const value = String(src || '').trim();
  if (!value) return '';

  if (value.startsWith('/api/')) {
    let url = (apiOrigin() || '') + value;
    if (state.settings.hlsProxySegments && /^\/api\/proxy\?/.test(value)) {
      if (!/[?&]seg=proxy(&|$)/.test(value)) url += '&seg=proxy';
    }
    return url;
  }

  return value;
}

function authHeaders(extra) {
  const headers = { ...(extra || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function parseErrorResponse(response, fallback) {
  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }

  const code = payload && typeof payload.code === 'string' ? payload.code : '';
  let message = payload && typeof payload.error === 'string' && payload.error ? payload.error : fallback;

  if (response.status === 401) message = '访问口令不正确，请到源管理重新填写';
  else if (response.status === 403 && !message) message = '没有权限访问该服务';
  else if (response.status === 429) message = '请求过于频繁，请稍后再试';
  else if (response.status === 503 || code === 'NOT_CONFIGURED') {
    message = '服务端缺少访问口令或签名密钥配置';
  } else if (response.status >= 500) {
    message = message || '服务暂时不可用，请稍后再试';
  }

  return new RemoteError(message, { code, status: response.status });
}

function networkError(error) {
  if (error instanceof RemoteError) return error;
  if (error && error.name === 'AbortError') {
    return new RemoteError('请求已取消', { code: 'ABORTED' });
  }
  return new RemoteError('无法连接服务，请检查服务地址与网络', { code: 'NETWORK' });
}

async function request(path, options = {}) {
  if (!isConfigured()) {
    throw new RemoteError('还没有配置服务地址', { code: 'NOT_CONFIGURED' });
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let detach = null;

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else {
      const onAbort = () => controller.abort();
      options.signal.addEventListener('abort', onAbort, { once: true });
      detach = () => options.signal.removeEventListener('abort', onAbort);
    }
  }

  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      headers: authHeaders(options.body ? { 'Content-Type': 'application/json' } : {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store'
    });

    return { response, controller, detach, timer };
  } catch (error) {
    if (detach) detach();
    clearTimeout(timer);
    if (error && error.name === 'AbortError') {
      if (options.signal && options.signal.aborted) {
        throw new RemoteError('请求已取消', { code: 'ABORTED' });
      }
      throw new RemoteError(options.timeoutMessage || '请求超时，请稍后再试', {
        code: 'TIMEOUT',
        timedOut: true
      });
    }
    throw networkError(error);
  }
}

async function readJson(response) {
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    throw new RemoteError('读取服务响应失败', { code: 'READ_FAILED', status: response.status });
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RemoteError('服务返回了无法识别的数据', { code: 'BAD_RESPONSE', status: response.status });
  }
}

async function requestJson(path, options = {}) {
  const { response, detach, timer } = await request(path, options);
  try {
    if (!response.ok) throw await parseErrorResponse(response, '服务返回错误（HTTP ' + response.status + '）');
    return await readJson(response);
  } finally {
    if (detach) detach();
    clearTimeout(timer);
  }
}

export async function checkHealth(options = {}) {
  if (!isConfigured()) {
    return {
      ok: false,
      reachable: false,
      configured: false,
      message: '还没有配置服务地址',
      missingEnv: [],
      authRequired: null
    };
  }

  try {
    const data = await requestJson('/api/health', {
      timeoutMs: Number(options.timeoutMs) || 8000,
      signal: options.signal
    });

    return {
      ok: Boolean(data && data.ok),
      reachable: true,
      configured: true,
      version: data && data.version,
      apiVersion: data && data.apiVersion,
      authRequired: Boolean(data && data.authRequired),
      proxyReady: Boolean(data && data.proxyReady),
      missingEnv: Array.isArray(data && data.missingEnv) ? data.missingEnv : [],
      message: data && data.ok ? '服务正常' : '服务端缺少必要配置'
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      configured: true,
      message: networkError(error).message,
      missingEnv: [],
      authRequired: null,
      error: networkError(error)
    };
  }
}

function normalizeSourceParam(source) {
  return {
    id: String(source.id || ''),
    name: String(source.name || '').slice(0, 60),
    url: String(source.url || '')
  };
}

export async function searchSources(payload, options = {}) {
  const body = {
    q: String(payload.q || '').trim().slice(0, 80),
    sources: (Array.isArray(payload.sources) ? payload.sources : []).slice(0, 8).map(normalizeSourceParam)
  };

  if (!body.q || !body.sources.length) {
    throw new RemoteError('请填写关键词并至少启用一个源', { code: 'INPUT' });
  }

  const { response, detach, timer } = await request('/api/search?stream=1', {
    method: 'POST',
    body,
    timeoutMs: Number(options.timeoutMs) || 15000,
    signal: options.signal,
    timeoutMessage: '搜索超时'
  });

  let gotDone = false;

  const emit = (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'done') gotDone = true;
    if (typeof options.onEvent === 'function') options.onEvent(event);
  };

  const consumeLine = (line) => {
    const text = line.trim();
    if (!text) return;
    try {
      emit(JSON.parse(text));
    } catch (error) {
      /* 忽略不完整的行，由后续分块补齐。 */
    }
  };

  try {
    if (!response.ok) throw await parseErrorResponse(response, '搜索失败（HTTP ' + response.status + '）');

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        let newlineAt = buffer.indexOf('\n');
        while (newlineAt >= 0) {
          consumeLine(buffer.slice(0, newlineAt));
          buffer = buffer.slice(newlineAt + 1);
          newlineAt = buffer.indexOf('\n');
        }
      }

      buffer += decoder.decode();
      consumeLine(buffer);
    } else {
      const text = await response.text();
      text.split('\n').forEach(consumeLine);
    }

    if (!gotDone && typeof options.onEvent === 'function') {
      options.onEvent({ type: 'done', incomplete: true });
    }
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    if (error && error.name === 'AbortError') {
      throw new RemoteError('搜索已取消', { code: 'ABORTED' });
    }
    throw new RemoteError('搜索连接中断，请重试', { code: 'STREAM_FAILED' });
  } finally {
    if (detach) detach();
    clearTimeout(timer);
  }
}

/* 首页片库：拉取已启用源的最新列表（不带关键词）。 */
export async function browseSources(payload, options = {}) {
  const body = {
    page: Math.max(1, Number.parseInt(payload.page, 10) || 1),
    sources: (Array.isArray(payload.sources) ? payload.sources : []).slice(0, 8).map(normalizeSourceParam)
  };

  if (!body.sources.length) {
    throw new RemoteError('请先添加并启用至少一个源', { code: 'INPUT' });
  }

  const data = await requestJson('/api/browse', {
    method: 'POST',
    body,
    timeoutMs: Number(options.timeoutMs) || 15000,
    signal: options.signal,
    timeoutMessage: '加载片库超时'
  });

  if (!data || data.ok !== true || !Array.isArray(data.sources)) {
    throw new RemoteError('服务返回了无法识别的数据', { code: 'BAD_RESPONSE' });
  }

  return data;
}

export async function fetchDetail(source, vodId, options = {}) {
  return requestJson('/api/detail', {
    method: 'POST',
    body: { source: normalizeSourceParam(source), id: String(vodId || '') },
    timeoutMs: Number(options.timeoutMs) || 12000,
    signal: options.signal,
    timeoutMessage: '获取详情超时'
  });
}

export async function testSourceUrl(url, options = {}) {
  return requestJson('/api/source-test', {
    method: 'POST',
    body: { url: String(url || '') },
    timeoutMs: Number(options.timeoutMs) || 10000,
    signal: options.signal,
    timeoutMessage: '测活超时'
  });
}

export async function fetchSubscription(url, options = {}) {
  return requestJson('/api/subscription', {
    method: 'POST',
    body: { url: String(url || ''), authorized: true },
    timeoutMs: Number(options.timeoutMs) || 12000,
    signal: options.signal,
    timeoutMessage: '订阅拉取超时'
  });
}

'use strict';

/* m3u8 重写：相对 URI → 绝对 URI；需要规避混合内容或加 Referer 的再走签名代理。 */

function isM3u8ContentType(value) {
  return /mpegurl|m3u8/i.test(String(value || ''));
}

function isM3u8Url(value) {
  try {
    return /\.m3u8$/i.test(new URL(value).pathname);
  } catch (error) {
    return /\.m3u8(?:$|[?#])/i.test(String(value || ''));
  }
}

function isProxyPath(value) {
  return /^\/api\/proxy\?/i.test(String(value || ''));
}

function resolveAbsolute(uri, baseUrl) {
  try {
    return new URL(uri, baseUrl);
  } catch (error) {
    return null;
  }
}

/*
 * options:
 * - makeProxyUrl(url) → 签名后的 /api/proxy 路径
 * - proxySegments: 是否连 https 分片也走代理
 */
function rewritePlaylist(text, baseUrl, options = {}) {
  const makeProxyUrl = typeof options.makeProxyUrl === 'function' ? options.makeProxyUrl : null;
  const proxySegments = Boolean(options.proxySegments);

  const rewriteUri = (uri) => {
    const raw = String(uri || '').trim();
    if (!raw || /^data:/i.test(raw) || isProxyPath(raw)) return uri;

    const absolute = resolveAbsolute(raw, baseUrl);
    if (!absolute) return uri;
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return uri;

    const shouldProxy = proxySegments || absolute.protocol === 'http:';
    if (!shouldProxy || !makeProxyUrl) return absolute.toString();
    return makeProxyUrl(absolute.toString());
  };

  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        if (!/URI="/i.test(trimmed)) return line;
        return line.replace(/URI="([^"]*)"/gi, (match, uri) => 'URI="' + rewriteUri(uri) + '"');
      }

      return rewriteUri(trimmed);
    })
    .join('\n');
}

module.exports = {
  isM3u8ContentType,
  isM3u8Url,
  isProxyPath,
  rewritePlaylist
};

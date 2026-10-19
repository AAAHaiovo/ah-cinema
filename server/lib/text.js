'use strict';

/* 文本清洗：去 HTML、解实体、截断。只处理字符串，不解析网页结构。 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’'
};

function decodeEntities(input) {
  return String(input === undefined || input === null ? '' : input).replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch (error) {
          return match;
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    }
  );
}

function stripHtml(input) {
  if (input === undefined || input === null) return '';

  let text = String(input);
  text = text.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>/gi, '\n');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return text;
}

function truncate(input, max) {
  const text = String(input === undefined || input === null ? '' : input);
  const limit = Math.max(0, Number(max) || 0);
  if (!limit) return text;
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return chars.slice(0, limit).join('') + '…';
}

function cleanText(input, max) {
  return truncate(stripHtml(input), max);
}

/* 只保留 http/https 的绝对地址。 */
function safeHttpUrl(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

/*
 * 源地址归一化：http(s)、无账号密码、去掉尾部斜杠。
 * Apple CMS 的 XML 接口通常是 /at/xml/ 目录，末尾斜杠有路由意义，必须保留。
 */
function normalizeSourceUrl(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return '';
  try {
    const url = new URL(safe);
    url.hash = '';
    const text = url.toString();
    if (/\/at\/xml\/$/i.test(url.pathname)) return text;
    return stripTrailingSlash(text);
  } catch (error) {
    return stripTrailingSlash(safe);
  }
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[·・:：\-—_.,，。!！?？'"“”‘’()（）\[\]【】]/g, '');
}

module.exports = {
  decodeEntities,
  stripHtml,
  truncate,
  cleanText,
  safeHttpUrl,
  stripTrailingSlash,
  normalizeSourceUrl,
  normalizeTitle
};

'use strict';

/*
 * Apple CMS（MacCMS v10）XML 读取。
 *
 * 只解析点播接口常见的 <rss><class> / <list><video> 结构，
 * 把它转换成与 JSON 接口相同的对象形状，后面的 parseClassList /
 * parseSearchResponse / buildDetailItem 不需要区分来源格式。
 *
 * 安全约束：
 * - 拒绝 DOCTYPE / ENTITY，避免 XXE 与实体膨胀；
 * - 限制嵌套深度与元素数量；
 * - 输入本身已经由 safe-fetch 限制大小。
 */

const { decodeEntities } = require('./text');

class XmlError extends Error {
  constructor(message, code = 'XML_INVALID') {
    super(message || 'XML 格式不正确');
    this.name = 'XmlError';
    this.code = code;
  }
}

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 200000;

const TOKEN_RE =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/g;

const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function localName(name) {
  return String(name || '').split(':').pop().toLowerCase();
}

function parseAttrs(source) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(String(source || '')))) {
    attrs[localName(match[1])] = decodeEntities(match[2] !== undefined ? match[2] : match[3]);
  }
  return attrs;
}

function createElement(name, attrs) {
  return { name, attrs: attrs || {}, children: [], text: '' };
}

function appendText(element, value, cdata) {
  if (!value) return;
  element.text += cdata ? value : decodeEntities(value);
}

/* 返回根元素。调用方通常只需要 <rss> 或 <root>。 */
function parseXml(source) {
  const raw = String(source === undefined || source === null ? '' : source).replace(/^﻿/, '');
  if (!raw.trim()) throw new XmlError('XML 内容为空');

  /* CDATA 与注释里的 "<!" 是正文，不参与危险声明检查。 */
  const declarations = raw
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (declarations.includes('<!')) {
    throw new XmlError('不支持 DOCTYPE 或实体声明', 'XML_UNSAFE');
  }

  const documentRoot = createElement('#document');
  const stack = [documentRoot];
  let lastIndex = 0;
  let elementCount = 0;
  TOKEN_RE.lastIndex = 0;

  let match;
  while ((match = TOKEN_RE.exec(raw))) {
    const between = raw.slice(lastIndex, match.index);
    if (between) appendText(stack[stack.length - 1], between, false);
    lastIndex = TOKEN_RE.lastIndex;

    if (match[1] !== undefined) {
      appendText(stack[stack.length - 1], match[1], true);
      continue;
    }

    /* 注释与处理指令没有捕获到标签名。 */
    if (match[2] === undefined) continue;

    const closing = match[2] === '/';
    const tagName = match[3];
    const attrsText = match[4] || '';
    const selfClosing = match[5] === '/';

    if (closing) {
      if (stack.length <= 1) throw new XmlError('出现多余的结束标签：' + tagName);
      const current = stack.pop();
      if (localName(current.name) !== localName(tagName)) {
        throw new XmlError('标签未正确闭合：' + current.name + ' / ' + tagName);
      }
      continue;
    }

    elementCount += 1;
    if (elementCount > MAX_ELEMENTS) throw new XmlError('XML 元素过多');

    const element = createElement(tagName, parseAttrs(attrsText));
    stack[stack.length - 1].children.push(element);

    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw new XmlError('XML 嵌套过深');
      stack.push(element);
    }
  }

  const tail = raw.slice(lastIndex);
  if (tail) appendText(stack[stack.length - 1], tail, false);

  if (stack.length !== 1) {
    throw new XmlError('XML 标签未闭合：' + stack[stack.length - 1].name);
  }
  if (!documentRoot.children.length) throw new XmlError('XML 没有根元素');

  const preferred = documentRoot.children.find((element) =>
    ['rss', 'root', 'xml', 'response'].includes(localName(element.name))
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
    if (element.attrs[key] !== undefined && element.attrs[key] !== null) {
      return String(element.attrs[key]);
    }
  }
  return '';
}

function textNamed(element, names) {
  const child = childNamed(element, names);
  return child ? String(child.text || '').trim() : '';
}

/* 先读属性，再读同名子元素；两者都有时属性优先。 */
function valueNamed(element, names) {
  const fromAttr = attrNamed(element, names);
  if (fromAttr) return fromAttr;
  return textNamed(element, names);
}

function intValue(value, fallback) {
  const number = Number.parseInt(String(value === undefined || value === null ? '' : value), 10);
  return Number.isFinite(number) ? number : fallback;
}

function extractPlay(element) {
  const groups = [];
  const sources = childrenNamed(element, ['dl', 'play', 'plays', 'playlist']);
  const entries = [];

  sources.forEach((container) => {
    entries.push(...childrenNamed(container, ['dd', 'url', 'episode']));
  });
  if (!entries.length) entries.push(...childrenNamed(element, ['dd']));

  entries.forEach((entry, index) => {
    const from = attrNamed(entry, ['flag', 'from', 'name', 'line']) || '线路 ' + (index + 1);
    const text = String(entry.text || '').trim();
    if (text) groups.push({ from, text });
  });

  if (groups.length) {
    return {
      from: groups.map((group) => group.from).join('$$$'),
      url: groups.map((group) => group.text).join('$$$')
    };
  }

  return {
    from: valueNamed(element, ['vod_play_from', 'play_from', 'from']),
    url: valueNamed(element, ['vod_play_url', 'play_url', 'url'])
  };
}

function videoToCms(element) {
  const vodId = valueNamed(element, ['id', 'vod_id', 'vid']);
  const name = valueNamed(element, ['name', 'vod_name', 'title']);
  if (!vodId || !name) return null;

  const typeName = valueNamed(element, ['type', 'type_name', 'class', 'vod_class']);
  const play = extractPlay(element);

  return {
    vod_id: vodId,
    vod_name: name,
    vod_pic: valueNamed(element, ['pic', 'vod_pic', 'poster', 'img']),
    vod_year: valueNamed(element, ['year', 'vod_year']),
    type_id: valueNamed(element, ['tid', 'type_id', 'typeid']),
    type_name: typeName,
    vod_class: typeName,
    vod_area: valueNamed(element, ['area', 'vod_area']),
    vod_lang: valueNamed(element, ['lang', 'vod_lang', 'language']),
    vod_remarks: valueNamed(element, ['note', 'remarks', 'vod_remarks']),
    vod_actor: valueNamed(element, ['actor', 'vod_actor', 'stars']),
    vod_director: valueNamed(element, ['director', 'vod_director']),
    vod_content: valueNamed(element, ['des', 'content', 'vod_content', 'blurb', 'vod_blurb', 'intro', 'description']),
    vod_play_from: play.from,
    vod_play_url: play.url
  };
}

/*
 * 把 XML 树转换成 JSON 接口等价对象：
 * { class: [...], list: [...]|null, page, pagecount, total }
 */
function xmlToCms(root) {
  if (!root) throw new XmlError('XML 没有根元素');

  const classContainer = childNamed(root, ['class', 'classes', 'types']);
  const tyElements = classContainer
    ? childrenNamed(classContainer, ['ty', 'type', 'class', 'item'])
    : childrenNamed(root, ['ty', 'type']);
  const classList = [];

  tyElements.forEach((element) => {
    const id = valueNamed(element, ['id', 'type_id', 'tid']);
    const name = (String(element.text || '').trim() || textNamed(element, ['name', 'type_name'])).trim();
    if (!id || !name) return;
    const parent = valueNamed(element, ['pid', 'parent', 'type_pid']);
    classList.push({
      type_id: id,
      type_name: name,
      type_pid: parent || '0'
    });
  });

  const listElement = childNamed(root, ['list', 'videolist', 'videos']);
  let list = null;
  let page = 1;
  let pagecount = 0;
  let total = 0;

  if (listElement) {
    page = intValue(valueNamed(listElement, ['page']), 1);
    pagecount = intValue(valueNamed(listElement, ['pagecount', 'page_count', 'pages']), 0);
    total = intValue(valueNamed(listElement, ['recordcount', 'total', 'count']), 0);

    const videoElements = childrenNamed(listElement, ['video', 'vod', 'item', 'movie']);
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
  const text = String(source || '').replace(/^﻿/, '').trimStart();
  return text.startsWith('<');
}

module.exports = {
  XmlError,
  parseXml,
  xmlToCms,
  parseCmsXml,
  looksLikeXml
};

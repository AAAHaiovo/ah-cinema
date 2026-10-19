'use strict';

/*
 * 源站分类过滤兜底。
 *
 * Apple CMS 的 t 参数并非所有源都实现：有的源会忽略 t，直接返回全部影片。
 * 此时用列表项自带的 type_id 再过滤一次，避免「点动漫却出现电影」。
 * 没有 type_id 的源无法校验，保持原样；如果过滤后一条不剩，说明源站的
 * type_id 语义可能不同（例如填的是父分类），也退回原结果，避免整类空白。
 */
function filterByRequestedTypes(items, typeIds) {
  const list = Array.isArray(items) ? items : [];
  const allowed = new Set((Array.isArray(typeIds) ? typeIds : []).map(String));
  if (!allowed.size) return list;

  const matched = list.filter((item) => !item.typeId || allowed.has(String(item.typeId)));
  return matched.length ? matched : list;
}

module.exports = { filterByRequestedTypes };

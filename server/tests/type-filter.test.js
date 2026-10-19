'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filterByRequestedTypes } = require('../lib/type-filter');

const items = [
  { vodId: '1', typeId: '20' },
  { vodId: '2', typeId: '10' },
  { vodId: '3', typeId: '30' },
  { vodId: '4', typeId: '' }
];

test('分类过滤：没有请求 typeIds 时原样返回', () => {
  assert.equal(filterByRequestedTypes(items, []).length, 4);
  assert.equal(filterByRequestedTypes(items, null).length, 4);
});

test('分类过滤：丢弃不在请求集合里的 type_id', () => {
  const result = filterByRequestedTypes(items, ['20', '30']);
  assert.deepEqual(result.map((item) => item.vodId), ['1', '3', '4']);
});

test('分类过滤：没有 type_id 的条目保留', () => {
  const result = filterByRequestedTypes([{ vodId: 'x' }], ['20']);
  assert.equal(result.length, 1);
});

test('分类过滤：全部不匹配时退回原结果，避免整类空白', () => {
  const typed = [
    { vodId: '1', typeId: '20' },
    { vodId: '2', typeId: '30' }
  ];
  const result = filterByRequestedTypes(typed, ['999']);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.vodId), ['1', '2']);
});

test('分类过滤：数字型 type_id 也能匹配', () => {
  const result = filterByRequestedTypes([{ vodId: '1', typeId: 20 }], ['20']);
  assert.equal(result.length, 1);
});

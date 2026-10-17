'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubscription } = require('../lib/source-list');

test('订阅：LibreTV 裸数组', () => {
  const result = parseSubscription([
    { name: '源A', url: 'https://a.example/api.php/provide/vod/' },
    { name: '源B', url: 'https://b.example/api/', detail: '备用' }
  ]);

  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].url, 'https://a.example/api.php/provide/vod');
  assert.equal(result.sources[1].detail, '备用');
  assert.equal(result.skipped, 0);
});

test('订阅：{name, sources} 与去重', () => {
  const result = parseSubscription({
    name: '我的订阅',
    sources: [
      { name: 'A', url: 'https://a.example/api' },
      { name: 'A2', url: 'https://a.example/api/' },
      { name: 'B', url: 'ftp://b.example/api' },
      { name: 'C', url: 'https://c.example/api' }
    ]
  });

  assert.equal(result.name, '我的订阅');
  assert.equal(result.sources.length, 2);
  assert.equal(result.skipped, 2);
  assert.match(result.warnings[0], /跳过 2 条/);
});

test('订阅：TVBox 只接受 JSON CMS 类型', () => {
  const result = parseSubscription({
    sites: [
      { key: 'cms1', name: 'CMS 一', type: 1, api: 'https://a.example/api' },
      { key: 'spider', name: 'Spider', type: 3, api: 'https://b.example/api', ext: 'https://b.example/spider.jar' },
      { key: 'cms2', name: 'CMS 二', type: '1', api: 'https://c.example/api' },
      { key: 'bad', name: '无地址' },
      { key: 'adult', name: '成人', type: 1, api: 'https://d.example/api', isAdult: true }
    ]
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].name, 'CMS 一');
  assert.equal(result.sources[1].url, 'https://c.example/api');
  assert.equal(result.skipped, 3);
});

test('订阅：上限 50 条并返回截断数', () => {
  const entries = Array.from({ length: 55 }, (unused, index) => ({
    name: '源' + index,
    url: 'https://s' + index + '.example/api'
  }));

  const result = parseSubscription(entries);
  assert.equal(result.sources.length, 50);
  assert.equal(result.truncated, 5);
  assert.match(result.warnings.join(' '), /截断 5 条/);
});

test('订阅：不支持的格式报 400', () => {
  assert.throws(
    () => parseSubscription({ liveSources: [] }),
    (error) => error.code === 'SUBSCRIPTION_FORMAT' && error.status === 400
  );
  assert.throws(() => parseSubscription('not json'));
});

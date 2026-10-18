'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cms = require('../lib/cms');
const { stripHtml } = require('../lib/text');

const proxyUrl = (url) => '/api/proxy?u=' + encodeURIComponent(url) + '&sig=test';

test('browseUrl：不带关键词并保留已有查询参数', () => {
  const url = new URL(cms.browseUrl('https://api.example/api.php/provide/vod?token=abc', 3));
  assert.equal(url.searchParams.get('ac'), 'videolist');
  assert.equal(url.searchParams.get('pg'), '3');
  assert.equal(url.searchParams.get('wd'), null);
  assert.equal(url.searchParams.get('token'), 'abc');
});

test('parseSearchResponse：正常列表与字段缺失', () => {
  const result = cms.parseSearchResponse({
    code: 1,
    page: 1,
    pagecount: 2,
    total: 3,
    list: [
      { vod_id: 10, vod_name: 'Big Buck Bunny', vod_year: '2008', type_name: '动画', vod_pic: 'https://cdn.example/p.jpg' },
      { vod_id: null, vod_name: '' },
      { vod_id: 11, vod_name: 12345 }
    ]
  });

  assert.equal(result.page, 1);
  assert.equal(result.pagecount, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].vodId, '10');
  assert.equal(result.items[0].year, 2008);
  assert.equal(result.items[1].name, '12345');
});

test('parseSearchResponse：list 为 null / 缺失时不抛错', () => {
  const nullList = cms.parseSearchResponse({ code: 0, list: null });
  assert.deepEqual(nullList.items, []);
  assert.equal(nullList.listIsArray, false);

  const missing = cms.parseSearchResponse({ code: 0 });
  assert.deepEqual(missing.items, []);
  assert.equal(missing.listIsArray, false);

  const empty = cms.parseSearchResponse({ list: [] });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.listIsArray, true);
});

test('parseSearchResponse：丢弃明显的成人分类', () => {
  const result = cms.parseSearchResponse({
    list: [
      { vod_id: 1, vod_name: '正常影片', type_name: '动作片' },
      { vod_id: 2, vod_name: '另一部', type_name: '伦理片' }
    ]
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].vodId, '1');
});

test('parseSearchResponse：非对象直接报错', () => {
  assert.throws(() => cms.parseSearchResponse(null), /Apple CMS/);
  assert.throws(() => cms.parseSearchResponse([1, 2]), /Apple CMS/);
});

test('parsePlayLines：多线路多集与非法协议', () => {
  const lines = cms.parsePlayLines(
    'm3u8$$$mp4',
    '第1集$https://a.example/1.m3u8#第2集$https://a.example/2.m3u8$$$第1集$http://b.example/1.mp4#第2集$magnet:?xt=1'
  );

  assert.equal(lines.length, 2);
  assert.equal(lines[0].episodes.length, 2);
  assert.equal(lines[1].episodes.length, 1);
  assert.equal(lines[1].episodes[0].url, 'http://b.example/1.mp4');
});

test('buildDetailItem：电影多线路进入 item.sources', () => {
  const item = cms.buildDetailItem(
    {
      list: [
        {
          vod_id: 77,
          vod_name: 'Big Buck Bunny',
          vod_year: '2008',
          vod_pic: 'https://cdn.example/p.jpg',
          type_name: '动画',
          vod_area: '美国',
          vod_content: '<p>Hello &amp; world</p>',
          vod_play_from: 'm3u8$$$mp4',
          vod_play_url: 'https://a.example/movie.m3u8$$$http://b.example/movie.mp4'
        }
      ]
    },
    { source: { id: 's_abc', name: '测试源', url: 'https://api.example' }, vodId: '77', proxyUrl }
  );

  assert.equal(item.id, 'remote_s_abc_77');
  assert.equal(item.kind, 'movie');
  assert.equal(item.synopsis, 'Hello & world');
  assert.equal(item.sources.length, 2);
  assert.ok(item.sources[0].isHls);
  assert.ok(item.sources[0].src.startsWith('/api/proxy?'));
  assert.ok(item.sources[1].src.startsWith('/api/proxy?'));
  assert.equal(item.episodes.length, 0);
  assert.equal(item.remote, true);
});

test('buildDetailItem：多集多线路按集对齐', () => {
  const item = cms.buildDetailItem(
    {
      list: [
        {
          vod_id: '88',
          vod_name: '示例剧集',
          vod_play_from: 'm3u8$$$直连',
          vod_play_url:
            '第1集$https://a.example/1.m3u8#第2集$https://a.example/2.m3u8$$$第1集$https://b.example/1.mp4#第2集$https://b.example/2.mp4'
        }
      ]
    },
    { source: { id: 's_x', name: '源', url: 'https://api.example' }, vodId: '88', proxyUrl }
  );

  assert.equal(item.kind, 'series');
  assert.equal(item.episodes.length, 2);
  assert.equal(item.episodes[0].sources.length, 2);
  assert.ok(item.episodes[0].sources[0].src.startsWith('/api/proxy?'));
  assert.equal(item.episodes[0].sources[1].src, 'https://b.example/1.mp4');
  assert.equal(item.episodes[1].id, 'ep2');
  assert.equal(item.episodes[1].episode, 2);
});

test('buildDetailItem：没有可播放地址时报错', () => {
  assert.throws(
    () =>
      cms.buildDetailItem(
        { list: [{ vod_id: 1, vod_name: '空', vod_play_from: 'x', vod_play_url: 'magnet:?xt=1' }] },
        { source: { id: 's_1', name: '源', url: 'https://api.example' }, vodId: '1', proxyUrl }
      ),
    /可播放/
  );
});

test('stripHtml：去标签、解实体、折叠空白', () => {
  assert.equal(stripHtml('<p>你好 &amp; 世界</p><script>alert(1)</script>'), '你好 & 世界');
  assert.equal(stripHtml('&#20320;&#22909;'), '你好');
  assert.equal(stripHtml('a<br>b'), 'a\nb');
});

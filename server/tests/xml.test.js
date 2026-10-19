'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cms = require('../lib/cms');

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<rss version="5.1">
  <class>
    <ty id="1" pid="0">电影</ty>
    <ty id="10" pid="1">动作</ty>
  </class>
  <list page="2" pagecount="7" pagesize="20" recordcount="123">
    <video>
      <id>77</id>
      <tid>10</tid>
      <name><![CDATA[Big Buck Bunny & 朋友]]></name>
      <type>动作片</type>
      <pic>https://cdn.example/p.jpg</pic>
      <year>2008</year>
      <area>美国</area>
      <lang>英语</lang>
      <note><![CDATA[HD]]></note>
      <des><![CDATA[<p>Hello &amp; world]]></des>
      <dl>
        <dd flag="m3u8"><![CDATA[正片$https://a.example/movie.m3u8]]></dd>
        <dd flag="mp4"><![CDATA[正片$https://b.example/movie.mp4]]></dd>
      </dl>
    </video>
  </list>
</rss>`;

test('detectCmsFormat：JSON / XML / 无法识别', () => {
  assert.equal(cms.detectCmsFormat('{"code":1}'), 'json');
  assert.equal(cms.detectCmsFormat('﻿ [1,2]'), 'json');
  assert.equal(cms.detectCmsFormat('  <?xml version="1.0"?><rss></rss>'), 'xml');
  assert.equal(cms.detectCmsFormat('<rss><list></list></rss>'), 'xml');
  assert.equal(cms.detectCmsFormat('<html></html>'), 'xml');
  assert.equal(cms.detectCmsFormat('not json'), '');
  assert.equal(cms.detectCmsFormat(''), '');
});

test('parseCmsPayload：JSON 原样返回，XML 转成 CMS 形状', () => {
  assert.deepEqual(cms.parseCmsPayload('{"code":1,"list":[]}'), { code: 1, list: [] });

  const parsed = cms.parseCmsPayload(SAMPLE);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pagecount, 7);
  assert.equal(parsed.total, 123);
  assert.equal(parsed.class.length, 2);
  assert.deepEqual(parsed.class[0], { type_id: '1', type_name: '电影', type_pid: '0' });
  assert.equal(parsed.list.length, 1);

  const item = parsed.list[0];
  assert.equal(item.vod_id, '77');
  assert.equal(item.vod_name, 'Big Buck Bunny & 朋友');
  assert.equal(item.type_id, '10');
  assert.equal(item.type_name, '动作片');
  assert.equal(item.vod_year, '2008');
  assert.equal(item.vod_remarks, 'HD');
  assert.equal(item.vod_content, '<p>Hello &amp; world');
});

test('XML：多个 dd 线路合并成 $$$ 形式', () => {
  const parsed = cms.parseCmsPayload(SAMPLE);
  assert.equal(parsed.list[0].vod_play_from, 'm3u8$$$mp4');
  assert.equal(
    parsed.list[0].vod_play_url,
    '正片$https://a.example/movie.m3u8$$$正片$https://b.example/movie.mp4'
  );
});

test('XML：经过 parseClassList / parseSearchResponse 后与 JSON 行为一致', () => {
  const parsed = cms.parseCmsPayload(SAMPLE);
  assert.deepEqual(cms.parseClassList(parsed), [
    { id: '1', name: '电影', parent: 0 },
    { id: '10', name: '动作', parent: 1 }
  ]);

  const result = cms.parseSearchResponse(parsed);
  assert.equal(result.page, 2);
  assert.equal(result.pagecount, 7);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].vodId, '77');
  assert.equal(result.items[0].name, 'Big Buck Bunny & 朋友');
});

test('XML：CDATA 里的 ]]> 与注释不影响解析', () => {
  const xml = '<rss><list page="1" pagecount="1" recordcount="1"><video>' +
    '<id>1</id><name>测试</name>' +
    '<des><![CDATA[a]]]]><![CDATA[>b]]></des>' +
    '<!-- <!DOCTYPE planted> -->' +
    '<dl><dd><![CDATA[正片$https://a.example/1.mp4]]></dd></dl>' +
    '</video></list></rss>';
  const parsed = cms.parseCmsPayload(xml);
  assert.equal(parsed.list[0].vod_content, 'a]]>b');
  assert.equal(parsed.list[0].vod_play_url, '正片$https://a.example/1.mp4');
});

test('XML：没有 <list> 时保留 list:null，不会被当成空数组', () => {
  const parsed = cms.parseCmsPayload('<rss><class><ty id="1" pid="0">电影</ty></class></rss>');
  assert.equal(parsed.list, null);
  assert.equal(cms.parseSearchResponse(parsed).listIsArray, false);
});

test('XML：旧式直接从属性读字段也能解析', () => {
  const parsed = cms.parseCmsPayload(
    '<rss><list page="1" pagecount="1" recordcount="1">' +
    '<video id="9" name="属性影片" tid="3" type="动画" pic="https://x/p.jpg">' +
    '<dd flag="直连"><![CDATA[正片$https://x/9.mp4]]></dd>' +
    '</video></list></rss>'
  );
  assert.equal(parsed.list[0].vod_id, '9');
  assert.equal(parsed.list[0].vod_name, '属性影片');
  assert.equal(parsed.list[0].type_name, '动画');
});

test('XML：格式错误、DOCTYPE、ENTITY 与过深嵌套都被拒绝', () => {
  assert.throws(() => cms.parseCmsPayload('<rss><list></rss>'), /XML/);
  assert.throws(() => cms.parseCmsPayload('<!DOCTYPE rss><rss></rss>'), /DOCTYPE/);
  assert.throws(
    () => cms.parseCmsPayload('<!DOCTYPE rss [<!ENTITY x "boom">]><rss>&x;</rss>'),
    /DOCTYPE/
  );

  const deep = '<a>'.repeat(70) + '</a>'.repeat(70);
  assert.throws(() => cms.parseCmsPayload(deep), /嵌套过深/);
});

test('parseCmsPayload：空内容与无法识别的内容报错', () => {
  assert.throws(() => cms.parseCmsPayload(''), /空内容/);
  assert.throws(() => cms.parseCmsPayload('   '), /空内容/);
  assert.throws(() => cms.parseCmsPayload('plain text'), /无法识别/);
  assert.throws(() => cms.parseCmsPayload('{bad json'), /不是有效 JSON/);
});

test('browseUrl / listUrl：保留 /at/xml/ 目录与末尾斜杠', () => {
  const base = 'https://api.example/api.php/provide/vod/at/xml/';
  const browse = new URL(cms.browseUrl(base, 3, '10'));
  assert.equal(browse.pathname, '/api.php/provide/vod/at/xml/');
  assert.equal(browse.searchParams.get('ac'), 'videolist');
  assert.equal(browse.searchParams.get('pg'), '3');
  assert.equal(browse.searchParams.get('t'), '10');

  const list = new URL(cms.listUrl(base));
  assert.equal(list.pathname, '/api.php/provide/vod/at/xml/');
  assert.equal(list.searchParams.get('ac'), 'list');
});

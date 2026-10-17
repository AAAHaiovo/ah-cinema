'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rewritePlaylist } = require('../lib/m3u8');

const makeProxyUrl = (url) => '/api/proxy?u=' + encodeURIComponent(url) + '&sig=x';
const base = 'https://cdn.example/hls/index.m3u8';

test('m3u8：相对分片解析为绝对地址，https 直连', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXTINF:6,',
    'seg-1.ts',
    '#EXTINF:6,',
    'https://cdn.example/hls/seg-2.ts'
  ].join('\n');

  const output = rewritePlaylist(input, base, { makeProxyUrl });
  assert.match(output, /https:\/\/cdn\.example\/hls\/seg-1\.ts/);
  assert.match(output, /https:\/\/cdn\.example\/hls\/seg-2\.ts/);
  assert.ok(!output.includes('/api/proxy'));
});

test('m3u8：http 分片改写为签名代理', () => {
  const input = '#EXTM3U\nhttp://cdn.example/a.ts\n#EXTINF:6,\nhttp://cdn.example/b.ts';
  const output = rewritePlaylist(input, 'http://cdn.example/hls/index.m3u8', { makeProxyUrl });
  const lines = output.split('\n');
  assert.ok(lines[1].startsWith('/api/proxy?'));
  assert.ok(lines[3].startsWith('/api/proxy?'));
  assert.match(decodeURIComponent(lines[1]), /http:\/\/cdn\.example\/a\.ts/);
});

test('m3u8：EXT-X-KEY / MAP / MEDIA 的 URI 都要重写', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="../audio/a.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    '../low/index.m3u8'
  ].join('\n');

  const output = rewritePlaylist(input, base, { makeProxyUrl });
  assert.match(output, /URI="https:\/\/cdn\.example\/hls\/key\.bin"/);
  assert.match(output, /URI="https:\/\/cdn\.example\/hls\/init\.mp4"/);
  assert.match(output, /URI="https:\/\/cdn\.example\/audio\/a\.m3u8"/);
  assert.match(output, /https:\/\/cdn\.example\/low\/index\.m3u8/);
});

test('m3u8：seg=proxy 时 https 分片也走代理', () => {
  const input = 'https://cdn.example/a.ts';
  const output = rewritePlaylist(input, base, { makeProxyUrl, proxySegments: true });
  assert.ok(output.startsWith('/api/proxy?'));
});

test('m3u8：已代理的 URI 不二次包装，data: 保持不变', () => {
  const input = [
    '/api/proxy?u=https%3A%2F%2Fcdn.example%2Fa.ts&sig=abc',
    '#EXT-X-MAP:URI="data:application/octet-stream;base64,AAAA"'
  ].join('\n');
  const output = rewritePlaylist(input, base, { makeProxyUrl, proxySegments: true });
  assert.equal(output, input);
});

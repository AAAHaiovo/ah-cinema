'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateAddress,
  isLoopbackAddress,
  validateUrlSync
} = require('../lib/ssrf');

test('SSRF：私网与保留 IPv4 全部识别', () => {
  const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.10',
    '203.0.113.10',
    '224.0.0.1',
    '255.255.255.255'
  ];
  blocked.forEach((ip) => {
    assert.equal(isPrivateAddress(ip), true, ip + ' 应该被拒绝');
  });

  ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1'].forEach((ip) => {
    assert.equal(isPrivateAddress(ip), false, ip + ' 应该被放行');
  });
});

test('SSRF：IPv6 回环、ULA、链路本地与 IPv4-mapped', () => {
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isPrivateAddress('::'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('fc00::1'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateAddress('2001:db8::1'), true);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('SSRF：协议、账号密码、主机名黑名单', () => {
  assert.throws(() => validateUrlSync('file:///etc/passwd'), /http/);
  assert.throws(() => validateUrlSync('ftp://example.com/a'), /http/);
  assert.throws(() => validateUrlSync('http://user:pass@example.com/'), /账号密码/);
  assert.throws(() => validateUrlSync('http://localhost:8080/'), /不被允许/);
  assert.throws(() => validateUrlSync('http://metadata.google.internal/'), /不被允许/);
  assert.throws(() => validateUrlSync('http://127.0.0.1/'), /内网/);
  assert.throws(() => validateUrlSync('http://[::1]/'), /内网/);
  assert.throws(() => validateUrlSync(''), /不能为空/);
});

test('SSRF：开发开关只放行 loopback', () => {
  assert.doesNotThrow(() => validateUrlSync('http://127.0.0.1:4180/api', { allowPrivate: true }));
  assert.doesNotThrow(() => validateUrlSync('http://[::1]:4180/api', { allowPrivate: true }));
  assert.throws(() => validateUrlSync('http://10.0.0.1/api', { allowPrivate: true }), /内网/);
  assert.throws(() => validateUrlSync('http://169.254.169.254/latest', { allowPrivate: true }), /内网/);
});

test('SSRF：公网字面量放行', () => {
  assert.doesNotThrow(() => validateUrlSync('https://8.8.8.8/api'));
});

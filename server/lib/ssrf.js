'use strict';

/*
 * SSRF 防护：协议白名单、主机名黑名单、DNS 全量解析、私网/保留地址拒绝。
 * 解析结果交给 safe-fetch 固定到连接，避免二次解析造成 DNS rebinding。
 */

const dns = require('dns').promises;
const net = require('net');

class SsrfError extends Error {
  constructor(code, message) {
    super(message || '请求地址不被允许');
    this.name = 'SsrfError';
    this.code = code || 'URL_BLOCKED';
    this.status = 403;
  }
}

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data'
];

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number > 255) return null;
    value = value * 256 + number;
  }
  return value >>> 0;
}

function intToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.');
}

function inIpv4Range(value, base, bits) {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
}

function isPrivateIPv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => inIpv4Range(value, base, bits));
}

function isLoopbackIPv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return inIpv4Range(value, '127.0.0.0', 8);
}

function parseIPv6(input) {
  let text = String(input || '').toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text || !/^[0-9a-f:.]+$/.test(text)) return null;

  if (text.includes('.')) {
    const index = text.lastIndexOf(':');
    if (index < 0) return null;
    const v4 = ipv4ToInt(text.slice(index + 1));
    if (v4 === null) return null;
    text =
      text.slice(0, index + 1) +
      ((v4 >>> 16) & 0xffff).toString(16) +
      ':' +
      (v4 & 0xffff).toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (head.length + tail.length > 8) {
    return null;
  }

  const missing = 8 - head.length - tail.length;
  const groups = halves.length === 2 ? head.concat(new Array(missing).fill('0'), tail) : head;
  if (groups.length !== 8) return null;

  const parsed = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    parsed.push(Number.parseInt(group, 16));
  }
  return parsed;
}

function embeddedIPv4(groups) {
  return intToIpv4(((groups[6] << 16) | groups[7]) >>> 0);
}

function isPrivateIPv6(ip) {
  const groups = parseIPv6(ip);
  if (!groups) return false;

  const allZero = groups.every((group) => group === 0);
  if (allZero) return true;

  // ::1 loopback
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;

  // fc00::/7 unique local
  if ((groups[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 link local
  if ((groups[0] & 0xffc0) === 0xfe80) return true;

  // ff00::/8 multicast
  if ((groups[0] & 0xff00) === 0xff00) return true;

  // 2001:db8::/32 documentation
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

  // IPv4-mapped ::ffff:a.b.c.d 与 NAT64 64:ff9b::/96
  const firstFiveZero = groups.slice(0, 5).every((group) => group === 0);
  if (firstFiveZero && groups[5] === 0xffff) {
    return isPrivateIPv4(embeddedIPv4(groups));
  }
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return isPrivateIPv4(embeddedIPv4(groups));
  }

  return false;
}

function isLoopbackIPv6(ip) {
  const groups = parseIPv6(ip);
  if (!groups) return false;
  return groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
}

function stripBrackets(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
}

function isBlockedHostname(hostname) {
  const host = stripBrackets(hostname).toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.includes(host)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isPrivateAddress(ip) {
  const value = String(ip || '').replace(/^\[/, '').replace(/\]$/, '');
  const family = net.isIP(value);
  if (family === 4) return isPrivateIPv4(value);
  if (family === 6) return isPrivateIPv6(value);
  return false;
}

function isLoopbackAddress(ip) {
  const value = String(ip || '').replace(/^\[/, '').replace(/\]$/, '');
  const family = net.isIP(value);
  if (family === 4) return isLoopbackIPv4(value);
  if (family === 6) return isLoopbackIPv6(value);
  return false;
}

/*
 * 同步部分：只做 URL / 协议 / 主机名 / 字面量 IP 校验。
 * 不解析 DNS，供 handler 在发请求前快速失败。
 */
function parseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SsrfError('URL_INVALID', '地址不能为空');
  }
  if (raw.length > 4096) {
    throw new SsrfError('URL_INVALID', '地址过长');
  }

  let url;
  try {
    url = new URL(raw.trim());
  } catch (error) {
    throw new SsrfError('URL_INVALID', '地址格式不正确');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('URL_PROTOCOL_BLOCKED', '只支持 http 或 https 地址');
  }
  if (url.username || url.password) {
    throw new SsrfError('URL_CREDENTIALS_BLOCKED', '地址不能包含账号密码');
  }

  const hostname = stripBrackets(url.hostname).toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new SsrfError('URL_HOST_BLOCKED', '这个地址不被允许');
  }

  return url;
}

/*
 * allowPrivate 只用于本地开发：只额外放行 loopback，其他私网/保留地址始终拒绝。
 */
function addressAllowed(address, allowPrivate) {
  if (!isPrivateAddress(address)) return true;
  return Boolean(allowPrivate) && isLoopbackAddress(address);
}

function validateUrlSync(raw, { allowPrivate = false } = {}) {
  const url = parseUrl(raw);
  const hostname = stripBrackets(url.hostname);
  if (net.isIP(hostname) && !addressAllowed(hostname, allowPrivate)) {
    throw new SsrfError('URL_PRIVATE_BLOCKED', '不能访问内网地址');
  }
  return url;
}

/*
 * 解析所有地址并逐一校验。返回固定连接的地址列表。
 */
async function resolveTarget(raw, { allowPrivate = false } = {}) {
  const url = validateUrlSync(raw, { allowPrivate });
  const hostname = stripBrackets(url.hostname);

  if (net.isIP(hostname)) {
    return {
      url,
      addresses: [{ address: hostname, family: net.isIP(hostname) }]
    };
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new SsrfError('DNS_FAILED', '域名解析失败');
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new SsrfError('DNS_FAILED', '域名解析失败');
  }

  const addresses = records.map((record) => ({
    address: record.address,
    family: record.family || net.isIP(record.address)
  }));

  const blocked = addresses.find((record) => !addressAllowed(record.address, allowPrivate));
  if (blocked) {
    throw new SsrfError('URL_PRIVATE_BLOCKED', '不能访问内网地址');
  }

  return { url, addresses };
}

module.exports = {
  SsrfError,
  ipv4ToInt,
  isPrivateIPv4,
  isLoopbackIPv4,
  parseIPv6,
  isPrivateIPv6,
  isLoopbackIPv6,
  isPrivateAddress,
  isLoopbackAddress,
  isBlockedHostname,
  parseUrl,
  validateUrlSync,
  resolveTarget
};

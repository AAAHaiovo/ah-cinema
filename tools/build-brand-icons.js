#!/usr/bin/env node
/*
 * 按《AH 母品牌图标规范 v1.0》生成 PWA 图标。
 *
 * 源文件：docs/assets/ah-mark.png（规范 v1.0 的 AH 标记，628×659，白色 + 透明底）
 * 画布：1024×1024；圆角：22.5% 圆角矩形，角部用指数 5.0 的超椭圆曲线
 * 标记：放在画布 (191, 166)，即规范的光学居中位置
 *
 * 生成：
 *   docs/icons/icon-512.png          标准版（圆角外套透明）
 *   docs/icons/icon-192.png          标准版
 *   docs/icons/icon-apple-touch.png  180 标准版（文件名沿用 apple-touch-icon.png）
 *   docs/icons/icon-maskable-512.png 满幅红底，标记缩到安全区
 *   docs/icons/icon-48.png           填实版（<80px，字怀填实），作 favicon
 *
 * 用法：node tools/build-brand-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const MARK_PATH = path.join(ROOT, 'docs/assets/ah-mark.png');
const ICON_DIR = path.join(ROOT, 'docs/icons');

const RED = [201, 47, 54];      // 品牌红 #C92F36（影视线保留红底）
const WHITE = [255, 255, 255];
const CANVAS = 1024;
const CORNER_R = 0.225 * CANVAS; // 230.4
const CORNER_N = 5.0;
const MARK_X = 191;              // 规范图 1：图形外接框在画布中的位置
const MARK_Y = 166;
const MASKABLE_SCALE = 0.8;      // 内容缩到中心 80%，避开 Android 异形遮罩

/* ---------- PNG ---------- */

function decodePNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w, h, ct, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.slice(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的 PNG 颜色类型：' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[off++];
    const line = raw.slice(off, off + stride);
    off += stride;
    const row = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b0 = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b0;
      else if (f === 3) v += (a + b0) >> 1;
      else if (f === 4) {
        const pp = a + b0 - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b0), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b0 : c;
      }
      row[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
}

function encodePNG(file, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ---------- 几何 ---------- */

/* 圆角矩形 + 角部超椭圆：四角各取一个 22.5% 边长的方框，曲线满足
   (1 - u/R)^n + (1 - v/R)^n = 1，u/v 为到最近两条边的距离。 */
function insideIcon(sx, sy) {
  const u = Math.min(sx, CANVAS - sx);
  const v = Math.min(sy, CANVAS - sy);
  if (u >= CORNER_R || v >= CORNER_R) return true;
  return Math.pow(1 - u / CORNER_R, CORNER_N) + Math.pow(1 - v / CORNER_R, CORNER_N) <= 1;
}

function cornerCoverage(x, y) {
  if (x >= CORNER_R && x <= CANVAS - CORNER_R && y >= CORNER_R && y <= CANVAS - CORNER_R) return 1;
  const S = 8;
  let hit = 0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      if (insideIcon(x + (i + 0.5) / S, y + (j + 0.5) / S)) hit++;
    }
  }
  return hit / (S * S);
}

/* ---------- 构建 ---------- */

function markAlpha(mark, x, y) {
  const mx = x - MARK_X;
  const my = y - MARK_Y;
  if (mx < 0 || my < 0 || mx >= mark.w || my >= mark.h) return 0;
  return mark.data[(my * mark.w + mx) * 4 + 3] / 255;
}

function buildMaster(mark) {
  const out = Buffer.alloc(CANVAS * CANVAS * 4);
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const t = markAlpha(mark, x, y);
      const a = cornerCoverage(x, y);
      const o = (y * CANVAS + x) * 4;
      out[o] = Math.round(RED[0] + (WHITE[0] - RED[0]) * t);
      out[o + 1] = Math.round(RED[1] + (WHITE[1] - RED[1]) * t);
      out[o + 2] = Math.round(RED[2] + (WHITE[2] - RED[2]) * t);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/* 面积平均缩放，按预乘 alpha 计算，避免半透明边缘发黑。 */
function areaResize(src, srcSize, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = srcSize / size;
  for (let oy = 0; oy < size; oy++) {
    const y0 = oy * scale, y1 = y0 + scale;
    const sy0 = Math.floor(y0), sy1 = Math.ceil(y1);
    for (let ox = 0; ox < size; ox++) {
      const x0 = ox * scale, x1 = x0 + scale;
      const sx0 = Math.floor(x0), sx1 = Math.ceil(x1);
      let wsum = 0, asum = 0, rsum = 0, gsum = 0, bsum = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        const cy = Math.min(srcSize - 1, sy);
        for (let sx = sx0; sx < sx1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const cx = Math.min(srcSize - 1, sx);
          const i = (cy * srcSize + cx) * 4;
          const w = wx * wy * (src[i + 3] / 255);
          if (w > 0) {
            asum += w;
            rsum += src[i] * w;
            gsum += src[i + 1] * w;
            bsum += src[i + 2] * w;
          }
          wsum += wx * wy;
        }
      }
      const o = (oy * size + ox) * 4;
      if (asum > 0) {
        out[o] = Math.round(rsum / asum);
        out[o + 1] = Math.round(gsum / asum);
        out[o + 2] = Math.round(bsum / asum);
        out[o + 3] = Math.round(asum / wsum * 255);
      }
    }
  }
  return out;
}

/* 满幅红底：把 1024 母版按 80% 缩放居中，角落保持红色。 */
function buildMaskable(master) {
  const out = Buffer.alloc(CANVAS * CANVAS * 4);
  const inv = 1 / MASKABLE_SCALE;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const px = (x + 0.5 - CANVAS / 2) * inv + CANVAS / 2 - 0.5;
      const py = (y + 0.5 - CANVAS / 2) * inv + CANVAS / 2 - 0.5;
      let a = 0, r = 0, g = 0, b = 0;
      if (px >= 0 && py >= 0 && px <= CANVAS - 1 && py <= CANVAS - 1) {
        const x0 = Math.floor(px), y0 = Math.floor(py);
        const x1 = Math.min(CANVAS - 1, x0 + 1), y1 = Math.min(CANVAS - 1, y0 + 1);
        const fx = px - x0, fy = py - y0;
        const sample = (xx, yy) => {
          const i = (yy * CANVAS + xx) * 4;
          const aa = master[i + 3] / 255;
          return [aa, master[i] * aa, master[i + 1] * aa, master[i + 2] * aa];
        };
        const s00 = sample(x0, y0), s10 = sample(x1, y0);
        const s01 = sample(x0, y1), s11 = sample(x1, y1);
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy, w11 = fx * fy;
        a = s00[0] * w00 + s10[0] * w10 + s01[0] * w01 + s11[0] * w11;
        r = s00[1] * w00 + s10[1] * w10 + s01[1] * w01 + s11[1] * w11;
        g = s00[2] * w00 + s10[2] * w10 + s01[2] * w01 + s11[2] * w11;
        b = s00[3] * w00 + s10[3] * w10 + s01[3] * w01 + s11[3] * w11;
      }
      const o = (y * CANVAS + x) * 4;
      out[o] = Math.round(RED[0] * (1 - a) + r);
      out[o + 1] = Math.round(RED[1] * (1 - a) + g);
      out[o + 2] = Math.round(RED[2] * (1 - a) + b);
      out[o + 3] = 255;
    }
  }
  return out;
}

/* 80px 以下用填实版：把 A 的字怀（被标记包住的透明区域）填成白色。 */
function fillCounter(mark) {
  const { w, h, data } = mark;
  const filled = Buffer.from(data);
  const seen = new Uint8Array(w * h);
  const queue = [];
  const tryPush = (x, y) => {
    const p = y * w + x;
    if (seen[p] || data[p * 4 + 3] >= 128) return;
    seen[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) tryPush(x - 1, y);
    if (x < w - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < h - 1) tryPush(x, y + 1);
  }
  for (let p = 0; p < w * h; p++) {
    if (!seen[p] && data[p * 4 + 3] < 128) {
      filled[p * 4] = 255;
      filled[p * 4 + 1] = 255;
      filled[p * 4 + 2] = 255;
      filled[p * 4 + 3] = 255;
    }
  }
  return { w, h, ch: 4, data: filled };
}

function main() {
  const mark = decodePNG(MARK_PATH);
  const master = buildMaster(mark);

  encodePNG(path.join(ICON_DIR, 'icon-512.png'), 512, 512, areaResize(master, CANVAS, 512));
  encodePNG(path.join(ICON_DIR, 'icon-192.png'), 192, 192, areaResize(master, CANVAS, 192));
  encodePNG(path.join(ICON_DIR, 'apple-touch-icon.png'), 180, 180, areaResize(master, CANVAS, 180));

  const maskable = buildMaskable(master);
  encodePNG(path.join(ICON_DIR, 'icon-maskable-512.png'), 512, 512, areaResize(maskable, CANVAS, 512));

  const filled = buildMaster(fillCounter(mark));
  encodePNG(path.join(ICON_DIR, 'icon-48.png'), 48, 48, areaResize(filled, CANVAS, 48));

  console.log('icons written to docs/icons/');
}

main();

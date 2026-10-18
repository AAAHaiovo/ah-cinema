'use strict';

/*
 * 把 SCF 入口、server/ 与服务端依赖打成一个 index.js，
 * 再压成可直接在腾讯云 SCF 控制台上传的 ZIP。
 *
 * 产物：
 *   scf/index.js          —— 函数代码（提交到仓库）
 *   scf/ah-cinema-scf.zip —— 上传包（构建产物，已 gitignore）
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'scf');
const outfile = path.join(outDir, 'index.js');
const zipfile = path.join(outDir, 'ah-cinema-scf.zip');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (error) {
  console.error('[scf] 缺少 esbuild，请先运行 npm install');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'scf-entry.js')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  legalComments: 'eof'
});

function zipWithTar() {
  execFileSync('tar', ['-a', '-c', '-f', zipfile, 'index.js'], { cwd: outDir, stdio: 'pipe' });
}

function zipWithPowerShell() {
  const script =
    "Compress-Archive -LiteralPath '" +
    outfile.replace(/'/g, "''") +
    "' -DestinationPath '" +
    zipfile.replace(/'/g, "''") +
    "' -Force";
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'pipe'
  });
}

let zipped = false;
if (fs.existsSync(zipfile)) fs.unlinkSync(zipfile);

for (const attempt of [zipWithTar, zipWithPowerShell]) {
  try {
    attempt();
    zipped = true;
    break;
  } catch (error) {
    /* 换下一种方式。 */
  }
}

console.log('[scf] 已生成 ' + outfile + '（' + fs.statSync(outfile).size + ' 字节）');
if (zipped) {
  console.log('[scf] 已生成 ' + zipfile + '（' + fs.statSync(zipfile).size + ' 字节）');
} else {
  console.warn('[scf] 自动压缩失败，请手动把 ' + outfile + ' 压成 ZIP 后上传');
}

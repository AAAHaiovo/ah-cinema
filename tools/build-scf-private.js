'use strict';

/*
 * 生成“配置已内置”的 SCF 私有上传包，用于控制台环境变量表单保存失败时兜底。
 *
 * 输入：项目根目录的 .env.scf（已被 .gitignore 忽略）
 * 输出：scf/ah-cinema-scf-private.zip（同样 gitignore，切勿提交或外传）
 *
 * 这个包会把口令和签名密钥写进函数代码；仅在控制台环境变量无法保存时使用。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.scf');
const privateDir = path.join(root, 'scf', 'private');
const outfile = path.join(privateDir, 'index.js');
const zipfile = path.join(root, 'scf', 'ah-cinema-scf-private.zip');

function readEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const values = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index <= 0) return;
    const name = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (name) values[name] = value;
  });
  return values;
}

let esbuild;
try {
  esbuild = require('esbuild');
} catch (error) {
  console.error('[scf-private] 缺少 esbuild，请先运行 npm install');
  process.exit(1);
}

if (!fs.existsSync(envFile)) {
  console.error('[scf-private] 找不到 .env.scf');
  process.exit(1);
}

const env = readEnv(envFile);
if (!env.AH_API_TOKEN || !env.AH_SIGNING_SECRET) {
  console.error('[scf-private] .env.scf 里缺少 AH_API_TOKEN 或 AH_SIGNING_SECRET');
  process.exit(1);
}

const names = ['AH_ENV', 'AH_API_TOKEN', 'AH_SIGNING_SECRET', 'AH_PROXY_MAX_BYTES'];
const assignments = names
  .filter((name) => env[name])
  .map((name) => 'process.env.' + name + ' = ' + JSON.stringify(env[name]) + ';')
  .join('\n');

fs.mkdirSync(privateDir, { recursive: true });
if (fs.existsSync(zipfile)) fs.unlinkSync(zipfile);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'scf-entry.js')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  legalComments: 'eof',
  banner: { js: '/* Private build: config baked in. Do not commit or share. */\n' + assignments }
});

function zipWithTar() {
  execFileSync('tar', ['-a', '-c', '-f', zipfile, 'index.js'], { cwd: privateDir, stdio: 'pipe' });
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
for (const attempt of [zipWithTar, zipWithPowerShell]) {
  try {
    attempt();
    zipped = true;
    break;
  } catch (error) {
    /* 换下一种方式。 */
  }
}

console.log('[scf-private] 已生成 ' + outfile);
if (zipped) {
  console.log('[scf-private] 已生成 ' + zipfile + '（' + fs.statSync(zipfile).size + ' 字节）');
  console.log('[scf-private] 这个 ZIP 内含口令，只上传到 SCF，不要提交到 GitHub');
} else {
  console.error('[scf-private] 自动压缩失败，请手动压缩 ' + privateDir);
  process.exit(1);
}

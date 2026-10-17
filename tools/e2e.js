'use strict';

/*
 * 一键端到端验收：启动本地 API 服务器与 mock Apple CMS，
 * 依次运行 cdp-run（界面回归）和 smoke-remote（源管理 + 多源搜索）。
 *
 * 用法：node tools/e2e.js
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = Number(process.env.AH_E2E_PORT || 4174);
const CMS_PORT = Number(process.env.AH_E2E_CMS_PORT || 4181);
const BASE = 'http://127.0.0.1:' + APP_PORT + '/';
const CMS = 'http://127.0.0.1:' + CMS_PORT;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function launch(script, args, extraEnv) {
  return spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function waitHealthy(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      /* 等端口就绪。 */
    }
    await wait(250);
  }
  throw new Error('服务没有按时启动：' + url);
}

function runNode(script, extraEnv) {
  return new Promise((resolve) => {
    const child = launch(script, [], extraEnv);
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => resolve(code === null ? 1 : code));
  });
}

function stop(child) {
  if (!child || child.killed) return;
  try {
    child.kill();
  } catch (error) {
    /* 忽略。 */
  }
}

async function main() {
  const server = launch('tools/ah-server.js', [String(APP_PORT)], {
    AH_ENV: 'development',
    AH_DEV_ALLOW_PRIVATE: '1',
    AH_DEV_NO_AUTH: '1'
  });
  const mock = launch('tools/mock-cms.js', [String(CMS_PORT)], {});

  let failure = null;
  try {
    await waitHealthy(BASE + 'api/health');
    await waitHealthy(CMS + '/health');

    console.log('\n== 界面回归 ==\n');
    const cdpCode = await runNode('tools/cdp-run.js', { AH_BASE: BASE });
    if (cdpCode !== 0) throw new Error('cdp-run 失败（退出码 ' + cdpCode + '）');

    console.log('\n== 源管理 + 多源搜索 ==\n');
    const remoteCode = await runNode('tools/smoke-remote.js', {
      AH_BASE: BASE,
      AH_MOCK_CMS: CMS
    });
    if (remoteCode !== 0) throw new Error('smoke-remote 失败（退出码 ' + remoteCode + '）');
  } catch (error) {
    failure = error;
  } finally {
    stop(server);
    stop(mock);
    await wait(300);
  }

  if (failure) {
    console.error('\nE2E 失败：' + failure.message);
    process.exitCode = 1;
    return;
  }

  console.log('\nE2E 通过：界面回归 + 源管理 + 多源搜索。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

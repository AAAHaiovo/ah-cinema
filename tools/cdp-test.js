/* 用 Chrome DevTools Protocol 做启动诊断。仅开发使用。 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL_TO_TEST = process.argv[2] || 'http://127.0.0.1:4173/';
const PROFILE = path.join(process.env.TEMP || 'C:/Windows/Temp', 'ah-cdp-profile-' + process.pid);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTargets() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await response.json();
      const page = list.find((entry) => entry.type === 'page');
      if (page) return page;
    } catch (error) {
      /* Chrome 还没起来。 */
    }
    await wait(200);
  }
  throw new Error('Chrome 调试端口没有响应');
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const chromeErrors = [];
  chrome.stderr.on('data', (data) => chromeErrors.push(data.toString()));

  try {
    const target = await getTargets();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    const consoleLines = [];
    const exceptions = [];
    const failedRequests = [];
    const responses = [];

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
        return;
      }

      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => {
          if (arg.value !== undefined) return String(arg.value);
          if (arg.description) return arg.description;
          return arg.type;
        }).join(' ');
        consoleLines.push(message.params.type + ': ' + text);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        exceptions.push((details.exception && (details.exception.description || details.exception.value)) || details.text);
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry.level === 'error') consoleLines.push('log-error: ' + entry.text + ' ' + (entry.url || ''));
      } else if (message.method === 'Network.loadingFailed') {
        failedRequests.push(message.params.errorText + ' ' + (message.params.type || ''));
      } else if (message.method === 'Network.responseReceived') {
        const response = message.params.response;
        if (/\/(js|data)\//.test(response.url) || response.url.endsWith('.json') || response.url.endsWith('.webmanifest')) {
          responses.push(response.status + ' ' + response.url);
        }
      }
    };

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Page.navigate', { url: URL_TO_TEST });
    await wait(7000);

    const expression = `JSON.stringify({
      ready: document.readyState,
      booted: document.documentElement.dataset.booted || null,
      splash: document.querySelector('#splash') ? document.querySelector('#splash').className : null,
      splashSub: document.querySelector('#splash-sub') ? document.querySelector('#splash-sub').textContent : null,
      viewChildren: document.querySelector('#view') ? document.querySelector('#view').childElementCount : null,
      posters: document.querySelectorAll('.poster-card').length,
      title: document.title,
      theme: document.documentElement.dataset.theme,
      bodyClass: document.body.className,
      resources: performance.getEntriesByType('resource').map((r) => r.name.replace(location.origin + '/', '') + ':' + Math.round(r.duration) + 'ms')
    })`;

    const state = await send('Runtime.evaluate', { expression, returnByValue: true });
    const importResult = await send('Runtime.evaluate', {
      expression: `import('./js/app.js').then(() => 'import-ok').catch((error) => 'import-error: ' + error.message)`,
      returnByValue: true,
      awaitPromise: true
    });

    console.log('--- STATE ---');
    console.log(state.result.value);
    console.log('--- IMPORT ---');
    console.log(importResult.result.value);
    console.log('--- CONSOLE ---');
    console.log(consoleLines.join('\n') || '(none)');
    console.log('--- EXCEPTIONS ---');
    console.log(exceptions.join('\n') || '(none)');
    console.log('--- FAILED REQUESTS ---');
    console.log(failedRequests.join('\n') || '(none)');
    console.log('--- JS/JSON RESPONSES ---');
    console.log(responses.join('\n') || '(none)');
    console.log('--- CHROME STDERR (tail) ---');
    console.log(chromeErrors.join('').split('\n').slice(-12).join('\n'));

    ws.close();
  } finally {
    chrome.kill();
    await wait(500);
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (error) {
      /* 忽略。 */
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/* 端到端检查 + 截图（链接播放器版）。仅开发使用。 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const BASE = process.env.AH_BASE || 'http://127.0.0.1:4173/';
const PROFILE = path.join(process.env.TEMP || 'C:/Windows/Temp', 'ah-cdp-run-' + process.pid);
const SHOTS = path.resolve(__dirname, '..', '预览截图');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const consoleLines = [];
const exceptions = [];
const failedRequests = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const chromeErrors = [];
  chrome.stderr.on('data', (data) => chromeErrors.push(data.toString()));

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await response.json();
        target = list.find((entry) => entry.type === 'page') || null;
      } catch (error) {
        /* 等 Chrome。 */
      }
      if (!target) await wait(200);
    }
    if (!target) throw new Error('无法连接 Chrome 调试端口');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;

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
    await send('DOM.enable');

    async function evaluate(expression, useAwait = false) {
      const response = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: useAwait
      });
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text);
      }
      return response.result ? response.result.value : undefined;
    }

    async function waitFor(expression, timeout = 12000) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const value = await evaluate(expression);
        if (value) return value;
        await wait(120);
      }
      throw new Error('等待超时：' + expression);
    }

    async function navigate(hash) {
      await evaluate('location.hash = ' + JSON.stringify(hash));
      await wait(260);
    }

    async function click(selector) {
      const found = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!found) throw new Error('找不到元素：' + selector);
      await wait(180);
    }

    async function screenshot(name) {
      const data = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data.data, 'base64'));
      return name;
    }

    async function setViewport(width, height, scale, mobile) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile,
        screenWidth: width,
        screenHeight: height
      });
    }

    async function step(name, fn) {
      try {
        const detail = await fn();
        record(name, true, detail == null ? '' : String(detail));
      } catch (error) {
        record(name, false, error.message);
      }
    }

    async function clearToast() {
      await evaluate(`(() => {
        const toast = document.querySelector('#toast');
        if (toast) toast.classList.remove('is-visible');
        const playerToast = document.querySelector('#player-toast');
        if (playerToast) playerToast.classList.remove('is-visible');
      })()`);
      await wait(200);
    }

    async function submitDialog(value) {
      await waitFor('document.querySelector(".dialog")');
      await evaluate(`(() => {
        const dialog = document.querySelector('.dialog');
        const input = dialog.querySelector('input');
        if (input) input.value = ${JSON.stringify(String(value))};
        dialog.requestSubmit();
      })()`);
      await wait(220);
    }

    async function setFileInput(selector, filePath) {
      const document = await send('DOM.getDocument', { depth: -1 });
      const found = await send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
      if (!found.nodeId) throw new Error('找不到文件输入：' + selector);
      await send('DOM.setFileInputFiles', { files: [filePath], nodeId: found.nodeId });
      await wait(220);
    }

    async function pasteLink(url) {
      await waitFor('document.querySelector("#link-form")');
      await evaluate(`(() => {
        const input = document.querySelector('#link-input');
        input.value = ${JSON.stringify(url)};
        document.querySelector('#link-form').requestSubmit();
      })()`);
    }

    async function seedLinks(count) {
      return evaluate(`import('./js/local-library.js').then(async (m) => {
        for (let i = 1; i <= ${count}; i += 1) {
          await m.addLocalUrl({ url: 'https://example.com/test-video-' + i + '.mp4', title: '测试链接 ' + i });
        }
        return true;
      })`, true);
    }

    async function clearCustom() {
      await evaluate(`import('./js/db.js').then((m) => m.clearMany(['custom', 'progress', 'favorites', 'searches']))`, true);
    }

    async function reloadApp() {
      await send('Page.reload', { ignoreCache: false });
      await waitFor('document.documentElement.dataset.booted === "1"', 20000);
    }

    await setViewport(390, 844, 2, true);
    await send('Page.navigate', { url: BASE + '#/' });
    await waitFor('document.querySelector("#link-form")', 15000);
    await wait(600);

    await step('首页启动、粘贴链接入口、无内置片库', async () => {
      const data = JSON.parse(await evaluate(`JSON.stringify({
        booted: document.documentElement.dataset.booted,
        splashHidden: document.querySelector('#splash').classList.contains('is-hidden'),
        form: Boolean(document.querySelector('#link-form')),
        input: Boolean(document.querySelector('#link-input')),
        cards: document.querySelectorAll('.poster-card').length,
        pageSub: document.querySelector('.page-sub').textContent,
        empty: document.querySelector('.empty h3') ? document.querySelector('.empty h3').textContent : '',
        catalog: null
      })`));
      const catalogCount = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);

      if (data.booted !== '1' || !data.splashHidden) throw new Error('启动状态异常');
      if (!data.form || !data.input) throw new Error('缺少粘贴链接输入框');
      if (data.cards !== 0 || catalogCount !== 0) throw new Error('内置片库没有清空：' + data.cards + ' / ' + catalogCount);
      if (!data.empty.includes('还没有添加')) throw new Error('空状态 ' + data.empty);
      await screenshot('01-首页-空-手机.png');
      return data.pageSub + '；内置条目 ' + catalogCount;
    });

    await step('黑夜 / 白天主题与状态栏配色', async () => {
      let theme = await evaluate('document.documentElement.dataset.theme');
      if (theme !== 'dark') {
        await click('#theme-toggle');
        await wait(220);
      }
      const dark = JSON.parse(await evaluate(`JSON.stringify({
        mode: document.documentElement.dataset.theme,
        meta: document.querySelector('#meta-theme-color').content,
        status: document.querySelector('#meta-status-bar').content
      })`));
      if (dark.mode !== 'dark' || dark.meta !== '#000000' || dark.status !== 'black') {
        throw new Error('黑夜主题异常：' + JSON.stringify(dark));
      }
      await screenshot('01b-首页-黑夜-手机.png');

      await click('#theme-toggle');
      await wait(220);
      const light = JSON.parse(await evaluate(`JSON.stringify({
        mode: document.documentElement.dataset.theme,
        meta: document.querySelector('#meta-theme-color').content,
        status: document.querySelector('#meta-status-bar').content
      })`));
      if (light.mode !== 'light' || light.meta !== '#F5F5F7' || light.status !== 'default') {
        throw new Error('白天主题异常：' + JSON.stringify(light));
      }
      await screenshot('02-首页-白天-手机.png');
      return '黑夜 ' + dark.meta + '；白天 ' + light.meta;
    });

    await step('粘贴视频直链并播放', async () => {
      await clearToast();
      await pasteLink('https://media.w3.org/2010/05/sintel/trailer.mp4');
      await waitFor('document.querySelector("#player-video")');
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        const error = document.querySelector('#player-error');
        return Boolean(video && (video.readyState >= 1 || (error && !error.hidden)));
      })()`, 30000);

      const data = JSON.parse(await evaluate(`JSON.stringify({
        src: document.querySelector('#player-video').currentSrc,
        error: !document.querySelector('#player-error').hidden,
        errorText: document.querySelector('#player-error-text').textContent,
        quality: document.querySelector('#player-quality').textContent,
        title: document.title,
        hash: location.hash
      })`));

      if (data.error) throw new Error('直链播放错误：' + data.errorText);
      if (!data.src.includes('media.w3.org/2010/05/sintel/trailer.mp4')) throw new Error('播放地址 ' + data.src);
      if (data.quality !== '原始') throw new Error('清晰度按钮 ' + data.quality);
      if (!data.title.includes('trailer')) throw new Error('标题 ' + data.title);
      await clearToast();
      await screenshot('03-播放器-直链-手机.png');
      return data.title + '；' + data.quality;
    });

    await step('播放器：播放/暂停、±10 秒、静音、倍速、横竖屏', async () => {
      await click('[data-paction="toggle"]');
      await wait(900);
      const playing = JSON.parse(await evaluate(`JSON.stringify({
        paused: document.querySelector('#player-video').paused,
        time: document.querySelector('#player-video').currentTime
      })`));
      if (playing.paused || playing.time < 0.2) throw new Error('没有开始播放：' + JSON.stringify(playing));

      await click('[data-paction="toggle"]');
      await wait(250);
      if (!(await evaluate('document.querySelector("#player-video").paused'))) throw new Error('暂停失败');

      await evaluate('document.querySelector("#player-video").currentTime = 30');
      await wait(400);
      await click('[data-paction="rewind"]');
      await wait(350);
      const rewound = await evaluate('document.querySelector("#player-video").currentTime');
      if (rewound > 22 || rewound < 18) throw new Error('后退 10 秒后 ' + rewound);

      await click('[data-paction="forward"]');
      await wait(350);
      const forwarded = await evaluate('document.querySelector("#player-video").currentTime');
      if (forwarded < 28 || forwarded > 32) throw new Error('前进 10 秒后 ' + forwarded);

      await click('[data-paction="mute"]');
      await wait(200);
      const muted = await evaluate('document.querySelector("#player-video").muted');
      if (!muted) throw new Error('静音失败');

      await click('[data-paction="speed"]');
      await waitFor('document.querySelector(".sheet")');
      await evaluate(`document.querySelector('.sheet-option[data-value="1.5"]').click()`);
      await wait(300);
      const speed = JSON.parse(await evaluate(`JSON.stringify({
        label: document.querySelector('#player-speed').textContent,
        rate: document.querySelector('#player-video').playbackRate
      })`));
      if (speed.label !== '1.5×' || Math.abs(speed.rate - 1.5) > 0.01) throw new Error('倍速 ' + JSON.stringify(speed));

      await click('#player-rotate');
      await wait(400);
      const landscape = JSON.parse(await evaluate(`(() => {
        const page = document.querySelector('#player-page');
        const stage = document.querySelector('#player-stage');
        const rect = stage.getBoundingClientRect();
        return JSON.stringify({
          landscape: page.classList.contains('is-landscape'),
          pressed: document.querySelector('#player-rotate').getAttribute('aria-pressed'),
          stage: [Math.round(rect.width), Math.round(rect.height)],
          offset: [stage.offsetWidth, stage.offsetHeight],
          transform: getComputedStyle(stage).transform
        });
      })()`));
      if (!landscape.landscape || landscape.pressed !== 'true') throw new Error('横屏状态 ' + JSON.stringify(landscape));
      if (landscape.offset[0] <= landscape.offset[1] || landscape.transform === 'none') throw new Error('横屏没有旋转 ' + JSON.stringify(landscape));
      await clearToast();
      await screenshot('04-播放器-横屏-手机.png');

      await click('#player-rotate');
      await wait(350);
      await clearToast();
      return '播放 ' + playing.time.toFixed(1) + 's；后退 ' + rewound.toFixed(1) + 's；倍速 ' + speed.label + '；横屏已恢复';
    });

    await step('断点续播与观看历史', async () => {
      await evaluate(`(() => {
        const video = document.querySelector('#player-video');
        video.currentTime = 18;
        video.pause();
      })()`);
      await wait(700);

      const itemId = await evaluate('location.hash.split("/")[2]');
      await navigate('#/title/' + itemId);
      await waitFor('document.querySelector(".detail-page")');
      const note = await evaluate(`document.querySelector('.detail-progress-note') ? document.querySelector('.detail-progress-note').textContent.trim() : ''`);
      if (!note.includes('0:18')) throw new Error('详情页进度提示 ' + note);

      await navigate('#/watch/' + itemId);
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        return video && video.readyState >= 1;
      })()`, 30000);
      await wait(700);
      const resumed = await evaluate('document.querySelector("#player-video").currentTime');
      if (resumed < 14) throw new Error('没有续播，当前 ' + resumed);

      await navigate('#/history');
      await waitFor('document.querySelector(".history-row")');
      const historyText = await evaluate('document.querySelector(".history-row").textContent.replace(/\\s+/g, " ").trim()');
      if (!historyText.includes('trailer')) throw new Error('历史记录 ' + historyText);
      await screenshot('05-历史-手机.png');
      return '续播 ' + resumed.toFixed(1) + 's；' + historyText;
    });

    await step('首页链接列表、详情页与收藏', async () => {
      await navigate('#/');
      await waitFor('document.querySelector(".poster-card")');
      const home = JSON.parse(await evaluate(`JSON.stringify({
        cards: document.querySelectorAll('.poster-card').length,
        title: document.querySelector('.poster-title').textContent,
        cardWidth: document.querySelector('.poster-card').getBoundingClientRect().width,
        titleWidth: document.querySelector('.poster-title').getBoundingClientRect().width,
        overflow: getComputedStyle(document.querySelector('.poster-title')).textOverflow
      })`));
      if (home.cards !== 1) throw new Error('首页条目 ' + home.cards);
      if (home.titleWidth > home.cardWidth + 1) throw new Error('标题比海报宽');
      await clearToast();
      await screenshot('06-首页-有链接-手机.png');

      await click('.poster-card');
      await waitFor('document.querySelector(".detail-page")');
      const detail = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.detail-title').textContent,
        badge: document.querySelector('.detail-badge') ? document.querySelector('.detail-badge').textContent : '',
        info: Array.from(document.querySelectorAll('.info-row')).map((row) => row.querySelector('dt').textContent + '=' + row.querySelector('dd').textContent.trim()),
        watch: Boolean(document.querySelector('.watch-section')),
        play: document.querySelector('.detail-play').textContent.trim()
      })`));
      if (detail.badge !== '网址') throw new Error('标记 ' + detail.badge);
      if (!detail.info.includes('片源=网络地址')) throw new Error('片源信息 ' + JSON.stringify(detail.info));
      if (!detail.info.some((line) => line.startsWith('来源=media.w3.org'))) throw new Error('来源信息 ' + JSON.stringify(detail.info));
      if (detail.watch) throw new Error('不应显示“在哪看”');

      await click('.detail-actions [data-action="favorite"]');
      await waitFor(`document.querySelector('.detail-actions [data-action="favorite"]').classList.contains('is-active')`);
      await clearToast();
      await screenshot('07-详情-链接-手机.png');

      await navigate('#/favorites');
      await waitFor('document.querySelector(".poster-card")');
      const favorites = await evaluate('document.querySelectorAll(".poster-card").length');
      if (favorites !== 1) throw new Error('收藏条目 ' + favorites);
      return detail.title + '；' + detail.play + '；收藏 ' + favorites;
    });

    await step('搜索链接与无结果状态', async () => {
      await navigate('#/search');
      await waitFor('document.querySelector("#search-input")');
      await evaluate(`(() => {
        const input = document.querySelector('#search-input');
        input.value = 'trailer';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(500);
      const found = await evaluate('document.querySelectorAll(".poster-card").length');
      if (found !== 1) throw new Error('搜索结果 ' + found);

      await evaluate(`(() => {
        const input = document.querySelector('#search-input');
        input.value = '绝对不存在的链接 98765';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(500);
      const empty = JSON.parse(await evaluate(`JSON.stringify({
        summary: document.querySelector('.search-summary').textContent,
        platform: Boolean(document.querySelector('.platform-search'))
      })`));
      if (!empty.summary.includes('没有找到')) throw new Error('无结果提示 ' + empty.summary);
      if (empty.platform) throw new Error('不应再出现官方平台搜索块');
      await clearToast();
      await screenshot('08-搜索-无结果-手机.png');
      return '空状态：' + empty.summary;
    });

    await step('设置、备份导出与导入', async () => {
      await navigate('#/settings');
      await waitFor('document.querySelector("#import-file")');

      await evaluate(`(() => {
        const select = document.querySelector('#setting-rate');
        select.value = '1.25';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await wait(200);
      const rate = await evaluate(`import('./js/store.js').then((m) => m.state.settings.defaultRate)`, true);
      if (Number(rate) !== 1.25) throw new Error('默认倍速 ' + rate);

      await click('[data-action="export"]');
      await waitFor(`document.querySelector('#toast').textContent.includes('备份已导出')`);

      const payloadLength = await evaluate(`import('./js/store.js').then(async (m) => {
        const data = await m.exportData();
        window.__ahBackup = JSON.stringify(data);
        return window.__ahBackup.length;
      })`, true);
      if (!payloadLength || payloadLength < 20) throw new Error('备份内容为空');

      await clearToast();
      await evaluate(`(() => {
        const input = document.querySelector('#import-file');
        const file = new File([window.__ahBackup], 'AH影视-备份-test.json', { type: 'application/json' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await waitFor('document.querySelector(".dialog")');
      await evaluate('document.querySelector(".dialog [data-confirm]").click()');
      await waitFor(`document.querySelector('#toast').textContent.includes('已导入')`, 8000);

      const state = JSON.parse(await evaluate(`import('./js/store.js').then((m) => m.exportData()).then((data) => JSON.stringify({
        progress: data.progress.length,
        favorites: data.favorites.length,
        rate: data.settings.defaultRate
      }))`, true));
      if (state.progress < 1 || state.favorites !== 1) throw new Error('备份数据 ' + JSON.stringify(state));
      await screenshot('09-设置-白天-手机.png');
      return '备份 ' + payloadLength + ' 字节；' + JSON.stringify(state);
    });

    await step('粘贴 B 站视频页：官方嵌入式播放器', async () => {
      await navigate('#/');
      await pasteLink('https://www.bilibili.com/video/BV1er421H7UC/');
      await waitFor('document.querySelector(".embed-frame")');
      await wait(500);
      const player = JSON.parse(await evaluate(`JSON.stringify({
        src: document.querySelector('.embed-frame').src,
        open: document.querySelector('.embed-open') ? document.querySelector('.embed-open').getAttribute('href') : '',
        title: document.querySelector('.embed-title').textContent,
        rect: (() => {
          const r = document.querySelector('.embed-frame').getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        })()
      })`));
      if (!player.src.includes('bvid=BV1er421H7UC')) throw new Error('iframe 地址 ' + player.src);
      if (!player.open.includes('bilibili.com/video/BV1er421H7UC')) throw new Error('B 站回链 ' + player.open);
      if (!player.rect[0] || !player.rect[1]) throw new Error('iframe 尺寸 ' + JSON.stringify(player.rect));
      await clearToast();
      await screenshot('10-播放器-B站嵌入-手机.png');

      await navigate('#/history');
      await waitFor('document.querySelector(".history-row")');
      const historyText = await evaluate('document.body.innerText');
      if (!historyText.includes('bilibili') && !historyText.includes('B 站') && !historyText.includes('在哔哩哔哩播放器打开')) {
        throw new Error('历史里没有 B 站记录');
      }
      return player.title + '；iframe ' + player.rect.join('×');
    });

    await step('无效链接与网页链接的处理', async () => {
      await navigate('#/');
      await pasteLink('不是网址');
      await wait(250);
      const toast = await evaluate('document.querySelector("#toast").textContent');
      if (!toast.includes('http://')) throw new Error('无效链接提示 ' + toast);

      const before = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);
      await pasteLink('https://example.com/watch/12345');
      await waitFor('document.querySelector(".dialog")');
      const dialog = await evaluate('document.querySelector(".dialog").textContent');
      if (!dialog.includes('不是视频文件')) throw new Error('确认弹窗 ' + dialog);
      await click('.dialog [data-cancel]');
      const after = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);
      if (after !== before) throw new Error('取消后仍添加了条目');
      await clearToast();
      return '无效链接被拒绝；网页链接需要确认且取消后不添加';
    });

    await step('分页与跳页校验（27 条链接）', async () => {
      await seedLinks(25);
      await reloadApp();
      await navigate('#/');
      await waitFor('document.querySelector(".poster-card")');

      const page1 = JSON.parse(await evaluate(`JSON.stringify({
        cards: document.querySelectorAll('.poster-card').length,
        status: document.querySelector('.page-status') ? document.querySelector('.page-status').textContent : '',
        total: document.querySelectorAll('.poster-card').length
      })`));
      if (page1.cards !== 24) throw new Error('第一页数量 ' + page1.cards);
      if (!page1.status.includes('1 / 2')) throw new Error('分页状态 ' + page1.status);

      await navigate('#/?page=2');
      await waitFor(`document.querySelectorAll('.poster-card').length > 0`);
      const page2 = await evaluate('document.querySelectorAll(".poster-card").length');
      if (page2 !== 3) throw new Error('第二页数量 ' + page2);

      await click('[data-action="jump-page"]');
      await submitDialog('9');
      const error = await evaluate('document.querySelector(".dialog-error").textContent');
      if (!error.includes('1 到 2')) throw new Error('跳页校验 ' + error);
      await click('.dialog [data-cancel]');

      await clearCustom();
      await reloadApp();
      await navigate('#/');
      await waitFor('document.querySelector("#link-form")');
      const remaining = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);
      if (remaining !== 0) throw new Error('清理后剩余 ' + remaining);
      return '24 / 3；跳页校验正常；已清理测试链接';
    });

    await step('Service Worker、缓存版本与 manifest', async () => {
      await waitFor('navigator.serviceWorker.ready.then(() => true)', 15000);
      const data = JSON.parse(await evaluate(`(async () => {
        const sw = await (await fetch('./sw.js', { cache: 'no-store' })).text();
        const manifest = await (await fetch('./manifest.webmanifest', { cache: 'no-store' })).json();
        const keys = await caches.keys();
        return JSON.stringify({
          version: (sw.match(/ah-cinema-v\\d+/) || [''])[0],
          keys,
          name: manifest.name,
          icons: (manifest.icons || []).length,
          controlled: Boolean(navigator.serviceWorker.controller)
        });
      })()`, true));
      if (data.version !== 'ah-cinema-v7') throw new Error('缓存版本 ' + data.version);
      if (!data.keys.includes('ah-cinema-v7')) throw new Error('缓存列表 ' + JSON.stringify(data.keys));
      if (!data.name || data.icons < 3) throw new Error('manifest ' + JSON.stringify(data));
      if (!data.controlled) throw new Error('页面没有被 Service Worker 控制');
      return data.version + '；icons ' + data.icons;
    });

    await step('断网重载仍能打开应用壳', async () => {
      await send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0
      });
      await send('Page.reload', { ignoreCache: false });
      await waitFor('document.documentElement.dataset.booted === "1"', 20000);
      await waitFor('document.querySelector("#link-form")', 12000);
      await send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
      await wait(300);
      return '离线仍可打开首页和粘贴框';
    });

    await step('本机文件：写入 IndexedDB 并在刷新后恢复', async () => {
      const fixture = path.join(process.env.TEMP || 'C:/Windows/Temp', 'ah-cdp-local-' + process.pid + '.mp4');
      fs.writeFileSync(fixture, Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
        0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
      ]));

      try {
        await navigate('#/local');
        await waitFor('document.querySelector("#local-file-input")');
        await waitFor('document.querySelector(".local-empty-actions")');
        await screenshot('11-我的视频-空-手机.png');

        await click('[data-action="local-add-file"]');
        await setFileInput('#local-file-input', fixture);
        await submitDialog('测试本机文件');

        await waitFor('document.querySelector(".detail-page")', 20000);
        const detail = JSON.parse(await evaluate(`JSON.stringify({
          title: document.querySelector('.detail-title').textContent,
          badge: document.querySelector('.detail-badge') ? document.querySelector('.detail-badge').textContent : '',
          info: Array.from(document.querySelectorAll('.info-row')).map((row) => row.querySelector('dt').textContent + '=' + row.querySelector('dd').textContent.trim())
        })`));
        if (detail.title !== '测试本机文件') throw new Error('标题 ' + detail.title);
        if (detail.badge !== '本机') throw new Error('标记 ' + detail.badge);
        if (!detail.info.includes('片源=本机文件')) throw new Error('片源信息 ' + JSON.stringify(detail.info));

        const stored = JSON.parse(await evaluate(`import('./js/db.js').then((m) => m.getAll('custom')).then((rows) => {
          const record = rows.find((row) => row.kind === 'file');
          return JSON.stringify(record ? { title: record.title, size: record.size, isBlob: record.blob instanceof Blob } : null);
        })`, true));
        if (!stored || !stored.isBlob || stored.size !== 32) throw new Error('IndexedDB 记录 ' + JSON.stringify(stored));

        await reloadApp();
        await navigate('#/local');
        await waitFor('document.querySelector(".local-row")');
        const afterReload = JSON.parse(await evaluate(`import('./js/catalog.js').then((m) => {
          const items = m.allItems().filter((item) => item.local && item.localKind === 'file');
          return JSON.stringify(items.map((item) => ({
            title: item.title,
            src: item.sources[0] ? item.sources[0].src.slice(0, 5) : ''
          })));
        })`, true));
        if (afterReload.length !== 1 || afterReload[0].title !== '测试本机文件' || afterReload[0].src !== 'blob:') {
          throw new Error('刷新后没有恢复本机视频：' + JSON.stringify(afterReload));
        }

        await click('.local-row [data-action="remove-local"]');
        await waitFor('document.querySelector(".dialog")');
        await click('.dialog [data-confirm]');
        await waitFor('document.querySelector(".local-empty-actions")');
        const left = await evaluate(`import('./js/db.js').then((m) => m.getAll('custom')).then((rows) => rows.length)`, true);
        if (left !== 0) throw new Error('移除后还剩 ' + left + ' 条');
        return detail.title + '；' + stored.size + ' 字节；刷新后恢复；已移除';
      } finally {
        try {
          fs.rmSync(fixture, { force: true });
        } catch (error) {
          /* 忽略。 */
        }
      }
    });

    await step('手机横屏与桌面布局', async () => {
      await seedLinks(4);
      await reloadApp();
      await navigate('#/');
      await waitFor('document.querySelector(".poster-card")');

      await setViewport(844, 390, 2, true);
      await wait(400);
      const landscape = JSON.parse(await evaluate(`JSON.stringify({
        cards: document.querySelectorAll('.poster-card').length,
        columns: getComputedStyle(document.querySelector('.poster-grid')).gridTemplateColumns.split(' ').length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        tabbar: getComputedStyle(document.querySelector('#tabbar')).display
      })`));
      if (landscape.scrollWidth > landscape.clientWidth + 1) throw new Error('横向溢出 ' + JSON.stringify(landscape));
      if (landscape.tabbar === 'none') throw new Error('横屏底部导航不可见');
      await screenshot('12-首页-横屏-手机.png');

      await setViewport(1280, 800, 1, false);
      await wait(400);
      const desktop = JSON.parse(await evaluate(`JSON.stringify({
        sidebar: getComputedStyle(document.querySelector('#tabbar')).width,
        viewMargin: getComputedStyle(document.querySelector('#view')).marginLeft,
        header: getComputedStyle(document.querySelector('#app-header')).display
      })`));
      if (desktop.header !== 'none') throw new Error('桌面端不应显示顶栏');
      await screenshot('13-首页-桌面.png');

      await clearCustom();
      await reloadApp();
      return '横屏 ' + landscape.columns + ' 列，无溢出；桌面侧栏 ' + desktop.sidebar;
    });

    await setViewport(390, 844, 2, true);
    await wait(200);

    console.log('\n--- 控制台 ---');
    console.log(consoleLines.join('\n') || '(无)');
    console.log('\n--- 未捕获异常 ---');
    console.log(exceptions.join('\n') || '(无)');
    console.log('\n--- 失败请求 ---');
    console.log(failedRequests.join('\n') || '(无)');
    console.log('\n--- Chrome stderr（末尾）---');
    console.log(chromeErrors.join('').split('\n').slice(-15).join('\n'));

    const failed = results.filter((entry) => !entry.pass);
    console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
    if (failed.length) {
      console.log('失败项：' + failed.map((entry) => entry.name).join('、'));
      process.exitCode = 1;
    }

    ws.close();
  } finally {
    chrome.kill();
    await wait(600);
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (error) {
      /* 忽略。 */
    }
  }
}

main().catch((error) => {
  console.error('测试脚本失败：', error);
  process.exit(1);
});

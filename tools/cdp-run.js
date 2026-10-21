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

    /*
     * 通过“我的视频 → 粘贴链接”添加视频。
     * 返回：
     *   'ok'      已添加并进入播放页
     *   'confirm' 网页链接需要确认，对话框仍打开
     *   'invalid' 地址格式不合法，对话框仍打开
     */
    async function pasteLink(url) {
      await navigate('#/local');
      await waitFor('document.querySelector("[data-action=local-add-url]")');
      await click('[data-action="local-add-url"]');
      await submitDialog(url);
      await wait(320);

      const error = await evaluate('document.querySelector(".dialog-error") ? document.querySelector(".dialog-error").textContent : ""');
      if (error) return 'invalid';

      const dialogText = await evaluate('document.querySelector(".dialog") ? document.querySelector(".dialog").innerText : ""');
      if (dialogText.includes('不是视频文件')) return 'confirm';

      await waitFor('document.querySelector(".dialog input")');
      await evaluate(`document.querySelector('.dialog').requestSubmit()`);
      await waitFor('location.hash.startsWith("#/title/")', 20000);
      await evaluate('location.hash = "#/watch/" + location.hash.split("/title/")[1]');
      await waitFor('Boolean(document.querySelector("#player-video")) || Boolean(document.querySelector(".embed-frame"))', 20000);
      return 'ok';
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
    await waitFor('document.querySelector(".home-page")', 15000);
    await wait(600);

    await step('首页启动、源片库入口、无内置片库', async () => {
      const data = JSON.parse(await evaluate(`JSON.stringify({
        booted: document.documentElement.dataset.booted,
        splashHidden: document.querySelector('#splash').classList.contains('is-hidden'),
        pasteForm: Boolean(document.querySelector('#link-form')),
        browse: Boolean(document.querySelector('#home-browse')),
        mine: Boolean(document.querySelector('.mine-entry')),
        notice: document.querySelector('#home-browse .remote-notice strong') ? document.querySelector('#home-browse .remote-notice strong').textContent : '',
        pageSub: document.querySelector('.page-sub').textContent,
        catalog: null
      })`));
      const catalogCount = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);

      if (data.booted !== '1' || !data.splashHidden) throw new Error('启动状态异常');
      if (data.pasteForm) throw new Error('首页仍然有粘贴链接输入框');
      if (!data.browse || !data.mine) throw new Error('首页缺少片库或“我的视频”入口');
      if (!data.notice.includes('还没有可用的源')) throw new Error('未配置源时的提示 ' + data.notice);
      if (catalogCount !== 0) throw new Error('内置片库没有清空：' + catalogCount);
      await screenshot('01-首页-源片库-手机.png');
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
        line: document.querySelector('#player-line').textContent,
        title: document.title,
        hash: location.hash
      })`));

      if (data.error) throw new Error('直链播放错误：' + data.errorText);
      if (!data.src.includes('media.w3.org/2010/05/sintel/trailer.mp4')) throw new Error('播放地址 ' + data.src);
      if (!data.line.includes('线路')) throw new Error('线路按钮 ' + data.line);

      /* 缓冲转圈必须和播放 / 暂停键里的图标一样大，而不是整个按钮那么大。 */
      const playSizes = JSON.parse(await evaluate(`(() => {
        const buffering = document.querySelector('#player-buffering');
        const hidden = buffering.hidden;
        buffering.hidden = false;
        const play = document.querySelector('#player-play').getBoundingClientRect();
        const iconEl = document.querySelector('#player-play .icon');
        const spinnerEl = document.querySelector('.player-spinner');
        const icon = parseFloat(getComputedStyle(iconEl).width);
        const spinner = parseFloat(getComputedStyle(spinnerEl).width);
        buffering.hidden = hidden;
        return JSON.stringify({
          play: Math.round(play.width),
          icon: Math.round(icon),
          spinner: Math.round(spinner)
        });
      })()`));
      if (playSizes.play < 70 || playSizes.icon < 30 || Math.abs(playSizes.icon - playSizes.spinner) > 1) {
        throw new Error('缓冲转圈与暂停图标尺寸不一致 ' + JSON.stringify(playSizes));
      }

      /* 新布局：底部横向进度条、居中横向播放组、右上角静音/选集/关闭、左下角菜单、右下角全屏。 */
      const layout = JSON.parse(await evaluate(`(() => {
        const rect = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.getBoundingClientRect() : null;
        };
        const scrubRow = rect('.player-scrub-row');
        const scrubInput = rect('#player-scrub');
        const current = rect('#player-current');
        const duration = rect('#player-duration');
        const play = rect('#player-play');
        const rewind = rect('[data-paction="rewind"]');
        const forward = rect('[data-paction="forward"]');
        const mute = rect('#player-mute');
        const episodes = rect('#player-episodes');
        const rotate = rect('#player-rotate');
        const fullscreen = rect('#player-fullscreen');
        const close = document.querySelector('.player-top-actions .pbtn-close').getBoundingClientRect();
        const menu = rect('#player-menu');
        const center = (r) => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
        return JSON.stringify({
          viewport: [innerWidth, innerHeight],
          scrubRow: [Math.round(scrubRow.left), Math.round(scrubRow.top), Math.round(scrubRow.width), Math.round(scrubRow.height)],
          scrubInput: [Math.round(scrubInput.left), Math.round(scrubInput.right)],
          current: [Math.round(current.left), Math.round(current.top)],
          duration: [Math.round(duration.left), Math.round(duration.top)],
          durationText: document.querySelector('#player-duration').textContent,
          play: [Math.round(play.left + play.width / 2), Math.round(play.top + play.height / 2), Math.round(play.width)],
          rewind: [Math.round(rewind.left + rewind.width / 2), Math.round(rewind.top + rewind.height / 2), Math.round(rewind.width)],
          forward: [Math.round(forward.left + forward.width / 2), Math.round(forward.top + forward.height / 2), Math.round(forward.width)],
          seekText: document.querySelector('[data-paction="rewind"] .icon text').textContent + document.querySelector('[data-paction="forward"] .icon text').textContent,
          mute: center(mute).concat(Math.round(mute.width)),
          episodes: episodes ? center(episodes) : null,
          rotate: center(rotate),
          fullscreen: center(fullscreen).concat(Math.round(fullscreen.width)),
          fullscreenRight: Math.round(innerWidth - fullscreen.right),
          close: [Math.round(close.left), Math.round(close.top)],
          menu: [Math.round(menu.left), Math.round(menu.bottom)],
          hasLine: Boolean(document.querySelector('#player-menu #player-line')),
          hasQuality: Boolean(document.querySelector('#player-quality, [data-paction="quality"]')),
          hasCast: Boolean(document.querySelector('[data-paction="cast"], #player-cast')),
          hasVolumeTrack: Boolean(document.querySelector('.player-volume-track, #player-volume-track')),
          /* ±10 图标：实心箭头在圆环顶部，箭尾贴着圆环端点。 */
          seekIcon: (() => {
            const boxes = (selector) => {
              const paths = document.querySelector(selector).querySelectorAll('path');
              return { ring: paths[0].getBBox(), head: paths[1].getBBox() };
            };
            const rewind = boxes('[data-paction="rewind"] .icon');
            const forward = boxes('[data-paction="forward"] .icon');
            return {
              rewindHeadAbove: rewind.head.y < rewind.ring.y - 1,
              forwardHeadAbove: forward.head.y < forward.ring.y - 1,
              rewindGap: rewind.ring.y < 6,
              forwardGap: forward.ring.y < 6
            };
          })(),
          statusBar: document.getElementById('meta-status-bar').getAttribute('content'),
          theme: document.getElementById('meta-theme-color').getAttribute('content')
        });
      })()`));
      if (layout.statusBar !== 'black' || layout.theme !== '#000') {
        throw new Error('竖屏状态栏没有恢复原生样式 ' + JSON.stringify({ statusBar: layout.statusBar, theme: layout.theme }));
      }
      const width = layout.viewport[0];
      const height = layout.viewport[1];
      if (layout.scrubRow[2] < layout.scrubRow[3] * 3) throw new Error('进度条不是横向 ' + JSON.stringify(layout.scrubRow));
      if (height - (layout.scrubRow[1] + layout.scrubRow[3]) > 40) throw new Error('进度条不在底部 ' + JSON.stringify(layout.scrubRow));
      if (!(layout.current[0] < layout.scrubInput[0] && layout.duration[0] >= layout.scrubInput[1])) {
        throw new Error('时间没有放在进度条两端 ' + JSON.stringify(layout));
      }
      if (!layout.durationText.startsWith('-')) {
        throw new Error('右侧不是剩余时长 ' + layout.durationText);
      }
      if (Math.abs(layout.play[0] - width / 2) > 6 || Math.abs(layout.play[1] - height / 2) > 30) {
        throw new Error('播放键不在画面中央 ' + JSON.stringify(layout.play));
      }
      /* 后退在左、前进在右，三者同一水平线，且都明显大于普通圆钮。 */
      if (!(layout.rewind[0] < layout.play[0] - 30 && layout.forward[0] > layout.play[0] + 30)) {
        throw new Error('±10 秒按钮没有放在播放键左右 ' + JSON.stringify({ rewind: layout.rewind, play: layout.play, forward: layout.forward }));
      }
      if (Math.abs(layout.rewind[1] - layout.play[1]) > 4 || Math.abs(layout.forward[1] - layout.play[1]) > 4) {
        throw new Error('±10 秒按钮没有和播放键水平对齐 ' + JSON.stringify(layout));
      }
      if (layout.rewind[2] < 54 || layout.forward[2] < 54 || layout.seekText !== '1010') {
        throw new Error('±10 秒按钮或图标不对 ' + JSON.stringify(layout));
      }
      if (!layout.seekIcon.rewindHeadAbove || !layout.seekIcon.forwardHeadAbove
        || !layout.seekIcon.rewindGap || !layout.seekIcon.forwardGap) {
        throw new Error('±10 箭头没有接在顶部圆环上 ' + JSON.stringify(layout.seekIcon));
      }
      if (layout.mute[1] > 90 || layout.mute[2] < 40
        || (layout.episodes && (Math.abs(layout.mute[1] - layout.episodes[1]) > 4
          || layout.mute[0] > layout.episodes[0] - 20))) {
        throw new Error('静音钮不在右上角选集左侧 ' + JSON.stringify({ mute: layout.mute, episodes: layout.episodes }));
      }
      if (layout.close[1] > 90 || layout.close[0] < width * 0.7) {
        throw new Error('关闭按钮不在右上角 ' + JSON.stringify(layout.close));
      }
      if (layout.fullscreen[1] < height * 0.7 || layout.fullscreenRight > 24
        || layout.fullscreen[0] < layout.rotate[0] + 20) {
        throw new Error('全屏按钮不在右下角横屏右侧 ' + JSON.stringify({ fullscreen: layout.fullscreen, right: layout.fullscreenRight, rotate: layout.rotate }));
      }
      if (layout.menu[0] > 30 || !layout.hasLine) {
        throw new Error('菜单组不在左下角或缺少线路 ' + JSON.stringify(layout));
      }
      if (layout.hasQuality || layout.hasCast || layout.hasVolumeTrack) {
        throw new Error('清晰度/投屏/音量条没有移除 ' + JSON.stringify(layout));
      }
      if (!data.title.includes('trailer')) throw new Error('标题 ' + data.title);
      await clearToast();
      await screenshot('03-播放器-直链-手机.png');
      return data.title + '；线路 ' + data.line;
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

      /* 静音键在右上角、选集的左边，点第二次恢复声音。 */
      const muteSpot = JSON.parse(await evaluate(`(() => {
        const mute = document.querySelector('#player-mute');
        const rect = mute.getBoundingClientRect();
        const episodesEl = document.querySelector('#player-episodes');
        const episodes = episodesEl ? episodesEl.getBoundingClientRect() : null;
        return JSON.stringify({
          sound: mute.classList.contains('pbtn-sound'),
          inTop: Boolean(document.querySelector('.player-top-actions #player-mute')),
          top: Math.round(rect.top),
          center: Math.round((rect.top + rect.bottom) / 2),
          episodesCenter: episodes ? Math.round((episodes.top + episodes.bottom) / 2) : null,
          episodesLeft: episodes ? Math.round(episodes.left) : null,
          right: Math.round(rect.right)
        });
      })()`));
      if (!muteSpot.sound || !muteSpot.inTop || muteSpot.top > 90
        || (muteSpot.episodesLeft !== null
          && (Math.abs(muteSpot.center - muteSpot.episodesCenter) > 4
            || muteSpot.right > muteSpot.episodesLeft - 10))) {
        throw new Error('静音钮不在右上角选集左侧 ' + JSON.stringify(muteSpot));
      }

      await click('[data-paction="mute"]');
      await wait(200);
      if (await evaluate('document.querySelector("#player-video").muted')) throw new Error('取消静音失败');

      /* 双击画面空白处：暂停中双击开始播放，再双击暂停。 */
      const beforeTap = await evaluate('document.querySelector("#player-video").currentTime');
      await evaluate(`(() => {
        const stage = document.querySelector('#player-stage');
        stage.click();
        stage.click();
      })()`);
      await wait(700);
      const doubleStart = JSON.parse(await evaluate(`JSON.stringify({
        paused: document.querySelector('#player-video').paused,
        time: document.querySelector('#player-video').currentTime
      })`));
      if (doubleStart.paused || doubleStart.time - beforeTap < 0.2) {
        throw new Error('双击没有开始播放 ' + JSON.stringify(Object.assign({ beforeTap }, doubleStart)));
      }

      await evaluate(`(() => {
        const stage = document.querySelector('#player-stage');
        stage.click();
        stage.click();
      })()`);
      await wait(300);
      if (!(await evaluate('document.querySelector("#player-video").paused'))) throw new Error('双击没有暂停');

      await click('[data-paction="speed"]');
      await waitFor('document.querySelector(".sheet")');

      /* 倍速面板是贴右侧的浮动卡片，不再是从底部升起的整块面板。 */
      const sideSheet = JSON.parse(await evaluate(`(() => {
        const sheet = document.querySelector('.sheet');
        const rect = sheet.getBoundingClientRect();
        return JSON.stringify({
          side: sheet.classList.contains('sheet-side'),
          right: Math.round(innerWidth - rect.right),
          bottom: Math.round(innerHeight - rect.bottom),
          width: Math.round(rect.width),
          backdrop: Boolean(document.querySelector('.sheet-side-backdrop'))
        });
      })()`));
      if (!sideSheet.side || !sideSheet.backdrop || sideSheet.right > 24 || sideSheet.bottom < 88 || sideSheet.width > 300) {
        throw new Error('倍速面板不是右下角浮卡 ' + JSON.stringify(sideSheet));
      }
      await wait(240);
      await screenshot('07b-播放器-倍速浮卡-手机.png');

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
          transform: getComputedStyle(stage).transform,
          statusBar: document.getElementById('meta-status-bar').getAttribute('content')
        });
      })()`));
      if (!landscape.landscape || landscape.pressed !== 'true') throw new Error('横屏状态 ' + JSON.stringify(landscape));
      if (landscape.offset[0] <= landscape.offset[1] || landscape.transform === 'none') throw new Error('横屏没有旋转 ' + JSON.stringify(landscape));
      if (landscape.statusBar !== 'black-translucent') throw new Error('横屏状态栏没有适配 ' + landscape.statusBar);
      /* 旋转后的局部坐标：顶部动作组在右，菜单与全屏也在右（用户转正手机后即右上 / 右下）。 */
      const forcedLayout = JSON.parse(await evaluate(`(() => {
        const stage = document.querySelector('#player-stage');
        const left = (selector) => document.querySelector(selector).offsetLeft;
        const episodesEl = document.querySelector('#player-episodes');
        return JSON.stringify({
          mute: left('#player-mute'),
          episodes: episodesEl ? left('#player-episodes') : null,
          close: left('.player-top-actions .pbtn-close'),
          line: left('#player-line'),
          fullscreen: left('#player-fullscreen'),
          stageWidth: stage.offsetWidth
        });
      })()`));
      const forcedLefts = [forcedLayout.mute, forcedLayout.episodes, forcedLayout.close]
        .filter((value) => value !== null);
      if (forcedLefts.some((value, index) => index > 0 && value <= forcedLefts[index - 1])) {
        throw new Error('强制横屏顶部动作组顺序不对 ' + JSON.stringify(forcedLayout));
      }
      if (!(forcedLayout.close > forcedLayout.stageWidth * 0.5)) {
        throw new Error('强制横屏顶部动作组不在右上角 ' + JSON.stringify(forcedLayout));
      }
      if (!(forcedLayout.line > forcedLayout.stageWidth * 0.5 && forcedLayout.fullscreen > forcedLayout.line)) {
        throw new Error('强制横屏菜单/全屏不在右侧 ' + JSON.stringify(forcedLayout));
      }
      await clearToast();
      await screenshot('04-播放器-横屏-手机.png');

      /* 强制横屏下打开倍速浮卡：卡片也转 90°，并落在画面右下角。 */
      await click('[data-paction="speed"]');
      await waitFor('document.querySelector(".sheet-side")');
      await wait(280);
      const sideRotated = JSON.parse(await evaluate(`(() => {
        const sheet = document.querySelector('.sheet-side');
        const rect = sheet.getBoundingClientRect();
        return JSON.stringify({
          rotated: getComputedStyle(sheet).transform !== 'none',
          rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
          viewport: [innerWidth, innerHeight]
        });
      })()`));
      /* 旋转后：竖屏的 bottom 对应画面右侧，left 对应画面底部。 */
      const sideRight = sideRotated.viewport[1] - sideRotated.rect[3];
      const sideBottom = sideRotated.rect[0];
      if (!sideRotated.rotated || sideRight > 24 || sideBottom < 84) {
        throw new Error('强制横屏的浮卡不在画面右下角 ' + JSON.stringify(Object.assign({}, sideRotated, { sideRight, sideBottom })));
      }
      await screenshot('04c-播放器-强制横屏-倍速浮卡-手机.png');
      await evaluate(`document.querySelector('.sheet-side-backdrop').click()`);
      await wait(260);

      await click('#player-rotate');
      await wait(350);

      /* 物理横屏：静音/选集/关闭在右上角，菜单与全屏在右下，和点「横屏」后看到的一致。 */
      await setViewport(844, 390, 2, true);
      await wait(500);
      const landscapeLayout = JSON.parse(await evaluate(`(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const mute = rect('.player-top-actions #player-mute');
        const episodesEl = document.querySelector('#player-episodes');
        const episodes = episodesEl ? episodesEl.getBoundingClientRect() : null;
        const close = rect('.player-top-actions .pbtn-close');
        const fullscreen = rect('#player-fullscreen');
        const line = rect('#player-line');
        const menu = rect('#player-menu');
        const rewind = rect('[data-paction="rewind"]');
        const play = rect('#player-play');
        const forward = rect('[data-paction="forward"]');
        return JSON.stringify({
          viewport: [innerWidth, innerHeight],
          rotateHidden: document.querySelector('#player-rotate').hidden,
          fullscreenHidden: document.querySelector('#player-fullscreen').hidden,
          mute: [Math.round(mute.left), Math.round(mute.top)],
          episodes: episodes ? [Math.round(episodes.left), Math.round(episodes.top)] : null,
          close: [Math.round(close.left), Math.round(close.top)],
          fullscreen: [Math.round(innerWidth - fullscreen.right), Math.round(fullscreen.top)],
          lineLeft: Math.round(line.left),
          menuRight: Math.round(innerWidth - menu.right),
          menuBottom: Math.round(innerHeight - menu.bottom),
          order: [Math.round(rewind.left + rewind.width / 2), Math.round(play.left + play.width / 2), Math.round(forward.left + forward.width / 2)],
          statusBar: document.getElementById('meta-status-bar').getAttribute('content')
        });
      })()`));
      if (!landscapeLayout.rotateHidden || landscapeLayout.fullscreenHidden) {
        throw new Error('物理横屏的横屏/全屏按钮状态 ' + JSON.stringify(landscapeLayout));
      }
      const landscapeWidth = landscapeLayout.viewport[0];
      const landscapeHeight = landscapeLayout.viewport[1];
      if (!(landscapeLayout.close[0] > landscapeWidth * 0.7 && landscapeLayout.close[1] < 90)) {
        throw new Error('物理横屏关闭键不在右上角 ' + JSON.stringify(landscapeLayout.close));
      }
      const topLefts = [landscapeLayout.mute, landscapeLayout.episodes, landscapeLayout.close]
        .filter(Boolean).map((item) => item[0]);
      if (landscapeLayout.mute[1] > 90 || landscapeLayout.mute[0] < landscapeWidth * 0.5
        || topLefts.some((left, index) => index > 0 && left <= topLefts[index - 1])) {
        throw new Error('物理横屏顶部动作组不在右上角或顺序不对 ' + JSON.stringify(landscapeLayout));
      }
      if (landscapeLayout.fullscreen[0] > 24 || landscapeLayout.fullscreen[1] < landscapeHeight * 0.7) {
        throw new Error('物理横屏全屏键不在右下角 ' + JSON.stringify(landscapeLayout));
      }
      if (landscapeLayout.lineLeft < landscapeWidth * 0.5
        || landscapeLayout.menuRight > 24 || landscapeLayout.menuBottom > 90) {
        throw new Error('物理横屏菜单组不在右下角 ' + JSON.stringify(landscapeLayout));
      }
      if (!(landscapeLayout.order[0] < landscapeLayout.order[1] && landscapeLayout.order[1] < landscapeLayout.order[2])) {
        throw new Error('横屏 ±10 秒按钮不在播放键左右 ' + JSON.stringify(landscapeLayout.order));
      }
      if (landscapeLayout.statusBar !== 'black-translucent') {
        throw new Error('物理横屏状态栏没有适配 ' + landscapeLayout.statusBar);
      }

      await evaluate(`document.querySelector('#player-overlay').classList.add('is-hidden')`);
      await wait(320);
      const hiddenMode = JSON.parse(await evaluate(`(() => {
        const overlay = document.querySelector('#player-overlay');
        const fullscreen = document.querySelector('#player-fullscreen');
        return JSON.stringify({
          opacity: getComputedStyle(overlay).opacity,
          pointer: getComputedStyle(overlay).pointerEvents,
          buttonPointer: getComputedStyle(fullscreen).pointerEvents
        });
      })()`));
      await evaluate(`document.querySelector('#player-overlay').classList.remove('is-hidden')`);
      await wait(240);
      if (hiddenMode.opacity !== '0' || hiddenMode.pointer !== 'none' || hiddenMode.buttonPointer !== 'none') {
        throw new Error('全屏按钮没有随控件一起隐藏 ' + JSON.stringify(hiddenMode));
      }
      await clearToast();
      await screenshot('04b-播放器-物理横屏-手机.png');
      await setViewport(390, 844, 2, true);
      await wait(500);
      const restoredStatus = await evaluate(`document.getElementById('meta-status-bar').getAttribute('content')`);
      if (restoredStatus !== 'black') throw new Error('回到竖屏后状态栏没有恢复：' + restoredStatus);

      /* 物理横屏转回竖屏后，所有按钮必须重新可点（iOS 上最容易坏在这里）。 */
      const portraitHit = JSON.parse(await evaluate(`(() => {
        const selectors = ['#player-mute', '.player-top-actions .pbtn-close', '[data-paction="rewind"]',
          '#player-play', '[data-paction="forward"]', '#player-line', '#player-speed',
          '#player-rotate', '#player-fullscreen'];
        const misses = [];
        selectors.forEach((selector) => {
          const el = document.querySelector(selector);
          if (!el) { misses.push(selector + ':missing'); return; }
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!hit || !(hit === el || el.contains(hit))) {
            misses.push(selector + ':' + (hit ? hit.tagName + '.' + hit.className : 'null'));
          }
        });
        return JSON.stringify({
          landscapeViewport: document.querySelector('#player-page').classList.contains('is-landscape-viewport'),
          rotateHidden: document.querySelector('#player-rotate').hidden,
          overlayHidden: document.querySelector('#player-overlay').classList.contains('is-hidden'),
          misses
        });
      })()`));
      if (portraitHit.landscapeViewport || portraitHit.rotateHidden || portraitHit.overlayHidden || portraitHit.misses.length) {
        throw new Error('回到竖屏后按钮不可点 ' + JSON.stringify(portraitHit));
      }
      const mutedBefore = await evaluate('document.querySelector("#player-video").muted');
      await click('#player-mute');
      await wait(200);
      if (await evaluate('document.querySelector("#player-video").muted') === mutedBefore) {
        throw new Error('回到竖屏后静音键没有响应');
      }
      await click('#player-mute');

      /* 控件隐藏后，第一次触摸就要能把它们唤回来。 */
      await evaluate(`document.querySelector('#player-overlay').classList.add('is-hidden')`);
      await wait(280);
      const tapPoint = JSON.parse(await evaluate(`JSON.stringify([innerWidth / 2, innerHeight * 0.62])`));
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tapPoint[0], y: tapPoint[1], button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tapPoint[0], y: tapPoint[1], button: 'left', clickCount: 1 });
      await wait(180);
      if (await evaluate(`document.querySelector('#player-overlay').classList.contains('is-hidden')`)) {
        throw new Error('控件隐藏后触摸没有唤出控件');
      }
      await wait(400);
      if (await evaluate(`document.querySelector('#player-overlay').classList.contains('is-hidden')`)) {
        throw new Error('唤出控件后又被同一次点击藏回去');
      }
      await clearToast();
      return '播放 ' + playing.time.toFixed(1) + 's；后退 ' + rewound.toFixed(1) + 's；倍速 ' + speed.label + '；横屏已恢复且按钮可点';
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

    await step('我的视频链接列表、详情页与收藏', async () => {
      await navigate('#/local');
      await waitFor('document.querySelector(".local-row")');
      const local = JSON.parse(await evaluate(`JSON.stringify({
        rows: document.querySelectorAll('.local-row').length,
        title: document.querySelector('.local-row .history-title').textContent,
        sub: document.querySelector('.local-row .history-sub').textContent
      })`));
      if (local.rows !== 1) throw new Error('我的视频条目 ' + local.rows);
      if (!local.sub.includes('网络地址')) throw new Error('条目类型 ' + local.sub);
      await clearToast();
      await screenshot('06-我的视频-链接-手机.png');

      const watchHref = await evaluate('document.querySelector(".local-row .history-link").getAttribute("href")');
      const itemId = watchHref.split('/').pop();
      await navigate('#/title/' + itemId);
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

      await evaluate(`document.querySelector('#search-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`);
      await wait(600);

      /* 再留一条记录，用于验证“删除所选”和“全部删除”两条路径。 */
      await evaluate(`(() => {
        const input = document.querySelector('#search-input');
        input.value = 'second-record';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(200);
      await evaluate(`document.querySelector('#search-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`);
      await wait(600);
      await navigate('#/search');
      await waitFor('document.querySelectorAll(".section .recent-chip").length >= 2');

      const selection = JSON.parse(await evaluate(`JSON.stringify({
        body: getComputedStyle(document.body).userSelect,
        input: getComputedStyle(document.querySelector('#search-input')).userSelect
      })`));
      if (selection.body !== 'none' || selection.input !== 'text') {
        throw new Error('文字选择策略 ' + JSON.stringify(selection));
      }

      /* 原位多选：不弹面板，原位置的胶囊直接可点选。 */
      await evaluate(`document.querySelector('[data-action="search-manage"]').click()`);
      await waitFor('document.querySelector(".recent-list.is-managing")');
      await wait(250);
      const manageRows = await evaluate('document.querySelectorAll(".recent-list.is-managing .recent-chip").length');
      if (manageRows !== 2) throw new Error('管理状态记录数 ' + manageRows);

      await evaluate(`document.querySelector('.recent-list.is-managing .recent-chip').click()`);
      await wait(150);
      const chosen = JSON.parse(await evaluate(`JSON.stringify({
        selected: document.querySelector('.recent-chip').classList.contains('is-selected'),
        pressed: document.querySelector('.recent-chip').getAttribute('aria-pressed'),
        label: document.querySelector('[data-action="delete-selected-searches"]').textContent,
        disabled: document.querySelector('[data-action="delete-selected-searches"]').disabled,
        stillManaging: Boolean(document.querySelector('.recent-list.is-managing'))
      })`));
      if (!chosen.selected || chosen.pressed !== 'true' || chosen.disabled || !chosen.label.includes('1')) {
        throw new Error('原位多选状态 ' + JSON.stringify(chosen));
      }
      if (!chosen.stillManaging) throw new Error('点选后不应退出管理状态');
      await screenshot('08b-搜索-管理记录-手机.png');

      await evaluate(`document.querySelector('[data-action="delete-selected-searches"]').click()`);
      await waitFor('!document.querySelector(".recent-list.is-managing")');
      await wait(250);
      const remaining = await evaluate('document.querySelectorAll(".section .recent-chip").length');
      if (remaining !== 1) throw new Error('删除所选后剩余 ' + remaining);

      await evaluate(`document.querySelector('[data-action="clear-all-searches"]').click()`);
      await waitFor('document.querySelectorAll(".section .recent-chip").length === 0');
      const afterAll = await evaluate('document.querySelectorAll(".section .recent-chip").length');
      if (afterAll !== 0) throw new Error('全部删除后剩余 ' + afterAll);

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
      const invalid = await pasteLink('不是网址');
      const error = await evaluate('document.querySelector(".dialog-error") ? document.querySelector(".dialog-error").textContent : ""');
      if (invalid !== 'invalid' || !error.includes('http://')) throw new Error('无效链接提示 ' + invalid + ' / ' + error);
      await click('.dialog [data-cancel]');

      const before = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);
      const page = await pasteLink('https://example.com/watch/12345');
      if (page !== 'confirm') throw new Error('网页链接没有弹出确认：' + page);
      const dialog = await evaluate('document.querySelector(".dialog").textContent');
      if (!dialog.includes('不是视频文件')) throw new Error('确认弹窗 ' + dialog);
      await click('.dialog [data-cancel]');
      const after = await evaluate(`import('./js/catalog.js').then((m) => m.allItems().length)`, true);
      if (after !== before) throw new Error('取消后仍添加了条目');
      await clearToast();
      return '无效链接被拒绝；网页链接需要确认且取消后不添加';
    });

    await step('收藏页分页与跳页校验（27 条链接）', async () => {
      await seedLinks(25);
      await reloadApp();
      await evaluate(`import('./js/store.js').then(async (store) => {
        const catalog = await import('./js/catalog.js');
        for (const item of catalog.allItems()) {
          if (!store.isFavorite(item.id)) await store.toggleFavorite(item.id);
        }
        return true;
      })`, true);

      await navigate('#/favorites');
      await waitFor('document.querySelector(".poster-card")');

      const page1 = JSON.parse(await evaluate(`JSON.stringify({
        cards: document.querySelectorAll('.poster-card').length,
        status: document.querySelector('.page-status') ? document.querySelector('.page-status').textContent : ''
      })`));
      if (page1.cards !== 24) throw new Error('第一页数量 ' + page1.cards);
      if (!page1.status.includes('1 / 2')) throw new Error('分页状态 ' + page1.status);

      await navigate('#/favorites?page=2');
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
      await navigate('#/local');
      await waitFor('document.querySelector(".local-empty-actions")');
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
      if (data.version !== 'ah-cinema-v25') throw new Error('缓存版本 ' + data.version);
      if (!data.keys.includes('ah-cinema-v25')) throw new Error('缓存列表 ' + JSON.stringify(data.keys));
      if (!data.name || data.icons < 3) throw new Error('manifest ' + JSON.stringify(data));
      if (!data.controlled) throw new Error('页面没有被 Service Worker 控制');
      return data.version + '；icons ' + data.icons;
    });

    await step('断网重载仍能打开应用壳', async () => {
      await navigate('#/');
      await waitFor('document.querySelector(".home-page")');
      await send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0
      });
      await send('Page.reload', { ignoreCache: false });
      await waitFor('document.documentElement.dataset.booted === "1"', 20000);
      await waitFor('document.querySelector(".home-page")', 12000);
      await send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
      await wait(300);
      return '离线仍可打开首页和片库区域';
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
      await evaluate(`import('./js/store.js').then(async (store) => {
        const catalog = await import('./js/catalog.js');
        for (const item of catalog.allItems()) {
          if (!store.isFavorite(item.id)) await store.toggleFavorite(item.id);
        }
        return true;
      })`, true);
      await navigate('#/favorites');
      await waitFor('document.querySelector(".poster-card")');

      await setViewport(844, 390, 2, true);
      await wait(400);
      const landscape = JSON.parse(await evaluate(`JSON.stringify((() => {
        const view = document.getElementById('view');
        return {
          cards: document.querySelectorAll('.poster-card').length,
          columns: getComputedStyle(document.querySelector('.poster-grid')).gridTemplateColumns.split(' ').length,
          viewScrollWidth: view.scrollWidth,
          viewClientWidth: view.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
          rootClientWidth: document.documentElement.clientWidth,
          tabbar: getComputedStyle(document.querySelector('#tabbar')).display
        };
      })())`));
      if (landscape.viewScrollWidth > landscape.viewClientWidth + 1) throw new Error('内容区横向溢出 ' + JSON.stringify(landscape));
      if (landscape.rootScrollWidth > landscape.rootClientWidth + 1) throw new Error('页面横向溢出 ' + JSON.stringify(landscape));
      if (landscape.tabbar === 'none') throw new Error('横屏底部导航不可见');
      await screenshot('12-收藏-横屏-手机.png');

      await setViewport(1280, 800, 1, false);
      await wait(400);
      const desktop = JSON.parse(await evaluate(`JSON.stringify({
        sidebar: getComputedStyle(document.querySelector('#tabbar')).width,
        viewMargin: getComputedStyle(document.querySelector('#view')).marginLeft,
        header: getComputedStyle(document.querySelector('#app-header')).display
      })`));
      if (desktop.header !== 'none') throw new Error('桌面端不应显示顶栏');
      if (desktop.viewMargin !== '220px') throw new Error('桌面内容区应让出侧栏 ' + desktop.viewMargin);
      await screenshot('13-收藏-桌面.png');

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

/* 端到端检查 + 截图。仅开发使用。 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const BASE = 'http://127.0.0.1:4173/';
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
      const file = path.join(SHOTS, name);
      fs.writeFileSync(file, Buffer.from(data.data, 'base64'));
      return file;
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
      await wait(250);
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

    await setViewport(390, 844, 2, true);
    await send('Page.navigate', { url: BASE + '#/' });
    await waitFor('document.querySelectorAll(".poster-card").length === 11', 15000);
    await wait(900);

    await step('首页启动、片库 11 部、标题在封面上方', async () => {
      const data = JSON.parse(await evaluate(`JSON.stringify({
        posters: document.querySelectorAll('.poster-card').length,
        splashHidden: document.querySelector('#splash').classList.contains('is-hidden'),
        booted: document.documentElement.dataset.booted,
        cardWidth: document.querySelector('.poster-card').getBoundingClientRect().width,
        titleWidth: document.querySelector('.poster-title').getBoundingClientRect().width,
        titleOverflow: getComputedStyle(document.querySelector('.poster-title')).textOverflow,
        lineClamp: getComputedStyle(document.querySelector('.poster-title')).webkitLineClamp,
        pageText: document.querySelector('.page-sub').textContent
      })`));
      if (data.posters !== 11) throw new Error('海报数量 ' + data.posters);
      if (!data.splashHidden || data.booted !== '1') throw new Error('启动页或 booted 标记异常');
      if (data.titleWidth > data.cardWidth + 1) throw new Error('标题比海报宽');
      return data.pageText + '；标题 ' + Math.round(data.titleWidth) + '/' + Math.round(data.cardWidth) + 'px，省略=' + data.titleOverflow + '，行数=' + data.lineClamp;
    });

    let theme = await evaluate('document.documentElement.dataset.theme');
    if (theme !== 'dark') {
      await click('#theme-toggle');
      await wait(200);
    }
    await step('黑夜模式首页截图', async () => {
      const data = JSON.parse(await evaluate(`JSON.stringify({
        mode: document.documentElement.dataset.theme,
        meta: document.querySelector('#meta-theme-color').content,
        status: document.querySelector('#meta-status-bar').content
      })`));
      if (data.mode !== 'dark') throw new Error('当前主题 ' + data.mode);
      if (data.meta !== '#000000' || data.status !== 'black') throw new Error('状态栏配色异常：' + JSON.stringify(data));
      await screenshot('01-首页-黑夜-手机.png');
      return 'theme-color=' + data.meta + '，status-bar=' + data.status;
    });

    await click('#theme-toggle');
    await wait(250);
    await clearToast();
    await step('白天模式首页截图', async () => {
      const data = JSON.parse(await evaluate(`JSON.stringify({
        mode: document.documentElement.dataset.theme,
        meta: document.querySelector('#meta-theme-color').content,
        status: document.querySelector('#meta-status-bar').content,
        stored: localStorage.getItem('ah-theme')
      })`));
      if (data.mode !== 'light') throw new Error('当前主题 ' + data.mode);
      if (data.meta !== '#F5F5F7' || data.status !== 'default') throw new Error('状态栏配色异常：' + JSON.stringify(data));
      await screenshot('02-首页-白天-手机.png');
      return 'meta=' + data.meta + '，status-bar=' + data.status + '，localStorage=' + data.stored;
    });

    await step('长标题两行省略且不超出海报', async () => {
      await navigate('#/');
      await waitFor('document.querySelectorAll(".poster-card").length === 11');
      const raw = await evaluate(`(() => {
        const card = document.querySelector('.poster-card');
        const title = card.querySelector('.poster-title');
        const old = title.textContent;
        title.textContent = '这是一个非常非常长的电影标题用来测试两行省略是否正常工作';
        const cardRect = card.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const style = getComputedStyle(title);
        return JSON.stringify({
          old,
          cardWidth: cardRect.width,
          titleWidth: titleRect.width,
          lineClamp: style.webkitLineClamp,
          overflow: style.overflow,
          scrollHeight: title.scrollHeight,
          clientHeight: title.clientHeight,
          mediaHeights: Array.from(document.querySelectorAll('.poster-media')).map((el) => Math.round(el.getBoundingClientRect().height)),
          cardHeights: Array.from(document.querySelectorAll('.poster-card')).map((el) => Math.round(el.getBoundingClientRect().height)),
          rowGap: getComputedStyle(document.querySelector('.poster-grid')).rowGap
        });
      })()`);
      const data = JSON.parse(raw);
      await screenshot('02b-长标题截断-白天-手机.png');
      await evaluate('document.querySelector(".poster-title").textContent = ' + JSON.stringify(data.old));
      if (data.titleWidth > data.cardWidth + 1) throw new Error('标题超出海报：' + data.titleWidth + ' > ' + data.cardWidth);
      if (String(data.lineClamp) !== '2') throw new Error('行数限制 ' + data.lineClamp);
      if (data.overflow !== 'hidden') throw new Error('overflow=' + data.overflow);
      if (data.scrollHeight <= data.clientHeight) throw new Error('长标题没有被截断');
      return '标题 ' + Math.round(data.titleWidth) + '/' + Math.round(data.cardWidth) + 'px，' + data.lineClamp + ' 行，内容 ' + data.scrollHeight + ' > 可见 ' + data.clientHeight + '；封面高 ' + data.mediaHeights.join('/') + '，卡片高 ' + data.cardHeights.join('/');
    });

    await step('搜索输入、结果与最近搜索', async () => {
      await navigate('#/search');
      await waitFor('document.querySelector("#search-input")');
      await evaluate(`(() => {
        const input = document.querySelector('#search-input');
        input.value = '大雄兔';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(650);
      const count = await evaluate('document.querySelectorAll("#search-results .poster-card").length');
      if (count < 2) throw new Error('搜索结果只有 ' + count + ' 个');
      const url = await evaluate('location.hash');
      if (!url.includes('q=')) throw new Error('搜索 URL 没有 q：' + url);
      await clearToast();
      await screenshot('03-搜索-白天-手机.png');

      await evaluate('document.querySelector("#search-form").requestSubmit()');
      await wait(500);
      await navigate('#/search');
      await waitFor('document.querySelectorAll(".recent-chip").length > 0');
      const recent = await evaluate('Array.from(document.querySelectorAll(".recent-chip")).map((el) => el.textContent)');
      if (!recent.some((text) => text.includes('大雄兔'))) throw new Error('最近搜索没有大雄兔');
      return '结果 ' + count + ' 个；最近搜索 ' + recent.join(' / ');
    });

    await step('跳页弹窗与页码校验', async () => {
      await navigate('#/');
      await waitFor('document.querySelector("[data-action=\\"jump-page\\"]")');
      await click('[data-action="jump-page"]');
      await waitFor('document.querySelector(".dialog")');
      await clearToast();
      await screenshot('03b-跳页弹窗-白天-手机.png');
      await evaluate(`(() => {
        const dialog = document.querySelector('.dialog');
        const input = dialog.querySelector('input');
        input.value = '2';
        dialog.requestSubmit();
      })()`);
      await wait(250);
      const error = await evaluate('document.querySelector(".dialog-error").textContent');
      if (!error.includes('1 到 1')) throw new Error('校验提示：' + error);
      await click('.dialog [data-cancel]');
      return error;
    });

    await step('分页逻辑：30 条 12/页', async () => {
      const data = await evaluate(`import('./js/catalog.js').then((m) => {
        const items = Array.from({ length: 30 }, (_, index) => ({ id: String(index) }));
        const p3 = m.paginate(items, 3, 12);
        const p0 = m.paginate(items, 0, 12);
        const p99 = m.paginate(items, 99, 12);
        return JSON.stringify({ p3: [p3.page, p3.totalPages, p3.items.length, p3.totalItems], p0: p0.page, p99: p99.page });
      })`, true);
      const parsed = JSON.parse(data);
      if (parsed.p3.join(',') !== '3,3,6,30' || parsed.p0 !== 1 || parsed.p99 !== 3) {
        throw new Error(data);
      }
      return JSON.stringify(parsed);
    });

    await step('片库分类筛选', async () => {
      await navigate('#/library');
      await waitFor('document.querySelector(".chip-row")');
      const chips = await evaluate('Array.from(document.querySelectorAll(".chip")).map((el) => el.textContent)');
      const animation = await evaluate(`(() => {
        const chip = Array.from(document.querySelectorAll('.chip')).find((el) => el.textContent.includes('动画'));
        if (!chip) return null;
        return chip.getAttribute('href');
      })()`);
      if (!animation) throw new Error('没有动画分类');
      await navigate(animation);
      await waitFor('document.querySelector(".chip.is-active")');
      const count = await evaluate('document.querySelectorAll(".poster-card").length');
      if (count !== 3) throw new Error('动画分类数量 ' + count);
      return '分类：' + chips.join(' / ') + '；动画 ' + count + ' 部';
    });

    await step('详情页、收藏与收藏页', async () => {
      await navigate('#/title/sintel-trailer');
      await waitFor('document.querySelector(".detail-page")');
      const data = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.detail-title').textContent,
        original: document.querySelector('.detail-original') ? document.querySelector('.detail-original').textContent : '',
        play: document.querySelector('.detail-play').textContent.trim(),
        info: Array.from(document.querySelectorAll('.info-row')).map((row) => row.querySelector('dt').textContent + '=' + row.querySelector('dd').textContent.trim()),
        badge: document.querySelector('.detail-badge') ? document.querySelector('.detail-badge').textContent : ''
      })`));
      if (data.title !== '辛特尔（预告片）') throw new Error('标题 ' + data.title);
      if (!data.info.some((line) => line.startsWith('清晰度'))) throw new Error('缺少清晰度信息');
      await screenshot('04-详情-白天-手机.png');

      await click('.detail-fav[data-action="favorite"]');
      await wait(350);
      const fav = JSON.parse(await evaluate(`JSON.stringify({
        active: document.querySelectorAll('.detail-fav.is-active').length,
        actionText: document.querySelector('.btn.detail-fav').textContent.trim()
      })`));
      if (fav.active !== 2) throw new Error('收藏按钮高亮数量 ' + fav.active);
      if (fav.actionText !== '已收藏') throw new Error('收藏按钮文案 ' + fav.actionText);

      await navigate('#/favorites');
      await waitFor('document.querySelectorAll(".poster-card").length === 1');
      const favTitle = await evaluate('document.querySelector(".poster-title").textContent');
      if (!favTitle.includes('辛特尔')) throw new Error('收藏页标题 ' + favTitle);
      return data.title + '；' + data.play + '；' + data.badge + '；收藏页 ' + favTitle;
    });

    await step('官方平台深链：详情页与无结果搜索', async () => {
      await navigate('#/title/sintel-trailer');
      await waitFor('document.querySelector(".detail-page")');

      const detail = JSON.parse(await evaluate(`JSON.stringify({
        heading: Array.from(document.querySelectorAll('.detail-section h2')).map((el) => el.textContent).includes('在哪看'),
        links: Array.from(document.querySelectorAll('.watch-section .platform-link')).map((a) => ({ name: a.textContent.trim(), href: a.href, target: a.target }))
      })`));

      if (!detail.heading) throw new Error('详情页没有“在哪看”');
      if (detail.links.length !== 5) throw new Error('平台数量 ' + detail.links.length);
      if (detail.links.some((link) => link.target !== '_blank')) throw new Error('平台链接没有新窗口');

      const hosts = detail.links.map((link) => new URL(link.href).host);
      ['so.iqiyi.com', 'v.qq.com', 'so.youku.com', 'so.mgtv.com', 'search.bilibili.com'].forEach((host) => {
        if (!hosts.includes(host)) throw new Error('缺少平台 ' + host + '：' + hosts.join(','));
      });

      await clearToast();
      await screenshot('04b-详情-在哪看-手机.png');

      await navigate('#/search?q=' + encodeURIComponent('绝对不存在的影片 98765'));
      await waitFor('document.querySelector(".platform-search")');

      const search = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.platform-search-title').textContent,
        links: document.querySelectorAll('.platform-search .platform-link').length,
        iqiyi: document.querySelector('.platform-search .platform-link').href
      })`));

      if (search.links !== 5 || !search.title.includes('绝对不存在的影片')) throw new Error(JSON.stringify(search));
      if (!search.iqiyi.includes(encodeURIComponent('绝对不存在的影片'))) throw new Error('搜索词没有编码：' + search.iqiyi);

      await clearToast();
      await screenshot('03c-搜索-官方平台-手机.png');

      return '详情 ' + detail.links.map((link) => link.name).join('/') + '；无结果搜索 ' + search.links + ' 个入口';
    });

    await step('设置默认倍速 1.25× 与主题控件', async () => {
      await navigate('#/settings');
      await waitFor('document.querySelector("#setting-rate")');
      await evaluate(`(() => {
        const select = document.querySelector('#setting-rate');
        select.value = '1.25';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await wait(300);
      await click('[data-action="theme-choice"][data-theme-value="light"]');
      await wait(250);
      await click('[data-action="page-size"][data-size="12"]');
      await wait(200);
      const pageSize12 = await evaluate('document.querySelector("[data-action=\\"page-size\\"].is-active").getAttribute("data-size")');
      await click('[data-action="page-size"][data-size="24"]');
      await wait(200);
      const data = JSON.parse(await evaluate(`JSON.stringify({
        rate: document.querySelector('#setting-rate').value,
        theme: document.documentElement.dataset.theme,
        themeActive: document.querySelector('[data-action="theme-choice"].is-active').getAttribute('data-theme-value'),
        storage: document.querySelector('#storage-usage').textContent,
        pageSize12: ${JSON.stringify(pageSize12)},
        pageSize: document.querySelector('[data-action="page-size"].is-active').getAttribute('data-size')
      })`));
      if (data.rate !== '1.25' || data.theme !== 'light' || data.themeActive !== 'light') throw new Error(JSON.stringify(data));
      if (data.pageSize12 !== '12' || data.pageSize !== '24') throw new Error('每页数量切换异常：' + JSON.stringify(data));
      await clearToast();
      await screenshot('05-设置-白天-手机.png');
      return JSON.stringify(data);
    });

    await step('播放器：480P 元数据、1.25×、播放与暂停', async () => {
      await evaluate(`localStorage.setItem('ah-quality', '480P')`);
      await navigate('#/watch/sintel-trailer');
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        const error = document.querySelector('#player-error');
        return Boolean(video && (video.readyState >= 1 || (error && !error.hidden)));
      })()`, 30000);

      const before = JSON.parse(await evaluate(`JSON.stringify({
        error: !document.querySelector('#player-error').hidden,
        errorText: document.querySelector('#player-error-text').textContent,
        quality: document.querySelector('#player-quality').textContent,
        speed: document.querySelector('#player-speed').textContent,
        src: document.querySelector('#player-video').currentSrc,
        duration: document.querySelector('#player-video').duration,
        rate: document.querySelector('#player-video').playbackRate
      })`));
      if (before.error) throw new Error('片源错误：' + before.errorText);
      if (!before.src.includes('trailer.mp4')) throw new Error('480P 片源不对：' + before.src);
      if (before.speed !== '1.25×') throw new Error('倍速按钮 ' + before.speed);
      if (Math.abs(before.rate - 1.25) > 0.01) throw new Error('播放速率 ' + before.rate);

      const playResult = await evaluate(`(() => {
        const video = document.querySelector('#player-video');
        video.muted = true;
        return video.play().then(() => 'playing').catch((error) => 'play-error: ' + error.message);
      })()`, true);
      if (playResult !== 'playing') throw new Error(playResult);
      await wait(2200);

      const during = JSON.parse(await evaluate(`JSON.stringify({
        time: document.querySelector('#player-video').currentTime,
        paused: document.querySelector('#player-video').paused,
        overlayHidden: document.querySelector('#player-overlay').classList.contains('is-hidden')
      })`));
      if (during.paused || during.time < 0.2) throw new Error('没有在播放：' + JSON.stringify(during));

      await click('[data-paction="toggle"]');
      await wait(400);
      const paused = await evaluate('document.querySelector("#player-video").paused');
      if (!paused) throw new Error('暂停失败');

      await evaluate('document.querySelector("#player-video").currentTime = 20');
      await wait(300);
      await click('[data-paction="rewind"]');
      await wait(450);
      const rewound = await evaluate('document.querySelector("#player-video").currentTime');
      if (rewound < 8 || rewound > 12) throw new Error('后退 10 秒后 ' + rewound);

      await click('[data-paction="forward"]');
      await wait(450);
      const forwarded = await evaluate('document.querySelector("#player-video").currentTime');
      if (forwarded < 18 || forwarded > 22) throw new Error('前进 10 秒后 ' + forwarded);

      const mutedBefore = await evaluate('document.querySelector("#player-video").muted');
      await click('[data-paction="mute"]');
      await wait(200);
      const mutedAfter = await evaluate('document.querySelector("#player-video").muted');
      if (mutedAfter === mutedBefore) throw new Error('静音键没有切换：' + mutedAfter);
      await click('[data-paction="mute"]');
      await wait(200);

      await evaluate('document.querySelector("#player-video").currentTime = 15');
      await wait(600);

      const layout = JSON.parse(await evaluate(`(() => {
        const stage = document.querySelector('#player-stage');
        const video = document.querySelector('#player-video');
        const sr = stage.getBoundingClientRect();
        const vr = video.getBoundingClientRect();
        const style = getComputedStyle(video);
        return JSON.stringify({
          dpr: devicePixelRatio,
          inner: [innerWidth, innerHeight],
          stage: [sr.x, sr.y, sr.width, sr.height],
          rect: [vr.x, vr.y, vr.width, vr.height],
          intrinsic: [video.videoWidth, video.videoHeight],
          css: [style.width, style.height, style.objectFit],
          transform: style.transform
        });
      })()`));
      return '时长 ' + Math.round(before.duration) + 's；播放到 ' + during.time.toFixed(1) + 's；已暂停；切到 15s；布局 ' + JSON.stringify(layout);
    });

    await step('清晰度切到 720P 并保留进度', async () => {
      await click('[data-paction="quality"]');
      await waitFor('document.querySelector(".sheet")');
      await screenshot('07-清晰度面板-白天-手机.png');
      await evaluate(`document.querySelector('.sheet-option[data-value="1"]').click()`);
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        return video.currentSrc.includes('720p') && video.readyState >= 1;
      })()`, 30000);
      await wait(500);
      const data = JSON.parse(await evaluate(`JSON.stringify({
        quality: document.querySelector('#player-quality').textContent,
        src: document.querySelector('#player-video').currentSrc,
        time: document.querySelector('#player-video').currentTime,
        rate: document.querySelector('#player-video').playbackRate,
        paused: document.querySelector('#player-video').paused
      })`));
      if (data.quality !== '720P') throw new Error('清晰度按钮 ' + data.quality);
      if (!data.src.includes('720p')) throw new Error('片源 ' + data.src);
      if (data.time < 10) throw new Error('切换后进度丢失：' + data.time);
      if (Math.abs(data.rate - 1.25) > 0.01) throw new Error('切清晰度后倍速丢失：' + data.rate);
      await clearToast();
      await wait(250);
      await screenshot('06-播放器-白天-手机.png');
      return '720P，进度 ' + data.time.toFixed(1) + 's，倍速 ' + data.rate + '×';
    });

    await step('倍速切到 1.5×', async () => {
      await click('[data-paction="speed"]');
      await waitFor('document.querySelector(".sheet")');
      await evaluate(`document.querySelector('.sheet-option[data-value="1.5"]').click()`);
      await wait(300);
      const data = JSON.parse(await evaluate(`JSON.stringify({
        label: document.querySelector('#player-speed').textContent,
        rate: document.querySelector('#player-video').playbackRate
      })`));
      if (data.label !== '1.5×' || Math.abs(data.rate - 1.5) > 0.01) throw new Error(JSON.stringify(data));
      return JSON.stringify(data);
    });

    await step('播放器横屏 / 竖屏切换', async () => {
      const initial = JSON.parse(await evaluate(`JSON.stringify({
        button: Boolean(document.querySelector('#player-rotate')),
        pressed: document.querySelector('#player-rotate').getAttribute('aria-pressed'),
        landscape: document.querySelector('#player-page').classList.contains('is-landscape')
      })`));
      if (!initial.button || initial.pressed !== 'false' || initial.landscape) throw new Error('初始方向异常：' + JSON.stringify(initial));

      await click('#player-rotate');
      await wait(400);
      const landscape = JSON.parse(await evaluate(`(() => {
        const page = document.querySelector('#player-page');
        const stage = document.querySelector('#player-stage');
        const rect = stage.getBoundingClientRect();
        return JSON.stringify({
          landscape: page.classList.contains('is-landscape'),
          pressed: document.querySelector('#player-rotate').getAttribute('aria-pressed'),
          label: document.querySelector('#player-rotate').getAttribute('aria-label'),
          stage: [Math.round(rect.width), Math.round(rect.height)],
          offset: [stage.offsetWidth, stage.offsetHeight],
          transform: getComputedStyle(stage).transform,
          stored: sessionStorage.getItem('ah-player-landscape')
        });
      })()`));
      if (!landscape.landscape || landscape.pressed !== 'true' || landscape.stored !== '1') throw new Error('横屏状态异常：' + JSON.stringify(landscape));
      if (landscape.offset[0] <= landscape.offset[1]) throw new Error('横屏尺寸没有交换：' + JSON.stringify(landscape.offset));
      if (!landscape.transform || landscape.transform === 'none') throw new Error('没有旋转：' + landscape.transform);
      if (landscape.stage[0] !== 390 || landscape.stage[1] !== 844) throw new Error('横屏没有铺满视口：' + JSON.stringify(landscape.stage));
      await clearToast();
      await screenshot('06b-播放器-横屏-手机.png');

      await click('#player-rotate');
      await wait(400);
      const portrait = JSON.parse(await evaluate(`JSON.stringify({
        landscape: document.querySelector('#player-page').classList.contains('is-landscape'),
        pressed: document.querySelector('#player-rotate').getAttribute('aria-pressed'),
        stored: sessionStorage.getItem('ah-player-landscape')
      })`));
      if (portrait.landscape || portrait.pressed !== 'false' || portrait.stored) throw new Error('恢复竖屏失败：' + JSON.stringify(portrait));
      await clearToast();
      return '横屏容器 ' + landscape.offset.join('×') + '，变换=' + landscape.transform + '；已恢复竖屏';
    });

    await step('断点续播与观看历史', async () => {
      await evaluate(`(() => {
        const video = document.querySelector('#player-video');
        video.currentTime = 18;
        video.pause();
      })()`);
      await wait(600);

      await navigate('#/title/sintel-trailer');
      await waitFor('document.querySelector(".detail-page")');
      const note = await evaluate(`document.querySelector('.detail-progress-note') ? document.querySelector('.detail-progress-note').textContent.trim() : ''`);
      if (!note.includes('0:18')) throw new Error('详情页进度提示 ' + note);

      await navigate('#/watch/sintel-trailer');
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
      if (!historyText.includes('辛特尔')) throw new Error('历史记录 ' + historyText);
      await screenshot('08-历史-白天-手机.png');
      return '续播 ' + resumed.toFixed(1) + 's；' + historyText;
    });

    await step('详情页进入播放器，返回键回到详情', async () => {
      await navigate('#/title/sintel-trailer');
      await waitFor('document.querySelector(".detail-page")');
      const href = await evaluate('document.querySelector(".detail-play").getAttribute("href")');
      await evaluate('document.querySelector(".detail-play").click()');
      await waitFor('document.querySelector("#player-video")');
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        const error = document.querySelector('#player-error');
        return Boolean(video && (video.readyState >= 1 || (error && !error.hidden)));
      })()`, 30000);
      await click('[data-paction="back"]');
      await waitFor('document.querySelector(".detail-page")');
      const title = await evaluate('document.querySelector(".detail-title").textContent');
      if (title !== '辛特尔（预告片）') throw new Error('返回到了 ' + title);
      return '播放链接 ' + href + '；返回后仍是 ' + title;
    });

    await step('备份导出与导入界面', async () => {
      await navigate('#/settings');
      await waitFor('document.querySelector("#import-file")');

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

      const toast = await evaluate('document.querySelector("#toast").textContent');
      const state = JSON.parse(await evaluate(`import('./js/store.js').then((m) => m.exportData()).then((data) => JSON.stringify({
        progress: data.progress.length,
        favorites: data.favorites.length,
        rate: data.settings.defaultRate
      }))`, true));
      if (state.progress !== 1 || state.favorites !== 1) throw new Error('导入后数据 ' + JSON.stringify(state));
      return '备份 ' + payloadLength + ' 字节；' + toast + '；' + JSON.stringify(state);
    });

    await step('B 站嵌入式播放器与观看记录', async () => {
      await navigate('#/title/the-general');
      await waitFor('document.querySelector(".detail-page")');
      const detail = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.detail-title').textContent,
        play: document.querySelector('.detail-play').textContent.trim(),
        info: Array.from(document.querySelectorAll('.info-row')).map((row) => row.querySelector('dt').textContent + '=' + row.querySelector('dd').textContent.trim()),
        note: document.querySelector('.detail-embed-note') ? document.querySelector('.detail-embed-note').textContent : ''
      })`));
      if (detail.title !== '将军号') throw new Error('标题 ' + detail.title);
      if (!detail.play.includes('B 站')) throw new Error('播放按钮 ' + detail.play);
      if (!detail.info.some((line) => line.includes('哔哩哔哩官方嵌入式播放器'))) throw new Error('缺少播放方式');
      if (!detail.info.some((line) => line.startsWith('上传者'))) throw new Error('缺少上传者');
      if (!detail.note.includes('不转存')) throw new Error('缺少嵌入说明');
      await clearToast();
      await wait(250);
      await screenshot('08a-详情-将军号-手机.png');

      await evaluate('document.querySelector(".detail-play").click()');
      await waitFor('document.querySelector(".embed-page iframe.embed-frame")');
      await wait(600);

      const player = JSON.parse(await evaluate(`JSON.stringify({
        src: document.querySelector('.embed-frame').src,
        rect: (() => {
          const r = document.querySelector('.embed-frame').getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        })(),
        external: document.querySelector('.embed-open') ? document.querySelector('.embed-open').getAttribute('href') : ''
      })`));
      if (!player.src.includes('player.bilibili.com/player.html?bvid=BV1er421H7UC')) throw new Error('播放器地址 ' + player.src);
      if (player.rect[0] < 300 || player.rect[1] < 300) throw new Error('播放器尺寸 ' + player.rect);
      if (!player.external.includes('bilibili.com/video/BV1er421H7UC')) throw new Error('B 站链接 ' + player.external);
      if (failedRequests.some((entry) => entry.includes('ERR_BLOCKED_BY_CSP'))) {
        throw new Error('CSP 拦截了 B 站播放器：' + failedRequests.filter((entry) => entry.includes('CSP')).join('；'));
      }

      const opened = JSON.parse(await evaluate(`import('./js/store.js').then((m) => JSON.stringify({
        record: m.getProgress('the-general', null),
        history: m.latestProgressList().some((row) => row.itemId === 'the-general' && row.external === true)
      }))`, true));
      if (!opened.record || opened.record.external !== true || opened.record.time !== 0) throw new Error('外部观看记录 ' + JSON.stringify(opened));
      if (!opened.history) throw new Error('历史里没有 B 站记录');

      await clearToast();
      await wait(300);
      await screenshot('08b-播放器-B站嵌入-手机.png');

      await click('[data-paction="back"]');
      await waitFor('document.querySelector(".detail-page")');
      const backTitle = await evaluate('document.querySelector(".detail-title").textContent');
      if (backTitle !== '将军号') throw new Error('返回到了 ' + backTitle);
      return detail.play + '；' + player.rect.join('×') + '；' + player.src;
    });

    await step('关于页与授权列表', async () => {
      await navigate('#/about');
      await waitFor('document.querySelector(".about-page")');
      const data = JSON.parse(await evaluate(`JSON.stringify({
        licenses: document.querySelectorAll('.license-list li').length,
        boundary: document.body.textContent.includes('不接入盗版站'),
        brand: Boolean(document.querySelector('.brand-preview .brand-mark'))
      })`));
      if (data.licenses < 2 || !data.boundary || !data.brand) throw new Error(JSON.stringify(data));
      await screenshot('09-关于-白天-手机.png');
      return JSON.stringify(data);
    });

    await step('我的页与安装提示', async () => {
      await navigate('#/me');
      await waitFor('document.querySelector(".profile-card")');
      const data = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.profile-name').textContent,
        stats: Array.from(document.querySelectorAll('.stat')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
        tip: document.querySelector('.tip-card p').textContent,
        installHidden: document.querySelector('#install-button') ? document.querySelector('#install-button').hidden : null
      })`));
      if (data.title !== 'AH 影视' || !data.tip) throw new Error(JSON.stringify(data));
      await screenshot('10-我的-白天-手机.png');
      return data.stats.join('；') + '；安装按钮隐藏=' + data.installHidden;
    });

    await step('Service Worker 与 manifest', async () => {
      await wait(1200);
      const data = JSON.parse(await evaluate(`(async () => {
        const sw = await navigator.serviceWorker.getRegistration()
          .then((registration) => registration ? Boolean(registration.active || registration.installing || registration.waiting) : false)
          .catch(() => false);
        const response = await fetch('./manifest.webmanifest');
        const manifest = await response.json();
        const icon = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('图标加载失败'));
          image.src = './icons/icon-512.png?check=' + Date.now();
        });
        const canvas = document.createElement('canvas');
        canvas.width = icon.naturalWidth;
        canvas.height = icon.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(icon, 0, 0);
        const corner = Array.from(context.getImageData(2, 2, 1, 1).data);
        const center = Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
        const keys = await caches.keys();
        return JSON.stringify({
          sw,
          manifest: response.status,
          caches: keys,
          maskable: manifest.icons.some((entry) => entry.purpose === 'maskable' && entry.src.includes('icon-maskable-512.png')),
          iconSize: [icon.naturalWidth, icon.naturalHeight],
          corner,
          center
        });
      })()`, true));
      if (!data.sw) throw new Error('Service Worker 没有注册');
      if (data.manifest !== 200) throw new Error('manifest 状态 ' + data.manifest);
      if (!data.caches.includes('ah-cinema-v5')) throw new Error('缓存 ' + JSON.stringify(data.caches));
      if (!data.maskable) throw new Error('manifest 缺少独立 maskable 图标');
      if (data.iconSize[0] !== 512 || data.iconSize[1] !== 512) throw new Error('图标尺寸 ' + data.iconSize);
      if (data.corner[0] !== 201 || data.corner[1] !== 47 || data.corner[2] !== 54) throw new Error('图标底色不是品牌红：' + data.corner);
      if (data.center[0] !== 255 || data.center[1] !== 255 || data.center[2] !== 255) throw new Error('图标标记不是白色：' + data.center);
      return JSON.stringify(data);
    });

    await step('断网重载仍能打开片库', async () => {
      await send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0
      });
      await send('Page.reload', { ignoreCache: false });
      await waitFor('document.documentElement.dataset.booted === "1"', 20000);
      await navigate('#/');
      await waitFor('document.querySelectorAll(".poster-card").length === 11', 20000);
      const data = JSON.parse(await evaluate(`JSON.stringify({
        posters: document.querySelectorAll('.poster-card').length,
        images: Array.from(document.querySelectorAll('.poster-media img')).map((img) => img.complete && img.naturalWidth > 0),
        catalog: document.querySelector('.page-sub').textContent,
        theme: document.documentElement.dataset.theme
      })`));
      await send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: 100000000,
        uploadThroughput: 100000000
      });
      await send('Page.reload', { ignoreCache: false });
      await waitFor('document.querySelectorAll(".poster-card").length === 11', 20000);
      if (data.posters !== 11 || data.images.length !== 11 || data.images.some((ok) => !ok)) throw new Error(JSON.stringify(data));
      return JSON.stringify(data);
    });

    await step('手机横屏布局', async () => {
      await setViewport(844, 390, 2, true);
      await navigate('#/');
      await waitFor('document.querySelectorAll(".poster-card").length === 11');
      await wait(400);
      const data = JSON.parse(await evaluate(`JSON.stringify({
        inner: [innerWidth, innerHeight],
        posters: document.querySelectorAll('.poster-card').length,
        columns: getComputedStyle(document.querySelector('.poster-grid')).gridTemplateColumns.split(' ').length,
        overflow: document.documentElement.scrollWidth - innerWidth,
        tabbar: getComputedStyle(document.querySelector('#tabbar')).display,
        titleWidth: Math.round(document.querySelector('.poster-title').getBoundingClientRect().width),
        cardWidth: Math.round(document.querySelector('.poster-card').getBoundingClientRect().width)
      })`));
      if (data.inner[0] !== 844 || data.inner[1] !== 390) throw new Error('横屏视口异常：' + JSON.stringify(data.inner));
      if (data.posters !== 11 || data.columns < 4) throw new Error('横屏网格异常：' + JSON.stringify(data));
      if (data.overflow > 1) throw new Error('横屏出现横向溢出：' + data.overflow);
      if (data.tabbar === 'none') throw new Error('横屏底部导航不可见');
      if (data.titleWidth > data.cardWidth + 1) throw new Error('横屏标题超出海报');
      await clearToast();
      await screenshot('12-首页-横屏-手机.png');
      return JSON.stringify(data);
    });

    await step('桌面侧栏与黑夜首页截图', async () => {
      await setViewport(1280, 900, 1, false);
      await navigate('#/');
      await waitFor('document.querySelectorAll(".poster-card").length === 11');
      const mode = await evaluate('document.documentElement.dataset.theme');
      if (mode !== 'dark') {
        await click('#theme-toggle');
        await wait(250);
      }
      const layout = JSON.parse(await evaluate(`JSON.stringify({
        header: getComputedStyle(document.querySelector('#app-header')).display,
        tabbar: getComputedStyle(document.querySelector('#tabbar')).display,
        sidebarWidth: document.querySelector('#tabbar').getBoundingClientRect().width,
        viewMargin: getComputedStyle(document.querySelector('#view')).marginLeft,
        columns: getComputedStyle(document.querySelector('.poster-grid')).gridTemplateColumns.split(' ').length
      })`));
      if (layout.header !== 'none') throw new Error('桌面顶栏没有隐藏');
      if (layout.tabbar === 'none') throw new Error('桌面侧栏没有显示');
      if (layout.sidebarWidth !== 220) throw new Error('侧栏宽度 ' + layout.sidebarWidth);
      await clearToast();
      await screenshot('11-首页-黑夜-桌面.png');
      return JSON.stringify(layout);
    });

    await step('我的视频：添加直链、播放与移除', async () => {
      await setViewport(390, 844, 2, true);
      await navigate('#/local');
      await waitFor('document.querySelector(".local-page")');
      await waitFor('document.querySelector(".local-empty-actions")');
      await clearToast();
      await screenshot('10a-我的视频-空-手机.png');

      await click('[data-action="local-add-url"]');
      await submitDialog('https://media.w3.org/2010/05/sintel/trailer.mp4');
      await submitDialog('测试直链视频');

      await waitFor('document.querySelector(".detail-page")');
      const detail = JSON.parse(await evaluate(`JSON.stringify({
        title: document.querySelector('.detail-title').textContent,
        badge: document.querySelector('.detail-badge') ? document.querySelector('.detail-badge').textContent : '',
        info: Array.from(document.querySelectorAll('.info-row')).map((row) => row.querySelector('dt').textContent + '=' + row.querySelector('dd').textContent.trim()),
        watch: Boolean(document.querySelector('.watch-section'))
      })`));

      if (detail.title !== '测试直链视频') throw new Error('标题 ' + detail.title);
      if (detail.badge !== '网址') throw new Error('标记 ' + detail.badge);
      if (!detail.info.includes('片源=网络地址')) throw new Error('片源信息 ' + JSON.stringify(detail.info));
      if (!detail.info.some((line) => line.startsWith('来源=media.w3.org'))) throw new Error('来源信息 ' + JSON.stringify(detail.info));
      if (detail.watch) throw new Error('自有视频不应显示“在哪看”');

      await clearToast();
      await screenshot('10b-详情-我的视频-手机.png');

      await click('.detail-play');
      await waitFor('document.querySelector("#player-video")');
      await waitFor(`(() => {
        const video = document.querySelector('#player-video');
        const error = document.querySelector('#player-error');
        return Boolean(video && (video.readyState >= 1 || (error && !error.hidden)));
      })()`, 30000);

      const player = JSON.parse(await evaluate(`JSON.stringify({
        src: document.querySelector('#player-video').currentSrc,
        error: !document.querySelector('#player-error').hidden,
        errorText: document.querySelector('#player-error-text').textContent,
        quality: document.querySelector('#player-quality').textContent
      })`));

      if (player.error) throw new Error('直链播放错误：' + player.errorText);
      if (!player.src.includes('media.w3.org/2010/05/sintel/trailer.mp4')) throw new Error('播放地址 ' + player.src);
      if (player.quality !== '原始') throw new Error('清晰度按钮 ' + player.quality);

      await clearToast();
      await screenshot('10c-播放器-我的视频-手机.png');

      await navigate('#/local');
      await waitFor('document.querySelector(".local-row")');
      const rowText = await evaluate('document.querySelector(".local-row").textContent');
      if (!rowText.includes('测试直链视频')) throw new Error('列表文本 ' + rowText);

      await click('.local-row [data-action="remove-local"]');
      await waitFor('document.querySelector(".dialog")');
      await click('.dialog [data-confirm]');
      await waitFor('document.querySelector(".local-empty-actions")');

      const left = await evaluate(`import('./js/db.js').then((m) => m.getAll('custom')).then((rows) => rows.length)`, true);
      if (left !== 0) throw new Error('移除后还剩 ' + left + ' 条');

      return detail.title + '；' + player.src + '；已移除';
    });

    await step('我的视频：本机文件写入 IndexedDB', async () => {
      const fixture = path.join(process.env.TEMP || 'C:/Windows/Temp', 'ah-cdp-local-' + process.pid + '.mp4');
      fs.writeFileSync(fixture, Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
        0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
      ]));

      try {
        await navigate('#/local');
        await waitFor('document.querySelector("#local-file-input")');
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
          return JSON.stringify(record ? {
            title: record.title,
            size: record.size,
            isBlob: record.blob instanceof Blob
          } : null);
        })`, true));

        if (!stored || !stored.isBlob || stored.size !== 32) throw new Error('IndexedDB 记录 ' + JSON.stringify(stored));

        await send('Page.reload', { ignoreCache: false });
        await waitFor('document.documentElement.dataset.booted === "1"', 20000);
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

        return detail.title + '；' + stored.size + ' 字节；Blob 已写入并移除';
      } finally {
        try {
          fs.rmSync(fixture, { force: true });
        } catch (error) {
          /* 忽略。 */
        }
      }
    });

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

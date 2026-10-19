/* 临时冒烟测试：源管理 + 多源搜索 + 详情 + 播放。仅开发使用。 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const BASE = process.env.AH_BASE || 'http://127.0.0.1:4191/';
const CMS = process.env.AH_MOCK_CMS || 'http://127.0.0.1:4180';
const PROFILE = path.join(process.env.TEMP || 'C:/Windows/Temp', 'ah-smoke-remote-' + process.pid);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(results, name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const results = [];
  const errors = [];

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((entry) => entry.type === 'page') || null;
      } catch (error) { /* wait */ }
      if (!target) await wait(200);
    }
    if (!target) throw new Error('chrome not reachable');

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
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        errors.push((details.exception && details.exception.description) || details.text);
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        errors.push('log: ' + message.params.entry.text);
      }
    };

    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');

    async function evaluate(expression, awaitPromise = false) {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text);
      }
      return response.result ? response.result.value : undefined;
    }

    async function waitFor(expression, timeout = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return true;
        await wait(150);
      }
      return false;
    }

    async function addSource(name, url) {
      await evaluate('document.querySelector("[data-action=source-add]").click()');
      await waitFor('!document.querySelector("#source-form").hidden');
      await evaluate(`
        document.querySelector('#source-name').value = ${JSON.stringify(name)};
        document.querySelector('#source-url').value = ${JSON.stringify(url)};
        document.querySelector('#source-authorized').checked = true;
        document.querySelector('#source-form').requestSubmit();
      `);
    }

    await send('Page.navigate', { url: BASE + '#/sources' });
    record(results, '源管理页打开', await waitFor('Boolean(document.querySelector(".sources-page"))'));
    await wait(500);

    record(results, '默认没有内置源', await evaluate('document.body.innerText.includes("没有内置源")'));

    const before = await evaluate('document.querySelectorAll("[data-source-row]").length');
    await addSource('源A', CMS + '/api.php/provide/vod');
    record(results, '添加源 A', await waitFor(`document.querySelectorAll('[data-source-row]').length === ${before + 1}`));
    await wait(800);

    await addSource('源B', CMS + '/api2.php/provide/vod');
    record(results, '添加源 B', await waitFor(`document.querySelectorAll('[data-source-row]').length === ${before + 2}`));
    await wait(1200);

    await addSource('源C XML', CMS + '/api3.php/provide/vod/at/xml/');
    record(results, '添加 XML 源 C', await waitFor(`document.querySelectorAll('[data-source-row]').length === ${before + 3}`));
    await wait(1200);

    const statusText = await evaluate('document.querySelector("[data-source-status]")?.innerText || ""');
    record(results, '源测活显示结果', /可用|条|失败|错误/.test(statusText), statusText);

    await send('Page.navigate', { url: BASE + '#/' });
    record(results, '首页显示源影片', await waitFor('Boolean(document.querySelector("#home-browse .remote-card"))', 20000));
    record(results, '首页不再有粘贴链接框', !(await evaluate('Boolean(document.querySelector("#link-form"))')));
    const homeCards = await evaluate('document.querySelectorAll("#home-browse .remote-card").length');
    record(results, '首页片库有影片卡片', homeCards > 0, String(homeCards));
    record(results, '卡片显示备注', await evaluate(
      `Array.from(document.querySelectorAll('#home-browse .remote-card')).some((card) => /CC0 短片|更新至 2 集/.test(card.textContent))`
    ));

    record(results, '首页显示一级分类', await waitFor(
      'document.querySelectorAll("#browse-top-categories .category-chip").length >= 4',
      10000
    ));
    const topCategories = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('#browse-top-categories .category-chip')).map((chip) => chip.textContent.trim()))`
    );
    const topNames = JSON.parse(topCategories);
    record(results, '一级分类含电影/电视剧/动漫/综艺/纪录片',
      ['电影', '电视剧', '动漫', '综艺', '纪录片'].every((name) => topNames.includes(name)),
      topCategories);
    record(results, '分类不含成人分类', !topNames.includes('伦理片') && !topCategories.includes('伦理片'), topCategories);

    record(results, '首页显示约数与页码', await waitFor(
      `Boolean(document.querySelector('#home-browse .browse-count')) &&
       Boolean(document.querySelector('#home-browse .browse-filter-meta'))`,
      10000
    ));
    const countText = await evaluate('document.querySelector("#home-browse .browse-count")?.textContent || ""');
    record(results, '显示约 N 部', /约\s*[\d,]+\s*部/.test(countText), countText);

    record(results, '首页显示分页器', await waitFor(
      'Boolean(document.querySelector("#home-browse .browse-pager"))',
      10000
    ));
    const firstPage = await evaluate('document.querySelector("#home-browse .browse-page-status")?.textContent || ""');
    record(results, '默认第 1 页', /第 1 \/ \d+ 页/.test(firstPage), firstPage);
    record(results, '页数不再固定 20 页', /第 1 \/ (2[1-9]|[3-9]\d|\d{3,}) 页/.test(firstPage), firstPage);

    await evaluate('document.querySelector("#home-browse [data-action=browse-next]").click()');
    record(results, '翻到第 2 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 2 /')`,
      10000
    ));
    const secondPageCards = await evaluate('document.querySelectorAll("#home-browse .remote-card").length');
    record(results, '第 2 页有影片', secondPageCards > 0, String(secondPageCards));

    await evaluate('document.querySelector("#home-browse [data-action=browse-prev]").click()');
    record(results, '回到第 1 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 1 /')`,
      10000
    ));

    await evaluate(
      `Array.from(document.querySelectorAll('#browse-top-categories .category-chip')).find((chip) => chip.textContent.trim() === '电影').click()`
    );
    record(results, '打开电影显示子分类', await waitFor(
      'Boolean(document.querySelector("#browse-sub-categories"))',
      10000
    ));
    const subCategories = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('#browse-sub-categories .category-chip')).map((chip) => chip.textContent.trim()))`
    );
    const subNames = JSON.parse(subCategories);
    record(results, '电影子分类含动作', subNames.includes('动作'), subCategories);
    record(results, '超长分类有展开按钮', await evaluate(
      `Boolean(document.querySelector('.browse-filter-row[data-row=sub] [data-action=browse-expand]'))`
    ), subCategories);

    /* 用手机宽度检查分类行是否真的产生横向滚动，而不是被裁掉。 */
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await wait(300);
    const subMetrics = await evaluate(`(() => {
      const row = document.querySelector('#browse-sub-categories');
      const start = row.scrollLeft;
      row.scrollLeft = 100000;
      const max = row.scrollLeft;
      row.scrollLeft = start;
      return JSON.stringify({ scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, max });
    })()`);
    await send('Emulation.clearDeviceMetricsOverride');
    const subScroll = JSON.parse(subMetrics);
    record(results, '子分类行可横向滑动', subScroll.scrollWidth > subScroll.clientWidth && subScroll.max > 0, subMetrics);

    await evaluate(
      `Array.from(document.querySelectorAll('#browse-sub-categories .category-chip')).find((chip) => chip.textContent.trim() === '动作').click()`
    );
    record(results, '动作分类首屏 4 部', await waitFor(
      'document.querySelectorAll("#home-browse .remote-card").length === 4',
      10000
    ));
    const actionPage = await evaluate('document.querySelector("#home-browse .browse-page-status")?.textContent || ""');
    record(results, '动作分类回到第 1 页', actionPage.includes('第 1 / 2 页'), actionPage);

    await evaluate('document.querySelector("#home-browse [data-action=browse-next]").click()');
    record(results, '动作分类翻到第 2 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 2 / 2 页')`,
      10000
    ));
    const actionSecond = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('#home-browse .remote-card')).map((card) => card.textContent))`
    );
    record(results, '动作分类第 2 页仍是动作片', JSON.parse(actionSecond).length === 4 && /动作测试/.test(actionSecond), actionSecond.slice(0, 120));

    await evaluate('document.querySelector(".browse-filter-row[data-row=sub] [data-action=browse-expand]").click()');
    record(results, '展开全部分类网格', await waitFor('Boolean(document.querySelector("#browse-category-panel .category-cell"))', 5000));
    await evaluate(
      `Array.from(document.querySelectorAll('#browse-category-panel .category-cell')).find((option) => option.textContent.trim().startsWith('长尾测试')).click()`
    );
    record(results, '长尾分类共 25 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 1 / 25 页')`,
      10000
    ));

    await evaluate('document.querySelector("#home-browse [data-action=browse-jump]").click()');
    record(results, '跳转对话框打开', await waitFor('Boolean(document.querySelector(".dialog input"))', 5000));
    await evaluate(
      `document.querySelector('.dialog input').value = '21'; document.querySelector('.dialog').requestSubmit();`
    );
    record(results, '跳转到第 21 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 21 / 25 页') && document.querySelector('#home-browse .remote-grid')?.textContent.includes('长尾影片 81')`,
      10000
    ));
    const longTail = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('#home-browse .remote-card')).map((card) => card.textContent))`
    );
    record(results, '第 21 页是长尾影片', /长尾影片 8[1-4]/.test(longTail), longTail.slice(0, 160));

    await evaluate('document.querySelector(".browse-filter-row[data-row=sub] [data-action=browse-expand]").click()');
    await waitFor('Boolean(document.querySelector("#browse-category-panel .category-cell"))', 5000);
    await evaluate(
      `Array.from(document.querySelectorAll('#browse-category-panel .category-cell')).find((option) => option.textContent.trim().startsWith('XML测试')).click()`
    );
    record(results, 'XML 源分类可浏览', await waitFor(
      `Array.from(document.querySelectorAll('#home-browse .remote-card')).some((card) => card.textContent.includes('XML 专属影片'))`,
      10000
    ));

    await evaluate(
      `Array.from(document.querySelectorAll('#browse-top-categories .category-chip')).find((chip) => chip.textContent.trim() === '全部').click()`
    );
    record(results, '切回全部恢复第 1 页', await waitFor(
      `document.querySelector('#home-browse .browse-filter-meta')?.textContent.includes('第 1 /')`,
      10000
    ));

    await evaluate('document.querySelector("#home-browse .remote-card").click()');
    if (await waitFor('Boolean(document.querySelector(".sheet [data-value]"))', 3000)) {
      await evaluate('document.querySelector(".sheet [data-value]").click()');
    }
    record(results, '首页卡片进入详情', await waitFor('Boolean(document.querySelector(".detail-page"))', 20000));

    await send('Page.navigate', { url: BASE + '#/search?q=Big' });
    record(results, '看到网络结果卡片', await waitFor('Boolean(document.querySelector(".remote-card"))', 20000));

    const groups = await evaluate('document.querySelectorAll(".remote-card").length');
    const chips = await evaluate('document.querySelectorAll(".remote-chip").length');
    const badge = await evaluate('document.querySelector(".remote-card .poster-badge")?.textContent || ""');
    record(results, '多个源按标题合并为一组', groups === 1 && chips === 3, `卡片 ${groups} / 状态 ${chips}`);
    record(results, '显示多来源数量', badge.includes('2 个来源'), badge);

    await evaluate('document.querySelector(".remote-card").click()');
    record(results, '多来源弹出选源', await waitFor('Boolean(document.querySelector(".sheet [data-value]"))'));
    await evaluate('document.querySelector(".sheet [data-value]").click()');
    record(results, '进入远程详情', await waitFor('Boolean(document.querySelector(".detail-page"))', 20000));

    const title = await evaluate('document.querySelector(".detail-title")?.textContent || ""');
    record(results, '详情标题正确', title.includes('Big Buck Bunny'), title);

    const refresh = await evaluate('Boolean(document.querySelector("[data-action=refresh-remote]"))');
    record(results, '详情显示刷新片源', refresh);

    await evaluate('document.querySelector(".detail-play").click()');
    record(results, '进入播放页', await waitFor('Boolean(document.querySelector("#player-video"))'));
    record(results, '视频拿到代理地址', await waitFor('(document.querySelector("#player-video")?.currentSrc || "").includes("/api/proxy")', 20000));

    const playState = await evaluate(`(() => {
      const video = document.querySelector('#player-video');
      return JSON.stringify({
        src: (video.currentSrc || '').slice(0, 90),
        readyState: video.readyState,
        error: video.error ? video.error.code : 0
      });
    })()`);
    console.log('video:', playState);
    record(results, '视频未报错', !/"error":[1-9]/.test(playState), playState);

    await send('Page.navigate', { url: BASE + '#/search?q=示例' });
    record(results, '剧集搜索结果出现', await waitFor('Boolean(document.querySelector(".remote-card"))', 20000));
    await evaluate('document.querySelector(".remote-card").click()');
    record(results, '进入剧集详情', await waitFor('Boolean(document.querySelector(".detail-page"))', 20000));
    const episodeCount = await evaluate('document.querySelectorAll(".episode-btn").length');
    record(results, '解析出两集', episodeCount === 2, String(episodeCount));

    await evaluate('document.querySelectorAll(".episode-btn")[1].click()');
    record(results, '进入第二集播放页', await waitFor('Boolean(document.querySelector("#player-video"))'));
    record(results, '第二集拿到片源', await waitFor('(document.querySelector("#player-video")?.currentSrc || "").includes("/api/proxy")', 20000));
    await evaluate('document.querySelector("#player-quality").click()');
    record(results, '多线路可选', await waitFor('document.querySelectorAll(".sheet [data-value]").length === 2'));
    await evaluate('document.querySelector(".sheet [data-cancel]").click()');

    await send('Page.navigate', { url: BASE + '#/search?q=XML' });
    record(results, 'XML 搜索出结果', await waitFor('Boolean(document.querySelector(".remote-card"))', 20000));
    const xmlCards = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('.remote-card')).map((card) => card.textContent))`
    );
    record(results, 'XML 搜索返回两部', JSON.parse(xmlCards).length === 2, xmlCards.slice(0, 160));

    await evaluate('document.querySelector(".remote-card").click()');
    record(results, 'XML 详情页打开', await waitFor('Boolean(document.querySelector(".detail-page"))', 20000));
    const xmlTitle = await evaluate('document.querySelector(".detail-title")?.textContent || ""');
    record(results, 'XML 详情标题正确', xmlTitle.includes('XML'), xmlTitle);
    record(results, 'XML 详情解析简介', await evaluate(
      `Boolean(document.querySelector(".detail-page .synopsis"))`
    ));

    await send('Page.navigate', { url: BASE + '#/search?q=不应出现' });
    await wait(3000);
    const filtered = await evaluate('document.querySelectorAll(".remote-card").length');
    const filteredHint = await evaluate('Boolean(document.querySelector(".remote-empty"))');
    record(results, '服务端过滤明显成人分类', filtered === 0 && filteredHint, `卡片 ${filtered}`);

    record(results, '没有未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));

    await send('Page.navigate', { url: 'about:blank' });
  } finally {
    try { chrome.kill(); } catch (error) { /* ignore */ }
    await wait(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }

  const failed = results.filter((entry) => !entry.pass);
  console.log(failed.length ? `SMOKE FAIL（${failed.length} 项）` : 'SMOKE PASS');
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

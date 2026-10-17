/* 源管理页交互：源/订阅增删改、连接检测、导入导出。 */

import { state, saveSettings } from './store.js';
import {
  loadSources,
  loadSubscriptions,
  addSource,
  updateSource,
  removeSource,
  testSource,
  getSource,
  addSubscription,
  removeSubscription,
  syncSubscription,
  syncEnabledSubscriptions,
  getSubscription,
  normalizeSourceUrl
} from './sources.js';

import {
  checkHealth,
  clearToken,
  getToken,
  hasToken,
  setToken,
  testSourceUrl
} from './remote-api.js';

import { sourceStatusFor } from './sources-view.js';
import { escapeHtml, toast, openConfirm } from './ui.js';

const ACTIONS = new Set([
  'source-add',
  'source-cancel',
  'source-edit',
  'source-test',
  'source-remove',
  'source-toggle',
  'subscription-add',
  'subscription-cancel',
  'subscription-sync',
  'subscription-remove',
  'sources-sync-all',
  'connection-check',
  'connection-clear-token',
  'toggle-hls-proxy',
  'sources-export',
  'sources-import'
]);

const FORM_IDS = new Set(['connection-form', 'source-form', 'subscription-form']);

let refreshHandler = () => {};
let lastHealthCheckAt = 0;

export function setSourcesRefreshHandler(fn) {
  refreshHandler = typeof fn === 'function' ? fn : () => {};
}

export function isSourcesAction(action) {
  return ACTIONS.has(String(action || ''));
}

export function isSourcesForm(id) {
  return FORM_IDS.has(String(id || ''));
}

function statusHtml(status) {
  return '<span class="status-dot is-' + status.tone + '" aria-hidden="true"></span>' +
    '<span class="status-text">' + escapeHtml(status.text) + '</span>';
}

function setFormError(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message || '';
}

function clearFormError(id) {
  setFormError(id, '');
}

function showSourceForm(source) {
  const form = document.getElementById('source-form');
  if (!form) return;

  form.hidden = false;
  form.dataset.editing = source ? source.id : '';
  form.dataset.originalUrl = source ? source.url : '';

  const idInput = document.getElementById('source-id');
  const nameInput = document.getElementById('source-name');
  const urlInput = document.getElementById('source-url');
  const authorized = document.getElementById('source-authorized');

  if (idInput) idInput.value = source ? source.id : '';
  if (nameInput) nameInput.value = source ? source.name : '';
  if (urlInput) urlInput.value = source ? source.url : '';
  if (authorized) authorized.checked = false;
  clearFormError('source-form-error');

  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (nameInput) nameInput.focus({ preventScroll: true });
}

function hideSourceForm() {
  const form = document.getElementById('source-form');
  if (!form) return;
  form.hidden = true;
  form.dataset.editing = '';
  form.dataset.originalUrl = '';
  clearFormError('source-form-error');
}

function showSubscriptionForm() {
  const form = document.getElementById('subscription-form');
  if (!form) return;
  form.hidden = false;
  clearFormError('subscription-form-error');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const input = document.getElementById('subscription-name');
  if (input) input.focus({ preventScroll: true });
}

function hideSubscriptionForm() {
  const form = document.getElementById('subscription-form');
  if (!form) return;
  form.hidden = true;
  clearFormError('subscription-form-error');
}

function updateRowStatus(source) {
  if (!source) return;
  const element = document.querySelector('[data-source-status="' + source.id + '"]');
  if (!element) return;
  element.innerHTML = statusHtml(sourceStatusFor(source));
}

function setConnectionStatus(status) {
  const element = document.getElementById('connection-status');
  if (element) element.innerHTML = statusHtml(status);
  return Boolean(element);
}

function markConnectionChecking() {
  return setConnectionStatus({ tone: 'idle', text: '正在检测连接…' });
}

async function probeToken() {
  try {
    await testSourceUrl('');
    return { ok: true };
  } catch (error) {
    if (error && error.status === 401) {
      return { ok: false, message: '访问口令不正确，请重新填写' };
    }
    return { ok: true };
  }
}

async function checkConnection(options = {}) {
  if (!markConnectionChecking()) return null;

  const result = await checkHealth();
  if (!result.configured) {
    setConnectionStatus({ tone: 'idle', text: result.message });
    return result;
  }

  if (!result.reachable) {
    setConnectionStatus({ tone: 'error', text: result.message || '无法连接服务' });
    return result;
  }

  if (!result.ok) {
    const missing = Array.isArray(result.missingEnv) && result.missingEnv.length
      ? '：缺少 ' + result.missingEnv.join('、')
      : '';
    setConnectionStatus({ tone: 'error', text: '服务已连接，但服务端配置不完整' + missing });
    return result;
  }

  if (result.authRequired && !hasToken()) {
    setConnectionStatus({
      tone: 'warn',
      text: '服务正常 v' + (result.version || '') + '，但还没有保存访问口令'
    });
    return result;
  }

  if (result.authRequired && hasToken() && !options.skipProbe) {
    const probe = await probeToken();
    if (!probe.ok) {
      setConnectionStatus({ tone: 'error', text: probe.message });
      return { ...result, ok: false };
    }
  }

  setConnectionStatus({
    tone: 'ok',
    text: '服务正常 · v' + (result.version || '') + ' · API v' + (result.apiVersion || 1) +
      (result.authRequired ? ' · 口令有效' : ' · 本地免口令')
  });

  return result;
}

export async function setupSourcesPage() {
  if (!document.getElementById('connection-status')) return;

  const now = Date.now();
  if (now - lastHealthCheckAt < 30000) return;
  lastHealthCheckAt = now;

  if (!state.settings.apiBase && /\.github\.io$/i.test(location.hostname)) return;
  if (!hasToken()) return;

  await checkConnection();
}

async function saveConnection(form) {
  const baseInput = document.getElementById('api-base-input');
  const tokenInput = document.getElementById('api-token-input');
  const rawBase = baseInput ? baseInput.value.trim() : '';
  const rawToken = tokenInput ? tokenInput.value.trim() : '';

  if (rawBase) {
    try {
      const url = new URL(rawBase);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    } catch (error) {
      setConnectionStatus({ tone: 'error', text: '服务地址必须是 http(s) 开头的完整网址' });
      if (baseInput) baseInput.focus();
      return;
    }
  }

  const saved = await saveSettings({ apiBase: rawBase });
  if (rawBase && !saved.apiBase) {
    setConnectionStatus({ tone: 'error', text: '服务地址格式不正确，未保存' });
    return;
  }

  if (rawToken) setToken(rawToken);
  if (tokenInput) tokenInput.value = '';

  toast('连接设置已保存');
  await checkConnection();
}

async function submitSourceForm(form) {
  const idInput = document.getElementById('source-id');
  const nameInput = document.getElementById('source-name');
  const urlInput = document.getElementById('source-url');
  const authorized = document.getElementById('source-authorized');

  const id = idInput ? idInput.value : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const rawUrl = urlInput ? urlInput.value.trim() : '';
  const url = normalizeSourceUrl(rawUrl);
  const editing = id ? getSource(id) : null;

  if (!url) {
    setFormError('source-form-error', '请填写 http / https 的 Apple CMS 接口地址');
    if (urlInput) urlInput.focus();
    return;
  }

  const urlChanged = !editing || url !== editing.url;
  if (urlChanged && !(authorized && authorized.checked)) {
    setFormError('source-form-error', '请先勾选授权确认，再保存这个源');
    return;
  }

  clearFormError('source-form-error');

  let saved;
  try {
    saved = editing
      ? await updateSource(id, { name, url, authorized: Boolean(authorized && authorized.checked) })
      : await addSource({ name, url, authorized: Boolean(authorized && authorized.checked) });
  } catch (error) {
    setFormError('source-form-error', error.message || '保存失败');
    return;
  }

  hideSourceForm();
  toast(editing ? '已保存修改' : '已添加源，正在测试…', 1600);
  refreshHandler();

  const tested = await testSource(saved.id);
  updateRowStatus(tested);
  if (tested && tested.lastTest && tested.lastTest.ok) {
    toast('源可用' + (tested.lastTest.ms ? ' · ' + tested.lastTest.ms + 'ms' : ''));
  } else {
    toast('源已保存，但测试失败：' + ((tested && tested.lastTest && tested.lastTest.error) || '请检查地址'));
  }
}

async function submitSubscriptionForm() {
  const nameInput = document.getElementById('subscription-name');
  const urlInput = document.getElementById('subscription-url');
  const authorized = document.getElementById('subscription-authorized');

  const name = nameInput ? nameInput.value.trim() : '';
  const url = urlInput ? urlInput.value.trim() : '';

  if (!authorized || !authorized.checked) {
    setFormError('subscription-form-error', '请先勾选授权确认，再添加订阅');
    return;
  }

  if (!normalizeSourceUrl(url)) {
    setFormError('subscription-form-error', '请填写 http / https 的订阅地址');
    if (urlInput) urlInput.focus();
    return;
  }

  clearFormError('subscription-form-error');

  let sub;
  try {
    sub = await addSubscription({ name, url, authorized: true });
  } catch (error) {
    setFormError('subscription-form-error', error.message || '添加订阅失败');
    return;
  }

  hideSubscriptionForm();
  toast('订阅已添加，正在同步…', 1600);
  refreshHandler();

  try {
    const result = await syncSubscription(sub.id);
    toast('订阅已同步：' + result.total + ' 个源' +
      (result.droppedForLimit ? '（' + result.droppedForLimit + ' 个超出上限被跳过）' : ''));
  } catch (error) {
    toast('订阅已保存，但同步失败：' + (error.message || '请稍后重试'));
  }

  refreshHandler();
}

async function runSubscriptionSync(id) {
  const sub = getSubscription(id);
  if (!sub) return;

  const button = document.querySelector('[data-action="subscription-sync"][data-subscription-id="' + id + '"]');
  if (button) button.classList.add('is-busy');

  try {
    const result = await syncSubscription(id);
    toast('已同步：' + result.total + ' 个源');
    refreshHandler();
  } catch (error) {
    toast('同步失败：' + (error.message || '请稍后重试'));
    refreshHandler();
  } finally {
    if (button) button.classList.remove('is-busy');
  }
}

async function syncAllSubscriptions() {
  toast('正在同步全部订阅…', 1600);
  const results = await syncEnabledSubscriptions();
  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;
  toast('同步完成：' + ok + ' 个成功' + (failed ? ' · ' + failed + ' 个失败' : ''));
  refreshHandler();
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function exportSources() {
  await Promise.all([loadSources(), loadSubscriptions()]);
  const sources = (await loadSources()).map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    detail: source.detail,
    enabled: source.enabled,
    selected: source.selected,
    authorized: true,
    authorizedAt: source.authorizedAt,
    origin: source.origin,
    createdAt: source.createdAt
  }));
  const subscriptions = (await loadSubscriptions()).map((sub) => ({
    id: sub.id,
    name: sub.name,
    url: sub.url,
    enabled: sub.enabled,
    createdAt: sub.createdAt
  }));

  downloadJson({
    app: 'AH 影视',
    schema: 2,
    kind: 'sources',
    exportedAt: new Date().toISOString(),
    sources,
    subscriptions
  }, 'AH影视-源-' + new Date().toISOString().slice(0, 10) + '.json');

  toast('源与订阅已导出');
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    toast('文件太大，无法导入');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    toast('这个文件不是有效的 JSON');
    return;
  }

  const rawSources = Array.isArray(payload)
    ? payload
    : Array.isArray(payload && payload.sources)
      ? payload.sources
      : [];
  const rawSubs = !Array.isArray(payload) && Array.isArray(payload && payload.subscriptions)
    ? payload.subscriptions
    : [];

  if (!rawSources.length && !rawSubs.length) {
    toast('这个文件里没有可导入的源或订阅');
    return;
  }

  const confirmed = await openConfirm({
    title: '导入源与订阅？',
    description: '将导入 ' + rawSources.length + ' 个源、' + rawSubs.length +
      ' 个订阅，重复地址会自动跳过。请确认这些来源均已获得授权，仅用于个人合法观看。',
    confirmText: '确认导入'
  });
  if (!confirmed) return;

  let addedSources = 0;
  let addedSubs = 0;

  for (const row of rawSources) {
    if (!row || typeof row !== 'object') continue;
    try {
      await addSource({
        name: row.name,
        url: row.url,
        detail: row.detail,
        authorized: true
      });
      addedSources += 1;
    } catch (error) {
      /* 重复或非法条目直接跳过。 */
    }
  }

  for (const row of rawSubs) {
    if (!row || typeof row !== 'object') continue;
    try {
      await addSubscription({ name: row.name, url: row.url, authorized: true });
      addedSubs += 1;
    } catch (error) {
      /* 跳过。 */
    }
  }

  refreshHandler();
  toast('已导入 ' + addedSources + ' 个源、' + addedSubs + ' 个订阅');

  if (addedSubs) {
    syncAllSubscriptions().catch(() => {});
  }
}

async function removeSourceFlow(id) {
  const source = getSource(id);
  if (!source) return;

  const confirmed = await openConfirm({
    title: '删除“' + source.name + '”？',
    description: '只会删除这台设备上的源配置，不影响你的备份文件。',
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;

  try {
    await removeSource(id);
  } catch (error) {
    toast('删除失败，请再试一次');
    return;
  }
  toast('已删除源');
  refreshHandler();
}

async function removeSubscriptionFlow(id) {
  const sub = getSubscription(id);
  if (!sub) return;

  const confirmed = await openConfirm({
    title: '删除订阅“' + sub.name + '”？',
    description: '通过这个订阅导入的源也会一起移除；手动添加的源不受影响。',
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;

  try {
    await removeSubscription(id);
  } catch (error) {
    toast('删除失败，请再试一次');
    return;
  }
  toast('已删除订阅');
  refreshHandler();
}

export async function handleSourcesAction(element) {
  const action = element.getAttribute('data-action');
  const sourceId = element.getAttribute('data-source-id') || '';
  const subscriptionId = element.getAttribute('data-subscription-id') || '';

  if (action === 'source-add') {
    showSourceForm(null);
  } else if (action === 'source-cancel') {
    hideSourceForm();
  } else if (action === 'source-edit') {
    showSourceForm(getSource(sourceId));
  } else if (action === 'source-test') {
    const source = getSource(sourceId);
    if (!source) return;

    const statusElement = document.querySelector('[data-source-status="' + sourceId + '"]');
    if (statusElement) statusElement.innerHTML = statusHtml({ tone: 'idle', text: '测试中…' });
    element.classList.add('is-busy');

    const tested = await testSource(sourceId);
    updateRowStatus(tested);
    element.classList.remove('is-busy');

    if (tested && tested.lastTest && tested.lastTest.ok) {
      toast('源可用' + (tested.lastTest.ms ? ' · ' + tested.lastTest.ms + 'ms' : ''));
    } else {
      toast('测试失败：' + ((tested && tested.lastTest && tested.lastTest.error) || '请检查地址'));
    }
  } else if (action === 'source-toggle') {
    const source = getSource(sourceId);
    if (!source) return;
    const next = !source.enabled;

    try {
      await updateSource(sourceId, { enabled: next, selected: next });
    } catch (error) {
      toast('操作失败，请再试一次');
      return;
    }

    element.classList.toggle('is-on', next);
    element.setAttribute('aria-checked', String(next));
    element.setAttribute('aria-label', (next ? '停用 ' : '启用 ') + source.name);

    const row = document.querySelector('[data-source-row="' + sourceId + '"]');
    const nameRow = row ? row.querySelector('.source-name-row') : null;
    if (nameRow) {
      const offTag = nameRow.querySelector('.source-tag.is-off');
      if (next && offTag) offTag.remove();
      if (!next && !offTag) nameRow.insertAdjacentHTML('beforeend', '<span class="source-tag is-off">已停用</span>');
    }

    toast(next ? '已启用：' + source.name : '已停用：' + source.name);
  } else if (action === 'source-remove') {
    await removeSourceFlow(sourceId);
  } else if (action === 'subscription-add') {
    showSubscriptionForm();
  } else if (action === 'subscription-cancel') {
    hideSubscriptionForm();
  } else if (action === 'subscription-sync') {
    await runSubscriptionSync(subscriptionId);
  } else if (action === 'subscription-remove') {
    await removeSubscriptionFlow(subscriptionId);
  } else if (action === 'sources-sync-all') {
    await syncAllSubscriptions();
  } else if (action === 'connection-check') {
    lastHealthCheckAt = Date.now();
    await checkConnection();
  } else if (action === 'connection-clear-token') {
    const confirmed = await openConfirm({
      title: '清除访问口令？',
      description: '清除后需要重新输入口令才能搜索；源与订阅不受影响。',
      confirmText: '清除',
      danger: true
    });
    if (!confirmed) return;
    clearToken();
    toast('口令已清除');
    refreshHandler();
  } else if (action === 'toggle-hls-proxy') {
    const next = !state.settings.hlsProxySegments;
    try {
      await saveSettings({ hlsProxySegments: next });
    } catch (error) {
      toast('保存失败，请再试一次');
      return;
    }
    element.classList.toggle('is-on', next);
    element.setAttribute('aria-checked', String(next));
    toast(next ? 'HLS 分片将走代理（更耗流量）' : 'HLS 分片已改为直连');
  } else if (action === 'sources-export') {
    await exportSources();
  } else if (action === 'sources-import') {
    const input = document.getElementById('sources-import-file');
    if (input) input.click();
  }
}

export async function handleSourcesSubmit(form) {
  const id = form.getAttribute('id');

  if (id === 'connection-form') {
    await saveConnection(form);
  } else if (id === 'source-form') {
    await submitSourceForm(form);
  } else if (id === 'subscription-form') {
    await submitSubscriptionForm(form);
  }
}

export async function handleSourcesChange(target) {
  if (target.id === 'sources-import-file') {
    await importFile(target);
    return true;
  }
  return false;
}

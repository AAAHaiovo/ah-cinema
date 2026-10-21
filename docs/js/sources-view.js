/* 源管理页：服务连接、点播源、订阅、高级与导入导出。 */

import { state } from './store.js';
import {
  escapeHtml,
  icon,
  emptyState,
  formatRelative
} from './ui.js';

import {
  apiLabel,
  hasToken,
  isConfigured,
  isGitHubPages
} from './remote-api.js';

import {
  cachedSources,
  cachedSubscriptions,
  MAX_SEARCH_SOURCES,
  SOURCE_LIMIT
} from './sources.js';

const APP_VERSION = '0.8.12';

function pageHeading(title, subtitle, action = '') {
  return '<div class="page-title-row">' +
    '<div><h1 class="page-title">' + escapeHtml(title) + '</h1>' +
    (subtitle ? '<p class="page-sub">' + escapeHtml(subtitle) + '</p>' : '') +
    '</div>' + (action || '') + '</div>';
}

function connectionStatus() {
  if (!isConfigured()) {
    return {
      tone: 'idle',
      text: isGitHubPages()
        ? '未配置服务地址。GitHub Pages 版需要填写 Vercel 地址后才能搜索。'
        : '未配置服务地址。本地同源模式通常留空即可。'
    };
  }
  if (!hasToken()) {
    return { tone: 'warn', text: '已配置 ' + apiLabel() + '，还没有保存访问口令。' };
  }
  return { tone: 'idle', text: '已配置 ' + apiLabel() + ' · 点击“检测连接”确认状态。' };
}

export function sourceStatusFor(source, now = Date.now()) {
  if (!source) return { tone: 'idle', text: '源不存在' };
  if (source.health && source.health.cooldownUntil > now) {
    return { tone: 'warn', text: '冷却中：连续失败，稍后自动恢复' };
  }
  if (!source.lastTest) return { tone: 'idle', text: '未测试' };
  if (source.lastTest.ok) {
    const count = source.lastTest.count > 0 ? ' · ' + source.lastTest.count + ' 条' : '';
    const ms = source.lastTest.ms > 0 ? ' · ' + source.lastTest.ms + 'ms' : '';
    return { tone: 'ok', text: '可用' + count + ms + ' · ' + formatRelative(source.lastTest.at) };
  }
  return { tone: 'error', text: source.lastTest.error || '测试失败' };
}

function statusMark(status) {
  return '<span class="status-dot is-' + status.tone + '" aria-hidden="true"></span>' +
    '<span class="status-text">' + escapeHtml(status.text) + '</span>';
}

function sourceRow(source, now) {
  const status = sourceStatusFor(source, now);
  const fromSubscription = source.origin && source.origin.startsWith('sub:');
  const tag = fromSubscription
    ? '<span class="source-tag">订阅</span>'
    : '<span class="source-tag is-manual">手动</span>';

  return '<div class="source-row" data-source-row="' + escapeHtml(source.id) + '">' +
    '<div class="source-main">' +
      '<div class="source-name-row">' +
        '<span class="source-name">' + escapeHtml(source.name) + '</span>' + tag +
        (source.enabled ? '' : '<span class="source-tag is-off">已停用</span>') +
      '</div>' +
      '<div class="source-url" title="' + escapeHtml(source.url) + '">' + escapeHtml(source.url) + '</div>' +
      '<div class="source-status" data-source-status="' + escapeHtml(source.id) + '">' + statusMark(status) + '</div>' +
    '</div>' +
    '<div class="source-actions">' +
      '<button class="switch ' + (source.enabled ? 'is-on' : '') + '" type="button" data-action="source-toggle" data-source-id="' + escapeHtml(source.id) + '" role="switch" aria-checked="' + Boolean(source.enabled) + '" aria-label="' + (source.enabled ? '停用' : '启用') + ' ' + escapeHtml(source.name) + '"><span></span></button>' +
      '<button class="icon-btn" type="button" data-action="source-test" data-source-id="' + escapeHtml(source.id) + '" aria-label="测试 ' + escapeHtml(source.name) + '">' + icon('refresh') + '</button>' +
      '<button class="icon-btn" type="button" data-action="source-edit" data-source-id="' + escapeHtml(source.id) + '" aria-label="编辑 ' + escapeHtml(source.name) + '">' + icon('edit') + '</button>' +
      '<button class="icon-btn source-remove" type="button" data-action="source-remove" data-source-id="' + escapeHtml(source.id) + '" aria-label="删除 ' + escapeHtml(source.name) + '">' + icon('trash') + '</button>' +
    '</div>' +
    '</div>';
}

function subscriptionRow(sub, now) {
  let status = { tone: 'idle', text: '尚未同步' };
  if (sub.lastSyncStatus === 'ok') {
    status = {
      tone: 'ok',
      text: '已同步 · ' + sub.sourceCount + ' 个源 · ' + formatRelative(sub.lastSyncAt)
    };
  } else if (sub.lastSyncStatus === 'error') {
    status = { tone: 'error', text: sub.lastError || '同步失败' };
  }

  return '<div class="source-row" data-subscription-row="' + escapeHtml(sub.id) + '">' +
    '<div class="source-main">' +
      '<div class="source-name-row"><span class="source-name">' + escapeHtml(sub.name) + '</span>' +
        '<span class="source-tag is-sub">订阅</span>' +
        (sub.enabled ? '' : '<span class="source-tag is-off">已停用</span>') +
      '</div>' +
      '<div class="source-url" title="' + escapeHtml(sub.url) + '">' + escapeHtml(sub.url) + '</div>' +
      '<div class="source-status">' + statusMark(status) + '</div>' +
    '</div>' +
    '<div class="source-actions">' +
      '<button class="icon-btn" type="button" data-action="subscription-sync" data-subscription-id="' + escapeHtml(sub.id) + '" aria-label="同步 ' + escapeHtml(sub.name) + '">' + icon('refresh') + '</button>' +
      '<button class="icon-btn source-remove" type="button" data-action="subscription-remove" data-subscription-id="' + escapeHtml(sub.id) + '" aria-label="删除订阅 ' + escapeHtml(sub.name) + '">' + icon('trash') + '</button>' +
    '</div>' +
    '</div>';
}

export function renderSources(route) {
  const now = Date.now();
  const sources = cachedSources();
  const subscriptions = cachedSubscriptions();
  const status = connectionStatus();
  const editingId = route && route.params ? (route.params.get('edit') || '') : '';
  const editing = editingId ? sources.find((source) => source.id === editingId) : null;
  const showForm = Boolean(editing) || Boolean(route && route.params && route.params.get('add') === '1');
  const tokenSaved = hasToken();

  const sourceList = sources.length
    ? '<div class="source-list">' + sources.map((source) => sourceRow(source, now)).join('') + '</div>'
    : emptyState({
        title: '没有内置源',
        text: '这里默认是空的。只添加你自己已获授权、仅用于个人合法观看的 Apple CMS 接口；App 不推荐、不代找任何采集站。',
        action: '<button class="btn btn-primary" type="button" data-action="source-add">添加第一个源</button>'
      });

  const subscriptionList = subscriptions.length
    ? '<div class="source-list">' + subscriptions.map((sub) => subscriptionRow(sub, now)).join('') + '</div>'
    : '<p class="section-hint">还没有订阅。订阅是可选的，只支持 JSON 源列表。</p>';

  return '<div class="page sources-page">' +
    pageHeading('源管理', '只使用你自己已授权的源 · v' + APP_VERSION,
      '<a class="icon-btn" href="#/settings" aria-label="设置">' + icon('gear') + '</a>') +

    '<div class="settings-caption">服务连接</div>' +
    '<section class="settings-group source-connect">' +
      '<form id="connection-form" autocomplete="off">' +
        '<div class="field">' +
          '<label class="field-label" for="api-base-input">服务地址</label>' +
          '<input class="input" id="api-base-input" name="apiBase" type="text" inputmode="url" spellcheck="false" autocapitalize="off" placeholder="留空 = 同源；GitHub Pages 版填 https://你的项目.vercel.app" value="' + escapeHtml(state.settings.apiBase || '') + '">' +
          '<p class="field-hint">Vercel 同源部署留空即可；GitHub Pages 版必须填写 Vercel 地址。</p>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="api-token-input">访问口令</label>' +
          '<input class="input" id="api-token-input" name="token" type="password" autocomplete="new-password" spellcheck="false" placeholder="' + (tokenSaved ? '已保存（留空保持不变）' : '服务端 AH_API_TOKEN') + '">' +
          '<p class="field-hint">口令只保存在这台浏览器，不会写进备份，也不会出现在网址里。</p>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button class="btn btn-primary btn-small" type="submit">保存并检测</button>' +
          '<button class="btn btn-secondary btn-small" type="button" data-action="connection-check">检测连接</button>' +
          (tokenSaved ? '<button class="text-btn danger" type="button" data-action="connection-clear-token">清除口令</button>' : '') +
        '</div>' +
        '<div class="connection-status" id="connection-status">' + statusMark(status) + '</div>' +
      '</form>' +
    '</section>' +

    '<div class="settings-caption">点播源 · ' + sources.length + ' / ' + SOURCE_LIMIT + '</div>' +
    '<section class="settings-group sources-group">' +
      '<div class="group-head">' +
        '<div><div class="group-title">Apple CMS 接口</div>' +
        '<p class="group-sub">搜索时最多并行请求 ' + MAX_SEARCH_SOURCES + ' 个已启用的源。</p></div>' +
        '<button class="btn btn-secondary btn-small" type="button" data-action="source-add">' + icon('plus') + '<span>添加</span></button>' +
      '</div>' +
      '<form class="source-form" id="source-form" autocomplete="off"' + (showForm ? '' : ' hidden') + ' data-editing="' + escapeHtml(editing ? editing.id : '') + '" data-original-url="' + escapeHtml(editing ? editing.url : '') + '">' +
        '<input type="hidden" id="source-id" value="' + escapeHtml(editing ? editing.id : '') + '">' +
        '<div class="field">' +
          '<label class="field-label" for="source-name">名称</label>' +
          '<input class="input" id="source-name" name="name" type="text" maxlength="60" placeholder="例如：我的测试源" value="' + escapeHtml(editing ? editing.name : '') + '">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="source-url">API 地址</label>' +
          '<input class="input" id="source-url" name="url" type="text" inputmode="url" spellcheck="false" autocapitalize="off" placeholder="https://…/api.php/provide/vod" value="' + escapeHtml(editing ? editing.url : '') + '">' +
          '<p class="field-hint">只接受 http / https 的 Apple CMS JSON 接口；不抓取网页，不解析播放页。</p>' +
          '<p class="field-hint">提示：局域网地址（192.168.x.x等）仅本地开发模式可用，线上环境请填写公网可访问的API地址</p>' +
        '</div>' +
        '<label class="checkbox-row">' +
          '<input type="checkbox" id="source-authorized" name="authorized">' +
          '<span>我确认已获得该源的使用授权，仅用于个人合法观看；该源不包含盗版、成人或违法内容。</span>' +
        '</label>' +
        '<div class="form-error" id="source-form-error" role="alert"></div>' +
        '<div class="form-actions">' +
          '<button class="btn btn-primary btn-small" type="submit">' + (editing ? '保存修改' : '保存并测试') + '</button>' +
          '<button class="btn btn-secondary btn-small" type="button" data-action="source-cancel">取消</button>' +
        '</div>' +
      '</form>' +
      sourceList +
    '</section>' +

    '<div class="settings-caption">订阅 · ' + subscriptions.length + '</div>' +
    '<section class="settings-group sources-group">' +
      '<div class="group-head">' +
        '<div><div class="group-title">JSON 源列表</div>' +
        '<p class="group-sub">支持 LibreTV-SourceList、裸数组与 TVBox 的 CMS 站点；不导入直播源。</p></div>' +
        '<button class="btn btn-secondary btn-small" type="button" data-action="subscription-add">' + icon('plus') + '<span>添加</span></button>' +
      '</div>' +
      '<form class="source-form" id="subscription-form" autocomplete="off" hidden>' +
        '<div class="field">' +
          '<label class="field-label" for="subscription-name">名称</label>' +
          '<input class="input" id="subscription-name" name="name" type="text" maxlength="60" placeholder="例如：我的源订阅">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="subscription-url">订阅地址</label>' +
          '<input class="input" id="subscription-url" name="url" type="text" inputmode="url" spellcheck="false" autocapitalize="off" placeholder="https://…/sources.json">' +
          '<p class="field-hint">只拉取 JSON；订阅同步失败时不会删除已有源。</p>' +
        '</div>' +
        '<label class="checkbox-row">' +
          '<input type="checkbox" id="subscription-authorized" name="authorized">' +
          '<span>我确认该订阅里的来源均已获得授权，仅用于个人合法观看。</span>' +
        '</label>' +
        '<div class="form-error" id="subscription-form-error" role="alert"></div>' +
        '<div class="form-actions">' +
          '<button class="btn btn-primary btn-small" type="submit">添加并同步</button>' +
          '<button class="btn btn-secondary btn-small" type="button" data-action="subscription-cancel">取消</button>' +
        '</div>' +
      '</form>' +
      subscriptionList +
      (subscriptions.some((sub) => sub.enabled)
        ? '<div class="form-actions source-sync-all"><button class="btn btn-secondary btn-small" type="button" data-action="sources-sync-all">' + icon('refresh') + '<span>同步全部订阅</span></button></div>'
        : '') +
    '</section>' +

    '<div class="settings-caption">高级</div>' +
    '<section class="settings-group">' +
      '<div class="settings-row">' +
        '<span class="settings-icon">' + icon('shield') + '</span>' +
        '<span class="settings-label">HLS 分片走代理</span>' +
        '<button type="button" class="switch ' + (state.settings.hlsProxySegments ? 'is-on' : '') + '" data-action="toggle-hls-proxy" role="switch" aria-checked="' + Boolean(state.settings.hlsProxySegments) + '" aria-label="HLS 分片走代理"><span></span></button>' +
      '</div>' +
      '<p class="settings-foot source-foot">默认关闭。只有当某个 HLS 源的分片需要 Referer 或跨域失败时才打开；开启后视频分片会经过你的服务代理，更耗流量。</p>' +
    '</section>' +

    '<div class="settings-caption">导入 / 导出</div>' +
    '<section class="settings-group">' +
      '<button class="settings-row" type="button" data-action="sources-export">' +
        '<span class="settings-icon">' + icon('download') + '</span><span class="settings-label">导出源与订阅</span><span class="settings-value">JSON</span>' +
      '</button>' +
      '<button class="settings-row" type="button" data-action="sources-import">' +
        '<span class="settings-icon">' + icon('upload') + '</span><span class="settings-label">导入源与订阅</span><span class="settings-value">JSON</span>' +
      '</button>' +
      '<input type="file" id="sources-import-file" accept="application/json,.json" hidden>' +
    '</section>' +

    '<div class="tip-card">' +
      '<div class="tip-title">边界与责任</div>' +
      '<p>App 不内置、不推荐、不代找任何采集站或盗版源。你添加的每个源都由你自己负责，请确保你有权访问和观看其中的内容。</p>' +
      '<p>搜索只会请求你填写的 Apple CMS 接口的 JSON 数据；取到详情后，App 直接播放源站地址，不下载、不转存视频。</p>' +
    '</div>' +
    '</div>';
}

export function renderSourceStatus(id, status) {
  return '<span class="status-dot is-' + status.tone + '" aria-hidden="true"></span>' +
    '<span class="status-text">' + escapeHtml(status.text) + '</span>';
}

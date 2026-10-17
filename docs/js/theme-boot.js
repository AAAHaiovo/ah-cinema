/* 在首屏绘制前套用主题，避免闪白。这个文件故意保持为普通脚本，不依赖模块。 */
(function () {
  var root = document.documentElement;
  var theme = 'auto';

  try {
    theme = localStorage.getItem('ah-theme') || 'auto';
  } catch (error) {
    theme = 'auto';
  }

  var systemDark = false;
  try {
    systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (error) {
    systemDark = false;
  }

  var dark = theme === 'dark' || (theme !== 'light' && systemDark);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';

  var meta = document.getElementById('meta-theme-color');
  if (meta) {
    meta.setAttribute('content', dark ? '#000000' : '#F5F5F7');
  }

  var statusMeta = document.getElementById('meta-status-bar');
  if (statusMeta) {
    statusMeta.setAttribute('content', dark ? 'black' : 'default');
  }

  function splashMessage(text) {
    var splash = document.getElementById('splash');
    var sub = document.getElementById('splash-sub');
    if (splash && sub && !splash.classList.contains('is-hidden')) {
      sub.textContent = text;
    }
  }

  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.tagName === 'SCRIPT') {
      splashMessage('脚本加载失败，请刷新页面');
    }
  });

  window.setTimeout(function () {
    if (!root.dataset.booted) {
      splashMessage('加载时间较长，请检查网络后刷新');
    }
  }, 12000);
})();

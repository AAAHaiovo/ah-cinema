/* Hash 路由：GitHub Pages 子路径下也不需要服务器 rewrite。 */

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

export function parseRoute() {
  const raw = location.hash ? location.hash.slice(1) : '/';
  const splitAt = raw.indexOf('?');
  const pathPart = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const queryPart = splitAt >= 0 ? raw.slice(splitAt + 1) : '';

  let path = pathPart || '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';

  const params = new URLSearchParams(queryPart);
  const segments = path.split('/').filter(Boolean).map(safeDecode);

  return { raw, path, params, segments };
}

export function resolveRoute(route) {
  const path = route.path;
  const segments = route.segments;

  if (path === '/') return { name: 'home' };
  if (path === '/library') return { name: 'library' };
  if (path === '/search') return { name: 'search' };
  if (path === '/history') return { name: 'history' };
  if (path === '/favorites') return { name: 'favorites' };
  if (path === '/me') return { name: 'me' };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/about') return { name: 'about' };

  if (segments[0] === 'title' && segments[1]) {
    return { name: 'detail', itemId: segments[1] };
  }

  if (segments[0] === 'watch' && segments[1]) {
    return {
      name: 'player',
      itemId: segments[1],
      episodeId: segments[2] || null
    };
  }

  return { name: 'notfound' };
}

export function href(path, params) {
  let normalized = path || '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;

  const query = new URLSearchParams();
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
  }

  const qs = query.toString();
  return '#' + normalized + (qs ? '?' + qs : '');
}

export function navigate(path, options = {}) {
  const hash = String(path || '/').startsWith('#') ? String(path) : '#' + path;

  if (options.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new Event('hashchange'));
    return;
  }

  location.hash = hash;
}

export function routeKey(route) {
  const entries = Array.from(route.params.entries()).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return route.path;
  return route.path + '?' + entries.map(([key, value]) => key + '=' + value).join('&');
}

export function isTabbedRoute(name) {
  return !['detail', 'player'].includes(name);
}

export function tabForRoute(name) {
  if (name === 'home') return 'home';
  if (name === 'library') return 'library';
  if (name === 'search') return 'search';
  if (name === 'history') return 'history';
  if (name === 'me' || name === 'favorites' || name === 'settings' || name === 'about') return 'me';
  return null;
}

// مسیریاب ساده بر پایه‌ی hash (برای GitHub Pages و PWA مناسبه)
import { allRoutes } from './registry.js';

function compile(path) {
  const keys = [];
  const re = new RegExp(
    '^' +
      path.replace(/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$'
  );
  return { re, keys };
}

export function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function matchRoute(path) {
  for (const r of allRoutes()) {
    const { re, keys } = compile(r.path);
    const m = re.exec(path);
    if (m) {
      const params = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else if (replace) location.replace(location.pathname + location.search + target);
  else location.hash = path;
}

import { session } from '../core/session.js';

export function applyTheme() {
  document.documentElement.setAttribute('data-theme', session.theme || 'auto');
  const dark =
    session.theme === 'dark' || (session.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', dark ? '#171e2b' : '#ffffff');
}

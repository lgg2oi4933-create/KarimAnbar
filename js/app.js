// راه‌اندازی برنامه. ماژول‌ها فقط همین‌جا ثبت میشن؛ برای افزودن ماژول جدید یک خط اضافه کن.
import { h } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { applyTheme } from './ui/theme.js';
import { toast } from './ui/components.js';
import { IndexedDBAdapter, requestPersistentStorage } from './core/storage.js';
import { Db } from './core/repo.js';
import { session } from './core/session.js';
import { allTables, getModules, navItems } from './core/registry.js';
import { currentPath, matchRoute, go } from './core/router.js';

import { registerHome } from './modules/home/index.js';
import { registerParties } from './modules/parties/index.js';
import { registerProducts } from './modules/products/index.js';
import { registerSettings } from './modules/settings/index.js';
import { registerAuth, ensureLogin, setupAutoLock, currentUser } from './modules/auth/index.js';
import { registerInvoices } from './modules/invoices/index.js';
import { registerPayments } from './modules/payments/index.js';
import { registerChecks } from './modules/checks/index.js';
import { registerLedger } from './modules/ledger/index.js';
import { registerHr } from './modules/hr/index.js';

// ترتیب ثبت مهم نیست؛ ترتیب نمایش با order هر ماژول تعیین میشود
registerAuth();
registerHome();
registerInvoices();
registerPayments();
registerChecks();
registerParties();
registerProducts();
registerLedger();
registerHr();
registerSettings();

async function boot() {
  applyTheme();
  const root = document.getElementById('app');

  let adapter;
  try {
    adapter = new IndexedDBAdapter();
    await adapter.init(allTables());
  } catch (e) {
    root.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'ذخیره‌سازی مرورگر در دسترس نیست. اگر در حالت ناشناس هستید، از حالت عادی استفاده کنید.'), h('small', null, String(e.message || e))));
    return;
  }

  const db = new Db(adapter, {
    getDeviceId: () => session.deviceId,
    getDeviceTag: () => session.deviceTag,
    // همیشه از نشست فعلی خونده میشه تا بعد از «تغییر کاربر» فعالیت‌ها به اسم کاربر درست ثبت بشه
    getUser: () => ({ id: session.userId, name: session.userName }),
  });
  for (const m of getModules()) if (m.init) await m.init(db);

  await ensureLogin(db);
  requestPersistentStorage();

  // ---- قاب
  const titleEl = h('h1', null, '');
  const backBtn = h('button', { class: 'icon-btn', 'aria-label': 'بازگشت', hidden: true }, icon('back'));
  const actionsEl = h('div', { class: 'actions' });
  const view = h('main', { id: 'view' });
  const nav = h('nav', { class: 'bottom-nav', 'aria-label': 'منوی اصلی' });
  root.replaceChildren(h('header', { class: 'topbar' }, backBtn, titleEl, actionsEl), view, nav);

  let backPath = null;
  backBtn.addEventListener('click', () => go(backPath || '/'));

  function paintNav(path) {
    nav.replaceChildren(
      ...navItems().map((m) => {
        const p = m.nav.path;
        const active = p === '/' ? path === '/' : path === p || path.startsWith(p + '/');
        return h('a', { class: 'nav-item' + (active ? ' active' : ''), href: '#' + p, 'aria-current': active ? 'page' : null }, icon(m.nav.icon, 24), m.nav.label);
      })
    );
  }

  let token = 0;
  async function render() {
    const my = ++token;
    const { path, query } = currentPath();
    const found = matchRoute(path);
    const el = h('div');
    view.replaceChildren(el);
    actionsEl.replaceChildren();
    backBtn.hidden = true;
    backPath = null;
    paintNav(path);
    window.scrollTo(0, 0);
    if (!found) {
      titleEl.textContent = 'پیدا نشد';
      el.append(h('div', { class: 'empty' }, h('p', null, 'این صفحه وجود ندارد'), h('a', { class: 'btn primary', href: '#/' }, 'صفحه‌ی اصلی')));
      return;
    }
    const user = await currentUser(db);
    const ctx = {
      db,
      user,
      isAdmin: !!user && user.role === 'admin',
      el,
      params: found.params,
      query,
      session,
      go,
      back: () => go(backPath || '/'),
      refresh: () => render(),
      setTitle: (t) => {
        titleEl.textContent = t;
        document.title = t + ' | حسابداری';
      },
      setBack: (p) => {
        backPath = p;
        backBtn.hidden = !p;
      },
      setActions: (nodes) => actionsEl.replaceChildren(...nodes),
    };
    try {
      await found.route.render(ctx);
    } catch (e) {
      console.error(e);
      if (my === token) {
        el.append(h('div', { class: 'empty' }, h('p', null, 'خطایی رخ داد'), h('small', { dir: 'ltr' }, String(e.message || e))));
        toast('خطا: ' + (e.message || e), 'err');
      }
    }
  }
  window.addEventListener('hashchange', render);
  setupAutoLock(db, () => render());
  if (!location.hash) location.hash = '/';
  await render();
  window.__tray = { db, go };
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'updated' && hadController) toast('نسخه‌ی جدید نصب شد. برنامه را ببندید و دوباره باز کنید.');
  });
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
}

// ماژول تنظیمات: اطلاعات شرکت (لوگو)، کاربران، گزارش فعالیت، گوشی و ظاهر
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, kv, row, section, sheet, toast } from '../../ui/components.js';
import { registerModule, tableLabel, fieldLabel } from '../../core/registry.js';
import { session } from '../../core/session.js';
import { toFaDigits, pad } from '../../core/util.js';
import { toJalali, formatJalali } from '../../core/jalali.js';
import { requestPersistentStorage } from '../../core/storage.js';
import { applyTheme } from '../../ui/theme.js';

export const USER_ROLES = [
  { value: 'admin', label: 'مدیر' },
  { value: 'accountant', label: 'حسابدار' },
];
const roleLabel = (v) => (USER_ROLES.find((r) => r.value === v) || { label: v }).label;
const APP_VERSION = '0.1.0 (مرحله ۱)';

export async function getCompany(db) {
  return (await db.table('settings').get('company')) || {};
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return toFaDigits(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}  ${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

// ---------------------------------------------------------------- کاربر فعلی
export async function pickUser(db, { dismissible = false } = {}) {
  const users = (await db.table('users').list()).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  return new Promise((resolve) => {
    let s;
    const choose = (u) => {
      session.userId = u.id;
      session.userName = u.name;
      s.close();
      resolve(u);
    };
    s = sheet({
      title: 'چه کسی کار میکند؟',
      dismissible,
      className: 'login-list',
      body: users.map((u) => row({ leading: icon('user'), title: u.name, subtitle: roleLabel(u.role), onclick: () => choose(u) })),
    });
  });
}

export async function currentUser(db) {
  const id = session.userId;
  if (!id) return null;
  const u = await db.table('users').get(id);
  return u && !u.deletedAt ? u : null;
}

// ---------------------------------------------------------------- صفحه‌ی «بیشتر»
async function morePage(ctx) {
  ctx.setTitle('بیشتر');
  ctx.setBack(null);
  const { moreItems } = await import('../../core/registry.js');
  const u = await currentUser(ctx.db);
  ctx.el.append(
    section(
      null,
      h(
        'div',
        { class: 'row', style: { boxShadow: 'none', border: 0, padding: 0 } },
        h('div', { class: 'row-lead' }, icon('user', 28)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, u ? u.name : '—'), h('div', { class: 'row-sub' }, u ? roleLabel(u.role) : '')),
        h(
          'button',
          {
            class: 'btn ghost small',
            onclick: async () => {
              await pickUser(ctx.db, { dismissible: true });
              ctx.refresh();
            },
          },
          'تغییر کاربر'
        )
      )
    ),
    h(
      'div',
      { class: 'list' },
      moreItems().map((m) => row({ leading: icon(m.icon), title: m.label, subtitle: m.desc || '', onclick: () => ctx.go(m.path) }))
    )
  );
}

// ---------------------------------------------------------------- اطلاعات شرکت
async function companyPage(ctx) {
  ctx.setTitle('اطلاعات شرکت');
  ctx.setBack('/more');
  const c = await getCompany(ctx.db);
  ctx.el.append(
    h('p', { class: 'muted' }, 'این اطلاعات روی فاکتورها و صورت‌حساب‌ها چاپ میشود.'),
    buildForm({
      values: c,
      submitText: 'ذخیره',
      onCancel: () => ctx.back(),
      fields: [
        { name: 'logo', label: 'لوگو', type: 'image' },
        { name: 'name', label: 'نام شرکت', required: true },
        { name: 'phone', label: 'تلفن', type: 'tel' },
        { name: 'economicCode', label: 'کد اقتصادی', type: 'tel' },
        { name: 'nationalId', label: 'شناسه ملی', type: 'tel' },
        { name: 'postalCode', label: 'کد پستی', type: 'tel' },
        { name: 'address', label: 'آدرس', type: 'textarea' },
        { name: 'invoiceNote', label: 'متن پایین فاکتور', type: 'textarea', hint: 'مثلاً شماره حساب یا شرایط پرداخت' },
      ],
      onSubmit: async (v) => {
        await ctx.db.table('settings').upsert('company', v);
        toast('ذخیره شد');
        ctx.go('/more');
      },
    })
  );
}

// ---------------------------------------------------------------- کاربران
async function usersPage(ctx) {
  ctx.setTitle('کاربران');
  ctx.setBack('/more');
  const t = ctx.db.table('users');
  const users = await t.list();
  const admins = users.filter((u) => u.role === 'admin');
  ctx.el.append(
    h(
      'div',
      { class: 'list' },
      users.map((u) =>
        row({
          leading: icon('user'),
          title: u.name,
          subtitle: roleLabel(u.role),
          meta: u.id === session.userId ? badge('کاربر فعلی', 'ok') : '',
          onclick: () => userForm(ctx, u),
        })
      )
    ),
    h('div', { class: 'pad-top' }, h('button', { class: 'btn primary', onclick: () => userForm(ctx, null) }, 'افزودن کاربر'))
  );
  void admins;
}

function userForm(ctx, u) {
  const t = ctx.db.table('users');
  let s;
  const form = buildForm({
    values: u || { role: 'accountant' },
    submitText: u ? 'ذخیره' : 'افزودن',
    onCancel: () => s.close(),
    extraActions: u
      ? [
          h(
            'button',
            {
              type: 'button',
              class: 'btn ghost',
              onclick: async () => {
                const all = await t.list();
                if (all.length <= 1) return toast('حداقل یک کاربر باید بماند', 'err');
                if (u.role === 'admin' && all.filter((x) => x.role === 'admin').length <= 1) return toast('حداقل یک مدیر باید بماند', 'err');
                if (u.id === session.userId) return toast('کاربر فعلی را نمیشود حذف کرد', 'err');
                if (await confirmDialog(`کاربر «${u.name}» حذف شود؟ سابقه‌ی فعالیت‌هایش میماند.`, { danger: true, okText: 'حذف' })) {
                  await t.remove(u.id);
                  s.close();
                  ctx.refresh();
                }
              },
            },
            'حذف'
          ),
        ]
      : [],
    fields: [
      { name: 'name', label: 'نام کاربر', required: true },
      { name: 'role', label: 'نقش', type: 'choice', options: USER_ROLES },
    ],
    onSubmit: async (v, { setError }) => {
      const all = await t.list();
      if (all.some((x) => x.id !== (u && u.id) && x.name === v.name)) return setError('name', 'کاربری با این نام هست');
      if (u && u.role === 'admin' && v.role !== 'admin' && all.filter((x) => x.role === 'admin').length <= 1)
        return setError('role', 'حداقل یک مدیر باید بماند');
      if (u) {
        await t.update(u.id, v);
        if (u.id === session.userId) session.userName = v.name;
      } else await t.create(v);
      s.close();
      ctx.refresh();
    },
  });
  s = sheet({ title: u ? 'ویرایش کاربر' : 'کاربر جدید', body: form });
}

// ---------------------------------------------------------------- گزارش فعالیت
const ACTIONS = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف', restore: 'بازیابی' };
const ACTION_TONE = { create: 'ok', update: '', delete: 'danger', restore: 'warn' };

async function activityPage(ctx) {
  ctx.setTitle('گزارش فعالیت');
  ctx.setBack('/more');
  const log = (await ctx.db.adapter.getAll('activity_log')).sort((a, b) => (a.at < b.at ? 1 : -1));
  const users = [...new Set(log.map((l) => l.userName).filter(Boolean))];
  let who = '';
  const listEl = h('div', { class: 'list' });
  const sel = h(
    'select',
    { class: 'filter-select', 'aria-label': 'فیلتر کاربر', onchange: () => ((who = sel.value), paint()) },
    h('option', { value: '' }, 'همه‌ی کاربران'),
    ...users.map((n) => h('option', { value: n }, n))
  );
  function paint() {
    const shown = log.filter((l) => !who || l.userName === who).slice(0, 300);
    listEl.replaceChildren(
      ...(shown.length
        ? shown.map((l) => {
            const body = h('div');
            const r = row({
              leading: icon('activity'),
              title: h('span', null, badge(ACTIONS[l.action] || l.action, ACTION_TONE[l.action]), ` ${tableLabel(l.table)}`, l.label ? ` · ${l.label}` : ''),
              subtitle: `${l.userName || 'نامشخص'} · ${fmtDateTime(l.at)}`,
              onclick: l.changes ? () => body.replaceChildren(...diffNodes(l.changes)) : null,
              trailing: l.changes ? undefined : h('span'),
            });
            return h('div', null, r, body);
          })
        : [emptyState('activity', 'فعالیتی ثبت نشده است')])
    );
  }
  paint();
  ctx.el.append(h('div', { class: 'form', style: { marginBottom: '10px' } }, sel), listEl);
}

function diffNodes(changes) {
  const show = (v) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join('، ') : typeof v === 'number' ? toFaDigits(v) : String(v));
  return Object.entries(changes).map(([k, c]) => h('div', { class: 'diff' }, `${fieldLabel(k)}: `, h('del', null, show(c.from)), ' ← ', h('ins', null, show(c.to))));
}

// ---------------------------------------------------------------- گوشی و ظاهر
async function devicePage(ctx) {
  ctx.setTitle('گوشی و ظاهر');
  ctx.setBack('/more');
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  ctx.el.append(
    section(
      'ظاهر',
      buildForm({
        values: { theme: session.theme },
        submitText: 'اعمال',
        fields: [
          {
            name: 'theme',
            label: 'پوسته',
            type: 'choice',
            options: [
              { value: 'auto', label: 'خودکار' },
              { value: 'light', label: 'روشن' },
              { value: 'dark', label: 'تیره' },
            ],
          },
        ],
        onSubmit: async (v) => {
          session.theme = v.theme;
          applyTheme();
          toast('اعمال شد');
        },
      })
    ),
    section(
      'حرف این گوشی در کدها',
      h('p', { class: 'muted' }, 'اگر برنامه را روی دو گوشی استفاده میکنید، روی هر گوشی یک حرف متفاوت (مثلاً A و B) بگذارید تا کدهای خودکار با هم تداخل نکنند. این کار را قبل از ثبت اطلاعات انجام دهید.'),
      buildForm({
        values: { tag: session.deviceTag },
        fields: [{ name: 'tag', label: 'حرف گوشی (۱ یا ۲ حرف انگلیسی)', dir: 'ltr', maxLength: 2, required: true, validate: (v) => (/^[A-Za-z]{1,2}$/.test(v) ? '' : 'فقط حرف انگلیسی') }],
        onSubmit: async (v) => {
          session.deviceTag = v.tag;
          toast('ذخیره شد');
        },
      })
    ),
    section(
      'ذخیره‌سازی',
      kv('وضعیت', persisted ? 'دائمی (مرورگر داده‌ها را پاک نمیکند)' : 'عادی'),
      persisted
        ? null
        : h(
            'button',
            {
              class: 'btn ghost pad-top',
              onclick: async () => {
                const ok = await requestPersistentStorage();
                toast(ok ? 'ذخیره‌سازی دائمی فعال شد' : 'مرورگر اجازه نداد؛ بک‌آپ‌گیری منظم را فراموش نکنید', ok ? 'ok' : 'err');
                ctx.refresh();
              },
            },
            'درخواست ذخیره‌سازی دائمی'
          ),
      kv('نسخه‌ی برنامه', APP_VERSION)
    )
  );
}

export function registerSettings() {
  registerModule({
    id: 'settings',
    title: 'تنظیمات',
    tables: ['settings', 'users'],
    tableLabels: { settings: 'تنظیمات', users: 'کاربران' },
    fieldLabels: { role: 'نقش', logo: 'لوگو', phone: 'تلفن', economicCode: 'کد اقتصادی', postalCode: 'کد پستی', invoiceNote: 'متن پایین فاکتور' },
    nav: { order: 90, label: 'بیشتر', icon: 'grid', path: '/more' },
    more: [
      { order: 10, label: 'اطلاعات شرکت', desc: 'نام، لوگو و مشخصات روی فاکتور', icon: 'building', path: '/settings/company' },
      { order: 20, label: 'کاربران', desc: 'مدیر و حسابدار', icon: 'users', path: '/settings/users' },
      { order: 80, label: 'گزارش فعالیت', desc: 'چه کسی چه کاری کرده', icon: 'activity', path: '/settings/activity' },
      { order: 90, label: 'گوشی و ظاهر', desc: 'پوسته، حرف گوشی در کدها، ذخیره‌سازی', icon: 'smartphone', path: '/settings/device' },
    ],
    // اولین اجرا: دو کاربر پیش‌فرض
    init: async (db) => {
      const t = db.table('users');
      if (!(await t.list({ includeDeleted: true })).length) {
        await t.create({ name: 'مدیر', role: 'admin' }, { silent: true });
        await t.create({ name: 'حسابدار', role: 'accountant' }, { silent: true });
      }
    },
    routes: [
      { path: '/more', render: morePage },
      { path: '/settings/company', render: companyPage },
      { path: '/settings/users', render: usersPage },
      { path: '/settings/activity', render: activityPage },
      { path: '/settings/device', render: devicePage },
    ],
  });
}

export { formatJalali };

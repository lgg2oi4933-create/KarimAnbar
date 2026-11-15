// ماژول اشخاص: مشتری، تأمین‌کننده، برون‌سپار (یک نفر میتونه چند نقش داشته باشه)
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, row, searchBar, section, tabs, toast } from '../../ui/components.js';
import { registerModule, getExtensions } from '../../core/registry.js';
import { matches, toFaDigits } from '../../core/util.js';
import { ROLES, roleLabel, partyName, normalizeMobile, isValidMobile, isValidNationalId } from './model.js';

const T = 'parties';

async function listPage(ctx) {
  ctx.setTitle('اشخاص');
  ctx.setBack(null);
  const all = await ctx.db.table(T).list();
  let role = ctx.query.role || 'all';
  let q = '';
  const listEl = h('div', { class: 'list' });

  const paint = () => {
    const items = all
      .filter((p) => (role === 'all' ? true : (p.roles || []).includes(role)))
      .filter((p) => matches([partyName(p), p.mobile, p.nationalId, p.code, p.address], q))
      .sort((a, b) => partyName(a).localeCompare(partyName(b), 'fa'));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((p) =>
            row({
              leading: icon('user'),
              title: partyName(p),
              subtitle: [p.mobile && toFaDigits(p.mobile), p.code].filter(Boolean).join(' · '),
              meta: h('div', null, (p.roles || []).map((r) => badge(roleLabel(r)))),
              onclick: () => ctx.go(`/parties/${p.id}`),
            })
          )
        : [
            emptyState(
              'users',
              all.length ? 'موردی پیدا نشد' : 'هنوز شخصی ثبت نشده است',
              all.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/parties/new') }, 'افزودن اولین شخص')
            ),
          ])
    );
  };
  ctx.el.append(
    searchBar((v) => ((q = v), paint()), 'جستجوی نام، موبایل، کد ملی...'),
    tabs([{ value: 'all', label: `همه (${toFaDigits(all.length)})` }, ...ROLES.map((r) => ({ value: r.value, label: r.label }))], role, (v) => ((role = v), paint())),
    listEl,
    fab(() => ctx.go(role === 'all' ? '/parties/new' : `/parties/new?role=${role}`), 'شخص جدید')
  );
  paint();
}

async function detailPage(ctx) {
  const p = await ctx.db.table(T).get(ctx.params.id);
  if (!p || p.deletedAt) {
    ctx.setTitle('شخص');
    ctx.setBack('/parties');
    ctx.el.append(emptyState('users', 'این شخص پیدا نشد'));
    return;
  }
  ctx.setTitle(partyName(p));
  ctx.setBack('/parties');
  ctx.setActions([
    h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/parties/${p.id}/edit`) }, icon('edit')),
    h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeParty(ctx, p) }, icon('trash')),
  ]);

  ctx.el.append(
    section(
      null,
      h('div', null, (p.roles || []).map((r) => badge(roleLabel(r))), badge(p.code, 'code')),
      kv('نام', p.firstName),
      kv('نام خانوادگی', p.lastName),
      kv('شرکت / کسب‌وکار', p.company),
      kv('موبایل', p.mobile && h('a', { class: 'link', href: `tel:${normalizeMobile(p.mobile)}`, dir: 'ltr' }, toFaDigits(p.mobile))),
      kv('کد ملی', p.nationalId && toFaDigits(p.nationalId)),
      kv('آدرس', p.address),
      kv('توضیحات', p.note)
    )
  );
  for (const ext of getExtensions('party.detail')) {
    const node = await ext(ctx, p);
    if (node) ctx.el.append(node);
  }
}

async function removeParty(ctx, p) {
  for (const guard of getExtensions('party.deleteGuard')) {
    const reason = await guard(ctx.db, p);
    if (reason) {
      await confirmDialog(reason, { title: 'حذف ممکن نیست', okText: 'متوجه شدم', cancelText: 'بستن' });
      return;
    }
  }
  const ok = await confirmDialog(`«${partyName(p)}» حذف شود؟`, { danger: true, okText: 'حذف', title: 'حذف شخص' });
  if (!ok) return;
  await ctx.db.table(T).remove(p.id);
  toast('حذف شد');
  ctx.go('/parties');
}

async function formPage(ctx) {
  const editing = !!ctx.params.id;
  const t = ctx.db.table(T);
  const existing = editing ? await t.get(ctx.params.id) : null;
  if (editing && (!existing || existing.deletedAt)) {
    ctx.el.append(emptyState('users', 'این شخص پیدا نشد'));
    return;
  }
  ctx.setTitle(editing ? 'ویرایش شخص' : 'شخص جدید');
  ctx.setBack(editing ? `/parties/${existing.id}` : '/parties');

  const presetRole = ctx.query.role;
  const values = existing || { roles: presetRole ? [presetRole] : [] };

  const form = buildForm({
    values,
    submitText: editing ? 'ذخیره تغییرات' : 'افزودن',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'roles', label: 'نقش', type: 'chips', required: true, options: ROLES },
      { name: 'firstName', label: 'نام' },
      { name: 'lastName', label: 'نام خانوادگی' },
      { name: 'company', label: 'نام شرکت / کسب‌وکار (اختیاری)' },
      {
        name: 'mobile',
        label: 'شماره موبایل',
        type: 'tel',
        placeholder: '۰۹۱۲۳۴۵۶۷۸۹',
        validate: (v) => (isValidMobile(v) ? '' : 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود'),
      },
      {
        name: 'nationalId',
        label: 'کد ملی',
        type: 'tel',
        maxLength: 10,
        validate: (v) => (isValidNationalId(v) ? '' : 'کد ملی معتبر نیست (۱۰ رقم)'),
      },
      { name: 'address', label: 'آدرس', type: 'textarea' },
      {
        name: 'code',
        label: 'کد شخص',
        type: 'text',
        dir: 'ltr',
        placeholder: 'خودکار ساخته میشود',
        hint: 'اگر خالی بگذارید خودکار ساخته میشود؛ قابل ویرایش است.',
      },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (!v.firstName && !v.lastName && !v.company) {
        setError('firstName', 'حداقل یکی از نام، نام خانوادگی یا نام شرکت را وارد کنید');
        return;
      }
      if (v.code && (await t.codeTaken(v.code, existing && existing.id))) {
        setError('code', 'این کد قبلاً استفاده شده است');
        return;
      }
      const data = { ...v, mobile: v.mobile ? normalizeMobile(v.mobile) : '' };
      if (editing) {
        if (!data.code) data.code = existing.code;
        await t.update(existing.id, data);
        toast('ذخیره شد');
        ctx.go(`/parties/${existing.id}`, { replace: true });
      } else {
        const rec = await t.create(data, { prefix: 'P' });
        toast('شخص اضافه شد');
        ctx.go(`/parties/${rec.id}`, { replace: true });
      }
    },
  });
  ctx.el.append(form);
}

export function registerParties() {
  registerModule({
    id: 'parties',
    title: 'اشخاص',
    tables: [T],
    tableLabels: { parties: 'اشخاص' },
    fieldLabels: {
      firstName: 'نام',
      lastName: 'نام خانوادگی',
      company: 'شرکت',
      roles: 'نقش‌ها',
      mobile: 'موبایل',
      nationalId: 'کد ملی',
      address: 'آدرس',
      code: 'کد',
      note: 'توضیحات',
    },
    nav: { order: 20, label: 'اشخاص', icon: 'users', path: '/parties' },
    home: {
      order: 20,
      label: 'اشخاص',
      icon: 'users',
      path: '/parties',
      count: async (db) => `${toFaDigits((await db.table(T).list()).length)} نفر`,
    },
    routes: [
      { path: '/parties', render: listPage },
      { path: '/parties/new', render: formPage },
      { path: '/parties/:id/edit', render: formPage },
      { path: '/parties/:id', render: detailPage },
    ],
  });
}

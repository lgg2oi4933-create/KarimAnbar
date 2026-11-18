// ماژول انبار: موجودی کالاها، ورود/خروج دستی، لات‌های ورق و کاردکس هر کالا.
// موجودی از فاکتورها و تولید حساب میشود؛ اینجا فقط تعدیل‌های دستی ذخیره میشود.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, kv, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { productPicker } from '../../ui/pickers.js';
import { registerModule, extend } from '../../core/registry.js';
import { matches, toFaDigits, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso } from '../../core/jalali.js';
import { KINDS, kindInfo, unitLabel, dimsText, isStockKind } from '../products/model.js';
import { REASONS_IN, REASONS_OUT, loadStockData, movementsFor, stockOf, runsFrom, runTotals, reasonLabel } from './stock.js';

const T = 'stock_moves';
const qty = (n, unit) => `${formatNumber(n, { decimals: 3 })} ${unitLabel(unit || 'kg')}`;

// ---------------------------------------------------------------- نمای کلی انبار
async function overviewPage(ctx) {
  ctx.setTitle('انبار');
  ctx.setBack('/more');
  const [allProducts, data] = await Promise.all([ctx.db.table('products').list(), loadStockData(ctx.db)]);
  const products = allProducts.filter((p) => isStockKind(p.kind));
  let kind = 'all';
  let q = '';
  const listEl = h('div', { class: 'list' });
  const paint = () => {
    const items = products
      .filter((p) => kind === 'all' || p.kind === kind)
      .filter((p) => matches([p.name, p.code, dimsText(p)], q))
      .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((p) => {
            const s = stockOf(p.id, data);
            return row({
              leading: icon('box'),
              title: p.name,
              subtitle: kindInfo(p.kind).label,
              meta: h('b', { class: s < 0 ? 'amount-debit' : '' }, qty(s, p.unit)),
              onclick: () => ctx.go(`/inventory/product/${p.id}`),
            });
          })
        : [emptyState('box', products.length ? 'موردی پیدا نشد' : 'ابتدا در بخش «کالاها» کالا تعریف کنید')])
    );
  };
  ctx.el.append(
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => moveSheet(ctx, null, {}) }, 'ورود / خروج دستی'),
      h('button', { class: 'btn ghost', onclick: () => ctx.go('/inventory/runs') }, 'شماره‌های تولید')),
    searchBar((v) => ((q = v), paint()), 'جستجوی کالا...'),
    tabs([{ value: 'all', label: 'همه' }, ...KINDS.filter((k) => isStockKind(k.value)).map((k) => ({ value: k.value, label: k.label }))], kind, (v) => ((kind = v), paint())),
    listEl
  );
  paint();
}

// ---------------------------------------------------------------- کاردکس کالا
async function productPage(ctx) {
  const p = await ctx.db.table('products').get(ctx.params.id);
  ctx.setBack('/inventory');
  if (!p || p.deletedAt) return void ctx.el.append(emptyState('box', 'این کالا پیدا نشد'));
  ctx.setTitle(`موجودی ${p.name}`);
  const data = await loadStockData(ctx.db);
  const rows = movementsFor(p.id, data);
  const bal = rows.length ? rows[rows.length - 1].balance : 0;
  ctx.el.append(
    section(null, h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'موجودی فعلی'), h('b', { class: bal < 0 ? 'amount-debit' : '' }, qty(bal, p.unit))), bal < 0 ? h('p', { class: 'muted' }, 'منفی یعنی بیشتر از ورودی‌های ثبت‌شده خارج شده؛ ورود اول دوره یا فاکتور خرید را بررسی کنید.') : null),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => moveSheet(ctx, null, { productId: p.id }) }, 'ورود / خروج دستی')),
    h(
      'div',
      { class: 'list pad-top' },
      rows.length
        ? rows
            .slice()
            .reverse()
            .map((r) =>
              row({
                leading: icon(r.qty > 0 ? 'plus' : 'back'),
                title: r.desc,
                subtitle: formatJalali(r.date),
                meta: h('div', null, h('div', { class: r.qty > 0 ? 'amount-credit' : 'amount-debit' }, `${r.qty > 0 ? '+' : ''}${formatNumber(r.qty, { decimals: 3 })}`), h('small', { class: 'muted' }, `مانده ${formatNumber(r.balance, { decimals: 3 })}`)),
                onclick: r.refType === 'move' ? async () => moveSheet(ctx, await ctx.db.table(T).get(r.refId), {}) : () => ctx.go(`/invoices/${r.refId}`),
              })
            )
        : [emptyState('box', 'هنوز حرکتی ندارد')]
    )
  );
}

// ---------------------------------------------------------------- ورود/خروج دستی
async function moveSheet(ctx, existing, preset = {}, done) {
  const redo = done || (() => ctx.refresh());
  let s;
  const form = buildForm({
    values: existing ? { ...existing, reasonIn: existing.reason, reasonOut: existing.reason } : { direction: 'in', date: todayIso(), reasonIn: 'opening', reasonOut: 'consume', ...preset },
    submitText: existing ? 'ذخیره' : 'ثبت',
    onCancel: () => s.close(),
    extraActions: existing
      ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('این ورود/خروج حذف شود؟', { danger: true, okText: 'حذف' }))) return;
          await ctx.db.table(T).remove(existing.id);
          s.close();
          toast('حذف شد');
          redo();
        } }, 'حذف')]
      : [],
    fields: [
      { name: 'productId', label: 'کالا', type: 'custom', required: true, render: (init) => productPicker({ db: ctx.db, value: init, getKinds: () => KINDS.filter((k) => isStockKind(k.value)).map((k) => k.value) }) },
      { name: 'direction', label: 'نوع', type: 'choice', options: [{ value: 'in', label: 'ورود به انبار' }, { value: 'out', label: 'خروج از انبار' }] },
      { name: 'qty', label: 'مقدار', type: 'number', min: 0, required: true, hint: 'کیلوگرم یا عدد، مطابق واحد کالا' },
      { name: 'date', label: 'تاریخ', type: 'date', required: true },
      { name: 'reasonIn', label: 'علت ورود', type: 'select', options: REASONS_IN, show: (v) => v.direction !== 'out' },
      { name: 'reasonOut', label: 'علت خروج', type: 'select', options: REASONS_OUT, show: (v) => v.direction === 'out' },
      { name: 'runTag', label: 'شماره تولید (اختیاری)', placeholder: 'مثلاً ۱۲ یا ۱۴۰۵-۰۳', hint: 'با زدن یک شماره‌ی یکسان روی خروج ورق/چسب و ورود سینی و ضایعات، حرکت‌ها در «شماره‌های تولید» کنار هم دیده میشوند.' },
      { name: 'code', label: 'کد', dir: 'ltr', placeholder: 'خودکار ساخته میشود' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (!(v.qty > 0)) return setError('qty', 'مقدار باید بیشتر از صفر باشد');
      const t = ctx.db.table(T);
      const { reasonIn, reasonOut, ...rest } = v;
      v = { ...rest, reason: v.direction === 'out' ? reasonOut : reasonIn };
      if (v.code && (await t.codeTaken(v.code, existing && existing.id))) return setError('code', 'این کد قبلاً استفاده شده است');
      if (existing) await t.update(existing.id, { ...v, code: v.code || existing.code });
      else await t.create(v, { prefix: 'SM' });
      s.close();
      toast('ثبت شد');
      redo();
    },
  });
  s = sheet({ title: existing ? 'ویرایش ورود/خروج' : 'ورود / خروج دستی', body: form });
}

// ---------------------------------------------------------------- شماره‌های تولید
async function runsPage(ctx) {
  ctx.setTitle('شماره‌های تولید');
  ctx.setBack('/inventory');
  const [moves, products] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('products').list()]);
  const runs = [...runsFrom(moves)].map(([tag, list]) => ({ tag, list, date: list.reduce((a, m) => (m.date > a ? m.date : a), '') })).sort((a, b) => (a.date < b.date ? 1 : -1));
  ctx.el.append(
    h(
      'div',
      { class: 'list' },
      runs.length
        ? runs.map((r) => row({ leading: icon('activity'), title: `تولید ${r.tag}`, subtitle: `${toFaDigits(r.list.length)} حرکت · آخرین ${formatJalali(r.date)}`, onclick: () => ctx.go(`/inventory/runs/${encodeURIComponent(r.tag)}`) }))
        : [emptyState('activity', 'هنوز «شماره تولید» ثبت نشده. هنگام ورود/خروج دستی میتوانید آن را وارد کنید.')]
    )
  );
  void products;
}

async function runDetail(ctx) {
  const tag = decodeURIComponent(ctx.params.tag);
  ctx.setBack('/inventory/runs');
  ctx.setTitle(`تولید ${tag}`);
  const [moves, products] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('products').list({ includeDeleted: true })]);
  const pById = new Map(products.map((p) => [p.id, p]));
  const list = moves.filter((m) => m.runTag === tag).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) return void ctx.el.append(emptyState('activity', 'حرکتی با این شماره پیدا نشد'));
  const totals = runTotals(list);
  ctx.el.append(
    section(
      'جمع هر کالا',
      h(
        'div',
        { class: 'list' },
        totals.map((t) => {
          const p = pById.get(t.productId) || {};
          return row({ leading: icon('box'), title: p.name || '—', subtitle: `ورود ${formatNumber(t.in, { decimals: 3 })} · خروج ${formatNumber(t.out, { decimals: 3 })}`, meta: h('b', null, qty(t.in - t.out, p.unit)), trailing: h('span') });
        })
      )
    ),
    section(
      'حرکت‌ها',
      h(
        'div',
        { class: 'list' },
        list.map((m) => {
          const p = pById.get(m.productId) || {};
          return row({ leading: icon(m.direction === 'in' ? 'plus' : 'back'), title: `${p.name || '—'} · ${reasonLabel(m.reason)}`, subtitle: formatJalali(m.date), meta: h('span', { class: m.direction === 'in' ? 'amount-credit' : 'amount-debit' }, qty(m.qty, p.unit)), onclick: async () => moveSheet(ctx, await ctx.db.table(T).get(m.id), {}) });
        })
      )
    )
  );
}

// ---------------------------------------------------------------- موجودی در صفحه‌ی کالا
async function productStockSection(ctx, p) {
  const data = await loadStockData(ctx.db);
  const s = stockOf(p.id, data);
  return section(
    'موجودی انبار',
    h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'موجودی فعلی'), h('b', { class: s < 0 ? 'amount-debit' : '' }, qty(s, p.unit))),
    h('div', { class: 'btn-row pad-top' }, h('button', { class: 'btn ghost', onclick: () => ctx.go(`/inventory/product/${p.id}`) }, 'کاردکس'), h('button', { class: 'btn ghost', onclick: () => moveSheet(ctx, null, { productId: p.id }) }, 'ورود / خروج دستی'))
  );
}

export function registerInventory() {
  extend('product.detail', productStockSection);
  extend('product.deleteGuard', async (db, p) => {
    const moves = await db.table(T).list();
    return moves.some((m) => m.productId === p.id) ? 'این کالا در ورود/خروج انبار استفاده شده. اگر اشتباه ثبت شده، ویرایشش کنید.' : null;
  });
  registerModule({
    id: 'inventory',
    title: 'انبار',
    tables: [T],
    tableLabels: { [T]: 'ورود/خروج انبار' },
    fieldLabels: { direction: 'نوع', qty: 'مقدار', reason: 'علت', productId: 'کالا', runTag: 'شماره تولید' },
    home: { order: 40, label: 'انبار', icon: 'box', path: '/inventory', count: async (db) => `${toFaDigits((await db.table('products').list()).filter((p) => isStockKind(p.kind)).length)} کالا` },
    more: { order: 7, label: 'انبار', desc: 'موجودی، ورود/خروج دستی و شماره‌های تولید', icon: 'box', path: '/inventory' },
    routes: [
      { path: '/inventory', render: overviewPage },
      { path: '/inventory/product/:id', render: productPage },
      { path: '/inventory/runs', render: runsPage },
      { path: '/inventory/runs/:tag', render: runDetail },
    ],
  });
}

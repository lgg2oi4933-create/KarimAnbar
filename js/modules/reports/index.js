// ماژول گزارش‌ها: خلاصه‌ی فروش و خرید، سود هر محصول، برترین مشتری‌ها، کم‌موجودی.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, emptyState, kv, row, section, sheet, toast } from '../../ui/components.js';
import { exportDoc } from '../../ui/exporter.js';
import { registerModule, extend } from '../../core/registry.js';
import { toFaDigits, formatMoney, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso, MONTHS, isoToJalaliParts } from '../../core/jalali.js';
import { isPaymentEffective } from '../../core/finance.js';
import { partyName } from '../parties/model.js';
import { unitLabel } from '../products/model.js';
import { getCompany } from '../settings/index.js';
import { monthRange } from '../hr/calc.js';
import { loadStockData } from '../inventory/stock.js';
import { profitByProduct, profitByCustomer, profitByMonth, periodTotals, lowStock } from './calc.js';

async function loadAll(db) {
  const [invoices, payments, checks, parties, products, stock] = await Promise.all([
    db.table('invoices').list(),
    db.table('payments').list(),
    db.table('checks').list({ includeDeleted: true }),
    db.table('parties').list({ includeDeleted: true }),
    db.table('products').list({ includeDeleted: true }),
    loadStockData(db),
  ]);
  return { invoices, payments, checks, parties, products, stock };
}

const q3 = (n) => formatNumber(n, { decimals: 3 });
const stat = (label, value, cls) => h('div', { class: 'stat' }, h('span', { class: 'muted' }, label), h('b', { class: cls || '' }, value));

function lowStockList(ctx, items, limit) {
  return h('div', { class: 'list' }, items.slice(0, limit || items.length).map(({ product: p, qty, min }) => row({ leading: icon('box'), title: p.name, subtitle: `حداقل ${q3(min)} ${unitLabel(p.unit)}`, meta: h('b', { class: 'amount-debit' }, `${q3(qty)} ${unitLabel(p.unit)}`), onclick: () => ctx.go(`/inventory/product/${p.id}`) })));
}

async function reportsPage(ctx) {
  ctx.setTitle('گزارش‌ها');
  ctx.setBack('/more');
  let { from, to } = monthRange(todayIso());
  const label = h('b');
  const out = h('div');
  let current = null;

  const periodText = () => {
    const a = isoToJalaliParts(from);
    const mr = monthRange(from);
    return mr.from === from && mr.to === to ? `${MONTHS[a.jm - 1]} ${toFaDigits(a.jy)}` : `${formatJalali(from)} تا ${formatJalali(to)}`;
  };

  async function paint() {
    label.textContent = periodText();
    const d = await loadAll(ctx.db);
    const pById = new Map(d.products.map((p) => [p.id, p]));
    const tot = periodTotals(d, from, to, isPaymentEffective);
    const pr = profitByProduct(d.invoices, from, to);
    const custs = profitByCustomer(d.invoices, d.parties, from, to);
    const ranges = [];
    for (let k = -5; k <= 0; k++) ranges.push({ ...monthRange(from, k) });
    const months = profitByMonth(d.invoices, ranges);
    const low = lowStock(d.products, d.stock);
    current = { pr, pById };
    out.replaceChildren(
      section(
        'خلاصه‌ی بازه',
        h('div', { class: 'split' }, stat('فروش (با مالیات)', formatMoney(tot.sales), 'amount-credit'), stat('خرید (با مالیات)', formatMoney(tot.purchases), 'amount-debit')),
        h('div', { class: 'split' }, stat('دریافتی', formatMoney(tot.received), 'amount-credit'), stat('پرداختی', formatMoney(tot.paid), 'amount-debit')),
        stat('سود ناخالص فروش', formatMoney(pr.profit), pr.profit < 0 ? 'amount-debit' : 'amount-credit'),
        pr.missing ? h('p', { class: 'muted' }, `${toFaDigits(pr.missing)} ردیف فروش «بدون قیمت تمام‌شده» است و در سود حساب نشده.`) : null
      ),
      section(
        'سود هر محصول',
        pr.rows.length
          ? h(
              'div',
              { class: 'lines' },
              pr.rows.map((r) => {
                const p = pById.get(r.productId);
                const name = p ? p.name : r.title || 'بدون نام';
                const unit = p ? unitLabel(p.unit) : '';
                return h(
                  'div',
                  { class: 'line-card' },
                  h('b', null, name),
                  kv('مقدار فروش', `${q3(r.qty)} ${unit}`),
                  kv('درآمد', formatMoney(r.revenue)),
                  kv('بهای تمام‌شده', formatMoney(r.cost)),
                  kv('سود', h('b', { class: r.profit < 0 ? 'amount-debit' : 'amount-credit' }, `${formatMoney(r.profit)}${r.margin == null ? '' : ` (${toFaDigits(r.margin)}٪)`}`)),
                  r.missing ? h('small', { class: 'muted' }, `${toFaDigits(r.missing)} ردیف بدون قیمت تمام‌شده`) : null
                );
              })
            )
          : h('p', { class: 'muted' }, 'در این بازه فروشی ثبت نشده.')
      ),
      section(
        'سود هر مشتری',
        custs.length ? h('div', { class: 'list' }, custs.map((t) => row({ leading: icon('user'), title: partyName(t.party) || '—', subtitle: `فروش ${formatMoney(t.sales)}`, meta: h('b', { class: t.profit < 0 ? 'amount-debit' : 'amount-credit' }, formatMoney(t.profit)), onclick: t.party ? () => ctx.go(`/parties/${t.party.id}`) : null }))) : h('p', { class: 'muted' }, 'فروشی ثبت نشده.')
      ),
      section(
        'سود ماه‌ها (۶ ماه تا پایان این بازه)',
        h('div', { class: 'list' }, months.map((m) => { const a = isoToJalaliParts(m.from); return row({ leading: icon('activity'), title: `${MONTHS[a.jm - 1]} ${toFaDigits(a.jy)}`, subtitle: `درآمد ${formatMoney(m.revenue)}`, meta: h('b', { class: m.profit < 0 ? 'amount-debit' : 'amount-credit' }, formatMoney(m.profit)), trailing: h('span') }); }))
      ),
      section('کم‌موجودی (هم‌اکنون)', low.length ? lowStockList(ctx, low) : h('p', { class: 'muted' }, 'کالایی زیر حداقل موجودی نیست. حداقل را در ویرایش هر کالا تعیین کنید.'))
    );
  }

  const setMonth = (off) => { const r = monthRange(from, off); from = r.from; to = r.to; paint(); };
  const customSheet = () => {
    let sh;
    const form = buildForm({
      values: { from, to },
      submitText: 'اعمال',
      onCancel: () => sh.close(),
      fields: [{ name: 'from', label: 'از تاریخ', type: 'date', required: true }, { name: 'to', label: 'تا تاریخ', type: 'date', required: true }],
      onSubmit: async (v, { setError }) => {
        if (v.to < v.from) return setError('to', 'پایان قبل از شروع است');
        from = v.from; to = v.to; sh.close(); paint();
      },
    });
    sh = sheet({ title: 'بازه‌ی دلخواه', body: form });
  };
  const exportProfit = async (kind) => {
    if (!current) return;
    try {
      const company = await getCompany(ctx.db);
      const f = (n) => (n == null ? '—' : formatNumber(n));
      const { pr, pById } = current;
      const doc = {
        title: 'گزارش سود هر محصول',
        company,
        meta: [['بازه', periodText()], ['تاریخ گزارش', formatJalali(todayIso())]],
        columns: [
          { label: 'محصول', w: 0.25, align: 'right' },
          { label: 'مقدار', w: 0.11, align: 'center' },
          { label: 'درآمد', w: 0.17, align: 'left' },
          { label: 'بها', w: 0.17, align: 'left' },
          { label: 'سود', w: 0.17, align: 'left' },
          { label: 'حاشیه', w: 0.13, align: 'center' },
        ],
        rows: pr.rows.map((r) => [(pById.get(r.productId) || {}).name || r.title || '', q3(r.qty), f(r.revenue), f(r.cost), f(r.profit), r.margin == null ? '—' : `${toFaDigits(r.margin)}٪`]),
        totals: [['جمع درآمد', f(pr.revenue)], ['جمع بها', f(pr.cost)], ['سود ناخالص (ریال)', f(pr.profit), { bold: true }]],
        footer: '',
      };
      const r = await exportDoc(doc, kind, 'گزارش_سود');
      if (r === 'downloaded') toast('فایل ذخیره شد');
    } catch (e) {
      console.error(e);
      toast('ساخت خروجی ناموفق بود: ' + e.message, 'err');
    }
  };

  ctx.el.append(
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '4px 0 8px' } }, h('button', { class: 'btn ghost small', onclick: () => setMonth(-1) }, '‹ ماه قبل'), label, h('button', { class: 'btn ghost small', onclick: () => setMonth(1) }, 'ماه بعد ›')),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost small', onclick: customSheet }, 'بازه‌ی دلخواه'), h('button', { class: 'btn ghost small', onclick: () => exportProfit('png') }, 'تصویر سود'), h('button', { class: 'btn ghost small', onclick: () => exportProfit('pdf') }, 'PDF سود')),
    h('div', { class: 'pad-top' }, out)
  );
  paint();
}

// ---------------------------------------------------------------- ویجت‌های صفحه‌ی خانه
async function lowStockWidget(ctx) {
  const d = await loadAll(ctx.db);
  const low = lowStock(d.products, d.stock);
  if (!low.length) return null;
  return section(`هشدار کم‌موجودی (${toFaDigits(low.length)} کالا)`, lowStockList(ctx, low, 5));
}

async function monthWidget(ctx) {
  const inv = await ctx.db.table('invoices').list();
  if (!inv.length) return null;
  const d = await loadAll(ctx.db);
  const { from, to } = monthRange(todayIso());
  const t = periodTotals(d, from, to, isPaymentEffective);
  const pr = profitByProduct(d.invoices, from, to);
  return section(
    'این ماه',
    h('div', { class: 'split' }, stat('فروش', formatMoney(t.sales), 'amount-credit'), stat('دریافتی', formatMoney(t.received), 'amount-credit')),
    h('div', { class: 'split' }, stat('خرید', formatMoney(t.purchases), 'amount-debit'), stat('سود ناخالص', formatMoney(pr.profit), pr.profit < 0 ? 'amount-debit' : 'amount-credit')),
    h('div', { class: 'btn-row pad-top' }, h('button', { class: 'btn ghost small', onclick: () => ctx.go('/reports') }, 'گزارش کامل'))
  );
}

export function registerReports() {
  extend('home.widget', lowStockWidget);
  extend('home.widget', monthWidget);
  registerModule({
    id: 'reports',
    title: 'گزارش‌ها',
    tables: [],
    more: { order: 3, label: 'گزارش‌ها', desc: 'سود هر محصول و مشتری، فروش و کم‌موجودی', icon: 'activity', path: '/reports' },
    routes: [{ path: '/reports', render: reportsPage }],
  });
}

// ماژول دفتر حساب: مانده‌ی بدهکار/بستانکار هر شخص، صورت‌حساب با خروجی تصویر/PDF و خلاصه‌ی صفحه‌ی اصلی.
// این ماژول جدول ندارد؛ فقط از روی فاکتورها، دریافت/پرداخت‌ها و چک‌ها حساب میکند.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, emptyState, kv, row, section, toast } from '../../ui/components.js';
import { exportDoc } from '../../ui/exporter.js';
import { registerModule, extend } from '../../core/registry.js';
import { toFaDigits, formatMoney, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso } from '../../core/jalali.js';
import { ledgerFor, filterLedger, balanceLabel, allBalances } from '../../core/finance.js';
import { partyName } from '../parties/model.js';
import { getCompany } from '../settings/index.js';

async function loadAll(db) {
  const [invoices, payments, checks] = await Promise.all([db.table('invoices').list(), db.table('payments').list(), db.table('checks').list({ includeDeleted: true })]);
  return { invoices, payments, checks };
}

function balanceText(b) {
  return b === 0 ? 'تسویه' : `${formatMoney(Math.abs(b))} ${balanceLabel(b)}`;
}
const balanceClass = (b) => (b > 0 ? 'amount-credit' : b < 0 ? 'amount-debit' : '');

// ---------------------------------------------------------------- کارت حساب در صفحه‌ی شخص
async function partyAccountCard(ctx, party) {
  const { invoices, payments, checks } = await loadAll(ctx.db);
  const res = ledgerFor(party, invoices, payments, checks);
  return section(
    'حساب',
    h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'مانده'), h('b', { class: balanceClass(res.balance) }, balanceText(res.balance))),
    h(
      'p',
      { class: 'muted' },
      res.balance > 0 ? 'بدهکار یعنی این شخص به شما بدهکار است.' : res.balance < 0 ? 'بستانکار یعنی شما به این شخص بدهکارید.' : ''
    ),
    h(
      'div',
      { class: 'btn-row pad-top' },
      h('button', { class: 'btn primary', onclick: () => ctx.go(`/parties/${party.id}/statement`) }, 'صورت‌حساب'),
      h('button', { class: 'btn ghost', onclick: () => ctx.go(`/payments/new?dir=in&party=${party.id}`) }, 'ثبت دریافت'),
      h('button', { class: 'btn ghost', onclick: () => ctx.go(`/payments/new?dir=out&party=${party.id}`) }, 'ثبت پرداخت')
    ),
    h(
      'div',
      { class: 'btn-row pad-top' },
      h('button', { class: 'btn ghost', onclick: () => ctx.go(`/invoices/new?type=sale&party=${party.id}`) }, 'فاکتور فروش'),
      h('button', { class: 'btn ghost', onclick: () => ctx.go(`/invoices/new?type=purchase&party=${party.id}`) }, 'فاکتور خرید')
    )
  );
}

// ---------------------------------------------------------------- صورت‌حساب
async function statementPage(ctx) {
  const party = await ctx.db.table('parties').get(ctx.params.id);
  ctx.setBack(`/parties/${ctx.params.id}`);
  if (!party || party.deletedAt) {
    ctx.setTitle('صورت‌حساب');
    ctx.el.append(emptyState('users', 'این شخص پیدا نشد'));
    return;
  }
  ctx.setTitle(`صورت‌حساب ${partyName(party)}`);
  const { invoices, payments, checks } = await loadAll(ctx.db);
  const full = ledgerFor(party, invoices, payments, checks);
  let from = ctx.query.from || '';
  let to = ctx.query.to || '';

  const out = h('div');
  const buildView = () => {
    const res = filterLedger(full, from, to);
    const rows = res.shown;
    const sumD = rows.reduce((a, r) => a + r.debit, 0);
    const sumC = rows.reduce((a, r) => a + r.credit, 0);
    const endBalance = rows.length ? rows[rows.length - 1].balance : from ? 0 : 0;
    out.replaceChildren(
      section(
        null,
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'مانده در پایان'), h('b', { class: balanceClass(endBalance) }, balanceText(endBalance))),
        kv('جمع بدهکار', formatMoney(sumD)),
        kv('جمع بستانکار', formatMoney(sumC))
      ),
      h(
        'div',
        { class: 'list' },
        rows.length
          ? rows
              .slice()
              .reverse()
              .map((r) =>
                row({
                  leading: icon(r.kind === 'invoice' ? 'grid' : r.kind === 'payment' ? 'activity' : 'folder'),
                  title: r.desc,
                  subtitle: `${r.date && r.date !== '0000-00-00' ? formatJalali(r.date) : ''}${r.ignored ? ' · بی‌اثر' : ''}`,
                  meta: h(
                    'div',
                    null,
                    r.debit ? h('div', { class: 'amount-credit' }, `${formatNumber(r.debit)} بدهکار`) : null,
                    r.credit ? h('div', { class: 'amount-debit' }, `${formatNumber(r.credit)} بستانکار`) : null,
                    h('small', { class: 'muted' }, `مانده ${balanceText(r.balance)}`)
                  ),
                  onclick: r.refType ? () => ctx.go(`/${r.refType === 'invoice' ? 'invoices' : 'payments'}/${r.refId}`) : null,
                  trailing: r.refType ? undefined : h('span'),
                })
              )
          : [emptyState('folder', 'گردشی در این بازه نیست')]
      )
    );
  };

  const exportStatement = async (kind) => {
    try {
      const res = filterLedger(full, from, to);
      const company = await getCompany(ctx.db);
      const rows = res.shown;
      const endBalance = rows.length ? rows[rows.length - 1].balance : 0;
      const doc = {
        title: 'صورت‌حساب',
        company,
        meta: [
          ['نام', partyName(party)],
          ['تاریخ گزارش', formatJalali(todayIso())],
          ...(party.mobile ? [['موبایل', toFaDigits(party.mobile)]] : []),
          ...(from || to ? [['بازه', `${from ? formatJalali(from) : 'ابتدا'} تا ${to ? formatJalali(to) : 'امروز'}`]] : []),
        ],
        columns: [
          { label: 'تاریخ', w: 0.14, align: 'center' },
          { label: 'شرح', w: 0.32, align: 'right' },
          { label: 'بدهکار', w: 0.17, align: 'left' },
          { label: 'بستانکار', w: 0.17, align: 'left' },
          { label: 'مانده', w: 0.2, align: 'left' },
        ],
        rows: rows.map((r) => [
          r.date && r.date !== '0000-00-00' ? formatJalali(r.date) : '',
          r.desc,
          r.debit ? formatNumber(r.debit) : '',
          r.credit ? formatNumber(r.credit) : '',
          `${formatNumber(Math.abs(r.balance))} ${r.balance === 0 ? '' : balanceLabel(r.balance)}`.trim(),
        ]),
        totals: [
          ['جمع بدهکار', formatNumber(rows.reduce((a, r) => a + r.debit, 0))],
          ['جمع بستانکار', formatNumber(rows.reduce((a, r) => a + r.credit, 0))],
          ['مانده نهایی (ریال)', endBalance === 0 ? 'تسویه' : `${formatNumber(Math.abs(endBalance))} ${balanceLabel(endBalance)}`, { bold: true }],
        ],
        footer: 'بدهکار یعنی طرف حساب به ما بدهکار است؛ بستانکار یعنی ما به طرف حساب بدهکاریم.',
      };
      const r = await exportDoc(doc, kind, `صورتحساب_${partyName(party)}`);
      if (r === 'downloaded') toast('فایل ذخیره شد');
    } catch (e) {
      console.error(e);
      toast('ساخت خروجی ناموفق بود: ' + e.message, 'err');
    }
  };

  const filter = buildForm({
    values: { from, to },
    submitText: 'اعمال بازه',
    fields: [
      { name: 'from', label: 'از تاریخ', type: 'date' },
      { name: 'to', label: 'تا تاریخ', type: 'date' },
    ],
    onSubmit: async (v) => {
      from = v.from;
      to = v.to;
      buildView();
    },
  });
  ctx.el.append(
    section('بازه‌ی زمانی', filter),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => exportStatement('png') }, 'تصویر'), h('button', { class: 'btn ghost', onclick: () => exportStatement('pdf') }, 'PDF')),
    h('div', { class: 'pad-top' }, out)
  );
  buildView();
}

// ---------------------------------------------------------------- خلاصه‌ی صفحه‌ی اصلی
async function balancesWidget(ctx) {
  const parties = await ctx.db.table('parties').list();
  if (!parties.length) return null;
  const { invoices, payments, checks } = await loadAll(ctx.db);
  const bal = allBalances(parties, invoices, payments, checks);
  let receivable = 0;
  let payable = 0;
  for (const b of bal.values()) b > 0 ? (receivable += b) : (payable += -b);
  if (!receivable && !payable) return null;
  const top = parties
    .map((p) => ({ p, b: bal.get(p.id) || 0 }))
    .filter((x) => x.b > 0)
    .sort((a, b) => b.b - a.b)
    .slice(0, 5);
  return section(
    'وضعیت حساب‌ها',
    h(
      'div',
      { class: 'split' },
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'طلب ما (بدهکاران)'), h('b', { class: 'amount-credit' }, formatMoney(receivable))),
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'بدهی ما (بستانکاران)'), h('b', { class: 'amount-debit' }, formatMoney(payable)))
    ),
    top.length
      ? h('div', { class: 'list pad-top' }, top.map(({ p, b }) => row({ leading: icon('user'), title: partyName(p), meta: formatMoney(b), onclick: () => ctx.go(`/parties/${p.id}`) })))
      : null
  );
}

export function registerLedger() {
  extend('party.detail', partyAccountCard);
  extend('home.widget', balancesWidget);
  // شخصی که فاکتور یا دریافت/پرداخت دارد حذف نمیشود تا حساب‌ها یتیم نشوند
  extend('party.deleteGuard', async (db, p) => {
    const [inv, pay] = await Promise.all([db.table('invoices').list(), db.table('payments').list()]);
    const n = inv.filter((i) => i.partyId === p.id).length + pay.filter((x) => x.partyId === p.id).length;
    return n ? `برای این شخص ${toFaDigits(n)} فاکتور یا دریافت/پرداخت ثبت شده. اول آن‌ها را حذف یا به شخص دیگری منتقل کنید.` : null;
  });
  registerModule({
    id: 'ledger',
    title: 'دفتر حساب',
    tables: [],
    routes: [{ path: '/parties/:id/statement', render: statementPage }],
  });
}

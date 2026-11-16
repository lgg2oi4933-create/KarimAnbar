// ماژول چک: فهرست و سررسید، وصول/برگشت، خرج کردن، یادآوری روی صفحه‌ی اصلی
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { partyPicker } from '../../ui/pickers.js';
import { registerModule, extend } from '../../core/registry.js';
import { matches, toFaDigits, formatMoney } from '../../core/util.js';
import { formatJalali, todayIso, weekdayName } from '../../core/jalali.js';
import { indexById, checksDueSoon } from '../../core/finance.js';
import { diffDaysIso } from '../../core/jalali.js';
import { partyName } from '../parties/model.js';
import { CHECK_DIRS, dirLabel, checkStatus, dueInfo } from './model.js';
import { invoiceSelect } from '../payments/index.js';
import { endorseCheck, unendorseCheck, setCheckStatus, deletePaymentCascade } from '../payments/service.js';

const T = 'checks';
const FILTERS = [
  { value: 'open', label: 'در جریان' },
  { value: 'cleared', label: 'وصول / پاس' },
  { value: 'bounced', label: 'برگشتی' },
  { value: 'endorsed', label: 'خرج‌شده' },
  { value: 'all', label: 'همه' },
];

// ---------------------------------------------------------------- فهرست
async function listPage(ctx) {
  ctx.setTitle('چک‌ها');
  ctx.setBack('/more');
  const [checks, parties] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('parties').list({ includeDeleted: true })]);
  const partiesById = indexById(parties);
  const today = todayIso();
  let dir = ctx.query.dir === 'issued' ? 'issued' : ctx.query.dir === 'received' ? 'received' : 'all';
  let status = ctx.query.status || 'open';
  let q = '';
  const listEl = h('div', { class: 'list' });
  const summaryEl = h('div', { class: 'split' });

  const matchStatus = (c) => {
    const k = checkStatus(c).key;
    if (status === 'all') return true;
    if (status === 'open') return k === 'pending';
    return k === status;
  };

  const paint = () => {
    const items = checks
      .filter((c) => dir === 'all' || c.direction === dir)
      .filter(matchStatus)
      .filter((c) => matches([c.number, c.bank, c.owner, partyName(partiesById.get(c.partyId)), formatJalali(c.dueDate)], q))
      .sort((a, b) => (a.dueDate || '9999') .localeCompare(b.dueDate || '9999'));

    const sum = (d) => checks.filter((c) => c.direction === d && checkStatus(c).key === 'pending').reduce((a, c) => a + (Number(c.amount) || 0), 0);
    summaryEl.replaceChildren(
      h('div', { class: 'card stat' }, h('span', { class: 'muted' }, 'چک دریافتی در جریان'), h('b', { class: 'amount-credit' }, formatMoney(sum('received')))),
      h('div', { class: 'card stat' }, h('span', { class: 'muted' }, 'چک پرداختی در جریان'), h('b', { class: 'amount-debit' }, formatMoney(sum('issued'))))
    );

    listEl.replaceChildren(
      ...(items.length
        ? items.map((c) => {
            const st = checkStatus(c);
            const due = st.key === 'pending' ? dueInfo(c, today) : { text: formatJalali(c.dueDate), tone: '' };
            return row({
              leading: icon('check'),
              title: `${partyName(partiesById.get(c.partyId)) || '—'}`,
              subtitle: `${dirLabel(c.direction)} · ${c.bank || ''} · ${toFaDigits(c.number || '')}`,
              meta: h('div', null, h('div', null, formatMoney(c.amount)), badge(st.label, st.tone), due.text ? badge(due.text, due.tone) : null),
              onclick: () => ctx.go(`/checks/${c.id}`),
            });
          })
        : [emptyState('check', checks.length ? 'موردی پیدا نشد' : 'هنوز چکی ثبت نشده است', checks.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/payments/new?dir=in&method=check') }, 'ثبت چک دریافتی'))])
    );
  };

  ctx.el.append(
    summaryEl,
    searchBar((v) => ((q = v), paint()), 'جستجوی شماره، بانک، نام...'),
    tabs([{ value: 'all', label: 'همه' }, ...CHECK_DIRS], dir, (v) => ((dir = v), paint())),
    tabs(FILTERS, status, (v) => ((status = v), paint())),
    listEl,
    fab(() => ctx.go('/payments/new?dir=in&method=check'), 'ثبت چک')
  );
  paint();
}

// ---------------------------------------------------------------- جزئیات
async function detailPage(ctx) {
  const c = await ctx.db.table(T).get(ctx.params.id);
  ctx.setBack('/checks');
  if (!c || c.deletedAt) {
    ctx.setTitle('چک');
    ctx.el.append(emptyState('check', 'این چک پیدا نشد'));
    return;
  }
  const [party, endorsedTo, payment] = await Promise.all([
    ctx.db.table('parties').get(c.partyId),
    c.endorsedToId ? ctx.db.table('parties').get(c.endorsedToId) : null,
    c.paymentId ? ctx.db.table('payments').get(c.paymentId) : null,
  ]);
  const st = checkStatus(c);
  const due = st.key === 'pending' ? dueInfo(c, todayIso()) : null;
  const received = c.direction === 'received';
  ctx.setTitle(`چک ${toFaDigits(c.number || '')}`);
  ctx.setActions([
    payment ? h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/payments/${payment.id}/edit`) }, icon('edit')) : null,
    payment ? h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeCheck(ctx, c, payment) }, icon('trash')) : null,
  ].filter(Boolean));

  ctx.el.append(
    section(
      null,
      h('div', null, badge(dirLabel(c.direction), received ? 'ok' : 'warn'), badge(st.label, st.tone), due && due.text ? badge(due.text, due.tone) : null, badge(c.code, 'code')),
      kv('مبلغ', formatMoney(c.amount)),
      kv(received ? 'دریافت از' : 'پرداخت به', party ? h('a', { class: 'link', href: `#/parties/${party.id}` }, partyName(party)) : '—'),
      kv('شماره چک', c.number && toFaDigits(c.number)),
      kv('بانک', c.bank),
      kv('صاحب حساب', c.owner),
      kv('تاریخ صدور', c.issueDate ? formatJalali(c.issueDate) : ''),
      kv('تاریخ سررسید', c.dueDate ? `${weekdayName(c.dueDate)} ${formatJalali(c.dueDate)}` : ''),
      kv(received ? 'تاریخ وصول' : 'تاریخ پاس شدن', c.clearedDate ? formatJalali(c.clearedDate) : ''),
      kv('خرج شده به', endorsedTo ? h('a', { class: 'link', href: `#/parties/${endorsedTo.id}` }, `${partyName(endorsedTo)} · ${formatJalali(c.endorsedDate)}`) : ''),
      kv('دریافت/پرداخت مرتبط', payment && !payment.deletedAt ? h('a', { class: 'link', href: `#/payments/${payment.id}` }, payment.code) : '')
    )
  );

  const acts = h('div', { class: 'btn-row' });
  if (st.key === 'pending' || st.key === 'endorsed') {
    acts.append(
      h('button', { class: 'btn primary', onclick: () => statusSheet(ctx, c, 'cleared') }, received ? 'وصول شد' : 'پاس شد'),
      h('button', { class: 'btn danger', onclick: () => bounceCheck(ctx, c) }, 'برگشت خورد')
    );
  } else {
    acts.append(h('button', { class: 'btn ghost', onclick: async () => (await setCheckStatus(ctx.db, c, 'pending'), toast('به «در جریان» برگشت'), ctx.refresh()) }, 'برگرداندن به «در جریان»'));
  }
  ctx.el.append(acts);

  if (received && st.key === 'pending') {
    ctx.el.append(h('div', { class: 'btn-row pad-top' }, h('button', { class: 'btn ghost', onclick: () => endorseSheet(ctx, c) }, 'خرج کردن چک (پرداخت به شخص دیگر)')));
  }
  if (c.endorsementPaymentId && st.key !== 'bounced') {
    ctx.el.append(
      h(
        'div',
        { class: 'btn-row pad-top' },
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: async () => {
              if (!(await confirmDialog('خرج این چک لغو شود؟ پرداخت ثبت‌شده برای آن شخص حذف میشود.', { okText: 'لغو خرج' }))) return;
              await unendorseCheck(ctx.db, c);
              toast('خرج لغو شد');
              ctx.refresh();
            },
          },
          'لغو خرج'
        )
      )
    );
  }
  if (st.key === 'bounced') {
    ctx.el.append(h('p', { class: 'muted pad-top' }, 'چک برگشتی در حساب‌ها اثری ندارد؛ یعنی بدهی طرف حساب (و در صورت خرج، بدهی شما به آن شخص) دوباره برقرار میشود.'));
  }
}

function statusSheet(ctx, c, status) {
  let s;
  const form = buildForm({
    values: { date: todayIso() },
    submitText: 'ثبت',
    onCancel: () => s.close(),
    fields: [{ name: 'date', label: c.direction === 'received' ? 'تاریخ وصول' : 'تاریخ پاس شدن', type: 'date', required: true }],
    onSubmit: async (v) => {
      await setCheckStatus(ctx.db, c, status, v.date);
      s.close();
      toast('ثبت شد');
      ctx.refresh();
    },
  });
  s = sheet({ title: c.direction === 'received' ? 'وصول چک' : 'پاس شدن چک', body: form });
}

async function bounceCheck(ctx, c) {
  const msg = c.endorsementPaymentId
    ? 'این چک خرج شده بود. با برگشت، هم دریافت از مشتری و هم پرداخت به شخص دوم بی‌اثر میشود. ادامه میدهید؟'
    : 'چک برگشت خورده ثبت شود؟ اثر آن از حساب طرف حساب برداشته میشود.';
  if (!(await confirmDialog(msg, { danger: true, okText: 'برگشت خورد', title: 'برگشت چک' }))) return;
  await setCheckStatus(ctx.db, c, 'bounced');
  toast('ثبت شد');
  ctx.refresh();
}

function endorseSheet(ctx, c) {
  let s;
  let form;
  let invSel;
  form = buildForm({
    values: { date: todayIso(), partyId: '' },
    submitText: 'خرج چک',
    onCancel: () => s.close(),
    fields: [
      { name: 'partyId', label: 'خرج به', type: 'custom', required: true, render: (init) => partyPicker({ db: ctx.db, value: init, getRoles: () => ['supplier', 'subcontractor'], placeholder: 'انتخاب تأمین‌کننده...', onChange: () => setTimeout(() => invSel && invSel.refreshIfChanged(), 0) }) },
      { name: 'invoiceId', label: 'مربوط به فاکتور (اختیاری)', type: 'custom', render: (init) => (invSel = invoiceSelect({ db: ctx.db, getDir: () => 'out', getPartyId: () => (form ? form.control('partyId').getValue() : ''), initial: init })) },
      { name: 'date', label: 'تاریخ', type: 'date', required: true },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (v.partyId === c.partyId) return setError('partyId', 'نمیشود چک را به همان شخص خرج کرد');
      await endorseCheck(ctx.db, c, v);
      s.close();
      toast('چک خرج شد');
      ctx.refresh();
    },
  });
  form.addEventListener('click', () => invSel && invSel.refreshIfChanged());
  form.addEventListener('input', () => invSel && invSel.refreshIfChanged());
  s = sheet({ title: 'خرج کردن چک', body: [h('p', { class: 'muted' }, `مبلغ ${formatMoney(c.amount)} از بدهی شما به آن شخص کم میشود.`), form] });
}

async function removeCheck(ctx, c, payment) {
  const extra = c.endorsementPaymentId ? ' خرج آن هم حذف میشود.' : '';
  if (!(await confirmDialog(`چک ${toFaDigits(c.number || '')} و ${dirLabel(payment.direction)} مرتبط با آن حذف شود؟${extra}`, { danger: true, okText: 'حذف', title: 'حذف چک' }))) return;
  await deletePaymentCascade(ctx.db, payment);
  toast('حذف شد');
  ctx.go('/checks');
}

// ---------------------------------------------------------------- یادآوری روی صفحه‌ی اصلی
async function dueWidget(ctx) {
  const [checks, parties] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('parties').list({ includeDeleted: true })]);
  const partiesById = indexById(parties);
  const today = todayIso();
  const due = checksDueSoon(checks, today, 7, diffDaysIso);
  if (!due.length) return null;
  return section(
    `چک‌های نزدیک سررسید (${toFaDigits(due.length)})`,
    h(
      'div',
      { class: 'list' },
      due.slice(0, 6).map(({ check: c }) => {
        const d = dueInfo(c, today);
        return row({
          leading: icon('check'),
          title: partyName(partiesById.get(c.partyId)) || '—',
          subtitle: `${dirLabel(c.direction)} · ${toFaDigits(c.number || '')} · ${formatMoney(c.amount)}`,
          meta: badge(d.text, d.tone),
          onclick: () => ctx.go(`/checks/${c.id}`),
        });
      })
    ),
    due.length > 6 ? h('a', { class: 'link', href: '#/checks' }, 'همه‌ی چک‌ها') : null
  );
}

export function registerChecks() {
  extend('home.widget', dueWidget);
  registerModule({
    id: 'checks',
    title: 'چک‌ها',
    tables: [T],
    tableLabels: { checks: 'چک‌ها' },
    fieldLabels: { number: 'شماره چک', bank: 'بانک', owner: 'صاحب حساب', dueDate: 'سررسید', issueDate: 'تاریخ صدور', status: 'وضعیت چک', endorsedToId: 'خرج به' },
    home: {
      order: 17,
      label: 'چک‌ها',
      icon: 'check',
      path: '/checks',
      count: async (db) => {
        const n = (await db.table(T).list()).filter((c) => checkStatus(c).key === 'pending').length;
        return `${toFaDigits(n)} چک در جریان`;
      },
    },
    more: { order: 6, label: 'چک‌ها', desc: 'سررسید، وصول، برگشت و خرج', icon: 'check', path: '/checks' },
    routes: [
      { path: '/checks', render: listPage },
      { path: '/checks/:id', render: detailPage },
    ],
  });
}

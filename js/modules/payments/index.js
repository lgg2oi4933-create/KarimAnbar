// ماژول دریافت و پرداخت: نقد، چک، حواله. چک‌ها خودکار در ماژول چک ثبت میشوند.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { partyPicker } from '../../ui/pickers.js';
import { registerModule } from '../../core/registry.js';
import { matches, toFaDigits, formatMoney } from '../../core/util.js';
import { formatJalali, todayIso, weekdayName } from '../../core/jalali.js';
import { invoiceTotals, indexById, paidForInvoice } from '../../core/finance.js';
import { partyName } from '../parties/model.js';
import { STATUS_OPTIONS } from '../checks/model.js';
import { METHODS, DIRS, methodLabel, dirLabel, rolesForDir } from './model.js';
import { savePayment, deletePaymentCascade } from './service.js';

const T = 'payments';

// ---------------------------------------------------------------- فهرست
async function listPage(ctx) {
  ctx.setTitle('دریافت و پرداخت');
  ctx.setBack('/more');
  const [payments, parties, checks] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('parties').list({ includeDeleted: true }), ctx.db.table('checks').list({ includeDeleted: true })]);
  const partiesById = indexById(parties);
  const checksById = indexById(checks);
  let dir = ctx.query.dir === 'in' || ctx.query.dir === 'out' ? ctx.query.dir : 'all';
  let q = '';
  const listEl = h('div', { class: 'list' });

  const paint = () => {
    const items = payments
      .filter((p) => dir === 'all' || p.direction === dir)
      .filter((p) => matches([partyName(partiesById.get(p.partyId)), p.code, methodLabel(p.method), formatJalali(p.date)], q))
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((p) => {
            const c = p.checkId ? checksById.get(p.checkId) : null;
            const bounced = c && c.status === 'bounced';
            return row({
              leading: icon('activity'),
              title: `${dirLabel(p.direction)} ${p.direction === 'in' ? 'از' : 'به'} ${partyName(partiesById.get(p.partyId)) || '—'}`,
              subtitle: `${p.kind === 'endorse' ? 'خرج چک' : methodLabel(p.method)}${c && c.number ? ' ' + toFaDigits(c.number) : ''} · ${formatJalali(p.date)} · ${p.code}`,
              meta: h('div', { class: p.direction === 'in' ? 'amount-credit' : 'amount-debit' }, formatMoney(p.amount), bounced ? badge('برگشتی', 'danger') : null),
              onclick: () => ctx.go(`/payments/${p.id}`),
            });
          })
        : [
            emptyState(
              'activity',
              payments.length ? 'موردی پیدا نشد' : 'هنوز دریافت یا پرداختی ثبت نشده است',
              payments.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/payments/new?dir=in') }, 'ثبت اولین دریافت')
            ),
          ])
    );
  };
  ctx.el.append(
    searchBar((v) => ((q = v), paint()), 'جستجوی نام، کد، تاریخ...'),
    tabs([{ value: 'all', label: 'همه' }, ...DIRS.map((d) => ({ value: d.value, label: d.label }))], dir, (v) => ((dir = v), paint())),
    listEl,
    fab(() => ctx.go(`/payments/new?dir=${dir === 'out' ? 'out' : 'in'}`), 'ثبت جدید')
  );
  paint();
}

// ---------------------------------------------------------------- انتخاب فاکتور مرتبط
export function invoiceSelect({ db, getDir, getPartyId, initial }) {
  const select = h('select', { 'aria-label': 'فاکتور مرتبط' });
  let last = '';
  async function refresh(keep) {
    const dir = getDir();
    const partyId = getPartyId();
    const key = `${dir}|${partyId}`;
    const current = keep !== undefined ? keep : select.value;
    select.replaceChildren(h('option', { value: '' }, partyId ? 'بدون فاکتور (پرداخت علی‌الحساب)' : 'ابتدا شخص را انتخاب کنید'));
    last = key;
    if (!partyId) return;
    const [invoices, payments, checks] = await Promise.all([db.table('invoices').list(), db.table(T).list(), db.table('checks').list({ includeDeleted: true })]);
    const checksById = indexById(checks);
    const wanted = dir === 'in' ? 'sale' : 'purchase';
    for (const inv of invoices.filter((i) => i.partyId === partyId && i.type === wanted).sort((a, b) => (a.date < b.date ? 1 : -1))) {
      const total = invoiceTotals(inv).total;
      const remain = total - paidForInvoice(inv.id, payments, checksById);
      if (remain <= 0 && inv.id !== current) continue;
      select.append(h('option', { value: inv.id }, `${inv.code} · ${formatJalali(inv.date)} · مانده ${formatMoney(Math.max(remain, 0))}`));
    }
    select.value = [...select.options].some((o) => o.value === current) ? current : '';
  }
  const wrap = h('div', null, select);
  wrap.getValue = () => select.value;
  wrap.refreshIfChanged = () => {
    if (last !== `${getDir()}|${getPartyId()}`) refresh('');
  };
  wrap.select = select;
  refresh(initial || '');
  return wrap;
}

// ---------------------------------------------------------------- فرم
async function formPage(ctx) {
  const editing = !!ctx.params.id;
  const pt = ctx.db.table(T);
  const existing = editing ? await pt.get(ctx.params.id) : null;
  ctx.setBack(editing ? `/payments/${ctx.params.id}` : '/payments');
  if (editing && (!existing || existing.deletedAt)) {
    ctx.el.append(emptyState('activity', 'این مورد پیدا نشد'));
    return;
  }
  if (existing && existing.kind === 'endorse') {
    ctx.setTitle('خرج چک');
    ctx.el.append(emptyState('activity', 'این پرداخت از «خرج چک» ساخته شده. برای تغییر، از صفحه‌ی چک خرجش را لغو و دوباره ثبت کنید.'));
    return;
  }
  const check = existing && existing.checkId ? await ctx.db.table('checks').get(existing.checkId) : null;
  const q = ctx.query;
  const dir0 = existing ? existing.direction : q.dir === 'out' ? 'out' : 'in';
  ctx.setTitle(editing ? 'ویرایش' : dir0 === 'in' ? 'دریافت جدید' : 'پرداخت جدید');

  const values = existing
    ? {
        ...existing,
        ckNumber: check && check.number,
        ckBank: check && check.bank,
        ckOwner: check && check.owner,
        ckIssue: check && check.issueDate,
        ckDue: check && check.dueDate,
        ckStatus: (check && check.status) || 'pending',
      }
    : {
        direction: dir0,
        method: q.method === 'check' ? 'check' : 'cash',
        date: todayIso(),
        partyId: q.party || '',
        invoiceId: q.invoice || '',
        amount: q.amount ? Number(q.amount) : null,
        ckStatus: 'pending',
      };

  let form;
  let invSel;
  const getDir = () => {
    const on = form && form.control('direction').querySelector('.chip.on');
    return on ? on.dataset.v : dir0;
  };

  form = buildForm({
    values,
    submitText: editing ? 'ذخیره تغییرات' : 'ثبت',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'direction', label: 'نوع', type: 'choice', options: [{ value: 'in', label: 'دریافت (از مشتری)' }, { value: 'out', label: 'پرداخت (به تأمین‌کننده)' }] },
      {
        name: 'partyId',
        label: 'شخص',
        type: 'custom',
        required: true,
        render: (init) => partyPicker({ db: ctx.db, value: init, getRoles: () => rolesForDir(getDir()), placeholder: 'انتخاب شخص...' }),
      },
      { name: 'date', label: 'تاریخ', type: 'date', required: true },
      { name: 'amount', label: 'مبلغ (ریال)', type: 'number', money: true, required: true, min: 1 },
      { name: 'method', label: 'روش', type: 'choice', options: METHODS },
      { name: 'ckNumber', label: 'شماره چک', type: 'tel', required: true, show: (v) => v.method === 'check' },
      { name: 'ckBank', label: 'بانک', required: true, show: (v) => v.method === 'check' },
      { name: 'ckOwner', label: 'صاحب حساب', show: (v) => v.method === 'check', hint: 'نام کسی که چک را صادر کرده (برای چک دریافتی ممکن است با مشتری فرق کند).' },
      { name: 'ckIssue', label: 'تاریخ صدور (اختیاری)', type: 'date', show: (v) => v.method === 'check' },
      { name: 'ckDue', label: 'تاریخ سررسید', type: 'date', required: true, show: (v) => v.method === 'check' },
      { name: 'ckStatus', label: 'وضعیت چک', type: 'select', options: STATUS_OPTIONS, show: (v) => v.method === 'check' },
      {
        name: 'invoiceId',
        label: 'مربوط به فاکتور (اختیاری)',
        type: 'custom',
        render: (init) => (invSel = invoiceSelect({ db: ctx.db, getDir, getPartyId: () => (form ? form.control('partyId').getValue() : values.partyId), initial: init })),
      },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      const payment = await savePayment(
        ctx.db,
        {
          direction: v.direction,
          method: v.method,
          date: v.date,
          partyId: v.partyId,
          amount: v.amount,
          invoiceId: v.invoiceId,
          note: v.note,
          check: { number: v.ckNumber, bank: v.ckBank, owner: v.ckOwner, issueDate: v.ckIssue, dueDate: v.ckDue, status: v.ckStatus },
        },
        existing
      );
      toast(editing ? 'ذخیره شد' : 'ثبت شد');
      ctx.go(`/payments/${payment.id}`, { replace: true });
    },
  });
  form.addEventListener('click', () => invSel && invSel.refreshIfChanged());
  form.addEventListener('input', () => invSel && invSel.refreshIfChanged());
  ctx.el.append(form);
}

// ---------------------------------------------------------------- جزئیات
async function detailPage(ctx) {
  const p = await ctx.db.table(T).get(ctx.params.id);
  ctx.setBack('/payments');
  if (!p || p.deletedAt) {
    ctx.setTitle('دریافت / پرداخت');
    ctx.el.append(emptyState('activity', 'این مورد پیدا نشد'));
    return;
  }
  const [party, invoice, check] = await Promise.all([
    ctx.db.table('parties').get(p.partyId),
    p.invoiceId ? ctx.db.table('invoices').get(p.invoiceId) : null,
    p.checkId ? ctx.db.table('checks').get(p.checkId) : null,
  ]);
  const incoming = p.direction === 'in';
  ctx.setTitle(`${dirLabel(p.direction)} ${p.code}`);
  const actions = [];
  if (p.kind !== 'endorse') actions.push(h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/payments/${p.id}/edit`) }, icon('edit')));
  actions.push(h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removePayment(ctx, p, check) }, icon('trash')));
  ctx.setActions(actions);

  ctx.el.append(
    section(
      null,
      h('div', null, badge(dirLabel(p.direction), incoming ? 'ok' : 'warn'), badge(p.kind === 'endorse' ? 'خرج چک' : methodLabel(p.method)), badge(p.code, 'code')),
      kv('مبلغ', h('span', { class: incoming ? 'amount-credit' : 'amount-debit' }, formatMoney(p.amount))),
      kv(incoming ? 'دریافت از' : 'پرداخت به', party ? h('a', { class: 'link', href: `#/parties/${party.id}` }, partyName(party)) : '—'),
      kv('تاریخ', `${weekdayName(p.date)} ${formatJalali(p.date)}`),
      kv('فاکتور', invoice && !invoice.deletedAt ? h('a', { class: 'link', href: `#/invoices/${invoice.id}` }, invoice.code) : ''),
      kv('چک', check && !check.deletedAt ? h('a', { class: 'link', href: `#/checks/${check.id}` }, `${toFaDigits(check.number || '')} · ${check.bank || ''}`) : ''),
      kv('توضیحات', p.note)
    )
  );
}

async function removePayment(ctx, p, check) {
  const extra = check ? ' چک مرتبط (و خرج آن، اگر خرج شده) هم حذف میشود.' : '';
  if (!(await confirmDialog(`${dirLabel(p.direction)} ${p.code} حذف شود؟${extra}`, { danger: true, okText: 'حذف', title: 'حذف' }))) return;
  await deletePaymentCascade(ctx.db, p);
  toast('حذف شد');
  ctx.go('/payments');
}

export function registerPayments() {
  registerModule({
    id: 'payments',
    title: 'دریافت و پرداخت',
    tables: [T],
    tableLabels: { payments: 'دریافت و پرداخت' },
    fieldLabels: { direction: 'نوع', method: 'روش', amount: 'مبلغ', invoiceId: 'فاکتور', kind: 'نوع ثبت' },
    home: {
      order: 16,
      label: 'دریافت و پرداخت',
      icon: 'activity',
      path: '/payments',
      count: async (db) => `${toFaDigits((await db.table(T).list()).length)} مورد`,
    },
    more: { order: 5, label: 'دریافت و پرداخت', desc: 'نقد، چک و حواله', icon: 'activity', path: '/payments' },
    routes: [
      { path: '/payments', render: listPage },
      { path: '/payments/new', render: formPage },
      { path: '/payments/:id/edit', render: formPage },
      { path: '/payments/:id', render: detailPage },
    ],
  });
}

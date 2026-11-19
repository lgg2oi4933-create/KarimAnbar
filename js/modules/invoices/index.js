// ماژول فاکتور: خرید و فروش، اقلام، تخفیف و مالیات، خروجی تصویر/PDF
import { takeDraft } from '../voice/draft.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, numberField, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { partyPicker, productPicker } from '../../ui/pickers.js';
import { exportDoc } from '../../ui/exporter.js';
import { registerModule, extend, getExtensions } from '../../core/registry.js';
import { matches, toFaDigits, formatMoney, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso, weekdayName } from '../../core/jalali.js';
import { invoiceTotals, invoiceProfit, lineAmount, indexById, paidForInvoice } from '../../core/finance.js';
import { partyName } from '../parties/model.js';
import { unitLabel } from '../products/model.js';
import { getCompany } from '../settings/index.js';
import { TYPES, typeLabel, partyRoleFor, kindsFor, lastPrice, lastCost, qtyText, invoiceDoc } from './model.js';

const T = 'invoices';

async function loadContext(db) {
  const [parties, payments, checks] = await Promise.all([db.table('parties').list({ includeDeleted: true }), db.table('payments').list(), db.table('checks').list({ includeDeleted: true })]);
  return { partiesById: indexById(parties), payments, checksById: indexById(checks) };
}

// ---------------------------------------------------------------- فهرست
async function listPage(ctx) {
  ctx.setTitle('فاکتورها');
  ctx.setBack(null);
  const invoices = await ctx.db.table(T).list();
  const { partiesById, payments, checksById } = await loadContext(ctx.db);
  let type = ctx.query.type === 'sale' || ctx.query.type === 'purchase' ? ctx.query.type : 'all';
  let q = '';
  const listEl = h('div', { class: 'list' });

  const paint = () => {
    const items = invoices
      .filter((i) => type === 'all' || i.type === type)
      .filter((i) => matches([partyName(partiesById.get(i.partyId)), i.code, i.refNumber, formatJalali(i.date)], q))
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((i) => {
            const total = invoiceTotals(i).total;
            const paid = paidForInvoice(i.id, payments, checksById);
            const status = paid >= total && total > 0 ? badge('تسویه', 'ok') : paid > 0 ? badge('بخشی پرداخت', 'warn') : badge('پرداخت نشده', 'danger');
            return row({
              leading: icon('grid'),
              title: partyName(partiesById.get(i.partyId)) || '—',
              subtitle: `${typeLabel(i.type)} · ${i.code} · ${formatJalali(i.date)}`,
              meta: h('div', null, h('div', null, formatMoney(total)), status),
              onclick: () => ctx.go(`/invoices/${i.id}`),
            });
          })
        : [
            emptyState(
              'grid',
              invoices.length ? 'موردی پیدا نشد' : 'هنوز فاکتوری ثبت نشده است',
              invoices.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/invoices/new?type=sale') }, 'ثبت اولین فاکتور')
            ),
          ])
    );
  };
  ctx.el.append(
    searchBar((v) => ((q = v), paint()), 'جستجوی نام، شماره، تاریخ...'),
    tabs([{ value: 'all', label: 'همه' }, ...TYPES], type, (v) => ((type = v), paint())),
    listEl,
    fab(() => (type === 'all' ? chooseType(ctx) : ctx.go(`/invoices/new?type=${type}`)), 'فاکتور جدید')
  );
  paint();
}

function chooseType(ctx) {
  let s;
  s = sheet({
    title: 'فاکتور جدید',
    body: h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => (s.close(), ctx.go('/invoices/new?type=sale')) }, 'فاکتور فروش'),
      h('button', { class: 'btn ghost', onclick: () => (s.close(), ctx.go('/invoices/new?type=purchase')) }, 'فاکتور خرید')
    ),
  });
}

// ---------------------------------------------------------------- ویرایشگر اقلام
function linesEditor({ db, getType, initial, setError }) {
  const wrap = h('div', { class: 'lines' });
  const list = h('div', { class: 'lines' });
  const rows = [];
  const notify = () => wrap.dispatchEvent(new Event('input', { bubbles: true }));

  function addLine(l = {}) {
    let unit = l.unit || 'kg';
    const unitEl = h('span', { class: 'muted' }, `(${unitLabel(unit)})`);
    const title = h('input', { type: 'text', placeholder: 'شرح کالا یا خدمت', value: l.title || '', 'aria-label': 'شرح' });
    const total = h('span', { class: 'line-total' });
    let autoTitle = l.productId ? l.title || '' : '';
    const recalc = () => {
      total.textContent = formatMoney(lineAmount({ qty: qty.getValue(), price: price.getValue() }));
      notify();
    };
    const cost = numberField({ value: l.unitCost ?? null, money: true, placeholder: 'قیمت تمام‌شده (ریال)', onInput: notify });
    const costBox = h('div', { class: 'cost-box' }, h('div', { class: 'label' }, 'قیمت تمام‌شده‌ی واحد (ریال) — فقط برای سود، در فاکتور چاپ نمیشود'), cost);
    const syncCost = () => (costBox.style.display = getType() === 'sale' ? '' : 'none');
    const qty = numberField({ value: l.qty ?? null, placeholder: 'مقدار', onInput: recalc });
    const price = numberField({ value: l.price ?? null, money: true, placeholder: 'فی (ریال)', onInput: recalc });
    const picker = productPicker({
      db,
      value: l.productId || '',
      getKinds: () => kindsFor(getType()),
      onChange: async (p) => {
        if (!p) return;
        if (!title.value || title.value === autoTitle) {
          title.value = p.name;
          autoTitle = p.name;
        }
        unit = p.unit;
        unitEl.textContent = `(${unitLabel(unit)})`;
        if (price.getValue() == null) {
          const lp = await lastPrice(db, getType(), p.id);
          if (lp != null) price.setValue(lp);
        }
        if (cost.getValue() == null) {
          const lc = await lastCost(db, p.id);
          if (lc != null) cost.setValue(lc);
        }
        recalc();
      },
    });
    const card = h(
      'div',
      { class: 'line-card' },
      picker,
      title,
      h('div', { class: 'line-grid' }, h('div', null, h('div', { class: 'label' }, 'مقدار ', unitEl), qty), h('div', null, h('div', { class: 'label' }, 'فی (ریال)'), price)),
      costBox,
      h(
        'div',
        { class: 'line-foot' },
        total,
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn danger',
            'aria-label': 'حذف ردیف',
            onclick: () => {
              const i = rows.indexOf(entry);
              if (i >= 0) rows.splice(i, 1);
              card.remove();
              notify();
            },
          },
          icon('trash', 20)
        )
      )
    );
    const lid = l.lid || Math.random().toString(36).slice(2, 10);
    const entry = { get: () => ({ lid, productId: picker.getValue(), title: title.value.trim(), qty: qty.getValue(), price: price.getValue(), unit, unitCost: getType() === 'sale' ? cost.getValue() : null }) };
    rows.push(entry);
    syncCost();
    wrap.addEventListener('typechange', syncCost);
    list.append(card);
    recalc();
  }

  (initial && initial.length ? initial : [{}]).forEach((l, i) => addLine(l.lid || !l.productId ? l : { ...l, lid: 'i' + i }));
  wrap.append(list, h('button', { type: 'button', class: 'btn ghost', onclick: () => addLine() }, '＋ افزودن ردیف'));
  wrap.getValue = () => rows.map((r) => r.get());
  return wrap;
}

// ---------------------------------------------------------------- فرم
async function formPage(ctx) {
  const editing = !!ctx.params.id;
  const vd = editing ? null : takeDraft('invoice');
  const t = ctx.db.table(T);
  const existing = editing ? await t.get(ctx.params.id) : null;
  ctx.setBack(editing ? `/invoices/${ctx.params.id}` : '/invoices');
  if (editing && (!existing || existing.deletedAt)) {
    ctx.el.append(emptyState('grid', 'این فاکتور پیدا نشد'));
    return;
  }
  const company = await getCompany(ctx.db);
  const type0 = existing ? existing.type : vd ? vd.type : ctx.query.type === 'purchase' ? 'purchase' : 'sale';
  ctx.setTitle(editing ? 'ویرایش فاکتور' : type0 === 'sale' ? 'فاکتور فروش جدید' : 'فاکتور خرید جدید');

  let form;
  const getType = () => {
    const on = form && form.control('type').querySelector('.chip.on');
    return on ? on.dataset.v : type0;
  };

  form = buildForm({
    values: existing || { type: type0, date: todayIso(), taxPercent: company.taxPercent, discount: null, partyId: (vd && vd.partyId) || ctx.query.party || '', ...(vd ? { lines: vd.lines, note: vd.note || '' } : {}) },
    submitText: editing ? 'ذخیره تغییرات' : 'ثبت فاکتور',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'type', label: 'نوع فاکتور', type: 'choice', options: TYPES },
      { name: 'date', label: 'تاریخ', type: 'date', required: true },
      {
        name: 'partyId',
        label: 'طرف حساب',
        type: 'custom',
        required: true,
        render: (init) => partyPicker({ db: ctx.db, value: init, getRoles: () => partyRoleFor(getType()), placeholder: 'انتخاب مشتری / تأمین‌کننده...' }),
      },
      { name: 'refNumber', label: 'شماره فاکتور فروشنده (اختیاری)', show: (v) => v.type === 'purchase' },
      {
        name: 'lines',
        label: 'اقلام',
        type: 'custom',
        render: (init, { setError }) => linesEditor({ db: ctx.db, getType, initial: init, setError }),
      },
      { name: 'discount', label: 'تخفیف (ریال)', type: 'number', money: true, min: 0 },
      { name: 'taxPercent', label: 'درصد مالیات', type: 'number', min: 0, hint: 'پیش‌فرض از «اطلاعات شرکت» میاد و برای هر فاکتور قابل تغییر است.' },
      { name: 'code', label: 'شماره فاکتور', dir: 'ltr', placeholder: 'خودکار ساخته میشود', hint: 'اگر خالی بگذارید خودکار ساخته میشود؛ قابل ویرایش است.' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      const clean = [];
      for (let i = 0; i < v.lines.length; i++) {
        const l = v.lines[i];
        if (!l.productId && !l.title && l.qty == null && l.price == null) continue;
        const n = `ردیف ${toFaDigits(i + 1)}: `;
        if (!l.title && !l.productId) return setError('lines', n + 'شرح یا کالا را وارد کنید');
        if (!(l.qty > 0)) return setError('lines', n + 'مقدار باید بیشتر از صفر باشد');
        if (l.price == null || Number.isNaN(l.price) || l.price < 0) return setError('lines', n + 'فی را وارد کنید');
        clean.push({ lid: l.lid, productId: l.productId || '', title: l.title || '', qty: l.qty, price: l.price, unit: l.unit || 'kg', unitCost: v.type === 'sale' && l.unitCost != null && !Number.isNaN(l.unitCost) ? l.unitCost : null });
      }
      if (!clean.length) return setError('lines', 'حداقل یک ردیف لازم است');
      if (v.code && (await t.codeTaken(v.code, existing && existing.id))) return setError('code', 'این شماره قبلاً استفاده شده است');
      const data = {
        type: v.type,
        date: v.date,
        partyId: v.partyId,
        refNumber: v.type === 'purchase' ? v.refNumber : '',
        lines: clean,
        discount: v.discount || 0,
        taxPercent: v.taxPercent ?? 0,
        code: v.code,
        note: v.note,
      };
      if (editing) {
        if (!data.code) data.code = existing.code;
        await t.update(existing.id, data);
        toast('ذخیره شد');
        ctx.go(`/invoices/${existing.id}`, { replace: true });
      } else {
        const rec = await t.create(data, { prefix: data.type === 'sale' ? 'SI' : 'PI' });
        toast('فاکتور ثبت شد');
        ctx.go(`/invoices/${rec.id}`, { replace: true });
      }
    },
  });

  // خلاصه‌ی جمع‌ها (زنده)
  const totalsEl = h('div', { class: 'field wide' });
  const paintTotals = () => {
    const raw = form.get();
    const tt = invoiceTotals({ lines: (raw.lines || []).map((l) => ({ qty: l.qty || 0, price: l.price || 0 })), discount: raw.discount, taxPercent: raw.taxPercent });
    totalsEl.replaceChildren(
      h(
        'div',
        { class: 'totals' },
        kv('جمع اقلام', formatMoney(tt.subtotal)),
        tt.discount ? kv('تخفیف', formatMoney(tt.discount)) : null,
        kv(`مالیات (${toFaDigits(raw.taxPercent || 0)}٪)`, formatMoney(tt.tax)),
        h('div', { class: 'kv big' }, h('span', { class: 'k' }, 'مبلغ نهایی'), h('span', { class: 'v' }, formatMoney(tt.total)))
      )
    );
  };
  form.insertBefore(totalsEl, form.wrapper('code'));
  form.addEventListener('input', paintTotals);
  form.addEventListener('change', paintTotals);
  form.addEventListener('click', () => setTimeout(() => form.control('lines').dispatchEvent(new Event('typechange')), 0));
  paintTotals();
  ctx.el.append(form);
}

// ---------------------------------------------------------------- جزئیات
function profitSection(inv) {
  const pr = invoiceProfit(inv);
  return section(
    'سود این فاکتور',
    kv('فروش (بعد از تخفیف)', formatMoney(pr.revenue)),
    kv('بهای تمام‌شده', formatMoney(pr.cost)),
    h('div', { class: 'kv big' }, h('span', { class: 'k' }, 'سود'), h('span', { class: 'v ' + (pr.profit < 0 ? 'amount-debit' : '') }, formatMoney(pr.profit))),
    pr.missing ? h('div', { class: 'hint' }, `${toFaDigits(pr.missing)} ردیف «بدون قیمت تمام‌شده» است و در سود حساب نشده.`) : null,
    h(
      'div',
      { class: 'list' },
      pr.lines.map((x, i) =>
        row({
          title: `${toFaDigits(i + 1)}. ${x.line.title}`,
          subtitle: x.cost == null ? 'بدون قیمت تمام‌شده' : `بها ${formatMoney(x.cost)}`,
          meta: x.profit == null ? '—' : formatMoney(x.profit),
          trailing: h('span'),
        })
      )
    )
  );
}

async function detailPage(ctx) {
  const inv = await ctx.db.table(T).get(ctx.params.id);
  ctx.setBack('/invoices');
  if (!inv || inv.deletedAt) {
    ctx.setTitle('فاکتور');
    ctx.el.append(emptyState('grid', 'این فاکتور پیدا نشد'));
    return;
  }
  const party = await ctx.db.table('parties').get(inv.partyId);
  const { payments, checksById } = await loadContext(ctx.db);
  const t = invoiceTotals(inv);
  const linked = payments.filter((p) => p.invoiceId === inv.id);
  const paid = paidForInvoice(inv.id, payments, checksById);
  const remaining = Math.max(0, t.total - paid);
  const sale = inv.type === 'sale';

  ctx.setTitle(`${typeLabel(inv.type)} ${inv.code}`);
  ctx.setActions([
    h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/invoices/${inv.id}/edit`) }, icon('edit')),
    h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeInvoice(ctx, inv, linked) }, icon('trash')),
  ]);

  const doExport = async (kind) => {
    try {
      const company = await getCompany(ctx.db);
      const r = await exportDoc(invoiceDoc(inv, party, company, { paid }), kind, `${typeLabel(inv.type)}_${inv.code}`);
      if (r === 'downloaded') toast('فایل ذخیره شد');
    } catch (e) {
      console.error(e);
      toast('ساخت خروجی ناموفق بود: ' + e.message, 'err');
    }
  };

  ctx.el.append(
    section(
      null,
      h('div', null, badge(typeLabel(inv.type), sale ? 'ok' : 'warn'), badge(inv.code, 'code')),
      kv('تاریخ', `${weekdayName(inv.date)} ${formatJalali(inv.date)}`),
      kv(sale ? 'مشتری' : 'تأمین‌کننده', party ? h('a', { class: 'link', href: `#/parties/${party.id}` }, partyName(party)) : '—'),
      kv('شماره فاکتور فروشنده', inv.refNumber && toFaDigits(inv.refNumber)),
      kv('توضیحات', inv.note)
    ),
    section(
      'اقلام',
      h(
        'div',
        { class: 'list' },
        (inv.lines || []).map((l, i) =>
          row({
            title: `${toFaDigits(i + 1)}. ${l.title}`,
            subtitle: `${qtyText(l)} × ${formatNumber(l.price)}`,
            meta: formatMoney(lineAmount(l)),
            trailing: h('span'),
          })
        )
      )
    ),
    section(
      'جمع',
      kv('جمع اقلام', formatMoney(t.subtotal)),
      t.discount ? kv('تخفیف', formatMoney(t.discount)) : null,
      inv.taxPercent ? kv(`مالیات (${toFaDigits(inv.taxPercent)}٪)`, formatMoney(t.tax)) : null,
      h('div', { class: 'kv big' }, h('span', { class: 'k' }, 'مبلغ نهایی'), h('span', { class: 'v' }, formatMoney(t.total))),
      kv(sale ? 'دریافت‌شده' : 'پرداخت‌شده', formatMoney(paid)),
      kv('باقی‌مانده', h('span', { class: remaining ? (sale ? 'amount-debit' : 'amount-credit') : '' }, remaining ? formatMoney(remaining) : 'تسویه'))
    ),
    ...(sale ? [profitSection(inv)] : []),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => ctx.go(`/payments/new?dir=${sale ? 'in' : 'out'}&party=${inv.partyId}&invoice=${inv.id}${remaining ? `&amount=${remaining}` : ''}`) }, sale ? 'ثبت دریافت' : 'ثبت پرداخت')
    ),
    h('div', { class: 'btn-row pad-top' }, h('button', { class: 'btn ghost', onclick: () => doExport('png') }, 'تصویر فاکتور'), h('button', { class: 'btn ghost', onclick: () => doExport('pdf') }, 'PDF فاکتور'))
  );

  if (linked.length) {
    ctx.el.append(
      section(
        sale ? 'دریافت‌های این فاکتور' : 'پرداخت‌های این فاکتور',
        h(
          'div',
          { class: 'list' },
          linked.map((p) =>
            row({ title: formatMoney(p.amount), subtitle: `${p.code} · ${formatJalali(p.date)}`, onclick: () => ctx.go(`/payments/${p.id}`) })
          )
        )
      )
    );
  }
  for (const ext of getExtensions('invoice.detail')) {
    const node = await ext(ctx, inv);
    if (node) ctx.el.append(node);
  }
}

async function removeInvoice(ctx, inv, linked) {
  const msg = linked.length ? `فاکتور ${inv.code} حذف شود؟ ${toFaDigits(linked.length)} دریافت/پرداخت مرتبط میماند ولی از این فاکتور جدا میشود.` : `فاکتور ${inv.code} حذف شود؟`;
  if (!(await confirmDialog(msg, { danger: true, okText: 'حذف', title: 'حذف فاکتور' }))) return;
  for (const p of linked) await ctx.db.table('payments').update(p.id, { invoiceId: '' });
  await ctx.db.table(T).remove(inv.id);
  toast('حذف شد');
  ctx.go('/invoices');
}

export function registerInvoices() {
  // کالایی که در فاکتور استفاده شده حذف نمیشود (به‌جایش ویرایشش کنید)
  extend('product.deleteGuard', async (db, p) => {
    const used = (await db.table(T).list()).some((i) => (i.lines || []).some((l) => l.productId === p.id));
    return used ? 'این کالا در فاکتور استفاده شده و حذفش حساب‌ها را به‌هم میزند. اگر اشتباه ثبت شده، ویرایشش کنید.' : null;
  });

  registerModule({
    id: 'invoices',
    title: 'فاکتورها',
    tables: [T],
    tableLabels: { invoices: 'فاکتورها' },
    fieldLabels: { type: 'نوع', date: 'تاریخ', partyId: 'طرف حساب', refNumber: 'شماره فاکتور فروشنده', lines: 'اقلام', discount: 'تخفیف', taxPercent: 'درصد مالیات' },
    nav: { order: 15, label: 'فاکتور', icon: 'grid', path: '/invoices' },
    home: {
      order: 15,
      label: 'فاکتورها',
      icon: 'grid',
      path: '/invoices',
      count: async (db) => `${toFaDigits((await db.table(T).list()).length)} فاکتور`,
    },
    routes: [
      { path: '/invoices', render: listPage },
      { path: '/invoices/new', render: formPage },
      { path: '/invoices/:id/edit', render: formPage },
      { path: '/invoices/:id', render: detailPage },
    ],
  });
}

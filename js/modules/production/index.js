// ماژول تولید: هر «دسته» چهار مرحله دارد (چسب‌کاری و خشک‌کردن، برش، برون‌سپاری نوار، پرس).
// در هر مرحله وزن ورودی و خروجی ثبت میشود و ضایعات خودکار حساب میشود (قابل ویرایش).
// ورق مصرفی از لات‌ها برداشته میشود تا ردیابی «لات ← دسته ← سینی» ممکن باشد.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, numberField, row, searchBar, section, sheet, toast } from '../../ui/components.js';
import { partyPicker, productPicker } from '../../ui/pickers.js';
import { registerModule, extend } from '../../core/registry.js';
import { matches, toFaDigits, formatMoney, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso } from '../../core/jalali.js';
import { dimsText } from '../products/model.js';
import { partyName } from '../parties/model.js';
import { loadStockData, lotRemaining, batchSummary, tapeFee, syncLots } from '../inventory/stock.js';

const T = 'prod_batches';
const kg = (n) => `${formatNumber(Number(n) || 0, { decimals: 3 })} کیلو`;
const r3 = (n) => Math.round(n * 1000) / 1000;
const STAGES = ['glue', 'cut', 'tape', 'press'];

// ---------------------------------------------------------------- فهرست
async function listPage(ctx) {
  ctx.setTitle('تولید');
  ctx.setBack('/more');
  const [batches, products] = await Promise.all([ctx.db.table(T).list(), ctx.db.table('products').list({ includeDeleted: true })]);
  const pById = new Map(products.map((p) => [p.id, p]));
  let q = '';
  const listEl = h('div', { class: 'list' });
  const paint = () => {
    const items = batches.filter((b) => matches([b.code, (pById.get(b.trayProductId) || {}).name, formatJalali(b.date)], q)).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((b) => {
            const done = STAGES.filter((s) => b[s]).length;
            return row({
              leading: icon('activity'),
              title: `${b.code} · ${(pById.get(b.trayProductId) || {}).name || 'سینی؟'}`,
              subtitle: formatJalali(b.date),
              meta: b.press ? badge(kg(b.press.outKg), 'ok') : badge(`${toFaDigits(done)} از ۴ مرحله`, 'warn'),
              onclick: () => ctx.go(`/production/${b.id}`),
            });
          })
        : [emptyState('activity', batches.length ? 'موردی پیدا نشد' : 'هنوز دسته‌ی تولیدی ثبت نشده', batches.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/production/new') }, 'ثبت اولین دسته'))])
    );
  };
  ctx.el.append(searchBar((v) => ((q = v), paint()), 'جستجوی کد یا سینی...'), listEl, fab(() => ctx.go('/production/new'), 'دسته‌ی جدید'));
  paint();
}

// ---------------------------------------------------------------- ساخت / ویرایش دسته
async function formPage(ctx) {
  const editing = !!ctx.params.id;
  const t = ctx.db.table(T);
  const existing = editing ? await t.get(ctx.params.id) : null;
  if (editing && (!existing || existing.deletedAt)) return void ctx.el.append(emptyState('activity', 'این دسته پیدا نشد'));
  ctx.setTitle(editing ? 'ویرایش دسته' : 'دسته‌ی تولید جدید');
  ctx.setBack(editing ? `/production/${existing.id}` : '/production');
  const form = buildForm({
    values: existing || { date: todayIso() },
    submitText: editing ? 'ذخیره تغییرات' : 'ایجاد دسته',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'date', label: 'تاریخ شروع', type: 'date', required: true },
      { name: 'trayProductId', label: 'سینی خروجی', type: 'custom', required: true, render: (init) => productPicker({ db: ctx.db, value: init, getKinds: () => ['tray'], placeholder: 'انتخاب یا افزودن سینی...' }) },
      { name: 'code', label: 'کد دسته', dir: 'ltr', placeholder: 'خودکار ساخته میشود', hint: 'اگر خالی بگذارید خودکار ساخته میشود؛ قابل ویرایش است.' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (v.code && (await t.codeTaken(v.code, existing && existing.id))) return setError('code', 'این کد قبلاً استفاده شده است');
      if (editing) {
        await t.update(existing.id, { ...v, code: v.code || existing.code });
        toast('ذخیره شد');
        ctx.go(`/production/${existing.id}`, { replace: true });
      } else {
        const rec = await t.create(v, { prefix: 'B' });
        toast('دسته ساخته شد');
        ctx.go(`/production/${rec.id}`, { replace: true });
      }
    },
  });
  ctx.el.append(form);
}

// ---------------------------------------------------------------- ابزار فرم مراحل
// ضایعات = ورودی − خروجی؛ هرکدام را ویرایش کنید دیگری خودکار تنظیم میشود
function wireWaste(form, getIn) {
  const out = form.control('outKg');
  const waste = form.control('wasteKg');
  let last = 'out';
  const fix = () => {
    const i = getIn();
    if (!(i > 0)) return;
    if (last === 'out') {
      const o = out.getValue();
      if (o != null && !Number.isNaN(o)) waste.setValue(r3(i - o));
    } else {
      const w = waste.getValue();
      if (w != null && !Number.isNaN(w)) out.setValue(r3(i - w));
    }
  };
  out.input.addEventListener('input', () => {
    last = 'out';
    fix();
  });
  waste.input.addEventListener('input', () => {
    last = 'waste';
    fix();
  });
  form.addEventListener('input', (e) => {
    if (e.target === out.input || e.target === waste.input) return;
    setTimeout(fix, 0);
  });
}

// ردیف‌های مصرف ورق از لات‌ها
function lotRowsField(lots, products, batches, ownBatchId, init) {
  const pById = new Map(products.map((p) => [p.id, p]));
  const wrap = h('div', { class: 'lines' });
  const rows = [];
  const own = new Map(((init || []).map((c) => [c.lotId, Number(c.kg) || 0])));
  const addRow = (c = {}) => {
    const sel = h('select', { 'aria-label': 'لات ورق' }, h('option', { value: '' }, 'انتخاب لات...'));
    for (const l of lots) {
      const rem = lotRemaining(l, batches) + (own.get(l.id) || 0);
      if (rem <= 0 && l.id !== c.lotId) continue;
      sel.append(h('option', { value: l.id }, `${l.code} · ${(pById.get(l.productId) || {}).name || ''} · ${formatNumber(rem, { decimals: 3 })} کیلو مانده`));
    }
    sel.value = c.lotId || '';
    const num = numberField({ value: c.kg ?? null, placeholder: 'وزن مصرفی (کیلو)', onInput: () => wrap.dispatchEvent(new Event('input', { bubbles: true })) });
    const entry = { get: () => ({ lotId: sel.value, kg: num.getValue() }), rem: () => (sel.value ? lotRemaining(lots.find((l) => l.id === sel.value), batches) + (own.get(sel.value) || 0) : 0) };
    const card = h('div', { class: 'line-card' }, sel, num, h('div', { class: 'line-foot' }, h('span'), h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'حذف ردیف', onclick: () => {
      rows.splice(rows.indexOf(entry), 1);
      card.remove();
      wrap.dispatchEvent(new Event('input', { bubbles: true }));
    } }, icon('trash', 20))));
    rows.push(entry);
    list.append(card);
  };
  const list = h('div', { class: 'lines' });
  (init && init.length ? init : [{}]).forEach(addRow);
  wrap.append(list, h('button', { type: 'button', class: 'btn ghost', onclick: () => addRow() }, '＋ لات دیگر'));
  wrap.getValue = () => rows.map((r) => r.get());
  wrap.sumKg = () => rows.reduce((a, r) => a + (Number(r.get().kg) || 0), 0);
  wrap.remainingFor = (lotId) => { const r = rows.find((x) => x.get().lotId === lotId); return r ? r.rem() : 0; };
  return wrap;
}

function openStage(ctx, batch, key, { title, fields, defaults, wire, build, validate, extra }) {
  let s;
  const form = buildForm({
    values: batch[key] && !batch[key].skipped ? batch[key] : defaults,
    submitText: 'ثبت مرحله',
    onCancel: () => s.close(),
    extraActions: batch[key]
      ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('اطلاعات این مرحله پاک شود؟', { danger: true, okText: 'پاک کن' }))) return;
          await ctx.db.table(T).update(batch.id, { [key]: null });
          s.close();
          ctx.refresh();
        } }, 'پاک کردن')]
      : [],
    fields,
    onSubmit: async (v, helpers) => {
      const err = validate && validate(v, helpers);
      if (err) return;
      await ctx.db.table(T).update(batch.id, { [key]: build ? build(v) : v });
      s.close();
      toast('ثبت شد');
      ctx.refresh();
    },
  });
  if (wire) wire(form);
  if (extra) extra(form);
  s = sheet({ title, body: form });
}

const WASTE_FIELDS = [
  { name: 'outKg', label: 'وزن خروجی (کیلو)', type: 'number', min: 0, required: true },
  { name: 'wasteKg', label: 'ضایعات (کیلو)', type: 'number', min: 0, hint: 'ورودی − خروجی؛ هرکدام را تغییر دهید دیگری خودکار میشود.' },
];

async function glueStage(ctx, b) {
  await syncLots(ctx.db);
  const [lots, products, data] = await Promise.all([ctx.db.table('lots').list(), ctx.db.table('products').list(), loadStockData(ctx.db)]);
  const sheetLots = lots.slice().sort((a, c) => (a.date < c.date ? 1 : -1));
  const others = data.batches.filter((x) => x.id !== b.id);
  openStage(ctx, b, 'glue', {
    title: 'چسب‌کاری و خشک‌کردن',
    defaults: { layers: '2' },
    fields: [
      { name: 'layers', label: 'تعداد ورق در هر لایه‌چسبانی', type: 'choice', options: [{ value: '2', label: '۲ ورق' }, { value: '3', label: '۳ ورق' }] },
      { name: 'lots', label: 'ورق مصرفی (از کدام لات)', type: 'custom', required: true, render: (init) => lotRowsField(sheetLots, products, data.batches.filter((x) => x.id !== b.id), b.id, init) },
      { name: 'glueProductId', label: 'چسب مصرفی (اختیاری)', type: 'custom', render: (init) => productPicker({ db: ctx.db, value: init, getKinds: () => ['glue'], placeholder: 'انتخاب چسب...' }) },
      { name: 'glueKg', label: 'وزن چسب (کیلو)', type: 'number', min: 0 },
      ...WASTE_FIELDS.map((f) => (f.name === 'outKg' ? { ...f, label: 'وزن بعد از خشک شدن (کیلو)' } : f)),
      { name: 'note', label: 'توضیحات مرحله', type: 'textarea' },
    ],
    wire: (form) => wireWaste(form, () => (form.control('lots').sumKg() || 0) + (Number(form.control('glueKg').getValue()) || 0)),
    validate: (v, { setError }) => {
      const cl = (v.lots || []).filter((c) => c.lotId || c.kg != null);
      if (!cl.length) return setError('lots', 'حداقل یک لات و وزن را وارد کنید') || true;
      const seen = new Set();
      for (const c of cl) {
        if (!c.lotId) return setError('lots', 'برای هر ردیف لات را انتخاب کنید') || true;
        if (!(c.kg > 0)) return setError('lots', 'وزن هر ردیف باید بیشتر از صفر باشد') || true;
        if (seen.has(c.lotId)) return setError('lots', 'یک لات دو بار انتخاب شده') || true;
        seen.add(c.lotId);
        const lot = lots.find((l) => l.id === c.lotId);
        const rem = lotRemaining(lot, others) + 0;
        if (c.kg > rem + 1e-9) return setError('lots', `از لات ${lot.code} فقط ${formatNumber(rem, { decimals: 3 })} کیلو مانده`) || true;
      }
      return false;
    },
    build: (v) => ({ layers: v.layers, lots: v.lots.filter((c) => c.lotId).map((c) => ({ lotId: c.lotId, kg: c.kg })), glueProductId: v.glueProductId || '', glueKg: v.glueKg || 0, outKg: v.outKg, wasteKg: v.wasteKg || 0, note: v.note }),
  });
}

function cutStage(ctx, b) {
  const g = b.glue || {};
  openStage(ctx, b, 'cut', {
    title: 'برش',
    defaults: { inKg: g.outKg || null },
    fields: [
      { name: 'inKg', label: 'وزن ورودی به برش (کیلو)', type: 'number', min: 0, required: true },
      { name: 'pieces', label: 'تعداد قطعه‌ی بریده‌شده (اختیاری)', type: 'number', min: 0 },
      ...WASTE_FIELDS,
      { name: 'note', label: 'توضیحات مرحله', type: 'textarea' },
    ],
    wire: (form) => wireWaste(form, () => Number(form.control('inKg').getValue()) || 0),
    build: (v) => ({ inKg: v.inKg, pieces: v.pieces || 0, outKg: v.outKg, wasteKg: v.wasteKg || 0, note: v.note }),
  });
}

function tapeStage(ctx, b) {
  const c = b.cut || {};
  openStage(ctx, b, 'tape', {
    title: 'برون‌سپاری نوار لبه',
    defaults: { sentDate: todayIso(), sentKg: c.outKg || null, sentPieces: c.pieces || null, deductDamaged: 'yes' },
    fields: [
      { name: 'partyId', label: 'برون‌سپار', type: 'custom', required: true, render: (init) => partyPicker({ db: ctx.db, value: init, getRoles: () => ['subcontractor'], placeholder: 'انتخاب برون‌سپار...' }) },
      { name: 'sentDate', label: 'تاریخ تحویل به برون‌سپار', type: 'date', required: true },
      { name: 'sentKg', label: 'وزن تحویلی به او (کیلو)', type: 'number', min: 0, required: true },
      { name: 'sentPieces', label: 'تعداد قطعه‌ی تحویلی', type: 'number', min: 0 },
      { name: 'tapeProductId', label: 'نوار چسب تحویلی', type: 'custom', render: (init) => productPicker({ db: ctx.db, value: init, getKinds: () => ['tape'], placeholder: 'انتخاب نوار...' }) },
      { name: 'tapePieces', label: 'تعداد نوار تحویلی (عدد)', type: 'number', min: 0, hint: 'از موجودی نوار به‌ازای هر قطعه کم میشود.' },
      { name: 'returnDate', label: 'تاریخ تحویل گرفتن', type: 'date' },
      { name: 'returnedKg', label: 'وزن تحویل‌گرفته (کیلو)', type: 'number', min: 0 },
      { name: 'damagedKg', label: 'وزن آسیب‌دیده (کیلو)', type: 'number', min: 0 },
      { name: 'feePerKg', label: 'اجرت هر کیلو (ریال)', type: 'number', money: true, min: 0 },
      { name: 'deductDamaged', label: 'آسیب‌دیده از اجرت کم شود؟', type: 'choice', options: [{ value: 'yes', label: 'بله، کم شود' }, { value: 'no', label: 'خیر' }] },
      { name: 'feeInfo', label: 'اجرت قابل پرداخت', type: 'custom', render: () => { const el = h('div', { class: 'hint' }); el.getValue = () => null; return el; } },
      { name: 'note', label: 'توضیحات مرحله', type: 'textarea' },
    ],
    extra: (form) => {
      const info = form.control('feeInfo');
      const upd = () => {
        const f = tapeFee({ tape: { returnedKg: form.control('returnedKg').getValue(), damagedKg: form.control('damagedKg').getValue(), feePerKg: form.control('feePerKg').getValue(), deductDamaged: form.get().deductDamaged } });
        info.textContent = f ? formatMoney(f) + ' (به حساب برون‌سپار بستانکار میشود)' : '—';
      };
      form.addEventListener('input', () => setTimeout(upd, 0));
      form.addEventListener('click', () => setTimeout(upd, 0));
      upd();
    },
    validate: (v, { setError }) => {
      if (v.returnedKg && v.damagedKg > v.returnedKg) return setError('damagedKg', 'آسیب‌دیده از تحویل‌گرفته بیشتر است') || true;
      return false;
    },
    build: (v) => { const { feeInfo, ...rest } = v; void feeInfo; return { ...rest, sentPieces: v.sentPieces || 0, tapePieces: v.tapePieces || 0, returnedKg: v.returnedKg || 0, damagedKg: v.damagedKg || 0, feePerKg: v.feePerKg || 0 }; },
  });
}

function pressStage(ctx, b) {
  const t = b.tape;
  const inKg = t && t.returnedKg ? r3(t.returnedKg - (t.damagedKg || 0)) : (b.cut || {}).outKg || null;
  openStage(ctx, b, 'press', {
    title: 'پرس و تولید نهایی',
    defaults: { inKg },
    fields: [
      { name: 'inKg', label: 'وزن ورودی به پرس (کیلو)', type: 'number', min: 0 },
      { name: 'outKg', label: 'وزن سینی تولیدشده (کیلو)', type: 'number', min: 0, required: true, hint: 'همین مقدار به موجودی سینی انبار اضافه میشود.' },
      WASTE_FIELDS[1],
      { name: 'pieces', label: 'تعداد سینی (اختیاری)', type: 'number', min: 0 },
      { name: 'note', label: 'توضیحات مرحله', type: 'textarea' },
    ],
    wire: (form) => wireWaste(form, () => Number(form.control('inKg').getValue()) || 0),
    build: (v) => ({ inKg: v.inKg, outKg: v.outKg, wasteKg: v.wasteKg || 0, pieces: v.pieces || 0, note: v.note }),
  });
}

// ---------------------------------------------------------------- جزئیات دسته
async function detailPage(ctx) {
  ctx.setBack('/production');
  const b = await ctx.db.table(T).get(ctx.params.id);
  if (!b || b.deletedAt) return void ctx.el.append(emptyState('activity', 'این دسته پیدا نشد'));
  await syncLots(ctx.db);
  ctx.setTitle(`دسته ${b.code}`);
  ctx.setActions([
    h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/production/${b.id}/edit`) }, icon('edit')),
    h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeBatch(ctx, b) }, icon('trash')),
  ]);
  const [tray, lots, products, sub] = await Promise.all([ctx.db.table('products').get(b.trayProductId), ctx.db.table('lots').list(), ctx.db.table('products').list({ includeDeleted: true }), b.tape && b.tape.partyId ? ctx.db.table('parties').get(b.tape.partyId) : null]);
  const lotsById = new Map(lots.map((l) => [l.id, l]));
  const pName = (id) => (products.find((p) => p.id === id) || {}).name || '';
  const sm = batchSummary(b, lotsById);
  const skipStage = async (key) => {
    await ctx.db.table(T).update(b.id, { [key]: { skipped: true } });
    toast('مرحله رد شد');
    ctx.refresh();
  };
  const stageCard = (key, title, lines, onEdit, canSkip = true) => {
    const st = b[key];
    const skipped = st && st.skipped;
    return section(
      title,
      skipped ? h('p', { class: 'muted' }, 'رد شد (بدون ثبت)') : st ? h('div', null, ...lines.filter(Boolean)) : h('p', { class: 'muted' }, 'ثبت نشده'),
      h(
        'div',
        { class: 'btn-row pad-top' },
        h('button', { class: st && !skipped ? 'btn ghost small' : 'btn primary small', onclick: onEdit }, st && !skipped ? 'ویرایش' : 'ثبت این مرحله'),
        !st && canSkip ? h('button', { class: 'btn ghost small', onclick: () => skipStage(key) }, 'رد کردن') : null,
        skipped ? h('button', { class: 'btn ghost small', onclick: async () => { await ctx.db.table(T).update(b.id, { [key]: null }); ctx.refresh(); } }, 'برگرداندن') : null
      )
    );
  };
  const g = b.glue || {};
  const c = b.cut || {};
  const t = b.tape || {};
  const p = b.press || {};
  ctx.el.append(
    section(
      null,
      h('div', null, badge(b.code, 'code'), b.press ? badge('تکمیل', 'ok') : badge('در جریان', 'warn')),
      kv('تاریخ', formatJalali(b.date)),
      kv('سینی خروجی', tray ? tray.name : ''),
      kv('توضیحات', b.note)
    ),
    section(
      'خلاصه و ضایعات',
      kv('ورق مصرفی', kg(sm.lotKg)),
      kv('مواد اولیه‌ی کل (ورق + چسب)', kg(sm.rawKg)),
      kv('سینی تولیدشده', kg(sm.finalKg)),
      kv('جمع ضایعات', kg(sm.waste)),
      kv('بازده', sm.yieldPct == null ? '' : `${toFaDigits(sm.yieldPct)}٪`),
      kv('اجرت برون‌سپاری', sm.fee ? formatMoney(sm.fee) : '')
    ),
    !b.press ? h('button', { class: 'btn primary', style: { width: '100%', marginBottom: '12px' }, onclick: () => quickFinish(ctx, b) }, 'تولید شد (ثبت سریع، رد کردن مراحل)') : null,
    stageCard('glue', '۱) چسب‌کاری و خشک‌کردن', [
      kv('لایه‌ها', `${toFaDigits(g.layers || '')} ورق`),
      ...(g.lots || []).map((x) => { const l = lotsById.get(x.lotId); return kv(l ? `لات ${l.code}` : 'لات حذف‌شده', h('a', { class: 'link', href: l ? `#/inventory/lots/${l.id}` : '#' }, kg(x.kg))); }),
      g.glueKg ? kv(`چسب ${pName(g.glueProductId)}`, kg(g.glueKg)) : null,
      kv('وزن بعد از خشک شدن', kg(g.outKg)),
      kv('ضایعات', kg(g.wasteKg)),
      g.note ? kv('توضیحات', g.note) : null,
    ], () => glueStage(ctx, b)),
    stageCard('cut', '۲) برش', [kv('ورودی', kg(c.inKg)), c.pieces ? kv('قطعه', toFaDigits(c.pieces)) : null, kv('خروجی', kg(c.outKg)), kv('ضایعات', kg(c.wasteKg)), c.note ? kv('توضیحات', c.note) : null], () => cutStage(ctx, b)),
    stageCard('tape', '۳) برون‌سپاری نوار لبه', [
      kv('برون‌سپار', sub ? h('a', { class: 'link', href: `#/parties/${sub.id}` }, partyName(sub)) : ''),
      kv('تحویل به او', `${kg(t.sentKg)}${t.sentPieces ? ` · ${toFaDigits(t.sentPieces)} قطعه` : ''} · ${t.sentDate ? formatJalali(t.sentDate) : ''}`),
      t.tapePieces ? kv(`نوار ${pName(t.tapeProductId)}`, `${toFaDigits(t.tapePieces)} عدد`) : null,
      t.returnedKg ? kv('تحویل گرفته', `${kg(t.returnedKg)}${t.returnDate ? ' · ' + formatJalali(t.returnDate) : ''}`) : kv('تحویل گرفته', 'هنوز نه'),
      t.damagedKg ? kv('آسیب‌دیده', kg(t.damagedKg)) : null,
      t.feePerKg ? kv('اجرت هر کیلو', formatMoney(t.feePerKg)) : null,
      tapeFee(b) ? kv('اجرت قابل پرداخت', formatMoney(tapeFee(b))) : null,
      t.note ? kv('توضیحات', t.note) : null,
    ], () => tapeStage(ctx, b)),
    stageCard('press', '۴) پرس و تولید نهایی', [kv('ورودی', kg(p.inKg)), kv('سینی تولیدشده', kg(p.outKg)), p.pieces ? kv('تعداد', toFaDigits(p.pieces)) : null, kv('ضایعات', kg(p.wasteKg)), p.note ? kv('توضیحات', p.note) : null], () => pressStage(ctx, b), false)
  );
}

// ثبت سریع: فقط وزن سینی تولیدشده؛ مراحل ثبت‌نشده «رد شده» میشوند
function quickFinish(ctx, b) {
  let s;
  const form = buildForm({
    values: {},
    submitText: 'تولید شد',
    onCancel: () => s.close(),
    fields: [
      { name: 'outKg', label: 'وزن سینی تولیدشده (کیلو)', type: 'number', min: 0, required: true, hint: 'همین مقدار به موجودی سینی اضافه میشود. مراحل ثبت‌نشده رد میشوند و بعداً هم میتوانید کامل‌شان کنید.' },
      { name: 'pieces', label: 'تعداد سینی (اختیاری)', type: 'number', min: 0 },
    ],
    onSubmit: async (v, { setError }) => {
      if (!(v.outKg > 0)) return setError('outKg', 'وزن را وارد کنید');
      const patch = { press: { inKg: 0, outKg: v.outKg, wasteKg: 0, pieces: v.pieces || 0 } };
      for (const k of ['glue', 'cut', 'tape']) if (!b[k]) patch[k] = { skipped: true };
      await ctx.db.table(T).update(b.id, patch);
      s.close();
      toast('ثبت شد');
      ctx.refresh();
    },
  });
  s = sheet({ title: 'تولید شد', body: form });
}

async function removeBatch(ctx, b) {
  if (!(await confirmDialog(`دسته‌ی ${b.code} حذف شود؟ مصرف ورق و موجودی سینی آن هم برگردانده میشود.`, { danger: true, okText: 'حذف', title: 'حذف دسته' }))) return;
  await ctx.db.table(T).remove(b.id);
  toast('حذف شد');
  ctx.go('/production');
}

export function registerProduction() {
  // اجرت برون‌سپاری در حساب برون‌سپار بستانکار میشود
  extend('ledger.extras', async (db) => {
    const out = [];
    for (const b of await db.table(T).list()) {
      const fee = tapeFee(b);
      if (fee > 0 && b.tape.partyId) out.push({ partyId: b.tape.partyId, date: b.tape.returnDate || b.tape.sentDate || b.date, sort: b.createdAt || '', desc: `اجرت برون‌سپاری دسته ${b.code}`, credit: fee, debit: 0, refType: 'batch', refId: b.id });
    }
    return out;
  });
  extend('party.deleteGuard', async (db, p) => {
    const n = (await db.table(T).list()).filter((b) => b.tape && b.tape.partyId === p.id).length;
    return n ? `این شخص در ${toFaDigits(n)} دسته‌ی تولید به‌عنوان برون‌سپار ثبت شده.` : null;
  });
  registerModule({
    id: 'production',
    title: 'تولید',
    tables: [T],
    tableLabels: { [T]: 'دسته‌های تولید' },
    fieldLabels: { trayProductId: 'سینی خروجی', glue: 'مرحله‌ی چسب‌کاری', cut: 'مرحله‌ی برش', tape: 'مرحله‌ی برون‌سپاری', press: 'مرحله‌ی پرس' },
    home: { order: 45, label: 'تولید', icon: 'activity', path: '/production', count: async (db) => `${toFaDigits((await db.table(T).list()).length)} دسته` },
    more: { order: 8, label: 'تولید', desc: 'دسته‌ها، مراحل، ضایعات و ردیابی', icon: 'activity', path: '/production' },
    routes: [
      { path: '/production', render: listPage },
      { path: '/production/new', render: formPage },
      { path: '/production/:id/edit', render: formPage },
      { path: '/production/:id', render: detailPage },
    ],
  });
}

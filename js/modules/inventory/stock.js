// منطق خالص انبار: موجودی هر کالا از روی فاکتورها، ورود/خروج دستی و تولید حساب میشود
// (عدد ذخیره‌شده‌ای در کار نیست، پس بعد از ادغام بک‌آپ دو گوشی هم همیشه درست است).
import { typeLabel } from '../invoices/model.js';

export const REASONS = [
  { value: 'opening', label: 'موجودی اول دوره' },
  { value: 'count', label: 'اصلاح بعد از شمارش' },
  { value: 'damage', label: 'ضایعات / خرابی' },
  { value: 'other', label: 'سایر' },
];
export const reasonLabel = (v) => (REASONS.find((r) => r.value === v) || { label: v }).label;

const r3 = (n) => Math.round(n * 1000) / 1000;

export async function loadStockData(db) {
  const [invoices, moves, batches, lots] = await Promise.all([
    db.table('invoices').list(),
    db.table('stock_moves').list(),
    db.table('prod_batches').list(),
    db.table('lots').list(),
  ]);
  return { invoices, moves, batches, lots, lotsById: new Map(lots.map((l) => [l.id, l])) };
}

// مصرف یک لات در دسته‌های تولید
export function lotUsage(lotId, batches) {
  const uses = [];
  for (const b of batches) {
    if (b.deletedAt || !b.glue) continue;
    for (const c of b.glue.lots || []) if (c.lotId === lotId && Number(c.kg) > 0) uses.push({ batch: b, kg: Number(c.kg) });
  }
  return uses;
}
export const lotRemaining = (lot, batches) => r3((Number(lot.kg) || 0) - lotUsage(lot.id, batches).reduce((a, u) => a + u.kg, 0));

// اجرت برون‌سپاری: کیلوی تحویل‌شده (منهای آسیب‌دیده اگر کسر شود) × فی
export function tapeFee(b) {
  const t = b.tape;
  if (!t || !(Number(t.returnedKg) > 0) || !(Number(t.feePerKg) > 0)) return 0;
  const kg = Number(t.returnedKg) - (t.deductDamaged === 'no' ? 0 : Number(t.damagedKg) || 0);
  return Math.round(Math.max(0, kg) * Number(t.feePerKg));
}

// خلاصه‌ی ردیابی و ضایعات یک دسته
export function batchSummary(b, lotsById) {
  const g = b.glue || {};
  const lotKg = (g.lots || []).reduce((a, c) => a + (Number(c.kg) || 0), 0);
  const tapeLoss = b.tape ? Math.max(0, (Number(b.tape.sentKg) || 0) - (Number(b.tape.returnedKg) || 0)) : 0;
  const waste = r3((Number(g.wasteKg) || 0) + (Number((b.cut || {}).wasteKg) || 0) + (b.tape ? (Number(b.tape.damagedKg) || 0) + (b.tape.returnedKg ? tapeLoss : 0) : 0) + (Number((b.press || {}).wasteKg) || 0));
  const finalKg = Number((b.press || {}).outKg) || 0;
  const rawKg = lotKg + (Number(g.glueKg) || 0);
  return { lotKg: r3(lotKg), rawKg: r3(rawKg), waste, finalKg, yieldPct: rawKg > 0 && finalKg > 0 ? Math.round((finalKg / rawKg) * 1000) / 10 : null, fee: tapeFee(b) };
}

// همه‌ی حرکت‌های یک کالا با مانده‌ی جاری (کاردکس)
export function movementsFor(productId, { invoices, moves, batches, lotsById }) {
  const rows = [];
  for (const inv of invoices) {
    if (inv.deletedAt) continue;
    for (const l of inv.lines || []) {
      if (l.productId !== productId) continue;
      const q = Number(l.qty) || 0;
      rows.push({ date: inv.date, sort: inv.createdAt || '', refType: 'invoice', refId: inv.id, desc: `${typeLabel(inv.type)} ${inv.code || ''}`.trim(), qty: inv.type === 'purchase' ? q : -q });
    }
  }
  for (const m of moves) {
    if (m.deletedAt || m.productId !== productId) continue;
    const q = Number(m.qty) || 0;
    rows.push({ date: m.date, sort: m.createdAt || '', refType: 'move', refId: m.id, desc: `${m.direction === 'in' ? 'ورود' : 'خروج'} دستی · ${reasonLabel(m.reason)}`, qty: m.direction === 'in' ? q : -q });
  }
  for (const b of batches) {
    if (b.deletedAt) continue;
    const g = b.glue;
    if (g) {
      for (const c of g.lots || []) {
        const lot = lotsById.get(c.lotId);
        if (lot && lot.productId === productId && Number(c.kg) > 0) rows.push({ date: b.date, sort: b.createdAt || '', refType: 'batch', refId: b.id, desc: `مصرف در دسته ${b.code} (لات ${lot.code})`, qty: -Number(c.kg) });
      }
      if (g.glueProductId === productId && Number(g.glueKg) > 0) rows.push({ date: b.date, sort: b.createdAt || '', refType: 'batch', refId: b.id, desc: `چسب مصرفی دسته ${b.code}`, qty: -Number(g.glueKg) });
    }
    if (b.tape && b.tape.tapeProductId === productId && Number(b.tape.tapePieces) > 0) rows.push({ date: b.tape.sentDate || b.date, sort: b.createdAt || '', refType: 'batch', refId: b.id, desc: `نوار تحویلی به برون‌سپار، دسته ${b.code}`, qty: -Number(b.tape.tapePieces) });
    if (b.trayProductId === productId && b.press && Number(b.press.outKg) > 0) rows.push({ date: b.date, sort: b.createdAt || '', refType: 'batch', refId: b.id, desc: `تولید دسته ${b.code}`, qty: Number(b.press.outKg) });
  }
  rows.sort((a, b) => (a.date === b.date ? (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0) : a.date < b.date ? -1 : 1));
  let bal = 0;
  for (const r of rows) {
    bal = r3(bal + r.qty);
    r.balance = bal;
  }
  return rows;
}

export function stockOf(productId, data) {
  const rows = movementsFor(productId, data);
  return rows.length ? rows[rows.length - 1].balance : 0;
}

// ---- لات‌ها: هر ردیف ورق در فاکتور خرید = یک لات (با کد خودکار قابل ویرایش)
export async function syncLots(db) {
  const [invoices, products, lots, batches, moves] = await Promise.all([db.table('invoices').list(), db.table('products').list(), db.table('lots').list({ includeDeleted: true }), db.table('prod_batches').list(), db.table('stock_moves').list()]);
  const pById = new Map(products.map((p) => [p.id, p]));
  const byId = new Map(lots.map((l) => [l.id, l]));
  const t = db.table('lots');
  const wanted = new Set();
  for (const inv of invoices) {
    if (inv.type !== 'purchase') continue;
    for (let i = 0; i < (inv.lines || []).length; i++) {
      const l = inv.lines[i];
      const p = pById.get(l.productId);
      if (!p || p.kind !== 'sheet') continue;
      const lid = l.lid || 'i' + i;
      const id = `lot_${inv.id}_${lid}`;
      wanted.add(id);
      const src = { invoiceId: inv.id, lid, productId: l.productId, kg: Number(l.qty) || 0, date: inv.date, orphan: false };
      const ex = byId.get(id);
      if (!ex) await t.create(src, { id, prefix: 'LOT', silent: true });
      else if (ex.deletedAt || ex.kg !== src.kg || ex.date !== src.date || ex.productId !== src.productId || ex.orphan || ex.invoiceId !== src.invoiceId) await t.update(id, { ...src, deletedAt: null }, { silent: true });
    }
  }
  // ورود دستی ورق هم لات می‌سازد تا در تولید قابل انتخاب باشد
  for (const m of moves) {
    const p = pById.get(m.productId);
    if (m.direction !== 'in' || !p || p.kind !== 'sheet') continue;
    const id = `lot_m_${m.id}`;
    wanted.add(id);
    const src = { moveId: m.id, productId: m.productId, kg: Number(m.qty) || 0, date: m.date, orphan: false };
    const ex = byId.get(id);
    if (!ex) await t.create(src, { id, prefix: 'LOT', silent: true });
    else if (ex.deletedAt || ex.kg !== src.kg || ex.date !== src.date || ex.productId !== src.productId || ex.orphan) await t.update(id, { ...src, deletedAt: null }, { silent: true });
  }
  for (const l of lots) {
    if (l.deletedAt || wanted.has(l.id)) continue;
    if (lotUsage(l.id, batches).length) {
      if (!l.orphan) await t.update(l.id, { orphan: true }, { silent: true });
    } else await t.remove(l.id);
  }
}

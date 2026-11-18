// منطق خالص انبار: موجودی هر کالا فقط از فاکتورهای خرید/فروش و ورود/خروج دستی حساب میشود
// (عدد ذخیره‌شده‌ای در کار نیست، پس بعد از ادغام بک‌آپ دو گوشی هم همیشه درست است).
import { typeLabel } from '../invoices/model.js';

export const REASONS_IN = [
  { value: 'opening', label: 'موجودی اول دوره' },
  { value: 'produced', label: 'تولید شده' },
  { value: 'cutwaste', label: 'ورود ضایعات برش' },
  { value: 'count', label: 'اصلاح موجودی' },
  { value: 'other', label: 'سایر' },
];
export const REASONS_OUT = [
  { value: 'consume', label: 'مصرف در تولید' },
  { value: 'damage', label: 'ضایعات / خرابی' },
  { value: 'count', label: 'اصلاح موجودی' },
  { value: 'other', label: 'سایر' },
];
export const REASONS = [...REASONS_IN, ...REASONS_OUT];
export const reasonLabel = (v) => (REASONS.find((r) => r.value === v) || { label: v }).label;

const r3 = (n) => Math.round(n * 1000) / 1000;

export async function loadStockData(db) {
  const [invoices, moves] = await Promise.all([db.table('invoices').list(), db.table('stock_moves').list()]);
  return { invoices, moves };
}

// همه‌ی حرکت‌های یک کالا با مانده‌ی جاری (کاردکس)
export function movementsFor(productId, { invoices, moves }) {
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
    rows.push({ date: m.date, sort: m.createdAt || '', refType: 'move', refId: m.id, runTag: m.runTag || '', desc: `${m.direction === 'in' ? 'ورود' : 'خروج'} دستی · ${reasonLabel(m.reason)}${m.runTag ? ` · تولید ${m.runTag}` : ''}`, qty: m.direction === 'in' ? q : -q });
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

// گروه‌بندی حرکت‌های دستی بر اساس «شماره تولید»
export function runsFrom(moves) {
  const map = new Map();
  for (const m of moves) {
    if (m.deletedAt || !m.runTag) continue;
    if (!map.has(m.runTag)) map.set(m.runTag, []);
    map.get(m.runTag).push(m);
  }
  return map;
}

// جمع ورود/خروج هر کالا در یک شماره تولید
export function runTotals(list) {
  const by = new Map();
  for (const m of list) {
    const e = by.get(m.productId) || { productId: m.productId, in: 0, out: 0 };
    const q = Number(m.qty) || 0;
    if (m.direction === 'in') e.in = r3(e.in + q);
    else e.out = r3(e.out + q);
    by.set(m.productId, e);
  }
  return [...by.values()];
}

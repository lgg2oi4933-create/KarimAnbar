// محاسبات خالص گزارش‌ها: فروش/خرید، سود هر محصول، کم‌موجودی.
// بهای تمام‌شده: کالاهای خریداری‌شده = میانگین وزنی قیمت خرید؛ سینی = میانگین بهای دسته‌های تولید
// (ورق هر لات به قیمت فاکتور همان لات + چسب + نوار + اجرت برون‌سپاری) تقسیم بر کیلوی تولیدشده.
import { invoiceTotals, lineAmount } from '../../core/finance.js';
import { tapeFee, stockOf } from '../inventory/stock.js';

const r0 = Math.round;

export function avgPurchasePrices(invoices) {
  const acc = new Map();
  for (const inv of invoices) {
    if (inv.deletedAt || inv.type !== 'purchase') continue;
    for (const l of inv.lines || []) {
      if (!l.productId) continue;
      const a = acc.get(l.productId) || { q: 0, v: 0 };
      a.q += Number(l.qty) || 0;
      a.v += lineAmount(l);
      acc.set(l.productId, a);
    }
  }
  const out = new Map();
  for (const [id, a] of acc) if (a.q > 0) out.set(id, a.v / a.q);
  return out;
}

// قیمت هر کیلوی یک لات: قیمت ردیف فاکتور خودش، وگرنه میانگین خرید همان ورق
function lotPrice(lot, invoicesById, avg) {
  if (lot.invoiceId) {
    const inv = invoicesById.get(lot.invoiceId);
    const l = inv && (inv.lines || []).find((x, i) => (x.lid || 'i' + i) === lot.lid);
    if (l && Number(l.price) > 0) return Number(l.price);
  }
  return avg.get(lot.productId) || 0;
}

// بهای تمام‌شده‌ی هر دسته؛ دسته‌ای که ورق مصرفی ثبت نشده «ناقص» است
export function batchCost(b, { lotsById, invoicesById, avg }) {
  const g = b.glue && !b.glue.skipped ? b.glue : null;
  if (!g) return { cost: 0, complete: false };
  let cost = 0;
  for (const c of g.lots || []) {
    const lot = lotsById.get(c.lotId);
    if (lot) cost += (Number(c.kg) || 0) * lotPrice(lot, invoicesById, avg);
  }
  cost += (Number(g.glueKg) || 0) * (avg.get(g.glueProductId) || 0);
  if (b.tape && !b.tape.skipped) cost += (Number(b.tape.tapePieces) || 0) * (avg.get(b.tape.tapeProductId) || 0) + tapeFee(b);
  return { cost, complete: true };
}

export function unitCosts({ invoices, batches, lots }) {
  const avg = avgPurchasePrices(invoices);
  const costs = new Map();
  for (const [id, c] of avg) costs.set(id, { cost: c, source: 'purchase' });
  const invoicesById = new Map(invoices.map((i) => [i.id, i]));
  const lotsById = new Map(lots.map((l) => [l.id, l]));
  const acc = new Map();
  for (const b of batches) {
    if (b.deletedAt || !b.press || !(Number(b.press.outKg) > 0)) continue;
    const bc = batchCost(b, { lotsById, invoicesById, avg });
    if (!bc.complete) continue;
    const a = acc.get(b.trayProductId) || { cost: 0, kg: 0 };
    a.cost += bc.cost;
    a.kg += Number(b.press.outKg);
    acc.set(b.trayProductId, a);
  }
  for (const [id, a] of acc) if (a.kg > 0) costs.set(id, { cost: a.cost / a.kg, source: 'production' });
  return costs;
}

// سود هر محصول در بازه (فاکتور فروش، بدون مالیات؛ تخفیف فاکتور به نسبت پخش میشود)
export function profitByProduct(data, from, to) {
  const costs = unitCosts(data);
  const byProduct = new Map();
  for (const inv of data.invoices) {
    if (inv.deletedAt || inv.type !== 'sale' || inv.date < from || inv.date > to) continue;
    const t = invoiceTotals(inv);
    const factor = t.subtotal > 0 ? t.taxable / t.subtotal : 1;
    for (const l of inv.lines || []) {
      const key = l.productId || 'title:' + (l.title || '');
      const a = byProduct.get(key) || { productId: l.productId || '', title: l.title || '', qty: 0, revenue: 0 };
      a.qty += Number(l.qty) || 0;
      a.revenue += lineAmount(l) * factor;
      byProduct.set(key, a);
    }
  }
  const rows = [];
  let revenue = 0;
  let cost = 0;
  let unknown = 0;
  for (const a of byProduct.values()) {
    const c = a.productId ? costs.get(a.productId) : null;
    const known = !!c;
    const rc = known ? a.qty * c.cost : null;
    const row = { ...a, revenue: r0(a.revenue), unitCost: known ? c.cost : null, source: known ? c.source : null, cost: known ? r0(rc) : null, profit: known ? r0(a.revenue - rc) : null, margin: known && a.revenue > 0 ? Math.round(((a.revenue - rc) / a.revenue) * 1000) / 10 : null, known };
    rows.push(row);
    revenue += row.revenue;
    if (known) cost += row.cost;
    else unknown += 1;
  }
  rows.sort((x, y) => y.revenue - x.revenue);
  const knownRevenue = rows.filter((r) => r.known).reduce((s, r) => s + r.revenue, 0);
  return { rows, revenue, cost, profit: knownRevenue - cost, knownRevenue, unknown };
}

export function periodTotals({ invoices, payments, checks }, from, to, isEffective) {
  const checksById = new Map(checks.map((c) => [c.id, c]));
  let sales = 0;
  let purchases = 0;
  for (const inv of invoices) {
    if (inv.deletedAt || inv.date < from || inv.date > to) continue;
    const t = invoiceTotals(inv).total;
    inv.type === 'sale' ? (sales += t) : (purchases += t);
  }
  let received = 0;
  let paid = 0;
  for (const p of payments) {
    if (p.deletedAt || p.date < from || p.date > to || !isEffective(p, checksById)) continue;
    p.direction === 'in' ? (received += Number(p.amount) || 0) : (paid += Number(p.amount) || 0);
  }
  return { sales, purchases, received, paid };
}

export function topCustomers(invoices, parties, from, to, n = 5) {
  const m = new Map();
  for (const inv of invoices) {
    if (inv.deletedAt || inv.type !== 'sale' || inv.date < from || inv.date > to) continue;
    m.set(inv.partyId, (m.get(inv.partyId) || 0) + invoiceTotals(inv).total);
  }
  const byId = new Map(parties.map((p) => [p.id, p]));
  return [...m.entries()].map(([id, total]) => ({ party: byId.get(id), total })).sort((a, b) => b.total - a.total).slice(0, n);
}

export function wasteInPeriod(batches, from, to, summary) {
  let waste = 0;
  let finalKg = 0;
  let rawKg = 0;
  let n = 0;
  for (const b of batches) {
    if (b.deletedAt || b.date < from || b.date > to || !b.press) continue;
    const s = summary(b);
    n += 1;
    waste += s.waste;
    finalKg += s.finalKg;
    rawKg += s.rawKg;
  }
  return { n, waste: Math.round(waste * 1000) / 1000, finalKg, rawKg, yieldPct: rawKg > 0 ? Math.round((finalKg / rawKg) * 1000) / 10 : null };
}

export function lowStock(products, stockData) {
  return products
    .filter((p) => !p.deletedAt && Number(p.minStock) > 0)
    .map((p) => ({ product: p, qty: stockOf(p.id, stockData), min: Number(p.minStock) }))
    .filter((x) => x.qty < x.min)
    .sort((a, b) => a.qty / a.min - b.qty / b.min);
}

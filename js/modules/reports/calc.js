// محاسبات خالص گزارش‌ها: فروش/خرید، سود (از «قیمت تمام‌شده»ی واردشده در هر ردیف فاکتور فروش) و کم‌موجودی.
// سود هر ردیف = (فی بعد از ضریب تخفیف فاکتور − قیمت تمام‌شده) × مقدار؛ ردیف بدون قیمت تمام‌شده حساب نمیشود.
import { invoiceTotals, invoiceProfit } from '../../core/finance.js';
import { stockOf } from '../inventory/stock.js';

const inRange = (inv, from, to) => !inv.deletedAt && inv.type === 'sale' && inv.date >= from && inv.date <= to;

// سود هر محصول در بازه
export function profitByProduct(invoices, from, to) {
  const by = new Map();
  let revenue = 0;
  let cost = 0;
  let missing = 0;
  for (const inv of invoices) {
    if (!inRange(inv, from, to)) continue;
    for (const x of invoiceProfit(inv).lines) {
      const l = x.line;
      const key = l.productId || 'title:' + (l.title || '');
      const a = by.get(key) || { productId: l.productId || '', title: l.title || '', qty: 0, revenue: 0, cost: 0, profit: 0, missing: 0 };
      if (x.cost == null) {
        a.missing += 1;
        missing += 1;
      } else {
        a.qty += Number(l.qty) || 0;
        a.revenue += x.revenue;
        a.cost += x.cost;
        a.profit += x.profit;
        revenue += x.revenue;
        cost += x.cost;
      }
      by.set(key, a);
    }
  }
  const rows = [...by.values()].map((a) => ({ ...a, margin: a.revenue > 0 ? Math.round((a.profit / a.revenue) * 1000) / 10 : null }));
  rows.sort((x, y) => y.profit - x.profit);
  return { rows, revenue, cost, profit: revenue - cost, missing };
}

// سود هر مشتری در بازه
export function profitByCustomer(invoices, parties, from, to) {
  const by = new Map();
  for (const inv of invoices) {
    if (!inRange(inv, from, to)) continue;
    const pr = invoiceProfit(inv);
    const a = by.get(inv.partyId) || { revenue: 0, cost: 0, profit: 0, missing: 0, sales: 0 };
    a.revenue += pr.revenue;
    a.cost += pr.cost;
    a.profit += pr.profit;
    a.missing += pr.missing;
    a.sales += invoiceTotals(inv).total;
    by.set(inv.partyId, a);
  }
  const byId = new Map(parties.map((p) => [p.id, p]));
  return [...by.entries()].map(([id, a]) => ({ party: byId.get(id), ...a })).sort((x, y) => y.profit - x.profit);
}

// سود چند ماه (بازه‌هایی که از بیرون داده میشود)
export function profitByMonth(invoices, ranges) {
  return ranges.map((r) => {
    const p = profitByProduct(invoices, r.from, r.to);
    return { ...r, revenue: p.revenue, cost: p.cost, profit: p.profit, missing: p.missing };
  });
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

export function lowStock(products, stockData) {
  return products
    .filter((p) => !p.deletedAt && p.kind !== 'service' && Number(p.minStock) > 0)
    .map((p) => ({ product: p, qty: stockOf(p.id, stockData), min: Number(p.minStock) }))
    .filter((x) => x.qty < x.min)
    .sort((a, b) => a.qty / a.min - b.qty / b.min);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitByProduct, profitByCustomer, profitByMonth, lowStock, periodTotals } from '../js/modules/reports/calc.js';
import { invoiceProfit, isPaymentEffective } from '../js/core/finance.js';

const inv = [
  { id: 'S1', type: 'sale', partyId: 'c1', date: '2026-11-10', discount: 100, taxPercent: 10, lines: [{ productId: 'tray', qty: 10, price: 100, unitCost: 60 }, { productId: 'tray2', qty: 10, price: 100 }] },
  { id: 'S2', type: 'sale', partyId: 'c2', date: '2026-10-01', lines: [{ productId: 'tray', qty: 5, price: 100, unitCost: 80 }] },
  { id: 'P1', type: 'purchase', partyId: 's', date: '2026-11-02', lines: [{ productId: 'sheet', qty: 100, price: 10 }] },
];

test('profit: بعد از تخفیف، قبل از مالیات، بدون‌بها حذف', () => {
  const p = invoiceProfit(inv[0]);
  // subtotal 2000, discount 100 → factor 0.95؛ ردیف اول درآمد 950، بها 600
  assert.equal(p.revenue, 950);
  assert.equal(p.cost, 600);
  assert.equal(p.profit, 350);
  assert.equal(p.missing, 1);
});
test('reports: سود هر محصول/مشتری/ماه', () => {
  const pr = profitByProduct(inv, '2026-11-01', '2026-11-30');
  assert.equal(pr.profit, 350);
  assert.equal(pr.missing, 1);
  const c = profitByCustomer(inv, [{ id: 'c1' }, { id: 'c2' }], '2026-10-01', '2026-11-30');
  assert.equal(c.length, 2);
  assert.equal(c[0].party.id, 'c1');
  const m = profitByMonth(inv, [{ from: '2026-10-01', to: '2026-10-31' }, { from: '2026-11-01', to: '2026-11-30' }]);
  assert.equal(m[0].profit, 100);
  assert.equal(m[1].profit, 350);
});
test('reports: کم‌موجودی و جمع بازه', () => {
  const stock = { invoices: inv, moves: [] };
  const low = lowStock([{ id: 'sheet', kind: 'sheet', minStock: 500 }, { id: 'svc', kind: 'service', minStock: 5 }], stock);
  assert.equal(low.length, 1);
  const t = periodTotals({ invoices: inv, payments: [], checks: [] }, '2026-11-01', '2026-11-30', isPaymentEffective);
  assert.ok(t.sales > 0 && t.purchases === 1000);
});

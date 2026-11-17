import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitByProduct, lowStock, periodTotals, unitCosts } from '../js/modules/reports/calc.js';
import { isPaymentEffective } from '../js/core/finance.js';

const lots = [{ id: 'L1', code: 'LOT-1', productId: 'sheet', invoiceId: 'P1', lid: 'a', kg: 1000 }];
const invoices = [
  { id: 'P1', type: 'purchase', date: '2026-11-01', lines: [{ lid: 'a', productId: 'sheet', qty: 1000, price: 50000 }, { productId: 'glue', qty: 100, price: 30000 }, { productId: 'tape', qty: 1000, price: 2000 }], discount: 0, taxPercent: 0 },
  { id: 'S1', type: 'sale', date: '2026-11-15', partyId: 'c1', lines: [{ productId: 'tray', qty: 100, price: 120000 }, { productId: 'other', qty: 1, price: 1000 }], discount: 0, taxPercent: 10 },
];
const batches = [{
  id: 'B1', date: '2026-11-10', trayProductId: 'tray',
  glue: { lots: [{ lotId: 'L1', kg: 400 }], glueProductId: 'glue', glueKg: 20, outKg: 400, wasteKg: 20 },
  tape: { tapeProductId: 'tape', tapePieces: 500, returnedKg: 378, damagedKg: 8, feePerKg: 10000, deductDamaged: 'yes' },
  press: { outKg: 360, wasteKg: 10 },
}];
const data = { invoices, batches, lots };

test('reports: بهای تمام‌شده‌ی سینی از ورق + چسب + نوار + اجرت', () => {
  // 400*50000 + 20*30000 + 500*2000 + 370*10000 = 20,000,000 + 600,000 + 1,000,000 + 3,700,000
  const c = unitCosts(data).get('tray');
  assert.equal(c.source, 'production');
  assert.equal(Math.round(c.cost * 360), 25300000);
});
test('reports: سود هر محصول و کالای بدون بها', () => {
  const r = profitByProduct(data, '2026-11-01', '2026-11-30');
  const tray = r.rows.find((x) => x.productId === 'tray');
  assert.equal(tray.revenue, 12000000);
  assert.equal(tray.cost, Math.round((25300000 / 360) * 100));
  assert.equal(r.unknown, 1);
});
test('reports: کم‌موجودی و جمع بازه', () => {
  const ls = lowStock([{ id: 'sheet', minStock: 1000 }, { id: 'glue' }], { invoices, moves: [], batches, lotsById: new Map(lots.map((l) => [l.id, l])) });
  assert.equal(ls.length, 1);
  assert.equal(ls[0].qty, 600);
  const t = periodTotals({ invoices, payments: [{ direction: 'in', amount: 5, date: '2026-11-16' }], checks: [] }, '2026-11-01', '2026-11-30', isPaymentEffective);
  assert.equal(Math.round(t.sales), 13201100);
  assert.equal(t.received, 5);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movementsFor, stockOf, lotRemaining, batchSummary, tapeFee } from '../js/modules/inventory/stock.js';

const lot = { id: 'L1', code: 'LOT-A0001', productId: 'sheet', kg: 1000 };
const lotsById = new Map([[lot.id, lot]]);
const batch = {
  id: 'B1', code: 'B-A0001', date: '2026-11-10', trayProductId: 'tray',
  glue: { lots: [{ lotId: 'L1', kg: 400 }], glueProductId: 'glue', glueKg: 20, outKg: 400, wasteKg: 20 },
  cut: { inKg: 400, outKg: 380, wasteKg: 20 },
  tape: { sentKg: 380, returnedKg: 378, damagedKg: 8, feePerKg: 10000, tapeProductId: 'tape', tapePieces: 500, deductDamaged: 'yes' },
  press: { inKg: 370, outKg: 360, wasteKg: 10 },
};
const data = {
  invoices: [
    { id: 'I1', type: 'purchase', code: 'PI-1', date: '2026-11-01', lines: [{ productId: 'sheet', qty: 1000 }, { productId: 'tape', qty: 2000 }] },
    { id: 'I2', type: 'sale', code: 'SI-1', date: '2026-11-12', lines: [{ productId: 'tray', qty: 100 }] },
  ],
  moves: [{ id: 'M1', productId: 'sheet', direction: 'out', qty: 50, date: '2026-11-02', reason: 'damage' }],
  batches: [batch],
  lotsById,
};

test('stock: ورق = خرید - خروج دستی - مصرف دسته', () => {
  assert.equal(stockOf('sheet', data), 1000 - 50 - 400);
  assert.equal(stockOf('tape', data), 2000 - 500);
  assert.equal(stockOf('glue', data), -20);
  assert.equal(stockOf('tray', data), 360 - 100);
});
test('stock: باقی‌مانده‌ی لات و ردیابی', () => {
  assert.equal(lotRemaining(lot, [batch]), 600);
  assert.equal(movementsFor('sheet', data).length, 3);
});
test('stock: اجرت برون‌سپاری و ضایعات', () => {
  assert.equal(tapeFee(batch), (378 - 8) * 10000);
  const s = batchSummary(batch, lotsById);
  assert.equal(s.lotKg, 400);
  assert.equal(s.finalKg, 360);
  // 20 + 20 + (8 damaged + 2 loss) + 10
  assert.equal(s.waste, 60);
});

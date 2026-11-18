import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movementsFor, stockOf, runsFrom, runTotals, reasonLabel } from '../js/modules/inventory/stock.js';

const data = {
  invoices: [
    { id: 'I1', type: 'purchase', code: 'PI-1', date: '2026-11-01', lines: [{ productId: 'sheet', qty: 1000 }, { productId: 'svc', qty: 300 }] },
    { id: 'I2', type: 'sale', code: 'SI-1', date: '2026-11-12', lines: [{ productId: 'tray', qty: 100 }] },
  ],
  moves: [
    { id: 'M1', productId: 'sheet', direction: 'out', qty: 400, date: '2026-11-02', reason: 'consume', runTag: '7' },
    { id: 'M2', productId: 'tray', direction: 'in', qty: 360, date: '2026-11-03', reason: 'produced', runTag: '7' },
    { id: 'M3', productId: 'waste', direction: 'in', qty: 20, date: '2026-11-03', reason: 'cutwaste', runTag: '7' },
    { id: 'M4', productId: 'sheet', direction: 'out', qty: 5, date: '2026-11-04', reason: 'damage', deletedAt: 'x' },
  ],
};

test('stock: فقط فاکتور و ورود/خروج دستی', () => {
  assert.equal(stockOf('sheet', data), 600);
  assert.equal(stockOf('tray', data), 260);
  assert.equal(stockOf('waste', data), 20);
});
test('stock: کاردکس مرتب و با مانده', () => {
  const rows = movementsFor('sheet', data);
  assert.deepEqual(rows.map((r) => r.balance), [1000, 600]);
  assert.match(rows[1].desc, /مصرف در تولید/);
});
test('stock: شماره تولید گروه‌بندی میشود', () => {
  const runs = runsFrom(data.moves);
  assert.equal(runs.size, 1);
  const t = runTotals(runs.get('7'));
  assert.equal(t.find((x) => x.productId === 'sheet').out, 400);
  assert.equal(t.find((x) => x.productId === 'tray').in, 360);
});
test('stock: برچسب علت‌ها', () => {
  assert.equal(reasonLabel('produced'), 'تولید شده');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestMatch } from '../js/modules/voice/match.js';
import { resolveParsed } from '../js/modules/voice/resolve.js';

const parties = [
  { id: 'p1', firstName: 'علی', lastName: 'کریمی', roles: ['customer'] },
  { id: 'p2', firstName: 'مریم', lastName: 'جلالی', roles: ['subcontractor'] },
  { id: 'p3', company: 'نوین ورق', roles: ['supplier'] },
];
const products = [
  { id: 'a', name: 'سینی ۲۰×۳۰', kind: 'tray', length: 20, width: 30, unit: 'kg' },
  { id: 'b', name: 'چسب نقره‌ای', kind: 'glue', unit: 'kg' },
  { id: 'c', name: 'نوارچسب‌کاری', kind: 'service', unit: 'kg' },
  { id: 'd', name: 'ضایعات برش', kind: 'waste', unit: 'kg' },
];

test('match: نام ناقص و ترتیب متفاوت', () => {
  const c = parties.map((p) => ({ id: p.id, text: [p.company, p.firstName, p.lastName].filter(Boolean).join(' ') }));
  assert.equal(bestMatch('کریمی', c).id, 'p1');
  assert.equal(bestMatch('جلالی مریم', c).id, 'p2');
  assert.equal(bestMatch('ناشناس', c), null);
});
test('resolve: فاکتور فروش با ابعاد', () => {
  const r = resolveParsed({ kind: 'sale', party: 'آقای کریمی', items: [{ product: 'سینی', length_cm: 20, width_cm: 30, qty: 100, price: 250000, unit: 'kg' }] }, { parties, products });
  assert.equal(r.partyId, 'p1');
  assert.equal(r.lines[0].productId, 'a');
  assert.equal(r.lines[0].price, 250000);
});
test('resolve: خرید خدمات از برون‌سپار و کالای ناشناس', () => {
  const r = resolveParsed({ kind: 'purchase', party: 'مریم جلالی', items: [{ product: 'نوارچسب کاری', qty: 380, price: 10000 }, { product: 'قیف طلایی', qty: 1, price: 5 }] }, { parties, products });
  assert.equal(r.partyId, 'p2');
  assert.equal(r.lines[0].productId, 'c');
  assert.equal(r.lines[1].productId, '');
  assert.equal(r.warnings.length, 1);
});
test('resolve: ورود/خروج انبار با علت و شماره تولید', () => {
  const r = resolveParsed({ kind: 'stock_out', run_tag: 12, items: [{ product: 'چسب نقره‌ای', qty: 20, reason: 'consume' }, { product: 'ضایعات برش', qty: 5, direction: 'in', reason: 'cutwaste' }] }, { parties, products });
  assert.equal(r.moves[0].direction, 'out');
  assert.equal(r.moves[0].reason, 'consume');
  assert.equal(r.moves[1].direction, 'in');
  assert.equal(r.moves[1].runTag, '12');
});
test('resolve: خدمات در انبار انتخاب نمیشود', () => {
  const r = resolveParsed({ kind: 'stock_in', items: [{ product: 'نوارچسب‌کاری', qty: 1 }] }, { parties, products });
  assert.equal(r.moves[0].productId, '');
});

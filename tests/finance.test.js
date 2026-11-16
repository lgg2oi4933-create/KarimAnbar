import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../js/core/storage.js';
import { Db } from '../js/core/repo.js';
import { invoiceTotals, lineAmount, ledgerFor, filterLedger, paidForInvoice, indexById, checksDueSoon } from '../js/core/finance.js';
import { hashPassword, verifyPassword, normalizeCode, makeRecoveryCode } from '../js/core/crypto.js';
import { numberToWords, formatMoney } from '../js/core/util.js';
import { buildPdf } from '../js/ui/pdf.js';
import { diffDaysIso } from '../js/core/jalali.js';
import { savePayment, deletePaymentCascade, endorseCheck, unendorseCheck, setCheckStatus } from '../js/modules/payments/service.js';

test('invoice totals: discount then tax, rounding', () => {
  const inv = { lines: [{ qty: 100, price: 250000 }, { qty: 12.5, price: 40001 }], discount: 1000000, taxPercent: 10 };
  const t = invoiceTotals(inv);
  assert.equal(lineAmount(inv.lines[1]), 500013);
  assert.equal(t.subtotal, 25000000 + 500013);
  assert.equal(t.taxable, t.subtotal - 1000000);
  assert.equal(t.tax, Math.round(t.taxable * 0.1));
  assert.equal(t.total, t.taxable + t.tax);
  // تخفیف بیشتر از جمع نمیتواند منفی بسازد
  assert.equal(invoiceTotals({ lines: [{ qty: 1, price: 100 }], discount: 5000, taxPercent: 10 }).total, 0);
});

test('ledger: sale, receipt, purchase, opening balance and running balance', () => {
  const party = { id: 'p1', openingType: 'creditor', openingAmount: 1000 };
  const invoices = [
    { id: 'i1', partyId: 'p1', type: 'sale', code: 'SI-1', date: '2026-01-10', createdAt: '1', lines: [{ qty: 10, price: 1000 }], taxPercent: 0 },
    { id: 'i2', partyId: 'p1', type: 'purchase', code: 'PI-1', date: '2026-01-12', createdAt: '2', lines: [{ qty: 1, price: 500 }], taxPercent: 0 },
    { id: 'x', partyId: 'other', type: 'sale', date: '2026-01-10', lines: [{ qty: 1, price: 9 }] },
  ];
  const payments = [{ id: 'r1', partyId: 'p1', direction: 'in', method: 'cash', amount: 4000, date: '2026-01-15', createdAt: '3' }];
  const r = ledgerFor(party, invoices, payments, []);
  // مانده اول: ما ۱۰۰۰ بدهکاریم (-۱۰۰۰) ← فروش ۱۰۰۰۰ ← خرید ۵۰۰ ← دریافت ۴۰۰۰
  assert.deepEqual(r.rows.map((x) => x.balance), [-1000, 9000, 8500, 4500]);
  assert.equal(r.balance, 4500);
  assert.equal(r.debit, 10000);
  assert.equal(r.credit, 5500);
  const f = filterLedger(r, '2026-01-12', '2026-01-31');
  assert.equal(f.shown[0].kind, 'carry');
  assert.equal(f.shown[0].balance, 9000);
  assert.equal(f.shown.length, 3);
});

test('ledger: bounced check has no effect on balance or invoice paid amount', () => {
  const party = { id: 'p1' };
  const invoices = [{ id: 'i1', partyId: 'p1', type: 'sale', code: 'S', date: '2026-02-01', createdAt: '1', lines: [{ qty: 1, price: 1000 }], taxPercent: 0 }];
  const payments = [{ id: 'r1', partyId: 'p1', direction: 'in', method: 'check', checkId: 'c1', amount: 1000, date: '2026-02-02', createdAt: '2', invoiceId: 'i1' }];
  const checks = [{ id: 'c1', status: 'pending' }];
  assert.equal(ledgerFor(party, invoices, payments, checks).balance, 0);
  assert.equal(paidForInvoice('i1', payments, indexById(checks)), 1000);
  checks[0].status = 'bounced';
  assert.equal(ledgerFor(party, invoices, payments, checks).balance, 1000);
  assert.equal(paidForInvoice('i1', payments, indexById(checks)), 0);
});

test('checks due soon: overdue and next 7 days only, pending and not endorsed', () => {
  const today = '2026-03-10';
  const checks = [
    { id: 'a', status: 'pending', dueDate: '2026-03-05' },
    { id: 'b', status: 'pending', dueDate: '2026-03-15' },
    { id: 'c', status: 'pending', dueDate: '2026-03-30' },
    { id: 'd', status: 'cleared', dueDate: '2026-03-11' },
    { id: 'e', status: 'pending', dueDate: '2026-03-11', endorsementPaymentId: 'x' },
    { id: 'f', status: 'pending', dueDate: '2026-03-11', deletedAt: 'x' },
  ];
  assert.deepEqual(checksDueSoon(checks, today, 7, diffDaysIso).map((x) => x.check.id), ['a', 'b']);
});

async function makeDb() {
  const adapter = new MemoryAdapter();
  await adapter.init(['counters', 'activity_log', 'payments', 'checks']);
  let t = 0;
  return new Db(adapter, { getDeviceId: () => 'd', getDeviceTag: () => 'A', getUser: () => ({ id: 'u', name: 'مدیر' }), now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString() });
}

test('payment service: check created, edited, switched to cash, endorsed and cascaded', async () => {
  const db = await makeDb();
  const base = { direction: 'in', method: 'check', date: '2026-01-05', partyId: 'cust', amount: 5000, check: { number: '123', bank: 'ملی', dueDate: '2026-02-01', status: 'pending' } };
  let p = await savePayment(db, base);
  assert.equal(p.code, 'RC-A0001');
  let checks = await db.table('checks').list();
  assert.equal(checks.length, 1);
  assert.equal(checks[0].direction, 'received');
  assert.equal(checks[0].paymentId, p.id);

  // ویرایش مبلغ و وضعیت
  p = await savePayment(db, { ...base, amount: 7000, check: { ...base.check, status: 'cleared' } }, p);
  checks = await db.table('checks').list();
  assert.equal(checks.length, 1);
  assert.equal(checks[0].amount, 7000);
  assert.equal(checks[0].status, 'cleared');
  assert.ok(checks[0].clearedDate);

  // خرج چک
  await setCheckStatus(db, checks[0], 'pending');
  const fresh = await db.table('checks').get(checks[0].id);
  const ep = await endorseCheck(db, fresh, { partyId: 'supp', date: '2026-01-20' });
  assert.equal(ep.direction, 'out');
  assert.equal(ep.kind, 'endorse');
  assert.equal((await db.table('checks').get(fresh.id)).endorsementPaymentId, ep.id);
  // تغییر مبلغ چک روی مبلغ خرج هم اثر میگذارد
  await savePayment(db, { ...base, amount: 8000 }, p);
  assert.equal((await db.table('payments').get(ep.id)).amount, 8000);

  // لغو خرج
  await unendorseCheck(db, await db.table('checks').get(fresh.id));
  assert.equal((await db.table('payments').list()).length, 1);
  assert.equal((await db.table('checks').get(fresh.id)).endorsementPaymentId, '');

  // تبدیل به نقد، چک حذف میشود
  p = await savePayment(db, { ...base, method: 'cash', check: undefined }, p);
  assert.equal((await db.table('checks').list()).length, 0);
  assert.equal(p.checkId, '');
});

test('payment service: deleting a payment removes its check and the endorsement', async () => {
  const db = await makeDb();
  const p = await savePayment(db, { direction: 'in', method: 'check', date: '2026-01-05', partyId: 'c', amount: 100, check: { number: '1', bank: 'x', dueDate: '2026-02-01' } });
  const check = (await db.table('checks').list())[0];
  await endorseCheck(db, check, { partyId: 's', date: '2026-01-06' });
  await deletePaymentCascade(db, await db.table('payments').get(p.id));
  assert.equal((await db.table('payments').list()).length, 0);
  assert.equal((await db.table('checks').list()).length, 0);
});

test('crypto: hash/verify, persian digits equal latin, recovery code', async () => {
  const rec = await hashPassword('۱۲۳۴ab');
  assert.equal(await verifyPassword('1234ab', rec), true);
  assert.equal(await verifyPassword('1234AB', rec), false);
  assert.equal(await verifyPassword('', rec), false);
  assert.equal(await verifyPassword('x', null), false);
  const rec2 = await hashPassword('۱۲۳۴ab');
  assert.notEqual(rec.hash, rec2.hash); // نمک تصادفی
  const code = makeRecoveryCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeCode(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''));
});

test('numbers to words', () => {
  assert.equal(numberToWords(0), 'صفر');
  assert.equal(numberToWords(1000), 'هزار');
  assert.equal(numberToWords(1200000), 'یک میلیون و دویست هزار');
  assert.equal(numberToWords(25), 'بیست و پنج');
  assert.equal(numberToWords(2500000000), 'دو میلیارد و پانصد میلیون');
  assert.equal(formatMoney(1500000), '۱٬۵۰۰٬۰۰۰ ریال');
});

test('pdf builder: valid structure and xref offsets', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf([{ bytes: fakeJpeg, width: 10, height: 10 }, { bytes: fakeJpeg, width: 10, height: 10 }]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  const xrefPos = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xrefPos).startsWith('xref'));
  const entries = [...text.slice(xrefPos).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 8);
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1} offset`));
});

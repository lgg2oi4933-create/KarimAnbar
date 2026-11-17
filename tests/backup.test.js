import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../js/core/storage.js';
import { Db } from '../js/core/repo.js';
import { buildBackup, validateBackup, planMerge, applyMerge, replaceTables } from '../js/core/backup.js';

let clock = 0;
async function mk(tag, deviceId) {
  const adapter = new MemoryAdapter();
  await adapter.init(['parties', 'invoices', 'counters', 'activity_log']);
  const db = new Db(adapter, { getDeviceId: () => deviceId, getDeviceTag: () => tag, getUser: () => ({ id: 'u', name: 'x' }), now: () => new Date(Date.UTC(2026, 10, 1, 0, 0, ++clock)).toISOString() });
  return db;
}
const TABLES = ['parties', 'invoices', 'activity_log'];

test('backup: ساخت و اعتبارسنجی', async () => {
  const a = await mk('A', 'dA');
  await a.table('parties').create({ firstName: 'علی' }, { prefix: 'P' });
  const b = await buildBackup(a, { scope: 'full', moduleIds: [], tables: TABLES });
  assert.equal(b.counts.parties, 1);
  assert.ok(validateBackup(b, TABLES).ok);
  assert.ok(!validateBackup({ app: 'x' }, TABLES).ok);
});

test('backup: ادغام دو گوشی — جدیدتر برنده، حذف نرم، رکورد تازه اضافه', async () => {
  const a = await mk('A', 'dA');
  const b = await mk('B', 'dB');
  const p = await a.table('parties').create({ firstName: 'علی', note: 'اول' }, { prefix: 'P' });
  // گوشی B همان رکورد را دارد (کپی) و بعداً ویرایشش میکند
  await b.adapter.put('parties', { ...p });
  const edited = await b.table('parties').update(p.id, { note: 'ویرایش B' });
  const only = await b.table('parties').create({ firstName: 'رضا' }, { prefix: 'P' });
  const gone = await a.table('parties').create({ firstName: 'حذفی' }, { prefix: 'P' });
  await b.adapter.put('parties', { ...gone });
  await b.table('parties').remove(gone.id);
  const file = await buildBackup(b, { scope: 'full', moduleIds: [], tables: TABLES });
  const plan = await planMerge(a, file, TABLES);
  assert.equal(plan.totals.add >= 1, true);
  await applyMerge(a, plan);
  const list = await a.table('parties').list();
  assert.equal(list.find((x) => x.id === p.id).note, 'ویرایش B');
  assert.ok(list.find((x) => x.id === only.id));
  assert.equal(list.find((x) => x.id === gone.id), undefined);
  void edited;
  // دوباره ادغام = بدون تغییر
  const plan2 = await planMerge(a, file, TABLES);
  assert.equal(plan2.writes.length, 0);
});

test('backup: کد تکراری از گوشی دیگر تغییر نام میدهد و جایگزینی کامل کار میکند', async () => {
  const a = await mk('A', 'dA');
  const b = await mk('A', 'dB'); // حرف یکسان => کد یکسان
  await a.table('parties').create({ firstName: 'x' }, { prefix: 'P' });
  await b.table('parties').create({ firstName: 'y' }, { prefix: 'P' });
  const file = await buildBackup(b, { scope: 'full', moduleIds: [], tables: TABLES });
  const plan = await planMerge(a, file, TABLES);
  assert.equal(plan.totals.dupCode, 1);
  await applyMerge(a, plan);
  const codes = (await a.table('parties').list()).map((x) => x.code).sort();
  assert.deepEqual(codes, ['P-A0001', 'P-A0001-2']);
  await replaceTables(a, file, ['parties']);
  assert.equal((await a.table('parties').list()).length, 1);
});

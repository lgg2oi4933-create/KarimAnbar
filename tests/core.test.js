import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../js/core/storage.js';
import { Db } from '../js/core/repo.js';
import * as J from '../js/core/jalali.js';
import { formatNumber, parseNumber, toFaDigits, toEnDigits, matches } from '../js/core/util.js';

async function makeDb(tag = 'A') {
  const adapter = new MemoryAdapter();
  await adapter.init(['counters', 'activity_log', 'parties']);
  let t = 0;
  const db = new Db(adapter, {
    getDeviceId: () => 'dev-' + tag,
    getDeviceTag: () => tag,
    getUser: () => ({ id: 'u1', name: 'مدیر' }),
    now: () => new Date(Date.UTC(2026, 10, 15, 12, 0, t++)).toISOString(),
  });
  return { adapter, db };
}

test('jalali: known dates', () => {
  assert.deepEqual(J.toJalali(2026, 11, 15), { jy: 1405, jm: 8, jd: 24 });
  assert.deepEqual(J.toGregorian(1405, 1, 1), { gy: 2026, gm: 3, gd: 21 });
  assert.equal(J.isLeap(1403), true);
  assert.equal(J.isLeap(1404), false);
  assert.equal(J.parseJalali('۱۴۰۵/۰۸/۲۴'), '2026-11-15');
  assert.equal(J.parseJalali('1404/12/30'), null);
  assert.equal(J.formatJalali('2026-11-15'), '۱۴۰۵/۰۸/۲۴');
});

test('jalali: roundtrip over 60 years', () => {
  for (let d = new Date(1990, 0, 1); d < new Date(2050, 0, 1); d.setDate(d.getDate() + 7)) {
    const j = J.toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const g = J.toGregorian(j.jy, j.jm, j.jd);
    assert.deepEqual([g.gy, g.gm, g.gd], [d.getFullYear(), d.getMonth() + 1, d.getDate()]);
  }
});

test('numbers: format and parse', () => {
  assert.equal(formatNumber(1234567), '۱٬۲۳۴٬۵۶۷');
  assert.equal(formatNumber(12.5, { decimals: 2 }), '۱۲٫۵');
  assert.equal(parseNumber('۱٬۲۳۴٫۵'), 1234.5);
  assert.equal(parseNumber('abc'), null);
  assert.equal(toEnDigits('۱۲۳٤'), '1234');
  assert.equal(toFaDigits('45'), '۴۵');
  assert.equal(matches(['علی', 'کریمی'], 'كريمي'), true);
});

test('repo: create with auto code, update, soft delete, restore, log', async () => {
  const { db } = await makeDb();
  const t = db.table('parties');
  const a = await t.create({ name: 'کریمی' }, { prefix: 'P' });
  const b = await t.create({ name: 'احمدی' }, { prefix: 'P' });
  assert.equal(a.code, 'P-A0001');
  assert.equal(b.code, 'P-A0002');
  await t.update(a.id, { name: 'کریمی نیا' });
  assert.equal((await t.get(a.id)).name, 'کریمی نیا');
  await t.remove(a.id);
  assert.equal((await t.list()).length, 1);
  assert.equal((await t.list({ includeDeleted: true })).length, 2);
  await t.restore(a.id);
  assert.equal((await t.list()).length, 2);
  const log = await db.adapter.getAll('activity_log');
  assert.deepEqual(log.map((l) => l.action).sort(), ['create', 'create', 'delete', 'restore', 'update']);
  const upd = log.find((l) => l.action === 'update');
  assert.deepEqual(upd.changes.name, { from: 'کریمی', to: 'کریمی نیا' });
});

test('repo: codes never collide, even with a manually edited code', async () => {
  const { db } = await makeDb();
  const t = db.table('parties');
  await t.create({ name: 'x', code: 'P-A0001' });
  const n = await t.create({ name: 'y' }, { prefix: 'P' });
  assert.equal(n.code, 'P-A0002');
  assert.equal(await t.codeTaken('P-A0001', 'other'), true);
});

test('repo: device tag keeps codes of two phones apart', async () => {
  const a = await makeDb('A');
  const b = await makeDb('B');
  const ra = await a.db.table('parties').create({ name: 'x' }, { prefix: 'P' });
  const rb = await b.db.table('parties').create({ name: 'x' }, { prefix: 'P' });
  assert.notEqual(ra.code, rb.code);
});

test('repo: upsert with fixed id', async () => {
  const { db } = await makeDb();
  const t = db.table('parties');
  await t.upsert('company', { name: 'اول' });
  await t.upsert('company', { name: 'دوم' });
  const all = await t.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'دوم');
});

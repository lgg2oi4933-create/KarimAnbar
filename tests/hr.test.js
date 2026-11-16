import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, totalBalance, monthRange } from '../js/modules/hr/calc.js';

const emp = { id: 'e1', normalRate: 100000, overtimeRate: 150000, dailyHours: 8 };
const data = {
  attendance: [
    { employeeId: 'e1', date: '2026-11-01', status: 'present', normalHours: 8, overtimeHours: 2 },
    { employeeId: 'e1', date: '2026-11-02', status: 'present', normalHours: 7.5, overtimeHours: 0 },
    { employeeId: 'e1', date: '2026-11-03', status: 'absent' },
    { employeeId: 'e1', date: '2026-12-30', status: 'present', normalHours: 8, overtimeHours: 0 },
  ],
  leaves: [
    { employeeId: 'e1', type: 'daily', startDate: '2026-11-04', endDate: '2026-11-05', paid: true },
    { employeeId: 'e1', type: 'hourly', startDate: '2026-11-06', hours: 2, paid: false },
  ],
  payments: [{ employeeId: 'e1', amount: 500000, date: '2026-11-10', periodFrom: '2026-11-01', periodTo: '2026-11-15' }],
};

test('hr: حقوق از ساعت عادی، اضافه‌کاری و مرخصی با حقوق', () => {
  const s = summarize(emp, data, '2026-11-01', '2026-11-30');
  assert.equal(s.presentDays, 2);
  assert.equal(s.absentDays, 1);
  assert.equal(s.normalHours, 15.5);
  assert.equal(s.overtimeHours, 2);
  assert.equal(s.leaveDays, 2);
  assert.equal(s.leaveHours, 2);
  // 15.5*100000 + 2*150000 + 16*100000 (دو روز مرخصی با حقوق)
  assert.equal(s.earned, 1550000 + 300000 + 1600000);
  assert.equal(s.paid, 500000);
  assert.equal(s.remaining, s.earned - 500000);
});

test('hr: مرخصی روزانه فقط سهم داخل بازه محاسبه میشود', () => {
  const s = summarize(emp, data, '2026-11-05', '2026-11-30');
  assert.equal(s.leaveDays, 1);
});

test('hr: مانده‌ی کل و بازه‌ی ماه شمسی', () => {
  const t = totalBalance(emp, data);
  assert.equal(t.paid, 500000);
  assert.equal(t.earned, 1550000 + 300000 + 1600000 + 800000);
  const m = monthRange('2026-11-16');
  assert.equal(m.from, '2026-10-23');
  assert.equal(m.to, '2026-11-21');
});

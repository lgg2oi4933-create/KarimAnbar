// محاسبات خالص نیروی انسانی (بدون رابط و بدون ارتباط با حساب‌های مالی برنامه)
import { addDaysIso, diffDaysIso, isoToJalaliParts, jalaliPartsToIso, daysInMonth } from '../../core/jalali.js';

export const ALL_FROM = '0000-01-01';
export const ALL_TO = '9999-12-31';

export function empName(e) {
  if (!e) return '';
  return [e.firstName, e.lastName].filter(Boolean).join(' ') || e.code || '';
}

// بازه‌ی ماه شمسی تاریخ iso (با جابه‌جایی offset ماه)
export function monthRange(iso, offset = 0) {
  const p = isoToJalaliParts(iso);
  let idx = p.jy * 12 + (p.jm - 1) + offset;
  const jy = Math.floor(idx / 12);
  const jm = (idx % 12) + 1;
  return { from: jalaliPartsToIso(jy, jm, 1), to: jalaliPartsToIso(jy, jm, daysInMonth(jy, jm)) };
}

const overlaps = (aFrom, aTo, bFrom, bTo) => aFrom <= bTo && bFrom <= aTo;
const r2 = (n) => Math.round(n * 100) / 100;

// خلاصه‌ی وضعیت یک نیرو در بازه‌ی [from, to]
export function summarize(emp, { attendance = [], leaves = [], payments = [] }, from, to) {
  const dailyHours = Number(emp.dailyHours) || 8;
  const normalRate = Number(emp.normalRate) || 0;
  const overtimeRate = Number(emp.overtimeRate) || 0;
  let presentDays = 0;
  let absentDays = 0;
  let normalHours = 0;
  let overtimeHours = 0;
  for (const a of attendance) {
    if (a.employeeId !== emp.id || a.deletedAt || a.date < from || a.date > to) continue;
    if (a.status === 'absent') absentDays += 1;
    else {
      presentDays += 1;
      normalHours += Number(a.normalHours) || 0;
      overtimeHours += Number(a.overtimeHours) || 0;
    }
  }
  let leaveDays = 0;
  let leaveHours = 0;
  let paidLeaveHours = 0;
  for (const l of leaves) {
    if (l.employeeId !== emp.id || l.deletedAt) continue;
    if (l.type === 'hourly') {
      if (l.startDate < from || l.startDate > to) continue;
      const h = Number(l.hours) || 0;
      leaveHours += h;
      if (l.paid) paidLeaveHours += h;
    } else {
      const s = l.startDate;
      const e = l.endDate || l.startDate;
      const cs = s > from ? s : from;
      const ce = e < to ? e : to;
      if (cs > ce) continue;
      const d = diffDaysIso(cs, ce) + 1;
      leaveDays += d;
      if (l.paid) paidLeaveHours += d * dailyHours;
    }
  }
  const normalPay = normalHours * normalRate;
  const overtimePay = overtimeHours * overtimeRate;
  const leavePay = paidLeaveHours * normalRate;
  const earned = Math.round(normalPay + overtimePay + leavePay);
  let paid = 0;
  for (const p of payments) {
    if (p.employeeId !== emp.id || p.deletedAt) continue;
    const pf = p.periodFrom || p.date;
    const pt = p.periodTo || p.date;
    if (overlaps(pf, pt, from, to)) paid += Number(p.amount) || 0;
  }
  return {
    presentDays, absentDays, normalHours: r2(normalHours), overtimeHours: r2(overtimeHours),
    leaveDays, leaveHours: r2(leaveHours), paidLeaveHours: r2(paidLeaveHours),
    normalPay: Math.round(normalPay), overtimePay: Math.round(overtimePay), leavePay: Math.round(leavePay),
    earned, paid, remaining: earned - paid,
  };
}

// کل مانده‌ی یک نیرو از ابتدا (کل دریافتنی منهای کل پرداختی)
export function totalBalance(emp, data) {
  const s = summarize(emp, { ...data, payments: [] }, ALL_FROM, ALL_TO);
  let paid = 0;
  for (const p of data.payments || []) if (p.employeeId === emp.id && !p.deletedAt) paid += Number(p.amount) || 0;
  return { earned: s.earned, paid, remaining: s.earned - paid };
}

export { addDaysIso };

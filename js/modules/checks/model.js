// مدل چک: وضعیت، سررسید
import { diffDaysIso, formatJalali } from '../../core/jalali.js';
import { toFaDigits } from '../../core/util.js';

export const CHECK_DIRS = [
  { value: 'received', label: 'دریافتی' },
  { value: 'issued', label: 'پرداختی' },
];
export const dirLabel = (v) => (CHECK_DIRS.find((d) => d.value === v) || { label: v }).label;

export const STATUS_OPTIONS = [
  { value: 'pending', label: 'در جریان' },
  { value: 'cleared', label: 'وصول / پاس شده' },
  { value: 'bounced', label: 'برگشتی' },
];

export function checkStatus(c) {
  if (c.status === 'bounced') return { key: 'bounced', label: 'برگشتی', tone: 'danger' };
  if (c.status === 'cleared') return { key: 'cleared', label: c.direction === 'issued' ? 'پاس شده' : 'وصول شده', tone: 'ok' };
  if (c.endorsementPaymentId) return { key: 'endorsed', label: 'خرج شده', tone: '' };
  return { key: 'pending', label: 'در جریان', tone: 'warn' };
}

// وضعیت سررسید نسبت به امروز
export function dueInfo(c, today) {
  if (!c.dueDate) return { text: '', tone: '' };
  const d = diffDaysIso(today, c.dueDate);
  if (d < 0) return { text: `${toFaDigits(-d)} روز گذشته`, tone: 'danger', days: d };
  if (d === 0) return { text: 'امروز', tone: 'warn', days: d };
  if (d <= 7) return { text: `${toFaDigits(d)} روز دیگر`, tone: 'warn', days: d };
  return { text: formatJalali(c.dueDate), tone: '', days: d };
}

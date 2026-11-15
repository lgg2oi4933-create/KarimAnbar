// مدل اشخاص — بقیه‌ی ماژول‌ها (فاکتور، چک و...) فقط از همین فایل استفاده میکنن
import { toEnDigits } from '../../core/util.js';

export const ROLES = [
  { value: 'customer', label: 'مشتری' },
  { value: 'supplier', label: 'تأمین‌کننده' },
  { value: 'subcontractor', label: 'برون‌سپار' },
];

export function roleLabel(v) {
  return (ROLES.find((r) => r.value === v) || { label: v }).label;
}

export function partyName(p) {
  if (!p) return '';
  const person = [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (p.company && person) return `${p.company} (${person})`;
  return p.company || person || p.code || '';
}

export function normalizeMobile(s) {
  let t = toEnDigits(String(s || '')).replace(/[\s\-()]/g, '');
  if (t.startsWith('+98')) t = '0' + t.slice(3);
  else if (t.startsWith('0098')) t = '0' + t.slice(4);
  else if (/^9\d{9}$/.test(t)) t = '0' + t;
  return t;
}

export function isValidMobile(s) {
  return /^09\d{9}$/.test(normalizeMobile(s));
}

export function isValidNationalId(s) {
  const t = toEnDigits(String(s || '')).trim();
  if (!/^\d{10}$/.test(t) || /^(\d)\1{9}$/.test(t)) return false;
  const d = t.split('').map(Number);
  const sum = d.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0);
  const r = sum % 11;
  return d[9] === (r < 2 ? r : 11 - r);
}

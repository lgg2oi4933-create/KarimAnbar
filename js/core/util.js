// ابزارهای عمومی: شناسه، ارقام فارسی، فرمت عدد

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.random() * 256) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export function toFaDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => FA[d]);
}

export function toEnDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/٬|،/g, ',')
    .replace(/٫/g, '.');
}

// عدد با جداکننده هزارگان و ارقام فارسی
export function formatNumber(n, { decimals = 0, fa = true } = {}) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  const fixed = num.toFixed(decimals);
  let [i, d] = fixed.split('.');
  const neg = i.startsWith('-');
  if (neg) i = i.slice(1);
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (d !== undefined) d = d.replace(/0+$/, '');
  let out = (neg ? '-' : '') + i + (d ? '.' + d : '');
  return fa ? toFaDigits(out).replace(/,/g, '٬').replace(/\./g, '٫') : out;
}

// تبدیل ورودی کاربر (فارسی یا لاتین) به عدد؛ نامعتبر = null
export function parseNumber(s) {
  if (s === null || s === undefined) return null;
  const t = toEnDigits(String(s)).replace(/,/g, '').replace(/\s/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// برای جستجو: ی و ک عربی، ارقام و فاصله‌ها یکسان میشن
export function normalizeText(s) {
  return toEnDigits(String(s ?? ''))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function matches(haystackParts, query) {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = normalizeText(haystackParts.filter(Boolean).join(' '));
  return q.split(' ').every((w) => hay.includes(w));
}

// رمزنگاری رمز عبور (PBKDF2 + نمک تصادفی). رمز خام هیچ‌جا ذخیره نمیشود.
// نکته: این قفل در سطح برنامه است و جلوی افراد عادی را میگیرد، نه یک متخصص با دسترسی کامل به مرورگر.
import { toEnDigits } from './util.js';

const enc = new TextEncoder();
export const ITERATIONS = 100000;
export const MIN_PASSWORD = 4;

function toB64(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ارقام فارسی و لاتین یکی حساب میشن تا «۱۲۳۴» و «1234» فرقی نکنه
export function normalizePassword(p) {
  return toEnDigits(String(p ?? ''));
}

async function derive(password, salt, iter) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('مرورگر از رمزنگاری پشتیبانی نمیکند (آدرس برنامه باید https باشد)');
  const key = await subtle.importKey('raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return { salt: toB64(salt), hash: toB64(hash), iter: ITERATIONS };
}

export async function verifyPassword(password, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  const got = toB64(await derive(password, fromB64(rec.salt), rec.iter || ITERATIONS));
  if (got.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

export function validatePasswordText(p) {
  if (!p || p.length < MIN_PASSWORD) return 'رمز باید حداقل ۴ نویسه باشد';
  return '';
}

// کد بازیابی: ۱۲ نویسه‌ی خوانا (بدون 0/O/1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRecoveryCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

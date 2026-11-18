// صفحه‌ی آزمایشی صدا: ضبط صدا، ارسال به Gemini، نمایش متن و فیلدهای استخراج‌شده.
// کلید API فقط در localStorage همین گوشی ذخیره میشود (نه در پایگاه داده، پس در بک‌آپ و ادغام نمی‌آید).
import { h } from '../../ui/dom.js';
import { section, toast, kv } from '../../ui/components.js';
import { registerModule } from '../../core/registry.js';

const KEY = 'tray.geminiKey';
const MODEL_KEY = 'tray.geminiModel';
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const API = 'https://generativelanguage.googleapis.com/v1beta';

const PROMPT = `این یک پیام صوتی فارسی از یک کارخانه‌ی تولید سینی مقوایی است (فاکتور فروش/خرید، دریافت/پرداخت یا ورود/خروج انبار).
اول عین حرف‌ها را به فارسی بنویس، بعد فقط یک JSON با این کلیدها بده (هرچه گفته نشده null):
{"transcript": "", "kind": "sale|purchase|payment_in|payment_out|stock_in|stock_out|unknown", "party": "", "items": [{"product": "", "length_cm": null, "width_cm": null, "qty": null, "unit": "kg|count", "price": null, "unit_cost": null}], "amount": null, "note": ""}
اعداد را به شکل عدد لاتین بده. قیمت‌ها به ریال؛ اگر «تومان» گفته شد ده برابر کن و در note بنویس.`;

const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

async function listModels(key) {
  const r = await fetch(`${API}/models?pageSize=100`, { headers: { 'x-goog-api-key': key } });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
}

async function transcribe(key, model, blob) {
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: (blob.type || 'audio/webm').split(';')[0], data: await b64(blob) } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const t0 = performance.now();
  const r = await fetch(`${API}/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text).join('') || '';
  return { text, ms: Math.round(performance.now() - t0) };
}

function voicePage(ctx) {
  ctx.setTitle('آزمایش صدا');
  ctx.setBack('/more');
  const keyIn = h('input', { type: 'password', dir: 'ltr', placeholder: 'AQ... یا AIza...', value: store.get(KEY), 'aria-label': 'کلید API' });
  const modelIn = h('input', { type: 'text', dir: 'ltr', value: store.get(MODEL_KEY, 'gemini-2.5-flash'), 'aria-label': 'نام مدل' });
  const modelsEl = h('p', { class: 'muted' });
  const status = h('p', { class: 'muted' }, 'آماده');
  const out = h('div');
  let rec = null;
  let chunks = [];
  let stream = null;
  const online = () => navigator.onLine;

  const save = () => { store.set(KEY, keyIn.value.trim()); store.set(MODEL_KEY, modelIn.value.trim()); };
  const testKey = async () => {
    save();
    if (!keyIn.value.trim()) return toast('کلید را وارد کنید', 'err');
    status.textContent = 'در حال بررسی کلید...';
    try {
      const m = await listModels(keyIn.value.trim());
      const flash = m.filter((x) => /flash/.test(x));
      modelsEl.textContent = `کلید معتبر است. مدل‌های فلش: ${flash.slice(0, 8).join('، ')}`;
      status.textContent = 'کلید معتبر';
    } catch (e) {
      status.textContent = 'خطا: ' + e.message;
    }
  };

  const recBtn = h('button', { class: 'btn primary', type: 'button' }, '🎙 شروع ضبط');
  const send = async (blob) => {
    status.textContent = `ارسال ${Math.round(blob.size / 1024)} کیلوبایت...`;
    try {
      const { text, ms } = await transcribe(keyIn.value.trim(), modelIn.value.trim(), blob);
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { /* show raw */ }
      status.textContent = `پاسخ در ${Math.round(ms / 100) / 10} ثانیه`;
      out.replaceChildren(
        section('متن شنیده‌شده', h('p', null, parsed ? parsed.transcript || '' : text)),
        parsed
          ? section('فیلدهای استخراج‌شده', kv('نوع', parsed.kind), kv('طرف حساب', parsed.party), kv('مبلغ', parsed.amount), kv('توضیح', parsed.note), ...(parsed.items || []).map((it, i) => kv(`قلم ${i + 1}`, `${it.product || ''} ${it.length_cm ? `${it.length_cm}×${it.width_cm}` : ''} · ${it.qty ?? '؟'} ${it.unit || ''} · فی ${it.price ?? '؟'}`)))
          : null,
        section('پاسخ خام', h('pre', { dir: 'ltr', style: { whiteSpace: 'pre-wrap', fontSize: '12px' } }, text))
      );
    } catch (e) {
      status.textContent = 'خطا: ' + e.message;
    }
  };
  recBtn.onclick = async () => {
    if (rec) return rec.stop();
    save();
    if (!keyIn.value.trim()) return toast('اول کلید را وارد کنید', 'err');
    if (!online()) return toast('اینترنت وصل نیست', 'err');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return toast('دسترسی میکروفون داده نشد', 'err');
    }
    chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      rec = null;
      recBtn.textContent = '🎙 شروع ضبط';
      send(blob);
    };
    rec.start();
    recBtn.textContent = '⏹ پایان ضبط و ارسال';
    status.textContent = 'در حال ضبط... جمله را بگویید';
  };

  ctx.el.append(
    section(
      'تنظیم',
      h('p', { class: 'muted' }, 'کلید فقط روی همین گوشی ذخیره میشود و در بک‌آپ نمی‌آید. برای تست جمله‌ای مثل «صد کیلو سینی بیست در سی، فی دویست و پنجاه هزار، فروش به آقای کریمی» بگویید.'),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'کلید API'), keyIn),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'مدل'), modelIn),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', type: 'button', onclick: testKey }, 'بررسی کلید و فهرست مدل‌ها'), h('button', { class: 'btn ghost', type: 'button', onclick: () => (store.set(KEY, ''), (keyIn.value = ''), toast('کلید پاک شد')) }, 'پاک کردن کلید')),
      modelsEl
    ),
    section('ضبط', recBtn, status),
    out
  );
}

export function registerVoice() {
  registerModule({
    id: 'voice',
    title: 'صدا',
    tables: [],
    more: { order: 90, label: 'آزمایش صدا', desc: 'ضبط جمله و دیدن متن و فیلدهای استخراج‌شده', icon: 'activity', path: '/voice', adminOnly: true },
    routes: [{ path: '/voice', render: voicePage }],
  });
}

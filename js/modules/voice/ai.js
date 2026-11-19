// ضبط صدا و تماس با Gemini. کلید فقط در localStorage همین گوشی است (نه در بک‌آپ، نه در کد).
export const KEY = 'tray.geminiKey';
export const MODEL_KEY = 'tray.geminiModel';
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const API = 'https://generativelanguage.googleapis.com/v1beta';

export const store = {
  get(k, d = '') { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
export const hasKey = () => !!store.get(KEY);

export function buildPrompt({ parties = [], products = [] } = {}) {
  return `این یک پیام صوتی فارسی از یک کارخانه‌ی تولید سینی مقوایی است. کاربر یکی از این کارها را میگوید: فاکتور فروش، فاکتور خرید، دریافت یا پرداخت پول، ورود یا خروج انبار.
اول عین حرف‌ها را به فارسی بنویس، بعد فقط یک JSON با این کلیدها بده (هرچه گفته نشده null):
{"transcript": "", "kind": "sale|purchase|payment_in|payment_out|stock_in|stock_out|unknown", "party": "", "items": [{"product": "", "length_cm": null, "width_cm": null, "qty": null, "unit": "kg|count", "price": null, "unit_cost": null, "direction": "in|out|null", "reason": "consume|produced|cutwaste|damage|opening|count|other|null"}], "amount": null, "method": "cash|check|null", "run_tag": null, "note": ""}
قواعد:
- قیمتی که برای هر قلم گفته میشود (مثلاً «به قیمت ۳۰۰۰ تومان») همیشه در price (فی فاکتور، هر واحد) بیاید؛ unit_cost فقط وقتی پر شود که صریحاً «قیمت تمام‌شده» یا «بهای تمام‌شده» گفته شده. قیمت صفر را 0 بده نه null.
- همه‌ی پول‌ها به ریال؛ اگر «تومان» گفته شد ده برابر کن. اعداد لاتین.
- برای ورود/خروج انبار هر قلم direction دارد؛ «مصرف در تولید»=consume، «تولید شده»=produced، «ضایعات برش»=cutwaste، «شماره تولید ...»=run_tag.
- party و product را تا حد ممکن عیناً از فهرست‌های زیر انتخاب کن؛ اگر در فهرست نبود همان‌طور که گفته شد بنویس.
اشخاص: ${parties.slice(0, 200).join(' | ')}
کالاها: ${products.slice(0, 200).join(' | ')}`;
}

const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

export async function listModels(key) {
  const r = await fetch(`${API}/models?pageSize=100`, { headers: { 'x-goog-api-key': key } });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
}

export function friendlyError(e) {
  const m = String((e && e.message) || e);
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'به گوگل وصل نشد. اینترنت و VPN را بررسی کنید.';
  if (/quota|429|exhausted/i.test(m)) return 'سقف استفاده‌ی رایگان پر شده؛ چند دقیقه بعد دوباره امتحان کنید.';
  if (/api key|permission|403|400/i.test(m)) return 'کلید یا مدل پذیرفته نشد: ' + m;
  return m;
}

export async function transcribe(blob, ctxLists) {
  const key = store.get(KEY);
  const model = store.get(MODEL_KEY, DEFAULT_MODEL);
  const body = {
    contents: [{ parts: [{ text: buildPrompt(ctxLists) }, { inline_data: { mime_type: (blob.type || 'audio/webm').split(';')[0], data: await b64(blob) } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const t0 = performance.now();
  const r = await fetch(`${API}/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text).join('');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* خام */ }
  return { text, parsed, ms: Math.round(performance.now() - t0) };
}

// ضبط با MediaRecorder؛ stop() یک Promise<Blob> میدهد
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise((res) => {
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
      rec.stop();
    }),
    cancel: () => { try { rec.onstop = null; rec.stop(); } catch (e) { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); },
  };
}

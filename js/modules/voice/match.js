// تطبیق نام گفته‌شده با نام‌های موجود (خالص و قابل تست)
import { normalizeText } from '../../core/util.js';

const FILLER = new Set(['آقای', 'آقا', 'خانم', 'جناب', 'سرکار', 'دکتر', 'مهندس', 'حاج', 'حاجی', 'شرکت', 'کارخانه']);
const tokens = (s) => normalizeText(s).replace(/[()×x*\-_/.,،:]/g, ' ').split(' ').filter((w) => w && !FILLER.has(w));

// امتیاز: سهم کلمه‌های جمله‌ی گفته‌شده که در متن گزینه هست (کلمه‌ی کامل یا پیشوند/شامل)
export function score(query, text) {
  const q = tokens(query);
  const t = tokens(text);
  if (!q.length || !t.length) return 0;
  let hit = 0;
  for (const w of q) {
    if (t.includes(w)) hit += 1;
    else if (w.length >= 3 && t.some((x) => x.length >= 3 && (x.includes(w) || w.includes(x)))) hit += 0.6;
  }
  const recall = hit / q.length;
  const precision = hit / t.length;
  return recall * 0.8 + precision * 0.2;
}

// cands: [{id, text}] ← بهترین گزینه یا null
export function bestMatch(query, cands, min = 0.6) {
  let best = null;
  for (const c of cands) {
    const s = score(query, c.text);
    if (s > (best ? best.score : 0)) best = { id: c.id, text: c.text, score: s };
  }
  return best && best.score >= min ? best : null;
}

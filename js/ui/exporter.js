// خروجی سند (فاکتور، صورت‌حساب) به تصویر PNG و PDF.
// سند روی بوم رسم میشود (راست‌به‌چپ)، پس نیازی به کتابخانه یا اینترنت نیست.
import { buildPdf } from './pdf.js';

export const PAGE_W = 1240; // A4 با ۱۵۰ نقطه در اینچ
export const PAGE_H = 1754;
const M = 64;
const FONT = "'Vazirmatn','Noto Naskh Arabic','Noto Sans Arabic',Tahoma,'DejaVu Sans',sans-serif";
const C = { ink: '#1b2333', muted: '#667089', line: '#d5dbe7', head: '#1f6f8b', headInk: '#ffffff', stripe: '#f4f7fb', soft: '#e8f1f5' };

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(test).width > maxW) {
        out.push(cur);
        cur = w;
      } else cur = test;
    }
    out.push(cur);
  }
  return out.length ? out : [''];
}

/**
 * doc = {
 *   title, company: {name, logo, phone, address, economicCode, nationalId},
 *   meta: [[label, value], ...],                 // دو ستون
 *   columns: [{label, w, align}],                // w: سهم عرض (جمعشان ۱)، ستون اول سمت راست
 *   rows: [[cell, ...] | {cells: [...], bold, fill}],
 *   totals: [[label, value, {bold}], ...],       // کادر سمت چپ
 *   footer: 'متن'
 * }
 * خروجی: آرایه‌ای از بوم‌های A4
 */
export async function renderDoc(doc) {
  const logo = await loadImage(doc.company && doc.company.logo);
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (e) {
      /* ignore */
    }
  }
  const pages = [];
  let cv;
  let ctx;
  let y;
  const R = PAGE_W - M; // لبه‌ی راست محتوا
  const L = M; // لبه‌ی چپ
  const CW = PAGE_W - 2 * M;

  const font = (size, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`);
  const newPage = () => {
    cv = document.createElement('canvas');
    cv.width = PAGE_W;
    cv.height = PAGE_H;
    ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.direction = 'rtl';
    ctx.textBaseline = 'alphabetic';
    pages.push(cv);
    y = M;
  };
  const text = (str, x, baseline, { size = 26, weight = 400, color = C.ink, align = 'right' } = {}) => {
    font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(String(str ?? ''), x, baseline);
  };
  const ensure = (h) => {
    if (y + h > PAGE_H - M - 40) newPage();
  };

  newPage();

  // ---- سربرگ
  const co = doc.company || {};
  let headX = R;
  if (logo) {
    const box = 120;
    const k = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * k;
    const h = logo.height * k;
    ctx.drawImage(logo, R - w, y, w, h);
    headX = R - w - 24;
  }
  let hy = y + 38;
  text(co.name || '', headX, hy, { size: 38, weight: 700 });
  const sub = [co.phone && `تلفن: ${co.phone}`, co.economicCode && `کد اقتصادی: ${co.economicCode}`, co.nationalId && `شناسه ملی: ${co.nationalId}`].filter(Boolean).join('   ');
  font(23);
  if (sub) {
    hy += 38;
    text(sub, headX, hy, { size: 23, color: C.muted });
  }
  if (co.address) {
    for (const ln of wrap(ctx, co.address, R - L - 400).slice(0, 2)) {
      hy += 32;
      text(ln, headX, hy, { size: 22, color: C.muted });
    }
  }
  // عنوان سند سمت چپ
  text(doc.title || '', L, y + 46, { size: 44, weight: 700, color: C.head, align: 'left' });
  y = Math.max(y + (logo ? 130 : 0), hy) + 26;
  ctx.fillStyle = C.head;
  ctx.fillRect(L, y, CW, 4);
  y += 30;

  // ---- مشخصات (دو ستون)
  const meta = doc.meta || [];
  const colW = CW / 2 - 16;
  font(25);
  for (let i = 0; i < meta.length; i += 2) {
    const pair = [meta[i], meta[i + 1]];
    const heights = pair.map((m) => (m ? wrap(ctx, m[1], colW - 150).length : 0));
    const rowH = Math.max(1, ...heights) * 36 + 8;
    ensure(rowH);
    pair.forEach((m, j) => {
      if (!m) return;
      const x = j === 0 ? R : R - colW - 32;
      text(`${m[0]}:`, x, y + 28, { size: 24, color: C.muted });
      font(25);
      wrap(ctx, m[1], colW - 150).forEach((ln, k) => text(ln, x - 140, y + 28 + k * 36, { size: 25, weight: 600 }));
    });
    y += rowH;
  }
  y += 14;

  // ---- جدول
  const cols = doc.columns || [];
  const xs = []; // لبه‌ی راست هر ستون
  let acc = R;
  const widths = cols.map((c) => c.w * CW);
  widths.forEach((w) => {
    xs.push(acc);
    acc -= w;
  });
  const drawHeader = () => {
    ensure(70);
    ctx.fillStyle = C.head;
    ctx.fillRect(L, y, CW, 56);
    cols.forEach((c, i) => cell(c.label, i, y + 37, { color: C.headInk, weight: 700, size: 24 }, c.align));
    y += 56;
  };
  function cell(str, i, baseline, style, align) {
    const pad = 14;
    const right = xs[i];
    const left = right - widths[i];
    if (align === 'center') text(str, (right + left) / 2, baseline, { ...style, align: 'center' });
    else if (align === 'left') text(str, left + pad, baseline, { ...style, align: 'left' });
    else text(str, right - pad, baseline, { ...style, align: 'right' });
  }
  if (cols.length) {
    drawHeader();
    (doc.rows || []).forEach((r, idx) => {
      const cells = Array.isArray(r) ? r : r.cells;
      const style = Array.isArray(r) ? {} : r;
      font(25, style.bold ? 700 : 400);
      const lines = cells.map((c, i) => wrap(ctx, c, widths[i] - 28));
      const h = Math.max(...lines.map((l) => l.length)) * 36 + 20;
      if (y + h > PAGE_H - M - 40) {
        newPage();
        drawHeader();
      }
      ctx.fillStyle = style.fill || (idx % 2 ? C.stripe : '#fff');
      ctx.fillRect(L, y, CW, h);
      ctx.fillStyle = C.line;
      ctx.fillRect(L, y + h - 1, CW, 1);
      lines.forEach((ls, i) => ls.forEach((ln, k) => cell(ln, i, y + 34 + k * 36, { size: 25, weight: style.bold ? 700 : 400, color: style.color || C.ink }, cols[i].align)));
      y += h;
    });
    ctx.fillStyle = C.line;
    ctx.fillRect(L, y, CW, 2);
    y += 24;
  }

  // ---- جمع‌ها
  const totals = doc.totals || [];
  if (totals.length) {
    const boxW = 560;
    ensure(totals.length * 52 + 20);
    totals.forEach((t, i) => {
      const bold = t[2] && t[2].bold;
      const h = bold ? 62 : 50;
      ctx.fillStyle = bold ? C.soft : i % 2 ? C.stripe : '#fff';
      ctx.fillRect(L, y, boxW, h);
      text(t[0], L + boxW - 16, y + h / 2 + 9, { size: bold ? 28 : 25, weight: bold ? 700 : 400, color: bold ? C.head : C.muted });
      text(t[1], L + 16, y + h / 2 + 9, { size: bold ? 30 : 26, weight: bold ? 700 : 600, align: 'left' });
      y += h;
    });
    ctx.fillStyle = C.line;
    ctx.fillRect(L, y, boxW, 2);
    y += 26;
  }

  // ---- توضیحات پایین
  if (doc.footer) {
    font(24);
    const lines = wrap(ctx, doc.footer, CW);
    ensure(lines.length * 34 + 20);
    lines.forEach((ln, k) => text(ln, R, y + 28 + k * 34, { size: 24, color: C.muted }));
    y += lines.length * 34 + 16;
  }

  // ---- شماره‌ی صفحه
  pages.forEach((p, i) => {
    const c = p.getContext('2d');
    c.direction = 'rtl';
    c.font = `400 21px ${FONT}`;
    c.fillStyle = '#98a2b8';
    c.textAlign = 'center';
    if (pages.length > 1) c.fillText(`صفحه ${toFa(i + 1)} از ${toFa(pages.length)}`, PAGE_W / 2, PAGE_H - 36);
  });
  return pages;
}

const toFa = (n) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

export async function pagesToPng(pages) {
  if (pages.length === 1) return toBlob(pages[0], 'image/png');
  const tall = document.createElement('canvas');
  tall.width = PAGE_W;
  tall.height = PAGE_H * pages.length;
  const c = tall.getContext('2d');
  pages.forEach((p, i) => c.drawImage(p, 0, i * PAGE_H));
  return toBlob(tall, 'image/png');
}

export async function pagesToPdf(pages) {
  const images = [];
  for (const p of pages) {
    const blob = await toBlob(p, 'image/jpeg', 0.92);
    images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: p.width, height: p.height });
  }
  return new Blob([buildPdf(images)], { type: 'application/pdf' });
}

export function safeFileName(s) {
  return String(s || 'سند').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

// در اندروید پنجره‌ی اشتراک‌گذاری (تلگرام، واتساپ، ذخیره...) باز میشود؛ در غیر این صورت دانلود میشود
export async function shareOrDownload(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export async function exportDoc(doc, kind, fileBase) {
  const pages = await renderDoc(doc);
  const base = safeFileName(fileBase || doc.title);
  if (kind === 'pdf') return shareOrDownload(await pagesToPdf(pages), `${base}.pdf`, doc.title);
  return shareOrDownload(await pagesToPng(pages), `${base}.png`, doc.title);
}

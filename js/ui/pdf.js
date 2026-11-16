// سازنده‌ی PDF ساده: هر صفحه یک تصویر JPEG تمام‌صفحه (بدون وابستگی). متن فارسی چون
// قبلاً روی بوم رسم شده، در همه‌ی PDFخوان‌ها درست دیده میشود.

const enc = (s) => {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
  return a;
};
const pad10 = (n) => String(n).padStart(10, '0');

// images: [{bytes: Uint8Array (JPEG), width, height}]
export function buildPdf(images, { pageW = 595.28, pageH = 841.89 } = {}) {
  if (!images.length) throw new Error('هیچ صفحه‌ای برای PDF نیست');
  const chunks = [];
  const offsets = [];
  let offset = 0;
  const push = (d) => {
    const b = typeof d === 'string' ? enc(d) : d;
    chunks.push(b);
    offset += b.length;
  };
  const n = images.length;
  const total = 2 + n * 3; // کاتالوگ + فهرست صفحات + (صفحه، محتوا، تصویر) برای هر صفحه

  push('%PDF-1.4\n%âãÏÓ\n');
  const begin = (id) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
  };

  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  begin(2);
  push(`<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);

  images.forEach((img, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    begin(pageId);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
    begin(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    begin(imageId);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    push(img.bytes);
    push('\nendstream\nendobj\n');
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) xref += `${pad10(offsets[id])} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

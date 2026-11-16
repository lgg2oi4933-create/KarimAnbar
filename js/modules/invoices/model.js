// مدل و ساخت سند خروجی فاکتور
import { formatNumber, formatMoney, toFaDigits } from '../../core/util.js';
import { formatJalali, weekdayName } from '../../core/jalali.js';
import { invoiceTotals, lineAmount } from '../../core/finance.js';
import { partyName } from '../parties/model.js';
import { unitLabel } from '../products/model.js';

export const TYPES = [
  { value: 'sale', label: 'فروش' },
  { value: 'purchase', label: 'خرید' },
];
export const typeLabel = (v) => (TYPES.find((t) => t.value === v) || { label: v }).label;
export const partyRoleFor = (type) => (type === 'sale' ? ['customer'] : ['supplier']);
export const kindsFor = (type) => (type === 'sale' ? ['tray', 'other'] : ['sheet', 'glue', 'tape', 'other']);

// آخرین قیمتی که برای این کالا در همین نوع فاکتور زده شده
export async function lastPrice(db, type, productId) {
  const list = (await db.table('invoices').list()).filter((i) => i.type === type).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  for (const inv of list) {
    const l = (inv.lines || []).find((x) => x.productId === productId && x.price != null);
    if (l) return l.price;
  }
  return null;
}

export function qtyText(l) {
  return `${formatNumber(l.qty, { decimals: 3 })} ${unitLabel(l.unit || 'kg')}`;
}

export function invoiceDoc(inv, party, company, { paid = null } = {}) {
  const sale = inv.type === 'sale';
  const t = invoiceTotals(inv);
  const meta = [
    ['شماره', toFaDigits(inv.code || '')],
    ['تاریخ', `${weekdayName(inv.date)} ${formatJalali(inv.date)}`],
    [sale ? 'خریدار' : 'فروشنده', partyName(party)],
  ];
  if (party && party.mobile) meta.push(['موبایل', toFaDigits(party.mobile)]);
  if (party && party.nationalId) meta.push(['کد ملی', toFaDigits(party.nationalId)]);
  if (!sale && inv.refNumber) meta.push(['شماره فاکتور فروشنده', toFaDigits(inv.refNumber)]);
  if (party && party.address) meta.push(['آدرس', party.address]);

  const totals = [['جمع اقلام', formatNumber(t.subtotal)]];
  if (t.discount) totals.push(['تخفیف', formatNumber(t.discount)]);
  if (inv.taxPercent) totals.push([`مالیات (${toFaDigits(inv.taxPercent)}٪)`, formatNumber(t.tax)]);
  totals.push(['مبلغ نهایی (ریال)', formatNumber(t.total), { bold: true }]);
  if (paid !== null && paid > 0) {
    totals.push(['پرداخت‌شده', formatNumber(paid)]);
    totals.push(['باقی‌مانده', formatNumber(Math.max(0, t.total - paid))]);
  }

  return {
    title: sale ? 'فاکتور فروش' : 'فاکتور خرید',
    company,
    meta,
    columns: [
      { label: 'ردیف', w: 0.07, align: 'center' },
      { label: 'شرح کالا', w: 0.36, align: 'right' },
      { label: 'مقدار', w: 0.14, align: 'center' },
      { label: 'واحد', w: 0.1, align: 'center' },
      { label: 'فی (ریال)', w: 0.16, align: 'left' },
      { label: 'مبلغ (ریال)', w: 0.17, align: 'left' },
    ],
    rows: (inv.lines || []).map((l, i) => [
      formatNumber(i + 1),
      l.title,
      formatNumber(l.qty, { decimals: 3 }),
      unitLabel(l.unit || 'kg'),
      formatNumber(l.price),
      formatNumber(lineAmount(l)),
    ]),
    totals,
    footer: [inv.note, company && company.invoiceNote].filter(Boolean).join('\n'),
  };
}

export { formatMoney };

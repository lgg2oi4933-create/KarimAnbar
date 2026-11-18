// مدل کالا
import { formatNumber } from '../../core/util.js';

export const KINDS = [
  { value: 'sheet', label: 'ورق مقوا', unit: 'kg', dims: true },
  { value: 'glue', label: 'چسب', unit: 'kg', dims: false },
  { value: 'tape', label: 'نوار چسب', unit: 'count', dims: false },
  { value: 'tray', label: 'سینی', unit: 'kg', dims: true },
  { value: 'waste', label: 'ضایعات', unit: 'kg', dims: false },
  { value: 'service', label: 'خدمات', unit: 'kg', dims: false, noStock: true },
  { value: 'other', label: 'سایر', unit: 'count', dims: false },
];

export const UNITS = [
  { value: 'kg', label: 'کیلوگرم' },
  { value: 'count', label: 'عدد' },
];

export const kindInfo = (v) => KINDS.find((k) => k.value === v) || KINDS[KINDS.length - 1];
export const unitLabel = (v) => (UNITS.find((u) => u.value === v) || { label: v }).label;
export const isStockKind = (kind) => !kindInfo(kind).noStock;
export const hasDims = (kind) => kindInfo(kind).dims;

// «۲۰×۳۰» — سینی‌ها با طول و عرض برش‌خورده‌شون شناخته میشن
export function dimsText(p) {
  if (!p || (!p.length && !p.width)) return '';
  return `${formatNumber(p.length || 0, { decimals: 2 })}×${formatNumber(p.width || 0, { decimals: 2 })}`;
}

export function suggestName(kind, length, width) {
  const info = kindInfo(kind);
  if (info.dims && length && width) return `${info.label} ${dimsText({ length, width })}`;
  return '';
}

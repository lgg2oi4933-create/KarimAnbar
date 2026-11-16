export const METHODS = [
  { value: 'cash', label: 'نقد' },
  { value: 'check', label: 'چک' },
  { value: 'transfer', label: 'حواله / کارت‌به‌کارت' },
];
export const DIRS = [
  { value: 'in', label: 'دریافت' },
  { value: 'out', label: 'پرداخت' },
];
export const methodLabel = (v) => (METHODS.find((m) => m.value === v) || { label: v }).label;
export const dirLabel = (v) => (DIRS.find((d) => d.value === v) || { label: v }).label;
export const rolesForDir = (dir) => (dir === 'in' ? ['customer'] : ['supplier', 'subcontractor']);

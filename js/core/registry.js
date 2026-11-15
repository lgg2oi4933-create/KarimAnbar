// ثبت ماژول‌ها. هر ماژول خودش میگه چه جدول‌ها، چه صفحه‌هایی و چه آیتمی در منو داره.
// برای اضافه کردن ماژول جدید فقط یک فایل جدید میسازیم و در app.js ثبتش میکنیم.
//
// descriptor = {
//   id, title,
//   tables: ['parties'],
//   tableLabels: { parties: 'اشخاص' },          // برای گزارش فعالیت
//   fieldLabels: { name: 'نام' },                 // برای گزارش فعالیت
//   nav:  { order, label, icon, path },           // آیتم نوار پایین (اختیاری)
//   home: { order, label, icon, path, count(db) },// کارت صفحه‌ی اصلی (اختیاری)
//   more: { order, label, icon, path },           // آیتم صفحه‌ی «بیشتر» (اختیاری)
//   routes: [{ path: '/parties', render(ctx) }],
// }
//
// نقاط توسعه (extension points): ماژول‌ها بدون دانستن همدیگه میتونن بخش به صفحه‌ی هم اضافه کنن.
//   extend('party.detail', (ctx, party) => node)
//   extend('party.deleteGuard', async (db, party) => 'دلیل ممنوع بودن حذف' | null)
const modules = new Map();
const extensions = new Map();

export function registerModule(desc) {
  if (!desc.id) throw new Error('ماژول بدون شناسه');
  if (modules.has(desc.id)) throw new Error('ماژول تکراری: ' + desc.id);
  modules.set(desc.id, { tables: [], routes: [], tableLabels: {}, fieldLabels: {}, ...desc });
}

export function extend(point, fn) {
  if (!extensions.has(point)) extensions.set(point, []);
  extensions.get(point).push(fn);
}

export function getExtensions(point) {
  return extensions.get(point) || [];
}

export function getModules() {
  return [...modules.values()];
}

export function allTables() {
  const t = new Set(['counters', 'activity_log']);
  for (const m of modules.values()) m.tables.forEach((x) => t.add(x));
  return [...t];
}

export function allRoutes() {
  return getModules().flatMap((m) => m.routes.map((r) => ({ ...r, moduleId: m.id })));
}

const byOrder = (key) => (a, b) => a[key].order - b[key].order;

export function navItems() {
  return getModules().filter((m) => m.nav).sort(byOrder('nav'));
}
export function homeCards() {
  return getModules().filter((m) => m.home).sort(byOrder('home'));
}
// more میتونه یک آیتم یا آرایه‌ای از آیتم‌ها باشه
export function moreItems() {
  return getModules()
    .flatMap((m) => [].concat(m.more || []))
    .sort((a, b) => a.order - b.order);
}

export function tableLabel(t) {
  for (const m of modules.values()) if (m.tableLabels[t]) return m.tableLabels[t];
  return t;
}
export function fieldLabel(f) {
  for (const m of modules.values()) if (m.fieldLabels[f]) return m.fieldLabels[f];
  return f;
}

export function resetRegistry() {
  modules.clear();
  extensions.clear();
}

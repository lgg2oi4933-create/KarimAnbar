// ماژول بک‌آپ: فایل کامل یا بخش‌به‌بخش (برای تلگرام و...) و ادغام فایل گوشی دیگر. فقط مدیر.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, confirmDialog, emptyState, kv, section, sheet, toast } from '../../ui/components.js';
import { shareOrDownload } from '../../ui/exporter.js';
import { registerModule, extend, getModules, allTables } from '../../core/registry.js';
import { toFaDigits } from '../../core/util.js';
import { formatJalali, todayIso, diffDaysIso } from '../../core/jalali.js';
import { session } from '../../core/session.js';
import { buildBackup, validateBackup, planMerge, applyMerge, replaceTables } from '../../core/backup.js';
import { isAdmin } from '../auth/index.js';

const LAST_KEY = 'tray.lastBackup';
const lastBackup = () => {
  try {
    return localStorage.getItem(LAST_KEY) || '';
  } catch (e) {
    return '';
  }
};
const setLast = () => {
  try {
    localStorage.setItem(LAST_KEY, todayIso());
  } catch (e) {
    /* ignore */
  }
};

const backupModules = () => getModules().filter((m) => m.tables.length);

async function counts(db, tables) {
  let n = 0;
  for (const t of tables) n += (await db.adapter.getAll(t)).length;
  return n;
}

async function backupPage(ctx) {
  ctx.setTitle('بک‌آپ و ادغام');
  ctx.setBack('/more');
  if (!isAdmin(ctx.user)) return void ctx.el.append(emptyState('user', 'این بخش فقط برای مدیر است'));
  const mods = backupModules();
  const last = lastBackup();
  const days = last ? diffDaysIso(last, todayIso()) : null;
  const picks = new Map();
  const modRows = [];
  for (const m of mods) {
    const n = await counts(ctx.db, m.tables);
    const cb = h('input', { type: 'checkbox', 'aria-label': m.title });
    picks.set(m.id, cb);
    modRows.push(h('label', { class: 'check-row', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' } }, cb, h('span', null, m.id === 'settings' ? 'تنظیمات و کاربران (شرکت، رمزها)' : m.title), h('small', { class: 'muted' }, `${toFaDigits(n)} رکورد`)));
  }

  const make = async (scope) => {
    const chosen = scope === 'full' ? mods : mods.filter((m) => picks.get(m.id).checked);
    if (!chosen.length) return void toast('حداقل یک بخش را انتخاب کنید', 'err');
    const tables = [...new Set(chosen.flatMap((m) => m.tables))];
    if (scope === 'full') tables.push('activity_log');
    try {
      const b = await buildBackup(ctx.db, { scope, moduleIds: chosen.map((m) => m.id), tables, meta: { appVersion: '0.5.0' } });
      const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
      const name = `بک‌آپ-${scope === 'full' ? 'کامل' : 'بخشی'}-${formatJalali(todayIso()).replace(/\//g, '-')}-گوشی${session.deviceTag}.json`;
      const r = await shareOrDownload(blob, name, 'بک‌آپ حسابداری');
      if (r === 'cancelled') return;
      setLast();
      await ctx.db.log('create', 'backup', null, { label: scope === 'full' ? 'بک‌آپ کامل' : `بک‌آپ بخشی (${chosen.map((m) => m.title).join('، ')})` });
      toast(r === 'shared' ? 'ارسال شد' : 'فایل ذخیره شد');
      ctx.refresh();
    } catch (e) {
      console.error(e);
      toast('ساخت بک‌آپ ناموفق بود: ' + e.message, 'err');
    }
  };

  const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (f) importFile(ctx, f);
  } });

  ctx.el.append(
    section(
      'آخرین بک‌آپ',
      h('p', null, last ? `${formatJalali(last)} (${days === 0 ? 'امروز' : toFaDigits(days) + ' روز پیش'})` : 'تا حالا بک‌آپی از این گوشی گرفته نشده.'),
      !last || days > 7 ? h('p', { class: 'muted' }, 'پیشنهاد: حداقل هفته‌ای یک بار بک‌آپ کامل بگیرید و در تلگرام نگه دارید.') : null
    ),
    section(
      'ساخت بک‌آپ',
      h('p', { class: 'muted' }, 'فایل بک‌آپ همه‌ی اطلاعات (و رمزهای رمزنگاری‌شده) را دارد؛ فقط جای امن بفرستید. پنجره‌ی ارسال گوشی باز میشود (تلگرام، ذخیره و...).'),
      h('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => make('full') }, 'بک‌آپ کامل'),
      h('p', { class: 'muted pad-top' }, 'یا فقط این بخش‌ها:'),
      h('div', null, modRows),
      h('button', { class: 'btn ghost', style: { width: '100%' }, onclick: () => make('modules') }, 'بک‌آپ بخش‌های انتخاب‌شده')
    ),
    section(
      'بازیابی / ادغام فایل بک‌آپ',
      h('p', { class: 'muted' }, 'فایل گوشی دیگر را انتخاب کنید. در حالت «ادغام» اطلاعات جدید اضافه میشود و اگر یک مورد در هر دو گوشی هست، ویرایش جدیدتر میماند؛ چیزی از دست نمیرود.'),
      h('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => file.click() }, 'انتخاب فایل بک‌آپ'),
      file
    )
  );
}

const SCOPE = (b) => (b.scope === 'full' ? 'کامل' : 'بخشی');

async function importFile(ctx, f) {
  let backup;
  try {
    backup = JSON.parse(await f.text());
  } catch (e) {
    return void toast('فایل خوانده نشد؛ مطمئن شوید فایل بک‌آپ است.', 'err');
  }
  const v = validateBackup(backup, allTables());
  if (!v.ok) return void toast(v.error, 'err');
  const tables = v.tables;
  const plan = await planMerge(ctx.db, backup, tables);
  const sameTag = backup.device && backup.device.tag === session.deviceTag && backup.device.id !== session.deviceId;
  const mine = backup.device && backup.device.id === session.deviceId;
  let s;
  let mode = 'merge';
  const modeBtns = [
    h('button', { type: 'button', class: 'btn primary', onclick: () => { mode = 'merge'; paintMode(); } }, 'ادغام (پیشنهادی)'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => { mode = 'replace'; paintMode(); } }, 'جایگزینی کامل'),
  ];
  const note = h('p', { class: 'muted' });
  const paintMode = () => {
    modeBtns[0].className = mode === 'merge' ? 'btn primary' : 'btn ghost';
    modeBtns[1].className = mode === 'replace' ? 'btn danger' : 'btn ghost';
    note.textContent = mode === 'merge' ? 'اطلاعات جدید اضافه و موارد قدیمی‌تر به‌روز میشوند؛ هیچ‌چیز حذف نمیشود.' : 'اطلاعات همین جدول‌ها در این گوشی پاک و با فایل جایگزین میشود. فقط برای گوشی تازه.';
  };
  const t = plan.totals;
  s = sheet({
    title: 'بازیابی بک‌آپ',
    body: [
      kv('نوع', `${SCOPE(backup)}${backup.modules && backup.modules.length && backup.scope !== 'full' ? ` (${toFaDigits(backup.modules.length)} بخش)` : ''}`),
      kv('تاریخ ساخت', backup.createdAt ? formatJalali(backup.createdAt.slice(0, 10)) : ''),
      kv('گوشی مبدأ', backup.device ? `حرف ${backup.device.tag}${mine ? ' (همین گوشی)' : ''}` : ''),
      h('div', { class: 'pad-top' }, badge(`${toFaDigits(t.add)} مورد جدید`, 'ok'), ' ', badge(`${toFaDigits(t.update)} به‌روزتر`, 'warn'), ' ', badge(`${toFaDigits(t.same + t.older)} بدون تغییر`)),
      t.dupCode ? h('p', { class: 'muted' }, `${toFaDigits(t.dupCode)} کد تکراری با پسوند «-۲» ذخیره میشود.`) : null,
      sameTag ? h('p', { class: 'muted' }, 'هشدار: این فایل از گوشی دیگری با «حرف کد» یکسان است. در بخش «گوشی و ظاهر» حرف کد یکی از گوشی‌ها را عوض کنید تا کدها تکراری نشوند.') : null,
      h('div', { class: 'btn-row pad-top' }, modeBtns),
      note,
      h('div', { class: 'btn-row pad-top' },
        h('button', { class: 'btn primary', onclick: async () => {
          if (mode === 'replace' && !(await confirmDialog('اطلاعات این گوشی (در جدول‌های فایل) پاک و با فایل جایگزین میشود. ادامه میدهید؟', { danger: true, okText: 'جایگزین کن', title: 'جایگزینی کامل' }))) return;
          try {
            if (mode === 'merge') await applyMerge(ctx.db, plan);
            else await replaceTables(ctx.db, backup, tables);
            await ctx.db.log('restore', 'backup', null, { label: mode === 'merge' ? `ادغام بک‌آپ (${toFaDigits(t.add)} جدید، ${toFaDigits(t.update)} به‌روز)` : 'جایگزینی کامل با بک‌آپ' });
            s.close();
            toast('انجام شد؛ برنامه دوباره بارگذاری میشود');
            setTimeout(() => location.reload(), 900);
          } catch (e) {
            console.error(e);
            toast('خطا در بازیابی: ' + e.message, 'err');
          }
        } }, 'اجرا'),
        h('button', { class: 'btn ghost', onclick: () => s.close() }, 'انصراف'))
    ],
  });
  paintMode();
}

async function backupWidget(ctx) {
  if (!isAdmin(ctx.user)) return null;
  const last = lastBackup();
  const days = last ? diffDaysIso(last, todayIso()) : null;
  const hasData = (await ctx.db.table('parties').list()).length || (await ctx.db.table('invoices').list()).length;
  if (!hasData || (last && days <= 7)) return null;
  return section('یادآوری بک‌آپ', h('p', null, last ? `آخرین بک‌آپ ${toFaDigits(days)} روز پیش بود.` : 'هنوز بک‌آپی نگرفته‌اید.'), h('button', { class: 'btn ghost small', onclick: () => ctx.go('/backup') }, 'بک‌آپ بگیرید'));
}

export function registerBackup() {
  extend('home.widget', backupWidget);
  registerModule({
    id: 'backup',
    title: 'بک‌آپ',
    tables: [],
    tableLabels: { backup: 'بک‌آپ' },
    more: { order: 80, label: 'بک‌آپ و ادغام', desc: 'فایل کامل یا بخشی، ادغام بین گوشی‌ها', icon: 'folder', path: '/backup', adminOnly: true },
    routes: [{ path: '/backup', render: backupPage }],
  });
}

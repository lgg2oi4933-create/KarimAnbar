// بک‌آپ و ادغام: فایل JSON از رکوردها (با حذف‌شده‌ها)، و ادغام امن بین دو گوشی.
// قاعده‌ی ادغام: رکوردِ جدیدتر (updatedAt) برنده است؛ حذف هم یک ویرایش است (deletedAt).
// رکورد تازه‌ای که فقط یک طرف دارد اضافه میشود. شمارنده‌ی کدها مال هر گوشی است و ادغام نمیشود.

export const BACKUP_APP = 'tray-accounting';
export const BACKUP_FORMAT = 1;

const stamp = (r) => r.updatedAt || r.createdAt || r.at || '';

export async function buildBackup(db, { scope, moduleIds, tables, meta }) {
  const data = {};
  const counts = {};
  for (const t of tables) {
    const rows = await db.adapter.getAll(t);
    data[t] = rows;
    counts[t] = rows.length;
  }
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    createdAt: db.now(),
    scope,
    modules: moduleIds,
    device: { id: db.getDeviceId(), tag: db.getDeviceTag() },
    appVersion: (meta && meta.appVersion) || '',
    counts,
    tables: data,
  };
}

export function validateBackup(obj, knownTables) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'فایل بک‌آپ معتبر نیست.' };
  if (obj.app !== BACKUP_APP) return { ok: false, error: 'این فایل بک‌آپ این برنامه نیست.' };
  if (!(obj.format >= 1) || obj.format > BACKUP_FORMAT) return { ok: false, error: 'این بک‌آپ مال نسخه‌ی جدیدتری از برنامه است؛ برنامه را به‌روز کنید.' };
  if (!obj.tables || typeof obj.tables !== 'object') return { ok: false, error: 'فایل بک‌آپ داده ندارد.' };
  const known = new Set(knownTables);
  const tables = Object.keys(obj.tables).filter((t) => known.has(t) && Array.isArray(obj.tables[t]));
  if (!tables.length) return { ok: false, error: 'هیچ جدول قابل‌شناسایی‌ای در فایل نیست.' };
  return { ok: true, tables, unknown: Object.keys(obj.tables).filter((t) => !known.has(t)) };
}

// برنامه‌ی ادغام (بدون نوشتن)
export async function planMerge(db, backup, tables) {
  const plan = { tables: {}, writes: [], totals: { add: 0, update: 0, same: 0, older: 0, dupCode: 0 } };
  for (const t of tables) {
    const local = await db.adapter.getAll(t);
    const byId = new Map(local.map((r) => [r.id, r]));
    const codes = new Map(local.filter((r) => r.code).map((r) => [r.code, r.id]));
    const st = { add: 0, update: 0, same: 0, older: 0, dupCode: 0 };
    for (const inc of backup.tables[t] || []) {
      if (!inc || !inc.id) continue;
      const cur = byId.get(inc.id);
      if (!cur) {
        let rec = inc;
        if (t !== 'activity_log' && inc.code && codes.has(inc.code) && codes.get(inc.code) !== inc.id) {
          let n = 2;
          while (codes.has(`${inc.code}-${n}`)) n += 1;
          rec = { ...inc, code: `${inc.code}-${n}` };
          st.dupCode += 1;
        }
        if (rec.code) codes.set(rec.code, rec.id);
        byId.set(rec.id, rec);
        plan.writes.push({ t, rec });
        st.add += 1;
      } else if (t === 'activity_log') {
        st.same += 1;
      } else {
        const a = stamp(inc);
        const b = stamp(cur);
        if (a > b) {
          plan.writes.push({ t, rec: inc });
          st.update += 1;
        } else if (a === b) st.same += 1;
        else st.older += 1;
      }
    }
    plan.tables[t] = st;
    for (const k of Object.keys(st)) plan.totals[k] += st[k];
  }
  return plan;
}

export async function applyMerge(db, plan) {
  const grouped = new Map();
  for (const { t, rec } of plan.writes) {
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t).push(rec);
  }
  for (const [t, recs] of grouped) await db.adapter.putMany(t, recs);
}

// جایگزینی کامل جدول‌های فایل (برای گوشی تازه)
export async function replaceTables(db, backup, tables) {
  for (const t of tables) {
    await db.adapter.clear(t);
    await db.adapter.putMany(t, backup.tables[t] || []);
  }
}

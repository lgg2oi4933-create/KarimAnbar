// مخزن داده: عملیات یکسان برای همه‌ی جدول‌ها (ایجاد، ویرایش، حذف نرم، کد خودکار، لاگ فعالیت).
// حذف‌ها «نرم» هستن (deletedAt) تا موقع ادغام بک‌آپ دو گوشی به گوشی دیگه هم برسن.
import { uuid, pad } from './util.js';
import { bus } from './events.js';

export const SYSTEM_TABLES = ['counters', 'activity_log'];

export class Db {
  constructor(adapter, { getDeviceId, getDeviceTag, getUser, now = () => new Date().toISOString() }) {
    this.adapter = adapter;
    this.getDeviceId = getDeviceId;
    this.getDeviceTag = getDeviceTag;
    this.getUser = getUser; // () => {id, name}
    this.now = now;
  }

  table(name) {
    return new Table(this, name);
  }

  // ---- کد خودکار: پیشوند + حرف گوشی + شمارنده، مثلا P-A0001
  async nextCode(prefix) {
    const tag = this.getDeviceTag();
    const key = `${prefix}-${tag}`;
    let c = await this.adapter.get('counters', key);
    let value = c ? c.value : 0;
    return { key, value, make: (n) => `${prefix}-${tag}${pad(n, 4)}` };
  }

  async allocateCode(prefix, table) {
    const { key, value, make } = await this.nextCode(prefix);
    let n = value + 1;
    const existing = new Set((await this.adapter.getAll(table)).map((r) => r.code));
    while (existing.has(make(n))) n += 1;
    await this.adapter.put('counters', { id: key, value: n, updatedAt: this.now() });
    return make(n);
  }

  async log(action, table, rec, extra = {}) {
    const u = this.getUser() || {};
    const entry = {
      id: uuid(),
      at: this.now(),
      userId: u.id || null,
      userName: u.name || '',
      deviceId: this.getDeviceId(),
      action,
      table,
      recId: rec ? rec.id : null,
      label: rec ? labelOf(rec) : '',
      ...extra,
    };
    await this.adapter.put('activity_log', entry);
    bus.emit('activity', entry);
    return entry;
  }
}

function labelOf(rec) {
  const person = [rec.firstName, rec.lastName].filter(Boolean).join(' ');
  return rec.name || rec.title || rec.company || person || rec.code || '';
}

function diff(before, after) {
  const skip = new Set(['updatedAt', 'updatedBy', 'deviceId']);
  const out = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.has(k)) continue;
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    // هش رمز هرگز در گزارش فعالیت نمیرود
    out[k] = k === 'pw' ? { from: '', to: 'تغییر کرد' } : { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

export class Table {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  async list({ includeDeleted = false } = {}) {
    const all = await this.db.adapter.getAll(this.name);
    return includeDeleted ? all : all.filter((r) => !r.deletedAt);
  }

  get(id) {
    return this.db.adapter.get(this.name, id);
  }

  async findByCode(code) {
    return (await this.list()).find((r) => r.code === code);
  }

  _meta() {
    const u = this.db.getUser() || {};
    return { updatedAt: this.db.now(), updatedBy: u.id || null, deviceId: this.db.getDeviceId() };
  }

  // prefix: اگه بدی کد خودکار ساخته میشه. id ثابت برای رکوردهای تکی مثل تنظیمات.
  async create(data, { prefix, id, silent = false } = {}) {
    const meta = this._meta();
    const rec = {
      note: '',
      ...data,
      id: id || uuid(),
      createdAt: meta.updatedAt,
      createdBy: meta.updatedBy,
      ...meta,
      deletedAt: null,
    };
    if (prefix && !rec.code) rec.code = await this.db.allocateCode(prefix, this.name);
    await this.db.adapter.put(this.name, rec);
    if (!silent) await this.db.log('create', this.name, rec);
    bus.emit('change', { table: this.name, id: rec.id, action: 'create' });
    return rec;
  }

  async update(id, patch, { silent = false } = {}) {
    const before = await this.get(id);
    if (!before) throw new Error('رکورد پیدا نشد');
    const rec = { ...before, ...patch, id, ...this._meta() };
    await this.db.adapter.put(this.name, rec);
    const changes = diff(before, rec);
    if (!silent && Object.keys(changes).length) await this.db.log('update', this.name, rec, { changes });
    bus.emit('change', { table: this.name, id, action: 'update' });
    return rec;
  }

  async upsert(id, data, opts = {}) {
    const existing = await this.get(id);
    return existing ? this.update(id, data, opts) : this.create(data, { ...opts, id });
  }

  async remove(id) {
    const before = await this.get(id);
    if (!before || before.deletedAt) return before;
    const meta = this._meta();
    const rec = { ...before, ...meta, deletedAt: meta.updatedAt };
    await this.db.adapter.put(this.name, rec);
    await this.db.log('delete', this.name, rec);
    bus.emit('change', { table: this.name, id, action: 'delete' });
    return rec;
  }

  async restore(id) {
    const before = await this.get(id);
    if (!before) return null;
    const rec = { ...before, ...this._meta(), deletedAt: null };
    await this.db.adapter.put(this.name, rec);
    await this.db.log('restore', this.name, rec);
    bus.emit('change', { table: this.name, id, action: 'restore' });
    return rec;
  }

  // آیا این کد قبلا برای رکورد دیگه‌ای استفاده شده؟
  async codeTaken(code, exceptId) {
    return (await this.list({ includeDeleted: true })).some((r) => r.code === code && r.id !== exceptId);
  }
}

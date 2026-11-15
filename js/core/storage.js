// لایه‌ی ذخیره‌سازی. دو پیاده‌سازی با یک رابط: IndexedDB (مرورگر) و حافظه (تست).
// بقیه‌ی برنامه فقط با این رابط کار میکنه، پس عوض کردن موتور ذخیره‌سازی بقیه رو خراب نمیکنه.
//
// رابط: init(tables) / getAll(t) / get(t,id) / put(t,rec) / putMany(t,recs) / delete(t,id) / clear(t) / tableNames()

export class MemoryAdapter {
  constructor() {
    this.data = new Map();
  }
  async init(tables) {
    for (const t of tables) if (!this.data.has(t)) this.data.set(t, new Map());
  }
  _t(t) {
    if (!this.data.has(t)) this.data.set(t, new Map());
    return this.data.get(t);
  }
  async getAll(t) {
    return [...this._t(t).values()].map((r) => structuredClone(r));
  }
  async get(t, id) {
    const r = this._t(t).get(id);
    return r ? structuredClone(r) : undefined;
  }
  async put(t, rec) {
    this._t(t).set(rec.id, structuredClone(rec));
    return rec;
  }
  async putMany(t, recs) {
    for (const r of recs) await this.put(t, r);
  }
  async delete(t, id) {
    this._t(t).delete(id);
  }
  async clear(t) {
    this._t(t).clear();
  }
  tableNames() {
    return [...this.data.keys()];
  }
}

export class IndexedDBAdapter {
  constructor(name = 'tray_accounting') {
    this.name = name;
    this.db = null;
  }

  _open(version, createStores = []) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(this.name, version) : indexedDB.open(this.name);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const t of createStores) {
          if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('پایگاه داده توسط تب دیگری قفل شده است'));
    });
  }

  // اگه ماژول جدیدی جدول جدید بخواد، نسخه‌ی دیتابیس خودکار بالا میره
  async init(tables) {
    let db = await this._open();
    const missing = tables.filter((t) => !db.objectStoreNames.contains(t));
    if (missing.length) {
      const next = db.version + 1;
      db.close();
      db = await this._open(next, missing);
    }
    db.onversionchange = () => db.close();
    this.db = db;
  }

  _tx(t, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(t, mode);
      const store = tx.objectStore(t);
      let result;
      const r = fn(store);
      if (r) r.onsuccess = () => (result = r.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  getAll(t) {
    return this._tx(t, 'readonly', (s) => s.getAll());
  }
  get(t, id) {
    return this._tx(t, 'readonly', (s) => s.get(id));
  }
  put(t, rec) {
    return this._tx(t, 'readwrite', (s) => s.put(rec)).then(() => rec);
  }
  putMany(t, recs) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(t, 'readwrite');
      const s = tx.objectStore(t);
      recs.forEach((r) => s.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  delete(t, id) {
    return this._tx(t, 'readwrite', (s) => s.delete(id));
  }
  clear(t) {
    return this._tx(t, 'readwrite', (s) => s.clear());
  }
  tableNames() {
    return [...this.db.objectStoreNames];
  }
}

// درخواست ذخیره‌سازی دائمی تا مرورگر خودسرانه داده‌ها رو پاک نکنه
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}

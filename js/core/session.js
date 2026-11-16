// اطلاعات مخصوص همین گوشی: شناسه‌ی گوشی، حرف گوشی (برای کدها) و کاربر فعلی.
// این‌ها عمداً داخل بک‌آپ نمیرن چون به خود گوشی تعلق دارن.
import { uuid } from './util.js';

const mem = new Map();
const store = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? mem.get(k) ?? null : v;
    } catch (e) {
      return mem.get(k) ?? null;
    }
  },
  set(k, v) {
    mem.set(k, v);
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* ignore */
    }
  },
};

export const session = {
  get deviceId() {
    let v = store.get('tray.deviceId');
    if (!v) {
      v = uuid();
      store.set('tray.deviceId', v);
    }
    return v;
  },
  get deviceTag() {
    return store.get('tray.deviceTag') || 'A';
  },
  set deviceTag(v) {
    store.set('tray.deviceTag', String(v || 'A').trim().toUpperCase().slice(0, 2) || 'A');
  },
  get userId() {
    return store.get('tray.userId');
  },
  set userId(v) {
    store.set('tray.userId', v || '');
  },
  get userName() {
    return store.get('tray.userName') || '';
  },
  set userName(v) {
    store.set('tray.userName', v || '');
  },
  get lastActive() {
    return Number(store.get('tray.lastActive')) || 0;
  },
  touch() {
    store.set('tray.lastActive', String(Date.now()));
  },
  // قفل خودکار بعد از چند دقیقه بی‌کاری (۰ = هیچ‌وقت)
  get lockMinutes() {
    const v = store.get('tray.lockMinutes');
    return v === null || v === '' ? 30 : Number(v);
  },
  set lockMinutes(v) {
    store.set('tray.lockMinutes', String(Number(v) || 0));
  },
  get theme() {
    return store.get('tray.theme') || 'auto';
  },
  set theme(v) {
    store.set('tray.theme', v);
  },
};

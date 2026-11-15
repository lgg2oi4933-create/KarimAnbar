// یک گذرگاه رویداد ساده تا ماژول‌ها بدون وابستگی مستقیم به هم خبر بگیرن
const handlers = new Map();

export const bus = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name).delete(fn);
  },
  emit(name, payload) {
    (handlers.get(name) || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('handler error', name, e);
      }
    });
  },
};

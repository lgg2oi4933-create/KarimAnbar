// ماژول ورود و رمز عبور: انتخاب کاربر، رمز، قفل خودکار، کد بازیابی.
// هر کاربر (حتی مدیر) رمز خودش را دارد؛ چند مدیر هم میتوانند وجود داشته باشند
// و چون کاربران در بک‌آپ هستند، روی چند گوشی همگام میشوند.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { buildForm, row, sheet, toast } from '../../ui/components.js';
import { session } from '../../core/session.js';
import { hashPassword, verifyPassword, makeRecoveryCode, normalizeCode, validatePasswordText, normalizePassword } from '../../core/crypto.js';
import { registerModule } from '../../core/registry.js';

export const USER_ROLES = [
  { value: 'admin', label: 'مدیر' },
  { value: 'accountant', label: 'حسابدار' },
];
export const roleLabel = (v) => (USER_ROLES.find((r) => r.value === v) || { label: v }).label;
export const isAdmin = (u) => !!u && u.role === 'admin';

export async function currentUser(db) {
  const id = session.userId;
  if (!id) return null;
  const u = await db.table('users').get(id);
  return u && !u.deletedAt ? u : null;
}

export function sessionExpired() {
  const m = session.lockMinutes;
  if (!m) return false;
  return Date.now() - session.lastActive > m * 60000;
}

// ---------------------------------------------------------------- محدودیت تلاش اشتباه
const MAX_FAILS = 5;
const LOCK_SECONDS = 30;
function failState(userId) {
  try {
    return JSON.parse(localStorage.getItem('tray.fail.' + userId) || '{}');
  } catch (e) {
    return {};
  }
}
function setFailState(userId, st) {
  try {
    localStorage.setItem('tray.fail.' + userId, JSON.stringify(st));
  } catch (e) {
    /* ignore */
  }
}
function waitSeconds(userId) {
  const st = failState(userId);
  return st.until && st.until > Date.now() ? Math.ceil((st.until - Date.now()) / 1000) : 0;
}
function registerFail(userId) {
  const st = failState(userId);
  const n = (st.until && st.until < Date.now() ? 0 : st.n || 0) + 1;
  setFailState(userId, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_SECONDS * 1000 } : { n });
}
function clearFails(userId) {
  setFailState(userId, {});
}

// ---------------------------------------------------------------- کد بازیابی
export async function getRecovery(db) {
  return db.table('settings').get('recovery');
}

export async function createRecoveryCode(db) {
  const code = makeRecoveryCode();
  const rec = await hashPassword(normalizeCode(code));
  await db.table('settings').upsert('recovery', { pw: rec }, { silent: true });
  return code;
}

async function verifyRecovery(db, code) {
  const rec = await getRecovery(db);
  return !!rec && !rec.deletedAt && verifyPassword(normalizeCode(code), rec.pw);
}

export function showRecoveryCodeSheet(code, onDone) {
  let s;
  s = sheet({
    title: 'کد بازیابی رمز',
    dismissible: false,
    body: [
      h('p', { class: 'confirm-msg' }, 'این کد تنها راه بازیابی است اگر همه‌ی مدیرها رمزشان را فراموش کنند. آن را جایی امن یادداشت کنید. دیگر نمایش داده نمیشود.'),
      h('div', { class: 'code-box', dir: 'ltr' }, code),
      h(
        'div',
        { class: 'btn-row pad-top' },
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(code);
                toast('کپی شد');
              } catch (e) {
                toast('کپی نشد؛ دستی یادداشت کنید', 'err');
              }
            },
          },
          'کپی'
        ),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              s.close();
              onDone && onDone();
            },
          },
          'یادداشت کردم'
        )
      ),
    ],
  });
}

// ---------------------------------------------------------------- صفحه‌ی ورود
let overlayOpen = false;
export const isLockScreenOpen = () => overlayOpen;

export function ensureLogin(db, { force = false } = {}) {
  return new Promise((resolve) => {
    (async () => {
      if (!force) {
        const u = await currentUser(db);
        if (u && !sessionExpired()) return resolve(u);
      }
      overlayOpen = true;
      const card = h('div', { class: 'lock-card' });
      const root = h('div', { class: 'lock-screen' }, card);
      document.body.append(root);

      const finish = (u) => {
        session.userId = u.id;
        session.userName = u.name;
        session.touch();
        root.remove();
        overlayOpen = false;
        resolve(u);
      };
      const head = (title, sub) => [
        h('div', { class: 'lock-icon' }, icon('user', 34)),
        h('h2', null, title),
        sub ? h('p', { class: 'muted' }, sub) : null,
      ];

      // انتخاب کاربر
      async function showPick() {
        const users = (await db.table('users').list()).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
        card.replaceChildren(
          ...head('ورود به برنامه', 'کدام کاربر هستید؟'),
          h('div', { class: 'list' }, users.map((u) => row({ leading: icon('user'), title: u.name, subtitle: roleLabel(u.role), onclick: () => (u.pw ? showPassword(u) : showSetup(u)) }))),
          h('button', { class: 'btn ghost small pad-top', onclick: showForgot }, 'رمز را فراموش کرده‌اید؟')
        );
      }

      // وارد کردن رمز
      function showPassword(u) {
        const err = h('div', { class: 'err' });
        const input = h('input', { type: 'password', class: 'lock-input ltr-text', dir: 'ltr', autocomplete: 'current-password', placeholder: 'رمز عبور', 'aria-label': 'رمز عبور' });
        const submit = h('button', { class: 'btn primary', type: 'submit' }, 'ورود');
        const form = h('form', { class: 'lock-form', onsubmit: async (e) => {
          e.preventDefault();
          const wait = waitSeconds(u.id);
          if (wait) {
            err.textContent = `تلاش‌های اشتباه زیاد بود. ${wait} ثانیه صبر کنید.`;
            return;
          }
          submit.disabled = true;
          try {
            if (await verifyPassword(input.value, u.pw)) {
              clearFails(u.id);
              finish(u);
              return;
            }
            registerFail(u.id);
            err.textContent = waitSeconds(u.id) ? `تلاش‌های اشتباه زیاد بود. ${LOCK_SECONDS} ثانیه صبر کنید.` : 'رمز اشتباه است';
            input.value = '';
            input.focus();
          } catch (ex) {
            err.textContent = ex.message;
          } finally {
            submit.disabled = false;
          }
        } }, input, err, h('div', { class: 'btn-row' }, submit, h('button', { type: 'button', class: 'btn ghost', onclick: showPick }, 'بازگشت')));
        card.replaceChildren(...head(u.name, roleLabel(u.role)), form, h('button', { class: 'btn ghost small pad-top', onclick: showForgot }, 'رمز را فراموش کرده‌اید؟'));
        setTimeout(() => input.focus(), 50);
      }

      // تعیین رمز (اولین ورود یا بازنشانی)
      function showSetup(u, { afterSet } = {}) {
        const form = buildForm({
          submitText: 'ثبت رمز و ورود',
          onCancel: showPick,
          fields: [
            { name: 'p1', label: 'رمز جدید', type: 'password', required: true, validate: (v) => validatePasswordText(v) },
            { name: 'p2', label: 'تکرار رمز', type: 'password', required: true, validate: (v, all) => (normalizePassword(v) === normalizePassword(all.p1) ? '' : 'تکرار رمز یکی نیست') },
          ],
          onSubmit: async (v) => {
            session.userId = u.id;
            session.userName = u.name;
            const pw = await hashPassword(v.p1);
            const updated = await db.table('users').update(u.id, { pw });
            const needCode = isAdmin(updated) && !(await getRecovery(db));
            const go = () => finish(updated);
            if (afterSet) return afterSet(updated, go);
            if (needCode) {
              const code = await createRecoveryCode(db);
              showRecoveryCodeSheet(code, go);
            } else go();
          },
        });
        card.replaceChildren(...head(u.name, u.pw ? 'رمز جدید تعیین کنید' : 'برای اولین ورود یک رمز تعیین کنید'), form);
      }

      // فراموشی رمز با کد بازیابی
      function showForgot() {
        const form = buildForm({
          submitText: 'ادامه',
          onCancel: showPick,
          fields: [{ name: 'code', label: 'کد بازیابی', dir: 'ltr', required: true, placeholder: 'XXXX-XXXX-XXXX' }],
          onSubmit: async (v, { setError }) => {
            if (!(await verifyRecovery(db, v.code))) return setError('code', 'کد بازیابی درست نیست');
            showResetPick();
          },
        });
        card.replaceChildren(
          ...head('بازیابی رمز', 'اگر مدیر دیگری دارید، میتواند رمز شما را از بخش «کاربران» عوض کند. در غیر این صورت کد بازیابی را وارد کنید.'),
          form
        );
      }

      async function showResetPick() {
        const users = (await db.table('users').list()).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
        card.replaceChildren(
          ...head('رمز کدام کاربر عوض شود؟'),
          h('div', { class: 'list' }, users.map((u) =>
            row({
              leading: icon('user'),
              title: u.name,
              subtitle: roleLabel(u.role),
              onclick: () =>
                showSetup(u, {
                  // بعد از استفاده، کد قبلی باطل و کد تازه ساخته میشود
                  afterSet: async (updated, go) => {
                    const code = await createRecoveryCode(db);
                    showRecoveryCodeSheet(code, go);
                  },
                }),
            })
          ))
        );
      }

      await showPick();
    })();
  });
}

// ---------------------------------------------------------------- قفل خودکار
export function setupAutoLock(db, onUnlock) {
  let locking = false;
  let lastTouch = 0;
  const lock = async () => {
    if (locking || overlayOpen) return;
    locking = true;
    await ensureLogin(db, { force: true });
    locking = false;
    onUnlock && onUnlock();
  };
  const activity = () => {
    if (locking || overlayOpen) return;
    if (sessionExpired()) return void lock();
    const now = Date.now();
    if (now - lastTouch > 5000) {
      lastTouch = now;
      session.touch();
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, activity, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sessionExpired()) lock();
  });
  setInterval(() => {
    if (sessionExpired()) lock();
  }, 20000);
  session.touch();
  return { lock };
}

// ---------------------------------------------------------------- تغییر رمز خودم
export function changeMyPasswordSheet(db, user, onDone) {
  let s;
  const form = buildForm({
    submitText: 'ذخیره رمز',
    onCancel: () => s.close(),
    fields: [
      ...(user.pw ? [{ name: 'old', label: 'رمز فعلی', type: 'password', required: true }] : []),
      { name: 'p1', label: 'رمز جدید', type: 'password', required: true, validate: (v) => validatePasswordText(v) },
      { name: 'p2', label: 'تکرار رمز جدید', type: 'password', required: true, validate: (v, all) => (normalizePassword(v) === normalizePassword(all.p1) ? '' : 'تکرار رمز یکی نیست') },
    ],
    onSubmit: async (v, { setError }) => {
      if (user.pw && !(await verifyPassword(v.old, user.pw))) return setError('old', 'رمز فعلی درست نیست');
      await db.table('users').update(user.id, { pw: await hashPassword(v.p1) });
      s.close();
      toast('رمز عوض شد');
      onDone && onDone();
    },
  });
  s = sheet({ title: 'تغییر رمز من', body: form });
}

export function registerAuth() {
  registerModule({ id: 'auth', title: 'ورود', tables: [], fieldLabels: { pw: 'رمز' } });
}

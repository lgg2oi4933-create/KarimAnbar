// ماژول صدا: ثبت با صدا (فاکتور، دریافت/پرداخت، ورود/خروج انبار) + صفحه‌ی آزمایش.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { section, toast, kv, sheet } from '../../ui/components.js';
import { registerModule, extend } from '../../core/registry.js';
import { toFaDigits } from '../../core/util.js';
import { partyName } from '../parties/model.js';
import { store, KEY, MODEL_KEY, DEFAULT_MODEL, hasKey, listModels, transcribe, startRecording, friendlyError } from './ai.js';
import { resolveParsed, productText } from './resolve.js';
import { setDraft } from './draft.js';

const TARGET = { sale: '/invoices/new?type=sale', purchase: '/invoices/new?type=purchase', payment_in: '/payments/new?dir=in', payment_out: '/payments/new?dir=out', stock_in: '/inventory', stock_out: '/inventory' };
const KIND_LABEL = { sale: 'فاکتور فروش', purchase: 'فاکتور خرید', payment_in: 'دریافت', payment_out: 'پرداخت', stock_in: 'ورود به انبار', stock_out: 'خروج از انبار', unknown: 'نامشخص' };

function go(ctx, path) {
  if (location.hash === '#' + path) ctx.refresh();
  else ctx.go(path);
}

// پیش‌نویس را آماده و به فرم مربوط میبرد
export function applyResolved(ctx, r) {
  if (r.kind === 'sale' || r.kind === 'purchase') setDraft('invoice', { type: r.kind, partyId: r.partyId || '', lines: r.lines, note: r.note });
  else if (r.kind === 'payment_in' || r.kind === 'payment_out') setDraft('payment', { direction: r.kind === 'payment_in' ? 'in' : 'out', partyId: r.partyId || '', amount: r.amount, method: r.method, note: r.note });
  else if (r.kind === 'stock_in' || r.kind === 'stock_out') setDraft('stock', r.moves.slice());
  else return false;
  go(ctx, TARGET[r.kind]);
  return true;
}

async function loadLists(ctx) {
  const [parties, products] = await Promise.all([ctx.db.table('parties').list(), ctx.db.table('products').list()]);
  return { parties, products };
}

// برگه‌ی ضبط ← تأیید ← رفتن به فرم
export async function openVoiceSheet(ctx) {
  if (!hasKey()) return ctx.go('/voice');
  if (!navigator.onLine) return toast('اینترنت وصل نیست؛ ثبت دستی را بزنید', 'err');
  const lists = await loadLists(ctx);
  let rec = null;
  let s;
  const status = h('p', { class: 'muted' }, 'دکمه را بزنید و جمله را بگویید.');
  const body = h('div');
  const btn = h('button', { class: 'btn primary', type: 'button' }, '🎙 شروع ضبط');
  const showResult = (res) => {
    const r = resolveParsed(res.parsed || {}, lists);
    const pById = new Map(lists.products.map((p) => [p.id, p]));
    const fa = (n) => (n == null ? '؟' : toFaDigits(Number(n).toLocaleString('en-US')));
    body.replaceChildren(
      ...[
      section('شنیده شد', h('p', null, r.transcript || res.text)),
      kv('نوع', KIND_LABEL[r.kind] || r.kind),
      r.partyName ? kv('طرف حساب', r.partyName) : null,
      r.amount ? kv('مبلغ', fa(Math.round(r.amount)) + ' ریال') : null,
      ...(r.lines || []).map((l, i) => kv(`قلم ${toFaDigits(i + 1)}`, `${l.matched || l.title} · ${fa(l.qty)} · فی ${fa(l.price)}`)),
      ...(r.moves || []).map((m, i) => kv(`حرکت ${toFaDigits(i + 1)}`, `${m.direction === 'in' ? 'ورود' : 'خروج'} ${m.productName || '؟'} · ${fa(m.qty)}${m.runTag ? ` · تولید ${toFaDigits(m.runTag)}` : ''}`)),
      ...r.warnings.map((w) => h('p', { class: 'hint' }, w)),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', disabled: !TARGET[r.kind], onclick: () => { s.close(); applyResolved(ctx, r); } }, 'ادامه به فرم (قابل ویرایش)'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { body.replaceChildren(); status.textContent = 'دوباره بگویید.'; } }, 'ضبط دوباره')
      )
      ].filter(Boolean)
    );
    void pById;
  };
  btn.onclick = async () => {
    if (rec) {
      const r0 = rec;
      rec = null;
      btn.textContent = '🎙 شروع ضبط';
      btn.disabled = true;
      status.textContent = 'در حال تشخیص...';
      try {
        const blob = await r0.stop();
        const res = await transcribe(blob, { parties: lists.parties.filter((p) => !p.deletedAt).map(partyName), products: lists.products.filter((p) => !p.deletedAt).map(productText) });
        status.textContent = `پاسخ در ${toFaDigits(Math.round(res.ms / 100) / 10)} ثانیه`;
        showResult(res);
      } catch (e) {
        status.textContent = friendlyError(e);
      }
      btn.disabled = false;
      return;
    }
    try {
      rec = await startRecording();
    } catch (e) {
      return toast('دسترسی میکروفون داده نشد', 'err');
    }
    body.replaceChildren();
    btn.textContent = '⏹ پایان و ارسال';
    status.textContent = 'در حال ضبط...';
  };
  s = sheet({ title: 'ثبت با صدا', body: h('div', null, h('p', { class: 'muted' }, 'مثلاً: «فروش صد کیلو سینی بیست در سی به آقای کریمی، فی دویست و پنجاه هزار ریال» یا «خروج ۵۰۰ کیلو ورق برای مصرف در تولید شماره ۱۲».'), btn, status, body) });
}

// ویجت خانه
async function voiceWidget(ctx) {
  if (!hasKey()) return null;
  return h('button', { class: 'btn primary', type: 'button', style: { width: '100%', margin: '12px 0' }, onclick: () => openVoiceSheet(ctx) }, icon('activity', 18), ' ثبت با صدا');
}

function voicePage(ctx) {
  ctx.setTitle('ثبت با صدا');
  ctx.setBack('/more');
  const keyIn = h('input', { type: 'password', dir: 'ltr', placeholder: 'AQ... یا AIza...', value: store.get(KEY), 'aria-label': 'کلید API' });
  const modelIn = h('input', { type: 'text', dir: 'ltr', value: store.get(MODEL_KEY, DEFAULT_MODEL), 'aria-label': 'نام مدل' });
  const info = h('p', { class: 'muted' });
  const save = () => { store.set(KEY, keyIn.value.trim()); store.set(MODEL_KEY, modelIn.value.trim()); };
  const testKey = async () => {
    save();
    if (!keyIn.value.trim()) return toast('کلید را وارد کنید', 'err');
    info.textContent = 'در حال بررسی کلید...';
    try {
      const m = await listModels(keyIn.value.trim());
      info.textContent = `کلید معتبر است. مدل‌های فلش: ${m.filter((x) => /flash/.test(x)).slice(0, 8).join('، ')}`;
    } catch (e) {
      info.textContent = friendlyError(e);
    }
  };
  ctx.el.append(
    section(
      'تنظیم',
      h('p', { class: 'muted' }, 'تشخیص صدا با Gemini گوگل انجام میشود و به اینترنت (و در ایران معمولاً VPN) نیاز دارد. کلید فقط روی همین گوشی ذخیره میشود و در بک‌آپ و ادغام نمی‌آید؛ هر گوشی کلید خودش را وارد کند. صدا و اسم‌ها برای تشخیص به گوگل فرستاده میشوند.'),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'کلید API'), keyIn),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'مدل'), modelIn),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: testKey }, 'ذخیره و بررسی کلید'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { store.set(KEY, ''); keyIn.value = ''; toast('کلید پاک شد'); } }, 'پاک کردن کلید')
      ),
      info
    ),
    section('امتحان', h('button', { class: 'btn primary', type: 'button', onclick: () => { save(); openVoiceSheet(ctx); } }, '🎙 ثبت با صدا'), h('p', { class: 'muted' }, 'بعد از تشخیص، فرم پر میشود و قبل از ذخیره همه‌چیز را می‌بینید و اصلاح می‌کنید.'))
  );
}

export function registerVoice() {
  extend('home.widget', voiceWidget);
  registerModule({
    id: 'voice',
    title: 'صدا',
    tables: [],
    more: { order: 90, label: 'ثبت با صدا', desc: 'کلید Gemini و ثبت صوتی', icon: 'activity', path: '/voice', adminOnly: true },
    routes: [{ path: '/voice', render: voicePage }],
  });
}

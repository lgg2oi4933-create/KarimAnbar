// انتخابگرهای شخص و کالا: دکمه‌ای که پنجره‌ی جستجو باز میکند و امکان افزودن سریع دارد.
import { h } from './dom.js';
import { icon } from './icons.js';
import { buildForm, emptyState, row, searchBar, sheet, toast } from './components.js';
import { matches, toFaDigits } from '../core/util.js';
import { ROLES, roleLabel, partyName, normalizeMobile, isValidMobile } from '../modules/parties/model.js';
import { KINDS, UNITS, kindInfo, hasDims, dimsText, suggestName, unitLabel } from '../modules/products/model.js';

function pickerButton(placeholder) {
  const btn = h('button', { type: 'button', class: 'picker' });
  const paint = (label) => btn.replaceChildren(label ? h('span', null, label) : h('span', { class: 'ph' }, placeholder), icon('chevron', 18));
  return { btn, paint };
}

// ---------------------------------------------------------------- شخص
export function partyPicker({ db, value = '', getRoles = () => [], onChange, placeholder = 'انتخاب شخص...' }) {
  let current = value || '';
  const { btn, paint } = pickerButton(placeholder);
  const showCurrent = async () => {
    const p = current ? await db.table('parties').get(current) : null;
    paint(p && !p.deletedAt ? partyName(p) : '');
  };

  async function open() {
    const roles = getRoles() || [];
    const all = await db.table('parties').list();
    let q = '';
    let s;
    const listEl = h('div', { class: 'list' });
    const choose = (p) => {
      current = p ? p.id : '';
      showCurrent();
      s.close();
      onChange && onChange(p || null);
      btn.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const paintList = () => {
      const rank = (p) => (roles.length && (p.roles || []).some((r) => roles.includes(r)) ? 0 : 1);
      const items = all
        .filter((p) => matches([partyName(p), p.mobile, p.code], q))
        .sort((a, b) => rank(a) - rank(b) || partyName(a).localeCompare(partyName(b), 'fa'));
      listEl.replaceChildren(
        ...(items.length
          ? items.map((p) =>
              row({
                leading: icon('user'),
                title: partyName(p),
                subtitle: p.mobile ? toFaDigits(p.mobile) : p.code,
                meta: (p.roles || []).map((r) => roleLabel(r)).join('، '),
                onclick: () => choose(p),
              })
            )
          : [emptyState('users', 'شخصی پیدا نشد')])
      );
    };
    s = sheet({
      title: 'انتخاب شخص',
      body: [
        searchBar((v) => ((q = v), paintList()), 'جستجوی نام یا موبایل...'),
        h('button', { class: 'btn ghost small', style: { marginBottom: '10px' }, onclick: () => quickAdd() }, '＋ شخص جدید'),
        listEl,
      ],
    });
    paintList();

    function quickAdd() {
      const f = buildForm({
        values: { roles: roles.length ? [roles[0]] : [] },
        submitText: 'افزودن و انتخاب',
        onCancel: () => s.close(),
        fields: [
          { name: 'roles', label: 'نقش', type: 'chips', required: true, options: ROLES },
          { name: 'firstName', label: 'نام' },
          { name: 'lastName', label: 'نام خانوادگی' },
          { name: 'company', label: 'شرکت / کسب‌وکار (اختیاری)' },
          { name: 'mobile', label: 'موبایل', type: 'tel', validate: (v) => (isValidMobile(v) ? '' : 'شماره موبایل معتبر نیست') },
        ],
        onSubmit: async (v, { setError }) => {
          if (!v.firstName && !v.lastName && !v.company) return setError('firstName', 'حداقل یک نام وارد کنید');
          const rec = await db.table('parties').create({ ...v, mobile: v.mobile ? normalizeMobile(v.mobile) : '', openingType: 'none' }, { prefix: 'P' });
          toast('شخص اضافه شد');
          choose(rec);
        },
      });
      s.el.querySelector('.sheet-body').replaceChildren(f);
    }
  }

  btn.addEventListener('click', open);
  btn.getValue = () => current;
  btn.setValue = (v) => {
    current = v || '';
    showCurrent();
  };
  showCurrent();
  return btn;
}

// ---------------------------------------------------------------- کالا
export function productPicker({ db, value = '', getKinds = () => [], onChange, placeholder = 'انتخاب کالا...' }) {
  let current = value || '';
  const { btn, paint } = pickerButton(placeholder);
  const showCurrent = async () => {
    const p = current ? await db.table('products').get(current) : null;
    paint(p && !p.deletedAt ? p.name : '');
  };

  async function open() {
    const kinds = getKinds() || [];
    const all = await db.table('products').list();
    let q = '';
    let s;
    const listEl = h('div', { class: 'list' });
    const choose = (p) => {
      current = p ? p.id : '';
      showCurrent();
      s.close();
      onChange && onChange(p || null);
      btn.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const paintList = () => {
      const rank = (p) => (kinds.length && kinds.includes(p.kind) ? 0 : 1);
      const items = all
        .filter((p) => matches([p.name, p.code, dimsText(p)], q))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fa'));
      listEl.replaceChildren(
        ...(items.length
          ? items.map((p) =>
              row({ leading: icon('box'), title: p.name, subtitle: `${kindInfo(p.kind).label} · ${p.code}`, meta: unitLabel(p.unit), onclick: () => choose(p) })
            )
          : [emptyState('box', 'کالایی پیدا نشد')])
      );
    };
    s = sheet({
      title: 'انتخاب کالا',
      body: [
        searchBar((v) => ((q = v), paintList()), 'جستجوی نام، کد، ابعاد...'),
        h('button', { class: 'btn ghost small', style: { marginBottom: '10px' }, onclick: () => quickAdd() }, '＋ کالای جدید'),
        listEl,
      ],
    });
    paintList();

    function quickAdd() {
      const f = buildForm({
        values: { kind: kinds[0] || 'tray', unit: kindInfo(kinds[0] || 'tray').unit },
        submitText: 'افزودن و انتخاب',
        onCancel: () => s.close(),
        fields: [
          { name: 'kind', label: 'نوع کالا', type: 'choice', options: KINDS.map((k) => ({ value: k.value, label: k.label })) },
          { name: 'length', label: 'طول (سانتی‌متر)', type: 'number', min: 0, show: (v) => hasDims(v.kind) },
          { name: 'width', label: 'عرض (سانتی‌متر)', type: 'number', min: 0, show: (v) => hasDims(v.kind) },
          { name: 'name', label: 'نام کالا', hint: 'برای ورق و سینی از روی ابعاد ساخته میشود.' },
          { name: 'unit', label: 'واحد', type: 'select', options: UNITS },
        ],
        onSubmit: async (v, { setError }) => {
          const data = { ...v };
          if (!hasDims(data.kind)) {
            data.length = null;
            data.width = null;
          }
          if (!data.name) data.name = suggestName(data.kind, data.length, data.width);
          if (!data.name) return setError('name', 'نام یا ابعاد را وارد کنید');
          const rec = await db.table('products').create(data, { prefix: 'G' });
          toast('کالا اضافه شد');
          choose(rec);
        },
      });
      s.el.querySelector('.sheet-body').replaceChildren(f);
    }
  }

  btn.addEventListener('click', open);
  btn.getValue = () => current;
  btn.setValue = (v) => {
    current = v || '';
    showCurrent();
  };
  showCurrent();
  return btn;
}

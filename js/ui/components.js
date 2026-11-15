// اجزای مشترک رابط: پیام، پنجره‌ی پایین، تأیید، فرم‌ساز، تاریخ شمسی، تب، ردیف لیست
import { h, append } from './dom.js';
import { icon } from './icons.js';
import { parseNumber, toFaDigits, formatNumber } from '../core/util.js';
import { MONTHS, daysInMonth, isoToJalaliParts, jalaliPartsToIso, toJalali, isValidJalali } from '../core/jalali.js';

// ---------- پیام کوتاه
export function toast(message, tone = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', class: 'toasts' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${tone}` }, message);
  host.append(t);
  setTimeout(() => t.classList.add('hide'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---------- پنجره‌ی پایین (bottom sheet)
export function sheet({ title, body, dismissible = true, className = '' }) {
  const overlay = h('div', { class: 'overlay' });
  const panel = h('div', { class: `sheet ${className}`, role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 150);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) close();
  };
  panel.append(
    h(
      'div',
      { class: 'sheet-head' },
      h('h2', null, title || ''),
      dismissible ? h('button', { class: 'icon-btn', 'aria-label': 'بستن', onclick: close }, icon('x')) : null
    ),
    h('div', { class: 'sheet-body' }, body)
  );
  overlay.append(panel);
  if (dismissible)
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { close, el: panel };
}

export function confirmDialog(message, { okText = 'تأیید', cancelText = 'انصراف', danger = false, title = 'تأیید' } = {}) {
  return new Promise((resolve) => {
    let s;
    const done = (v) => {
      s.close();
      resolve(v);
    };
    s = sheet({
      title,
      dismissible: false,
      body: [
        h('p', { class: 'confirm-msg' }, message),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okText),
          h('button', { class: 'btn ghost', onclick: () => done(false) }, cancelText)
        ),
      ],
    });
  });
}

// ---------- اجزای کوچک
export function emptyState(iconName, text, action) {
  return h('div', { class: 'empty' }, icon(iconName, 40), h('p', null, text), action || null);
}

export function badge(text, tone = '') {
  return h('span', { class: `badge ${tone}` }, text);
}

export function searchBar(onInput, placeholder = 'جستجو...') {
  const input = h('input', { type: 'search', placeholder, class: 'search-input', 'aria-label': 'جستجو' });
  input.addEventListener('input', () => onInput(input.value));
  return h('label', { class: 'search' }, icon('search', 18), input);
}

export function tabs(items, active, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  items.forEach((it) => {
    const b = h(
      'button',
      {
        class: 'tab' + (it.value === active ? ' active' : ''),
        role: 'tab',
        onclick: () => {
          wrap.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          onChange(it.value);
        },
      },
      it.label
    );
    wrap.append(b);
  });
  return wrap;
}

export function row({ title, subtitle, meta, leading, trailing, onclick, tone }) {
  const el = h(
    onclick ? 'button' : 'div',
    { class: 'row' + (tone ? ' ' + tone : ''), onclick },
    leading ? h('div', { class: 'row-lead' }, leading) : null,
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), subtitle ? h('div', { class: 'row-sub' }, subtitle) : null),
    meta ? h('div', { class: 'row-meta' }, meta) : null,
    trailing || (onclick ? icon('chevron', 18) : null)
  );
  return el;
}

export function fab(onclick, label = 'افزودن') {
  return h('button', { class: 'fab', onclick, 'aria-label': label }, icon('plus', 26));
}

export function section(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...children);
}

export function kv(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
}

// ---------- تاریخ شمسی: روز / ماه / سال
export function jalaliDateInput(initialIso, { allowEmpty = true, yearsBack = 6, yearsForward = 4 } = {}) {
  const nowJ = (() => {
    const d = new Date();
    return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  })();
  const init = initialIso ? isoToJalaliParts(initialIso) : null;
  const dSel = h('select', { 'aria-label': 'روز' });
  const mSel = h('select', { 'aria-label': 'ماه' });
  const ySel = h('select', { 'aria-label': 'سال' });

  const addOpt = (sel, v, t) => sel.append(h('option', { value: v }, t));
  if (allowEmpty) {
    addOpt(dSel, '', 'روز');
    addOpt(mSel, '', 'ماه');
    addOpt(ySel, '', 'سال');
  }
  MONTHS.forEach((m, i) => addOpt(mSel, i + 1, m));
  const y0 = (init ? Math.min(init.jy, nowJ.jy) : nowJ.jy) - yearsBack;
  const y1 = (init ? Math.max(init.jy, nowJ.jy) : nowJ.jy) + yearsForward;
  for (let y = y0; y <= y1; y++) addOpt(ySel, y, toFaDigits(y));

  const fillDays = () => {
    const y = +ySel.value || nowJ.jy;
    const m = +mSel.value || 1;
    const max = daysInMonth(y, m);
    const cur = dSel.value;
    [...dSel.querySelectorAll('option')].forEach((o) => o.value && o.remove());
    for (let d = 1; d <= max; d++) addOpt(dSel, d, toFaDigits(d));
    dSel.value = cur && +cur <= max ? cur : allowEmpty ? '' : '1';
  };

  if (init) {
    ySel.value = init.jy;
    mSel.value = init.jm;
  } else if (!allowEmpty) {
    ySel.value = nowJ.jy;
    mSel.value = nowJ.jm;
  }
  fillDays();
  if (init) dSel.value = init.jd;
  else if (!allowEmpty) dSel.value = nowJ.jd;
  ySel.addEventListener('change', fillDays);
  mSel.addEventListener('change', fillDays);

  const el = h('div', { class: 'date-input' }, dSel, mSel, ySel);
  el.getValue = () => {
    if (!dSel.value || !mSel.value || !ySel.value) return '';
    const [y, m, d] = [+ySel.value, +mSel.value, +dSel.value];
    return isValidJalali(y, m, d) ? jalaliPartsToIso(y, m, d) : '';
  };
  el.isPartial = () => [dSel.value, mSel.value, ySel.value].some(Boolean) && !el.getValue();
  return el;
}

// ---------- کاهش اندازه‌ی تصویر (برای لوگو)
export function readImageDownscaled(file, maxSize = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('خواندن فایل ممکن نشد'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('فایل تصویر معتبر نیست'));
      img.onload = () => {
        const k = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- فرم‌ساز
// fields: [{name,label,type,required,options,placeholder,hint,dir,inputmode,validate,show,maxLength,rows}]
// type: text | tel | number | textarea | select | chips | choice | date | image
export function buildForm({ fields, values = {}, submitText = 'ذخیره', onSubmit, onCancel, extraActions = [] }) {
  const state = { ...values };
  const wrappers = {};
  const getters = {};
  const errs = {};

  const form = h('form', { class: 'form', novalidate: true });

  const refreshVisibility = () => {
    const cur = collect();
    for (const f of fields) {
      if (f.show) wrappers[f.name].hidden = !f.show(cur);
    }
  };

  function setErr(name, msg) {
    errs[name].textContent = msg || '';
    wrappers[name].classList.toggle('has-error', !!msg);
  }

  for (const f of fields) {
    const wrap = h('div', { class: 'field' + (f.type === 'textarea' ? ' wide' : '') });
    const label = h('label', { class: 'label' }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null);
    const err = h('div', { class: 'err' });
    errs[f.name] = err;
    let control;
    const init = state[f.name];

    if (f.type === 'textarea') {
      control = h('textarea', { rows: f.rows || 2, placeholder: f.placeholder || '' }, init ?? '');
      getters[f.name] = () => control.value.trim();
    } else if (f.type === 'select') {
      control = h('select');
      (f.options || []).forEach((o) => control.append(h('option', { value: o.value }, o.label)));
      control.value = init ?? (f.options && f.options[0] ? f.options[0].value : '');
      getters[f.name] = () => control.value;
    } else if (f.type === 'chips' || f.type === 'choice') {
      const multi = f.type === 'chips';
      let sel = multi ? new Set(init || []) : init ?? (f.options[0] && f.options[0].value);
      control = h('div', { class: 'chips' });
      const paint = () =>
        control.querySelectorAll('.chip').forEach((c) => {
          const on = multi ? sel.has(c.dataset.v) : sel === c.dataset.v;
          c.classList.toggle('on', on);
          c.setAttribute('aria-pressed', on);
        });
      f.options.forEach((o) =>
        control.append(
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              'data-v': o.value,
              onclick: () => {
                if (multi) sel.has(o.value) ? sel.delete(o.value) : sel.add(o.value);
                else sel = o.value;
                paint();
                refreshVisibility();
              },
            },
            o.label
          )
        )
      );
      paint();
      getters[f.name] = () => (multi ? [...sel] : sel);
    } else if (f.type === 'date') {
      control = jalaliDateInput(init, { allowEmpty: !f.required });
      getters[f.name] = () => control.getValue();
    } else if (f.type === 'image') {
      let data = init || '';
      const preview = h('div', { class: 'img-preview' });
      const paint = () => {
        preview.replaceChildren(
          data ? h('img', { src: data, alt: '' }) : h('span', { class: 'muted' }, 'تصویری انتخاب نشده'),
          data
            ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => ((data = ''), paint()) }, 'حذف تصویر')
            : null
        );
      };
      const file = h('input', { type: 'file', accept: 'image/*' });
      file.addEventListener('change', async () => {
        if (!file.files[0]) return;
        try {
          data = await readImageDownscaled(file.files[0]);
          paint();
        } catch (e) {
          setErr(f.name, e.message);
        }
      });
      paint();
      control = h('div', null, preview, file);
      getters[f.name] = () => data;
    } else {
      const numeric = f.type === 'number';
      control = h('input', {
        type: 'text',
        inputmode: f.inputmode || (numeric ? 'decimal' : f.type === 'tel' ? 'tel' : 'text'),
        placeholder: f.placeholder || '',
        maxlength: f.maxLength,
        dir: f.dir || (numeric || f.type === 'tel' ? 'ltr' : null),
        autocomplete: 'off',
        value: init === null || init === undefined ? '' : numeric ? toFaDigits(init) : init,
        class: numeric || f.type === 'tel' ? 'ltr-text' : '',
      });
      getters[f.name] = () => (numeric ? parseNumber(control.value) : control.value.trim());
      if (numeric) control.addEventListener('blur', () => {
        const n = parseNumber(control.value);
        if (n !== null) control.value = toFaDigits(String(n));
      });
    }

    if (f.type !== 'date' && f.type !== 'image' && f.type !== 'chips' && f.type !== 'choice') {
      control.addEventListener('input', refreshVisibility);
      control.addEventListener('change', refreshVisibility);
    }
    append(wrap, [label, control, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err]);
    wrappers[f.name] = wrap;
    form.append(wrap);
  }

  function collect() {
    const out = {};
    for (const f of fields) out[f.name] = getters[f.name]();
    return out;
  }

  function validate() {
    const vals = collect();
    let ok = true;
    for (const f of fields) {
      setErr(f.name, '');
      if (f.show && !f.show(vals)) continue;
      const v = vals[f.name];
      const empty = v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length);
      let msg = '';
      if (f.required && empty) msg = 'این فیلد الزامی است';
      else if (f.type === 'number' && !empty && Number.isNaN(v)) msg = 'عدد معتبر وارد کنید';
      else if (f.type === 'number' && f.min !== undefined && !empty && v < f.min) msg = `حداقل مقدار ${formatNumber(f.min)} است`;
      else if (f.validate && !empty) msg = f.validate(v, vals) || '';
      if (f.type === 'date' && wrappers[f.name].querySelector('.date-input').isPartial()) msg = 'تاریخ ناقص یا نامعتبر است';
      if (msg) {
        setErr(f.name, msg);
        ok = false;
      }
    }
    return ok ? vals : null;
  }

  const actions = h(
    'div',
    { class: 'btn-row sticky-actions' },
    h('button', { type: 'submit', class: 'btn primary' }, submitText),
    onCancel ? h('button', { type: 'button', class: 'btn ghost', onclick: onCancel }, 'انصراف') : null,
    ...extraActions
  );
  form.append(actions);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = validate();
    if (!vals) {
      const first = form.querySelector('.has-error');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const btn = actions.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(vals, { setError: setErr });
    } finally {
      btn.disabled = false;
    }
  });
  refreshVisibility();
  form.get = collect;
  form.setError = setErr;
  return form;
}

export { h, append };

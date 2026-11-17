// ماژول کالاها: ورق، چسب، نوار چسب، سینی... با دسته‌بندی درختی (هر عمقی)
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { registerModule, getExtensions } from '../../core/registry.js';
import { matches, toFaDigits } from '../../core/util.js';
import { KINDS, UNITS, kindInfo, unitLabel, hasDims, dimsText, suggestName } from './model.js';
import { flatten, descendantIds, pathNames, wouldCycle } from './tree.js';

const ITEMS = 'products';
const CATS = 'categories';

const indent = (depth, name) => ' '.repeat(depth) + (depth ? '↳ ' : '') + name;

function categoryOptions(cats, { exclude = new Set(), rootLabel = 'بدون دسته‌بندی' } = {}) {
  return [
    { value: '', label: rootLabel },
    ...flatten(cats)
      .filter(({ cat }) => !exclude.has(cat.id))
      .map(({ cat, depth }) => ({ value: cat.id, label: indent(depth, cat.name) })),
  ];
}

// ---------------------------------------------------------------- فهرست
async function listPage(ctx) {
  ctx.setTitle('کالاها');
  ctx.setBack(null);
  let tab = ctx.query.tab === 'categories' ? 'categories' : 'items';
  const host = h('div');
  const tabBar = tabs(
    [
      { value: 'items', label: 'کالاها' },
      { value: 'categories', label: 'دسته‌بندی‌ها' },
    ],
    tab,
    (v) => {
      tab = v;
      draw();
    }
  );
  let fabEl = null;

  async function draw() {
    const cats = await ctx.db.table(CATS).list();
    const items = await ctx.db.table(ITEMS).list();
    host.replaceChildren();
    if (fabEl) fabEl.remove();
    if (tab === 'items') {
      fabEl = fab(() => ctx.go('/products/new'), 'کالای جدید');
      host.append(itemsView(ctx, items, cats));
    } else {
      fabEl = fab(() => categoryForm(ctx, null, '', draw), 'دسته‌بندی جدید');
      host.append(categoriesView(ctx, items, cats, draw));
    }
    ctx.el.append(fabEl);
  }
  ctx.el.append(tabBar, host);
  await draw();
}

function itemsView(ctx, items, cats) {
  let q = '';
  let catId = '';
  let kind = '';
  const listEl = h('div', { class: 'list' });
  const catSel = h(
    'select',
    { class: 'filter-select', 'aria-label': 'فیلتر دسته‌بندی', onchange: () => ((catId = catSel.value), paint()) },
    ...categoryOptions(cats, { rootLabel: 'همه‌ی دسته‌بندی‌ها' }).map((o) => h('option', { value: o.value }, o.label))
  );
  const kindTabs = tabs([{ value: '', label: 'همه' }, ...KINDS.map((k) => ({ value: k.value, label: k.label }))], '', (v) => ((kind = v), paint()));

  function paint() {
    const ids = catId ? descendantIds(cats, catId) : null;
    const shown = items
      .filter((p) => (kind ? p.kind === kind : true))
      .filter((p) => (ids ? ids.has(p.categoryId) : true))
      .filter((p) => matches([p.name, p.code, dimsText(p), pathNames(cats, p.categoryId)], q))
      .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    listEl.replaceChildren(
      ...(shown.length
        ? shown.map((p) =>
            row({
              leading: icon('box'),
              title: p.name,
              subtitle: [p.code, p.categoryId && pathNames(cats, p.categoryId)].filter(Boolean).join(' · '),
              meta: h('div', null, badge(kindInfo(p.kind).label), badge(unitLabel(p.unit), 'code')),
              onclick: () => ctx.go(`/products/${p.id}`),
            })
          )
        : [
            emptyState(
              'box',
              items.length ? 'موردی پیدا نشد' : 'هنوز کالایی ثبت نشده است',
              items.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/products/new') }, 'افزودن اولین کالا')
            ),
          ])
    );
  }
  paint();
  return h(
    'div',
    null,
    searchBar((v) => ((q = v), paint()), 'جستجوی نام، کد، ابعاد...'),
    kindTabs,
    h(
      'div',
      { class: 'filter-row' },
      catSel,
      h('button', { class: 'btn ghost small', onclick: () => categoryForm(ctx, null, '', () => ctx.refresh()) }, '＋ دسته‌بندی جدید')
    ),
    listEl
  );
}

// ---------------------------------------------------------------- دسته‌بندی‌ها
function categoriesView(ctx, items, cats, redraw) {
  if (!cats.length)
    return emptyState('folder', 'هنوز دسته‌بندی‌ای ساخته نشده است. مثلاً «ورق مقوا» و زیر آن «سه میل».', h('button', { class: 'btn primary', onclick: () => categoryForm(ctx, null, '', redraw) }, 'ساخت دسته‌بندی'));
  const countItems = (id) => items.filter((p) => p.categoryId === id).length;
  const list = h('div', { class: 'list' });
  for (const { cat, depth } of flatten(cats)) {
    const n = countItems(cat.id);
    list.append(
      h(
        'div',
        { style: { marginRight: `${depth * 18}px` } },
        row({
          leading: icon('folder'),
          title: cat.name,
          subtitle: cat.note || '',
          meta: n ? `${toFaDigits(n)} کالا` : '',
          trailing: h(
            'span',
            { style: { display: 'flex' } },
            h('button', { class: 'icon-btn', 'aria-label': 'زیردسته', onclick: () => categoryForm(ctx, null, cat.id, redraw) }, icon('plus', 20)),
            h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => categoryForm(ctx, cat, cat.parentId || '', redraw) }, icon('edit', 20)),
            h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeCategory(ctx, cat, redraw) }, icon('trash', 20))
          ),
        })
      )
    );
  }
  return list;
}

async function categoryForm(ctx, cat, parentId, redraw) {
  const t = ctx.db.table(CATS);
  const cats = await t.list();
  const exclude = cat ? descendantIds(cats, cat.id) : new Set();
  let s;
  const form = buildForm({
    values: cat || { parentId },
    submitText: cat ? 'ذخیره' : 'افزودن',
    onCancel: () => s.close(),
    fields: [
      { name: 'name', label: 'نام دسته‌بندی', required: true },
      { name: 'parentId', label: 'زیرمجموعه‌ی', type: 'select', options: categoryOptions(cats, { exclude, rootLabel: '— دسته‌ی اصلی —' }) },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (cat && wouldCycle(cats, cat.id, v.parentId)) return setError('parentId', 'نمیشه دسته را زیر خودش یا زیرمجموعه‌اش گذاشت');
      const dup = cats.find((c) => c.id !== (cat && cat.id) && (c.parentId || '') === (v.parentId || '') && c.name === v.name);
      if (dup) return setError('name', 'در همین سطح دسته‌ای با این نام هست');
      const rec = cat ? await t.update(cat.id, v) : await t.create(v);
      s.close();
      toast(cat ? 'ذخیره شد' : 'دسته‌بندی اضافه شد');
      redraw(rec);
    },
  });
  s = sheet({ title: cat ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید', body: form });
}

async function removeCategory(ctx, cat, redraw) {
  const cats = await ctx.db.table(CATS).list();
  const items = await ctx.db.table(ITEMS).list();
  const children = cats.filter((c) => c.parentId === cat.id);
  const mine = items.filter((p) => p.categoryId === cat.id);
  if (!children.length && !mine.length) {
    if (await confirmDialog(`دسته‌بندی «${cat.name}» حذف شود؟`, { danger: true, okText: 'حذف', title: 'حذف دسته‌بندی' })) {
      await ctx.db.table(CATS).remove(cat.id);
      toast('حذف شد');
      redraw();
    }
    return;
  }
  // دارای زیردسته یا کالا: اول باید منتقل شن
  const exclude = descendantIds(cats, cat.id);
  let s;
  const sel = h(
    'select',
    { class: 'filter-select' },
    ...categoryOptions(cats, { exclude, rootLabel: '— دسته‌ی اصلی (بدون دسته) —' }).map((o) => h('option', { value: o.value }, o.label))
  );
  s = sheet({
    title: 'حذف دسته‌بندی',
    body: [
      h('p', { class: 'confirm-msg' }, `«${cat.name}» ${toFaDigits(children.length)} زیردسته و ${toFaDigits(mine.length)} کالا دارد. آن‌ها به این دسته منتقل شوند:`),
      h('div', { class: 'form' }, sel),
      h(
        'div',
        { class: 'btn-row pad-top' },
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              const target = sel.value;
              for (const c of children) await ctx.db.table(CATS).update(c.id, { parentId: target });
              for (const p of mine) await ctx.db.table(ITEMS).update(p.id, { categoryId: target });
              await ctx.db.table(CATS).remove(cat.id);
              s.close();
              toast('منتقل و حذف شد');
              redraw();
            },
          },
          'انتقال و حذف'
        ),
        h('button', { class: 'btn ghost', onclick: () => s.close() }, 'انصراف')
      ),
    ],
  });
}

// ---------------------------------------------------------------- جزئیات
async function detailPage(ctx) {
  const p = await ctx.db.table(ITEMS).get(ctx.params.id);
  ctx.setBack('/products');
  if (!p || p.deletedAt) {
    ctx.setTitle('کالا');
    ctx.el.append(emptyState('box', 'این کالا پیدا نشد'));
    return;
  }
  const cats = await ctx.db.table(CATS).list();
  ctx.setTitle(p.name);
  ctx.setActions([
    h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/products/${p.id}/edit`) }, icon('edit')),
    h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeItem(ctx, p) }, icon('trash')),
  ]);
  ctx.el.append(
    section(
      null,
      h('div', null, badge(kindInfo(p.kind).label), badge(p.code, 'code')),
      kv('دسته‌بندی', p.categoryId ? pathNames(cats, p.categoryId) : ''),
      kv('واحد', unitLabel(p.unit)),
      kv('حداقل موجودی', p.minStock ? toFaDigits(p.minStock) : ''),
      kv('طول (سانتی‌متر)', p.length ? toFaDigits(p.length) : ''),
      kv('عرض (سانتی‌متر)', p.width ? toFaDigits(p.width) : ''),
      kv('توضیحات', p.note)
    )
  );
  for (const ext of getExtensions('product.detail')) {
    const node = await ext(ctx, p);
    if (node) ctx.el.append(node);
  }
}

async function removeItem(ctx, p) {
  for (const guard of getExtensions('product.deleteGuard')) {
    const reason = await guard(ctx.db, p);
    if (reason) {
      await confirmDialog(reason, { title: 'حذف ممکن نیست', okText: 'متوجه شدم', cancelText: 'بستن' });
      return;
    }
  }
  if (!(await confirmDialog(`«${p.name}» حذف شود؟`, { danger: true, okText: 'حذف', title: 'حذف کالا' }))) return;
  await ctx.db.table(ITEMS).remove(p.id);
  toast('حذف شد');
  ctx.go('/products');
}

// ---------------------------------------------------------------- فرم
async function formPage(ctx) {
  const editing = !!ctx.params.id;
  const t = ctx.db.table(ITEMS);
  const existing = editing ? await t.get(ctx.params.id) : null;
  ctx.setBack(editing ? `/products/${ctx.params.id}` : '/products');
  if (editing && (!existing || existing.deletedAt)) {
    ctx.el.append(emptyState('box', 'این کالا پیدا نشد'));
    return;
  }
  ctx.setTitle(editing ? 'ویرایش کالا' : 'کالای جدید');
  const cats = await ctx.db.table(CATS).list();

  const form = buildForm({
    values: existing || { kind: 'sheet', unit: 'kg' },
    submitText: editing ? 'ذخیره تغییرات' : 'افزودن',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'kind', label: 'نوع کالا', type: 'choice', options: KINDS.map((k) => ({ value: k.value, label: k.label })) },
      { name: 'length', label: 'طول (سانتی‌متر)', type: 'number', min: 0, show: (v) => hasDims(v.kind) },
      { name: 'width', label: 'عرض (سانتی‌متر)', type: 'number', min: 0, show: (v) => hasDims(v.kind) },
      { name: 'name', label: 'نام کالا', hint: 'برای ورق و سینی اگر خالی بگذارید از روی ابعاد ساخته میشود (مثلاً «سینی ۲۰×۳۰»).' },
      { name: 'unit', label: 'واحد اصلی', type: 'select', options: UNITS },
      { name: 'categoryId', label: 'دسته‌بندی', type: 'select', options: categoryOptions(cats) },
      { name: 'minStock', label: 'حداقل موجودی (برای هشدار)', type: 'number', min: 0, hint: 'اگر موجودی از این مقدار کمتر شد در صفحه‌ی خانه هشدار میدهد. خالی = بدون هشدار.' },
      { name: 'code', label: 'کد کالا', dir: 'ltr', placeholder: 'خودکار ساخته میشود', hint: 'اگر خالی بگذارید خودکار ساخته میشود؛ قابل ویرایش است.' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      const data = { ...v };
      if (!hasDims(data.kind)) {
        data.length = null;
        data.width = null;
      }
      if (!data.name) data.name = suggestName(data.kind, data.length, data.width);
      if (!data.name) return setError('name', 'نام را وارد کنید (یا برای ورق و سینی طول و عرض را بنویسید)');
      if (data.code && (await t.codeTaken(data.code, existing && existing.id))) return setError('code', 'این کد قبلاً استفاده شده است');
      if (editing) {
        if (!data.code) data.code = existing.code;
        await t.update(existing.id, data);
        toast('ذخیره شد');
        ctx.go(`/products/${existing.id}`, { replace: true });
      } else {
        const rec = await t.create(data, { prefix: 'G' });
        toast('کالا اضافه شد');
        ctx.go(`/products/${rec.id}`, { replace: true });
      }
    },
  });

  // افزودن سریع دسته‌بندی از داخل همین فرم
  const catSelect = form.control('categoryId');
  form.wrapper('categoryId').append(
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost small',
        style: { marginTop: '6px' },
        onclick: () =>
          categoryForm(ctx, null, '', async (rec) => {
            if (!rec || !rec.id) return;
            const fresh = await ctx.db.table(CATS).list();
            catSelect.replaceChildren(...categoryOptions(fresh).map((o) => h('option', { value: o.value }, o.label)));
            catSelect.value = rec.id;
          }),
      },
      '＋ دسته‌بندی جدید'
    )
  );

  // با عوض شدن نوع، واحد پیشنهادی هم عوض بشه (فقط برای کالای جدید)
  if (!editing) {
    const unitSel = form.querySelector('select');
    form.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const kind = chip.dataset.v;
        const target = [...form.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'kg'));
        if (target) target.value = kindInfo(kind).unit;
      })
    );
    void unitSel;
  }
  ctx.el.append(form);
}

export function registerProducts() {
  registerModule({
    id: 'products',
    title: 'کالاها',
    tables: [ITEMS, CATS],
    tableLabels: { products: 'کالاها', categories: 'دسته‌بندی‌ها' },
    fieldLabels: { minStock: 'حداقل موجودی', kind: 'نوع', unit: 'واحد', length: 'طول', width: 'عرض', categoryId: 'دسته‌بندی', parentId: 'زیرمجموعه‌ی', name: 'نام' },
    nav: { order: 30, label: 'کالاها', icon: 'box', path: '/products' },
    home: {
      order: 30,
      label: 'کالاها',
      icon: 'box',
      path: '/products',
      count: async (db) => `${toFaDigits((await db.table(ITEMS).list()).length)} قلم`,
    },
    routes: [
      { path: '/products', render: listPage },
      { path: '/products/new', render: formPage },
      { path: '/products/:id/edit', render: formPage },
      { path: '/products/:id', render: detailPage },
    ],
  });
}

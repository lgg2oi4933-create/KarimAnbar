// ماژول نیروی انسانی: نیروها، حضور و غیاب، مرخصی، دستمزد و پرداخت حقوق.
// کاملاً مستقل از حساب‌های مالی (اشخاص، فاکتور، چک)؛ فقط برای مدیر.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, buildForm, confirmDialog, emptyState, fab, kv, row, searchBar, section, sheet, tabs, toast } from '../../ui/components.js';
import { exportDoc } from '../../ui/exporter.js';
import { registerModule } from '../../core/registry.js';
import { matches, toFaDigits, formatMoney, formatNumber } from '../../core/util.js';
import { formatJalali, todayIso, weekdayName, addDaysIso, MONTHS, isoToJalaliParts } from '../../core/jalali.js';
import { isAdmin } from '../auth/index.js';
import { getCompany } from '../settings/index.js';
import { empName, monthRange, summarize, totalBalance, ALL_FROM, ALL_TO } from './calc.js';

const TE = 'hr_employees';
const TA = 'hr_attendance';
const TL = 'hr_leaves';
const TP = 'hr_payments';

const hrs = (n) => toFaDigits(String(Math.round((Number(n) || 0) * 100) / 100));
const guard = (fn) => (ctx) => {
  if (isAdmin(ctx.user)) return fn(ctx);
  ctx.setBack('/more');
  ctx.el.append(emptyState('user', 'این بخش فقط برای مدیر است'));
};

async function loadAll(db) {
  const [employees, attendance, leaves, payments] = await Promise.all([db.table(TE).list(), db.table(TA).list(), db.table(TL).list(), db.table(TP).list()]);
  return { employees: employees.sort((a, b) => empName(a).localeCompare(empName(b), 'fa')), attendance, leaves, payments };
}
const byId = (list) => new Map(list.map((x) => [x.id, x]));

// ---------------------------------------------------------------- صفحه‌ی اصلی
async function hubPage(ctx) {
  ctx.setTitle('نیروی انسانی');
  ctx.setBack('/more');
  const { employees, attendance } = await loadAll(ctx.db);
  const today = todayIso();
  const active = employees.filter((e) => e.status !== 'inactive');
  const rec = attendance.filter((a) => a.date === today);
  const present = rec.filter((a) => a.status !== 'absent').length;
  const absent = rec.filter((a) => a.status === 'absent').length;
  ctx.el.append(
    section(
      `امروز ${weekdayName(today)} ${formatJalali(today)}`,
      h(
        'div',
        { class: 'split' },
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'حاضر'), h('b', null, toFaDigits(present))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'غایب'), h('b', null, toFaDigits(absent)))
      ),
      h('p', { class: 'muted' }, `${toFaDigits(Math.max(0, active.length - rec.length))} نفر از ${toFaDigits(active.length)} نیروی فعال هنوز ثبت نشده‌اند.`)
    ),
    h(
      'div',
      { class: 'list' },
      row({ leading: icon('users'), title: 'نیروها', subtitle: `${toFaDigits(employees.length)} نفر · مشخصات و دستمزد`, onclick: () => ctx.go('/hr/employees') }),
      row({ leading: icon('check'), title: 'حضور و غیاب', subtitle: 'ثبت ساعت کار و اضافه‌کاری', onclick: () => ctx.go('/hr/attendance') }),
      row({ leading: icon('folder'), title: 'مرخصی‌ها', subtitle: 'روزانه یا ساعتی', onclick: () => ctx.go('/hr/leaves') }),
      row({ leading: icon('activity'), title: 'حقوق و گزارش‌ها', subtitle: 'محاسبه‌ی حقوق، حضور، مرخصی و مانده', onclick: () => ctx.go('/hr/report') }),
      row({ leading: icon('box'), title: 'پرداخت‌های حقوق', subtitle: 'فهرست پرداخت‌ها با بازه‌ی زمانی', onclick: () => ctx.go('/hr/payments') })
    )
  );
}

// ---------------------------------------------------------------- نیروها
async function employeesPage(ctx) {
  ctx.setTitle('نیروها');
  ctx.setBack('/hr');
  const all = (await ctx.db.table(TE).list()).sort((a, b) => empName(a).localeCompare(empName(b), 'fa'));
  let st = 'active';
  let q = '';
  const listEl = h('div', { class: 'list' });
  const paint = () => {
    const items = all.filter((e) => (st === 'all' ? true : st === 'inactive' ? e.status === 'inactive' : e.status !== 'inactive')).filter((e) => matches([empName(e), e.mobile, e.position, e.code], q));
    listEl.replaceChildren(
      ...(items.length
        ? items.map((e) =>
            row({
              leading: icon('user'),
              title: empName(e),
              subtitle: [e.position, e.code].filter(Boolean).join(' · '),
              meta: e.status === 'inactive' ? badge('غیرفعال') : h('small', { class: 'muted' }, `${formatMoney(e.normalRate || 0)} در ساعت`),
              onclick: () => ctx.go(`/hr/employees/${e.id}`),
            })
          )
        : [emptyState('users', all.length ? 'موردی پیدا نشد' : 'هنوز نیرویی تعریف نشده است', all.length ? null : h('button', { class: 'btn primary', onclick: () => ctx.go('/hr/employees/new') }, 'افزودن اولین نیرو'))])
    );
  };
  ctx.el.append(
    searchBar((v) => ((q = v), paint()), 'جستجوی نام، سمت یا موبایل...'),
    tabs([{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }, { value: 'all', label: 'همه' }], st, (v) => ((st = v), paint())),
    listEl,
    fab(() => ctx.go('/hr/employees/new'), 'نیروی جدید')
  );
  paint();
}

async function employeeForm(ctx) {
  const editing = !!ctx.params.id;
  const t = ctx.db.table(TE);
  const existing = editing ? await t.get(ctx.params.id) : null;
  if (editing && (!existing || existing.deletedAt)) return void ctx.el.append(emptyState('users', 'این نیرو پیدا نشد'));
  ctx.setTitle(editing ? 'ویرایش نیرو' : 'نیروی جدید');
  ctx.setBack(editing ? `/hr/employees/${existing.id}` : '/hr/employees');
  const form = buildForm({
    values: { status: 'active', dailyHours: 8, ...(existing || {}) },
    submitText: editing ? 'ذخیره تغییرات' : 'افزودن',
    onCancel: () => ctx.back(),
    fields: [
      { name: 'firstName', label: 'نام', required: true },
      { name: 'lastName', label: 'نام خانوادگی' },
      { name: 'position', label: 'سمت / واحد کاری' },
      { name: 'mobile', label: 'موبایل', type: 'tel' },
      { name: 'nationalId', label: 'کد ملی', type: 'tel', maxLength: 10 },
      { name: 'startDate', label: 'تاریخ شروع به کار', type: 'date' },
      { name: 'normalRate', label: 'دستمزد ساعت عادی (ریال)', type: 'number', money: true, min: 0, required: true },
      { name: 'overtimeRate', label: 'دستمزد ساعت اضافه‌کاری (ریال)', type: 'number', money: true, min: 0, required: true, hint: 'جدا از ساعت عادی تعیین میشود.' },
      { name: 'dailyHours', label: 'ساعت کار عادی در روز', type: 'number', min: 0, hint: 'پیش‌فرض ثبت حضور و محاسبه‌ی مرخصی روزانه با حقوق.' },
      { name: 'status', label: 'وضعیت', type: 'choice', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }] },
      { name: 'address', label: 'آدرس', type: 'textarea' },
      { name: 'code', label: 'کد نیرو', dir: 'ltr', placeholder: 'خودکار ساخته میشود', hint: 'اگر خالی بگذارید خودکار ساخته میشود؛ قابل ویرایش است.' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (v.code && (await t.codeTaken(v.code, existing && existing.id))) return setError('code', 'این کد قبلاً استفاده شده است');
      if (editing) {
        if (!v.code) v.code = existing.code;
        await t.update(existing.id, v);
        toast('ذخیره شد');
        ctx.go(`/hr/employees/${existing.id}`, { replace: true });
      } else {
        const rec = await t.create(v, { prefix: 'E' });
        toast('نیرو اضافه شد');
        ctx.go(`/hr/employees/${rec.id}`, { replace: true });
      }
    },
  });
  ctx.el.append(form);
}

async function removeEmployee(ctx, e) {
  const ok = await confirmDialog(`«${empName(e)}» با همه‌ی حضور و غیاب، مرخصی و پرداخت‌هایش حذف شود؟ (برای نگه‌داشتن سابقه، به‌جای حذف او را «غیرفعال» کنید.)`, { danger: true, okText: 'حذف', title: 'حذف نیرو' });
  if (!ok) return;
  for (const tn of [TA, TL, TP]) for (const r of await ctx.db.table(tn).list()) if (r.employeeId === e.id) await ctx.db.table(tn).remove(r.id);
  await ctx.db.table(TE).remove(e.id);
  toast('حذف شد');
  ctx.go('/hr/employees');
}

async function employeeDetail(ctx) {
  const e = await ctx.db.table(TE).get(ctx.params.id);
  ctx.setBack('/hr/employees');
  if (!e || e.deletedAt) return void ctx.el.append(emptyState('users', 'این نیرو پیدا نشد'));
  ctx.setTitle(empName(e));
  ctx.setActions([
    h('button', { class: 'icon-btn', 'aria-label': 'ویرایش', onclick: () => ctx.go(`/hr/employees/${e.id}/edit`) }, icon('edit')),
    h('button', { class: 'icon-btn danger', 'aria-label': 'حذف', onclick: () => removeEmployee(ctx, e) }, icon('trash')),
  ]);
  const data = await loadAll(ctx.db);
  const m = monthRange(todayIso());
  const s = summarize(e, data, m.from, m.to);
  const tb = totalBalance(e, data);
  const myLeaves = data.leaves.filter((l) => l.employeeId === e.id).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 5);
  const myPays = data.payments.filter((p) => p.employeeId === e.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  ctx.el.append(
    section(
      null,
      h('div', null, e.status === 'inactive' ? badge('غیرفعال') : badge('فعال', 'ok'), badge(e.code, 'code')),
      kv('سمت', e.position),
      kv('موبایل', e.mobile && h('a', { class: 'link', href: `tel:${e.mobile}`, dir: 'ltr' }, toFaDigits(e.mobile))),
      kv('کد ملی', e.nationalId && toFaDigits(e.nationalId)),
      kv('شروع به کار', e.startDate && formatJalali(e.startDate)),
      kv('دستمزد ساعت عادی', `${formatMoney(e.normalRate || 0)}`),
      kv('دستمزد ساعت اضافه‌کاری', `${formatMoney(e.overtimeRate || 0)}`),
      kv('ساعت کار روزانه', hrs(e.dailyHours || 8)),
      kv('آدرس', e.address),
      kv('توضیحات', e.note)
    ),
    section(
      `این ماه (${MONTHS[isoToJalaliParts(m.from).jm - 1]})`,
      kv('روز حضور / غیبت', `${hrs(s.presentDays)} / ${hrs(s.absentDays)}`),
      kv('ساعت عادی', hrs(s.normalHours)),
      kv('ساعت اضافه‌کاری', hrs(s.overtimeHours)),
      kv('مرخصی', `${hrs(s.leaveDays)} روز و ${hrs(s.leaveHours)} ساعت`),
      kv('حقوق محاسبه‌شده', `${formatMoney(s.earned)}`)
    ),
    section(
      'حساب کل از ابتدا',
      kv('جمع حقوق محاسبه‌شده', `${formatMoney(tb.earned)}`),
      kv('جمع پرداخت‌ها', `${formatMoney(tb.paid)}`),
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, tb.remaining >= 0 ? 'مانده‌ی طلب نیرو از شما' : 'پیش‌پرداخت (بیشتر از حقوق)'), h('b', { class: tb.remaining > 0 ? 'amount-debit' : '' }, `${formatMoney(Math.abs(tb.remaining))}`))
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => ctx.go(`/hr/attendance?emp=${e.id}`) }, 'حضور و غیاب'),
      h('button', { class: 'btn ghost', onclick: () => leaveSheet(ctx, null, { employeeId: e.id }) }, 'ثبت مرخصی'),
      h('button', { class: 'btn ghost', onclick: () => paymentSheet(ctx, null, { employeeId: e.id, amount: tb.remaining > 0 ? tb.remaining : null, periodFrom: m.from, periodTo: m.to }) }, 'ثبت پرداخت')
    ),
    section(
      'آخرین مرخصی‌ها',
      myLeaves.length ? h('div', { class: 'list' }, myLeaves.map((l) => leaveRow(ctx, l, e))) : h('p', { class: 'muted' }, 'مرخصی‌ای ثبت نشده.')
    ),
    section(
      'آخرین پرداخت‌ها',
      myPays.length ? h('div', { class: 'list' }, myPays.map((p) => paymentRow(ctx, p, e))) : h('p', { class: 'muted' }, 'پرداختی ثبت نشده.')
    )
  );
}

// ---------------------------------------------------------------- حضور و غیاب
const attId = (empId, date) => `att_${empId}_${date}`;

async function attendancePage(ctx) {
  ctx.setTitle('حضور و غیاب');
  ctx.setBack('/hr');
  let date = ctx.query.date || todayIso();
  const out = h('div');
  const dateLabel = h('b');
  const { employees } = await loadAll(ctx.db);
  const active = employees.filter((e) => e.status !== 'inactive' && (!ctx.query.emp || e.id === ctx.query.emp));

  async function paint() {
    dateLabel.textContent = `${weekdayName(date)} ${formatJalali(date)}`;
    const [att, leaves] = await Promise.all([ctx.db.table(TA).list(), ctx.db.table(TL).list()]);
    const recById = new Map(att.filter((a) => a.date === date).map((a) => [a.employeeId, a]));
    const onLeave = (e) => leaves.find((l) => l.employeeId === e.id && l.type !== 'hourly' && l.startDate <= date && (l.endDate || l.startDate) >= date);
    const hourly = (e) => leaves.filter((l) => l.employeeId === e.id && l.type === 'hourly' && l.startDate === date).reduce((a, l) => a + (Number(l.hours) || 0), 0);
    const unrecorded = active.filter((e) => !recById.has(e.id) && !onLeave(e));
    out.replaceChildren(
      ...[unrecorded.length
        ? h('button', { class: 'btn ghost small', style: { marginBottom: '10px' }, onclick: async () => {
            for (const e of unrecorded) await saveAtt(ctx.db, e, date, { status: 'present', normalHours: Number(e.dailyHours) || 8, overtimeHours: 0 });
            toast('برای همه حاضر ثبت شد');
            paint();
          } }, `همه‌ی ثبت‌نشده‌ها حاضر (${toFaDigits(unrecorded.length)} نفر، ساعت پیش‌فرض)`)
        : null,
      h(
        'div',
        { class: 'list' },
        active.length
          ? active.map((e) => {
              const a = recById.get(e.id);
              const lv = onLeave(e);
              const hl = hourly(e);
              let meta;
              if (a) meta = a.status === 'absent' ? badge('غایب', 'danger') : h('div', null, badge('حاضر', 'ok'), h('small', { class: 'muted' }, ` ${hrs(a.normalHours)} ساعت${a.overtimeHours ? ` + ${hrs(a.overtimeHours)} اضافه` : ''}`));
              else if (lv) meta = badge('مرخصی', 'warn');
              else meta = h('small', { class: 'muted' }, 'ثبت نشده');
              return row({ leading: icon('user'), title: empName(e), subtitle: [e.position, hl ? `مرخصی ساعتی ${hrs(hl)} ساعت` : ''].filter(Boolean).join(' · '), meta, onclick: () => attSheet(ctx, e, date, a, paint) });
            })
          : [emptyState('users', 'نیروی فعالی نیست')]
      )
    ].filter(Boolean));
  }
  const go = (n) => { date = addDaysIso(date, n); paint(); };
  ctx.el.append(
    h(
      'div',
      { class: 'date-nav', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '4px 0 12px' } },
      h('button', { class: 'btn ghost small', onclick: () => go(-1) }, '‹ روز قبل'),
      h('button', { class: 'btn ghost small', onclick: () => dateSheet(date, (d) => { date = d; paint(); }) }, dateLabel),
      h('button', { class: 'btn ghost small', onclick: () => go(1) }, 'روز بعد ›')
    ),
    out
  );
  paint();
}

function dateSheet(date, onPick) {
  let s;
  const form = buildForm({
    values: { date },
    submitText: 'برو',
    onCancel: () => s.close(),
    fields: [{ name: 'date', label: 'تاریخ', type: 'date', required: true }],
    onSubmit: async (v) => { s.close(); onPick(v.date); },
  });
  s = sheet({ title: 'انتخاب روز', body: form });
}

async function saveAtt(db, e, date, data) {
  return db.table(TA).upsert(attId(e.id, date), { employeeId: e.id, date, note: '', ...data, deletedAt: null });
}

function attSheet(ctx, e, date, existing, done) {
  let s;
  const form = buildForm({
    values: existing || { status: 'present', normalHours: Number(e.dailyHours) || 8, overtimeHours: 0 },
    submitText: 'ثبت',
    onCancel: () => s.close(),
    extraActions: existing
      ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('ثبت این روز حذف شود؟', { danger: true, okText: 'حذف' }))) return;
          await ctx.db.table(TA).remove(existing.id);
          s.close();
          done();
        } }, 'حذف')]
      : [],
    fields: [
      { name: 'status', label: 'وضعیت', type: 'choice', options: [{ value: 'present', label: 'حاضر' }, { value: 'absent', label: 'غایب' }] },
      { name: 'normalHours', label: 'ساعت کار عادی', type: 'number', min: 0, show: (v) => v.status !== 'absent' },
      { name: 'overtimeHours', label: 'ساعت اضافه‌کاری', type: 'number', min: 0, show: (v) => v.status !== 'absent' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v) => {
      const absent = v.status === 'absent';
      await saveAtt(ctx.db, e, date, { status: v.status, normalHours: absent ? 0 : v.normalHours || 0, overtimeHours: absent ? 0 : v.overtimeHours || 0, note: v.note });
      s.close();
      toast('ثبت شد');
      done();
    },
  });
  s = sheet({ title: `${empName(e)} · ${formatJalali(date)}`, body: form });
}

// ---------------------------------------------------------------- مرخصی
const LEAVE_TYPES = [{ value: 'daily', label: 'روزانه' }, { value: 'hourly', label: 'ساعتی' }];

function leaveText(l) {
  if (l.type === 'hourly') return `${hrs(l.hours)} ساعت · ${formatJalali(l.startDate)}`;
  const e = l.endDate || l.startDate;
  return e === l.startDate ? `۱ روز · ${formatJalali(l.startDate)}` : `${formatJalali(l.startDate)} تا ${formatJalali(e)}`;
}
function leaveRow(ctx, l, emp, redraw) {
  return row({
    leading: icon('folder'),
    title: emp ? empName(emp) : '—',
    subtitle: `${leaveText(l)}${l.reason ? ' · ' + l.reason : ''}`,
    meta: h('div', null, badge(l.type === 'hourly' ? 'ساعتی' : 'روزانه'), l.paid ? badge('با حقوق', 'ok') : badge('بی‌حقوق')),
    onclick: () => leaveSheet(ctx, l, {}, redraw),
  });
}

async function leavesPage(ctx) {
  ctx.setTitle('مرخصی‌ها');
  ctx.setBack('/hr');
  const listEl = h('div', { class: 'list' });
  const paint = async () => {
    const [leaves, emps] = await Promise.all([ctx.db.table(TL).list(), ctx.db.table(TE).list()]);
    const m = byId(emps);
    const items = leaves.sort((a, b) => b.startDate.localeCompare(a.startDate));
    listEl.replaceChildren(...(items.length ? items.map((l) => leaveRow(ctx, l, m.get(l.employeeId), paint)) : [emptyState('folder', 'مرخصی‌ای ثبت نشده است')]));
  };
  ctx.el.append(listEl, fab(() => leaveSheet(ctx, null, {}, paint), 'ثبت مرخصی'));
  paint();
}

async function leaveSheet(ctx, existing, preset = {}, done) {
  const emps = (await ctx.db.table(TE).list()).filter((e) => e.status !== 'inactive' || (existing && existing.employeeId === e.id));
  if (!emps.length) return void toast('اول نیرو تعریف کنید', 'err');
  const redo = done || (() => ctx.refresh());
  let s;
  const form = buildForm({
    values: existing ? { ...existing, paidChoice: existing.paid ? 'yes' : 'no' } : { type: 'daily', startDate: todayIso(), paidChoice: 'no', ...preset },
    submitText: existing ? 'ذخیره' : 'ثبت مرخصی',
    onCancel: () => s.close(),
    extraActions: existing
      ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('این مرخصی حذف شود؟', { danger: true, okText: 'حذف' }))) return;
          await ctx.db.table(TL).remove(existing.id);
          s.close();
          toast('حذف شد');
          redo();
        } }, 'حذف')]
      : [],
    fields: [
      { name: 'employeeId', label: 'نیرو', type: 'select', required: true, options: [{ value: '', label: 'انتخاب کنید...' }, ...emps.map((e) => ({ value: e.id, label: empName(e) }))] },
      { name: 'type', label: 'نوع مرخصی', type: 'choice', options: LEAVE_TYPES },
      { name: 'startDate', label: 'تاریخ (شروع)', type: 'date', required: true },
      { name: 'endDate', label: 'تا تاریخ (اختیاری)', type: 'date', show: (v) => v.type !== 'hourly', hint: 'اگر خالی باشد یک روز است.' },
      { name: 'hours', label: 'تعداد ساعت', type: 'number', min: 0, show: (v) => v.type === 'hourly' },
      { name: 'paidChoice', label: 'حقوق', type: 'choice', options: [{ value: 'no', label: 'بی‌حقوق' }, { value: 'yes', label: 'با حقوق' }], hint: 'مرخصی با حقوق به‌اندازه‌ی ساعت عادی در حقوق حساب میشود.' },
      { name: 'reason', label: 'علت' },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (v.type === 'hourly' && !(v.hours > 0)) return setError('hours', 'تعداد ساعت را وارد کنید');
      if (v.type !== 'hourly' && v.endDate && v.endDate < v.startDate) return setError('endDate', 'تاریخ پایان قبل از شروع است');
      const data = { ...v, paid: v.paidChoice === 'yes', endDate: v.type === 'hourly' ? '' : v.endDate || '', hours: v.type === 'hourly' ? v.hours : null };
      delete data.paidChoice;
      if (existing) await ctx.db.table(TL).update(existing.id, data);
      else await ctx.db.table(TL).create(data, { prefix: 'LV' });
      s.close();
      toast('ثبت شد');
      redo();
    },
  });
  s = sheet({ title: existing ? 'ویرایش مرخصی' : 'ثبت مرخصی', body: form });
}

// ---------------------------------------------------------------- پرداخت
const PAY_KINDS = [{ value: 'salary', label: 'حقوق' }, { value: 'advance', label: 'مساعده' }, { value: 'bonus', label: 'پاداش / عیدی' }];
const PAY_METHODS = [{ value: 'cash', label: 'نقد' }, { value: 'transfer', label: 'واریز' }];
const labelIn = (list, v) => (list.find((x) => x.value === v) || { label: v }).label;

function paymentRow(ctx, p, emp, redraw) {
  return row({
    leading: icon('box'),
    title: `${emp ? empName(emp) : '—'} · ${formatMoney(p.amount)}`,
    subtitle: `${labelIn(PAY_KINDS, p.kind)} · برای ${formatJalali(p.periodFrom)} تا ${formatJalali(p.periodTo)} · پرداخت ${formatJalali(p.date)}`,
    meta: badge(p.code, 'code'),
    onclick: () => paymentSheet(ctx, p, {}, redraw),
  });
}

async function paymentsPage(ctx) {
  ctx.setTitle('پرداخت‌های حقوق');
  ctx.setBack('/hr');
  const listEl = h('div', { class: 'list' });
  const sum = h('b');
  const paint = async () => {
    const [pays, emps] = await Promise.all([ctx.db.table(TP).list(), ctx.db.table(TE).list({ includeDeleted: true })]);
    const m = byId(emps);
    const items = pays.sort((a, b) => b.date.localeCompare(a.date));
    sum.textContent = `${formatMoney(items.reduce((a, p) => a + (Number(p.amount) || 0), 0))}`;
    listEl.replaceChildren(...(items.length ? items.map((p) => paymentRow(ctx, p, m.get(p.employeeId), paint)) : [emptyState('box', 'پرداختی ثبت نشده است')]));
  };
  ctx.el.append(section(null, h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'جمع پرداخت‌ها'), sum)), listEl, fab(() => paymentSheet(ctx, null, {}, paint), 'ثبت پرداخت'));
  paint();
}

async function paymentSheet(ctx, existing, preset = {}, done) {
  const emps = (await ctx.db.table(TE).list()).filter((e) => e.status !== 'inactive' || (existing && existing.employeeId === e.id) || preset.employeeId === e.id);
  if (!emps.length) return void toast('اول نیرو تعریف کنید', 'err');
  const redo = done || (() => ctx.refresh());
  const m = monthRange(todayIso());
  let s;
  const form = buildForm({
    values: existing || { kind: 'salary', method: 'cash', date: todayIso(), periodFrom: m.from, periodTo: m.to, ...preset },
    submitText: existing ? 'ذخیره' : 'ثبت پرداخت',
    onCancel: () => s.close(),
    extraActions: existing
      ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('این پرداخت حذف شود؟', { danger: true, okText: 'حذف' }))) return;
          await ctx.db.table(TP).remove(existing.id);
          s.close();
          toast('حذف شد');
          redo();
        } }, 'حذف')]
      : [],
    fields: [
      { name: 'employeeId', label: 'نیرو', type: 'select', required: true, options: [{ value: '', label: 'انتخاب کنید...' }, ...emps.map((e) => ({ value: e.id, label: empName(e) }))] },
      { name: 'amount', label: 'مبلغ (ریال)', type: 'number', money: true, min: 1, required: true },
      { name: 'kind', label: 'نوع پرداخت', type: 'choice', options: PAY_KINDS },
      { name: 'periodFrom', label: 'بابت از تاریخ', type: 'date', required: true },
      { name: 'periodTo', label: 'بابت تا تاریخ', type: 'date', required: true },
      { name: 'date', label: 'تاریخ پرداخت', type: 'date', required: true },
      { name: 'method', label: 'روش', type: 'choice', options: PAY_METHODS },
      { name: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    onSubmit: async (v, { setError }) => {
      if (!(v.amount > 0)) return setError('amount', 'مبلغ را وارد کنید');
      if (v.periodTo < v.periodFrom) return setError('periodTo', 'پایان بازه قبل از شروع است');
      if (existing) await ctx.db.table(TP).update(existing.id, v);
      else await ctx.db.table(TP).create(v, { prefix: 'HP' });
      s.close();
      toast('ثبت شد');
      redo();
    },
  });
  s = sheet({ title: existing ? 'ویرایش پرداخت' : 'ثبت پرداخت حقوق', body: form });
}

// ---------------------------------------------------------------- حقوق و گزارش
async function reportPage(ctx) {
  ctx.setTitle('حقوق و گزارش‌ها');
  ctx.setBack('/hr');
  let { from, to } = monthRange(todayIso());
  const label = h('b');
  const out = h('div');
  let rowsData = [];

  const periodText = () => {
    const a = isoToJalaliParts(from);
    const mr = monthRange(from);
    return mr.from === from && mr.to === to ? `${MONTHS[a.jm - 1]} ${toFaDigits(a.jy)}` : `${formatJalali(from)} تا ${formatJalali(to)}`;
  };

  async function paint() {
    label.textContent = periodText();
    const data = await loadAll(ctx.db);
    rowsData = data.employees.map((e) => ({ e, s: summarize(e, data, from, to) })).filter(({ e, s }) => e.status !== 'inactive' || s.earned || s.paid || s.presentDays || s.leaveDays || s.leaveHours);
    const tot = rowsData.reduce((a, { s }) => ({ earned: a.earned + s.earned, paid: a.paid + s.paid, remaining: a.remaining + s.remaining }), { earned: 0, paid: 0, remaining: 0 });
    out.replaceChildren(
      section(
        null,
        h('div', { class: 'split' }, h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'جمع حقوق'), h('b', null, formatMoney(tot.earned))), h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'جمع پرداخت'), h('b', null, formatMoney(tot.paid)))),
        kv('مانده‌ی پرداخت‌نشده', `${formatMoney(tot.remaining)}`)
      ),
      h(
        'div',
        { class: 'list' },
        rowsData.length
          ? rowsData.map(({ e, s }) =>
              row({
                leading: icon('user'),
                title: empName(e),
                subtitle: `حضور ${hrs(s.presentDays)} روز · عادی ${hrs(s.normalHours)} · اضافه ${hrs(s.overtimeHours)} ساعت · مرخصی ${hrs(s.leaveDays)} روز ${hrs(s.leaveHours)} ساعت`,
                meta: h('div', null, h('div', null, `${formatMoney(s.earned)}`), h('small', { class: s.remaining > 0 ? 'amount-debit' : 'muted' }, `مانده ${formatMoney(s.remaining)}`)),
                onclick: () => breakdownSheet(e, s),
              })
            )
          : [emptyState('activity', 'در این بازه گردشی نیست')]
      )
    );
  }

  function breakdownSheet(e, s) {
    let sh;
    sh = sheet({
      title: empName(e),
      body: [
        h('p', { class: 'muted' }, periodText()),
        kv('روز حاضر / غایب', `${hrs(s.presentDays)} / ${hrs(s.absentDays)}`),
        kv('ساعت عادی', `${hrs(s.normalHours)} × ${formatMoney(e.normalRate || 0)} = ${formatMoney(s.normalPay)}`),
        kv('ساعت اضافه‌کاری', `${hrs(s.overtimeHours)} × ${formatMoney(e.overtimeRate || 0)} = ${formatMoney(s.overtimePay)}`),
        kv('مرخصی با حقوق', `${hrs(s.paidLeaveHours)} ساعت = ${formatMoney(s.leavePay)}`),
        kv('جمع حقوق', `${formatMoney(s.earned)}`),
        kv('پرداخت‌شده بابت این بازه', `${formatMoney(s.paid)}`),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'مانده'), h('b', null, `${formatMoney(s.remaining)}`)),
        h('div', { class: 'btn-row pad-top' },
          h('button', { class: 'btn primary', onclick: () => { sh.close(); paymentSheet(ctx, null, { employeeId: e.id, amount: s.remaining > 0 ? s.remaining : null, periodFrom: from, periodTo: to }, paint); } }, 'ثبت پرداخت'),
          h('button', { class: 'btn ghost', onclick: () => { sh.close(); ctx.go(`/hr/employees/${e.id}`); } }, 'پروفایل'))
      ],
    });
  }

  const setMonth = (off) => { const r = monthRange(from, off); from = r.from; to = r.to; paint(); };
  const customSheet = () => {
    let sh;
    const form = buildForm({
      values: { from, to },
      submitText: 'اعمال',
      onCancel: () => sh.close(),
      fields: [{ name: 'from', label: 'از تاریخ', type: 'date', required: true }, { name: 'to', label: 'تا تاریخ', type: 'date', required: true }],
      onSubmit: async (v, { setError }) => {
        if (v.to < v.from) return setError('to', 'پایان قبل از شروع است');
        from = v.from; to = v.to; sh.close(); paint();
      },
    });
    sh = sheet({ title: 'بازه‌ی دلخواه', body: form });
  };

  const exportReport = async (kind) => {
    try {
      const company = await getCompany(ctx.db);
      const f = (n) => formatNumber(n);
      const doc = {
        title: 'گزارش حضور و حقوق نیروها',
        company,
        meta: [['بازه', periodText()], ['تاریخ گزارش', formatJalali(todayIso())]],
        columns: [
          { label: 'نام', w: 0.2, align: 'right' },
          { label: 'روز', w: 0.07, align: 'center' },
          { label: 'عادی', w: 0.09, align: 'center' },
          { label: 'اضافه', w: 0.09, align: 'center' },
          { label: 'مرخصی', w: 0.1, align: 'center' },
          { label: 'حقوق', w: 0.15, align: 'left' },
          { label: 'پرداخت', w: 0.15, align: 'left' },
          { label: 'مانده', w: 0.15, align: 'left' },
        ],
        rows: rowsData.map(({ e, s }) => [empName(e), hrs(s.presentDays), hrs(s.normalHours), hrs(s.overtimeHours), `${hrs(s.leaveDays)}د ${hrs(s.leaveHours)}س`, f(s.earned), f(s.paid), f(s.remaining)]),
        totals: [
          ['جمع حقوق', f(rowsData.reduce((a, { s }) => a + s.earned, 0))],
          ['جمع پرداخت', f(rowsData.reduce((a, { s }) => a + s.paid, 0))],
          ['مانده (ریال)', f(rowsData.reduce((a, { s }) => a + s.remaining, 0)), { bold: true }],
        ],
        footer: '',
      };
      const r = await exportDoc(doc, kind, 'گزارش_نیروی_انسانی');
      if (r === 'downloaded') toast('فایل ذخیره شد');
    } catch (e) {
      console.error(e);
      toast('ساخت خروجی ناموفق بود: ' + e.message, 'err');
    }
  };

  ctx.el.append(
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '4px 0 8px' } },
      h('button', { class: 'btn ghost small', onclick: () => setMonth(-1) }, '‹ ماه قبل'), label, h('button', { class: 'btn ghost small', onclick: () => setMonth(1) }, 'ماه بعد ›')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost small', onclick: customSheet }, 'بازه‌ی دلخواه'),
      h('button', { class: 'btn ghost small', onclick: () => exportReport('png') }, 'تصویر'),
      h('button', { class: 'btn ghost small', onclick: () => exportReport('pdf') }, 'PDF')),
    h('div', { class: 'pad-top' }, out)
  );
  paint();
}

export function registerHr() {
  registerModule({
    id: 'hr',
    title: 'نیروی انسانی',
    tables: [TE, TA, TL, TP],
    tableLabels: { [TE]: 'نیروها', [TA]: 'حضور و غیاب', [TL]: 'مرخصی‌ها', [TP]: 'پرداخت حقوق' },
    fieldLabels: {
      position: 'سمت', normalRate: 'دستمزد ساعت عادی', overtimeRate: 'دستمزد اضافه‌کاری', dailyHours: 'ساعت کار روزانه', status: 'وضعیت', startDate: 'تاریخ شروع',
      normalHours: 'ساعت عادی', overtimeHours: 'ساعت اضافه‌کاری', hours: 'ساعت', paid: 'با حقوق', reason: 'علت', endDate: 'تا تاریخ', kind: 'نوع', periodFrom: 'بابت از', periodTo: 'بابت تا', employeeId: 'نیرو',
    },
    more: { order: 5, label: 'نیروی انسانی', desc: 'حضور و غیاب، مرخصی، دستمزد و حقوق', icon: 'users', path: '/hr', adminOnly: true },
    routes: [
      { path: '/hr', render: guard(hubPage) },
      { path: '/hr/employees', render: guard(employeesPage) },
      { path: '/hr/employees/new', render: guard(employeeForm) },
      { path: '/hr/employees/:id/edit', render: guard(employeeForm) },
      { path: '/hr/employees/:id', render: guard(employeeDetail) },
      { path: '/hr/attendance', render: guard(attendancePage) },
      { path: '/hr/leaves', render: guard(leavesPage) },
      { path: '/hr/payments', render: guard(paymentsPage) },
      { path: '/hr/report', render: guard(reportPage) },
    ],
  });
}

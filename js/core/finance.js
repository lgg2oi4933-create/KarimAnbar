// منطق مالی خالص (بدون رابط کاربری): جمع فاکتور، اثر پرداخت‌ها و دفتر حساب.
// فاکتور، دریافت/پرداخت، چک و صورت‌حساب همه از همین‌جا استفاده میکنن تا یک عدد در همه‌جا یکسان باشه.

export function lineAmount(l) {
  return Math.round((Number(l.qty) || 0) * (Number(l.price) || 0));
}

export function invoiceTotals(inv) {
  const subtotal = (inv.lines || []).reduce((a, l) => a + lineAmount(l), 0);
  const discount = Math.min(Math.max(Number(inv.discount) || 0, 0), subtotal);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * (Number(inv.taxPercent) || 0)) / 100);
  return { subtotal, discount, taxable, tax, total: taxable + tax };
}

// پرداختی که چکش برگشت خورده اثری در حساب ندارد (برای دریافت، چک خرج‌شده‌ی برگشتی هم همین‌طور)
export function isPaymentEffective(p, checksById) {
  if (p.deletedAt) return false;
  if (p.checkId) {
    const c = checksById.get(p.checkId);
    if (c && !c.deletedAt && c.status === 'bounced') return false;
  }
  return true;
}

export function indexById(list) {
  return new Map(list.map((x) => [x.id, x]));
}

export function paidForInvoice(invoiceId, payments, checksById) {
  return payments
    .filter((p) => p.invoiceId === invoiceId && isPaymentEffective(p, checksById))
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

export function balanceLabel(balance) {
  if (balance > 0) return 'بدهکار';
  if (balance < 0) return 'بستانکار';
  return 'تسویه';
}

// بدهکار = طرف حساب به ما بدهکار است (مثبت). بستانکار = ما به او بدهکاریم (منفی).
// extras: ردیف‌های اضافی از ماژول‌های دیگر (مثلاً اجرت برون‌سپاری) به شکل {partyId,date,desc,debit,credit,refType,refId}
export function ledgerFor(party, invoices, payments, checks, extras = []) {
  const checksById = indexById(checks);
  const rows = [];

  const openAmt = Number(party.openingAmount) || 0;
  if (openAmt > 0 && (party.openingType === 'debtor' || party.openingType === 'creditor')) {
    rows.push({
      date: '0000-00-00',
      sort: '',
      kind: 'opening',
      desc: 'مانده اول دوره',
      debit: party.openingType === 'debtor' ? openAmt : 0,
      credit: party.openingType === 'creditor' ? openAmt : 0,
    });
  }

  for (const inv of invoices) {
    if (inv.deletedAt || inv.partyId !== party.id) continue;
    const { total } = invoiceTotals(inv);
    const sale = inv.type === 'sale';
    rows.push({
      date: inv.date,
      sort: inv.createdAt || '',
      kind: 'invoice',
      refType: 'invoice',
      refId: inv.id,
      desc: `${sale ? 'فاکتور فروش' : 'فاکتور خرید'} ${inv.code || ''}`.trim(),
      debit: sale ? total : 0,
      credit: sale ? 0 : total,
    });
  }

  for (const p of payments) {
    if (p.deletedAt || p.partyId !== party.id) continue;
    const incoming = p.direction === 'in';
    const effective = isPaymentEffective(p, checksById);
    const c = p.checkId ? checksById.get(p.checkId) : null;
    const how = p.kind === 'endorse' ? `خرج چک ${c ? c.number || '' : ''}` : p.method === 'check' ? `چک ${c ? c.number || '' : ''}` : p.method === 'transfer' ? 'حواله' : 'نقد';
    const amt = Number(p.amount) || 0;
    rows.push({
      date: p.date,
      sort: p.createdAt || '',
      kind: 'payment',
      refType: 'payment',
      refId: p.id,
      desc: `${incoming ? 'دریافت' : 'پرداخت'} ${how}${effective ? '' : ' (برگشتی، بی‌اثر)'}`.trim(),
      debit: effective && !incoming ? amt : 0,
      credit: effective && incoming ? amt : 0,
      ignored: !effective,
    });
  }

  for (const x of extras) {
    if (x.partyId !== party.id) continue;
    rows.push({ date: x.date, sort: x.sort || '', kind: 'extra', refType: x.refType, refId: x.refId, desc: x.desc, debit: Number(x.debit) || 0, credit: Number(x.credit) || 0 });
  }

  rows.sort((a, b) => (a.date === b.date ? (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0) : a.date < b.date ? -1 : 1));
  let balance = 0;
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    balance += r.debit - r.credit;
    debit += r.debit;
    credit += r.credit;
    r.balance = balance;
  }
  return { rows, debit, credit, balance };
}

// فقط سطرهای بازه‌ی تاریخ؛ مانده‌ی قبل از بازه به‌صورت یک سطر اول میاد
export function filterLedger(result, from, to) {
  if (!from && !to) return { ...result, shown: result.rows };
  let before = 0;
  const shown = [];
  for (const r of result.rows) {
    const d = r.date === '0000-00-00' ? '' : r.date;
    if (from && d < from) {
      before = r.balance;
      continue;
    }
    if (to && d > to) continue;
    shown.push(r);
  }
  if (from && before !== 0) {
    shown.unshift({ kind: 'carry', date: from, desc: 'مانده از قبل', debit: before > 0 ? before : 0, credit: before < 0 ? -before : 0, balance: before });
  }
  return { ...result, shown };
}

export function allBalances(parties, invoices, payments, checks, extras = []) {
  const out = new Map();
  for (const p of parties) if (!p.deletedAt) out.set(p.id, ledgerFor(p, invoices, payments, checks, extras).balance);
  return out;
}

// چک‌های در جریان که سررسیدشان گذشته یا تا N روز دیگر است
export function checksDueSoon(checks, todayIso, days, diffDays) {
  return checks
    .filter((c) => !c.deletedAt && c.status === 'pending' && !c.endorsementPaymentId && c.dueDate)
    .map((c) => ({ check: c, inDays: diffDays(todayIso, c.dueDate) }))
    .filter((x) => x.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

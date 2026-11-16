// عملیات دریافت/پرداخت و چک مرتبط: ذخیره، خرج چک، حذف زنجیره‌ای.
// این‌ها منطق خالص دیتابیسی هستند و رابط کاربری ندارند.
import { todayIso } from '../../core/jalali.js';

// data: {direction, method, date, partyId, amount, invoiceId, note, check:{number, bank, owner, issueDate, dueDate, status}}
export async function savePayment(db, data, existing = null) {
  const pt = db.table('payments');
  const ct = db.table('checks');
  const base = {
    direction: data.direction,
    method: data.method,
    date: data.date,
    partyId: data.partyId,
    amount: data.amount,
    invoiceId: data.invoiceId || '',
    note: data.note || '',
    kind: 'normal',
  };
  let payment = existing ? await pt.update(existing.id, base) : await pt.create(base, { prefix: data.direction === 'in' ? 'RC' : 'PY' });

  if (data.method === 'check') {
    const c = data.check || {};
    const prev = payment.checkId ? await ct.get(payment.checkId) : null;
    const cdata = {
      direction: data.direction === 'in' ? 'received' : 'issued',
      number: c.number || '',
      bank: c.bank || '',
      owner: c.owner || '',
      issueDate: c.issueDate || '',
      dueDate: c.dueDate || '',
      status: c.status || 'pending',
      amount: data.amount,
      partyId: data.partyId,
      paymentId: payment.id,
      clearedDate: c.status === 'cleared' ? (prev && prev.clearedDate) || todayIso() : '',
    };
    if (prev && !prev.deletedAt) {
      await ct.update(prev.id, cdata);
      // اگر چک خرج شده، مبلغ خرج هم باید هم‌گام بماند
      if (prev.endorsementPaymentId) await pt.update(prev.endorsementPaymentId, { amount: data.amount });
    } else {
      const created = await ct.create(cdata, { prefix: 'CK' });
      payment = await pt.update(payment.id, { checkId: created.id });
    }
  } else if (payment.checkId) {
    await removeCheckOf(db, payment);
    payment = await pt.update(payment.id, { checkId: '' });
  }
  return payment;
}

// چک متصل به این دریافت/پرداخت و خرجش را حذف میکند (خود پرداخت دست نمیخورد)
async function removeCheckOf(db, payment) {
  const ct = db.table('checks');
  const c = payment.checkId ? await ct.get(payment.checkId) : null;
  if (c && !c.deletedAt) {
    if (c.endorsementPaymentId) await db.table('payments').remove(c.endorsementPaymentId);
    await ct.remove(c.id);
  }
}

export async function deletePaymentCascade(db, payment) {
  const pt = db.table('payments');
  const ct = db.table('checks');
  if (payment.kind === 'endorse') {
    const c = payment.checkId ? await ct.get(payment.checkId) : null;
    if (c) await ct.update(c.id, { endorsementPaymentId: '', endorsedToId: '', endorsedDate: '' });
    await pt.remove(payment.id);
    return;
  }
  await removeCheckOf(db, payment);
  await pt.remove(payment.id);
}

// خرج چک دریافتی به یک شخص دیگر: برای او یک «پرداخت» با همان چک ثبت میشود
export async function endorseCheck(db, check, { partyId, date, note, invoiceId }) {
  const pt = db.table('payments');
  const p = await pt.create(
    { direction: 'out', method: 'check', kind: 'endorse', date, partyId, amount: check.amount, checkId: check.id, invoiceId: invoiceId || '', note: note || '' },
    { prefix: 'PY' }
  );
  await db.table('checks').update(check.id, { endorsementPaymentId: p.id, endorsedToId: partyId, endorsedDate: date });
  return p;
}

export async function unendorseCheck(db, check) {
  if (!check.endorsementPaymentId) return;
  const p = await db.table('payments').get(check.endorsementPaymentId);
  if (p) await deletePaymentCascade(db, p);
  else await db.table('checks').update(check.id, { endorsementPaymentId: '', endorsedToId: '', endorsedDate: '' });
}

export async function setCheckStatus(db, check, status, date) {
  await db.table('checks').update(check.id, { status, clearedDate: status === 'cleared' ? date || todayIso() : '' });
}

// تبدیل خروجی Gemini به پیش‌نویس فرم‌ها (خالص؛ بدون DOM)
import { bestMatch } from './match.js';
import { partyName } from '../parties/model.js';
import { dimsText, kindInfo } from '../products/model.js';
import { REASONS_IN, REASONS_OUT } from '../inventory/stock.js';

export const productText = (p) => `${p.name || ''} ${kindInfo(p.kind).label} ${dimsText(p)}`.trim();

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function findProduct(it, products) {
  const q = [it.product, it.length_cm && it.width_cm ? `${it.length_cm} ${it.width_cm}` : ''].filter(Boolean).join(' ');
  if (!q) return null;
  const m = bestMatch(q, products.map((p) => ({ id: p.id, text: productText(p) })));
  return m ? products.find((p) => p.id === m.id) : null;
}

export function resolveParsed(parsed, { parties, products }) {
  const kind = parsed.kind || 'unknown';
  const out = { kind, transcript: parsed.transcript || '', note: parsed.note || '', warnings: [] };
  const rolesFor = { sale: ['customer'], purchase: ['supplier', 'subcontractor'], payment_in: ['customer', 'supplier'], payment_out: ['supplier', 'subcontractor', 'customer'] }[kind];
  if (parsed.party && rolesFor) {
    const pool = parties.filter((p) => !p.deletedAt && (!p.roles || !p.roles.length || p.roles.some((r) => rolesFor.includes(r))));
    const m = bestMatch(parsed.party, pool.map((p) => ({ id: p.id, text: partyName(p) })), 0.55) || bestMatch(parsed.party, parties.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, text: partyName(p) })), 0.7);
    out.partyId = m ? m.id : '';
    out.partyName = m ? m.text : '';
    if (!m) out.warnings.push(`شخص «${parsed.party}» پیدا نشد؛ خودتان انتخاب کنید.`);
  } else if (rolesFor) {
    out.warnings.push('نام طرف حساب شنیده نشد.');
  }
  const live = products.filter((p) => !p.deletedAt);
  if (kind === 'sale' || kind === 'purchase') {
    out.lines = (parsed.items || []).map((it) => {
      const p = findProduct(it, live);
      if (!p) out.warnings.push(`کالای «${it.product || '؟'}» پیدا نشد؛ به‌صورت شرح آزاد آمد.`);
      return { productId: p ? p.id : '', title: p ? p.name : it.product || '', qty: num(it.qty), price: num(it.price), unit: p ? p.unit || it.unit || 'kg' : it.unit || 'kg', unitCost: kind === 'sale' ? num(it.unit_cost) : null, matched: p ? productText(p) : '' };
    });
  } else if (kind === 'payment_in' || kind === 'payment_out') {
    out.amount = num(parsed.amount);
    out.method = parsed.method === 'check' ? 'check' : 'cash';
    if (!out.amount) out.warnings.push('مبلغ شنیده نشد.');
  } else if (kind === 'stock_in' || kind === 'stock_out') {
    const dflt = kind === 'stock_in' ? 'in' : 'out';
    out.moves = (parsed.items || []).map((it) => {
      const p = findProduct(it, live.filter((x) => kindInfo(x.kind).noStock !== true));
      if (!p) out.warnings.push(`کالای «${it.product || '؟'}» پیدا نشد؛ در فرم انتخابش کنید.`);
      const direction = it.direction === 'in' || it.direction === 'out' ? it.direction : dflt;
      const list = direction === 'in' ? REASONS_IN : REASONS_OUT;
      const reason = list.some((r) => r.value === it.reason) ? it.reason : null;
      return { productId: p ? p.id : '', productName: p ? p.name : it.product || '', direction, qty: num(it.qty), reason, runTag: parsed.run_tag == null ? '' : String(parsed.run_tag) };
    });
  } else {
    out.warnings.push('نوع کار تشخیص داده نشد. دوباره و واضح‌تر بگویید.');
  }
  return out;
}

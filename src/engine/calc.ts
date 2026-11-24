// Flat annual interest/profit on the original financed principal.
// P = price, D = down payment, L = P - D, r = annual% / 100, n = months, y = n / 12
// interest = L × r × y; total instalments = L + interest; monthly = total / n.
import type { Basis } from './types';
import { round2 } from '../lib/num';

export type CostValue =
  | { mode: 'none' }
  | { mode: 'percent'; pct: number; basis: Basis; basisConfirmed: boolean }
  | { mode: 'amount'; amount: number }
  | { mode: 'unknown' };

export type CashbackTiming = 'later' | 'at_delivery' | 'unknown';

export interface CalcInput {
  price: number | null;
  down: { mode: 'percent'; pct: number | null } | { mode: 'amount'; amount: number | null };
  months: number | null;
  /** Annual rate in percent (14.25 = 14.25%). null = unknown. */
  rate: number | null;
  admin: CostValue;
  insurance: CostValue;
  extra: number;
  cashback: { amount: number; timing: CashbackTiming };
}

export interface CostResult {
  status: 'none' | 'known' | 'estimate' | 'unknown';
  amount: number | null;
  basis?: Basis;
}

export interface CalcError {
  field: 'price' | 'down' | 'months' | 'rate' | 'admin' | 'insurance' | 'extra' | 'cashback';
  message: string;
}

export interface CalcResult {
  ok: boolean;
  errors: CalcError[];
  price: number | null;
  downAmount: number | null;
  downPct: number | null;
  loan: number | null;
  months: number | null;
  rate: number | null;
  interest: number | null;
  totalInstallments: number | null;
  monthly: number | null;
  /** Rounded monthly instalment and last-instalment adjustment for an exact total. */
  monthlyRounded: number | null;
  lastInstallment: number | null;
  admin: CostResult;
  insurance: CostResult;
  extra: number;
  cashbackDeducted: number;
  cashbackSeparate: number;
  cashbackTiming: CashbackTiming;
  /** Cash due at delivery from known items only. */
  cashKnown: number | null;
  cashComplete: boolean;
  totalKnown: number | null;
  totalComplete: boolean;
  fullCash: boolean;
  missing: string[];
}

function costAmount(c: CostValue, loan: number, price: number): CostResult {
  switch (c.mode) {
    case 'none':
      return { status: 'none', amount: 0 };
    case 'amount':
      return { status: 'known', amount: c.amount };
    case 'percent': {
      const base = c.basis === 'loan' ? loan : price;
      const amount = (base * c.pct) / 100;
      return { status: c.basisConfirmed ? 'known' : 'estimate', amount, basis: c.basis };
    }
    default:
      return { status: 'unknown', amount: null };
  }
}

const BASIS_AR: Record<Basis, string> = { loan: 'مبلغ التمويل', price: 'سعر السيارة' };

export function calculate(input: CalcInput): CalcResult {
  const errors: CalcError[] = [];
  const missing: string[] = [];
  const price = input.price;
  if (price === null) errors.push({ field: 'price', message: 'أدخل سعر السيارة' });
  else if (!Number.isFinite(price) || price <= 0) errors.push({ field: 'price', message: 'سعر السيارة يجب أن يكون أكبر من صفر' });

  let downAmount: number | null = null;
  let downPct: number | null = null;
  if (input.down.mode === 'percent') {
    const pct = input.down.pct;
    if (pct === null) errors.push({ field: 'down', message: 'أدخل المقدم' });
    else if (pct < 0 || pct > 100 || !Number.isFinite(pct)) errors.push({ field: 'down', message: 'نسبة المقدم بين 0% و100%' });
    else {
      downPct = pct;
      if (price !== null && price > 0) downAmount = round2((price * pct) / 100);
    }
  } else {
    const amt = input.down.amount;
    if (amt === null) errors.push({ field: 'down', message: 'أدخل المقدم' });
    else if (amt < 0 || !Number.isFinite(amt)) errors.push({ field: 'down', message: 'المقدم لا يكون سالباً' });
    else if (price !== null && price > 0 && amt > price) errors.push({ field: 'down', message: 'المقدم أكبر من سعر السيارة' });
    else {
      downAmount = amt;
      if (price !== null && price > 0) downPct = (amt / price) * 100;
    }
  }

  const months = input.months;
  if (months === null) errors.push({ field: 'months', message: 'اختر المدة' });
  else if (!Number.isInteger(months) || months <= 0) errors.push({ field: 'months', message: 'المدة يجب أن تكون شهراً واحداً على الأقل' });

  const rate = input.rate;
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) errors.push({ field: 'rate', message: 'النسبة السنوية غير صالحة' });
  if (!Number.isFinite(input.extra) || input.extra < 0) errors.push({ field: 'extra', message: 'الرسوم لا تكون سالبة' });
  if (!Number.isFinite(input.cashback.amount) || input.cashback.amount < 0) errors.push({ field: 'cashback', message: 'الكاش باك لا يكون سالباً' });
  for (const [k, c] of [['admin', input.admin], ['insurance', input.insurance]] as const) {
    if (c.mode === 'percent' && (!Number.isFinite(c.pct) || c.pct < 0)) errors.push({ field: k, message: 'نسبة غير صالحة' });
    if (c.mode === 'amount' && (!Number.isFinite(c.amount) || c.amount < 0)) errors.push({ field: k, message: 'مبلغ غير صالح' });
  }

  const base: CalcResult = {
    ok: false, errors, price, downAmount, downPct, loan: null, months, rate,
    interest: null, totalInstallments: null, monthly: null, monthlyRounded: null, lastInstallment: null,
    admin: { status: 'unknown', amount: null }, insurance: { status: 'unknown', amount: null },
    extra: input.extra, cashbackDeducted: 0, cashbackSeparate: 0, cashbackTiming: input.cashback.timing,
    cashKnown: null, cashComplete: false, totalKnown: null, totalComplete: false, fullCash: false, missing,
  };
  if (errors.length || price === null || downAmount === null || months === null) return base;

  const loan = round2(price - downAmount);
  const fullCash = loan === 0;
  const admin = costAmount(input.admin, loan, price);
  const insurance = costAmount(input.insurance, loan, price);

  let interest: number | null = null;
  let totalInstallments: number | null = null;
  let monthly: number | null = null;
  if (fullCash) {
    interest = 0; totalInstallments = 0; monthly = 0;
  } else if (rate !== null) {
    interest = loan * (rate / 100) * (months / 12);
    totalInstallments = loan + interest;
    monthly = totalInstallments / months;
  } else {
    missing.push('النسبة السنوية غير محددة؛ لا يمكن حساب القسط');
  }

  let monthlyRounded: number | null = null;
  let lastInstallment: number | null = null;
  if (monthly !== null && totalInstallments !== null && !fullCash) {
    monthlyRounded = round2(monthly);
    lastInstallment = round2(round2(totalInstallments) - monthlyRounded * (months - 1));
  }

  let cashKnown = downAmount + input.extra;
  let cashComplete = true;
  for (const [label, c] of [['المصاريف الإدارية', admin], ['التأمين المطلوب عند الاستلام', insurance]] as const) {
    if (c.status === 'known' || c.status === 'none') cashKnown += c.amount ?? 0;
    else if (c.status === 'estimate') {
      cashComplete = false;
      missing.push(`${label}: أساس النسبة غير مؤكد (تقدير على ${BASIS_AR[c.basis!]}؛ غير محسوب في الكاش)`);
    } else {
      cashComplete = false;
      missing.push(`${label}: غير محددة`);
    }
  }
  let cashbackDeducted = 0;
  let cashbackSeparate = 0;
  if (input.cashback.amount > 0) {
    if (input.cashback.timing === 'at_delivery') cashbackDeducted = Math.min(input.cashback.amount, cashKnown);
    else cashbackSeparate = input.cashback.amount;
  }
  cashKnown -= cashbackDeducted;

  const totalKnown = totalInstallments === null ? null : cashKnown + totalInstallments;
  return {
    ...base,
    ok: true,
    loan,
    interest,
    totalInstallments,
    monthly,
    monthlyRounded,
    lastInstallment,
    admin,
    insurance,
    cashbackDeducted,
    cashbackSeparate,
    cashKnown,
    cashComplete,
    totalKnown,
    totalComplete: cashComplete && totalInstallments !== null,
    fullCash,
    missing,
  };
}

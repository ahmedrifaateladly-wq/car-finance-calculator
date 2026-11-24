// Draft quote state and its evaluation into engine inputs and results.
// Costs/rate follow list defaults until the user edits them ("edited" flag), so
// defaults never need to be copied into state and cannot linger after a bank change.
import type { Basis, ClientType, CostSpec, Programme, RateBook, TierPolicy } from '../engine/types';
import { calculate, type CalcInput, type CalcResult, type CashbackTiming, type CostValue } from '../engine/calc';
import { costDefaults, downTiers, findBank, findProgramme, matchRate, originalCellRate, type MatchResult } from '../engine/ratebook';
import { parseInteger, parseMoney, parsePercent, type ParseResult } from '../lib/num';
import { FALLBACK_BANKS } from './banks';

export type CostMode = 'none' | 'percent' | 'amount' | 'unknown';

export interface CostDraft {
  edited: boolean;
  mode: CostMode;
  pct: string;
  amount: string;
  basis: Basis;
  basisConfirmed: boolean;
}

export interface Draft {
  v: 1;
  requestId: string;
  bankId: string;
  customBankName: string;
  programmeId: string | null;
  insurance: 'with' | 'without';
  clientType: ClientType;
  bodyType: 'private' | 'pickup' | 'jumbo';
  clientName: string;
  clientId: string | null;
  price: string;
  downMode: 'percent' | 'amount';
  downPct: string;
  downAmount: string;
  termMode: 'years' | 'months';
  years: number;
  monthsText: string;
  rateMode: 'auto' | 'manual';
  manualRate: string;
  admin: CostDraft;
  insuranceCost: CostDraft;
  extraEdited: boolean;
  extraAmount: string;
  extraLabel: string;
  cashbackAmount: string;
  cashbackTiming: CashbackTiming;
  usedOrigin: '' | 'ger_jpn_us' | 'others' | 'chinese';
  modelYear: string;
  shareTextOverride: string | null;
  parentQuoteId: string | null;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function blankCost(): CostDraft {
  return { edited: false, mode: 'unknown', pct: '', amount: '', basis: 'loan', basisConfirmed: false };
}

export function newDraft(bankId = 'ebank'): Draft {
  return {
    v: 1,
    requestId: uuid(),
    bankId,
    customBankName: '',
    programmeId: null,
    insurance: 'with',
    clientType: 'employee',
    bodyType: 'private',
    clientName: '',
    clientId: null,
    price: '',
    downMode: 'percent',
    downPct: '',
    downAmount: '',
    termMode: 'years',
    years: 5,
    monthsText: '',
    rateMode: 'auto',
    manualRate: '',
    admin: blankCost(),
    insuranceCost: { ...blankCost(), basis: 'price' },
    extraEdited: false,
    extraAmount: '',
    extraLabel: 'رسوم إضافية',
    cashbackAmount: '',
    cashbackTiming: 'later',
    usedOrigin: '',
    modelYear: '',
    shareTextOverride: null,
    parentQuoteId: null,
  };
}

export function specToCostDraft(spec: CostSpec): CostDraft {
  switch (spec.mode) {
    case 'none':
      return { edited: true, mode: 'none', pct: '', amount: '', basis: 'loan', basisConfirmed: true };
    case 'percent':
      return { edited: true, mode: 'percent', pct: String(spec.pct), amount: '', basis: spec.basis, basisConfirmed: spec.basisConfirmed };
    case 'amount':
      return { edited: true, mode: 'amount', pct: '', amount: String(spec.amount), basis: 'loan', basisConfirmed: true };
    default:
      return { edited: true, mode: 'unknown', pct: '', amount: '', basis: spec.suggestedBasis ?? 'loan', basisConfirmed: false };
  }
}

export type RateStatus = 'list' | 'manual' | 'none' | 'manual_required';

export interface FieldErrors {
  price?: string;
  down?: string;
  months?: string;
  rate?: string;
  admin?: string;
  insurance?: string;
  extra?: string;
  cashback?: string;
  modelYear?: string;
}

export interface Evaluation {
  bankName: string;
  programme?: Programme;
  priced: boolean;
  tierPolicy: TierPolicy;
  months: number | null;
  match?: MatchResult;
  listRate: number | null;
  /** Rate differs from the original version 1 list (edited in settings). */
  listRateEdited: boolean;
  originalListRate: number | null;
  rate: number | null;
  rateStatus: RateStatus;
  admin: { value: CostValue; spec: CostSpec; edited: boolean; note?: string };
  insurance: { value: CostValue; spec: CostSpec; edited: boolean; note?: string };
  extra: { amount: number; label: string; edited: boolean; note?: string };
  calc: CalcResult;
  fieldErrors: FieldErrors;
  notes: string[];
  warnings: string[];
  tiers: number[];
}

function num(p: ParseResult): number | null {
  return p.kind === 'ok' ? p.value : null;
}

function costFromDraft(c: CostDraft, label: string, errs: FieldErrors, key: 'admin' | 'insurance'): CostValue {
  if (c.mode === 'none') return { mode: 'none' };
  if (c.mode === 'unknown') return { mode: 'unknown' };
  if (c.mode === 'percent') {
    const p = parsePercent(c.pct);
    if (p.kind === 'error') errs[key] = `${label}: ${p.message}`;
    if (p.kind !== 'ok') return { mode: 'unknown' };
    return { mode: 'percent', pct: p.value, basis: c.basis, basisConfirmed: c.basisConfirmed };
  }
  const a = parseMoney(c.amount);
  if (a.kind === 'error') errs[key] = `${label}: ${a.message}`;
  if (a.kind !== 'ok') return { mode: 'unknown' };
  return { mode: 'amount', amount: a.value };
}

function specToValue(s: CostSpec): CostValue {
  if (s.mode === 'percent') return { mode: 'percent', pct: s.pct, basis: s.basis, basisConfirmed: s.basisConfirmed };
  if (s.mode === 'amount') return { mode: 'amount', amount: s.amount };
  if (s.mode === 'none') return { mode: 'none' };
  return { mode: 'unknown' };
}

export function valueToSpec(v: CostValue): CostSpec {
  return v as CostSpec;
}

export function bankList(book: RateBook | null) {
  return book ? book.banks : FALLBACK_BANKS;
}

export function draftMonths(d: Draft): { months: number | null; error?: string } {
  if (d.termMode === 'years') return { months: d.years * 12 };
  const p = parseInteger(d.monthsText, 1, 180);
  if (p.kind === 'error') return { months: null, error: p.message };
  return { months: p.kind === 'ok' ? p.value : null };
}

export function evaluate(d: Draft, book: RateBook | null, original: RateBook | null): Evaluation {
  const errs: FieldErrors = {};
  const notes: string[] = [];
  const warnings: string[] = [];
  const bank = findBank(book, d.bankId) ?? FALLBACK_BANKS.find((b) => b.id === d.bankId);
  const bankName = d.bankId === 'other' && d.customBankName.trim() ? d.customBankName.trim() : bank?.nameAr ?? 'جهة غير معروفة';
  const programme = findProgramme(book, d.bankId, d.programmeId) ?? (bank?.priced ? bank.programmes[0] : undefined);
  const priced = !!(bank?.priced && programme);
  const tierPolicy = book?.tierPolicy ?? 'exact';

  const price = parseMoney(d.price);
  if (price.kind === 'error') errs.price = price.message;
  const priceV = num(price);

  let down: CalcInput['down'];
  if (d.downMode === 'percent') {
    const p = parsePercent(d.downPct);
    if (p.kind === 'error') errs.down = p.message;
    down = { mode: 'percent', pct: num(p) };
  } else {
    const a = parseMoney(d.downAmount);
    if (a.kind === 'error') errs.down = a.message;
    down = { mode: 'amount', amount: num(a) };
  }

  const m = draftMonths(d);
  if (m.error) errs.months = m.error;
  const months = m.months;

  // Exact down-payment % used for list matching (amount mode derives it from amounts).
  let downPctForMatch: number | null = null;
  if (down.mode === 'percent') downPctForMatch = down.pct;
  else if (down.amount !== null && priceV && priceV > 0) downPctForMatch = (down.amount / priceV) * 100;

  let match: MatchResult | undefined;
  if (priced && programme && downPctForMatch !== null && months !== null) {
    match = matchRate({ programme, clientType: d.clientType, insurance: d.insurance, downPct: downPctForMatch, months, tierPolicy });
  }
  const listRate = match?.status === 'matched' ? match.rate : null;
  let originalListRate: number | null = null;
  let listRateEdited = false;
  if (match?.status === 'matched' && programme) {
    const o = originalCellRate(original, d.bankId, programme.id, match.cell, d.clientType);
    originalListRate = o ?? null;
    listRateEdited = o !== undefined && o !== listRate;
  }

  let rate: number | null = null;
  let rateStatus: RateStatus;
  const manualParsed = parsePercent(d.manualRate);
  if (!priced || d.rateMode === 'manual') {
    if (manualParsed.kind === 'error') errs.rate = manualParsed.message;
    rate = num(manualParsed);
    rateStatus = rate === null ? (priced ? 'none' : 'manual_required') : 'manual';
  } else {
    rate = listRate;
    rateStatus = listRate !== null ? 'list' : 'none';
  }

  const variant = match?.status === 'matched' ? match.cell.insurance : match?.cell?.insurance;
  const defs = costDefaults(priced ? programme : undefined, variant, d.insurance);
  const adminValue = d.admin.edited ? costFromDraft(d.admin, 'المصاريف الإدارية', errs, 'admin') : specToValue(defs.admin);
  const insValue = d.insuranceCost.edited ? costFromDraft(d.insuranceCost, 'التأمين', errs, 'insurance') : specToValue(defs.insurance);

  let extraAmount = 0;
  let extraLabel = d.extraLabel || 'رسوم إضافية';
  let extraNote: string | undefined;
  if (d.extraEdited) {
    const e = parseMoney(d.extraAmount);
    if (e.kind === 'error') errs.extra = e.message;
    extraAmount = num(e) ?? 0;
  } else if (defs.extra) {
    extraAmount = defs.extra.amount;
    extraLabel = defs.extra.label;
    extraNote = defs.extra.note;
  }

  const cb = parseMoney(d.cashbackAmount);
  if (cb.kind === 'error') errs.cashback = cb.message;

  const calc = calculate({
    price: priceV,
    down,
    months,
    rate,
    admin: adminValue,
    insurance: insValue,
    extra: extraAmount,
    cashback: { amount: num(cb) ?? 0, timing: d.cashbackTiming },
  });
  // "Required" prompts are shown in the results panel; field-level errors are for invalid entries only.
  for (const e of calc.errors) if (!errs[e.field] && !/^(أدخل|اختر)/.test(e.message)) errs[e.field] = e.message;

  if (match?.status === 'matched') notes.push(...match.notes);
  if (priced && programme) {
    if (programme.tenureNote) notes.push(programme.tenureNote);
    if (d.bodyType !== 'private') warnings.push('القوائم لا تذكر أهلية سيارات النقل؛ السعر من القائمة لا يعني قبول الجهة لهذا النوع');
    if (programme.segment === 'used') {
      if (!d.usedOrigin) notes.push('حدد منشأ السيارة وسنة الموديل لعرض شروط المستعمل');
      const rule = programme.usedRules?.find((r) => r.id === d.usedOrigin);
      const my = parseInteger(d.modelYear, 1950, 2100);
      if (my.kind === 'error') errs.modelYear = my.message;
      if (rule && my.kind === 'ok') {
        if (rule.minModelYear && my.value < rule.minModelYear) {
          warnings.push(`الموديل ${my.value} أقدم من أول موديل مذكور في القائمة (${rule.minModelYear})؛ راجع الجهة. لا يعني ذلك رفضاً آلياً`);
        }
      }
      if (rule?.requiredDownPct && downPctForMatch !== null && Math.abs(downPctForMatch - rule.requiredDownPct) > 1e-6) {
        warnings.push(`القائمة تذكر مقدم ${rule.requiredDownPct}% للسيارات الصينية`);
      }
    }
  }
  if (calc.fullCash) notes.push('مقدم 100%: سداد نقدي كامل، لا تمويل ولا أقساط');

  return {
    bankName,
    programme,
    priced,
    tierPolicy,
    months,
    match,
    listRate,
    listRateEdited,
    originalListRate,
    rate,
    rateStatus,
    admin: { value: adminValue, spec: defs.admin, edited: d.admin.edited, note: d.admin.edited ? undefined : defs.admin.note },
    insurance: { value: insValue, spec: defs.insurance, edited: d.insuranceCost.edited, note: d.insuranceCost.edited ? undefined : defs.insurance.note },
    extra: { amount: extraAmount, label: extraLabel, edited: d.extraEdited, note: extraNote },
    calc,
    fieldErrors: errs,
    notes,
    warnings,
    tiers: programme ? downTiers(programme) : [20, 25, 30, 35, 40, 50, 60],
  };
}

/** Switch bank: list defaults reload; manual edits to costs/rate are dropped (caller offers undo). */
export function switchBank(d: Draft, bankId: string, book: RateBook | null): { draft: Draft; droppedEdits: boolean } {
  const bank = findBank(book, bankId);
  const droppedEdits = d.admin.edited || d.insuranceCost.edited || d.extraEdited || (d.rateMode === 'manual' && d.manualRate.trim() !== '');
  const programmeId = bank?.programmes[0]?.id ?? null;
  return {
    droppedEdits,
    draft: {
      ...d,
      bankId,
      customBankName: bankId === 'other' ? d.customBankName : '',
      programmeId,
      rateMode: bank?.priced ? 'auto' : 'manual',
      manualRate: '',
      admin: blankCost(),
      insuranceCost: { ...blankCost(), basis: 'price' },
      extraEdited: false,
      extraAmount: '',
      extraLabel: 'رسوم إضافية',
      usedOrigin: '',
      modelYear: '',
    },
  };
}

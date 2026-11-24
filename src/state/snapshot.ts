import type { Draft, Evaluation } from './draft';
import type { CalcResult, CostValue } from '../engine/calc';
import { config } from '../config';

export const BODY_AR: Record<Draft['bodyType'], string> = { private: 'ملاكي', pickup: 'ربع نقل', jumbo: 'جامبو' };
export const CLIENT_AR: Record<Draft['clientType'], string> = { employee: 'موظف', business: 'صاحب عمل' };

export interface Summary {
  bankName: string;
  programmeName?: string;
  inspection?: string;
  insuranceLabel?: string;
  clientTypeLabel: string;
  bodyTypeLabel: string;
  rate: number | null;
  rateStatus: Evaluation['rateStatus'];
  listRate: number | null;
  listRateEdited: boolean;
  originalListRate: number | null;
  matchReason?: string;
  tier?: number;
  notes: string[];
  warnings: string[];
  admin: { value: CostValue; edited: boolean; note?: string };
  insurance: { value: CostValue; edited: boolean; note?: string };
  extra: { amount: number; label: string; edited: boolean; note?: string };
  manualEdits: string[];
}

export interface QuoteSnapshot {
  schema: 1;
  appVersion: string;
  createdAt: string;
  method: 'flat_annual_on_original_principal';
  draft: Draft;
  summary: Summary;
  calc: CalcResult;
  shareText: string;
  shareTextEdited: boolean;
  tariff: { id: string; version: number; label: string } | null;
}

export function summarize(d: Draft, ev: Evaluation): Summary {
  const manualEdits: string[] = [];
  if (ev.rateStatus === 'manual' && ev.priced) manualEdits.push('النسبة السنوية');
  if (ev.admin.edited) manualEdits.push('المصاريف الإدارية');
  if (ev.insurance.edited) manualEdits.push('التأمين');
  if (ev.extra.edited) manualEdits.push('الرسوم الإضافية');
  return {
    bankName: ev.bankName,
    programmeName: ev.programme?.nameAr,
    inspection: ev.programme?.inspectionAr,
    insuranceLabel: ev.programme?.insuranceChoice ? (d.insurance === 'with' ? 'بتأمين' : 'بدون تأمين') : undefined,
    clientTypeLabel: CLIENT_AR[d.clientType],
    bodyTypeLabel: BODY_AR[d.bodyType],
    rate: ev.rate,
    rateStatus: ev.rateStatus,
    listRate: ev.listRate,
    listRateEdited: ev.listRateEdited,
    originalListRate: ev.originalListRate,
    matchReason: ev.match?.status === 'none' ? ev.match.reason : undefined,
    tier: ev.match?.tier,
    notes: ev.notes,
    warnings: ev.warnings,
    admin: { value: ev.admin.value, edited: ev.admin.edited, note: ev.admin.note },
    insurance: { value: ev.insurance.value, edited: ev.insurance.edited, note: ev.insurance.note },
    extra: ev.extra,
    manualEdits,
  };
}

export function makeSnapshot(
  d: Draft,
  ev: Evaluation,
  shareText: string,
  shareTextEdited: boolean,
  tariff: QuoteSnapshot['tariff'],
): QuoteSnapshot {
  return {
    schema: 1,
    appVersion: config.appVersion,
    createdAt: new Date().toISOString(),
    method: 'flat_annual_on_original_principal',
    draft: { ...d, shareTextOverride: shareTextEdited ? shareText : null },
    summary: summarize(d, ev),
    calc: ev.calc,
    shareText,
    shareTextEdited,
    tariff,
  };
}

export function isSnapshot(x: unknown): x is QuoteSnapshot {
  const s = x as QuoteSnapshot;
  return !!s && s.schema === 1 && typeof s.shareText === 'string' && !!s.summary && !!s.calc && !!s.draft;
}

export function quoteTitle(s: QuoteSnapshot): string {
  return [s.summary.bankName, s.summary.programmeName].filter(Boolean).join(' · ');
}

import { evaluate, uuid, type CostDraft } from './draft';
import type { RateBook } from '../engine/types';

function costDraftFrom(v: CostValue, basis: 'loan' | 'price'): CostDraft {
  if (v.mode === 'percent') return { edited: true, mode: 'percent', pct: String(v.pct), amount: '', basis: v.basis, basisConfirmed: v.basisConfirmed };
  if (v.mode === 'amount') return { edited: true, mode: 'amount', pct: '', amount: String(v.amount), basis, basisConfirmed: true };
  return { edited: true, mode: v.mode, pct: '', amount: '', basis, basisConfirmed: v.mode === 'none' };
}

/**
 * Build an editable copy of a saved quote. Values that would change because rate lists
 * changed since the quote was saved are kept as the saved values (marked manual) and reported.
 */
export function draftFromSnapshot(s: QuoteSnapshot, quoteId: string, book: RateBook | null, original: RateBook | null): { draft: Draft; notices: string[] } {
  const notices: string[] = [];
  const draft: Draft = { ...s.draft, requestId: uuid(), parentQuoteId: quoteId, shareTextOverride: null };
  const ev = evaluate(draft, book, original);
  if (s.summary.rate !== null && ev.rate !== s.summary.rate) {
    draft.rateMode = 'manual';
    draft.manualRate = String(s.summary.rate);
    notices.push(
      ev.listRate !== null
        ? `سعر القائمة الحالي ${ev.listRate}% يختلف عن سعر العرض المحفوظ ${s.summary.rate}%؛ أُبقي سعر العرض المحفوظ كتعديل يدوي`
        : `لا يوجد سعر مطابق في القوائم الحالية؛ أُبقي سعر العرض المحفوظ ${s.summary.rate}% كتعديل يدوي`,
    );
  }
  if (!s.draft.admin.edited && JSON.stringify(ev.admin.value) !== JSON.stringify(s.summary.admin.value)) {
    draft.admin = costDraftFrom(s.summary.admin.value, 'loan');
    notices.push('افتراض المصاريف الإدارية تغيّر في القوائم الحالية؛ أُبقيت قيمة العرض المحفوظ');
  }
  if (!s.draft.insuranceCost.edited && JSON.stringify(ev.insurance.value) !== JSON.stringify(s.summary.insurance.value)) {
    draft.insuranceCost = costDraftFrom(s.summary.insurance.value, 'price');
    notices.push('افتراض التأمين تغيّر في القوائم الحالية؛ أُبقيت قيمة العرض المحفوظ');
  }
  if (!s.draft.extraEdited && ev.extra.amount !== s.summary.extra.amount) {
    draft.extraEdited = true;
    draft.extraAmount = String(s.summary.extra.amount);
    draft.extraLabel = s.summary.extra.label;
    notices.push('الرسوم الإضافية تغيّرت في القوائم الحالية؛ أُبقيت قيمة العرض المحفوظ');
  }
  return { draft, notices };
}

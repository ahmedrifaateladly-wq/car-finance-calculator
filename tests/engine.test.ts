import { describe, it, expect } from 'vitest';
import { calculate, type CalcInput } from '../src/engine/calc';
import { matchRate, resolveTier, costDefaults } from '../src/engine/ratebook';
import type { Programme } from '../src/engine/types';
import { parseMoney, parsePercent, formatMoneyNumber } from '../src/lib/num';
import { durationLabel, yearsLabel } from '../src/lib/arabic';

const base: CalcInput = {
  price: 1_000_000,
  down: { mode: 'amount', amount: 300_000 },
  months: 60,
  rate: 14.5,
  admin: { mode: 'none' },
  insurance: { mode: 'percent', pct: 2, basis: 'price', basisConfirmed: true },
  extra: 850,
  cashback: { amount: 0, timing: 'unknown' },
};

describe('flat-rate arithmetic (synthetic baseline from the brief)', () => {
  it('matches every expected figure', () => {
    const r = calculate(base);
    expect(r.ok).toBe(true);
    expect(r.loan).toBe(700_000);
    expect(r.interest).toBeCloseTo(507_500, 6);
    expect(r.totalInstallments).toBeCloseTo(1_207_500, 6);
    expect(r.monthly).toBeCloseTo(20_125, 6);
    expect(r.insurance.amount).toBe(20_000);
    expect(r.cashKnown).toBe(320_850);
    expect(r.cashComplete).toBe(true);
    expect(r.totalKnown).toBeCloseTo(1_528_350, 6);
    expect(r.lastInstallment).toBe(20_125);
  });
  it('percent down payment gives the same result', () => {
    const r = calculate({ ...base, down: { mode: 'percent', pct: 30 } });
    expect(r.downAmount).toBe(300_000);
    expect(r.monthly).toBeCloseTo(20_125, 6);
  });
  it('admin fee on loan vs price basis', () => {
    const a = calculate({ ...base, admin: { mode: 'percent', pct: 1.5, basis: 'loan', basisConfirmed: true } });
    expect(a.admin.amount).toBeCloseTo(10_500, 6);
    const b = calculate({ ...base, admin: { mode: 'percent', pct: 1.5, basis: 'price', basisConfirmed: true } });
    expect(b.admin.amount).toBeCloseTo(15_000, 6);
    const c = calculate({ ...base, admin: { mode: 'amount', amount: 7_000 } });
    expect(c.cashKnown).toBe(327_850);
  });
  it('unconfirmed basis is an estimate excluded from known cash', () => {
    const r = calculate({ ...base, admin: { mode: 'percent', pct: 1.5, basis: 'loan', basisConfirmed: false } });
    expect(r.admin.status).toBe('estimate');
    expect(r.cashKnown).toBe(320_850);
    expect(r.cashComplete).toBe(false);
    expect(r.totalComplete).toBe(false);
  });
  it('unknown insurance is never treated as zero silently', () => {
    const r = calculate({ ...base, insurance: { mode: 'unknown' } });
    expect(r.cashComplete).toBe(false);
    expect(r.cashKnown).toBe(300_850);
    expect(r.missing.join(' ')).toContain('التأمين');
  });
  it('unknown rate blocks the instalment but keeps cash', () => {
    const r = calculate({ ...base, rate: null });
    expect(r.monthly).toBeNull();
    expect(r.totalKnown).toBeNull();
    expect(r.cashKnown).toBe(320_850);
  });
  it('explicit zero rate is valid', () => {
    const r = calculate({ ...base, rate: 0 });
    expect(r.interest).toBe(0);
    expect(r.monthly).toBeCloseTo(700_000 / 60, 9);
  });
  it('zero and full down payment', () => {
    const z = calculate({ ...base, down: { mode: 'amount', amount: 0 } });
    expect(z.loan).toBe(1_000_000);
    const f = calculate({ ...base, down: { mode: 'percent', pct: 100 } });
    expect(f.fullCash).toBe(true);
    expect(f.loan).toBe(0);
    expect(f.interest).toBe(0);
    expect(f.monthly).toBe(0);
  });
  it('rejects down above price, negatives, zero months, empty price', () => {
    expect(calculate({ ...base, down: { mode: 'amount', amount: 1_000_001 } }).errors[0].field).toBe('down');
    expect(calculate({ ...base, down: { mode: 'amount', amount: -1 } }).ok).toBe(false);
    expect(calculate({ ...base, months: 0 }).ok).toBe(false);
    expect(calculate({ ...base, price: null }).ok).toBe(false);
    expect(calculate({ ...base, price: 0 }).ok).toBe(false);
    expect(calculate({ ...base, rate: -1 }).ok).toBe(false);
    expect(calculate({ ...base, extra: -5 }).ok).toBe(false);
    expect(calculate({ ...base, down: { mode: 'percent', pct: 101 } }).ok).toBe(false);
  });
  it('future cashback is not deducted; at-delivery cashback is', () => {
    const later = calculate({ ...base, cashback: { amount: 5000, timing: 'later' } });
    expect(later.cashKnown).toBe(320_850);
    expect(later.cashbackSeparate).toBe(5000);
    const unk = calculate({ ...base, cashback: { amount: 5000, timing: 'unknown' } });
    expect(unk.cashKnown).toBe(320_850);
    const now = calculate({ ...base, cashback: { amount: 5000, timing: 'at_delivery' } });
    expect(now.cashKnown).toBe(315_850);
  });
  it('rounding difference goes to the last instalment', () => {
    const r = calculate({ ...base, price: 100_000, down: { mode: 'amount', amount: 0 }, months: 7, rate: 10, insurance: { mode: 'none' }, extra: 0 });
    const sum = r.monthlyRounded! * 6 + r.lastInstallment!;
    expect(Math.round(sum * 100) / 100).toBeCloseTo(Math.round(r.totalInstallments! * 100) / 100, 2);
  });
  it('no NaN or Infinity anywhere', () => {
    const r = calculate({ ...base, rate: 14.25, months: 1 });
    for (const v of [r.interest, r.monthly, r.totalKnown, r.cashKnown]) expect(Number.isFinite(v!)).toBe(true);
  });
});

// Synthetic programme (not a real bank) exercising matching rules.
const synth: Programme = {
  id: 'synthetic', nameAr: 'تجريبي', segment: 'standard', clientRates: 'separate', insuranceChoice: true, maxYears: 10,
  cells: [
    { down: 30, insurance: 'with', years: [1, 2], employee: 10, business: 11 },
    { down: 30, insurance: 'without', years: [1, 2], employee: 12, business: 13 },
    { down: 30, insurance: 'with', years: [3, 5], employee: 14, business: 15 },
    { down: 30, insurance: 'without', years: [3, 5], employee: null, business: null },
    { down: 30, insurance: 'with', years: [9, 10], employee: 16, business: 17 },
    { down: 50, insurance: 'unspecified', years: [1, 2], employee: 9, business: 9 },
  ],
  admin: { mode: 'none' }, insuranceWith: { mode: 'unknown' }, extraFee: null, notes: [],
};
const q = (o: Partial<Parameters<typeof matchRate>[0]>) =>
  matchRate({ programme: synth, clientType: 'employee', insurance: 'with', downPct: 30, months: 24, tierPolicy: 'exact', ...o });

describe('rate matching rules', () => {
  it('inclusive band boundaries', () => {
    expect(q({ months: 12 })).toMatchObject({ status: 'matched', rate: 10 });
    expect(q({ months: 24 })).toMatchObject({ status: 'matched', rate: 10 });
    expect(q({ months: 36 })).toMatchObject({ status: 'matched', rate: 14 });
    expect(q({ months: 60 })).toMatchObject({ status: 'matched', rate: 14 });
    expect(q({ months: 108 })).toMatchObject({ status: 'matched', rate: 16 });
    expect(q({ months: 120 })).toMatchObject({ status: 'matched', rate: 16 });
  });
  it('gap year has no rate (no extension of neighbouring bands)', () => {
    expect(q({ months: 96 }).status).toBe('none');
    expect(q({ months: 72 }).status).toBe('none');
  });
  it('client category column is respected', () => {
    expect(q({ clientType: 'business' })).toMatchObject({ rate: 11 });
  });
  it('insurance column is respected', () => {
    expect(q({ insurance: 'without' })).toMatchObject({ rate: 12 });
  });
  it('null cell is no rate, never zero', () => {
    const r = q({ insurance: 'without', months: 48 });
    expect(r.status).toBe('none');
    expect((r as any).rate).toBeUndefined();
  });
  it('in-between down payment does not match under exact policy', () => {
    expect(q({ downPct: 35 }).status).toBe('none');
    expect(q({ downPct: 29.999 }).status).toBe('none');
    expect(q({ downPct: 100 }).status).toBe('none');
  });
  it('floor policy applies only when explicitly selected', () => {
    expect(q({ downPct: 35, tierPolicy: 'floor' })).toMatchObject({ status: 'matched', tier: 30 });
    expect(resolveTier([30, 50], 20, 'floor')).toBeUndefined();
  });
  it('partial-year tenure does not match year bands', () => {
    expect(q({ months: 30 }).status).toBe('none');
  });
  it('unspecified insurance tier matches either toggle with a note', () => {
    const r = q({ downPct: 50, insurance: 'without' });
    expect(r).toMatchObject({ status: 'matched', rate: 9 });
  });
  it('defaults: without insurance is none, with is the programme rule, unmatched is unknown', () => {
    expect(costDefaults(synth, 'without', 'without').insurance.mode).toBe('none');
    expect(costDefaults(synth, 'with', 'with').insurance.mode).toBe('unknown');
    expect(costDefaults(undefined, undefined, 'with').admin.mode).toBe('unknown');
  });
});

describe('number input', () => {
  it('accepts Arabic and English digits and separators', () => {
    expect(parseMoney('١٢٣')).toEqual({ kind: 'ok', value: 123 });
    expect(parseMoney('1,250,000')).toEqual({ kind: 'ok', value: 1250000 });
    expect(parseMoney('١٬٢٥٠٬٠٠٠')).toEqual({ kind: 'ok', value: 1250000 });
    expect(parseMoney('1250000.5')).toEqual({ kind: 'ok', value: 1250000.5 });
    expect(parseMoney('١٢٣٫٥')).toEqual({ kind: 'ok', value: 123.5 });
    expect(parseMoney('')).toEqual({ kind: 'empty' });
  });
  it('rejects ambiguous grouping and negatives', () => {
    expect(parseMoney('1,00').kind).toBe('error');
    expect(parseMoney('12,5000').kind).toBe('error');
    expect(parseMoney('-5').kind).toBe('error');
    expect(parseMoney('1.2.3').kind).toBe('error');
    expect(parseMoney('abc').kind).toBe('error');
  });
  it('percent accepts comma or dot decimal', () => {
    expect(parsePercent('14.25')).toEqual({ kind: 'ok', value: 14.25 });
    expect(parsePercent('13,75')).toEqual({ kind: 'ok', value: 13.75 });
    expect(parsePercent('١٤٫٢٥')).toEqual({ kind: 'ok', value: 14.25 });
    expect(parsePercent('0')).toEqual({ kind: 'ok', value: 0 });
    expect(parsePercent('101').kind).toBe('error');
  });
  it('formats consistently', () => {
    expect(formatMoneyNumber(20125)).toBe('20,125');
    expect(formatMoneyNumber(11666.666666)).toBe('11,666.67');
  });
  it('Arabic duration forms', () => {
    expect(yearsLabel(1)).toBe('سنة واحدة');
    expect(yearsLabel(2)).toBe('سنتان');
    expect(durationLabel(60)).toBe('5 سنوات (60 قسطاً)');
  });
});

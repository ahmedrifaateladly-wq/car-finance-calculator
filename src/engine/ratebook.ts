import type { Bank, ClientType, CostSpec, InsuranceVariant, Programme, RateBook, RateCell, TierPolicy } from './types';

const EPS = 1e-6;

export function findBank(book: RateBook | null, bankId: string): Bank | undefined {
  return book?.banks.find((b) => b.id === bankId);
}

export function findProgramme(book: RateBook | null, bankId: string, programmeId: string | null): Programme | undefined {
  const bank = findBank(book, bankId);
  if (!bank || !programmeId) return undefined;
  return bank.programmes.find((p) => p.id === programmeId);
}

export function downTiers(p: Programme): number[] {
  return [...new Set(p.cells.map((c) => c.down))].sort((a, b) => a - b);
}

export function hasTenureBands(p: Programme): boolean {
  return p.cells.some((c) => c.years !== null);
}

export type MatchResult =
  | { status: 'matched'; rate: number; cell: RateCell; tier: number; notes: string[] }
  | { status: 'none'; reason: string; cell?: RateCell; tier?: number };

export interface MatchQuery {
  programme: Programme;
  clientType: ClientType;
  insurance: 'with' | 'without';
  downPct: number;
  months: number;
  tierPolicy: TierPolicy;
}

export function resolveTier(tiers: number[], downPct: number, policy: TierPolicy): number | undefined {
  if (policy === 'exact') return tiers.find((t) => Math.abs(t - downPct) < EPS);
  const eligible = tiers.filter((t) => t <= downPct + EPS);
  return eligible.length ? eligible[eligible.length - 1] : undefined;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 1000) / 1000}%`;
}

/** Select a list rate. Never interpolates, never maps null to zero, never invents partial-year bands. */
export function matchRate(q: MatchQuery): MatchResult {
  const p = q.programme;
  const tiers = downTiers(p);
  const tier = resolveTier(tiers, q.downPct, q.tierPolicy);
  if (tier === undefined) {
    return {
      status: 'none',
      reason: `نسبة المقدم ${fmtPct(q.downPct)} لا تطابق شريحة في القائمة (الشرائح: ${tiers.map(fmtPct).join('، ')})`,
    };
  }
  const banded = hasTenureBands(p);
  if (banded && q.months % 12 !== 0) {
    return { status: 'none', reason: 'المدة ليست سنوات كاملة، والقائمة مسعّرة بالسنوات فقط', tier };
  }
  const y = q.months / 12;
  const atTier = p.cells.filter((c) => Math.abs(c.down - tier) < EPS);
  const atTenure = atTier.filter((c) => c.years === null || (y >= c.years[0] && y <= c.years[1]));
  if (atTenure.length === 0) {
    return { status: 'none', reason: `لا توجد شريحة مدة تغطي ${y} سنوات في هذا البرنامج`, tier };
  }
  let candidates: RateCell[];
  if (p.insuranceChoice) {
    candidates = atTenure.filter((c) => c.insurance === q.insurance);
    if (candidates.length === 0) candidates = atTenure.filter((c) => c.insurance === 'unspecified');
  } else {
    candidates = atTenure;
  }
  const cell = candidates[0];
  if (!cell) {
    const label = q.insurance === 'with' ? 'بتأمين' : 'بدون تأمين';
    return { status: 'none', reason: `لا يوجد خيار «${label}» لهذه الشريحة في القائمة`, tier };
  }
  const rate = q.clientType === 'employee' ? cell.employee : cell.business;
  if (rate === null || rate === undefined) {
    return { status: 'none', reason: 'الخانة المطابقة بلا سعر في القائمة (شرطة)، وهي ليست فائدة صفرية', cell, tier };
  }
  const notes: string[] = [];
  if (q.tierPolicy === 'floor' && Math.abs(tier - q.downPct) >= EPS) {
    notes.push(`طُبّقت شريحة ${fmtPct(tier)} وفق سياسة الشرائح المحفوظة (حد أدنى)`);
  }
  if (p.insuranceChoice && cell.insurance === 'unspecified') {
    notes.push('حالة التأمين لهذه الشريحة غير موضحة في القائمة');
  }
  if (cell.condition) notes.push(`شرط مذكور: ${cell.condition}`);
  if (p.clientRates === 'unspecified') notes.push('القائمة لا تفصل بين موظف وصاحب عمل');
  if (cell.years === null) notes.push('السعر في القائمة غير مقسم حسب المدة؛ المدة المسموح بها غير محددة');
  return { status: 'matched', rate, cell, tier, notes };
}

/** Which years have a priced cell for the current selection (for chip hints). */
export function yearHasRate(p: Programme, clientType: ClientType, insurance: 'with' | 'without', tier: number | undefined, year: number): boolean {
  if (tier === undefined) return false;
  const r = matchRate({ programme: p, clientType, insurance, downPct: tier, months: year * 12, tierPolicy: 'exact' });
  return r.status === 'matched';
}

export interface CostDefaults {
  admin: CostSpec;
  insurance: CostSpec;
  extra: { label: string; amount: number; note?: string } | null;
}

/** Programme defaults. Only explicit list values are loaded; gaps stay `unknown`. */
export function costDefaults(p: Programme | undefined, variant: InsuranceVariant | undefined, insuranceToggle: 'with' | 'without'): CostDefaults {
  if (!p) {
    return {
      admin: { mode: 'unknown', note: 'المصاريف الإدارية غير محددة لهذه الجهة؛ أدخلها أو اختر «لا يوجد»', suggestedBasis: 'loan' },
      insurance: { mode: 'unknown', note: 'التأمين غير محدد لهذه الجهة؛ أدخله أو اختر «لا يوجد»', suggestedBasis: 'price' },
      extra: null,
    };
  }
  let v: InsuranceVariant | undefined = variant;
  if (!v && p.insuranceChoice) v = insuranceToggle;
  let insurance: CostSpec;
  if (v === 'with') insurance = p.insuranceWith;
  else if (v === 'without') insurance = { mode: 'none', note: 'بدون تأمين وفق القائمة' };
  else if (v === 'unspecified') insurance = { mode: 'unknown', note: 'حالة التأمين لهذه الشريحة غير موضحة في القائمة', suggestedBasis: 'price' };
  else insurance = { mode: 'unknown', note: 'شروط التأمين تتبع شريحة المقدم، ولا توجد شريحة مطابقة', suggestedBasis: 'price' };
  return { admin: p.admin, insurance, extra: p.extraFee };
}

export function variantLabel(v: InsuranceVariant): string {
  return v === 'with' ? 'بتأمين' : v === 'without' ? 'بدون تأمين' : 'تأمين غير موضح';
}

export function rateBookEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Compare a cell's rate with the original (version 1) book to flag settings edits. */
export function originalCellRate(original: RateBook | null, bankId: string, programmeId: string, cell: RateCell, clientType: ClientType): number | null | undefined {
  const p = findProgramme(original, bankId, programmeId);
  if (!p) return undefined;
  const o = p.cells.find(
    (c) => c.down === cell.down && c.insurance === cell.insurance && JSON.stringify(c.years) === JSON.stringify(cell.years),
  );
  if (!o) return undefined;
  return clientType === 'employee' ? o.employee : o.business;
}

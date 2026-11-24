// Domain types. Rate data is kept separate from calculation and UI.

export type ClientType = 'employee' | 'business';
export type InsuranceVariant = 'with' | 'without' | 'unspecified';
export type Basis = 'loan' | 'price';
export type TierPolicy = 'exact' | 'floor';

/** A cost rule as stored in a rate book. `unknown` is a data gap, never zero. */
export type CostSpec =
  | { mode: 'none'; note?: string }
  | { mode: 'percent'; pct: number; basis: Basis; basisConfirmed: boolean; note?: string }
  | { mode: 'amount'; amount: number; note?: string }
  | { mode: 'unknown'; note?: string; suggestedBasis?: Basis };

export interface RateCell {
  /** Down-payment tier as stated in the list (exact %). */
  down: number;
  insurance: InsuranceVariant;
  /** Inclusive tenure band in years; null = the table does not price by tenure. */
  years: [number, number] | null;
  /** null = no rate quoted in the source (dash / blank). Never zero. */
  employee: number | null;
  business: number | null;
  condition?: string;
}

export interface UsedCarRule {
  id: 'ger_jpn_us' | 'others' | 'chinese';
  labelAr: string;
  rawText: string[];
  minModelYear?: number;
  ageTenureTotalYears?: number;
  requiredDownPct?: number;
  status: string;
}

export interface Programme {
  id: string;
  nameAr: string;
  segment: 'general' | 'standard' | 'luxury' | 'electric' | 'electric_luxury' | 'used';
  inspectionAr?: string;
  /** separate: different rates; equal: list states same rate; unspecified: list does not split categories. */
  clientRates: 'separate' | 'equal' | 'unspecified';
  /** Whether the user picks with/without insurance (otherwise driven by the tier). */
  insuranceChoice: boolean;
  maxYears: number;
  cells: RateCell[];
  admin: CostSpec;
  /** Insurance cost rule for cells marked "with insurance". */
  insuranceWith: CostSpec;
  extraFee: { label: string; amount: number; note?: string } | null;
  promoAr?: string;
  notes: string[];
  tenureNote?: string;
  usedRules?: UsedCarRule[];
  usedGiftNote?: string;
}

export interface Bank {
  id: string;
  nameAr: string;
  priced: boolean;
  allowCustomName?: boolean;
  programmes: Programme[];
  notes: string[];
}

export interface RateBook {
  schema: 1;
  label: string;
  method: 'flat_annual_on_original_principal';
  tierPolicy: TierPolicy;
  effectiveDate: string | null;
  banks: Bank[];
}

// Number parsing and formatting for Arabic/English input.
// Accepts Arabic-Indic (٠-٩) and Eastern Arabic/Persian (۰-۹) digits.

export type ParseResult =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number }
  | { kind: 'error'; message: string };

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeDigits(raw: string): string {
  return raw.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

function cleanBase(raw: string): string {
  return normalizeDigits(raw)
    .replace(/[‎‏‪-‮⁦-⁩؜]/g, '') // bidi marks
    .replace(/[\s  ]/g, '')
    .replace(/[%٪]/g, '')
    .replace(/(ج\.?م\.?|جنيه|EGP|LE)/gi, '')
    .replace(/[٫]/g, '.') // Arabic decimal separator
    .replace(/[٬،]/g, ','); // Arabic thousands separator / Arabic comma
}

/**
 * Money: comma is a thousands separator and must form valid 3-digit groups;
 * dot (or ٫) is the decimal separator. Ambiguous input is rejected, never guessed.
 */
export function parseMoney(raw: string): ParseResult {
  const s = cleanBase(raw);
  if (s === '') return { kind: 'empty' };
  if (s.startsWith('-')) return { kind: 'error', message: 'لا تُقبل القيم السالبة' };
  if (!/^[0-9.,]+$/.test(s)) return { kind: 'error', message: 'أدخل رقماً صحيحاً' };
  const parts = s.split('.');
  if (parts.length > 2) return { kind: 'error', message: 'علامة عشرية مكررة' };
  const [intPart, decPart] = parts;
  if (intPart.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+$/.test(intPart)) {
      return { kind: 'error', message: 'فواصل الآلاف غير صحيحة (مثال: 1,250,000)' };
    }
  }
  if (decPart !== undefined && (decPart.includes(',') || decPart.length > 2)) {
    return { kind: 'error', message: 'المبلغ يقبل خانتين عشريتين على الأكثر' };
  }
  const n = Number(intPart.replace(/,/g, '') + (decPart !== undefined ? '.' + decPart : ''));
  if (!Number.isFinite(n)) return { kind: 'error', message: 'أدخل رقماً صحيحاً' };
  return { kind: 'ok', value: n };
}

/** Percentages: comma is treated as a decimal separator (13,75 = 13.75), as in the source sheets. */
export function parsePercent(raw: string, max = 100): ParseResult {
  let s = cleanBase(raw);
  if (s === '') return { kind: 'empty' };
  if (s.startsWith('-')) return { kind: 'error', message: 'لا تُقبل النسب السالبة' };
  if ((s.match(/[.,]/g) ?? []).length > 1) return { kind: 'error', message: 'علامة عشرية مكررة' };
  s = s.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { kind: 'error', message: 'أدخل نسبة صحيحة' };
  const n = Number(s);
  if (!Number.isFinite(n)) return { kind: 'error', message: 'أدخل نسبة صحيحة' };
  if (n > max) return { kind: 'error', message: `النسبة لا تتجاوز ${max}%` };
  return { kind: 'ok', value: n };
}

export function parseInteger(raw: string, min: number, max: number): ParseResult {
  const s = cleanBase(raw);
  if (s === '') return { kind: 'empty' };
  if (!/^\d+$/.test(s)) return { kind: 'error', message: 'أدخل عدداً صحيحاً' };
  const n = Number(s);
  if (n < min || n > max) return { kind: 'error', message: `القيمة بين ${min} و${max}` };
  return { kind: 'ok', value: n };
}

const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Round half away from zero to 2 decimals, guarding binary float noise. */
export function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/** Display money consistently: whole pounds when exact to the piaster, else 2 decimals. */
export function formatMoneyNumber(n: number): string {
  const r = round2(n);
  return Number.isInteger(r) ? fmt0.format(r) : fmt2.format(r);
}

export function formatMoney(n: number): string {
  return `${formatMoneyNumber(n)} ج.م`;
}

export function formatPercent(n: number): string {
  const r = Math.round((n + Number.EPSILON) * 1000) / 1000;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(r)}%`;
}

/** Format a raw money string for display after blur, preserving meaning. */
export function prettyMoneyInput(raw: string): string {
  const p = parseMoney(raw);
  return p.kind === 'ok' ? formatMoneyNumber(p.value) : raw;
}

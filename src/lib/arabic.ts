// Arabic counted-noun forms for durations (Modern Standard Arabic, plain style).

export function yearsLabel(y: number): string {
  if (y === 1) return 'سنة واحدة';
  if (y === 2) return 'سنتان';
  if (y >= 3 && y <= 10) return `${y} سنوات`;
  return `${y} سنة`;
}

export function monthsLabel(m: number): string {
  if (m === 1) return 'شهر واحد';
  if (m === 2) return 'شهران';
  if (m >= 3 && m <= 10) return `${m} أشهر`;
  return `${m} شهراً`;
}

export function installmentsLabel(n: number): string {
  if (n === 1) return 'قسط واحد';
  if (n === 2) return 'قسطان';
  if (n >= 3 && n <= 10) return `${n} أقساط`;
  return `${n} قسطاً`;
}

/** "5 سنوات (60 قسطاً)" or "30 شهراً (30 قسطاً)" for non-whole years. */
export function durationLabel(months: number): string {
  if (months > 0 && months % 12 === 0) return `${yearsLabel(months / 12)} (${installmentsLabel(months)})`;
  return `${monthsLabel(months)} (${installmentsLabel(months)})`;
}

export function shortYears(y: number): string {
  if (y === 1) return 'سنة';
  if (y === 2) return 'سنتان';
  return `${y} سنوات`;
}

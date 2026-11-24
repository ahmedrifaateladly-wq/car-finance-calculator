// Converts the private tariff transcription (tariffs.json, schema 1.0) into a RateBook.
// The private file itself is never bundled; this runs during setup and in private tests.
import type { Bank, CostSpec, Programme, RateBook, RateCell, UsedCarRule } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const INS_WITH_UNKNOWN: CostSpec = {
  mode: 'unknown',
  note: 'تأمين إجباري؛ النسبة والأساس وتوقيت السداد غير مذكورة في القائمة',
  suggestedBasis: 'price',
};

function convertEbank(src: Json): Bank {
  const years: number[] = src.years;
  const cells: RateCell[] = [];
  for (const tier of src.tiers) {
    years.forEach((y, i) => {
      cells.push({
        down: tier.down_payment_percent,
        insurance: tier.insurance_required ? 'with' : 'without',
        years: [y, y],
        employee: tier.employee[i] ?? null,
        business: tier.business_owner[i] ?? null,
      });
    });
  }
  const programme: Programme = {
    id: 'ebank_general',
    nameAr: 'البرنامج العام',
    segment: 'general',
    clientRates: 'separate',
    insuranceChoice: false,
    maxYears: Math.max(...years),
    cells,
    admin: { mode: 'none', note: 'بدون مصاريف إدارية وفق القائمة' },
    insuranceWith: INS_WITH_UNKNOWN,
    extraFee: null,
    notes: [
      'شريحة 25%: بدون مصاريف وتأمين إجباري، ونسبة التأمين غير مذكورة',
      'شرائح 35% و40% و50%: بدون تأمين وبدون مصاريف إدارية',
      'تاريخ سريان القائمة غير مذكور',
    ],
  };
  return { id: 'ebank', nameAr: src.bank_name_ar, priced: true, programmes: [programme], notes: [] };
}

function convertAbe(src: Json): Bank {
  const years: number[] = src.years;
  const cells: RateCell[] = [];
  for (const col of src.columns) {
    const ins = col.insurance_mode === 'with_insurance' ? 'with' : col.insurance_mode === 'without_insurance' ? 'without' : 'unspecified';
    years.forEach((y, i) => {
      const r = col.rates[i] ?? null;
      cells.push({ down: col.down_percent, insurance: ins, years: [y, y], employee: r, business: r });
    });
  }
  const fee = src.extra_fees?.[0];
  const programme: Programme = {
    id: 'abe_general',
    nameAr: 'البرنامج العام',
    segment: 'general',
    clientRates: 'unspecified',
    insuranceChoice: true,
    maxYears: Math.max(...years),
    cells,
    admin: { mode: 'none', note: 'بدون مصاريف إدارية وفق القائمة' },
    insuranceWith: { mode: 'unknown', note: 'نسبة التأمين وأساسه وتوقيته غير مذكورة في القائمة', suggestedBasis: 'price' },
    extraFee: fee ? { label: fee.label, amount: fee.amount_egp, note: 'توقيت السداد غير مذكور في القائمة؛ محسوب ضمن الكاش عند الاستلام' } : null,
    notes: [
      'شرائح 20% و30% و60%: حالة التأمين غير موضحة',
      'شريحتا 40% و50%: سعر بتأمين وسعر بدون تأمين',
      'القائمة لا تفصل بين موظف وصاحب عمل ولا تحدد نوع السيارة',
      'تاريخ سريان القائمة غير مذكور',
    ],
  };
  return { id: 'abe', nameAr: src.bank_name_ar, priced: true, programmes: [programme], notes: [] };
}

function bandCells(rates: Record<string, Json>, bands: [number, number][], paired: boolean, singleVariant: 'with' | 'without'): RateCell[] {
  const cells: RateCell[] = [];
  for (const [down, row] of Object.entries(rates)) {
    (row as Json[]).forEach((v, i) => {
      const band = bands[i];
      if (paired) {
        const [w, wo] = v as [number | null, number | null];
        cells.push({ down: Number(down), insurance: 'with', years: band, employee: w, business: w });
        cells.push({ down: Number(down), insurance: 'without', years: band, employee: wo, business: wo });
      } else {
        const r = v as number | null;
        cells.push({ down: Number(down), insurance: singleVariant, years: band, employee: r, business: r });
      }
    });
  }
  return cells;
}

function usedCells(rates: Record<string, Json>, variant: 'with' | 'without'): RateCell[] {
  return Object.entries(rates).map(([down, v]) => ({
    down: Number(down),
    insurance: variant,
    years: null,
    employee: v.employee ?? null,
    business: v.business_owner ?? null,
    ...(v.additional_condition_raw ? { condition: v.additional_condition_raw } : {}),
  }));
}

function usedRules(terms: Json): UsedCarRule[] {
  const r = terms?.manufacture_and_tenure_rules ?? [];
  const status = 'التفسير وتاريخ السريان غير مؤكدين؛ يُعرض للمراجعة ولا يُطبّق آلياً';
  return [
    {
      id: 'ger_jpn_us',
      labelAr: 'ألماني / ياباني / أمريكي',
      rawText: ['تبدأ موديل 2015 بمدة 3 سنوات', 'بحيث يكون مجموع سنة تصنيع السيارة ومدة التمويل 14 سنة'],
      minModelYear: r[0]?.source_min_model_year,
      ageTenureTotalYears: r[0]?.source_age_plus_tenure_years,
      status,
    },
    {
      id: 'others',
      labelAr: 'كوري / فرنسي / تشيكي / إسباني / إيطالي وغيرها (عدا الصيني)',
      rawText: ['تبدأ موديل 2016 بمدة 3 سنوات', 'بحيث يكون مجموع سنة تصنيع السيارة ومدة التمويل 13 سنة'],
      minModelYear: r[1]?.source_min_model_year,
      ageTenureTotalYears: r[1]?.source_age_plus_tenure_years,
      status,
    },
    {
      id: 'chinese',
      labelAr: 'صيني',
      rawText: ['مقدم 50%، استعلام بيت وشغل فقط', 'موديل 2020 بمدة 3 سنوات', 'موديل 2023 على 4 سنوات', 'بحيث يكون مجموع سنة تصنيع السيارة ومدة التمويل 7 سنوات'],
      requiredDownPct: r[2]?.down_payment_percent,
      ageTenureTotalYears: r[2]?.source_age_plus_tenure_years,
      status: 'تاريخ القائمة يحتاج تأكيداً قبل تطبيق هذه القاعدة؛ تُعرض للمراجعة فقط',
    },
  ];
}

function convertAdib(src: Json): Bank {
  const byId: Record<string, Json> = Object.fromEntries(src.programmes.map((p: Json) => [p.id, p]));
  const gift = 'مذكور في القائمة: مصاريف إدارية هدية؛ القيمة والمعاملة غير مؤكدة';
  const promo = 'مصاريف إدارية هدية + كاش باك هدية (القيم والشروط غير مؤكدة)';
  const ord = byId['adib_ordinary_home_work'];
  const lux = byId['adib_luxury_home_work'];
  const el = byId['adib_electric_home_work'];
  const elLux = byId['adib_electric_luxury_home_work'];
  const usedWith = byId['adib_used_home_work_mandatory_insurance'];
  const usedWithout = byId['adib_used_home_work_without_insurance'];
  const usedNoWork = byId['adib_used_without_work_inspection_mandatory_insurance'];
  const rules = usedRules(src.used_car_terms);
  const usedGift = 'تأمين هدية في حالة التقسيط من 3 إلى 5 سنوات (نوعه ونطاقه غير محددين، وقد يختلف عن التأمين الإجباري على العميل)';
  const elAdmin: CostSpec = {
    mode: 'percent',
    pct: el.administration_percent,
    basis: 'loan',
    basisConfirmed: false,
    note: 'مصاريف إدارية 1.5% وفق القائمة؛ أساس النسبة غير مذكور (افتراض مبدئي: مبلغ التمويل)',
  };
  const usedAdmin: CostSpec = { mode: 'unknown', note: 'القائمة تذكر «مصاريف إدارية + تأمين هدية» دون نسبة أو معاملة واضحة', suggestedBasis: 'loan' };
  const usedInsWith: CostSpec = {
    mode: 'unknown',
    note: 'تأمين إجباري على العميل؛ النسبة والأساس والتوقيت غير مذكورة',
    suggestedBasis: 'price',
  };
  const programmes: Programme[] = [
    {
      id: ord.id,
      nameAr: 'عادي',
      segment: 'standard',
      inspectionAr: 'استعلام منزل وعمل',
      clientRates: 'equal',
      insuranceChoice: true,
      maxYears: 10,
      cells: bandCells(ord.rates_by_down_percent, ord.tenure_bands_years, true, 'with'),
      admin: { mode: 'unknown', note: gift, suggestedBasis: 'loan' },
      insuranceWith: INS_WITH_UNKNOWN,
      extraFee: null,
      promoAr: promo,
      notes: ['موظف وصاحب عمل نفس الربح', 'تاريخ سريان القائمة غير مذكور'],
    },
    {
      id: lux.id,
      nameAr: 'Luxury (لاكشري)',
      segment: 'luxury',
      inspectionAr: 'استعلام منزل وعمل',
      clientRates: 'equal',
      insuranceChoice: false,
      maxYears: 10,
      cells: bandCells(lux.rates_by_down_percent, lux.tenure_bands_years, false, 'without'),
      admin: { mode: 'unknown', note: gift, suggestedBasis: 'loan' },
      insuranceWith: INS_WITH_UNKNOWN,
      extraFee: null,
      promoAr: promo,
      tenureNote: 'القائمة تسرد 1 إلى 2، و3 إلى 5، و6 إلى 7، و9 إلى 10 سنوات؛ السنة الثامنة بلا سعر منشور',
      notes: ['بدون تأمين', 'موظف وصاحب عمل نفس الربح', 'لا تعريف أو قائمة سيارات مؤهلة لوصف Luxury في القائمة'],
    },
    {
      id: el.id,
      nameAr: 'كهربائي',
      segment: 'electric',
      inspectionAr: 'استعلام منزل وعمل',
      clientRates: 'unspecified',
      insuranceChoice: true,
      maxYears: 5,
      cells: bandCells(el.rates_by_down_percent, el.tenure_bands_years, true, 'with'),
      admin: elAdmin,
      insuranceWith: INS_WITH_UNKNOWN,
      extraFee: null,
      notes: ['القائمة لا تفصل بين موظف وصاحب عمل'],
    },
    {
      id: elLux.id,
      nameAr: 'Luxury كهربائي',
      segment: 'electric_luxury',
      inspectionAr: 'استعلام منزل وعمل',
      clientRates: 'equal',
      insuranceChoice: false,
      maxYears: 5,
      cells: bandCells(elLux.rates_by_down_percent, elLux.tenure_bands_years, false, 'without'),
      admin: elAdmin,
      insuranceWith: INS_WITH_UNKNOWN,
      extraFee: null,
      notes: ['بدون تأمين', 'موظف وصاحب عمل نفس الربح'],
    },
    {
      id: 'adib_used_home_work',
      nameAr: 'مستعمل · استعلام منزل وعمل',
      segment: 'used',
      inspectionAr: 'استعلام منزل وعمل',
      clientRates: 'equal',
      insuranceChoice: true,
      maxYears: 10,
      cells: [...usedCells(usedWith.rates_by_down_percent, 'with'), ...usedCells(usedWithout.rates_by_down_percent, 'without')],
      admin: usedAdmin,
      insuranceWith: usedInsWith,
      extraFee: null,
      promoAr: 'مصاريف إدارية + تأمين هدية (القيم والشروط غير مؤكدة)',
      tenureNote: 'السعر غير مقسم حسب المدة في القائمة؛ المدة المسموح بها تتبع شروط موديل السيارة',
      notes: ['«بتأمين» = تأمين إجباري على العميل؛ «بدون تأمين» = بدون تأمين نهائي'],
      usedRules: rules,
      usedGiftNote: usedGift,
    },
    {
      id: usedNoWork.id,
      nameAr: 'مستعمل · بدون استعلام عمل',
      segment: 'used',
      inspectionAr: 'بدون استعلام عمل',
      clientRates: 'equal',
      insuranceChoice: false,
      maxYears: 10,
      cells: usedCells(usedNoWork.rates_by_down_percent, 'with'),
      admin: usedAdmin,
      insuranceWith: usedInsWith,
      extraFee: null,
      promoAr: 'مصاريف إدارية + تأمين هدية (القيم والشروط غير مؤكدة)',
      tenureNote: 'السعر غير مقسم حسب المدة في القائمة؛ المدة المسموح بها تتبع شروط موديل السيارة',
      notes: ['تأمين إجباري على العميل'],
      usedRules: rules,
      usedGiftNote: usedGift,
    },
  ];
  return { id: 'adib', nameAr: src.bank_name_ar, priced: true, programmes, notes: [] };
}

export function convertTariffs(src: Json): RateBook {
  const auto: Json[] = src.auto_priced_banks;
  const get = (id: string) => {
    const b = auto.find((x) => x.bank_id === id);
    if (!b) throw new Error(`missing bank ${id}`);
    return b;
  };
  const banks: Bank[] = [convertEbank(get('ebank')), convertAbe(get('abe')), convertAdib(get('adib'))];
  for (const m of src.manual_rate_banks) {
    banks.push({ id: m.id, nameAr: m.name_ar, priced: false, allowCustomName: !!m.allow_custom_display_name, programmes: [], notes: [] });
  }
  return {
    schema: 1,
    label: 'القوائم الأصلية (مصدرها صور المستخدم)',
    method: 'flat_annual_on_original_principal',
    tierPolicy: 'exact',
    effectiveDate: null,
    banks,
  };
}

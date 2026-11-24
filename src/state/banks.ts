import type { Bank } from '../engine/types';

// Public bank/entity names only (no rates). Used when the private rate lists are not loaded.
export const FALLBACK_BANKS: Bank[] = [
  { id: 'ebank', nameAr: 'تنمية الصادرات (E-Bank)', priced: false, programmes: [], notes: [] },
  { id: 'abe', nameAr: 'البنك الزراعي المصري (ABE)', priced: false, programmes: [], notes: [] },
  { id: 'adib', nameAr: 'مصرف أبوظبي الإسلامي (ADIB)', priced: false, programmes: [], notes: [] },
  { id: 'hdb', nameAr: 'بنك التعمير والإسكان (HDB)', priced: false, programmes: [], notes: [] },
  { id: 'drive', nameAr: 'شركة درايف (Drive)', priced: false, programmes: [], notes: [] },
  { id: 'nbk', nameAr: 'بنك الكويت الوطني (NBK)', priced: false, programmes: [], notes: [] },
  { id: 'sehola', nameAr: 'شركة سهولة (SeHola)', priced: false, programmes: [], notes: [] },
  { id: 'egbank', nameAr: 'البنك المصري الخليجي (EG Bank)', priced: false, programmes: [], notes: [] },
  { id: 'other', nameAr: 'جهة أخرى', priced: false, allowCustomName: true, programmes: [], notes: [] },
];

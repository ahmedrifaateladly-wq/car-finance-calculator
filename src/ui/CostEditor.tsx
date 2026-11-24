import type { CostValue } from '../engine/calc';
import type { CostDraft, CostMode } from '../state/draft';
import { NumField, Seg } from './common';

function fromValue(v: CostValue, fallbackBasis: 'loan' | 'price'): CostDraft {
  switch (v.mode) {
    case 'none': return { edited: true, mode: 'none', pct: '', amount: '', basis: fallbackBasis, basisConfirmed: true };
    case 'percent': return { edited: true, mode: 'percent', pct: String(v.pct), amount: '', basis: v.basis, basisConfirmed: v.basisConfirmed };
    case 'amount': return { edited: true, mode: 'amount', pct: '', amount: String(v.amount), basis: fallbackBasis, basisConfirmed: true };
    default: return { edited: true, mode: 'unknown', pct: '', amount: '', basis: fallbackBasis, basisConfirmed: false };
  }
}

export function CostEditor({ title, draft, effective, note, error, fallbackBasis, onChange, testId, noneLabel = 'لا يوجد', plain }: {
  title: string;
  draft: CostDraft;
  effective: CostValue;
  note?: string;
  error?: string;
  fallbackBasis: 'loan' | 'price';
  onChange: (c: CostDraft) => void;
  testId: string;
  noneLabel?: string;
  plain?: boolean;
}) {
  const cur: CostDraft = draft.edited ? draft : fromValue(effective, fallbackBasis);
  const edit = (patch: Partial<CostDraft>) => onChange({ ...cur, ...patch, edited: true });
  return (
    <div className="cost-block" data-testid={testId}>
      <div className="head">
        <span>{title}</span>
        {plain ? null : draft.edited ? (
          <span className="row">
            <span className="badge b-manual">معدّل يدوياً</span>
            <button type="button" className="btn-link" onClick={() => onChange({ ...draft, edited: false })}>استعادة الافتراضي</button>
          </span>
        ) : (
          <span className={`badge ${effective.mode === 'unknown' ? 'b-missing' : 'b-list'}`}>{effective.mode === 'unknown' ? 'غير محدد' : 'من القائمة'}</span>
        )}
      </div>
      {(plain || !draft.edited) && note && <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>{note}</div>}
      <Seg<CostMode>
        label={`طريقة ${title}`}
        small
        value={cur.mode}
        onChange={(m) => edit({ mode: m, basisConfirmed: m === 'percent' ? cur.basisConfirmed : cur.basisConfirmed })}
        options={[
          { value: 'none', label: noneLabel },
          { value: 'percent', label: 'نسبة %' },
          { value: 'amount', label: 'مبلغ ثابت' },
          { value: 'unknown', label: 'غير محدد' },
        ]}
      />
      {cur.mode === 'percent' && (
        <div style={{ marginTop: 10 }}>
          <NumField label="النسبة" kind="percent" value={cur.pct} onChange={(v) => edit({ pct: v })} error={error} testId={`${testId}-pct`} />
          <div className="field">
            <div className="label"><span>أساس النسبة</span>
              {cur.basisConfirmed ? <span className="badge b-list">أساس مؤكد</span> : <span className="badge b-missing">أساس غير مؤكد</span>}
            </div>
            <Seg<'loan' | 'price'>
              label="أساس النسبة"
              small
              value={cur.basis}
              onChange={(b) => edit({ basis: b, basisConfirmed: true })}
              options={[{ value: 'loan', label: 'مبلغ التمويل' }, { value: 'price', label: 'سعر السيارة' }]}
            />
            <label className="row small" style={{ marginTop: 8, minHeight: 44 }}>
              <input type="checkbox" className="check" checked={cur.basisConfirmed} onChange={(e) => edit({ basisConfirmed: e.target.checked })} />
              الأساس مؤكد من الجهة (يدخل المبلغ في الكاش)
            </label>
          </div>
        </div>
      )}
      {cur.mode === 'amount' && (
        <div style={{ marginTop: 10 }}>
          <NumField label="المبلغ" kind="money" value={cur.amount} onChange={(v) => edit({ amount: v })} error={error} testId={`${testId}-amount`} />
        </div>
      )}
      {cur.mode === 'unknown' && <div className="hint">يبقى البند ظاهراً كناقص، ولا يُحسب صفراً.</div>}
    </div>
  );
}

import type { CalcResult, CostResult } from '../engine/calc';
import type { Summary } from '../state/snapshot';
import { Money, Pct } from './common';
import { durationLabel } from '../lib/arabic';

const BASIS: Record<string, string> = { loan: 'على مبلغ التمويل', price: 'على سعر السيارة' };

export function RateBadge({ s }: { s: Pick<Summary, 'rateStatus' | 'listRateEdited'> }) {
  if (s.rateStatus === 'list') return <span className="badge b-list">{s.listRateEdited ? 'من القائمة (معدّلة في الإعدادات)' : 'من القائمة'}</span>;
  if (s.rateStatus === 'manual') return <span className="badge b-manual">معدّل يدوياً</span>;
  if (s.rateStatus === 'manual_required') return <span className="badge b-info">إدخال يدوي</span>;
  return <span className="badge b-none">لا يوجد سعر مطابق</span>;
}

function costText(c: CostResult, value: Summary['admin']['value']) {
  if (c.status === 'none') return <span>لا يوجد</span>;
  if (c.status === 'known') return <Money v={c.amount} />;
  if (c.status === 'estimate') return <span className="badge b-missing">تقدير <Money v={c.amount} /></span>;
  void value;
  return <span className="badge b-missing">غير محددة</span>;
}

function costSub(value: Summary['admin']['value']) {
  if (value.mode === 'percent') return <small><Pct v={value.pct} /> {BASIS[value.basis]}{value.basisConfirmed ? '' : ' (أساس غير مؤكد)'}</small>;
  if (value.mode === 'amount') return <small>مبلغ ثابت</small>;
  return null;
}

/** Summary of results. Every warning that changes a figure stays visible here (never inside a closed section). */
export function Results({ calc, s, compact }: { calc: CalcResult; s: Summary; compact?: boolean }) {
  const instalmentKnown = calc.ok && calc.monthly !== null;
  return (
    <div data-testid="results">
      <div className="result-hero">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="k">القسط الشهري</span>
          <span className="meta">{calc.ok && calc.months ? durationLabel(calc.months) : ''}</span>
        </div>
        {instalmentKnown ? (
          <div className="v" data-testid="monthly"><Money v={calc.monthly} /></div>
        ) : (
          <div className="v na" data-testid="monthly">
            {!calc.ok ? ([...new Set(calc.errors.map((e) => e.message))].join(' · ') || 'أكمل البيانات المطلوبة') : 'لا يمكن حساب القسط قبل تحديد النسبة'}
          </div>
        )}
        <div className="meta">
          {s.bankName}
          {s.programmeName ? ` · ${s.programmeName}` : ''}
          {s.insuranceLabel ? ` · ${s.insuranceLabel}` : ''} · {s.clientTypeLabel}
        </div>
      </div>

      {calc.ok && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="kv"><span className="k">المقدم</span><span className="v"><Money v={calc.downAmount} /> <span className="muted small">(<Pct v={calc.downPct} />)</span></span></div>
          <div className="kv"><span className="k">مبلغ التمويل</span><span className="v" data-testid="loan"><Money v={calc.loan} /></span></div>
          <div className="kv">
            <span className="k">النسبة السنوية الثابتة <small>على أصل مبلغ التمويل</small></span>
            <span className="v"><Pct v={s.rate} /> <RateBadge s={s} /></span>
          </div>
          {s.rateStatus === 'list' && s.listRateEdited && s.originalListRate !== null && (
            <div className="hint">القيمة في القائمة الأصلية: <Pct v={s.originalListRate} /></div>
          )}
          <div className={`cash-box${calc.cashComplete ? '' : ' incomplete'}`}>
            <div className="t">{calc.cashComplete ? 'المطلوب كاش عند الاستلام' : 'الكاش المعروف حتى الآن عند الاستلام'}</div>
            <div className="v" data-testid="cash"><Money v={calc.cashKnown} /></div>
            <div className="s">
              المقدم{calc.admin.status === 'known' ? ' + المصاريف' : ''}{calc.insurance.status === 'known' ? ' + التأمين' : ''}{calc.extra > 0 ? ' + الرسوم' : ''}
              {calc.cashbackDeducted > 0 ? ' − كاش باك عند الاستلام' : ''}
              {!calc.cashComplete ? ' (غير شامل البنود غير المحددة)' : ''}
            </div>
          </div>
          {!compact && (
            <>
              <div className="kv"><span className="k">المصاريف الإدارية {costSub(s.admin.value)}</span><span className="v">{costText(calc.admin, s.admin.value)}</span></div>
              <div className="kv"><span className="k">التأمين المطلوب عند الاستلام {costSub(s.insurance.value)}</span><span className="v">{costText(calc.insurance, s.insurance.value)}</span></div>
              {calc.extra > 0 && <div className="kv"><span className="k">{s.extra.label}</span><span className="v"><Money v={calc.extra} /></span></div>}
              {calc.cashbackSeparate > 0 && <div className="kv"><span className="k">كاش باك غير مخصوم <small>لاحق أو غير محدد التوقيت</small></span><span className="v"><Money v={calc.cashbackSeparate} /></span></div>}
              <div className="kv"><span className="k">إجمالي الفوائد/الربح</span><span className="v" data-testid="interest"><Money v={calc.interest} /></span></div>
              <div className="kv"><span className="k">إجمالي الأقساط</span><span className="v"><Money v={calc.totalInstallments} /></span></div>
              <div className="kv big">
                <span className="k">{calc.totalComplete ? 'إجمالي المدفوعات' : 'إجمالي المدفوعات المعروف'} <small>الكاش عند الاستلام + الأقساط{calc.totalComplete ? '' : '، غير شامل البنود غير المحددة'}</small></span>
                <span className="v" data-testid="total"><Money v={calc.totalKnown} /></span>
              </div>
              {calc.monthlyRounded !== null && calc.lastInstallment !== null && calc.lastInstallment !== calc.monthlyRounded && (
                <div className="hint">عند التقريب للقرش: {calc.months! - 1} قسطاً × <Money v={calc.monthlyRounded} /> والقسط الأخير <Money v={calc.lastInstallment} /></div>
              )}
            </>
          )}
        </div>
      )}

      {(calc.missing.length > 0 || s.matchReason || s.warnings.length > 0) && (
        <div className="alert alert-warn" data-testid="missing">
          {s.matchReason && <div><strong>لا يوجد سعر مطابق:</strong> {s.matchReason}</div>}
          {calc.missing.length > 0 && (
            <>
              <strong>بيانات تكلفة ناقصة</strong>
              <ul>{calc.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </>
          )}
          {s.warnings.length > 0 && <ul>{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
      {calc.ok && (calc.insurance.status !== 'none') && (
        <div className="hint">أي أقساط أو تجديدات تأمين لاحقة غير مشمولة في الإجماليات.</div>
      )}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { evaluate, newDraft, switchBank, bankList, type Draft } from '../state/draft';
import { summarize, makeSnapshot, quoteTitle } from '../state/snapshot';
import { buildShareText, whatsappUrl } from '../engine/share';
import { findBank, yearHasRate, variantLabel } from '../engine/ratebook';
import { formatMoneyNumber, formatPercent, round2 } from '../lib/num';
import { Money, NumField, Pct, Seg, Modal, copyText, navigate } from './common';
import { Results, RateBadge } from './Results';
import { CostEditor } from './CostEditor';
import { SaveDialog } from './SaveDialog';

export function Calculator() {
  const { book, original, draft: d, setDraft, toast, tariffError, activeTariff } = useApp();
  const ev = useMemo(() => evaluate(d, book, original), [d, book, original]);
  const summary = useMemo(() => summarize(d, ev), [d, ev]);
  const generated = useMemo(() => buildShareText(d, ev), [d, ev]);
  const shareText = d.shareTextOverride ?? generated;
  const textStale = d.shareTextOverride !== null && d.shareTextOverride !== generated;
  const [saving, setSaving] = useState(false);
  const [savedRequestId, setSavedRequestId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const undoRef = useRef<Draft | null>(null);

  const banks = bankList(book);
  const bank = findBank(book, d.bankId);
  const programmes = bank?.programmes ?? [];
  const p = ev.programme;
  const up = (patch: Partial<Draft>) => setDraft((x) => ({ ...x, ...patch }));

  const onBank = (id: string) => {
    const prev = d;
    const { draft, droppedEdits } = switchBank(d, id, book);
    setDraft(draft);
    if (droppedEdits) {
      undoRef.current = prev;
      toast('أُعيد تحميل افتراضات الجهة الجديدة، وأُزيلت تعديلاتك اليدوية على النسبة والمصاريف', {
        action: { label: 'تراجع', run: () => undoRef.current && setDraft(undoRef.current) },
      });
    }
  };

  const otherDown = (() => {
    if (d.downMode === 'percent') return ev.calc.downAmount !== null ? <>= <Money v={ev.calc.downAmount} /></> : null;
    return ev.calc.downPct !== null ? <>= <Pct v={round2(ev.calc.downPct * 1000) / 1000} /></> : null;
  })();
  const switchDownMode = (m: 'percent' | 'amount') => {
    if (m === d.downMode) return;
    if (m === 'amount') up({ downMode: 'amount', downAmount: ev.calc.downAmount !== null ? formatMoneyNumber(ev.calc.downAmount) : d.downAmount });
    else up({ downMode: 'percent', downPct: ev.calc.downPct !== null ? String(Math.round(ev.calc.downPct * 1000) / 1000) : d.downPct });
  };

  const maxYears = p?.maxYears ?? 10;
  const tierForChips = ev.match?.tier;
  const years = Array.from({ length: maxYears }, (_, i) => i + 1);

  const onSave = () => setSaving(true);
  const doWhatsapp = () => {
    window.open(whatsappUrl(shareText), '_blank', 'noopener');
  };
  const doCopy = async () => {
    toast((await copyText(shareText)) ? 'تم نسخ نص العرض' : 'تعذّر النسخ؛ انسخ النص يدوياً من الحقل', { kind: 'ok' });
  };
  const saved = savedRequestId === d.requestId;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>حاسبة تمويل السيارات</h1>
          <div className="sub">{activeTariff ? `القوائم: الإصدار ${activeTariff.version}${activeTariff.is_original ? ' (الأصل)' : ''}` : 'إدخال يدوي'}</div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>حسبة جديدة</button>
      </header>
      <main className="page">
        {tariffError && <div className="alert alert-warn">{tariffError}</div>}
        {d.parentQuoteId && <div className="alert alert-info">نسخة معدّلة من عرض محفوظ. العرض الأصلي لا يتغير.</div>}
        <div className="grid-calc">
          <div>
            <section className="card" aria-labelledby="h-bank">
              <h2 id="h-bank">الجهة والبرنامج</h2>
              <div className="field">
                <label className="label" htmlFor="bank">الجهة / البنك</label>
                <select id="bank" data-testid="bank" className="input" value={d.bankId} onChange={(e) => onBank(e.target.value)}>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.nameAr}{b.priced ? '' : ' · نسبة يدوية'}</option>)}
                </select>
              </div>
              {d.bankId === 'other' && (
                <div className="field">
                  <label className="label" htmlFor="custom-bank">اسم الجهة</label>
                  <input id="custom-bank" className="input" value={d.customBankName} onChange={(e) => up({ customBankName: e.target.value })} placeholder="اكتب اسم الجهة" maxLength={80} />
                </div>
              )}
              {programmes.length > 1 && (
                <div className="field">
                  <div className="label">البرنامج</div>
                  <Seg label="البرنامج" testId="programme" value={p?.id ?? ''} onChange={(v) => up({ programmeId: v, rateMode: 'auto', usedOrigin: '', modelYear: '' })}
                    options={programmes.map((x) => ({ value: x.id, label: x.nameAr }))} />
                  {p?.inspectionAr && <div className="hint">{p.inspectionAr}</div>}
                </div>
              )}
              {p?.insuranceChoice && (
                <div className="field">
                  <div className="label">خيار التأمين في القائمة</div>
                  <Seg label="خيار التأمين" testId="insurance-toggle" value={d.insurance} onChange={(v) => up({ insurance: v })}
                    options={[{ value: 'with', label: 'بتأمين' }, { value: 'without', label: 'بدون تأمين' }]} />
                </div>
              )}
              {p && !p.insuranceChoice && ev.match?.status === 'matched' && (
                <div className="hint">التأمين في هذه الشريحة: {variantLabel(ev.match.cell.insurance)}</div>
              )}
              <div className="field">
                <div className="label">نوع العميل{p?.clientRates === 'equal' ? <span className="aux">نفس الربح للفئتين</span> : p?.clientRates === 'unspecified' ? <span className="aux">القائمة لا تفصل الفئتين</span> : null}</div>
                <Seg label="نوع العميل" testId="client-type" value={d.clientType} onChange={(v) => up({ clientType: v })}
                  options={[{ value: 'employee', label: 'موظف' }, { value: 'business', label: 'صاحب عمل' }]} />
              </div>
              <div className="field">
                <div className="label">نوع السيارة</div>
                <Seg label="نوع السيارة" small value={d.bodyType} onChange={(v) => up({ bodyType: v })}
                  options={[{ value: 'private', label: 'ملاكي' }, { value: 'pickup', label: 'ربع نقل' }, { value: 'jumbo', label: 'جامبو' }]} />
              </div>
              {p?.promoAr && <div className="hint">عرض مذكور في القائمة: {p.promoAr}</div>}
            </section>

            <section className="card" aria-labelledby="h-price">
              <h2 id="h-price">السعر والمقدم</h2>
              <NumField label="سعر السيارة" kind="money" value={d.price} onChange={(v) => up({ price: v })} error={ev.fieldErrors.price} placeholder="مثال: 1,250,000" testId="price" />
              <div className="field">
                <div className="label"><span>المقدم</span><span className="aux">{otherDown}</span></div>
                <div className="row">
                  <div className="grow">
                    {d.downMode === 'percent' ? (
                      <NumField label={<span className="sr-only">نسبة المقدم</span>} kind="percent" value={d.downPct} onChange={(v) => up({ downPct: v })} error={ev.fieldErrors.down} testId="down-pct" />
                    ) : (
                      <NumField label={<span className="sr-only">مبلغ المقدم</span>} kind="money" value={d.downAmount} onChange={(v) => up({ downAmount: v })} error={ev.fieldErrors.down} testId="down-amount" />
                    )}
                  </div>
                </div>
                <Seg label="طريقة إدخال المقدم" small testId="down-mode" value={d.downMode} onChange={switchDownMode}
                  options={[{ value: 'percent', label: 'نسبة %' }, { value: 'amount', label: 'مبلغ' }]} />
                <div className="chips" role="group" aria-label="شرائح المقدم">
                  {ev.tiers.map((t) => (
                    <button type="button" key={t} className="chip" data-testid={`tier-${t}`}
                      aria-pressed={d.downMode === 'percent' && Number(d.downPct) === t}
                      onClick={() => up({ downMode: 'percent', downPct: String(t) })}>{t}%</button>
                  ))}
                </div>
                <div className="hint">
                  {d.downMode === 'percent' ? 'المقدم محفوظ كنسبة: يتغير المبلغ إذا تغيّر السعر.' : 'المقدم محفوظ كمبلغ ثابت: تتغير النسبة إذا تغيّر السعر.'}
                </div>
                {ev.calc.fullCash && <div className="alert alert-info">مقدم 100%: سداد نقدي كامل، لا تمويل ولا أقساط.</div>}
              </div>
            </section>

            <section className="card" aria-labelledby="h-term">
              <h2 id="h-term">المدة والنسبة</h2>
              <div className="field">
                <div className="label"><span>المدة بالسنوات</span>
                  <button type="button" className="btn-link" onClick={() => up({ termMode: d.termMode === 'years' ? 'months' : 'years', monthsText: d.termMode === 'years' ? String(d.years * 12) : d.monthsText })}>
                    {d.termMode === 'years' ? 'إدخال بالشهور' : 'اختيار بالسنوات'}
                  </button>
                </div>
                {d.termMode === 'years' ? (
                  <div className="years" role="group" aria-label="المدة بالسنوات" data-testid="years">
                    {years.map((y) => {
                      const has = p && tierForChips !== undefined ? yearHasRate(p, d.clientType, d.insurance, tierForChips, y) : true;
                      return (
                        <button type="button" key={y} aria-pressed={d.years === y} className={has ? '' : 'norate'}
                          aria-label={`${y} ${has ? '' : '(لا سعر في القائمة)'}`} onClick={() => up({ years: y })}>{y}</button>
                      );
                    })}
                  </div>
                ) : (
                  <NumField label={<span className="sr-only">عدد الأشهر</span>} kind="int" value={d.monthsText} onChange={(v) => up({ monthsText: v })} error={ev.fieldErrors.months}
                    hint="المدد الجزئية لا تُطابق قوائم مسعّرة بالسنوات؛ أدخل النسبة يدوياً عندها." testId="months" />
                )}
                {p?.tenureNote && <div className="hint">{p.tenureNote}</div>}
              </div>

              <div className="field" data-testid="rate-block">
                <div className="label"><span>النسبة السنوية الثابتة</span><RateBadge s={summary} /></div>
                {ev.priced && d.rateMode === 'auto' && ev.listRate !== null ? (
                  <div className="row">
                    <div className="grow" style={{ fontSize: 22, fontWeight: 800 }} data-testid="rate-value"><Pct v={ev.listRate} /></div>
                    <button type="button" className="btn btn-ghost" onClick={() => up({ rateMode: 'manual', manualRate: String(ev.listRate) })}>تعديل يدوي</button>
                  </div>
                ) : (
                  <>
                    {ev.priced && d.rateMode === 'auto' && ev.match?.status === 'none' && (
                      <div className="alert alert-warn">لا يوجد سعر مطابق: {ev.match.reason}. أدخل النسبة يدوياً إن كانت معروفة.</div>
                    )}
                    <NumField label={<span className="sr-only">النسبة السنوية</span>} kind="percent" value={d.manualRate}
                      onChange={(v) => up({ manualRate: v, rateMode: 'manual' })} error={ev.fieldErrors.rate} placeholder="مثال: 14.5" testId="rate"
                      hint="نسبة سنوية ثابتة على أصل مبلغ التمويل. 14.25 تعني 14.25%." />
                    {ev.priced && d.rateMode === 'manual' && (
                      <button type="button" className="btn-link" data-testid="restore-rate" onClick={() => up({ rateMode: 'auto', manualRate: '' })}>
                        {ev.listRate !== null ? `استعادة سعر القائمة (${formatPercent(ev.listRate)})` : 'العودة للاختيار من القائمة'}
                      </button>
                    )}
                  </>
                )}
                {ev.notes.length > 0 && <ul className="notes">{ev.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </div>
            </section>

            {p?.segment === 'used' && (
              <section className="card" aria-labelledby="h-used">
                <h2 id="h-used">شروط السيارة المستعملة</h2>
                <div className="field">
                  <label className="label" htmlFor="origin">منشأ السيارة</label>
                  <select id="origin" className="input" value={d.usedOrigin} onChange={(e) => up({ usedOrigin: e.target.value as Draft['usedOrigin'] })}>
                    <option value="">اختر</option>
                    {p.usedRules?.map((r) => <option key={r.id} value={r.id}>{r.labelAr}</option>)}
                  </select>
                </div>
                <NumField label="سنة الموديل" kind="int" value={d.modelYear} onChange={(v) => up({ modelYear: v })} error={ev.fieldErrors.modelYear} placeholder="مثال: 2019" />
                {p.usedRules?.filter((r) => r.id === d.usedOrigin).map((r) => (
                  <div className="alert alert-info" key={r.id}>
                    <strong>نص القائمة:</strong>
                    <ul>{r.rawText.map((t) => <li key={t}>{t}</li>)}</ul>
                    <div className="small">{r.status}</div>
                  </div>
                ))}
                {p.usedGiftNote && <div className="hint">{p.usedGiftNote}</div>}
              </section>
            )}

            <details className="fold" data-testid="costs-fold">
              <summary>
                <span>المصاريف والتأمين والرسوم</span>
                {(ev.calc.admin.status === 'unknown' || ev.calc.insurance.status === 'unknown' || ev.calc.admin.status === 'estimate' || ev.calc.insurance.status === 'estimate')
                  ? <span className="badge b-missing">بيانات ناقصة</span> : <span className="badge b-list">مكتملة</span>}
              </summary>
              <div className="body">
                <CostEditor title="المصاريف الإدارية" testId="admin" draft={d.admin} effective={ev.admin.value} note={ev.admin.note} error={ev.fieldErrors.admin}
                  fallbackBasis="loan" onChange={(c) => up({ admin: c })} />
                <CostEditor title="التأمين المطلوب عند الاستلام" testId="insurance" draft={d.insuranceCost} effective={ev.insurance.value} note={ev.insurance.note}
                  error={ev.fieldErrors.insurance} fallbackBasis="price" onChange={(c) => up({ insuranceCost: c })} noneLabel="لا يوجد تأمين" />
                <div className="cost-block">
                  <div className="head">
                    <span>رسوم إضافية / كود مرور</span>
                    {d.extraEdited ? (
                      <span className="row"><span className="badge b-manual">معدّل يدوياً</span>
                        <button type="button" className="btn-link" onClick={() => up({ extraEdited: false })}>استعادة الافتراضي</button></span>
                    ) : ev.extra.amount > 0 ? <span className="badge b-list">من القائمة</span> : null}
                  </div>
                  <NumField label={<span className="sr-only">قيمة الرسوم الإضافية</span>} kind="money" testId="extra"
                    value={d.extraEdited ? d.extraAmount : ev.extra.amount ? formatMoneyNumber(ev.extra.amount) : ''}
                    onChange={(v) => up({ extraEdited: true, extraAmount: v, extraLabel: ev.extra.label })} error={ev.fieldErrors.extra}
                    hint={ev.extra.note ?? 'تُضاف إلى الكاش عند الاستلام.'} placeholder="0" />
                </div>
                <div className="cost-block">
                  <div className="head"><span>كاش باك (اختياري)</span></div>
                  <NumField label={<span className="sr-only">قيمة الكاش باك</span>} kind="money" value={d.cashbackAmount} onChange={(v) => up({ cashbackAmount: v })} error={ev.fieldErrors.cashback} placeholder="0" />
                  <Seg label="توقيت الكاش باك" small value={d.cashbackTiming} onChange={(v) => up({ cashbackTiming: v })}
                    options={[{ value: 'later', label: 'لاحق' }, { value: 'unknown', label: 'غير محدد' }, { value: 'at_delivery', label: 'يُخصم عند الاستلام' }]} />
                  <div className="hint">لا يُخصم من الكاش إلا إذا تأكد خصمه عند الاستلام.</div>
                </div>
              </div>
            </details>
          </div>

          <div className="sticky">
            <Results calc={ev.calc} s={summary} />
            <details className="fold no-print" data-testid="share-fold">
              <summary><span>نص رسالة واتساب</span>{d.shareTextOverride !== null && <span className="badge b-manual">معدّل يدوياً</span>}</summary>
              <div className="body">
                {textStale && (
                  <div className="alert alert-warn">النص معدّل يدوياً ولا يعكس آخر تغييرات الأرقام.
                    <button type="button" className="btn-link" onClick={() => up({ shareTextOverride: null })}>إعادة توليد النص</button>
                  </div>
                )}
                <label className="sr-only" htmlFor="share-text">نص الرسالة</label>
                <textarea id="share-text" data-testid="share-text" className="input" value={shareText} onChange={(e) => up({ shareTextOverride: e.target.value })} />
                <div className="row" style={{ marginTop: 8 }}>
                  {d.shareTextOverride !== null && <button type="button" className="btn btn-ghost" onClick={() => up({ shareTextOverride: null })}>إعادة توليد النص</button>}
                  <button type="button" className="btn btn-ghost" onClick={() => window.print()}>طباعة / PDF</button>
                </div>
                <div className="hint">النسخ والمشاركة يستخدمان هذا النص كما هو معروض.</div>
              </div>
            </details>
            <div className="field">
              <label className="label" htmlFor="client-name">اسم العميل في الرسالة (اختياري)</label>
              <input id="client-name" className="input" value={d.clientName} maxLength={80} onChange={(e) => up({ clientName: e.target.value })} placeholder="بدون اسم" />
            </div>
          </div>
        </div>
      </main>

      <div className="livebar no-print" data-testid="livebar" aria-live="polite">
        <span>القسط: <strong>{ev.calc.ok && ev.calc.monthly !== null ? <Money v={ev.calc.monthly} /> : '—'}</strong></span>
        <span>{ev.calc.cashComplete ? 'الكاش' : 'الكاش المعروف'}: <strong>{ev.calc.ok ? <Money v={ev.calc.cashKnown} /> : '—'}</strong>
          {ev.calc.ok && !ev.calc.cashComplete && <span className="badge b-missing" style={{ marginInlineStart: 4 }}>ناقص</span>}</span>
      </div>
      <div className="actionbar no-print" data-testid="actionbar">
        <button type="button" className="btn btn-wa" onClick={doWhatsapp} data-testid="wa">واتساب</button>
        <button type="button" className="btn btn-ghost" onClick={doCopy} data-testid="copy">نسخ</button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!ev.calc.ok || saved} data-testid="save">{saved ? 'محفوظ ✓' : 'حفظ'}</button>
      </div>

      {saving && (
        <SaveDialog
          title={quoteTitle({ summary } as never)}
          defaultClientId={d.clientId}
          defaultClientName={d.clientName}
          onClose={() => setSaving(false)}
          makeSnapshot={() => makeSnapshot(d, ev, shareText, d.shareTextOverride !== null, activeTariff ? { id: activeTariff.id, version: activeTariff.version, label: activeTariff.label } : null)}
          requestId={d.requestId}
          parentQuoteId={d.parentQuoteId}
          tariffVersionId={activeTariff?.id ?? null}
          onSaved={(id, clientId) => {
            setSavedRequestId(d.requestId);
            setSaving(false);
            setDraft((x) => ({ ...x, clientId }));
            toast('تم حفظ العرض', { action: { label: 'فتح', run: () => navigate(`/quotes/${id}`) } });
          }}
        />
      )}
      {confirmReset && (
        <Modal title="بدء حسبة جديدة؟" onClose={() => setConfirmReset(false)}>
          <p>ستُمسح المدخلات الحالية من الحاسبة. العروض المحفوظة لا تتأثر.</p>
          <div className="two">
            <button type="button" className="btn btn-primary" onClick={() => { const prev = d; setDraft({ ...newDraft(d.bankId), programmeId: d.programmeId }); setConfirmReset(false); undoRef.current = prev; toast('بدأت حسبة جديدة', { action: { label: 'تراجع', run: () => undoRef.current && setDraft(undoRef.current) } }); }}>نعم، ابدأ</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </>
  );
}

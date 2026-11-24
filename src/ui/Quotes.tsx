import { useMemo, useState } from 'react';
import { useApp, errMsg } from './AppContext';
import { isSnapshot, quoteTitle, draftFromSnapshot, type QuoteSnapshot } from '../state/snapshot';
import { Money, Pct, Modal, copyText, fmtDate, navigate } from './common';
import { Results } from './Results';
import { whatsappUrl } from '../engine/share';
import { durationLabel } from '../lib/arabic';
import { normName } from './SaveDialog';
import type { QuoteRow } from '../data/backend';

function snap(q: QuoteRow): QuoteSnapshot | null {
  return isSnapshot(q.snapshot) ? q.snapshot : null;
}

export function QuotesList() {
  const { quotes, clients, dataError, refreshQuotes } = useApp();
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const clientName = (id: string | null) => (id ? clients?.find((c) => c.id === id)?.name : undefined);
  const list = useMemo(() => {
    const n = normName(q);
    return (quotes ?? []).filter((r) => {
      if (!n) return true;
      const s = snap(r);
      const hay = normName([clientName(r.client_id), s?.summary.bankName, s?.summary.programmeName, r.title, s?.draft.clientName].filter(Boolean).join(' '));
      return hay.includes(n);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, clients, q]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));

  return (
    <>
      <header className="topbar">
        <h1>العروض المحفوظة</h1>
        <button type="button" className="btn btn-ghost" onClick={() => { setSelecting(!selecting); setSel([]); }}>{selecting ? 'إلغاء المقارنة' : 'مقارنة'}</button>
      </header>
      <main className="page narrow">
        {dataError && <div className="alert alert-err">{dataError} <button className="btn-link" onClick={() => void refreshQuotes()}>إعادة المحاولة</button></div>}
        <input className="input" placeholder="بحث باسم العميل أو الجهة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث في العروض" style={{ marginBottom: 10 }} />
        {selecting && (
          <div className="alert alert-info row" style={{ justifyContent: 'space-between' }}>
            <span>اختر عرضين أو ثلاثة ({sel.length}/3)</span>
            <button type="button" className="btn btn-primary" disabled={sel.length < 2} onClick={() => navigate(`/compare/${sel.join(',')}`)} data-testid="do-compare">قارن</button>
          </div>
        )}
        {quotes === null && !dataError && <div className="empty">جارٍ التحميل…</div>}
        {quotes && list.length === 0 && <div className="empty">لا توجد عروض محفوظة{q ? ' مطابقة' : ''}. احفظ عرضاً من الحاسبة.</div>}
        {list.map((r) => {
          const s = snap(r);
          const content = (
            <>
              <div className="r">
                <span className="t">{s ? quoteTitle(s) : 'عرض'}</span>
                <span className="t">{s?.calc.monthly != null ? <Money v={s.calc.monthly} /> : <span className="badge b-none">بلا قسط</span>}</span>
              </div>
              <div className="s">
                {[clientName(r.client_id), s?.calc.price ? undefined : undefined, s?.calc.months ? durationLabel(s.calc.months) : undefined, fmtDate(r.created_at)].filter(Boolean).join(' · ')}
              </div>
              {s && (!s.calc.cashComplete) && <span className="badge b-missing">بيانات ناقصة</span>}
              {r.title && <div className="s">{r.title}</div>}
            </>
          );
          return selecting ? (
            <label key={r.id} className={`list-item${sel.includes(r.id) ? ' selected' : ''}`}>
              <div className="row"><input type="checkbox" className="check" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /><div className="grow">{content}</div></div>
            </label>
          ) : (
            <a key={r.id} className="list-item" href={`#/quotes/${r.id}`}>{content}</a>
          );
        })}
      </main>
    </>
  );
}

export function QuoteView({ id }: { id: string }) {
  const { quotes, clients, backend, refreshQuotes, setDraft, book, original, toast } = useApp();
  const row = quotes?.find((q) => q.id === id);
  const [confirmDel, setConfirmDel] = useState(false);
  const [linking, setLinking] = useState(false);
  if (quotes === null) return <main className="page"><div className="empty">جارٍ التحميل…</div></main>;
  if (!row) return <main className="page narrow"><div className="empty">العرض غير موجود. <a href="#/quotes">العودة للعروض</a></div></main>;
  const s = snap(row);
  if (!s) return <main className="page narrow"><div className="alert alert-err">بيانات العرض غير صالحة.</div></main>;
  const client = row.client_id ? clients?.find((c) => c.id === row.client_id) : undefined;

  const modify = () => {
    const { draft, notices } = draftFromSnapshot(s, row.id, book, original);
    setDraft(draft);
    navigate('/');
    toast(notices.length ? notices.join('. ') : 'تم فتح نسخة معدّلة في الحاسبة');
  };
  const del = async () => {
    try { await backend.deleteQuote(row.id); await refreshQuotes(); navigate('/quotes'); toast('تم حذف العرض'); } catch (e) { toast(errMsg(e), { kind: 'err' }); }
  };
  const link = async (cid: string | null) => {
    try { await backend.updateQuote(row.id, { client_id: cid }); await refreshQuotes(); setLinking(false); toast('تم تحديث العميل'); } catch (e) { toast(errMsg(e), { kind: 'err' }); }
  };

  return (
    <>
      <header className="topbar">
        <div><h1>{quoteTitle(s)}</h1><div className="sub">محفوظ {fmtDate(row.created_at)}</div></div>
        <a className="btn btn-ghost no-print" href="#/quotes">رجوع</a>
      </header>
      <main className="page narrow" data-testid="quote-view">
        <div className="print-only"><h2>عرض تمويل تقديري</h2></div>
        <div className="alert alert-info small no-print">نسخة محفوظة ثابتة. تغيير القوائم لاحقاً لا يغيّرها.</div>
        <div className="card">
          <div className="kv"><span className="k">العميل</span><span className="v">{client ? <a href={`#/clients/${client.id}`}>{client.name}</a> : s.draft.clientName || 'بدون'}</span></div>
          <div className="kv"><span className="k">سعر السيارة</span><span className="v"><Money v={s.calc.price} /></span></div>
          <div className="kv"><span className="k">نوع السيارة / العميل</span><span className="v">{s.summary.bodyTypeLabel} · {s.summary.clientTypeLabel}</span></div>
          {s.summary.inspection && <div className="kv"><span className="k">الاستعلام</span><span className="v">{s.summary.inspection}</span></div>}
          <div className="kv"><span className="k">مصدر النسبة</span><span className="v">{s.summary.rateStatus === 'list' ? `القائمة${s.tariff ? ` (الإصدار ${s.tariff.version})` : ''}` : s.summary.rateStatus === 'manual' || s.summary.rateStatus === 'manual_required' ? 'إدخال يدوي' : 'لا يوجد سعر'}</span></div>
          {s.summary.manualEdits.length > 0 && <div className="kv"><span className="k">تعديلات يدوية</span><span className="v">{s.summary.manualEdits.join('، ')}</span></div>}
          {row.title && <div className="kv"><span className="k">ملاحظة</span><span className="v">{row.title}</span></div>}
        </div>
        <Results calc={s.calc} s={s.summary} />
        {s.summary.notes.length > 0 && <ul className="notes">{s.summary.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <div className="card">
          <h2>نص الرسالة المحفوظ {s.shareTextEdited && <span className="badge b-manual">معدّل يدوياً</span>}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }} data-testid="saved-text">{s.shareText}</pre>
        </div>
        <div className="two no-print">
          <a className="btn btn-wa" href={whatsappUrl(s.shareText)} target="_blank" rel="noopener">واتساب</a>
          <button type="button" className="btn btn-ghost" onClick={async () => toast((await copyText(s.shareText)) ? 'تم النسخ' : 'تعذّر النسخ')}>نسخ</button>
          <button type="button" className="btn btn-primary" onClick={modify} data-testid="modify">نسخة معدّلة</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>طباعة / PDF</button>
          <button type="button" className="btn btn-ghost" onClick={() => setLinking(true)}>{client ? 'تغيير العميل' : 'ربط بعميل'}</button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>حذف</button>
        </div>
      </main>
      {confirmDel && (
        <Modal title="حذف العرض؟" onClose={() => setConfirmDel(false)}>
          <p>سيُحذف هذا العرض نهائياً.</p>
          <div className="two"><button className="btn btn-danger" onClick={del}>حذف</button><button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>إلغاء</button></div>
        </Modal>
      )}
      {linking && (
        <Modal title="ربط العرض بعميل" onClose={() => setLinking(false)}>
          {(clients ?? []).length === 0 && <p className="muted">لا يوجد عملاء محفوظون. أضف عميلاً من صفحة العملاء.</p>}
          {(clients ?? []).map((c) => (
            <button key={c.id} type="button" className={`list-item${c.id === row.client_id ? ' selected' : ''}`} onClick={() => link(c.id)}>
              <div className="t">{c.name}</div>{c.contact && <div className="s"><bdi dir="ltr">{c.contact}</bdi></div>}
            </button>
          ))}
          {row.client_id && <button type="button" className="btn btn-ghost btn-block" onClick={() => link(null)}>إزالة الربط</button>}
        </Modal>
      )}
    </>
  );
}

export function Compare({ ids }: { ids: string[] }) {
  const { quotes } = useApp();
  if (quotes === null) return <main className="page"><div className="empty">جارٍ التحميل…</div></main>;
  const rows = ids.map((id) => quotes.find((q) => q.id === id)).filter((x): x is QuoteRow => !!x).map((r) => ({ r, s: snap(r)! })).filter((x) => x.s);
  if (rows.length < 2) return <main className="page narrow"><div className="empty">اختر عرضين على الأقل. <a href="#/quotes">العروض</a></div></main>;
  const line = (label: string, f: (s: QuoteSnapshot) => React.ReactNode) => (
    <tr><th scope="row">{label}</th>{rows.map(({ r, s }) => <td key={r.id}>{f(s)}</td>)}</tr>
  );
  const unknowns = (s: QuoteSnapshot) => {
    const u = s.calc.missing.map((m) => m.split(':')[0]);
    return u.length ? u.join('، ') : 'لا يوجد';
  };
  return (
    <>
      <header className="topbar"><h1>مقارنة العروض</h1><a className="btn btn-ghost" href="#/quotes">رجوع</a></header>
      <main className="page" data-testid="compare">
        <div className="alert alert-info small">المقارنة لا ترتّب العروض. القسط الأقل لا يعني التكلفة الأقل؛ راجع الكاش والمدة والإجمالي والبنود غير المحددة.</div>
        <div className="card" style={{ padding: 8 }}>
          <table className="cmp">
            <thead><tr><th></th>{rows.map(({ r, s }) => <td key={r.id}><a href={`#/quotes/${r.id}`}>{quoteTitle(s)}</a></td>)}</tr></thead>
            <tbody>
              {line('السعر', (s) => <Money v={s.calc.price} suffix={false} />)}
              {line('المقدم', (s) => <Money v={s.calc.downAmount} suffix={false} />)}
              {line('التمويل', (s) => <Money v={s.calc.loan} suffix={false} />)}
              {line('المدة', (s) => (s.calc.months ? durationLabel(s.calc.months) : '—'))}
              {line('النسبة', (s) => <Pct v={s.summary.rate} />)}
              {line('القسط', (s) => <Money v={s.calc.monthly} suffix={false} />)}
              {line('الكاش عند الاستلام', (s) => <>{<Money v={s.calc.cashKnown} suffix={false} />}{!s.calc.cashComplete && <div className="badge b-missing">معروف حتى الآن</div>}</>)}
              {line('إجمالي الأقساط', (s) => <Money v={s.calc.totalInstallments} suffix={false} />)}
              {line('إجمالي المدفوعات', (s) => <>{<Money v={s.calc.totalKnown} suffix={false} />}{!s.calc.totalComplete && <div className="badge b-missing">غير شامل</div>}</>)}
              {line('بنود غير محددة', unknowns)}
            </tbody>
          </table>
          <div className="hint">المبالغ بالجنيه المصري.</div>
        </div>
      </main>
    </>
  );
}

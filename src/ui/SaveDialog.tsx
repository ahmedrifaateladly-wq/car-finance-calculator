import { useMemo, useRef, useState } from 'react';
import { useApp, errMsg } from './AppContext';
import { Modal } from './common';
import type { QuoteSnapshot } from '../state/snapshot';

export function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
}

export function SaveDialog(props: {
  title: string;
  defaultClientId: string | null;
  defaultClientName: string;
  requestId: string;
  parentQuoteId: string | null;
  tariffVersionId: string | null;
  makeSnapshot: () => QuoteSnapshot;
  onClose: () => void;
  onSaved: (quoteId: string, clientId: string | null) => void;
}) {
  const { backend, clients, refreshClients, refreshQuotes } = useApp();
  const [mode, setMode] = useState<'none' | 'existing' | 'new'>(props.defaultClientId ? 'existing' : props.defaultClientName ? 'new' : 'none');
  const [clientId, setClientId] = useState<string | null>(props.defaultClientId);
  const [q, setQ] = useState('');
  const [name, setName] = useState(props.defaultClientName);
  const [contact, setContact] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const matches = useMemo(() => {
    const n = normName(q);
    return (clients ?? []).filter((c) => !n || normName(c.name).includes(n) || c.contact.includes(q.trim())).slice(0, 8);
  }, [clients, q]);
  const duplicate = useMemo(() => {
    if (mode !== 'new' || !name.trim()) return undefined;
    return (clients ?? []).find((c) => normName(c.name) === normName(name) && (!contact.trim() || !c.contact || c.contact === contact.trim()));
  }, [clients, mode, name, contact]);

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      let cid: string | null = null;
      if (mode === 'existing') cid = clientId;
      if (mode === 'new') {
        if (!name.trim()) throw new Error('اكتب اسم العميل أو اختر «بدون عميل»');
        const c = await backend.createClient({ name: name.trim(), contact: contact.trim(), notes: '' });
        cid = c.id;
        // A retry after a failed quote save must not create the client twice.
        setMode('existing');
        setClientId(c.id);
        void refreshClients();
      }
      const row = await backend.saveQuote({
        request_id: props.requestId,
        client_id: cid,
        parent_quote_id: props.parentQuoteId,
        tariff_version_id: props.tariffVersionId,
        title: title.trim(),
        snapshot: props.makeSnapshot(),
      });
      await refreshQuotes();
      props.onSaved(row.id, cid);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : errMsg(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="حفظ العرض" onClose={props.onClose}>
      <p className="muted small" style={{ marginTop: -6 }}>{props.title}. يُحفظ العرض كلقطة ثابتة بكل المدخلات والنتائج ومصدر النسبة.</p>
      <div className="field">
        <div className="label">ربط بعميل (اختياري)</div>
        <div className="seg small" role="group" aria-label="ربط بعميل">
          <button type="button" aria-pressed={mode === 'none'} onClick={() => setMode('none')}>بدون عميل</button>
          <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>عميل محفوظ</button>
          <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>عميل جديد</button>
        </div>
      </div>
      {mode === 'existing' && (
        <div className="field">
          <input className="input" placeholder="ابحث بالاسم أو الهاتف" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن عميل" />
          <div style={{ marginTop: 8 }}>
            {matches.length === 0 && <div className="hint">لا يوجد عميل مطابق.</div>}
            {matches.map((c) => (
              <button type="button" key={c.id} className={`list-item${clientId === c.id ? ' selected' : ''}`} onClick={() => setClientId(c.id)} aria-pressed={clientId === c.id}>
                <div className="t">{c.name}</div>
                {c.contact && <div className="s"><bdi dir="ltr">{c.contact}</bdi></div>}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === 'new' && (
        <>
          <div className="field">
            <label className="label" htmlFor="nc-name">اسم العميل</label>
            <input id="nc-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="nc-contact">وسيلة تواصل (اختياري)</label>
            <input id="nc-contact" className="input" inputMode="tel" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} />
          </div>
          {duplicate && (
            <div className="alert alert-warn">
              يوجد عميل محفوظ بنفس الاسم: {duplicate.name}.{' '}
              <button type="button" className="btn-link" onClick={() => { setMode('existing'); setClientId(duplicate.id); }}>استخدم العميل المحفوظ</button>
            </div>
          )}
        </>
      )}
      <div className="field">
        <label className="label" htmlFor="q-title">ملاحظة قصيرة على العرض (اختياري)</label>
        <input id="q-title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: الفئة الأعلى" />
      </div>
      {error && <div className="alert alert-err" role="alert">{error}</div>}
      <div className="two">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (mode === 'existing' && !clientId)} data-testid="confirm-save">{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        <button type="button" className="btn btn-ghost" onClick={props.onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}

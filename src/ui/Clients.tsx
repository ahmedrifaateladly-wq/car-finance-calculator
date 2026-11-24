import { useMemo, useState } from 'react';
import { useApp, errMsg } from './AppContext';
import { Modal, Money, fmtDate, navigate } from './common';
import { normName } from './SaveDialog';
import { isSnapshot, quoteTitle } from '../state/snapshot';
import { newDraft } from '../state/draft';
import type { ClientRow } from '../data/backend';

function ClientForm({ initial, onDone, onCancel }: { initial?: ClientRow; onDone: (c: ClientRow | null) => void; onCancel: () => void }) {
  const { backend, clients, refreshClients } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dup = useMemo(
    () => (clients ?? []).find((c) => c.id !== initial?.id && normName(c.name) === normName(name) && (!contact.trim() || !c.contact || c.contact === contact.trim())),
    [clients, name, contact, initial],
  );
  const save = async () => {
    if (!name.trim()) { setError('اكتب اسم العميل'); return; }
    setBusy(true); setError(null);
    try {
      if (initial) { await backend.updateClient(initial.id, { name: name.trim(), contact: contact.trim(), notes: notes.trim() }); await refreshClients(); onDone(null); }
      else { const c = await backend.createClient({ name: name.trim(), contact: contact.trim(), notes: notes.trim() }); await refreshClients(); onDone(c); }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="field"><label className="label" htmlFor="c-name">الاسم</label><input id="c-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label className="label" htmlFor="c-contact">وسيلة تواصل (اختياري)</label><input id="c-contact" className="input" inputMode="tel" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} /></div>
      <div className="field"><label className="label" htmlFor="c-notes">ملاحظات (اختياري)</label><textarea id="c-notes" className="input" style={{ minHeight: 90 }} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: يفضّل التواصل مساءً" /></div>
      <div className="hint" style={{ marginBottom: 10 }}>لا تُسجّل الرقم القومي أو بيانات غير لازمة.</div>
      {dup && <div className="alert alert-warn">يوجد عميل محفوظ بنفس الاسم: <a href={`#/clients/${dup.id}`}>{dup.name}</a></div>}
      {error && <div className="alert alert-err">{error}</div>}
      <div className="two"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button><button className="btn btn-ghost" onClick={onCancel}>إلغاء</button></div>
    </>
  );
}

export function ClientsList() {
  const { clients, quotes, dataError, refreshClients } = useApp();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => {
    const n = normName(q);
    return (clients ?? []).filter((c) => !n || normName(c.name).includes(n) || c.contact.includes(q.trim()));
  }, [clients, q]);
  const count = (id: string) => (quotes ?? []).filter((x) => x.client_id === id).length;
  return (
    <>
      <header className="topbar"><h1>العملاء</h1><button className="btn btn-primary" onClick={() => setAdding(true)}>عميل جديد</button></header>
      <main className="page narrow">
        {dataError && <div className="alert alert-err">{dataError} <button className="btn-link" onClick={() => void refreshClients()}>إعادة المحاولة</button></div>}
        <input className="input" placeholder="بحث بالاسم أو وسيلة التواصل" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن عميل" style={{ marginBottom: 10 }} />
        {clients === null && !dataError && <div className="empty">جارٍ التحميل…</div>}
        {clients && list.length === 0 && <div className="empty">لا يوجد عملاء{q ? ' مطابقون' : ''}. سجل العميل اختياري؛ يمكن الحساب والحفظ بدونه.</div>}
        {list.map((c) => (
          <a key={c.id} className="list-item" href={`#/clients/${c.id}`}>
            <div className="r"><span className="t">{c.name}</span><span className="s">{count(c.id)} عرض</span></div>
            {c.contact && <div className="s"><bdi dir="ltr">{c.contact}</bdi></div>}
          </a>
        ))}
      </main>
      {adding && <Modal title="عميل جديد" onClose={() => setAdding(false)}><ClientForm onCancel={() => setAdding(false)} onDone={(c) => { setAdding(false); if (c) navigate(`/clients/${c.id}`); }} /></Modal>}
    </>
  );
}

export function ClientView({ id }: { id: string }) {
  const { clients, quotes, backend, refreshClients, refreshQuotes, setDraft, draft, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const c = clients?.find((x) => x.id === id);
  if (clients === null) return <main className="page"><div className="empty">جارٍ التحميل…</div></main>;
  if (!c) return <main className="page narrow"><div className="empty">العميل غير موجود. <a href="#/clients">العملاء</a></div></main>;
  const qs = (quotes ?? []).filter((q) => q.client_id === id);
  const newCalc = () => {
    setDraft({ ...newDraft(draft.bankId), programmeId: draft.programmeId, clientId: c.id, clientName: c.name });
    navigate('/');
  };
  const del = async () => {
    try { await backend.deleteClient(c.id); await Promise.all([refreshClients(), refreshQuotes()]); navigate('/clients'); toast('تم حذف العميل، وبقيت عروضه بدون ربط'); } catch (e) { toast(errMsg(e), { kind: 'err' }); }
  };
  return (
    <>
      <header className="topbar"><h1>{c.name}</h1><a className="btn btn-ghost" href="#/clients">رجوع</a></header>
      <main className="page narrow">
        <div className="card">
          {c.contact && <div className="kv"><span className="k">التواصل</span><span className="v"><bdi dir="ltr">{c.contact}</bdi></span></div>}
          {c.notes && <div className="kv"><span className="k">ملاحظات</span><span className="v" style={{ whiteSpace: 'pre-wrap', textAlign: 'start' }}>{c.notes}</span></div>}
          <div className="kv"><span className="k">آخر تحديث</span><span className="v">{fmtDate(c.updated_at)}</span></div>
        </div>
        <div className="two" style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={newCalc}>حسبة جديدة له</button>
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>تعديل</button>
        </div>
        <h2 style={{ fontSize: 15 }}>عروضه ({qs.length})</h2>
        {qs.length === 0 && <div className="empty">لا توجد عروض مرتبطة.</div>}
        {qs.map((r) => {
          const s = isSnapshot(r.snapshot) ? r.snapshot : null;
          return (
            <a key={r.id} className="list-item" href={`#/quotes/${r.id}`}>
              <div className="r"><span className="t">{s ? quoteTitle(s) : 'عرض'}</span><span className="t"><Money v={s?.calc.monthly ?? null} /></span></div>
              <div className="s">{fmtDate(r.created_at)}</div>
            </a>
          );
        })}
        <div className="sep" />
        <button className="btn btn-danger btn-block" onClick={() => setConfirmDel(true)}>حذف العميل</button>
      </main>
      {editing && <Modal title="تعديل العميل" onClose={() => setEditing(false)}><ClientForm initial={c} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} /></Modal>}
      {confirmDel && (
        <Modal title="حذف العميل؟" onClose={() => setConfirmDel(false)}>
          <p>يُحذف سجل العميل فقط، وتبقى عروضه المحفوظة بدون ربط.</p>
          <div className="two"><button className="btn btn-danger" onClick={del}>حذف</button><button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>إلغاء</button></div>
        </Modal>
      )}
    </>
  );
}

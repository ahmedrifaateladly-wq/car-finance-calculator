import { useEffect, useMemo, useState } from 'react';
import { useApp, errMsg } from './AppContext';
import { Modal, Seg, fmtDate } from './common';
import { CostEditor } from './CostEditor';
import type { CostSpec, Programme, RateBook, RateCell, TierPolicy } from '../engine/types';
import { downTiers, variantLabel } from '../engine/ratebook';
import { parseMoney, parsePercent } from '../lib/num';
import { specToCostDraft, type CostDraft } from '../state/draft';

function draftToSpec(c: CostDraft, prev: CostSpec): CostSpec {
  if (c.mode === 'none') return { mode: 'none', note: prev.note };
  if (c.mode === 'unknown') return { mode: 'unknown', note: prev.note, suggestedBasis: c.basis };
  if (c.mode === 'percent') {
    const p = parsePercent(c.pct);
    return p.kind === 'ok' ? { mode: 'percent', pct: p.value, basis: c.basis, basisConfirmed: c.basisConfirmed, note: prev.note } : prev;
  }
  const a = parseMoney(c.amount);
  return a.kind === 'ok' ? { mode: 'amount', amount: a.value, note: prev.note } : prev;
}

function bandLabel(c: RateCell): string {
  if (!c.years) return 'كل المدد (غير مقسم)';
  const [a, b] = c.years;
  return a === b ? `${a} س` : `${a} إلى ${b} س`;
}

function cellKey(c: RateCell) { return `${c.down}|${c.insurance}|${JSON.stringify(c.years)}`; }

export function RatesEditor() {
  const { book, original, tariffVersions, activeTariff, backend, activateTariff, reloadTariffs, toast } = useApp();
  const [work, setWork] = useState<RateBook | null>(() => (book ? JSON.parse(JSON.stringify(book)) : null));
  const [bankId, setBankId] = useState<string>(() => book?.banks.find((b) => b.priced)?.id ?? '');
  const [progId, setProgId] = useState<string>('');
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!work && book) setWork(JSON.parse(JSON.stringify(book))); }, [book, work]);
  const dirty = useMemo(() => JSON.stringify(work) !== JSON.stringify(book), [work, book]);

  if (!book || !work) {
    return (<><header className="topbar"><h1>قوائم الأسعار</h1><a className="btn btn-ghost" href="#/settings">رجوع</a></header>
      <main className="page narrow"><div className="alert alert-warn">القوائم غير محملة.</div></main></>);
  }
  const bank = work.banks.find((b) => b.id === bankId);
  const prog: Programme | undefined = bank?.programmes.find((p) => p.id === progId) ?? bank?.programmes[0];
  const origProg = original?.banks.find((b) => b.id === bankId)?.programmes.find((p) => p.id === prog?.id);

  const updateProg = (fn: (p: Programme) => Programme) => {
    setWork((w) => {
      if (!w || !prog) return w;
      const n: RateBook = JSON.parse(JSON.stringify(w));
      const b = n.banks.find((x) => x.id === bankId)!;
      b.programmes = b.programmes.map((p) => (p.id === prog.id ? fn(p) : p));
      return n;
    });
  };
  const setRate = (cell: RateCell, who: 'employee' | 'business' | 'both', text: string) => {
    const k = `${prog!.id}|${cellKey(cell)}|${who}`;
    setRaw((r) => ({ ...r, [k]: text }));
    const p = parsePercent(text);
    const v = text.trim() === '' ? null : p.kind === 'ok' ? p.value : undefined;
    if (v === undefined) return;
    updateProg((pp) => ({
      ...pp,
      cells: pp.cells.map((c) => (cellKey(c) === cellKey(cell)
        ? { ...c, ...(who === 'both' ? { employee: v, business: v } : { [who]: v }) }
        : c)),
    }));
  };
  const origRate = (cell: RateCell, who: 'employee' | 'business') => origProg?.cells.find((c) => cellKey(c) === cellKey(cell))?.[who];

  const save = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const meta = await backend.createTariffVersion(label.trim(), work);
      await activateTariff(meta.id);
      toast(`تم حفظ الإصدار ${meta.version} وتفعيله. العروض المحفوظة لا تتغير`);
      setSaveOpen(false); setLabel(''); setRaw({});
    } catch (e) { toast(errMsg(e), { kind: 'err' }); } finally { setBusy(false); }
  };
  const activate = async (id: string) => {
    try { await activateTariff(id); toast('تم تفعيل الإصدار'); } catch (e) { toast(errMsg(e), { kind: 'err' }); }
  };
  const origMeta = tariffVersions.find((v) => v.is_original);
  const separate = prog?.clientRates === 'separate';

  return (
    <>
      <header className="topbar"><h1>قوائم الأسعار</h1><a className="btn btn-ghost" href="#/settings">رجوع</a></header>
      <main className="page narrow" data-testid="rates-editor">
        <div className="alert alert-info small">تعديل القوائم هنا عام ويُحفظ فقط كإصدار جديد عند الضغط على «حفظ كإصدار جديد». الأصل يبقى محفوظاً، والعروض المحفوظة لا تتغير. لتعديل عرض واحد استخدم الحاسبة.</div>
        <section className="card">
          <h2>الإصدارات</h2>
          {tariffVersions.map((v) => (
            <div className="kv" key={v.id}>
              <span className="k">{v.version}. {v.label}{v.is_original ? ' (الأصل)' : ''}<small>{fmtDate(v.created_at)}</small></span>
              <span className="v">{v.id === activeTariff?.id ? <span className="badge b-list">نشط</span> : <button className="btn-link" onClick={() => activate(v.id)}>تفعيل</button>}</span>
            </div>
          ))}
          {origMeta && origMeta.id !== activeTariff?.id && (
            <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => activate(origMeta.id)} data-testid="restore-original">استعادة القيم الأصلية</button>
          )}
        </section>
        <section className="card">
          <h2>سياسة شرائح المقدم</h2>
          <Seg<TierPolicy> label="سياسة الشرائح" small value={work.tierPolicy} onChange={(v) => setWork({ ...work, tierPolicy: v })}
            options={[{ value: 'exact', label: 'مطابقة تامة' }, { value: 'floor', label: 'الشريحة حد أدنى' }]} />
          <p className="hint">«مطابقة تامة» هي الافتراض: نسبة مقدم بين شريحتين لا تأخذ سعراً. «حد أدنى» يطبّق أعلى شريحة لا تتجاوز المقدم؛ لا تفعّلها إلا بعد تأكيد الجهة.</p>
        </section>
        <section className="card">
          <h2>تعديل الأسعار والافتراضات</h2>
          <div className="field">
            <label className="label" htmlFor="re-bank">الجهة</label>
            <select id="re-bank" className="input" value={bankId} onChange={(e) => { setBankId(e.target.value); setProgId(''); }}>
              {work.banks.filter((b) => b.priced).map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </div>
          {bank && bank.programmes.length > 1 && (
            <div className="field"><Seg label="البرنامج" small value={prog?.id ?? ''} onChange={setProgId} options={bank.programmes.map((p) => ({ value: p.id, label: p.nameAr }))} /></div>
          )}
          {prog && (
            <>
              {prog.notes.length > 0 && <ul className="notes">{prog.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              {downTiers(prog).map((t) => (
                <div key={t} style={{ marginTop: 12 }}>
                  <h3>مقدم {t}%</h3>
                  <table className="rates-table">
                    <thead><tr><th>المدة</th><th>التأمين</th>{separate ? <><th>موظف</th><th>صاحب عمل</th></> : <th>النسبة</th>}</tr></thead>
                    <tbody>
                      {prog.cells.filter((c) => c.down === t).map((c) => {
                        const cols: ('employee' | 'business' | 'both')[] = separate ? ['employee', 'business'] : ['both'];
                        return (
                          <tr key={cellKey(c)}>
                            <td>{bandLabel(c)}</td>
                            <td className="small">{variantLabel(c.insurance)}{c.condition ? ` · ${c.condition}` : ''}</td>
                            {cols.map((who) => {
                              const k = `${prog.id}|${cellKey(c)}|${who}`;
                              const val = who === 'business' ? c.business : c.employee;
                              const o = origRate(c, who === 'business' ? 'business' : 'employee');
                              const shown = raw[k] ?? (val === null ? '' : String(val));
                              return (
                                <td key={who}>
                                  <input aria-label={`نسبة ${t}% ${bandLabel(c)} ${who}`} inputMode="decimal" className={o !== undefined && o !== val ? 'changed' : ''}
                                    value={shown} placeholder="—" onChange={(e) => setRate(c, who, e.target.value)} />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              <p className="hint">الخانة الفارغة (—) تعني لا سعر في القائمة، وليست صفراً. الخانات الملوّنة تختلف عن الأصل.</p>
              <h3>افتراضات التكاليف لهذا البرنامج</h3>
              <CostEditor title="المصاريف الإدارية" testId="re-admin" plain draft={specToCostDraft(prog.admin)} effective={prog.admin as never} note={prog.admin.note}
                fallbackBasis="loan" onChange={(c) => updateProg((p) => ({ ...p, admin: draftToSpec({ ...c, edited: true }, p.admin) }))} />
              <CostEditor title="التأمين عند اختيار «بتأمين»" testId="re-ins" plain draft={specToCostDraft(prog.insuranceWith)} effective={prog.insuranceWith as never}
                note={prog.insuranceWith.note} fallbackBasis="price" onChange={(c) => updateProg((p) => ({ ...p, insuranceWith: draftToSpec({ ...c, edited: true }, p.insuranceWith) }))} noneLabel="لا يوجد تأمين" />
            </>
          )}
        </section>
        <div className="two" style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + var(--safe-b) + 8px)' }}>
          <button className="btn btn-primary" disabled={!dirty} onClick={() => setSaveOpen(true)} data-testid="save-version">حفظ كإصدار جديد</button>
          <button className="btn btn-ghost" disabled={!dirty} onClick={() => { setWork(JSON.parse(JSON.stringify(book))); setRaw({}); void reloadTariffs(); }}>تجاهل التعديلات</button>
        </div>
      </main>
      {saveOpen && (
        <Modal title="حفظ إصدار جديد للقوائم" onClose={() => setSaveOpen(false)}>
          <div className="field"><label className="label" htmlFor="ver-label">وصف الإصدار</label>
            <input id="ver-label" className="input" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: تحديث ADIB ديسمبر" /></div>
          <p className="small muted">سيُفعَّل الإصدار الجديد للحسابات الجديدة. العروض المحفوظة والأصل لا يتغيران.</p>
          <div className="two"><button className="btn btn-primary" disabled={busy || !label.trim()} onClick={save} data-testid="confirm-version">حفظ وتفعيل</button>
            <button className="btn btn-ghost" onClick={() => setSaveOpen(false)}>إلغاء</button></div>
        </Modal>
      )}
    </>
  );
}

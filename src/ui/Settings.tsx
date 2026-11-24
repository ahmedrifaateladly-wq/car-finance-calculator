import { useRef, useState } from 'react';
import { useApp, errMsg } from './AppContext';
import { Modal, fmtDate } from './common';
import { applyImport, buildBackup, downloadJson, parseBackup, previewImport, type BackupFile, type ImportPreview } from '../data/backup';

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { backend, toast } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cur) return setError('أدخل كلمة المرور الحالية');
    if (next.length < 10) return setError('كلمة المرور الجديدة 10 أحرف على الأقل');
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) return setError('استخدم حروفاً إنجليزية وأرقاماً في كلمة المرور الجديدة');
    if (next !== conf) return setError('تأكيد كلمة المرور الجديدة غير مطابق');
    if (next === cur) return setError('كلمة المرور الجديدة مطابقة للحالية');
    setBusy(true);
    try {
      await backend.changePassword(cur, next);
      setCur(''); setNext(''); setConf('');
      toast('تم تغيير كلمة المرور بنجاح', { kind: 'ok' });
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="تغيير كلمة المرور" onClose={onClose}>
      <form onSubmit={submit} autoComplete="on">
        <input type="text" name="username" autoComplete="username" value={backend.username} readOnly hidden />
        <div className="field"><label className="label" htmlFor="pw-cur">كلمة المرور الحالية</label>
          <input id="pw-cur" data-testid="pw-cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="pw-new">كلمة المرور الجديدة</label>
          <input id="pw-new" data-testid="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="hint">10 أحرف على الأقل، حروف إنجليزية وأرقام.</div></div>
        <div className="field"><label className="label" htmlFor="pw-conf">تأكيد كلمة المرور الجديدة</label>
          <input id="pw-conf" data-testid="pw-conf" className="input" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} /></div>
        {error && <div className="alert alert-err" role="alert" data-testid="pw-error">{error}</div>}
        <div className="two">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="pw-submit">{busy ? 'جارٍ الحفظ…' : 'تغيير'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

function BackupSection() {
  const { backend, toast, refreshClients, refreshQuotes, reloadTariffs } = useApp();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      const b = await buildBackup(backend);
      downloadJson(b, `car-calc-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast('تم تصدير النسخة الاحتياطية');
    } catch (e) { toast(errMsg(e), { kind: 'err' }); } finally { setBusy(false); }
  };
  const onFile = async (f: File | undefined) => {
    setError(null); setPreview(null); setFile(null);
    if (!f) return;
    if (f.size > 20_000_000) return setError('الملف أكبر من 20 ميجابايت');
    const p = parseBackup(await f.text());
    if (!p.ok) return setError(p.error);
    setFile(p.file);
    try { setPreview(await previewImport(backend, p.file, mode)); } catch (e) { setError(errMsg(e)); }
  };
  const changeMode = async (m: 'merge' | 'replace') => {
    setMode(m);
    if (file) setPreview(await previewImport(backend, file, m));
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await applyImport(backend, preview, mode);
      await Promise.all([refreshClients(), refreshQuotes(), reloadTariffs()]);
      toast(`تم الاستيراد: ${r.clients} عميل، ${r.quotes} عرض، ${r.tariffs} إصدار قوائم`);
      setFile(null); setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <h2>النسخ الاحتياطي</h2>
      <p className="small muted">ملف خاص يحتوي العملاء والعروض وإصدارات القوائم. لا يحتوي كلمات مرور أو مفاتيح دخول. احفظه في مكان آمن.</p>
      <button className="btn btn-ghost btn-block" onClick={doExport} disabled={busy}>تصدير نسخة احتياطية</button>
      <div className="sep" />
      <label className="label" htmlFor="import-file">استيراد من نسخة احتياطية</label>
      <input ref={inputRef} id="import-file" type="file" accept="application/json,.json" className="input" onChange={(e) => onFile(e.target.files?.[0])} />
      {error && <div className="alert alert-err">{error}</div>}
      {file && preview && (
        <div style={{ marginTop: 10 }}>
          <div className="seg small" role="group" aria-label="طريقة الاستيراد">
            <button aria-pressed={mode === 'merge'} onClick={() => changeMode('merge')}>دمج (إضافة الجديد)</button>
            <button aria-pressed={mode === 'replace'} onClick={() => changeMode('replace')}>استبدال العملاء والعروض</button>
          </div>
          <div className={`alert ${mode === 'replace' ? 'alert-warn' : 'alert-info'}`} data-testid="import-preview">
            <div>تاريخ الملف: {fmtDate(file.exportedAt)}</div>
            <ul>
              <li>عملاء جدد: {preview.newClients.length}{preview.dupClients ? ` (مكرر يُتجاهل: ${preview.dupClients})` : ''}</li>
              <li>عروض جديدة: {preview.newQuotes.length}{preview.dupQuotes ? ` (مكرر يُتجاهل: ${preview.dupQuotes})` : ''}</li>
              <li>إصدارات قوائم مختلفة تُضاف كإصدارات جديدة: {preview.newTariffs.length}</li>
            </ul>
            {mode === 'replace' && <strong>سيُحذف كل العملاء والعروض الحالية قبل الاستيراد. إصدارات القوائم لا تُحذف.</strong>}
          </div>
          <button className={`btn btn-block ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={apply} data-testid="import-apply">
            {busy ? 'جارٍ الاستيراد…' : mode === 'replace' ? 'تأكيد الاستبدال' : 'تأكيد الدمج'}
          </button>
        </div>
      )}
    </section>
  );
}

export function Settings() {
  const { backend, settings, setSettings, activeTariff, toast, signOut } = useApp();
  const [pw, setPw] = useState(false);
  const idleOptions = [10, 15, 30, 60, 120];
  return (
    <>
      <header className="topbar"><h1>الإعدادات</h1></header>
      <main className="page narrow">
        <section className="card">
          <h2>الحساب</h2>
          <div className="kv"><span className="k">اسم المستخدم</span><span className="v"><bdi dir="ltr">{backend.username}</bdi></span></div>
          <div className="two" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => setPw(true)} data-testid="change-password">تغيير كلمة المرور</button>
            <button className="btn btn-danger" onClick={() => signOut()} data-testid="logout">تسجيل الخروج</button>
          </div>
        </section>
        <section className="card">
          <h2>الخروج التلقائي بعد عدم الاستخدام</h2>
          <select className="input" aria-label="مدة الخمول" data-testid="idle" value={settings?.idle_minutes ?? 30}
            onChange={async (e) => { try { await setSettings({ idle_minutes: Number(e.target.value) }); toast('تم الحفظ'); } catch (err) { toast(errMsg(err), { kind: 'err' }); } }}>
            {idleOptions.map((m) => <option key={m} value={m}>{m} دقيقة</option>)}
          </select>
          <p className="hint">
            عند انتهاء المدة يُسجَّل الخروج من هذا الجهاز وتُلغى جلسة التحديث على الخادم. رمز الدخول الذي صدر قبل ذلك يبقى صالحاً تقنياً حتى انتهاء عمره القصير
            المضبوط في الخدمة. خيارات إنهاء الجلسات بالخمول من جهة الخادم مدفوعة في Supabase، لذلك يُطبَّق الخمول من التطبيق.
          </p>
        </section>
        <section className="card">
          <h2>قوائم الأسعار</h2>
          <p className="small">{activeTariff ? <>الإصدار النشط: {activeTariff.version} · {activeTariff.label}{activeTariff.is_original ? ' (الأصل)' : ''}</> : 'القوائم غير محملة'}</p>
          <a className="btn btn-ghost btn-block" href="#/settings/rates" data-testid="open-rates">عرض وتعديل القوائم</a>
        </section>
        <BackupSection />
        <p className="hint" style={{ textAlign: 'center' }}>الأرقام تقديرية وتخضع لتأكيد الجهة الممولة والموافقة النهائية.</p>
      </main>
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Backend } from './data/backend';
import { BackendError } from './data/backend';
import { config } from './config';
import { AppProvider, useApp, markActivity, lastActivity, clearLocalState } from './ui/AppContext';
import { BottomNav, useHashRoute, useKeyboardAware } from './ui/common';
import { Calculator } from './ui/Calculator';
import { QuotesList, QuoteView, Compare } from './ui/Quotes';
import { ClientsList, ClientView } from './ui/Clients';
import { Settings } from './ui/Settings';
import { RatesEditor } from './ui/RatesEditor';

async function makeBackend(): Promise<Backend | null> {
  if (import.meta.env.MODE === 'localtest') {
    const m = await import('./data/memoryBackend');
    return new m.MemoryBackend();
  }
  if (!config.supabaseUrl || !config.supabaseKey) return null;
  const { SupabaseBackend } = await import('./data/supabaseBackend');
  return new SupabaseBackend(config.supabaseUrl, config.supabaseKey, config.username, config.emailDomain);
}

function Login({ backend, onIn, notice }: { backend: Backend; onIn: () => void; notice?: string }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return setError('أدخل كلمة المرور');
    setBusy(true); setError(null);
    try {
      await backend.signIn(pw);
      setPw('');
      markActivity();
      onIn();
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'تعذّر تسجيل الدخول');
    } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={submit} autoComplete="on" data-testid="login">
        <h1>حاسبة تمويل السيارات</h1>
        <p className="muted small" style={{ marginTop: 0 }}>أداة داخلية. سجّل الدخول للمتابعة.</p>
        {notice && <div className="alert alert-info" role="status">{notice}</div>}
        <div className="field">
          <label className="label" htmlFor="username">اسم المستخدم</label>
          <input id="username" name="username" className="input" value={backend.username} readOnly autoComplete="username" dir="ltr" />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">كلمة المرور</label>
          <input id="password" name="password" data-testid="password" className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" />
        </div>
        {error && <div className="alert alert-err" role="alert" data-testid="login-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="login-submit">{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
      </form>
    </main>
  );
}

function IdleGuard() {
  const { settings, signOut } = useApp();
  useEffect(() => {
    let last = 0;
    const bump = () => { const n = Date.now(); if (n - last > 10_000) { last = n; markActivity(); } };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const limit = (settings?.idle_minutes ?? 30) * 60_000;
    const check = () => {
      if (!settings) return;
      const la = lastActivity();
      if (la && Date.now() - la > limit) void signOut('تم تسجيل الخروج تلقائياً بعد عدم الاستخدام');
    };
    if (settings) check(); // enforce immediately after reload, using the saved limit
    const t = setInterval(check, 15_000);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [settings, signOut]);
  return null;
}

function Shell() {
  const [route] = useHashRoute();
  useKeyboardAware();
  let page: JSX.Element;
  const m = route.match(/^\/(quotes|clients|compare)\/([^/]+)$/);
  if (route === '/' || route === '') page = <Calculator />;
  else if (route === '/quotes') page = <QuotesList />;
  else if (m && m[1] === 'quotes') page = <QuoteView id={m[2]} />;
  else if (m && m[1] === 'compare') page = <Compare ids={m[2].split(',')} />;
  else if (route === '/clients') page = <ClientsList />;
  else if (m && m[1] === 'clients') page = <ClientView id={m[2]} />;
  else if (route === '/settings') page = <Settings />;
  else if (route === '/settings/rates') page = <RatesEditor />;
  else page = <main className="page"><div className="empty">الصفحة غير موجودة. <a href="#/">الحاسبة</a></div></main>;
  return (
    <div className={`app${route === '/' ? '' : ' no-bar'}`}>
      <IdleGuard />
      {page}
      <BottomNav route={route} />
    </div>
  );
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const [notice, setNotice] = useState<string | undefined>();
  const [sessionKey, setSessionKey] = useState(0);

  const onSignedOut = useCallback((reason?: string) => {
    clearLocalState();
    setNotice(reason);
    setState('out');
    setSessionKey((k) => k + 1);
  }, []);

  useEffect(() => {
    (async () => {
      const b = await makeBackend();
      setBackend(b);
      if (!b) { setState('out'); return; }
      const has = await b.hasSession().catch(() => false);
      if (has) {
        const la = lastActivity();
        // Enforce idle timeout across reloads (actual limit re-checked by IdleGuard after settings load).
        if (la && Date.now() - la > 240 * 60_000) {
          await b.signOut();
          onSignedOut('تم تسجيل الخروج تلقائياً بعد عدم الاستخدام');
          return;
        }
        if (!la) markActivity();
        setState('in');
      } else {
        clearLocalState();
        setState('out');
      }
    })();
  }, [onSignedOut]);

  useEffect(() => {
    if (!backend) return;
    return backend.onSignedOut(() => { if (state === 'in') onSignedOut(); });
  }, [backend, state, onSignedOut]);

  if (backend === undefined || state === 'loading') return <main className="login"><div className="muted">جارٍ التحميل…</div></main>;
  if (backend === null) {
    return <main className="login"><div className="card"><h1>حاسبة تمويل السيارات</h1><div className="alert alert-err">إعداد الخدمة غير مكتمل في هذا الإصدار.</div></div></main>;
  }
  if (state === 'out') return <Login backend={backend} notice={notice} onIn={() => { setNotice(undefined); window.location.hash = '/'; setState('in'); }} />;
  return (
    <AppProvider key={sessionKey} backend={backend} onSignedOut={onSignedOut}>
      <Shell />
    </AppProvider>
  );
}

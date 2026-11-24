import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Backend, ClientRow, QuoteRow, TariffVersion, TariffVersionMeta, UserSettings } from '../data/backend';
import { BackendError } from '../data/backend';
import type { RateBook } from '../engine/types';
import { newDraft, type Draft } from '../state/draft';

const DRAFT_KEY = 'cfc-draft';
const ACTIVITY_KEY = 'cfc-last-activity';

export interface Toast { id: number; text: string; action?: { label: string; run: () => void }; kind?: 'ok' | 'err' }

interface Ctx {
  backend: Backend;
  settings: UserSettings | null;
  setSettings: (s: Partial<UserSettings>) => Promise<void>;
  book: RateBook | null;
  original: RateBook | null;
  activeTariff: TariffVersionMeta | null;
  tariffVersions: TariffVersionMeta[];
  tariffError: string | null;
  reloadTariffs: () => Promise<void>;
  activateTariff: (id: string) => Promise<void>;
  quotes: QuoteRow[] | null;
  clients: ClientRow[] | null;
  dataError: string | null;
  refreshQuotes: () => Promise<void>;
  refreshClients: () => Promise<void>;
  draft: Draft;
  setDraft: (d: Draft | ((d: Draft) => Draft)) => void;
  toast: (text: string, opts?: { action?: Toast['action']; kind?: Toast['kind'] }) => void;
  signOut: (reason?: string) => Promise<void>;
}

const C = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('no app context');
  return c;
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d && d.v === 1) return { ...newDraft(), ...d };
    }
  } catch { /* ignore */ }
  return newDraft();
}

export function markActivity() {
  try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ }
}
export function lastActivity(): number | null {
  try { const v = localStorage.getItem(ACTIVITY_KEY); return v ? Number(v) : null; } catch { return null; }
}
export function clearLocalState() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch { /* ignore */ }
}

export function errMsg(e: unknown): string {
  return e instanceof BackendError ? e.message : 'حدث خطأ غير متوقع';
}

export function AppProvider({ backend, onSignedOut, children }: { backend: Backend; onSignedOut: (reason?: string) => void; children: ReactNode }) {
  const [settings, setSettingsState] = useState<UserSettings | null>(null);
  const [book, setBook] = useState<RateBook | null>(null);
  const [original, setOriginal] = useState<RateBook | null>(null);
  const [activeTariff, setActiveTariff] = useState<TariffVersionMeta | null>(null);
  const [tariffVersions, setTariffVersions] = useState<TariffVersionMeta[]>([]);
  const [tariffError, setTariffError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Draft>(loadDraft);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, opts?: { action?: Toast['action']; kind?: Toast['kind'] }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 9000 : 3500);
  }, []);

  const setDraft = useCallback((d: Draft | ((d: Draft) => Draft)) => {
    setDraftState((prev) => {
      const next = typeof d === 'function' ? d(prev) : d;
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Requests still in flight when this session ends must not affect a later session.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const handleErr = useCallback((e: unknown) => {
    if (!alive.current) return;
    if (e instanceof BackendError && (e.code === 'auth' || e.code === 'denied')) {
      onSignedOut('انتهت الجلسة أو لم تعد صالحة. سجّل الدخول مرة أخرى');
    }
  }, [onSignedOut]);

  const loadTariffs = useCallback(async (s: UserSettings) => {
    setTariffError(null);
    try {
      const versions = await backend.listTariffVersions();
      setTariffVersions(versions);
      const orig = versions.find((v) => v.is_original);
      const activeId = s.active_tariff_version_id ?? orig?.id ?? versions[0]?.id;
      if (!activeId) {
        setTariffError('قوائم الأسعار غير محملة بعد؛ أدخل النسبة يدوياً');
        return;
      }
      const act: TariffVersion = await backend.getTariffVersion(activeId);
      setBook(act.data);
      setActiveTariff({ id: act.id, version: act.version, label: act.label, is_original: act.is_original, created_at: act.created_at });
      if (orig && orig.id !== act.id) setOriginal((await backend.getTariffVersion(orig.id)).data);
      else setOriginal(act.data);
    } catch (e) {
      handleErr(e);
      setTariffError(`${errMsg(e)}. الحاسبة تعمل بإدخال النسبة يدوياً`);
    }
  }, [backend, handleErr]);

  const refreshQuotes = useCallback(async () => {
    try { setQuotes(await backend.listQuotes()); setDataError(null); } catch (e) { handleErr(e); setDataError(errMsg(e)); }
  }, [backend, handleErr]);
  const refreshClients = useCallback(async () => {
    try { setClients(await backend.listClients()); setDataError(null); } catch (e) { handleErr(e); setDataError(errMsg(e)); }
  }, [backend, handleErr]);

  useEffect(() => {
    (async () => {
      try {
        const s = await backend.getSettings();
        setSettingsState(s);
        await loadTariffs(s);
      } catch (e) {
        handleErr(e);
        setTariffError(`${errMsg(e)}. الحاسبة تعمل بإدخال النسبة يدوياً`);
      }
      void refreshQuotes();
      void refreshClients();
    })();
  }, [backend, loadTariffs, refreshQuotes, refreshClients, handleErr]);

  const setSettings = useCallback(async (p: Partial<UserSettings>) => {
    const s = await backend.saveSettings(p);
    setSettingsState(s);
  }, [backend]);

  const reloadTariffs = useCallback(async () => {
    const s = await backend.getSettings();
    setSettingsState(s);
    await loadTariffs(s);
  }, [backend, loadTariffs]);

  const activateTariff = useCallback(async (id: string) => {
    const s = await backend.saveSettings({ active_tariff_version_id: id });
    setSettingsState(s);
    await loadTariffs(s);
  }, [backend, loadTariffs]);

  const signOut = useCallback(async (reason?: string) => {
    await backend.signOut().catch(() => undefined);
    onSignedOut(reason);
  }, [backend, onSignedOut]);

  const value = useMemo<Ctx>(() => ({
    backend, settings, setSettings, book, original, activeTariff, tariffVersions, tariffError, reloadTariffs, activateTariff,
    quotes, clients, dataError, refreshQuotes, refreshClients, draft, setDraft, toast, signOut,
  }), [backend, settings, setSettings, book, original, activeTariff, tariffVersions, tariffError, reloadTariffs, activateTariff, quotes, clients, dataError, refreshQuotes, refreshClients, draft, setDraft, toast, signOut]);

  return (
    <C.Provider value={value}>
      {children}
      <div aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id} role="status">
            <span>{t.text}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </C.Provider>
  );
}

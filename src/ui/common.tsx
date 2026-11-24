import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatMoneyNumber, formatPercent, prettyMoneyInput } from '../lib/num';

export function Money({ v, suffix = true }: { v: number | null | undefined; suffix?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span>—</span>;
  return (
    <span className="money">
      <bdi dir="ltr">{formatMoneyNumber(v)}</bdi>
      {suffix ? ' ج.م' : ''}
    </span>
  );
}

export function Pct({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span>—</span>;
  return <bdi dir="ltr">{formatPercent(v)}</bdi>;
}

interface NumFieldProps {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  kind: 'money' | 'percent' | 'int';
  error?: string;
  hint?: ReactNode;
  aux?: ReactNode;
  placeholder?: string;
  id?: string;
  testId?: string;
  autoFocus?: boolean;
}

/** Numeric text field: numeric keyboard, Arabic/English digits, thousands formatting on blur. */
export function NumField({ label, value, onChange, kind, error, hint, aux, placeholder, id, testId, autoFocus }: NumFieldProps) {
  const autoId = useId();
  const fid = id ?? autoId;
  const suffix = kind === 'money' ? 'ج.م' : kind === 'percent' ? '%' : kind === 'int' ? '' : '';
  return (
    <div className="field">
      <label className="label" htmlFor={fid}>
        <span>{label}</span>
        {aux && <span className="aux">{aux}</span>}
      </label>
      <div className={suffix ? 'input-wrap' : ''}>
        <input
          id={fid}
          data-testid={testId}
          className={`input num${error ? ' invalid' : ''}`}
          inputMode={kind === 'int' ? 'numeric' : 'decimal'}
          enterKeyHint="next"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${fid}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (kind === 'money') { const p = prettyMoneyInput(value); if (p !== value) onChange(p); } }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {error ? <div className="err-text" id={`${fid}-err`}>{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, small, label, testId }: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <div className={`seg${small ? ' small' : ''}`} role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function useHashRoute(): [string, (to: string) => void] {
  const get = () => (window.location.hash.replace(/^#/, '') || '/');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const h = () => { setRoute(get()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return [route, (to: string) => { window.location.hash = to; }];
}

export function navigate(to: string) {
  window.location.hash = to;
}

const icons: Record<string, ReactNode> = {
  calc: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 3v3h8V6H8Zm0 6v2h2v-2H8Zm3 0v2h2v-2h-2Zm3 0v5h2v-5h-2Zm-6 3v2h2v-2H8Zm3 0v2h2v-2h-2Z" />,
  quotes: <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM7 12v2h10v-2H7Zm0 4v2h7v-2H7Z" />,
  clients: <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.5 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20c0-3.3 3.1-6 7-6s7 2.7 7 6v1H2v-1Zm15.5 1v-1c0-1.7-.6-3.3-1.6-4.5 3.4.2 6.1 2.4 6.1 5.1v.4h-4.5Z" />,
  settings: <path d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7a7 7 0 0 1 0 1.9l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.7a7 7 0 0 1 0-1.9l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9l.5-2.6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" transform="translate(0 2)" />,
};

export function BottomNav({ route }: { route: string }) {
  const items = [
    { to: '/', label: 'الحاسبة', icon: 'calc', match: (r: string) => r === '/' },
    { to: '/quotes', label: 'العروض', icon: 'quotes', match: (r: string) => r.startsWith('/quotes') || r.startsWith('/compare') },
    { to: '/clients', label: 'العملاء', icon: 'clients', match: (r: string) => r.startsWith('/clients') },
    { to: '/settings', label: 'الإعدادات', icon: 'settings', match: (r: string) => r.startsWith('/settings') },
  ];
  return (
    <nav className="bottomnav" aria-label="التنقل الرئيسي">
      {items.map((i) => (
        <a key={i.to} href={`#${i.to}`} aria-current={i.match(route) ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{icons[i.icon]}</svg>
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** Hide fixed bars while the on-screen keyboard is open so they never cover fields. */
export function useKeyboardAware() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const open = window.innerHeight - vv.height > 140;
      document.body.classList.toggle('kb-open', open);
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    };
    vv.addEventListener('resize', onResize);
    window.addEventListener('focusin', onFocus);
    return () => { vv.removeEventListener('resize', onResize); window.removeEventListener('focusin', onFocus); };
  }, []);
}

export function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

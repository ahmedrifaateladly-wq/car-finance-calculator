// Private data export/import. Contains business data only, never credentials or tokens.
import type { Backend, ClientRow, QuoteRow } from './backend';
import { isSnapshot } from '../state/snapshot';
import type { RateBook } from '../engine/types';

export const BACKUP_FORMAT = 'car-finance-calculator-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  data: {
    settings: { idle_minutes: number };
    clients: ClientRow[];
    quotes: QuoteRow[];
    tariffVersions: { version: number; label: string; is_original: boolean; created_at: string; data: RateBook }[];
  };
}

export async function buildBackup(b: Backend): Promise<BackupFile> {
  const [settings, clients, quotes, metas] = await Promise.all([b.getSettings(), b.listClients(), b.listQuotes(), b.listTariffVersions()]);
  const tariffVersions = [];
  for (const m of metas) {
    const t = await b.getTariffVersion(m.id);
    tariffVersions.push({ version: t.version, label: t.label, is_original: t.is_original, created_at: t.created_at, data: t.data });
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), data: { settings: { idle_minutes: settings.idle_minutes }, clients, quotes, tariffVersions } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStr = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;
const isIso = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));

export type ParsedBackup = { ok: true; file: BackupFile } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'الملف ليس JSON صالحاً' }; }
  const f = j as BackupFile;
  if (!f || f.format !== BACKUP_FORMAT || f.version !== 1 || !f.data) return { ok: false, error: 'الملف ليس نسخة احتياطية من هذه الأداة' };
  const { clients, quotes, tariffVersions } = f.data;
  if (!Array.isArray(clients) || !Array.isArray(quotes) || !Array.isArray(tariffVersions)) return { ok: false, error: 'بنية الملف غير مكتملة' };
  if (clients.length > 5000 || quotes.length > 20000) return { ok: false, error: 'الملف أكبر من الحد المسموح' };
  for (const c of clients) {
    if (!UUID.test(c?.id) || !isStr(c.name, 120) || !c.name.trim() || !isStr(c.contact ?? '', 120) || !isStr(c.notes ?? '', 2000) || !isIso(c.created_at)) {
      return { ok: false, error: 'سجل عميل غير صالح في الملف' };
    }
  }
  const clientIds = new Set(clients.map((c) => c.id));
  const seenReq = new Set<string>();
  for (const q of quotes) {
    if (!UUID.test(q?.id) || !UUID.test(q.request_id) || !isIso(q.created_at) || !isSnapshot(q.snapshot) || !isStr(q.title ?? '', 200)) {
      return { ok: false, error: 'سجل عرض غير صالح في الملف' };
    }
    if (q.client_id !== null && !clientIds.has(q.client_id)) return { ok: false, error: 'عرض مرتبط بعميل غير موجود في الملف' };
    if (seenReq.has(q.request_id)) return { ok: false, error: 'الملف يحتوي عروضاً مكررة' };
    seenReq.add(q.request_id);
  }
  for (const t of tariffVersions) {
    if (!t || typeof t.data !== 'object' || (t.data as RateBook).schema !== 1 || !Array.isArray((t.data as RateBook).banks)) {
      return { ok: false, error: 'إصدار قوائم غير صالح في الملف' };
    }
  }
  return { ok: true, file: f };
}

export interface ImportPreview {
  newClients: ClientRow[];
  dupClients: number;
  newQuotes: QuoteRow[];
  dupQuotes: number;
  newTariffs: BackupFile['data']['tariffVersions'];
}

export async function previewImport(b: Backend, f: BackupFile, mode: 'merge' | 'replace'): Promise<ImportPreview> {
  const [clients, quotes, metas] = await Promise.all([b.listClients(), b.listQuotes(), b.listTariffVersions()]);
  const existingTariffs = await Promise.all(metas.map((m) => b.getTariffVersion(m.id)));
  const known = new Set(existingTariffs.map((t) => JSON.stringify(t.data)));
  const newTariffs = f.data.tariffVersions.filter((t) => !known.has(JSON.stringify(t.data)));
  if (mode === 'replace') {
    return { newClients: f.data.clients, dupClients: 0, newQuotes: f.data.quotes, dupQuotes: 0, newTariffs };
  }
  const cIds = new Set(clients.map((c) => c.id));
  const qIds = new Set(quotes.map((q) => q.id));
  const qReq = new Set(quotes.map((q) => q.request_id));
  const newClients = f.data.clients.filter((c) => !cIds.has(c.id));
  const newQuotes = f.data.quotes.filter((q) => !qIds.has(q.id) && !qReq.has(q.request_id));
  return { newClients, dupClients: f.data.clients.length - newClients.length, newQuotes, dupQuotes: f.data.quotes.length - newQuotes.length, newTariffs };
}

export async function applyImport(b: Backend, p: ImportPreview, mode: 'merge' | 'replace'): Promise<{ clients: number; quotes: number; tariffs: number }> {
  if (mode === 'replace') await b.deleteAllUserData();
  const r = await b.restoreRows(p.newClients, p.newQuotes.map((q) => ({ ...q, parent_quote_id: null })));
  let tariffs = 0;
  for (const t of p.newTariffs) {
    await b.createTariffVersion(`مستورد: ${t.label}`.slice(0, 200), t.data);
    tariffs++;
  }
  return { ...r, tariffs };
}

export function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

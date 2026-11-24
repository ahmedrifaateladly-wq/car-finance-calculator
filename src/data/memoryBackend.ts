// LOCAL TESTING ONLY. Loaded exclusively when built with `--mode localtest`;
// excluded from production builds. Simulates the backend contract in localStorage
// so UI flows can be exercised before a Supabase project exists.
import type { Backend, ClientRow, NewQuote, QuoteRow, TariffVersion, TariffVersionMeta, UserSettings } from './backend';
import { BackendError } from './backend';
import type { RateBook } from '../engine/types';
import { uuid } from '../state/draft';

interface Db {
  password: string;
  session: boolean;
  offline: boolean;
  settings: UserSettings;
  tariffs: TariffVersion[];
  clients: ClientRow[];
  quotes: QuoteRow[];
}
const KEY = 'localtest-db';
declare global {
  interface Window { __LOCALTEST_SEED__?: { ratebook: RateBook; password: string } }
}

function load(): Db {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw) as Db;
  const seed = window.__LOCALTEST_SEED__;
  const t: TariffVersion[] = seed
    ? [{ id: uuid(), version: 1, label: 'original', is_original: true, created_at: new Date().toISOString(), data: seed.ratebook }]
    : [];
  const db: Db = {
    password: seed?.password ?? 'local-test-password',
    session: false,
    offline: false,
    settings: { idle_minutes: 30, active_tariff_version_id: t[0]?.id ?? null },
    tariffs: t,
    clients: [],
    quotes: [],
  };
  localStorage.setItem(KEY, JSON.stringify(db));
  return db;
}

export class MemoryBackend implements Backend {
  readonly kind = 'memory' as const;
  username = 'shoura';
  private listeners = new Set<() => void>();
  private db = load();
  private save() { localStorage.setItem(KEY, JSON.stringify(this.db)); }
  private async tick() {
    await new Promise((r) => setTimeout(r, 30));
    this.db = load();
    if (this.db.offline) throw new BackendError('تعذّر الاتصال بالخدمة. تحقق من الإنترنت وأعد المحاولة', 'network');
  }
  private async authed() {
    await this.tick();
    if (!this.db.session) throw new BackendError('انتهت الجلسة. سجّل الدخول مرة أخرى', 'auth');
  }
  async hasSession() { this.db = load(); return this.db.session; }
  onSignedOut(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  async signIn(password: string) {
    await this.tick();
    if (password !== this.db.password) throw new BackendError('كلمة المرور غير صحيحة', 'auth');
    this.db.session = true; this.save();
  }
  async signOut() { this.db = load(); this.db.session = false; this.save(); this.listeners.forEach((l) => l()); }
  async changePassword(current: string, next: string) {
    await this.authed();
    if (current !== this.db.password) throw new BackendError('كلمة المرور الحالية غير صحيحة', 'auth');
    if (current === next) throw new BackendError('كلمة المرور الجديدة مطابقة للحالية', 'validation');
    this.db.password = next; this.save();
  }
  async getSettings() { await this.authed(); return { ...this.db.settings }; }
  async saveSettings(s: Partial<UserSettings>) { await this.authed(); this.db.settings = { ...this.db.settings, ...s }; this.save(); return { ...this.db.settings }; }
  async listTariffVersions(): Promise<TariffVersionMeta[]> {
    await this.authed();
    return this.db.tariffs.map(({ data: _d, ...m }) => m).sort((a, b) => b.version - a.version);
  }
  async getTariffVersion(id: string) {
    await this.authed();
    const t = this.db.tariffs.find((x) => x.id === id);
    if (!t) throw new BackendError('الإصدار غير موجود', 'unknown');
    return JSON.parse(JSON.stringify(t)) as TariffVersion;
  }
  async createTariffVersion(label: string, data: RateBook) {
    await this.authed();
    const v = Math.max(0, ...this.db.tariffs.map((t) => t.version)) + 1;
    const row: TariffVersion = { id: uuid(), version: v, label, is_original: false, created_at: new Date().toISOString(), data };
    this.db.tariffs.push(row); this.save();
    const { data: _d, ...m } = row;
    return m;
  }
  async listQuotes() { await this.authed(); return [...this.db.quotes].sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async getQuote(id: string) { await this.authed(); return this.db.quotes.find((q) => q.id === id) ?? null; }
  async saveQuote(q: NewQuote) {
    await this.authed();
    const ex = this.db.quotes.find((x) => x.request_id === q.request_id);
    if (ex) return ex;
    const row: QuoteRow = { ...q, id: uuid(), created_at: new Date().toISOString() };
    this.db.quotes.push(row); this.save();
    return row;
  }
  async updateQuote(id: string, patch: { client_id?: string | null; title?: string }) {
    await this.authed();
    const q = this.db.quotes.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
    this.save();
  }
  async deleteQuote(id: string) { await this.authed(); this.db.quotes = this.db.quotes.filter((q) => q.id !== id); this.save(); }
  async listClients() { await this.authed(); return [...this.db.clients].sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async createClient(c: { name: string; contact: string; notes: string; id?: string }) {
    await this.authed();
    const now = new Date().toISOString();
    const row: ClientRow = { id: c.id ?? uuid(), name: c.name, contact: c.contact, notes: c.notes, created_at: now, updated_at: now };
    this.db.clients.push(row); this.save();
    return row;
  }
  async updateClient(id: string, c: { name: string; contact: string; notes: string }) {
    await this.authed();
    const r = this.db.clients.find((x) => x.id === id);
    if (r) Object.assign(r, c, { updated_at: new Date().toISOString() });
    this.save();
  }
  async deleteClient(id: string) {
    await this.authed();
    this.db.clients = this.db.clients.filter((c) => c.id !== id);
    this.db.quotes.forEach((q) => { if (q.client_id === id) q.client_id = null; });
    this.save();
  }
  async restoreRows(clients: ClientRow[], quotes: QuoteRow[]) {
    await this.authed();
    let nc = 0; let nq = 0;
    for (const c of clients) if (!this.db.clients.some((x) => x.id === c.id)) { this.db.clients.push(c); nc++; }
    for (const q of quotes) if (!this.db.quotes.some((x) => x.id === q.id || x.request_id === q.request_id)) { this.db.quotes.push(q); nq++; }
    this.save();
    return { clients: nc, quotes: nq };
  }
  async deleteAllUserData() { await this.authed(); this.db.quotes = []; this.db.clients = []; this.save(); }
}

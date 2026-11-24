import type { RateBook } from '../engine/types';

export interface TariffVersionMeta {
  id: string;
  version: number;
  label: string;
  is_original: boolean;
  created_at: string;
}
export interface TariffVersion extends TariffVersionMeta {
  data: RateBook;
}
export interface UserSettings {
  idle_minutes: number;
  active_tariff_version_id: string | null;
}
export interface ClientRow {
  id: string;
  name: string;
  contact: string;
  notes: string;
  created_at: string;
  updated_at: string;
}
export interface QuoteRow {
  id: string;
  request_id: string;
  client_id: string | null;
  parent_quote_id: string | null;
  tariff_version_id: string | null;
  title: string;
  snapshot: unknown;
  created_at: string;
}
export type NewQuote = Omit<QuoteRow, 'id' | 'created_at'>;

export class BackendError extends Error {
  constructor(message: string, readonly code: 'auth' | 'network' | 'denied' | 'conflict' | 'validation' | 'unknown' = 'unknown') {
    super(message);
  }
}

export interface Backend {
  readonly kind: 'supabase' | 'memory';
  username: string;
  hasSession(): Promise<boolean>;
  onSignedOut(cb: () => void): () => void;
  signIn(password: string): Promise<void>;
  signOut(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;

  getSettings(): Promise<UserSettings>;
  saveSettings(s: Partial<UserSettings>): Promise<UserSettings>;

  listTariffVersions(): Promise<TariffVersionMeta[]>;
  getTariffVersion(id: string): Promise<TariffVersion>;
  createTariffVersion(label: string, data: RateBook): Promise<TariffVersionMeta>;

  listQuotes(): Promise<QuoteRow[]>;
  getQuote(id: string): Promise<QuoteRow | null>;
  /** Idempotent on request_id: a repeated save returns the existing row. */
  saveQuote(q: NewQuote): Promise<QuoteRow>;
  updateQuote(id: string, patch: { client_id?: string | null; title?: string }): Promise<void>;
  deleteQuote(id: string): Promise<void>;

  listClients(): Promise<ClientRow[]>;
  createClient(c: { name: string; contact: string; notes: string; id?: string }): Promise<ClientRow>;
  updateClient(id: string, c: { name: string; contact: string; notes: string }): Promise<void>;
  deleteClient(id: string): Promise<void>;
  /** Insert rows with their original ids (backup restore). Existing ids are skipped. */
  restoreRows(clients: ClientRow[], quotes: QuoteRow[]): Promise<{ clients: number; quotes: number }>;
  deleteAllUserData(): Promise<void>;
}

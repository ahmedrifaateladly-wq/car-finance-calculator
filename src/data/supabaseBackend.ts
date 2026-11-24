import { createClient, type SupabaseClient, type PostgrestError, AuthError } from '@supabase/supabase-js';
import type { Backend, ClientRow, NewQuote, QuoteRow, TariffVersion, TariffVersionMeta, UserSettings } from './backend';
import { BackendError } from './backend';
import type { RateBook } from '../engine/types';

function isNetwork(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  return /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test(msg);
}

function mapDb(e: PostgrestError | null, fallback = 'تعذّر تنفيذ العملية'): never | void {
  if (!e) return;
  if (isNetwork(e)) throw new BackendError('تعذّر الاتصال بالخدمة. تحقق من الإنترنت وأعد المحاولة', 'network');
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message)) throw new BackendError('غير مصرح بهذه العملية. سجّل الدخول مرة أخرى', 'denied');
  if (e.code === '23505') throw new BackendError('السجل موجود بالفعل', 'conflict');
  if (e.code === '23514' || e.code === '22P02') throw new BackendError('بيانات غير صالحة', 'validation');
  if (e.code === 'PGRST301' || /JWT/i.test(e.message)) throw new BackendError('انتهت الجلسة. سجّل الدخول مرة أخرى', 'auth');
  throw new BackendError(fallback, 'unknown');
}

async function guard<T>(p: PromiseLike<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    if (isNetwork(e)) throw new BackendError('تعذّر الاتصال بالخدمة. تحقق من الإنترنت وأعد المحاولة', 'network');
    throw new BackendError('حدث خطأ غير متوقع', 'unknown');
  }
}

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  private sb: SupabaseClient;
  private email: string;

  constructor(url: string, publishableKey: string, readonly username: string, emailDomain: string) {
    this.sb = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cfc-auth' },
    });
    this.email = `${username}@${emailDomain}`;
  }

  async hasSession(): Promise<boolean> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return false;
    // Validate with the server (revoked/expired sessions are rejected here).
    const { data: u, error } = await this.sb.auth.getUser();
    if (error && isNetwork(error)) return true; // offline: keep local session; data calls will report the network error
    return !!u?.user && !error;
  }

  private signingOut = false;

  onSignedOut(cb: () => void): () => void {
    // Our own signOut() is awaited by the caller (so server-side revocation completes first);
    // only unexpected sign-outs (expired/revoked session, other tab) are reported here.
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !this.signingOut) cb();
    });
    return () => data.subscription.unsubscribe();
  }

  private authMessage(e: AuthError | Error): BackendError {
    if (isNetwork(e)) return new BackendError('تعذّر الاتصال بالخدمة. تحقق من الإنترنت وأعد المحاولة', 'network');
    const code = (e as AuthError).code ?? '';
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(e.message)) return new BackendError('كلمة المرور غير صحيحة', 'auth');
    if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(e.message)) return new BackendError('محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة', 'auth');
    if (code === 'weak_password') return new BackendError('كلمة المرور الجديدة ضعيفة. استخدم 10 أحرف على الأقل مع أرقام وحروف', 'validation');
    if (code === 'same_password') return new BackendError('كلمة المرور الجديدة مطابقة للحالية', 'validation');
    return new BackendError('تعذّر تسجيل الدخول', 'auth');
  }

  async signIn(password: string): Promise<void> {
    const { error } = await guard(this.sb.auth.signInWithPassword({ email: this.email, password }));
    if (error) throw this.authMessage(error);
  }

  async signOut(): Promise<void> {
    // Revokes this session's refresh token server-side; local storage is cleared even if offline.
    this.signingOut = true;
    try {
      const { error } = await this.sb.auth.signOut({ scope: 'local' });
      if (error) {
        try { localStorage.removeItem('cfc-auth'); } catch { /* ignore */ }
      }
    } catch {
      try { localStorage.removeItem('cfc-auth'); } catch { /* ignore */ }
    } finally {
      this.signingOut = false;
    }
  }

  async changePassword(current: string, next: string): Promise<void> {
    // Re-verify the current password with the auth server before updating.
    const verify = await guard(this.sb.auth.signInWithPassword({ email: this.email, password: current }));
    if (verify.error) {
      const m = this.authMessage(verify.error);
      if (m.code === 'auth' && /غير صحيحة/.test(m.message)) throw new BackendError('كلمة المرور الحالية غير صحيحة', 'auth');
      throw m;
    }
    const { error } = await guard(this.sb.auth.updateUser({ password: next }));
    if (error) throw this.authMessage(error);
    // End any other sessions (other devices) after a password change.
    await this.sb.auth.signOut({ scope: 'others' }).catch(() => undefined);
  }

  async getSettings(): Promise<UserSettings> {
    const { data, error } = await guard(this.sb.from('user_settings').select('idle_minutes, active_tariff_version_id').maybeSingle());
    mapDb(error);
    if (data) return data as UserSettings;
    const ins = await guard(this.sb.from('user_settings').insert({ idle_minutes: 30 }).select('idle_minutes, active_tariff_version_id').single());
    mapDb(ins.error);
    return ins.data as UserSettings;
  }

  async saveSettings(s: Partial<UserSettings>): Promise<UserSettings> {
    const { data, error } = await guard(
      this.sb.from('user_settings').update(s).not('owner_id', 'is', null).select('idle_minutes, active_tariff_version_id').single(),
    );
    mapDb(error);
    return data as UserSettings;
  }

  async listTariffVersions(): Promise<TariffVersionMeta[]> {
    const { data, error } = await guard(this.sb.from('tariff_versions').select('id, version, label, is_original, created_at').order('version', { ascending: false }));
    mapDb(error);
    return (data ?? []) as TariffVersionMeta[];
  }

  async getTariffVersion(id: string): Promise<TariffVersion> {
    const { data, error } = await guard(this.sb.from('tariff_versions').select('id, version, label, is_original, created_at, data').eq('id', id).single());
    mapDb(error);
    return data as TariffVersion;
  }

  async createTariffVersion(label: string, data: RateBook): Promise<TariffVersionMeta> {
    const r = await guard(
      this.sb.from('tariff_versions').insert({ label, data, version: 1 }).select('id, version, label, is_original, created_at').single(),
    );
    mapDb(r.error);
    return r.data as TariffVersionMeta;
  }

  async listQuotes(): Promise<QuoteRow[]> {
    const { data, error } = await guard(this.sb.from('quotes').select('*').order('created_at', { ascending: false }).limit(1000));
    mapDb(error);
    return (data ?? []) as QuoteRow[];
  }

  async getQuote(id: string): Promise<QuoteRow | null> {
    const { data, error } = await guard(this.sb.from('quotes').select('*').eq('id', id).maybeSingle());
    mapDb(error);
    return (data as QuoteRow) ?? null;
  }

  async saveQuote(q: NewQuote): Promise<QuoteRow> {
    const ins = await guard(this.sb.from('quotes').insert(q).select('*').single());
    if (ins.error?.code === '23505') {
      const ex = await guard(this.sb.from('quotes').select('*').eq('request_id', q.request_id).single());
      mapDb(ex.error);
      return ex.data as QuoteRow;
    }
    mapDb(ins.error, 'تعذّر حفظ العرض');
    return ins.data as QuoteRow;
  }

  async updateQuote(id: string, patch: { client_id?: string | null; title?: string }): Promise<void> {
    const { error } = await guard(this.sb.from('quotes').update(patch).eq('id', id));
    mapDb(error);
  }

  async deleteQuote(id: string): Promise<void> {
    const { error } = await guard(this.sb.from('quotes').delete().eq('id', id));
    mapDb(error);
  }

  async listClients(): Promise<ClientRow[]> {
    const { data, error } = await guard(this.sb.from('clients').select('*').order('updated_at', { ascending: false }).limit(2000));
    mapDb(error);
    return (data ?? []) as ClientRow[];
  }

  async createClient(c: { name: string; contact: string; notes: string; id?: string }): Promise<ClientRow> {
    const { data, error } = await guard(this.sb.from('clients').insert(c).select('*').single());
    mapDb(error, 'تعذّر حفظ العميل');
    return data as ClientRow;
  }

  async updateClient(id: string, c: { name: string; contact: string; notes: string }): Promise<void> {
    const { error } = await guard(this.sb.from('clients').update(c).eq('id', id));
    mapDb(error);
  }

  async deleteClient(id: string): Promise<void> {
    const { error } = await guard(this.sb.from('clients').delete().eq('id', id));
    mapDb(error);
  }

  async restoreRows(clients: ClientRow[], quotes: QuoteRow[]): Promise<{ clients: number; quotes: number }> {
    let nc = 0;
    let nq = 0;
    if (clients.length) {
      const r = await guard(
        this.sb.from('clients').upsert(clients.map((c) => ({ id: c.id, name: c.name, contact: c.contact, notes: c.notes, created_at: c.created_at })), { onConflict: 'id', ignoreDuplicates: true }).select('id'),
      );
      mapDb(r.error, 'تعذّر استيراد العملاء');
      nc = r.data?.length ?? 0;
    }
    if (quotes.length) {
      const known = new Set((await this.listTariffVersions()).map((t) => t.id));
      const r = await guard(
        this.sb
          .from('quotes')
          .upsert(
            quotes.map((q) => ({
              id: q.id, request_id: q.request_id, client_id: q.client_id, parent_quote_id: null,
              tariff_version_id: q.tariff_version_id && known.has(q.tariff_version_id) ? q.tariff_version_id : null,
              title: q.title, snapshot: q.snapshot, created_at: q.created_at,
            })),
            { onConflict: 'id', ignoreDuplicates: true },
          )
          .select('id'),
      );
      mapDb(r.error, 'تعذّر استيراد العروض');
      nq = r.data?.length ?? 0;
    }
    return { clients: nc, quotes: nq };
  }

  async deleteAllUserData(): Promise<void> {
    const q = await guard(this.sb.from('quotes').delete().not('id', 'is', null));
    mapDb(q.error);
    const c = await guard(this.sb.from('clients').delete().not('id', 'is', null));
    mapDb(c.error);
  }
}

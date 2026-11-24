#!/usr/bin/env node
// One-time Supabase setup and verification (run by the maintainer, never in the browser).
//
//   SUPABASE_ACCESS_TOKEN=<personal access token>  (or injected by a proxy)
//   PROJECT_REF=<project ref>
//   APP_USERNAME=shoura  LOGIN_EMAIL_DOMAIN=users.car-calc.invalid
//   SITE_URL=https://<owner>.github.io/<repo>/
//   RATEBOOK=<private ratebook.json>   OUT_DIR=<private dir outside the repo>
//   node scripts/setup-supabase.mjs [--steps=migrate,auth,user,seed,verify]
//
// Writes the initial password and public build config to OUT_DIR (chmod 600). Prints no secrets.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] ?? d;
const REF = env('PROJECT_REF');
const TOKEN = env('SUPABASE_ACCESS_TOKEN', 'sbp_proxy_injected');
const USERNAME = env('APP_USERNAME', 'shoura');
const DOMAIN = env('LOGIN_EMAIL_DOMAIN', 'users.car-calc.invalid');
const SITE_URL = env('SITE_URL', '');
const OUT = env('OUT_DIR');
const RATEBOOK = env('RATEBOOK');
const steps = (process.argv.find((a) => a.startsWith('--steps='))?.slice(8) ?? 'migrate,auth,user,seed,verify').split(',');
if (!REF || !OUT) { console.error('PROJECT_REF and OUT_DIR are required'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const EMAIL = `${USERNAME}@${DOMAIN}`;
const API = 'https://api.supabase.com/v1';
const PROJECT = `https://${REF}.supabase.co`;
const stateFile = join(OUT, 'setup-state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const saveState = () => { writeFileSync(stateFile, JSON.stringify(state, null, 2)); chmodSync(stateFile, 0o600); };

async function mgmt(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt('POST', `/projects/${REF}/database/query`, { query });

async function keys() {
  const list = await mgmt('GET', `/projects/${REF}/api-keys?reveal=true`);
  const pub = list.find((k) => k.type === 'publishable')?.api_key ?? list.find((k) => k.name === 'anon')?.api_key;
  const secret = list.find((k) => k.type === 'secret')?.api_key ?? list.find((k) => k.name === 'service_role')?.api_key;
  if (!pub || !secret) throw new Error('could not read project API keys');
  return { pub, secret };
}

function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // 56 symbols, no look-alikes
  for (;;) {
    let s = '';
    while (s.length < 20) {
      const x = randomBytes(1)[0];
      if (x < 224) s += alphabet[x % 56]; // rejection sampling: no modulo bias
    }
    if (/[A-Za-z]/.test(s) && /\d/.test(s)) return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`; // ~116 bits
  }
}

async function migrate() {
  const q = readFileSync(join(here, '..', 'supabase', 'migrations', '0001_init.sql'), 'utf8');
  await sql(q);
  console.log('migrate: ok');
}

async function auth() {
  const before = await mgmt('GET', `/projects/${REF}/config/auth`);
  const patch = {
    disable_signup: true,
    external_anonymous_users_enabled: false,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    password_min_length: 10,
    password_required_characters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    jwt_exp: 900,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    ...(SITE_URL ? { site_url: SITE_URL, uri_allow_list: SITE_URL } : {}),
  };
  const known = Object.fromEntries(Object.entries(patch).filter(([k]) => k in before));
  const skipped = Object.keys(patch).filter((k) => !(k in before));
  const after = await mgmt('PATCH', `/projects/${REF}/config/auth`, known);
  for (const [k, v] of Object.entries(known)) if (after[k] !== v) console.warn(`auth: ${k} not applied (got ${after[k]})`);
  console.log(`auth: applied ${Object.keys(known).join(', ')}${skipped.length ? `; not supported by API: ${skipped.join(', ')}` : ''}`);
}

async function adminUser(secret, method, path, body) {
  const r = await fetch(`${PROJECT}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`admin ${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

async function user() {
  const { secret } = await keys();
  const existing = await sql(`select id from auth.users where email = '${EMAIL.replace(/'/g, "''")}'`);
  if (existing.length) {
    state.userId = existing[0].id;
    console.log('user: exists (password unchanged)');
  } else {
    const password = strongPassword();
    const u = await adminUser(secret, 'POST', '/users', { email: EMAIL, password, email_confirm: true, user_metadata: { username: USERNAME } });
    state.userId = u.id;
    const pf = join(OUT, 'INITIAL_PASSWORD.txt');
    writeFileSync(pf, `username: ${USERNAME}\npassword: ${password}\n`);
    chmodSync(pf, 0o600);
    console.log('user: created; initial password written to OUT_DIR/INITIAL_PASSWORD.txt');
  }
  await sql(`insert into public.app_owner (user_id, username) values ('${state.userId}', '${USERNAME}')
             on conflict (singleton) do update set user_id = excluded.user_id, username = excluded.username`);
  saveState();
}

async function seed() {
  if (!RATEBOOK) throw new Error('RATEBOOK required for seed');
  const json = readFileSync(RATEBOOK, 'utf8');
  JSON.parse(json);
  const tag = `rb_${randomUUID().replace(/-/g, '')}`;
  if (json.includes(`$${tag}$`)) throw new Error('tag collision');
  const uid = state.userId;
  const res = await sql(`
    with ins as (
      insert into public.tariff_versions (owner_id, version, label, is_original, data)
      select '${uid}', 1, 'القوائم الأصلية', true, $${tag}$${json}$${tag}$::jsonb
      where not exists (select 1 from public.tariff_versions where owner_id = '${uid}' and is_original)
      returning id)
    select id from ins union all select id from public.tariff_versions where owner_id = '${uid}' and is_original limit 1;`);
  const tid = res[0].id;
  await sql(`insert into public.user_settings (owner_id, idle_minutes, active_tariff_version_id) values ('${uid}', 30, '${tid}')
             on conflict (owner_id) do nothing`);
  console.log('seed: original rate list present');
}

// Live security checks against the real REST/Auth endpoints.
async function verify() {
  const { pub, secret } = await keys();
  const results = [];
  const ok = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };
  const rest = (path, { token, method = 'GET', body } = {}) => fetch(`${PROJECT}/rest/v1/${path}`, {
    method, headers: { apikey: pub, Authorization: `Bearer ${token ?? pub}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const authReq = (path, body) => fetch(`${PROJECT}/auth/v1/${path}`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  for (const t of ['quotes', 'clients', 'tariff_versions', 'user_settings', 'app_owner']) {
    const r = await rest(`${t}?select=*`);
    const body = await r.text();
    ok(`anon cannot read ${t}`, r.status === 401 || r.status === 403 || (r.ok && body === '[]'), `${r.status} ${body.slice(0, 80)}`);
  }
  const anonIns = await rest('clients', { method: 'POST', body: { name: 'x' } });
  ok('anon cannot insert', !anonIns.ok, String(anonIns.status));
  const su = await authReq('signup', { email: `probe-${Date.now()}@${DOMAIN}`, password: 'Probe-Password-123' });
  ok('public signup disabled', !su.ok, `${su.status}`);
  const anonSign = await authReq('signup', {});
  ok('anonymous sign-in disabled', !anonSign.ok, `${anonSign.status}`);
  const bad = await authReq('token?grant_type=password', { email: EMAIL, password: 'definitely-wrong-1' });
  ok('wrong password rejected', bad.status === 400 || bad.status === 401, String(bad.status));

  // second, unauthorised user (created through admin API, deleted afterwards)
  const pw2 = strongPassword();
  const other = await adminUser(secret, 'POST', '/users', { email: `intruder-${Date.now()}@${DOMAIN}`, password: pw2, email_confirm: true });
  try {
    const tok = await (await authReq('token?grant_type=password', { email: other.email, password: pw2 })).json();
    const t2 = tok.access_token;
    ok('second user can sign in (test setup)', !!t2);
    for (const t of ['quotes', 'clients', 'tariff_versions', 'user_settings']) {
      const r = await rest(`${t}?select=${t === 'user_settings' ? 'owner_id' : 'id'}`, { token: t2 });
      const b = await r.text();
      ok(`other user sees no ${t}`, (r.ok && b === '[]') || r.status === 403, `${r.status} ${b.slice(0, 60)}`);
    }
    const ins = await rest('clients', { token: t2, method: 'POST', body: { name: 'intruder' } });
    ok('other user cannot insert', !ins.ok, String(ins.status));
    const grab = await rest('app_owner', { token: t2, method: 'POST', body: { user_id: other.id, username: 'evil' } });
    ok('other user cannot self-grant owner', !grab.ok, String(grab.status));
    const rpc = await fetch(`${PROJECT}/rest/v1/rpc/is_app_owner`, { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json' }, body: '{}' });
    ok('is_app_owner false for other user', (await rpc.text()).trim() === 'false');
  } finally {
    await adminUser(secret, 'DELETE', `/users/${other.id}`);
  }
  const owners = await sql('select count(*)::int as n from public.app_owner');
  ok('exactly one registered owner', owners[0].n === 1);
  const users = await sql('select count(*)::int as n from auth.users');
  ok('exactly one auth user remains', users[0].n === 1, String(users[0].n));
  const rls = await sql(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
  ok('RLS enabled on every public table', rls.every((r) => r.relrowsecurity), JSON.stringify(rls));
  console.log(results.join('\n'));
  writeFileSync(join(OUT, 'verify-report.txt'), results.join('\n') + '\n');
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
}

async function publicConfig() {
  const { pub } = await keys();
  const cfg = `VITE_SUPABASE_URL=${PROJECT}\nVITE_SUPABASE_PUBLISHABLE_KEY=${pub}\nVITE_APP_USERNAME=${USERNAME}\nVITE_LOGIN_EMAIL_DOMAIN=${DOMAIN}\n`;
  writeFileSync(join(OUT, 'env.production'), cfg);
  console.log('public build config written to OUT_DIR/env.production (publishable key only)');
}

const run = { migrate, auth, user, seed, verify, config: publicConfig };
for (const s of steps) {
  if (!run[s]) throw new Error(`unknown step ${s}`);
  await run[s]();
}

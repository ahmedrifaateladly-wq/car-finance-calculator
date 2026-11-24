-- Car finance calculator: schema, access control and RLS.
-- Single fixed account. Every table is owner-scoped AND restricted to the one
-- authorised user registered in public.app_owner (not writable through the API).

begin;

-- 1. Authorised owner registry (no API access at all: RLS on, no policies, no grants).
create table if not exists public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_.-]{3,32}$'),
  created_at timestamptz not null default now()
);
alter table public.app_owner enable row level security;
revoke all on public.app_owner from public, anon, authenticated;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_owner o where o.user_id = (select auth.uid()));
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

-- 2. Rate-list versions (immutable; a change is a new version).
create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  label text not null check (char_length(label) between 1 and 200),
  is_original boolean not null default false,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 500000),
  created_at timestamptz not null default now(),
  unique (owner_id, version),
  unique (id, owner_id)
);
create unique index if not exists tariff_versions_one_original on public.tariff_versions (owner_id) where is_original;

-- 3. Per-user settings.
create table if not exists public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  idle_minutes integer not null default 30 check (idle_minutes between 5 and 240),
  active_tariff_version_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (active_tariff_version_id, owner_id) references public.tariff_versions (id, owner_id)
);

-- 4. Clients (minimal data; no national ID).
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  contact text not null default '' check (char_length(contact) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index if not exists clients_owner_name on public.clients (owner_id, lower(name));

-- 5. Saved quotes (immutable snapshots; only client link/title may change).
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  request_id uuid not null,
  client_id uuid,
  parent_quote_id uuid,
  tariff_version_id uuid,
  title text not null default '' check (char_length(title) <= 200),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) < 200000),
  created_at timestamptz not null default now(),
  unique (owner_id, request_id),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete set null (client_id),
  foreign key (parent_quote_id, owner_id) references public.quotes (id, owner_id) on delete set null (parent_quote_id),
  foreign key (tariff_version_id, owner_id) references public.tariff_versions (id, owner_id)
);
create index if not exists quotes_owner_created on public.quotes (owner_id, created_at desc);
create index if not exists quotes_client on public.quotes (client_id);

-- 6. Privileges: nothing for anon; minimal verbs for authenticated.
revoke all on public.tariff_versions, public.user_settings, public.clients, public.quotes from public, anon, authenticated;
grant select, insert on public.tariff_versions to authenticated;
grant select, insert, update (idle_minutes, active_tariff_version_id, updated_at) on public.user_settings to authenticated;
grant select, insert, delete, update (name, contact, notes, updated_at) on public.clients to authenticated;
grant select, insert, delete, update (client_id, title) on public.quotes to authenticated;

-- 7. RLS: row owner = caller AND caller is the registered app owner.
alter table public.tariff_versions enable row level security;
alter table public.user_settings enable row level security;
alter table public.clients enable row level security;
alter table public.quotes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tariff_versions', 'user_settings', 'clients', 'quotes'] loop
    execute format('drop policy if exists owner_select on public.%I', t);
    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('drop policy if exists owner_delete on public.%I', t);
    execute format($p$create policy owner_select on public.%I for select to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
    execute format($p$create policy owner_insert on public.%I for insert to authenticated
      with check (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
    execute format($p$create policy owner_update on public.%I for update to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
      with check (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
    execute format($p$create policy owner_delete on public.%I for delete to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
  end loop;
end $$;

-- 8. Integrity helpers.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.user_settings;
create trigger settings_touch before update on public.user_settings for each row execute function public.touch_updated_at();

-- The original rate list can only be created by the setup tool (service role / SQL), not via the API.
create or replace function public.guard_tariff_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_original and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'original rate list is created by setup only';
  end if;
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.version := coalesce((select max(v.version) from public.tariff_versions v where v.owner_id = new.owner_id), 0) + 1;
  end if;
  return new;
end; $$;
drop trigger if exists tariff_guard on public.tariff_versions;
create trigger tariff_guard before insert on public.tariff_versions for each row execute function public.guard_tariff_insert();

commit;

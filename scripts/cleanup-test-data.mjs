// Removes end-to-end test data (quotes, clients, non-original rate versions) and re-activates
// the original rate list. Run only before handover or after a live test.
//   PROJECT_REF=<ref> node scripts/cleanup-test-data.mjs
const REF = process.env.PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? 'proxy-injected';
const q = `
begin;
delete from public.quotes;
delete from public.clients;
update public.user_settings s set active_tariff_version_id = t.id, idle_minutes = 30
  from public.tariff_versions t where t.owner_id = s.owner_id and t.is_original;
delete from public.tariff_versions where not is_original;
commit;
select (select count(*) from public.quotes) as quotes, (select count(*) from public.clients) as clients,
       (select count(*) from public.tariff_versions) as tariff_versions,
       (select count(*) from auth.users) as users;`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
});
console.log(r.status, await r.text());

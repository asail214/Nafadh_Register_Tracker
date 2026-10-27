-- 002 — visit analytics + admin notifications. Run AFTER schema.sql, once, in the SQL Editor.
-- Additive only: no table/column is dropped and no existing row is changed. Safe to re-run.

-- ---------- Visit analytics (no IP, no personal data) ----------
-- visitor_id is a random UUID created in the visitor's browser (localStorage); it identifies nothing outside this site.
create table if not exists public.visits (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists visits_visitor_idx on public.visits (visitor_id, created_at desc);
create index if not exists visits_created_idx on public.visits (created_at);

alter table public.visits enable row level security;
revoke all on public.visits from anon;
drop policy if exists visits_admin_read on public.visits;
create policy visits_admin_read on public.visits for select to authenticated using (public.is_admin());

-- The only write path for visitors. Silently ignores:
--  * the same visitor again within 30 minutes (reloads / tab restores),
--  * anything above 600 recorded visits per hour overall (protects the free-tier database from scripted floods).
create or replace function public.record_visit(p_visitor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_visitor is null then return; end if;
  if exists (select 1 from public.visits where visitor_id = p_visitor and created_at > now() - interval '30 minutes') then
    return;
  end if;
  if (select count(*) from public.visits where created_at > now() - interval '1 hour') >= 600 then
    return;
  end if;
  insert into public.visits (visitor_id) values (p_visitor);
end $$;
revoke all on function public.record_visit(uuid) from public;
grant execute on function public.record_visit(uuid) to anon, authenticated;

-- Aggregates for the admin dashboard (returns nothing useful to non-admins).
create or replace function public.visit_stats()
returns table (total_visits bigint, unique_visitors bigint, first_visit timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select count(*), count(distinct visitor_id), min(created_at) from public.visits;
end $$;
revoke all on function public.visit_stats() from public;
grant execute on function public.visit_stats() to authenticated;

-- ---------- Notifications: "reviewed" marker on new entries ----------
alter table public.status_updates add column if not exists seen_at timestamptz;
alter table public.tickets add column if not exists seen_at timestamptz;

-- Admins may set seen_at (and, for tickets, status) — never the submitted content.
revoke update on public.status_updates from authenticated; -- drop the default table-wide UPDATE grant
grant update (seen_at) on public.status_updates to authenticated;
grant update (seen_at) on public.tickets to authenticated;
drop policy if exists status_admin_update on public.status_updates;
create policy status_admin_update on public.status_updates for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Realtime: changes are delivered only to subscribers who pass the tables' RLS (i.e. admins).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'status_updates') then
      alter publication supabase_realtime add table public.status_updates;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tickets') then
      alter publication supabase_realtime add table public.tickets;
    end if;
  end if;
end $$;

-- Linter hygiene (behaviour unchanged): pin search_path of the trigger function.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;

-- NAFADH Freelancers Tracker — Supabase schema (run once in SQL Editor; safe to re-run).
-- Visitors (anon) can ONLY: call submit_entry() and upload images into the private "attachments" bucket.
-- Everything else requires a logged-in user listed in public.admins (checked in the database via RLS).

-- ---------- Admins ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Target list (official list imported from CSV) ----------
create table if not exists public.targets (
  id bigint generated always as identity primary key,
  full_name text not null check (char_length(full_name) between 1 and 150),
  email text not null unique check (email = lower(btrim(email)) and email like '%_@_%'),
  registered_verified boolean,          -- null = not verified yet; set manually by admin
  profile_verified boolean,
  admin_note text check (char_length(admin_note) <= 1000),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Status updates (self-reported, full history kept) ----------
create table if not exists public.status_updates (
  id bigint generated always as identity primary key,
  email text not null,
  full_name text not null,
  has_account text not null check (has_account in ('yes', 'no', 'problem', 'unsure')),
  profile_status text not null check (profile_status in ('complete', 'partial', 'not_started', 'unsure')),
  missing_parts text[] not null default '{}'
    check (missing_parts <@ array['personal','bio','experience','skills','portfolio','documents','other']),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists status_updates_email_idx on public.status_updates (email, created_at desc);

-- ---------- Issues & suggestions ----------
create table if not exists public.tickets (
  id bigint generated always as identity primary key,       -- shown as NF-0001
  kind text not null check (kind in ('issue', 'suggestion')),
  email text not null,
  full_name text not null,
  category text check (category in ('registration','login','profile','upload','apply','other')),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  blocking boolean,
  status text not null default 'new' check (status in ('new', 'in_review', 'resolved')),
  upload_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_email_idx on public.tickets (email);

create table if not exists public.ticket_attachments (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets for each row execute function public.touch_updated_at();

-- ---------- RLS: admin only on every table ----------
alter table public.admins enable row level security;
alter table public.targets enable row level security;
alter table public.status_updates enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_attachments enable row level security;

revoke all on public.admins, public.targets, public.status_updates, public.tickets, public.ticket_attachments from anon;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policy on admins: admins are added only from the SQL Editor (see README).

drop policy if exists targets_admin on public.targets;
create policy targets_admin on public.targets for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists status_admin_read on public.status_updates;
create policy status_admin_read on public.status_updates for select to authenticated using (public.is_admin());

drop policy if exists tickets_admin_read on public.tickets;
create policy tickets_admin_read on public.tickets for select to authenticated using (public.is_admin());
drop policy if exists tickets_admin_update on public.tickets;
create policy tickets_admin_update on public.tickets for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists attachments_admin_read on public.ticket_attachments;
create policy attachments_admin_read on public.ticket_attachments for select to authenticated using (public.is_admin());

-- Admins may only change the status of a ticket, never the submitted content.
revoke update on public.tickets from authenticated;
grant update (status) on public.tickets to authenticated;

-- ---------- Public submission (the only write path for visitors) ----------
create or replace function public.submit_entry(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := regexp_replace(btrim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_title text := btrim(coalesce(p->>'title', ''));
  v_desc text := btrim(coalesce(p->>'description', ''));
  v_notes text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_missing text[];
  v_paths text[];
  v_upload uuid;
  v_path text;
  v_id bigint;
begin
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'invalid_email';
  end if;
  if char_length(v_name) not between 3 and 100 or v_name ~ '[<>{}0-9@]' then
    raise exception 'invalid_name';
  end if;

  -- basic abuse limits for a pilot: 10 entries / email / hour, 120 entries overall / 10 minutes
  if (select count(*) from public.status_updates where email = v_email and created_at > now() - interval '1 hour')
   + (select count(*) from public.tickets where email = v_email and created_at > now() - interval '1 hour') >= 10
  or (select count(*) from public.status_updates where created_at > now() - interval '10 minutes')
   + (select count(*) from public.tickets where created_at > now() - interval '10 minutes') >= 120 then
    raise exception 'rate_limited';
  end if;

  if v_kind = 'status' then
    v_missing := array(select distinct jsonb_array_elements_text(coalesce(p->'missing_parts', '[]'::jsonb)));
    if p->>'profile_status' <> 'partial' then v_missing := '{}'; end if;
    insert into public.status_updates (email, full_name, has_account, profile_status, missing_parts, notes)
    values (v_email, v_name, p->>'has_account', p->>'profile_status', v_missing, v_notes)
    returning id into v_id;
    return 'S-' || v_id;
  end if;

  if v_kind not in ('issue', 'suggestion') then raise exception 'invalid_kind'; end if;
  if v_kind = 'issue' and (p->>'category' is null or p->'blocking' is null or jsonb_typeof(p->'blocking') <> 'boolean') then
    raise exception 'invalid_issue';
  end if;

  v_paths := array(select jsonb_array_elements_text(coalesce(p->'attachments', '[]'::jsonb)));
  if cardinality(v_paths) > 3 then raise exception 'too_many_attachments'; end if;
  if cardinality(v_paths) > 0 then
    v_upload := (p->>'upload_id')::uuid;
    foreach v_path in array v_paths loop
      if v_path !~ ('^' || v_upload::text || '/[0-2]\.(webp|jpg|png)$')
         or not exists (select 1 from storage.objects where bucket_id = 'attachments' and name = v_path) then
        raise exception 'invalid_attachment';
      end if;
    end loop;
  end if;

  insert into public.tickets (kind, email, full_name, category, title, description, blocking, upload_id)
  values (
    v_kind, v_email, v_name,
    case when v_kind = 'issue' then p->>'category' end,
    v_title, v_desc,
    case when v_kind = 'issue' then (p->>'blocking')::boolean end,
    v_upload
  ) returning id into v_id;
  insert into public.ticket_attachments (ticket_id, path) select v_id, unnest(v_paths);
  return 'NF-' || lpad(v_id::text, 4, '0');
end $$;

revoke all on function public.submit_entry(jsonb) from public;
grant execute on function public.submit_entry(jsonb) to anon, authenticated;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- Storage: private bucket, 1 MB, images only ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Visitors may upload new files (no overwrite, no listing, no reading) using the <uuid>/<n>.<ext> layout.
drop policy if exists attachments_public_upload on storage.objects;
create policy attachments_public_upload on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-2]\.(webp|jpg|png)$'
  );

drop policy if exists attachments_admin_read on storage.objects;
create policy attachments_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_admin());

drop policy if exists attachments_admin_delete on storage.objects;
create policy attachments_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_admin());

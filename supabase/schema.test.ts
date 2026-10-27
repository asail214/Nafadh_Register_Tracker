// Runs supabase/schema.sql in an in-process Postgres (PGlite) with minimal stand-ins for
// Supabase's auth/storage schemas, then checks RLS and the public submission path.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
grant usage on schema public, auth, storage to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant usage on all sequences in schema storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const UPLOAD = '33333333-3333-4333-8333-333333333333';
let db: PGlite;

async function as(role: 'anon' | 'authenticated', uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const submit = (p: object) => as('anon', null, 'select public.submit_entry($1::jsonb) as ref', [JSON.stringify(p)]);
const person = { full_name: 'شخص خيالي', email: ' Fake.Person@Example.TEST ' };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.test'),('${OTHER}','other@x.test');
                 insert into public.admins values ('${ADMIN}');
                 insert into public.targets (full_name, email) values ('شخص خيالي','fake.person@example.test');`);
}, 60_000);

describe('schema.sql', () => {
  it('anon can submit all three kinds; email is normalized; repeated reports kept', async () => {
    const s = await submit({ ...person, kind: 'status', has_account: 'yes', profile_status: 'partial', missing_parts: ['skills', 'bio'] });
    expect(s.rows[0].ref).toMatch(/^S-\d+$/);
    const issue = { ...person, kind: 'issue', category: 'login', title: 'مشكلة دخول', description: 'لا يمكن تسجيل الدخول', blocking: true };
    const a = await submit(issue);
    const b = await submit(issue);
    expect(a.rows[0].ref).not.toBe(b.rows[0].ref);
    const g = await submit({ ...person, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا' });
    expect(g.rows[0].ref).toMatch(/^NF-\d{4}$/);
    const rows = await db.query<{ email: string }>('select distinct email from public.tickets');
    expect(rows.rows).toEqual([{ email: 'fake.person@example.test' }]);
  });

  it('rejects invalid input', async () => {
    await expect(submit({ ...person, email: 'bad email@x', kind: 'suggestion', title: 'abc', description: 'وصف الاقتراح هنا' })).rejects.toThrow(/invalid_email/);
    await expect(submit({ ...person, kind: 'status', has_account: 'maybe', profile_status: 'complete' })).rejects.toThrow();
    await expect(submit({ ...person, kind: 'issue', title: 'abc', description: 'وصف طويل بما يكفي' })).rejects.toThrow(/invalid_issue/);
    await expect(submit({ ...person, kind: 'hack' })).rejects.toThrow(/invalid_kind/);
  });

  it('anon cannot read or modify tables directly', async () => {
    for (const t of ['targets', 'status_updates', 'tickets', 'ticket_attachments', 'admins'])
      await expect(as('anon', null, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, `insert into public.admins values ('${OTHER}')`)).rejects.toThrow();
    await expect(as('anon', null, `update public.tickets set status='resolved'`)).rejects.toThrow();
  });

  it('logged-in non-admin sees nothing and cannot change anything', async () => {
    expect((await as('authenticated', OTHER, 'select public.is_admin() as a')).rows[0].a).toBe(false);
    expect((await as('authenticated', OTHER, 'select * from public.tickets')).rows).toHaveLength(0);
    expect((await as('authenticated', OTHER, 'select * from public.targets')).rows).toHaveLength(0);
    await as('authenticated', OTHER, `update public.tickets set status='resolved'`);
    await expect(as('authenticated', OTHER, `insert into public.admins values ('${OTHER}')`)).rejects.toThrow();
    await expect(as('authenticated', OTHER, `insert into public.targets (full_name,email) values ('x','x@x.test')`)).rejects.toThrow();
    const st = await db.query<{ n: number }>(`select count(*)::int n from public.tickets where status='resolved'`);
    expect(st.rows[0].n).toBe(0);
  });

  it('admin can read everything, change ticket status, verify targets — but not edit ticket content', async () => {
    expect((await as('authenticated', ADMIN, 'select public.is_admin() as a')).rows[0].a).toBe(true);
    expect((await as('authenticated', ADMIN, 'select * from public.tickets')).rows.length).toBeGreaterThan(0);
    await as('authenticated', ADMIN, `update public.tickets set status='in_review'`);
    await as('authenticated', ADMIN, `update public.targets set registered_verified=true, verified_at=now()`);
    await as('authenticated', ADMIN, `insert into public.targets (full_name,email) values ('آخر','other.target@x.test')`);
    await expect(as('authenticated', ADMIN, `update public.tickets set title='changed'`)).rejects.toThrow(/permission denied/);
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.tickets where status='in_review'`);
    expect(n.rows[0].n).toBeGreaterThan(0);
  });

  it('attachments: anon may upload only with the expected layout, cannot read; submit requires existing objects', async () => {
    await as('anon', null, `insert into storage.objects (bucket_id, name) values ('attachments', '${UPLOAD}/0.webp')`);
    await expect(as('anon', null, `insert into storage.objects (bucket_id, name) values ('attachments', '../evil.html')`)).rejects.toThrow();
    expect((await as('anon', null, 'select * from storage.objects')).rows).toHaveLength(0);
    const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id='attachments'`);
    expect(bucket.rows[0].public).toBe(false);

    const base = { ...person, kind: 'issue', category: 'upload', title: 'رفع', description: 'لا يمكن رفع الملف', blocking: false, upload_id: UPLOAD };
    await expect(submit({ ...base, attachments: [`${UPLOAD}/1.webp`] })).rejects.toThrow(/invalid_attachment/);
    const ok = await submit({ ...base, attachments: [`${UPLOAD}/0.webp`] });
    expect(ok.rows[0].ref).toMatch(/^NF-/);
    // the same upload cannot be attached to a second ticket
    await expect(submit({ ...base, attachments: [`${UPLOAD}/0.webp`] })).rejects.toThrow();
    expect((await as('authenticated', ADMIN, 'select * from storage.objects')).rows).toHaveLength(1);
    expect((await as('authenticated', OTHER, 'select * from storage.objects')).rows).toHaveLength(0);
  });

  it('rate-limits more than 10 entries per email per hour', async () => {
    const p = { full_name: 'محدود المعدل', email: 'limit@x.test', kind: 'suggestion', title: 'عنوان', description: 'وصف الاقتراح هنا' };
    for (let i = 0; i < 10; i++) await submit(p);
    await expect(submit(p)).rejects.toThrow(/rate_limited/);
  });
});

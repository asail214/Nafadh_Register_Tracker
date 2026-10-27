import { createClient } from '@supabase/supabase-js';
import type { Api, Ticket } from './types';
import { extFor } from './image';
import { normalizeEmail, normalizeName } from './validation';

const BUCKET = 'attachments';

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey);
  const check = <T,>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  return {
    mode: 'cloud',
    async submit(s) {
      const payload: Record<string, unknown> = {
        ...s,
        email: normalizeEmail(s.email),
        full_name: normalizeName(s.full_name),
      };
      if (s.kind !== 'status') {
        delete payload.images;
        const uploadId = crypto.randomUUID();
        const paths: string[] = [];
        for (const [i, img] of s.images.entries()) {
          const path = `${uploadId}/${i}.${extFor(img)}`;
          const { error } = await sb.storage.from(BUCKET).upload(path, img, { contentType: img.type, upsert: false });
          if (error) throw new Error('upload_failed');
          paths.push(path);
        }
        payload.upload_id = uploadId;
        payload.attachments = paths;
      }
      return check(await sb.rpc('submit_entry', { p: payload })) as string;
    },
    async getSessionEmail() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.email ?? null;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) throw new Error('بيانات الدخول غير صحيحة');
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async isAdmin() {
      const { data, error } = await sb.rpc('is_admin');
      return !error && data === true;
    },
    async loadAll() {
      const [targets, statuses, tickets] = await Promise.all([
        sb.from('targets').select('*').order('created_at'),
        sb.from('status_updates').select('*').order('created_at', { ascending: false }),
        sb.from('tickets').select('*, ticket_attachments(path)').order('created_at', { ascending: false }),
      ]);
      return {
        targets: check(targets) ?? [],
        statuses: check(statuses) ?? [],
        tickets: ((check(tickets) ?? []) as (Ticket & { ticket_attachments: { path: string }[] })[]).map(
          ({ ticket_attachments, ...t }) => ({ ...t, attachments: ticket_attachments.map((a) => a.path) }),
        ),
      };
    },
    async addTargets(rows) {
      if (!rows.length) return 0;
      const data = check(
        await sb
          .from('targets')
          .upsert(
            rows.map((r) => ({ full_name: normalizeName(r.full_name), email: normalizeEmail(r.email) })),
            { onConflict: 'email', ignoreDuplicates: true },
          )
          .select('id'),
      );
      return data?.length ?? 0;
    },
    async updateTarget(id, patch) {
      const extra = 'registered_verified' in patch || 'profile_verified' in patch ? { verified_at: new Date().toISOString() } : {};
      check(await sb.from('targets').update({ ...patch, ...extra }).eq('id', id));
    },
    async deleteTarget(id) {
      check(await sb.from('targets').delete().eq('id', id));
    },
    async setTicketStatus(id, status) {
      check(await sb.from('tickets').update({ status }).eq('id', id));
    },
    async attachmentUrls(paths) {
      if (!paths.length) return [];
      const data = check(await sb.storage.from(BUCKET).createSignedUrls(paths, 600));
      return paths.map((p) => data?.find((d) => d.path === p)?.signedUrl ?? '');
    },
    async recordVisit(visitorId) {
      await sb.rpc('record_visit', { p_visitor: visitorId }); // best effort; failures are ignored
    },
    async visitStats() {
      const { data, error } = await sb.rpc('visit_stats');
      const row = (data as { total_visits: number; unique_visitors: number; first_visit: string | null }[] | null)?.[0];
      if (error || !row) return null;
      return { total: Number(row.total_visits), unique: Number(row.unique_visitors), since: row.first_visit };
    },
    async markSeen(kind, ids) {
      if (!ids.length) return;
      const table = kind === 'status' ? 'status_updates' : 'tickets';
      check(await sb.from(table).update({ seen_at: new Date().toISOString() }).in('id', ids));
    },
    subscribe(onChange) {
      // Realtime delivers only rows the signed-in user may SELECT under RLS, i.e. admins only.
      const channel = sb
        .channel('admin-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'status_updates' }, onChange)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, onChange)
        .subscribe();
      return () => void sb.removeChannel(channel);
    },
  };
}

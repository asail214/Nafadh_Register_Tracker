import type { Api, Dataset, StatusUpdate, Ticket } from './types';
import { ticketRef } from './types';
import { normalizeEmail, normalizeName } from './validation';

/** Local-only backend: data stays in this browser (localStorage), images only in memory. Nothing is sent anywhere. */
const KEY = 'nft-demo-v1';
const RATE_LIMIT_PER_HOUR = 10;

export function createDemoApi(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): Api {
  let mem: Dataset & { seq: number } = load();
  const images = new Map<string, string>();

  function load() {
    try {
      const raw = storage?.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { targets: [], statuses: [], tickets: [], seq: 0 };
  }
  function save() {
    try {
      storage?.setItem(KEY, JSON.stringify(mem));
    } catch {
      /* ignore */
    }
  }
  const nextId = () => ++mem.seq;
  const now = () => new Date().toISOString();

  return {
    mode: 'demo',
    async submit(s) {
      const email = normalizeEmail(s.email);
      const full_name = normalizeName(s.full_name);
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const recent = [...mem.statuses, ...mem.tickets].filter((x) => x.email === email && x.created_at > hourAgo);
      if (recent.length >= RATE_LIMIT_PER_HOUR) throw new Error('rate_limited');
      if (s.kind === 'status') {
        const row: StatusUpdate = {
          id: nextId(),
          email,
          full_name,
          has_account: s.has_account,
          profile_status: s.profile_status,
          missing_parts: s.profile_status === 'partial' ? s.missing_parts : [],
          notes: s.notes.trim() || null,
          created_at: now(),
        };
        mem.statuses.push(row);
        save();
        return 'S-' + row.id;
      }
      const id = nextId();
      const attachments = s.images.map((img, i) => {
        const path = `demo-${id}/${i}`;
        images.set(path, URL.createObjectURL(img));
        return path;
      });
      const t: Ticket = {
        id,
        kind: s.kind,
        email,
        full_name,
        category: s.kind === 'issue' ? s.category : null,
        title: s.title.trim(),
        description: s.description.trim(),
        blocking: s.kind === 'issue' ? s.blocking : null,
        status: 'new',
        created_at: now(),
        updated_at: now(),
        attachments,
      };
      mem.tickets.push(t);
      save();
      return ticketRef(id);
    },
    async getSessionEmail() {
      return 'demo@local';
    },
    async signIn() {},
    async signOut() {},
    async isAdmin() {
      return true;
    },
    async loadAll() {
      return structuredClone({ targets: mem.targets, statuses: mem.statuses, tickets: mem.tickets });
    },
    async addTargets(rows) {
      const existing = new Set(mem.targets.map((t) => t.email));
      let added = 0;
      for (const r of rows) {
        const email = normalizeEmail(r.email);
        if (existing.has(email)) continue;
        existing.add(email);
        mem.targets.push({
          id: nextId(),
          full_name: normalizeName(r.full_name),
          email,
          registered_verified: null,
          profile_verified: null,
          admin_note: null,
          verified_at: null,
          created_at: now(),
        });
        added++;
      }
      save();
      return added;
    },
    async updateTarget(id, patch) {
      const t = mem.targets.find((x) => x.id === id);
      if (!t) throw new Error('not_found');
      Object.assign(t, patch);
      if ('registered_verified' in patch || 'profile_verified' in patch) t.verified_at = now();
      save();
    },
    async deleteTarget(id) {
      mem.targets = mem.targets.filter((x) => x.id !== id);
      save();
    },
    async setTicketStatus(id, status) {
      const t = mem.tickets.find((x) => x.id === id);
      if (!t) throw new Error('not_found');
      t.status = status;
      t.updated_at = now();
      save();
    },
    async attachmentUrls(paths) {
      return paths.map((p) => images.get(p) ?? '');
    },
  };
}

function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function resetDemoData() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

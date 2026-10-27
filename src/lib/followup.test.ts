import { describe, expect, it } from 'vitest';
import { createDemoApi } from './demoApi';
import { fetchAllPages } from './paginate';
import { actionFromUrl, clearRemembered, loadRemembered, REMEMBER_KEY, saveRemembered } from './remember';
import { computeStats, emptyStatusFilter, filterStatusRows, statusRows } from './stats';
import { trackVisit } from './visit';

const memStore = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const a = { full_name: 'شخص خيالي', email: 'fake.a@example.test' };
const b = { full_name: 'آخر خيالي', email: 'fake.b@example.test' };
const status = (has_account: 'yes' | 'no' | 'problem' | 'unsure', profile_status: 'complete' | 'partial' | 'not_started' | 'unsure', missing_parts: string[] = []) =>
  ({ kind: 'status', has_account, profile_status, missing_parts, notes: '' }) as const;

describe('repeated status updates', () => {
  it('keeps every update; counts and distribution use only the latest per person', async () => {
    const api = createDemoApi(memStore());
    await api.submit({ ...a, ...status('no', 'not_started') });
    await api.submit({ ...a, ...status('yes', 'partial', ['skills']) });
    await api.submit({ ...a, ...status('yes', 'complete') });
    await api.submit({ ...b, ...status('yes', 'partial', ['bio']) });
    await api.submit({ ...b, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا', images: [] });
    const data = await api.loadAll();
    const s = computeStats(data);
    expect(s.statusUpdates).toBe(4);
    expect(s.statusRespondents).toBe(2);
    expect(s.respondents).toBe(2);
    expect(s.profileStatus).toEqual({ complete: 1, partial: 1 });
    expect(s.hasAccount).toEqual({ yes: 2 });
    expect(s.hasList).toBe(false);
    expect(s.participationRate).toBeNull();

    const latest = statusRows(data, 'latest');
    expect(latest).toHaveLength(2);
    const ra = latest.find((r) => r.status.email === a.email)!;
    expect(ra.status.profile_status).toBe('complete');
    expect(ra.updates).toBe(3);
    expect(ra.target).toBeNull(); // works without a target list
    expect(statusRows(data, 'all')).toHaveLength(4);
  });

  it('filters latest vs all, and by list membership without touching the list', async () => {
    const api = createDemoApi(memStore());
    await api.addTargets([a]);
    await api.submit({ ...a, ...status('yes', 'partial', ['skills']) });
    await api.submit({ ...a, ...status('yes', 'complete') });
    await api.submit({ ...b, ...status('no', 'partial', ['bio']) });
    const data = await api.loadAll();
    const f = emptyStatusFilter();
    // latest: a is complete now, so only b is partial
    expect(filterStatusRows(statusRows(data, 'latest'), { ...f, profile_status: 'partial' }).map((r) => r.status.email)).toEqual([b.email]);
    // all: a's earlier partial update is included
    expect(filterStatusRows(statusRows(data, 'all'), { ...f, view: 'all', profile_status: 'partial' })).toHaveLength(2);
    expect(filterStatusRows(statusRows(data, 'latest'), { ...f, list: 'out' }).map((r) => r.status.email)).toEqual([b.email]);
    expect(filterStatusRows(statusRows(data, 'latest'), { ...f, missing: 'bio' })).toHaveLength(1);
    expect(filterStatusRows(statusRows(data, 'latest'), { ...f, q: 'FAKE.A' })).toHaveLength(1);
    expect(data.targets).toHaveLength(1); // respondents outside the list are never added automatically
  });

  it('open = new + in review; resolved items are not open', async () => {
    const api = createDemoApi(memStore());
    const issue = { ...a, kind: 'issue' as const, category: 'login', title: 'مشكلة دخول', description: 'وصف تجريبي للمشكلة', images: [] };
    await api.submit({ ...issue, blocking: true });
    await api.submit({ ...issue, blocking: false });
    await api.submit({ ...issue, blocking: true });
    const [t1, t2] = (await api.loadAll()).tickets;
    await api.setTicketStatus(t1.id, 'resolved');
    await api.setTicketStatus(t2.id, 'in_review');
    const s = computeStats(await api.loadAll());
    expect(s.issues).toBe(3);
    expect(s.openIssues).toBe(2);
    expect(s.openIssuesBlocking).toBe(s.openIssues - (t2.blocking ? 0 : 1));
  });
});

describe('remember on this device', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-10-27T10:00:00Z');
  const data = { ...a, status: { has_account: 'yes', profile_status: 'partial', missing_parts: ['skills'] }, status_at: '2026-10-27T10:00:00.000Z' };

  it('nothing is stored unless saved explicitly; save → load → clear', () => {
    const st = memStore();
    expect(loadRemembered(st, now)).toBeNull();
    expect(st.m.size).toBe(0);
    expect(saveRemembered(data, st, now)).toBe(true);
    expect(loadRemembered(st, now)).toMatchObject({ ...a, status: data.status });
    expect(clearRemembered(st)).toBe(true);
    expect(loadRemembered(st, now)).toBeNull();
  });

  it('keeps only name, email and status answers (no notes, tickets or attachments)', () => {
    const st = memStore();
    saveRemembered({ ...data, notes: 'سري', title: 'x', images: ['blob'] } as never, st, now);
    expect(Object.keys(JSON.parse(st.m.get(REMEMBER_KEY)!)).sort()).toEqual(['email', 'full_name', 'saved_at', 'status', 'status_at']);
    expect(Object.keys(loadRemembered(st, now)!.status!).sort()).toEqual(['has_account', 'missing_parts', 'profile_status']);
  });

  it('expires after 90 days and is removed', () => {
    const st = memStore();
    saveRemembered(data, st, now);
    expect(loadRemembered(st, now + 89 * day)).not.toBeNull();
    expect(loadRemembered(st, now + 91 * day)).toBeNull();
    expect(st.m.has(REMEMBER_KEY)).toBe(false);
  });

  it('ignores tampered or invalid values', () => {
    const st = memStore();
    st.setItem(REMEMBER_KEY, '{not json');
    expect(loadRemembered(st, now)).toBeNull();
    st.setItem(REMEMBER_KEY, JSON.stringify({ ...data, saved_at: new Date(now).toISOString(), status: { has_account: 'hacked', profile_status: 'complete' } }));
    expect(loadRemembered(st, now)?.status).toBeNull();
    st.setItem(REMEMBER_KEY, JSON.stringify({ ...data, saved_at: new Date(now).toISOString(), status: { has_account: 'yes', profile_status: 'complete', missing_parts: ['skills'] } }));
    expect(loadRemembered(st, now)?.status?.missing_parts).toEqual([]); // parts only apply to "partial"
  });

  it('works safely when storage is blocked', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRemembered(throwing, now)).toBeNull();
    expect(saveRemembered(data, throwing, now)).toBe(false);
    expect(clearRemembered(throwing)).toBe(false);
    expect(loadRemembered(null)).toBeNull();
    expect(saveRemembered(data, null)).toBe(false);
  });

  it('visit tracking does not crash when the browser blocks storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    let calls = 0;
    expect(() => trackVisit({ recordVisit: async () => void calls++ }, { local: blocked, session: blocked })).not.toThrow();
    expect(calls).toBe(0);
  });

  it('reads ?action= links', () => {
    expect(actionFromUrl('?action=status')).toBe('status');
    expect(actionFromUrl('?action=issue&x=1')).toBe('issue');
    expect(actionFromUrl('?action=suggestion')).toBe('suggestion');
    expect(actionFromUrl('?action=admin')).toBeNull();
    expect(actionFromUrl('')).toBeNull();
  });
});

describe('pagination', () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({ id: i + 1 }));

  it('reads past the 1000-row cap', async () => {
    const calls: [number, number][] = [];
    const out = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return rows.slice(from, Math.min(to + 1, from + 1000));
    });
    expect(out).toHaveLength(2345);
    expect(calls[0]).toEqual([0, 999]);
  });

  it('still reads everything when the server caps pages lower than requested', async () => {
    const out = await fetchAllPages(async (from, to) => rows.slice(from, Math.min(to + 1, from + 300)));
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('does not duplicate rows and stops on a runaway source', async () => {
    expect(await fetchAllPages(async (from) => (from === 0 ? [{ id: 1 }, { id: 1 }] : []))).toEqual([{ id: 1 }]);
    await expect(fetchAllPages(async () => [{ id: 1 }], 1000, 5)).rejects.toThrow('too_many_rows');
  });
});

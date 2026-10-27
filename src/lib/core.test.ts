import { describe, expect, it } from 'vitest';
import { extractTargets, parseCsv, toCsv } from './csv';
import { createDemoApi } from './demoApi';
import { computeStats, targetRows } from './stats';
import { emailError, nameError, normalizeEmail } from './validation';

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const base = { full_name: 'تجربة خيالية', email: '  Demo.User@Example.TEST ' };

describe('validation', () => {
  it('normalizes and validates email', () => {
    expect(normalizeEmail(' A@B.Com ')).toBe('a@b.com');
    expect(emailError('a b@c.com')).not.toBeNull();
    expect(emailError('abc@')).not.toBeNull();
    expect(emailError(' Ok@Mail.om ')).toBeNull();
  });
  it('validates name', () => {
    expect(nameError('  ')).not.toBeNull();
    expect(nameError('أب')).not.toBeNull();
    expect(nameError('<script>')).not.toBeNull();
    expect(nameError('  سالم   الخيالي ')).toBeNull();
  });
});

describe('csv', () => {
  it('imports with header, dedupes and skips invalid', () => {
    const t = parseCsv('﻿الاسم,البريد\r\n"أحمد, التجريبي",A@x.test\nمكرر,a@X.test\nخطأ,not-an-email\nسارة,s@x.test\n');
    const r = extractTargets(t, new Set(['s@x.test']));
    expect(r.rows).toEqual([{ full_name: 'أحمد, التجريبي', email: 'a@x.test' }]);
    expect(r.duplicates).toBe(2);
    expect(r.invalid).toBe(1);
  });
  it('imports without header and with semicolons', () => {
    const r = extractTargets(parseCsv('b@x.test;بدر\nc@x.test;جود'));
    expect(r.rows.map((x) => x.full_name)).toEqual(['بدر', 'جود']);
  });
  it('exports with BOM and neutralizes formulas', () => {
    const out = toCsv([['a', '=1+1', 'x,"y"']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain("'=1+1");
    expect(out).toContain('"x,""y"""');
  });
});

describe('demo api: three paths, duplicates, stats', () => {
  it('records all three submission kinds and keeps repeated reports', async () => {
    const api = createDemoApi(memStore());
    const s1 = await api.submit({ ...base, kind: 'status', has_account: 'yes', profile_status: 'partial', missing_parts: ['skills'], notes: '' });
    const r1 = await api.submit({ ...base, kind: 'issue', category: 'login', title: 'لا أستطيع الدخول', description: 'رسالة خطأ عند الدخول', blocking: true, images: [] });
    const r2 = await api.submit({ ...base, kind: 'issue', category: 'login', title: 'لا أستطيع الدخول', description: 'رسالة خطأ عند الدخول', blocking: true, images: [] });
    const g1 = await api.submit({ ...base, kind: 'suggestion', title: 'اقتراح', description: 'إضافة إشعارات بالبريد', images: [] });
    expect(s1).toMatch(/^S-\d+$/);
    expect(r1).not.toBe(r2);
    expect(g1).toMatch(/^NF-\d{4}$/);
    const d = await api.loadAll();
    expect(d.statuses).toHaveLength(1);
    expect(d.tickets).toHaveLength(3);
    expect(new Set(d.tickets.map((t) => t.email))).toEqual(new Set(['demo.user@example.test']));
  });

  it('does not compute rates without a target list', async () => {
    const api = createDemoApi(memStore());
    await api.submit({ ...base, kind: 'status', has_account: 'yes', profile_status: 'complete', missing_parts: [], notes: '' });
    const st = computeStats(await api.loadAll());
    expect(st.participationRate).toBeNull();
    expect(st.nonRespondents).toBeNull();
    expect(st.respondents).toBe(1);
  });

  it('computes participation from unique people in list; keeps reported vs verified apart', async () => {
    const api = createDemoApi(memStore());
    const added = await api.addTargets([
      { full_name: 'أ', email: 'demo.user@example.test' },
      { full_name: 'ب', email: 'b@x.test' },
      { full_name: 'ج', email: 'C@x.test' },
      { full_name: 'د', email: 'c@x.test' }, // duplicate
    ]);
    expect(added).toBe(3);
    expect(await api.addTargets([{ full_name: 'ب', email: ' B@X.test ' }])).toBe(0); // already listed
    await api.submit({ ...base, kind: 'status', has_account: 'no', profile_status: 'not_started', missing_parts: [], notes: '' });
    await api.submit({ ...base, kind: 'status', has_account: 'yes', profile_status: 'complete', missing_parts: [], notes: '' });
    await api.submit({ ...base, kind: 'issue', category: 'other', title: 'عنوان', description: 'وصف كافٍ للمشكلة', blocking: false, images: [] });
    await api.submit({ full_name: 'خارج القائمة', email: 'z@x.test', kind: 'suggestion', title: 'عنوان', description: 'وصف كافٍ للاقتراح', images: [] });
    const d = await api.loadAll();
    const st = computeStats(d);
    expect(st.totalTargets).toBe(3);
    expect(st.respondentsInList).toBe(1);
    expect(st.respondentsOutsideList).toBe(1);
    expect(st.nonRespondents).toBe(2); // not "unregistered"
    expect(st.participationRate).toBe(33.3);
    expect(st.registeredReported).toBe(1); // latest status wins
    expect(st.registeredVerified).toBe(0); // self-report is not verification
    const row = targetRows(d).find((r) => r.target.email === 'demo.user@example.test')!;
    expect(row.history).toHaveLength(2);
    expect(row.latest?.has_account).toBe('yes');
    expect(row.issues).toBe(1);

    await api.updateTarget(row.target.id, { registered_verified: true, profile_verified: true });
    const st2 = computeStats(await api.loadAll());
    expect(st2.registeredVerified).toBe(1);
    expect(st2.profileVerifiedRate).toBe(33.3);
  });

  it('rate-limits repeated submissions from the same email', async () => {
    const api = createDemoApi(memStore());
    const s = { ...base, kind: 'suggestion' as const, title: 'عنوان', description: 'وصف كافٍ للاقتراح', images: [] };
    for (let i = 0; i < 10; i++) await api.submit(s);
    await expect(api.submit(s)).rejects.toThrow('rate_limited');
  });

  it('updates ticket status', async () => {
    const api = createDemoApi(memStore());
    await api.submit({ ...base, kind: 'suggestion', title: 'عنوان', description: 'وصف كافٍ للاقتراح', images: [] });
    const [t] = (await api.loadAll()).tickets;
    await api.setTicketStatus(t.id, 'resolved');
    expect((await api.loadAll()).tickets[0].status).toBe('resolved');
  });
});

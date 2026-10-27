import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { createDemoApi } from './demoApi';
import { buildSheets, cleanCell, workbookBuffer } from './excel';
import { computeConversion } from './stats';
import { trackVisit } from './visit';

const memStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const person = { full_name: 'شخص خيالي', email: 'fake@example.test' };

async function sampleData() {
  const api = createDemoApi(memStore());
  await api.addTargets([person, { full_name: 'آخر خيالي', email: 'other@example.test' }]);
  await api.submit({ ...person, kind: 'status', has_account: 'yes', profile_status: 'partial', missing_parts: ['skills'], notes: '' });
  await api.submit({ ...person, kind: 'issue', category: 'login', title: '=HYPERLINK("x")', description: 'وصف\u0007 تجريبي للمشكلة', blocking: true, images: [] });
  await api.submit({ ...person, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا', images: [] });
  return api;
}

describe('excel export', () => {
  it('builds four RTL sheets with Arabic headers, Cairo font and safe text cells', async () => {
    const api = await sampleData();
    const sheets = buildSheets(await api.loadAll(), { total: 10, unique: 4, since: '2000-01-01T00:00:00Z' });
    expect(sheets.map((s) => s.name)).toEqual(['الملخص', 'المستقلون', 'البلاغات والمقترحات', 'حالة المعالجة']);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await workbookBuffer(sheets));
    const tickets = wb.getWorksheet('البلاغات والمقترحات')!;
    expect(tickets.views[0].rightToLeft).toBe(true);
    expect(tickets.getRow(1).getCell(1).font?.name).toBe('Cairo');
    const titleCell = tickets.getRow(2).getCell(7);
    expect(titleCell.type).toBe(ExcelJS.ValueType.String); // not a formula
    expect(titleCell.value).toBe('=HYPERLINK("x")');
    expect(String(tickets.getRow(2).getCell(8).value)).not.toContain('\u0007');
    expect(wb.getWorksheet('المستقلون')!.rowCount).toBe(3);
    const processing = wb.getWorksheet('حالة المعالجة')!;
    expect(processing.getRow(2).getCell(4).value).toBe('جديد');
    expect(processing.getRow(2).getCell(7).value).toBe('لا'); // not yet reviewed
  });

  it('summary shows "not available" instead of rates when there is no target list', async () => {
    const api = createDemoApi(memStore());
    await api.submit({ ...person, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا', images: [] });
    const summary = buildSheets(await api.loadAll(), null)[0].rows;
    const row = summary.find((r) => r[0] === 'نسبة المشاركة')!;
    expect(row[1]).toBe('غير متاح حتى استيراد القائمة');
    expect(summary.find((r) => r[0] === 'نسبة التحويل')![1]).toBe('غير متاح');
  });

  it('cleanCell keeps numbers and caps length', () => {
    expect(cleanCell(5)).toBe(5);
    expect(String(cleanCell('x'.repeat(40000))).length).toBe(32000);
  });
});

describe('visit analytics', () => {
  it('conversion = unique submitters since tracking started ÷ unique visitors', async () => {
    const api = await sampleData();
    const data = await api.loadAll();
    expect(computeConversion(data, null)).toBeNull();
    expect(computeConversion(data, { total: 10, unique: 4, since: '2000-01-01T00:00:00Z' })).toEqual({ submitters: 1, entries: 3, rate: 25 });
    // submissions made before tracking started are not counted
    expect(computeConversion(data, { total: 10, unique: 4, since: '2999-01-01T00:00:00Z' })!.submitters).toBe(0);
    expect(computeConversion(data, { total: 0, unique: 0, since: null })!.rate).toBeNull();
  });

  it('counts one visit per session and ignores the same visitor within 30 minutes', async () => {
    const api = createDemoApi(memStore());
    const local = memStore();
    trackVisit(api, { local, session: memStore() } as never);
    trackVisit(api, { local, session: memStore() } as never); // new session, same visitor, < 30 min
    const session = memStore();
    trackVisit(api, { local: memStore(), session } as never); // another visitor
    trackVisit(api, { local: memStore(), session } as never); // reload in the same session: skipped
    await new Promise((r) => setTimeout(r, 0));
    expect(await api.visitStats()).toMatchObject({ total: 2, unique: 2 });
  });
});

describe('notifications (demo)', () => {
  it('new entries are unseen, markSeen clears them, and subscribers are notified', async () => {
    const api = createDemoApi(memStore());
    let calls = 0;
    const off = api.subscribe(() => calls++);
    await api.submit({ ...person, kind: 'status', has_account: 'no', profile_status: 'not_started', missing_parts: [], notes: '' });
    await api.submit({ ...person, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا', images: [] });
    expect(calls).toBe(2);
    let d = await api.loadAll();
    expect(d.statuses[0].seen_at).toBeNull();
    await api.markSeen('status', [d.statuses[0].id]);
    await api.markSeen('ticket', d.tickets.map((t) => t.id));
    d = await api.loadAll();
    expect(d.statuses[0].seen_at).toBeTruthy();
    expect(d.tickets[0].seen_at).toBeTruthy();
    off();
    await api.submit({ ...person, kind: 'suggestion', title: 'اقتراح', description: 'وصف الاقتراح هنا', images: [] });
    expect(calls).toBe(2);
  });
});

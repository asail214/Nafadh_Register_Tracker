import { downloadBlob } from './csv';
import { HAS_ACCOUNT, ISSUE_CATEGORY, MISSING_PARTS, PROFILE_STATUS, TICKET_KIND, TICKET_STATUS } from './labels';
import { computeConversion, computeStats, targetRows } from './stats';
import { ticketRef, type Dataset, type VisitStats } from './types';

type Cell = string | number;
export interface SheetSpec {
  name: string;
  columns: { header: string; width: number }[];
  rows: Cell[][];
}

const NA = 'غير متاح حتى استيراد القائمة';
const yesNo = (v: boolean | null | undefined, empty = 'غير محدد') => (v == null ? empty : v ? 'نعم' : 'لا');
const rate = (r: number | null) => (r === null ? NA : `${r}%`);

/** Local Oman time as sortable text (avoids Excel's UTC date shift). */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Muscat' }).slice(0, 16) : '';

/**
 * Cell text is always written as a plain string value (never a formula). Characters that are
 * invalid in the xlsx XML are removed and the length is capped at Excel's cell limit.
 */
export function cleanCell(v: Cell): Cell {
  if (typeof v === 'number') return v;
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').slice(0, 32000);
}

export function buildSheets(data: Dataset, visits: VisitStats | null): SheetSpec[] {
  const s = computeStats(data);
  const conv = computeConversion(data, visits);
  const rows = targetRows(data);
  const listed = (n: number | null) => (s.hasList ? (n ?? 0) : NA);

  const summary: Cell[][] = [
    ['تاريخ التصدير', fmtDate(new Date().toISOString()), 'بتوقيت مسقط'],
    ['إجمالي المستقلين المستهدفين', listed(s.totalTargets), ''],
    ['المستجيبون الفريدون من القائمة', listed(s.respondentsInList), ''],
    ['نسبة المشاركة', rate(s.participationRate), 'المستجيبون من القائمة ÷ إجمالي القائمة × 100'],
    ['لم يردوا بعد', listed(s.nonRespondents), 'عدم الرد لا يعني عدم التسجيل'],
    ['إجمالي المستجيبين الفريدين', s.respondents, 'بحسب البريد المطبّع'],
    ['مستجيبون من خارج القائمة', s.respondentsOutsideList, ''],
    ['أفاد بأن لديه حساب', s.registeredReported, 'إفادة ذاتية (آخر تحديث)'],
    ['تسجيل متحقق منه', s.registeredVerified, `من القائمة: ${rate(s.registeredVerifiedRate)}`],
    ['أفاد باكتمال الملف', s.profileCompleteReported, 'إفادة ذاتية (آخر تحديث)'],
    ['اكتمال متحقق منه', s.profileCompleteVerified, `من القائمة: ${rate(s.profileVerifiedRate)}`],
    ['إجمالي المشكلات', s.issues, `تمنع الإكمال: ${s.issuesBlocking}`],
    ...Object.entries(TICKET_STATUS).map(([k, l]): Cell[] => [`المشكلات — ${l}`, s.issuesByStatus[k] ?? 0, '']),
    ...Object.entries(ISSUE_CATEGORY).map(([k, l]): Cell[] => [`المشكلات — ${l}`, s.issuesByCategory[k] ?? 0, 'حسب التصنيف']),
    ['إجمالي الاقتراحات', s.suggestions, ''],
    ...Object.entries(TICKET_STATUS).map(([k, l]): Cell[] => [`الاقتراحات — ${l}`, s.suggestionsByStatus[k] ?? 0, '']),
    ['إجمالي الزيارات', visits ? visits.total : 'غير متاح', 'زيارة واحدة لكل جلسة متصفح، بدون /admin'],
    ['الزوار الفريدون (تقريبي)', visits ? visits.unique : 'غير متاح', 'معرّف عشوائي في المتصفح، بلا IP'],
    ['المشاركون منذ بدء قياس الزيارات', conv ? conv.submitters : 'غير متاح', 'بريد فريد'],
    ['نسبة التحويل', conv?.rate == null ? 'غير متاح' : `${conv.rate}%`, 'المشاركون الفريدون ÷ الزوار الفريدون × 100 (تقريبية)'],
  ];

  return [
    {
      name: 'الملخص',
      columns: [
        { header: 'البند', width: 38 },
        { header: 'القيمة', width: 24 },
        { header: 'ملاحظة', width: 52 },
      ],
      rows: summary,
    },
    {
      name: 'المستقلون',
      columns: [
        { header: 'الاسم', width: 28 },
        { header: 'البريد الإلكتروني', width: 32 },
        { header: 'لديه حساب (إفادة)', width: 18 },
        { header: 'حالة الملف (إفادة)', width: 18 },
        { header: 'الأجزاء الناقصة', width: 34 },
        { header: 'تسجيل متحقق', width: 14 },
        { header: 'اكتمال متحقق', width: 14 },
        { header: 'آخر مشاركة', width: 18 },
        { header: 'عدد المشكلات', width: 13 },
        { header: 'عدد الاقتراحات', width: 13 },
        { header: 'ملاحظة الإدارة', width: 36 },
      ],
      rows: rows.map((r) => [
        r.target.full_name,
        r.target.email,
        r.latest ? HAS_ACCOUNT[r.latest.has_account] : 'لم يرد',
        r.latest ? PROFILE_STATUS[r.latest.profile_status] : 'لم يرد',
        r.latest?.missing_parts.map((m) => MISSING_PARTS[m]).join('، ') ?? '',
        yesNo(r.target.registered_verified),
        yesNo(r.target.profile_verified),
        fmtDate(r.lastActivity),
        r.issues,
        r.suggestions,
        r.target.admin_note ?? '',
      ]),
    },
    {
      name: 'البلاغات والمقترحات',
      columns: [
        { header: 'المرجع', width: 11 },
        { header: 'النوع', width: 10 },
        { header: 'التاريخ', width: 18 },
        { header: 'الاسم', width: 26 },
        { header: 'البريد الإلكتروني', width: 30 },
        { header: 'التصنيف', width: 18 },
        { header: 'العنوان', width: 32 },
        { header: 'الوصف', width: 60 },
        { header: 'يمنع الإكمال', width: 12 },
        { header: 'عدد الصور', width: 10 },
      ],
      rows: data.tickets.map((t) => [
        ticketRef(t.id),
        TICKET_KIND[t.kind],
        fmtDate(t.created_at),
        t.full_name,
        t.email,
        t.category ? ISSUE_CATEGORY[t.category] : '',
        t.title,
        t.description,
        t.kind === 'issue' ? yesNo(t.blocking, '') : '',
        t.attachments.length,
      ]),
    },
    {
      name: 'حالة المعالجة',
      columns: [
        { header: 'المرجع', width: 11 },
        { header: 'النوع', width: 10 },
        { header: 'العنوان', width: 36 },
        { header: 'حالة المعالجة', width: 16 },
        { header: 'تاريخ الإرسال', width: 18 },
        { header: 'آخر تحديث', width: 18 },
        { header: 'تمت المراجعة', width: 13 },
      ],
      rows: data.tickets.map((t) => [
        ticketRef(t.id),
        TICKET_KIND[t.kind],
        t.title,
        TICKET_STATUS[t.status],
        fmtDate(t.created_at),
        fmtDate(t.updated_at),
        t.seen_at === undefined ? '' : t.seen_at ? 'نعم' : 'لا',
      ]),
    },
  ];
}

/** Builds the .xlsx in the browser; exceljs is loaded only when an export is requested. */
export async function workbookBuffer(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NAFADH Freelancers Tracker';
  const font = { name: 'Cairo', size: 11 };
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = spec.columns.map((c) => ({ header: c.header, width: c.width }));
    for (const r of spec.rows) ws.addRow(r.map(cleanCell));
    ws.eachRow((row, n) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = n === 1 ? { ...font, bold: true, color: { argb: 'FFFFFFFF' } } : font;
        cell.alignment = { vertical: 'top', horizontal: 'right', wrapText: true, readingOrder: 'rtl' };
        if (n === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24529B' } };
      });
    });
    if (spec.rows.length && spec.name !== 'الملخص')
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function exportExcel(data: Dataset, visits: VisitStats | null) {
  const buf = await workbookBuffer(buildSheets(data, visits));
  downloadBlob(
    `nafadh-tracker-${new Date().toISOString().slice(0, 10)}.xlsx`,
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
}

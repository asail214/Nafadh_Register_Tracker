import { emailError, normalizeEmail, normalizeName } from './validation';

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface ImportResult {
  rows: { full_name: string; email: string }[];
  invalid: number;
  duplicates: number;
}

/** Extracts name+email rows, normalizes emails and removes duplicates (within the file and against `existing`). */
export function extractTargets(table: string[][], existing: Set<string> = new Set()): ImportResult {
  if (!table.length) return { rows: [], invalid: 0, duplicates: 0 };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const hasHeader = !header.some((h) => h.includes('@'));
  let emailCol = hasHeader ? header.findIndex((h) => /mail|بريد/.test(h)) : -1;
  let nameCol = hasHeader ? header.findIndex((h) => /name|اسم/.test(h)) : -1;
  const body = hasHeader ? table.slice(1) : table;
  if (emailCol < 0) emailCol = Math.max(0, (body[0] ?? []).findIndex((c) => c.includes('@')));
  if (nameCol < 0 || nameCol === emailCol) nameCol = emailCol === 0 ? 1 : 0;

  const seen = new Set(existing);
  const out: ImportResult = { rows: [], invalid: 0, duplicates: 0 };
  for (const r of body) {
    const email = normalizeEmail(r[emailCol] ?? '');
    const full_name = normalizeName(r[nameCol] ?? '');
    if (emailError(email) || !full_name) {
      out.invalid++;
      continue;
    }
    if (seen.has(email)) {
      out.duplicates++;
      continue;
    }
    seen.add(email);
    out.rows.push({ full_name, email });
  }
  return out;
}

const escapeCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // prevent spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** CSV with UTF-8 BOM so Excel displays Arabic correctly. */
export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadCsv = (filename: string, rows: unknown[][]) =>
  downloadBlob(filename, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));

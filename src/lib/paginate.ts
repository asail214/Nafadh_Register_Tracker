/**
 * Reads every row of a query page by page. PostgREST caps a response (1000 rows on Supabase by
 * default, possibly less if the project lowers max-rows), so we keep asking from the last offset
 * until an empty page comes back instead of trusting the page size. Callers must order by a
 * unique, increasing key (id) so rows inserted meanwhile land at the end and nothing shifts.
 */
export async function fetchAllPages<T extends { id: number }>(
  page: (from: number, to: number) => Promise<T[]>,
  size = 1000,
  maxPages = 200,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<number>();
  let from = 0;
  for (let i = 0; i < maxPages; i++) {
    const rows = await page(from, from + size - 1);
    if (!rows.length) return out;
    for (const r of rows) if (!seen.has(r.id)) seen.add(r.id), out.push(r);
    from += rows.length;
  }
  throw new Error('too_many_rows');
}

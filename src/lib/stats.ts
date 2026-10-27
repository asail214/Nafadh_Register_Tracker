import type { Dataset, StatusUpdate, Target, Ticket, VisitStats } from './types';

/** Newest first; ties on timestamp are broken by id (ids are increasing). */
const newestFirst = (a: StatusUpdate, b: StatusUpdate) => b.created_at.localeCompare(a.created_at) || b.id - a.id;

export function latestStatusByEmail(statuses: StatusUpdate[]): Map<string, StatusUpdate> {
  const m = new Map<string, StatusUpdate>();
  for (const s of statuses) {
    const cur = m.get(s.email);
    if (!cur || newestFirst(s, cur) < 0) m.set(s.email, s);
  }
  return m;
}

export const isOpen = (t: Pick<Ticket, 'status'>) => t.status !== 'resolved';

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

function countBy<T>(items: T[], key: (t: T) => string) {
  const r: Record<string, number> = {};
  for (const i of items) r[key(i)] = (r[key(i)] ?? 0) + 1;
  return r;
}

export interface Stats {
  totalTargets: number;
  hasList: boolean;
  respondents: number;
  /** all status rows (history included) and the distinct people who sent them */
  statusUpdates: number;
  statusRespondents: number;
  respondentsInList: number;
  respondentsOutsideList: number;
  nonRespondents: number | null;
  participationRate: number | null;
  registeredReported: number;
  registeredVerified: number;
  profileCompleteReported: number;
  profileCompleteVerified: number;
  registeredReportedRate: number | null;
  registeredVerifiedRate: number | null;
  profileReportedRate: number | null;
  profileVerifiedRate: number | null;
  hasAccount: Record<string, number>;
  profileStatus: Record<string, number>;
  issues: number;
  issuesByStatus: Record<string, number>;
  issuesByCategory: Record<string, number>;
  issuesBlocking: number;
  /** new + in review */
  openIssues: number;
  openIssuesBlocking: number;
  suggestions: number;
  openSuggestions: number;
  suggestionsByStatus: Record<string, number>;
}

/**
 * Rates are always relative to the target list and are null until a list exists.
 * "No response" is never counted as "not registered"; self-reports are kept separate from admin-verified values.
 */
export function computeStats({ targets, statuses, tickets }: Dataset): Stats {
  const listEmails = new Set(targets.map((t) => t.email));
  const respondentEmails = new Set([...statuses.map((s) => s.email), ...tickets.map((t) => t.email)]);
  const inList = [...respondentEmails].filter((e) => listEmails.has(e)).length;
  const total = targets.length;
  const latest = [...latestStatusByEmail(statuses).values()];
  const latestInList = latest.filter((s) => listEmails.has(s.email));
  const registeredVerified = targets.filter((t) => t.registered_verified === true).length;
  const profileCompleteVerified = targets.filter((t) => t.profile_verified === true).length;
  const issues = tickets.filter((t) => t.kind === 'issue');
  const suggestions = tickets.filter((t) => t.kind === 'suggestion');
  const openIssues = issues.filter(isOpen);

  return {
    totalTargets: total,
    hasList: total > 0,
    respondents: respondentEmails.size,
    statusUpdates: statuses.length,
    statusRespondents: latest.length,
    respondentsInList: inList,
    respondentsOutsideList: respondentEmails.size - inList,
    nonRespondents: total > 0 ? total - inList : null,
    participationRate: pct(inList, total),
    registeredReported: latest.filter((s) => s.has_account === 'yes').length,
    registeredVerified,
    profileCompleteReported: latest.filter((s) => s.profile_status === 'complete').length,
    profileCompleteVerified,
    registeredReportedRate: pct(latestInList.filter((s) => s.has_account === 'yes').length, total),
    registeredVerifiedRate: pct(registeredVerified, total),
    profileReportedRate: pct(latestInList.filter((s) => s.profile_status === 'complete').length, total),
    profileVerifiedRate: pct(profileCompleteVerified, total),
    hasAccount: countBy(latest, (s) => s.has_account),
    profileStatus: countBy(latest, (s) => s.profile_status),
    issues: issues.length,
    issuesByStatus: countBy(issues, (t) => t.status),
    issuesByCategory: countBy(issues, (t) => t.category ?? 'other'),
    issuesBlocking: issues.filter((t) => t.blocking).length,
    openIssues: openIssues.length,
    openIssuesBlocking: openIssues.filter((t) => t.blocking).length,
    suggestions: suggestions.length,
    openSuggestions: suggestions.filter(isOpen).length,
    suggestionsByStatus: countBy(suggestions, (t) => t.status),
  };
}

export interface TargetRow {
  target: Target;
  latest: StatusUpdate | null;
  history: StatusUpdate[];
  lastActivity: string | null;
  issues: number;
  suggestions: number;
}

export function targetRows({ targets, statuses, tickets }: Dataset): TargetRow[] {
  return targets.map((target) => {
    const st = statuses.filter((s) => s.email === target.email).sort(newestFirst);
    const tk = tickets.filter((t) => t.email === target.email);
    const times = [...st.map((s) => s.created_at), ...tk.map((t) => t.created_at)].sort();
    return {
      target,
      latest: st[0] ?? null,
      history: st,
      lastActivity: times.at(-1) ?? null,
      issues: tk.filter((t) => t.kind === 'issue').length,
      suggestions: tk.filter((t) => t.kind === 'suggestion').length,
    };
  });
}

export interface Conversion {
  /** distinct emails that submitted anything since visit tracking started */
  submitters: number;
  /** all entries (status updates + tickets) since visit tracking started */
  entries: number;
  /** submitters ÷ unique visitors × 100 (approximate; null without visits) */
  rate: number | null;
}

/**
 * Only submissions made after the first recorded visit are counted, so data collected before
 * analytics existed does not inflate the rate.
 */
export function computeConversion({ statuses, tickets }: Dataset, visits: VisitStats | null): Conversion | null {
  if (!visits) return null;
  const since = visits.since ?? '9999';
  const recent = [...statuses, ...tickets].filter((x) => x.created_at >= since);
  const submitters = new Set(recent.map((x) => x.email)).size;
  return { submitters, entries: recent.length, rate: pct(submitters, visits.unique) };
}

/** Respondents whose email is not in the target list (name taken from their latest submission). */
export function outsideRespondents({ targets, statuses, tickets }: Dataset) {
  const list = new Set(targets.map((t) => t.email));
  const m = new Map<string, string>();
  for (const x of [...statuses, ...tickets].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    if (!list.has(x.email)) m.set(x.email, x.full_name);
  return [...m].map(([email, full_name]) => ({ email, full_name }));
}

export interface StatusRow {
  status: StatusUpdate;
  /** number of status updates this email has sent */
  updates: number;
  /** the target-list entry for this email (admin verification lives there); null = not in the list */
  target: Target | null;
}

export type StatusView = 'latest' | 'all';

export interface StatusFilter {
  view: StatusView;
  q: string;
  has_account: string;
  profile_status: string;
  missing: string;
  /** '' | 'in' | 'out' — only meaningful when a target list exists */
  list: string;
}

export const emptyStatusFilter = (): StatusFilter => ({ view: 'latest', q: '', has_account: '', profile_status: '', missing: '', list: '' });

/**
 * Status updates for every respondent, with or without a target list.
 * "latest" = one row per email (its most recent update); "all" = full history, newest first.
 */
export function statusRows({ targets, statuses }: Dataset, view: StatusView): StatusRow[] {
  const byEmail = new Map(targets.map((t) => [t.email, t]));
  const counts = countBy(statuses, (s) => s.email);
  const rows = view === 'latest' ? [...latestStatusByEmail(statuses).values()] : [...statuses];
  return rows.sort(newestFirst).map((status) => ({ status, updates: counts[status.email], target: byEmail.get(status.email) ?? null }));
}

export function filterStatusRows(rows: StatusRow[], f: StatusFilter): StatusRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    ({ status: s, target }) =>
      (!f.has_account || s.has_account === f.has_account) &&
      (!f.profile_status || s.profile_status === f.profile_status) &&
      (!f.missing || s.missing_parts.includes(f.missing)) &&
      (!f.list || (f.list === 'in') === (target !== null)) &&
      (!q || s.full_name.toLowerCase().includes(q) || s.email.includes(q)),
  );
}

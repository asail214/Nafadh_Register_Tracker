import { HAS_ACCOUNT, MISSING_PARTS, PROFILE_STATUS } from './labels';

/**
 * Opt-in "remember me on this device": name, email and the last status answers only
 * (never ticket text, images or notes). Kept in this browser, never read from the server,
 * and dropped automatically 90 days after the last save.
 */
export const REMEMBER_KEY = 'nft-remember-v1';
export const REMEMBER_DAYS = 90;
const TTL = REMEMBER_DAYS * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface RememberedStatus {
  has_account: string;
  profile_status: string;
  missing_parts: string[];
}

export interface Remembered {
  full_name: string;
  email: string;
  status: RememberedStatus | null;
  /** when the last status update was sent from this device */
  status_at: string | null;
  saved_at: string;
}

/** localStorage, or null when the browser blocks it (private mode, disabled site data, …). */
export function deviceStorage(): Store | null {
  try {
    const s = window.localStorage;
    const probe = '__nft_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);

function parseStatus(v: unknown): RememberedStatus | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const has_account = str(s.has_account, 20);
  const profile_status = str(s.profile_status, 20);
  if (!has_account || !(has_account in HAS_ACCOUNT) || !profile_status || !(profile_status in PROFILE_STATUS)) return null;
  const parts = Array.isArray(s.missing_parts) ? s.missing_parts.filter((p): p is string => typeof p === 'string' && p in MISSING_PARTS) : [];
  return { has_account, profile_status, missing_parts: profile_status === 'partial' ? [...new Set(parts)] : [] };
}

export function loadRemembered(store: Store | null = deviceStorage(), now = Date.now()): Remembered | null {
  if (!store) return null;
  try {
    const raw = store.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, unknown>;
    const saved = typeof d.saved_at === 'string' ? Date.parse(d.saved_at) : NaN;
    const full_name = str(d.full_name, 100);
    const email = str(d.email, 254);
    if (!Number.isFinite(saved) || now - saved > TTL || saved > now + 60_000 || !full_name || !email) {
      store.removeItem(REMEMBER_KEY);
      return null;
    }
    return {
      full_name,
      email,
      status: parseStatus(d.status),
      status_at: str(d.status_at, 40),
      saved_at: d.saved_at as string,
    };
  } catch {
    return null;
  }
}

export function saveRemembered(
  data: Omit<Remembered, 'saved_at'>,
  store: Store | null = deviceStorage(),
  now = Date.now(),
): boolean {
  if (!store) return false;
  try {
    // explicit fields only, so nothing else (ticket text, notes, images) can slip into storage
    const value: Remembered = {
      full_name: data.full_name,
      email: data.email,
      status: data.status && parseStatus(data.status),
      status_at: data.status_at,
      saved_at: new Date(now).toISOString(),
    };
    store.setItem(REMEMBER_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearRemembered(store: Store | null = deviceStorage()): boolean {
  if (!store) return false;
  try {
    store.removeItem(REMEMBER_KEY);
    return true;
  } catch {
    return false;
  }
}

const KINDS = ['status', 'issue', 'suggestion'] as const;
export type ActionKind = (typeof KINDS)[number];

/** `?action=status|issue|suggestion` → that kind; anything else → null. */
export function actionFromUrl(search: string): ActionKind | null {
  const a = new URLSearchParams(search).get('action');
  return (KINDS as readonly string[]).includes(a ?? '') ? (a as ActionKind) : null;
}

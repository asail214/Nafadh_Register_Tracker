import type { Api } from './types';
import { createDemoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Cloud mode only when both Supabase values are configured; otherwise a clearly labelled local demo. */
export const api: Api = url && key ? createSupabaseApi(url, key) : createDemoApi();

export const PUBLIC_URL = ((import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? '').trim();

const ERRORS: Record<string, string> = {
  rate_limited: 'تم تجاوز عدد المشاركات المسموح به لهذا البريد خلال ساعة. حاول لاحقًا.',
  upload_failed: 'تعذّر رفع الصور. حاول مرة أخرى أو أرسل بدون صور.',
};

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const key = Object.keys(ERRORS).find((k) => msg.includes(k));
  return key ? ERRORS[key] : 'تعذّر الإرسال. تحقّق من البيانات أو الاتصال وحاول مرة أخرى.';
}

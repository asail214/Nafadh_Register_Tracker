export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const normalizeName = (v: string) => v.trim().replace(/\s+/g, ' ');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M} .'\-]+$/u;

export function emailError(raw: string): string | null {
  const v = normalizeEmail(raw);
  if (!v) return 'البريد الإلكتروني مطلوب';
  if (v.length > 254 || !EMAIL_RE.test(v)) return 'صيغة البريد الإلكتروني غير صحيحة';
  return null;
}

export function nameError(raw: string): string | null {
  const v = normalizeName(raw);
  if (!v) return 'الاسم الكامل مطلوب';
  if (v.length < 3 || v.length > 100) return 'الاسم يجب أن يكون بين 3 و100 حرف';
  if (!NAME_RE.test(v)) return 'الاسم يجب أن يحتوي على حروف فقط';
  return null;
}

export function textError(raw: string, label: string, min: number, max: number): string | null {
  const v = raw.trim();
  if (v.length < min) return `${label}: ${min} أحرف على الأقل`;
  if (v.length > max) return `${label}: ${max} حرفًا كحد أقصى`;
  return null;
}

export const LIMITS = {
  title: [3, 120] as const,
  description: [10, 2000] as const,
  notes: [0, 1000] as const,
  maxImages: 3,
};

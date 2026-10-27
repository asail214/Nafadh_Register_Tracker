import { emailError, LIMITS, nameError, textError } from './validation';

export type Kind = 'status' | 'issue' | 'suggestion';

export interface FormState {
  kind: Kind | '';
  full_name: string;
  email: string;
  has_account: string;
  profile_status: string;
  missing_parts: string[];
  notes: string;
  category: string;
  title: string;
  description: string;
  blocking: '' | 'yes' | 'no';
  consent: boolean;
}

export const emptyForm = (): FormState => ({
  kind: '',
  full_name: '',
  email: '',
  has_account: '',
  profile_status: '',
  missing_parts: [],
  notes: '',
  category: '',
  title: '',
  description: '',
  blocking: '',
  consent: false,
});

export const STEPS = ['البيانات الأساسية', 'تفاصيل المشاركة', 'المراجعة والإرسال'] as const;

/** Errors for every required (or length-limited) field of one step; empty object = step complete. */
export function stepErrors(f: FormState, step: number): Record<string, string> {
  const e: Record<string, string> = {};
  const add = (k: string, msg: string | null) => {
    if (msg) e[k] = msg;
  };
  if (step === 0) {
    add('full_name', nameError(f.full_name));
    add('email', emailError(f.email));
    if (!f.kind) e.kind = 'اختر نوع المشاركة';
  } else if (step === 1) {
    if (f.kind === 'status') {
      if (!f.has_account) e.has_account = 'اختر إجابة';
      if (!f.profile_status) e.profile_status = 'اختر إجابة';
      if (f.profile_status === 'partial' && !f.missing_parts.length) e.missing_parts = 'اختر جزءًا واحدًا على الأقل';
      add('notes', textError(f.notes, 'الملاحظات', ...LIMITS.notes));
    } else if (f.kind) {
      if (f.kind === 'issue' && !f.category) e.category = 'اختر التصنيف';
      add('title', textError(f.title, 'العنوان', ...LIMITS.title));
      add('description', textError(f.description, 'الوصف', ...LIMITS.description));
      if (f.kind === 'issue' && !f.blocking) e.blocking = 'اختر إجابة';
    } else e.kind = 'اختر نوع المشاركة أولًا';
  } else if (!f.consent) e.consent = 'يلزم الاطلاع على إشعار الخصوصية والموافقة';
  return e;
}

/** Required fields for the current choice. Conditional ones (missing parts, issue-only) are counted only when they apply. */
export function requiredFields(f: FormState): string[] {
  const details =
    f.kind === 'status'
      ? ['has_account', 'profile_status', ...(f.profile_status === 'partial' ? ['missing_parts'] : [])]
      : f.kind === 'issue'
        ? ['category', 'title', 'description', 'blocking']
        : f.kind === 'suggestion'
          ? ['title', 'description']
          : [];
  return ['full_name', 'email', 'kind', ...details, 'consent'];
}

/** Share of required fields that are currently valid (0–100). */
export function progress(f: FormState): number {
  const errors = { ...stepErrors(f, 0), ...stepErrors(f, 1), ...stepErrors(f, 2) };
  const req = requiredFields(f);
  const done = req.filter((k) => !errors[k]).length;
  return Math.round((done / req.length) * 100);
}

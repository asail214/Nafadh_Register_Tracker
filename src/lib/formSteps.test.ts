import { describe, expect, it } from 'vitest';
import { emptyForm, progress, requiredFields, stepErrors, type FormState } from './formSteps';

const form = (p: Partial<FormState>): FormState => ({ ...emptyForm(), ...p });
const basics = { full_name: 'تجربة خيالية', email: 'fake@example.test' };

describe('form steps and progress', () => {
  it('starts at 0% and step 1 lists name, email and kind', () => {
    expect(progress(emptyForm())).toBe(0);
    expect(Object.keys(stepErrors(emptyForm(), 0)).sort()).toEqual(['email', 'full_name', 'kind']);
  });

  it('invalid values do not count as filled', () => {
    expect(progress(form({ full_name: 'تجربة خيالية', email: 'not-an-email' }))).toBe(25); // 1 of 4
  });

  it('status path: conditional "missing parts" counts only when profile is partial', () => {
    const f = form({ ...basics, kind: 'status', has_account: 'yes', profile_status: 'complete' });
    expect(requiredFields(f)).toHaveLength(6);
    expect(stepErrors(f, 1)).toEqual({});
    expect(progress(f)).toBe(83); // 5 of 6 (consent missing)
    const partial = { ...f, profile_status: 'partial' };
    expect(requiredFields(partial)).toHaveLength(7);
    expect(stepErrors(partial, 1)).toHaveProperty('missing_parts');
    expect(progress({ ...partial, missing_parts: ['skills'], consent: true })).toBe(100);
  });

  it('issue path requires category, title, description, blocking — and no status questions', () => {
    const f = form({ ...basics, kind: 'issue' });
    expect(Object.keys(stepErrors(f, 1)).sort()).toEqual(['blocking', 'category', 'description', 'title']);
    expect(requiredFields(f)).not.toContain('has_account');
    const filled = { ...f, category: 'login', title: 'لا أستطيع', description: 'وصف واضح للمشكلة', blocking: 'no' as const, consent: true };
    expect(progress(filled)).toBe(100);
    expect(stepErrors({ ...filled, description: 'قصير' }, 1)).toHaveProperty('description');
  });

  it('suggestion path requires only title and description', () => {
    const f = form({ ...basics, kind: 'suggestion' });
    expect(Object.keys(stepErrors(f, 1)).sort()).toEqual(['description', 'title']);
    expect(progress({ ...f, title: 'اقتراح', description: 'وصف الاقتراح هنا' })).toBe(83); // 5 of 6
  });

  it('answers survive switching kind (state is shared), and step 3 needs consent', () => {
    const f = form({ ...basics, kind: 'issue', title: 'عنوان', description: 'وصف واضح للمشكلة' });
    const switched = { ...f, kind: 'suggestion' as const };
    expect(stepErrors(switched, 1)).toEqual({});
    expect(stepErrors(switched, 2)).toHaveProperty('consent');
  });
});

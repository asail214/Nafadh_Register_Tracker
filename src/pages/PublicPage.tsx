import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ExternalLink, ImagePlus, Lightbulb, Send, TriangleAlert, UserCheck, X } from 'lucide-react';
import { Header } from '../App';
import { api, friendlyError } from '../lib/api';
import { emptyForm, progress, stepErrors, STEPS, type FormState, type Kind } from '../lib/formSteps';
import { compressImage } from '../lib/image';
import { HAS_ACCOUNT, ISSUE_CATEGORY, MISSING_PARTS, NAFADH_URL, PROFILE_STATUS } from '../lib/labels';
import type { HasAccount, ProfileStatus, Submission } from '../lib/types';
import { LIMITS } from '../lib/validation';
import { trackVisit } from '../lib/visit';

const CHOICES: { kind: Kind; label: string; hint: string; Icon: typeof UserCheck }[] = [
  { kind: 'status', label: 'تحديث حالة حسابي', hint: 'التسجيل واكتمال الملف', Icon: UserCheck },
  { kind: 'issue', label: 'الإبلاغ عن مشكلة', hint: 'مع لقطات شاشة اختيارية', Icon: TriangleAlert },
  { kind: 'suggestion', label: 'تقديم اقتراح تحسين', hint: 'فكرة أو ملاحظة', Icon: Lightbulb },
];

const KIND_LABEL: Record<Kind, string> = { status: 'تحديث حالة الحساب', issue: 'الإبلاغ عن مشكلة', suggestion: 'اقتراح تحسين' };

export default function PublicPage() {
  const [doneRef, setDoneRef] = useState<string | null>(null);
  // name/email are kept between submissions so people can send another entry quickly
  const [identity, setIdentity] = useState({ full_name: '', email: '' });
  const [formKey, setFormKey] = useState(0);
  useEffect(() => trackVisit(api), []);

  return (
    <>
      <Header />
      <main className="container page">
        <section className="intro">
          <h1>متابعة مستقلي نفاذ للعمل الحر</h1>
          <p className="note">هذه صفحة متابعة تطويرية مؤقتة، وليست منصة التسجيل نفسها ولا ترتبط بها تقنيًا.</p>
          <p>
            في إطار الاستعداد للمرحلة المقبلة من تطوير مسار العمل الحر في نفاذ، نجمع حالات التسجيل وملاحظات الاستخدام
            والاقتراحات بالتنسيق مع الجهات المعنية. نشكر مشاركتك، وندعوك إلى استكمال ملفك الشخصي والمهني في المنصة قدر
            الإمكان.
          </p>
          <a className="btn outline" href={NAFADH_URL} target="_blank" rel="noopener noreferrer">
            الانتقال إلى منصة نفاذ للعمل الحر <ExternalLink size={16} aria-hidden />
          </a>
        </section>

        {doneRef ? (
          <div className="card success" role="status">
            <CheckCircle2 size={48} className="success-icon" aria-hidden />
            <h2>شكرًا لك، تم استلام مشاركتك</h2>
            <p>
              رقم المرجع: <span className="ref">{doneRef}</span>
            </p>
            {api.mode === 'demo' && (
              <p className="muted">ملاحظة: هذا وضع تجريبي، المشاركة محفوظة في هذا المتصفح فقط ولم تُرسل لأي خادم.</p>
            )}
            <p className="muted">يمكنك العودة في أي وقت لإرسال بلاغ آخر أو تحديث حالتك لاحقًا.</p>
            <button
              className="btn"
              onClick={() => {
                setDoneRef(null);
                setFormKey(formKey + 1);
              }}
            >
              إرسال مشاركة أخرى
            </button>
          </div>
        ) : (
          <EntryForm
            key={formKey}
            identity={identity}
            onDone={(ref, id) => {
              setIdentity(id);
              setDoneRef(ref);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
        <footer className="footer">
          نموذج تجريبي للمتابعة — لا تُدخل كلمات مرور أو رموز تحقق أو مستندات شخصية. لإحصاء الزيارات نستخدم معرّفًا
          عشوائيًا مجهولًا في متصفحك، ولا نجمع عنوان IP.
        </footer>
      </main>
    </>
  );
}

type Identity = { full_name: string; email: string };

function EntryForm({ identity, onDone }: { identity: Identity; onDone: (ref: string, id: Identity) => void }) {
  const [f, setF] = useState<FormState>({ ...emptyForm(), ...identity });
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [images, setImages] = useState<{ blob: Blob; url: string }[]>([]);
  const [imgError, setImgError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const errors = showErrors ? stepErrors(f, step) : {};
  const pct = progress(f);
  const stepDone = (i: number) => Object.keys(stepErrors(f, i)).length === 0;
  const update = (patch: Partial<FormState>) => setF({ ...f, ...patch });
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    update({ [k]: e.target.value } as Partial<FormState>);

  function goTo(target: number) {
    // moving forward requires every earlier step to be complete
    for (let i = step; i < target; i++)
      if (!stepDone(i)) {
        setStep(i);
        setShowErrors(true);
        return;
      }
    setStep(target);
    setShowErrors(false);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function addImages(files: FileList | File[] | null) {
    setImgError(null);
    if (!files) return;
    const list = [...files];
    const room = LIMITS.maxImages - images.length;
    if (list.length > room) setImgError(`يمكن إرفاق ${LIMITS.maxImages} صور كحد أقصى`);
    const next = [...images];
    for (const file of list.slice(0, room)) {
      try {
        const blob = await compressImage(file);
        next.push({ blob, url: URL.createObjectURL(blob) });
      } catch (e) {
        setImgError(e instanceof Error ? e.message : 'تعذّرت قراءة الصورة');
      }
    }
    setImages(next);
  }

  async function submit() {
    setSubmitError(null);
    const firstIncomplete = [0, 1, 2].find((i) => !stepDone(i));
    if (firstIncomplete !== undefined) {
      setStep(firstIncomplete);
      setShowErrors(true);
      return;
    }
    const id = { full_name: f.full_name, email: f.email };
    if (website) return onDone('—', id); // bot filled the hidden field: silently drop
    const common = { full_name: f.full_name, email: f.email };
    const imgs = images.map((i) => i.blob);
    const s: Submission =
      f.kind === 'status'
        ? {
            ...common,
            kind: 'status',
            has_account: f.has_account as HasAccount,
            profile_status: f.profile_status as ProfileStatus,
            missing_parts: f.profile_status === 'partial' ? f.missing_parts : [],
            notes: f.notes,
          }
        : f.kind === 'issue'
          ? { ...common, kind: 'issue', category: f.category, title: f.title, description: f.description, blocking: f.blocking === 'yes', images: imgs }
          : { ...common, kind: 'suggestion', title: f.title, description: f.description, images: imgs };
    setBusy(true);
    try {
      onDone(await api.submit(s), id);
    } catch (e) {
      setSubmitError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) =>
    errors[k] && (
      <div className="error" role="alert">
        <AlertCircle size={14} aria-hidden /> {errors[k]}
      </div>
    );
  const radios = (name: 'has_account' | 'profile_status' | 'blocking', opts: Record<string, string>) => (
    <div className="options" role="radiogroup">
      {Object.entries(opts).map(([v, label]) => (
        <label key={v} className="option">
          <input type="radio" name={name} value={v} checked={f[name] === v} onChange={set(name)} />
          {label}
        </label>
      ))}
    </div>
  );
  const missingCount = showErrors ? Object.keys(errors).length : 0;

  return (
    <div className="card form-card" ref={topRef}>
      <ol className="stepper" aria-label="خطوات النموذج">
        {STEPS.map((label, i) => {
          const done = i !== step && stepDone(i);
          return (
            <li key={label} className={i === step ? 'current' : done ? 'done' : ''}>
              <button type="button" onClick={() => goTo(i)} aria-current={i === step ? 'step' : undefined}>
                <span className="dot">{done ? <Check size={14} aria-label="مكتملة" /> : i + 1}</span>
                <span className="step-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="progress" aria-label="نسبة اكتمال الحقول الإلزامية">
        <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: pct + '%' }} />
        </div>
        <span className="progress-text">اكتمال الحقول الإلزامية: {pct}%</span>
      </div>

      {missingCount > 0 && (
        <div className="alert" role="alert">
          <AlertCircle size={18} aria-hidden /> يوجد {missingCount === 1 ? 'حقل إلزامي ناقص أو غير صحيح' : `${missingCount} حقول إلزامية ناقصة أو غير صحيحة`} في هذه الخطوة.
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) goTo(step + 1);
          else submit();
        }}
      >
        {step === 0 && (
          <>
            <div className="field">
              <label htmlFor="full_name">
                الاسم الكامل <span className="req">*</span>
              </label>
              <input id="full_name" type="text" autoComplete="name" maxLength={100} value={f.full_name} onChange={set('full_name')} aria-invalid={!!errors.full_name} />
              {err('full_name')}
            </div>
            <div className="field">
              <label htmlFor="email">
                البريد الإلكتروني المستخدم في منصة نفاذ <span className="req">*</span>
              </label>
              <input id="email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={f.email} onChange={set('email')} aria-invalid={!!errors.email} />
              <div className="hint">يُستخدم البريد للربط بين مشاركاتك فقط، وهو إفادة ذاتية لا تثبت ملكية البريد.</div>
              {err('email')}
            </div>
            <div className="hp" aria-hidden="true">
              <label htmlFor="website">اترك هذا الحقل فارغًا</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="field">
              <span className="label">
                نوع المشاركة <span className="req">*</span>
              </span>
              <div className="choices" role="radiogroup">
                {CHOICES.map(({ kind, label, hint, Icon }) => (
                  <button type="button" key={kind} className="choice" role="radio" aria-checked={f.kind === kind} onClick={() => update({ kind })}>
                    <Icon size={22} aria-hidden />
                    <span>{label}</span>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
              {err('kind')}
            </div>
          </>
        )}

        {step === 1 && f.kind === 'status' && (
          <>
            <div className="field">
              <span className="label">هل لديك حساب في منصة نفاذ للعمل الحر؟ <span className="req">*</span></span>
              {radios('has_account', HAS_ACCOUNT)}
              {err('has_account')}
            </div>
            <div className="field">
              <span className="label">ما حالة ملفك الشخصي والمهني؟ <span className="req">*</span></span>
              {radios('profile_status', PROFILE_STATUS)}
              {err('profile_status')}
            </div>
            {f.profile_status === 'partial' && (
              <div className="field">
                <span className="label">ما الأجزاء الناقصة؟ <span className="req">*</span></span>
                <div className="options">
                  {Object.entries(MISSING_PARTS).map(([v, label]) => (
                    <label key={v} className="option">
                      <input
                        type="checkbox"
                        checked={f.missing_parts.includes(v)}
                        onChange={(e) =>
                          update({ missing_parts: e.target.checked ? [...f.missing_parts, v] : f.missing_parts.filter((x) => x !== v) })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {err('missing_parts')}
              </div>
            )}
            <div className="field">
              <label htmlFor="notes">ملاحظات (اختياري)</label>
              <textarea id="notes" maxLength={1000} value={f.notes} onChange={set('notes')} />
              {err('notes')}
            </div>
            <p className="hint">
              هذه إفادة ذاتية؛ لا يتم التحقق من حالة حسابك تلقائيًا من منصة نفاذ.{' '}
              <a href={NAFADH_URL} target="_blank" rel="noopener noreferrer">
                فتح منصة نفاذ لاستكمال الملف
              </a>
            </p>
          </>
        )}

        {step === 1 && (f.kind === 'issue' || f.kind === 'suggestion') && (
          <>
            {f.kind === 'issue' && (
              <div className="field">
                <label htmlFor="category">
                  تصنيف المشكلة <span className="req">*</span>
                </label>
                <select id="category" value={f.category} onChange={set('category')} aria-invalid={!!errors.category}>
                  <option value="">اختر…</option>
                  {Object.entries(ISSUE_CATEGORY).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {err('category')}
              </div>
            )}
            <div className="field">
              <label htmlFor="title">
                {f.kind === 'issue' ? 'عنوان قصير للمشكلة' : 'عنوان الاقتراح'} <span className="req">*</span>
              </label>
              <input id="title" type="text" maxLength={120} value={f.title} onChange={set('title')} aria-invalid={!!errors.title} />
              {err('title')}
            </div>
            <div className="field">
              <label htmlFor="description">
                {f.kind === 'issue' ? 'وصف المشكلة وخطوات حدوثها' : 'وصف الاقتراح'} <span className="req">*</span>
              </label>
              <textarea id="description" maxLength={2000} value={f.description} onChange={set('description')} aria-invalid={!!errors.description} />
              <div className="hint">{f.description.trim().length} / 2000 (10 أحرف على الأقل)</div>
              {err('description')}
            </div>
            {f.kind === 'issue' && (
              <div className="field">
                <span className="label">هل تمنعك المشكلة من إكمال الإجراء؟ <span className="req">*</span></span>
                {radios('blocking', { yes: 'نعم', no: 'لا' })}
                {err('blocking')}
              </div>
            )}
            <div className="field">
              <span className="label">{f.kind === 'issue' ? 'لقطات شاشة' : 'صور'} (اختياري)</span>
              {images.length < LIMITS.maxImages && (
                <label
                  className={'dropzone' + (dragOver ? ' over' : '')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    addImages(e.dataTransfer.files);
                  }}
                >
                  <ImagePlus size={28} aria-hidden />
                  <strong>اختر صورًا أو اسحبها هنا</strong>
                  <span className="hint">
                    حتى {LIMITS.maxImages} صور JPG / PNG / WebP — تُصغَّر تلقائيًا في متصفحك ({images.length}/{LIMITS.maxImages})
                  </span>
                  <input
                    id="images"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="visually-hidden"
                    onChange={(e) => {
                      addImages(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              <div className="hint">يرجى إخفاء أي معلومات شخصية أو حساسة (أرقام هوية، هواتف، رموز تحقق) من اللقطات قبل إرفاقها.</div>
              {imgError && (
                <div className="error" role="alert">
                  <AlertCircle size={14} aria-hidden /> {imgError}
                </div>
              )}
              {images.length > 0 && (
                <div className="thumbs">
                  {images.map((img, i) => (
                    <div className="thumb" key={img.url}>
                      <img src={img.url} alt={`معاينة ${i + 1}`} />
                      <button
                        type="button"
                        aria-label={`إزالة الصورة ${i + 1}`}
                        onClick={() => {
                          URL.revokeObjectURL(img.url);
                          setImages(images.filter((x) => x !== img));
                        }}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="section-title">راجع مشاركتك</h2>
            <dl className="summary">
              <Row label="الاسم" value={f.full_name} onEdit={() => goTo(0)} />
              <Row label="البريد الإلكتروني" value={<span dir="ltr">{f.email.trim().toLowerCase()}</span>} onEdit={() => goTo(0)} />
              <Row label="نوع المشاركة" value={f.kind ? KIND_LABEL[f.kind] : '—'} onEdit={() => goTo(0)} />
              {f.kind === 'status' && (
                <>
                  <Row label="لديك حساب؟" value={HAS_ACCOUNT[f.has_account]} onEdit={() => goTo(1)} />
                  <Row label="حالة الملف" value={PROFILE_STATUS[f.profile_status]} onEdit={() => goTo(1)} />
                  {f.profile_status === 'partial' && (
                    <Row label="الأجزاء الناقصة" value={f.missing_parts.map((m) => MISSING_PARTS[m]).join('، ')} onEdit={() => goTo(1)} />
                  )}
                  {f.notes.trim() && <Row label="ملاحظات" value={f.notes} onEdit={() => goTo(1)} />}
                </>
              )}
              {f.kind !== 'status' && (
                <>
                  {f.kind === 'issue' && <Row label="التصنيف" value={ISSUE_CATEGORY[f.category]} onEdit={() => goTo(1)} />}
                  <Row label="العنوان" value={f.title} onEdit={() => goTo(1)} />
                  <Row label="الوصف" value={f.description} onEdit={() => goTo(1)} />
                  {f.kind === 'issue' && <Row label="تمنع الإكمال؟" value={f.blocking === 'yes' ? 'نعم' : 'لا'} onEdit={() => goTo(1)} />}
                  <Row label="الصور" value={images.length ? `${images.length} صورة` : 'لا توجد'} onEdit={() => goTo(1)} />
                </>
              )}
            </dl>
            <div className="note field">
              <strong>إشعار الخصوصية:</strong> تُستخدم بياناتك (الاسم، البريد، ما تكتبه وتُرفقه) لأغراض متابعة مسار العمل الحر
              وتحسينه فقط، ولا يطّلع عليها إلا فريق الإدارة المختص. لا ترسل كلمات مرور أو رموز تحقق أو مستندات شخصية.
              <label className="option consent">
                <input type="checkbox" checked={f.consent} onChange={(e) => update({ consent: e.target.checked })} />
                اطلعت على الإشعار وأوافق على إرسال المشاركة <span className="req">*</span>
              </label>
              {err('consent')}
            </div>
            {submitError && (
              <div className="alert" role="alert">
                <AlertCircle size={18} aria-hidden /> {submitError}
              </div>
            )}
          </>
        )}

        <div className="form-nav">
          {step > 0 ? (
            <button type="button" className="btn outline" onClick={() => goTo(step - 1)}>
              <ArrowRight size={16} aria-hidden /> السابق
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button type="submit" className="btn">
              التالي <ArrowLeft size={16} aria-hidden />
            </button>
          ) : (
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'جارٍ الإرسال…' : 'تأكيد الإرسال'} <Send size={16} aria-hidden />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
      <button type="button" className="btn link" onClick={onEdit}>
        تعديل
      </button>
    </div>
  );
}

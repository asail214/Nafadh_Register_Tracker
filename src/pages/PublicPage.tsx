import { useEffect, useRef, useState } from 'react';
import { Header } from '../App';
import { api, friendlyError } from '../lib/api';
import { compressImage } from '../lib/image';
import { HAS_ACCOUNT, ISSUE_CATEGORY, MISSING_PARTS, NAFADH_URL, PROFILE_STATUS } from '../lib/labels';
import type { HasAccount, ProfileStatus, Submission } from '../lib/types';
import { emailError, LIMITS, nameError, textError } from '../lib/validation';

type Kind = 'status' | 'issue' | 'suggestion';

const CHOICES: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'status', label: 'تحديث حالة حسابي', hint: 'التسجيل واكتمال الملف' },
  { kind: 'issue', label: 'الإبلاغ عن مشكلة', hint: 'مع لقطات شاشة اختيارية' },
  { kind: 'suggestion', label: 'تقديم اقتراح تحسين', hint: 'فكرة أو ملاحظة' },
];

export default function PublicPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [doneRef, setDoneRef] = useState<string | null>(null);
  // name/email are kept between submissions so people can send another entry quickly
  const [identity, setIdentity] = useState({ full_name: '', email: '' });

  return (
    <>
      <Header />
      <main className="container">
        <h1>متابعة مستقلي نفاذ للعمل الحر</h1>
        <p className="note">
          هذه صفحة متابعة تطويرية مؤقتة، وليست منصة التسجيل نفسها ولا ترتبط بها تقنيًا.
        </p>
        <p style={{ marginTop: 14 }}>
          في إطار الاستعداد للمرحلة المقبلة من تطوير مسار العمل الحر في نفاذ، نجمع حالات التسجيل وملاحظات الاستخدام
          والاقتراحات بالتنسيق مع الجهات المعنية. نشكر مشاركتك، وندعوك إلى استكمال ملفك الشخصي والمهني في المنصة قدر
          الإمكان.
        </p>
        <a className="btn outline" href={NAFADH_URL} target="_blank" rel="noopener noreferrer">
          الانتقال إلى منصة نفاذ للعمل الحر ↗
        </a>

        {doneRef ? (
          <div className="card success" role="status" style={{ marginTop: 24 }}>
            <h2 style={{ marginTop: 0 }}>شكرًا لك، تم استلام مشاركتك</h2>
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
                setKind(null);
              }}
            >
              إرسال مشاركة أخرى
            </button>
          </div>
        ) : (
          <>
            <h2>ماذا تريد أن تفعل؟</h2>
            <div className="choices">
              {CHOICES.map((c) => (
                <button key={c.kind} className="choice" aria-pressed={kind === c.kind} onClick={() => setKind(c.kind)}>
                  {c.label}
                  <small>{c.hint}</small>
                </button>
              ))}
            </div>
            {kind && (
              <EntryForm
                key={kind}
                kind={kind}
                identity={identity}
                onDone={(ref, id) => {
                  setIdentity(id);
                  setDoneRef(ref);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            )}
          </>
        )}
        <footer className="footer">نموذج تجريبي للمتابعة — لا تُدخل كلمات مرور أو رموز تحقق أو مستندات شخصية.</footer>
      </main>
    </>
  );
}

type Identity = { full_name: string; email: string };

function EntryForm({ kind, identity, onDone }: { kind: Kind; identity: Identity; onDone: (ref: string, id: Identity) => void }) {
  const [f, setF] = useState({
    ...identity,
    has_account: '' as HasAccount | '',
    profile_status: '' as ProfileStatus | '',
    missing_parts: [] as string[],
    notes: '',
    category: '',
    title: '',
    description: '',
    blocking: '' as '' | 'yes' | 'no',
    website: '', // honeypot
  });
  const [images, setImages] = useState<{ blob: Blob; url: string }[]>([]);
  const [imgError, setImgError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function addImages(files: FileList | null) {
    setImgError(null);
    if (!files) return;
    const room = LIMITS.maxImages - images.length;
    if (files.length > room) setImgError(`يمكن إرفاق ${LIMITS.maxImages} صور كحد أقصى`);
    const next = [...images];
    for (const file of [...files].slice(0, room)) {
      try {
        const blob = await compressImage(file);
        next.push({ blob, url: URL.createObjectURL(blob) });
      } catch (e) {
        setImgError(e instanceof Error ? e.message : 'تعذّرت قراءة الصورة');
      }
    }
    setImages(next);
  }

  function validate() {
    const e: Record<string, string> = {};
    const add = (k: string, msg: string | null) => msg && (e[k] = msg);
    add('full_name', nameError(f.full_name));
    add('email', emailError(f.email));
    if (kind === 'status') {
      if (!f.has_account) e.has_account = 'اختر إجابة';
      if (!f.profile_status) e.profile_status = 'اختر إجابة';
      if (f.profile_status === 'partial' && !f.missing_parts.length) e.missing_parts = 'اختر جزءًا واحدًا على الأقل';
      add('notes', textError(f.notes, 'الملاحظات', ...LIMITS.notes));
    } else {
      if (kind === 'issue' && !f.category) e.category = 'اختر التصنيف';
      if (kind === 'issue' && !f.blocking) e.blocking = 'اختر إجابة';
      add('title', textError(f.title, 'العنوان', ...LIMITS.title));
      add('description', textError(f.description, 'الوصف', ...LIMITS.description));
    }
    if (!consent) e.consent = 'يلزم الاطلاع على إشعار الخصوصية والموافقة';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    const id = { full_name: f.full_name, email: f.email };
    if (f.website) return onDone('—', id); // bot filled the hidden field: silently drop
    const common = { full_name: f.full_name, email: f.email };
    const imgs = images.map((i) => i.blob);
    const s: Submission =
      kind === 'status'
        ? {
            ...common,
            kind,
            has_account: f.has_account as HasAccount,
            profile_status: f.profile_status as ProfileStatus,
            missing_parts: f.profile_status === 'partial' ? f.missing_parts : [],
            notes: f.notes,
          }
        : kind === 'issue'
          ? { ...common, kind, category: f.category, title: f.title, description: f.description, blocking: f.blocking === 'yes', images: imgs }
          : { ...common, kind, title: f.title, description: f.description, images: imgs };
    setBusy(true);
    try {
      onDone(await api.submit(s), id);
    } catch (e) {
      setSubmitError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k] && <div className="error">{errors[k]}</div>;
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

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="full_name">
          الاسم الكامل <span className="req">*</span>
        </label>
        <input id="full_name" type="text" autoComplete="name" maxLength={100} value={f.full_name} onChange={set('full_name')} />
        {err('full_name')}
      </div>
      <div className="field">
        <label htmlFor="email">
          البريد الإلكتروني المستخدم في منصة نفاذ <span className="req">*</span>
        </label>
        <input id="email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={f.email} onChange={set('email')} />
        <div className="muted small">يُستخدم البريد للربط بين مشاركاتك فقط، وهو إفادة ذاتية لا تثبت ملكية البريد.</div>
        {err('email')}
      </div>
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">اترك هذا الحقل فارغًا</label>
        <input id="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
      </div>

      {kind === 'status' && (
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
                        setF({
                          ...f,
                          missing_parts: e.target.checked ? [...f.missing_parts, v] : f.missing_parts.filter((x) => x !== v),
                        })
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
          <p className="muted small">
            هذه إفادة ذاتية؛ لا يتم التحقق من حالة حسابك تلقائيًا من منصة نفاذ.{' '}
            <a href={NAFADH_URL} target="_blank" rel="noopener noreferrer">
              فتح منصة نفاذ لاستكمال الملف ↗
            </a>
          </p>
        </>
      )}

      {kind !== 'status' && (
        <>
          {kind === 'issue' && (
            <div className="field">
              <label htmlFor="category">
                تصنيف المشكلة <span className="req">*</span>
              </label>
              <select id="category" value={f.category} onChange={set('category')}>
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
              {kind === 'issue' ? 'عنوان قصير للمشكلة' : 'عنوان الاقتراح'} <span className="req">*</span>
            </label>
            <input id="title" type="text" maxLength={120} value={f.title} onChange={set('title')} />
            {err('title')}
          </div>
          <div className="field">
            <label htmlFor="description">
              {kind === 'issue' ? 'وصف المشكلة وخطوات حدوثها' : 'وصف الاقتراح'} <span className="req">*</span>
            </label>
            <textarea id="description" maxLength={2000} value={f.description} onChange={set('description')} />
            {err('description')}
          </div>
          {kind === 'issue' && (
            <div className="field">
              <span className="label">هل تمنعك المشكلة من إكمال الإجراء؟ <span className="req">*</span></span>
              {radios('blocking', { yes: 'نعم', no: 'لا' })}
              {err('blocking')}
            </div>
          )}
          <div className="field">
            <label htmlFor="images">
              {kind === 'issue' ? 'لقطات شاشة' : 'صور'} (اختياري، حتى {LIMITS.maxImages} صور JPG / PNG / WebP)
            </label>
            <div className="muted small">
              يرجى إخفاء أي معلومات شخصية أو حساسة (أرقام هوية، هواتف، رموز تحقق) من اللقطات قبل إرفاقها. تُصغَّر الصور
              تلقائيًا في متصفحك.
            </div>
            {images.length < LIMITS.maxImages && (
              <input
                id="images"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = '';
                }}
              />
            )}
            {imgError && <div className="error">{imgError}</div>}
            <div className="thumbs">
              {images.map((img, i) => (
                <div className="thumb" key={img.url}>
                  <img src={img.url} alt={`معاينة ${i + 1}`} />
                  <button
                    type="button"
                    aria-label="إزالة الصورة"
                    onClick={() => {
                      URL.revokeObjectURL(img.url);
                      setImages(images.filter((x) => x !== img));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="note field">
        <strong>إشعار الخصوصية:</strong> تُستخدم بياناتك (الاسم، البريد، ما تكتبه وتُرفقه) لأغراض متابعة مسار العمل الحر
        وتحسينه فقط، ولا يطّلع عليها إلا فريق الإدارة المختص. لا ترسل كلمات مرور أو رموز تحقق أو مستندات شخصية.
        <label className="option" style={{ marginTop: 8, display: 'flex' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          اطلعت على الإشعار وأوافق على إرسال المشاركة
        </label>
        {err('consent')}
      </div>

      {submitError && <p className="error">{submitError}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'جارٍ الإرسال…' : 'إرسال'}
      </button>
    </form>
  );
}

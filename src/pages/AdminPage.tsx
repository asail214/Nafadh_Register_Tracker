import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Bell, CheckCheck, FileSpreadsheet } from 'lucide-react';
import { Header } from '../App';
import { api, PUBLIC_URL } from '../lib/api';
import { downloadBlob, downloadCsv, extractTargets, parseCsv } from '../lib/csv';
import { resetDemoData } from '../lib/demoApi';
import { exportExcel } from '../lib/excel';
import { HAS_ACCOUNT, ISSUE_CATEGORY, MISSING_PARTS, PROFILE_STATUS, TICKET_KIND, TICKET_STATUS } from '../lib/labels';
import { computeConversion, computeStats, outsideRespondents, targetRows, type Conversion, type Stats } from '../lib/stats';
import { ticketRef, type Dataset, type FeedKind, type Target, type Ticket, type TicketStatus, type VisitStats } from '../lib/types';
import { emailError, nameError } from '../lib/validation';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ar-OM-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const stamp = () => new Date().toISOString().slice(0, 10);
const PII_NOTE = 'تنبيه: الملف المُصدَّر يحتوي على بيانات شخصية (أسماء وبريد إلكتروني). احفظه في مكان آمن ولا تشاركه خارج الفريق المختص.';

type Auth = 'loading' | 'signed_out' | 'not_admin' | 'admin';

export default function AdminPage() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [email, setEmail] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    const e = await api.getSessionEmail();
    setEmail(e);
    setAuth(!e ? 'signed_out' : (await api.isAdmin()) ? 'admin' : 'not_admin');
  }, []);
  useEffect(() => void refreshAuth(), [refreshAuth]);

  const signOut =
    api.mode === 'cloud' && email ? (
      <button className="btn outline sm" onClick={() => api.signOut().then(refreshAuth)}>
        تسجيل الخروج
      </button>
    ) : null;

  return (
    <>
      <Header>{signOut}</Header>
      <main className="container wide page">
        {auth === 'loading' && <p>جارٍ التحقق…</p>}
        {auth === 'signed_out' && <Login onDone={refreshAuth} />}
        {auth === 'not_admin' && (
          <div className="card login">
            <p>الحساب {email} لا يملك صلاحية إدارية.</p>
          </div>
        )}
        {auth === 'admin' && <Dashboard />}
      </main>
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.signIn(email, password);
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'تعذّر الدخول');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>دخول الإدارة</h2>
      <div className="field">
        <label htmlFor="ae">البريد الإلكتروني</label>
        <input id="ae" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </div>
      <div className="field">
        <label htmlFor="ap">كلمة المرور</label>
        <input id="ap" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy}>
        دخول
      </button>
    </form>
  );
}

type Tab = 'stats' | 'targets' | 'tickets';

function Dashboard() {
  const [tab, setTab] = useState<Tab>('stats');
  const [data, setData] = useState<Dataset | null>(null);
  const [visits, setVisits] = useState<VisitStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api.loadAll(), api.visitStats().catch(() => null)]);
      setData(d);
      setVisits(v);
      setError(null);
    } catch {
      setError('تعذّر تحميل البيانات.');
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  // Realtime push (admins only, enforced by RLS) + a slow polling fallback.
  useEffect(() => {
    const off = api.subscribe(() => {
      setFresh(true);
      reload();
    });
    const timer = setInterval(reload, 60_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [reload]);

  return (
    <>
      <h1>لوحة متابعة مستقلي نفاذ</h1>
      {api.mode === 'demo' && (
        <p className="note">
          وضع تجريبي محلي: البيانات محفوظة في هذا المتصفح فقط ولا تُرسل لأي خادم. في الوضع السحابي تتطلب هذه الصفحة حسابًا
          إداريًا يُتحقَّق منه في قاعدة البيانات.{' '}
          <button
            className="btn link"
            onClick={() => {
              if (confirm('حذف كل البيانات التجريبية من هذا المتصفح؟')) {
                resetDemoData();
                location.reload();
              }
            }}
          >
            مسح البيانات التجريبية
          </button>
        </p>
      )}
      {data && (
        <Notifications
          data={data}
          fresh={fresh}
          onSeen={async (kind, ids) => {
            await api.markSeen(kind, ids);
            setFresh(false);
            await reload();
          }}
        />
      )}
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          className="btn"
          disabled={!data || exporting}
          onClick={async () => {
            if (!data || !confirm(PII_NOTE)) return;
            setExporting(true);
            try {
              await exportExcel(data, visits);
            } catch {
              setError('تعذّر إنشاء ملف Excel.');
            } finally {
              setExporting(false);
            }
          }}
        >
          <FileSpreadsheet size={18} aria-hidden /> {exporting ? 'جارٍ التصدير…' : 'تصدير Excel'}
        </button>
        <span className="muted small">ملف .xlsx: الملخص، المستقلون، البلاغات والمقترحات، حالة المعالجة.</span>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['stats', 'الإحصاءات'],
            ['targets', 'المستقلون المستهدفون'],
            ['tickets', 'البلاغات والمقترحات'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        <button onClick={reload} style={{ marginInlineStart: 'auto' }}>
          ↻ تحديث
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data ? (
        <p>جارٍ التحميل…</p>
      ) : tab === 'stats' ? (
        <StatsTab stats={computeStats(data)} visits={visits} conversion={computeConversion(data, visits)} />
      ) : tab === 'targets' ? (
        <TargetsTab data={data} reload={reload} />
      ) : (
        <TicketsTab tickets={data.tickets} reload={reload} />
      )}
    </>
  );
}

/* ---------------- Stats ---------------- */

function Stat({ k, v, sub }: { k: string; v: number | string | null; sub?: string }) {
  const na = v === null;
  return (
    <div className="stat">
      <div className={'v' + (na ? ' na' : '')}>{na ? 'غير متاح حتى استيراد القائمة' : v}</div>
      <div className="k">{k}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

const rate = (r: number | null) => (r === null ? null : `${r}%`);

function Breakdown({ title, counts, labels }: { title: string; counts: Record<string, number>; labels: Record<string, string> }) {
  return (
    <div className="stat">
      <div className="k" style={{ fontWeight: 600, color: 'var(--text)' }}>
        {title}
      </div>
      {Object.entries(labels).map(([k, l]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{l}</span>
          <strong>{counts[k] ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function StatsTab({ stats: s, visits, conversion }: { stats: Stats; visits: VisitStats | null; conversion: Conversion | null }) {
  return (
    <>
      <h2>الزيارات والتحويل</h2>
      {visits ? (
        <>
          <div className="grid">
            <Stat k="إجمالي الزيارات" v={visits.total} sub="زيارة لكل جلسة متصفح، بدون صفحة الإدارة" />
            <Stat k="الزوار الفريدون (تقريبي)" v={visits.unique} sub="معرّف عشوائي في المتصفح، بلا IP" />
            <Stat k="المشاركون منذ بدء القياس" v={conversion?.submitters ?? 0} sub={`${conversion?.entries ?? 0} مشاركة`} />
            <Stat k="نسبة التحويل" v={conversion?.rate == null ? '—' : `${conversion.rate}%`} sub="المشاركون الفريدون ÷ الزوار الفريدون × 100" />
          </div>
          <p className="muted small">
            النسبة تقريبية: الشخص نفسه قد يزور من أكثر من جهاز أو متصفح، وتُحسب فقط المشاركات المرسلة بعد أول زيارة مسجّلة
            {visits.since ? ` (${fmt(visits.since)})` : ''}. تكرار الزيارة خلال 30 دقيقة من المتصفح نفسه لا يُحسب زيارة جديدة.
          </p>
        </>
      ) : (
        <p className="muted">إحصاءات الزيارات غير متاحة بعد (يلزم تنفيذ ملف supabase/002_visits_notifications.sql).</p>
      )}

      <h2>المشاركة</h2>
      <div className="grid">
        <Stat k="إجمالي المستقلين المستهدفين" v={s.hasList ? s.totalTargets : null} />
        <Stat k="نسبة المشاركة (المستجيبون من القائمة ÷ القائمة)" v={rate(s.participationRate)} />
        <Stat k="المستجيبون الفريدون من القائمة" v={s.hasList ? s.respondentsInList : null} />
        <Stat k="لم يردوا بعد" v={s.nonRespondents} sub="عدم الرد لا يعني عدم التسجيل" />
        <Stat k="إجمالي المستجيبين الفريدين" v={s.respondents} />
        <Stat k="مستجيبون من خارج القائمة" v={s.respondentsOutsideList} />
      </div>

      <h2>التسجيل واكتمال الملف</h2>
      <p className="muted small">«أفاد» = إفادة ذاتية بحسب آخر تحديث من الشخص. «متحقق» = أكّدته الإدارة يدويًا.</p>
      <div className="grid">
        <Stat k="أفاد بأن لديه حساب" v={s.registeredReported} sub={s.hasList ? `من القائمة: ${rate(s.registeredReportedRate)}` : undefined} />
        <Stat k="تسجيل متحقق منه" v={s.registeredVerified} sub={s.hasList ? `من القائمة: ${rate(s.registeredVerifiedRate)}` : undefined} />
        <Stat k="أفاد باكتمال الملف" v={s.profileCompleteReported} sub={s.hasList ? `من القائمة: ${rate(s.profileReportedRate)}` : undefined} />
        <Stat k="اكتمال متحقق منه" v={s.profileCompleteVerified} sub={s.hasList ? `من القائمة: ${rate(s.profileVerifiedRate)}` : undefined} />
        <Breakdown title="هل لديه حساب؟ (آخر إفادة)" counts={s.hasAccount} labels={HAS_ACCOUNT} />
        <Breakdown title="حالة الملف (آخر إفادة)" counts={s.profileStatus} labels={PROFILE_STATUS} />
      </div>

      <h2>البلاغات والمقترحات</h2>
      <div className="grid">
        <Stat k="إجمالي المشكلات" v={s.issues} sub={`تمنع إكمال الإجراء: ${s.issuesBlocking}`} />
        <Breakdown title="المشكلات حسب الحالة" counts={s.issuesByStatus} labels={TICKET_STATUS} />
        <Breakdown title="المشكلات حسب التصنيف" counts={s.issuesByCategory} labels={ISSUE_CATEGORY} />
        <Stat k="إجمالي الاقتراحات" v={s.suggestions} />
        <Breakdown title="الاقتراحات حسب الحالة" counts={s.suggestionsByStatus} labels={TICKET_STATUS} />
      </div>

      <h2>رمز QR للرابط العام</h2>
      {PUBLIC_URL ? (
        <button
          className="btn outline"
          onClick={async () => {
            const url = await QRCode.toDataURL(PUBLIC_URL, { width: 600, margin: 2, color: { dark: '#24529b' } });
            downloadBlob('nafadh-tracker-qr.png', await (await fetch(url)).blob());
          }}
        >
          تنزيل QR لـ {PUBLIC_URL}
        </button>
      ) : (
        <p className="muted">غير متاح: لم يُحدَّد رابط نشر حقيقي بعد (المتغير VITE_PUBLIC_URL).</p>
      )}
    </>
  );
}

/* ---------------- Targets ---------------- */

function TargetsTab({ data, reload }: { data: Dataset; reload: () => Promise<void> }) {
  const rows = useMemo(() => targetRows(data), [data]);
  const outside = useMemo(() => outsideRespondents(data), [data]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [manual, setManual] = useState({ full_name: '', email: '' });

  const shown = rows.filter((r) => !q || r.target.full_name.includes(q) || r.target.email.includes(q.toLowerCase()));

  async function importFile(file: File) {
    const res = extractTargets(parseCsv(await file.text()), new Set(data.targets.map((t) => t.email)));
    try {
      const added = await api.addTargets(res.rows);
      setMsg(`تمت إضافة ${added}، تجاهل ${res.duplicates} مكرر، و${res.invalid} صف غير صالح.`);
      await reload();
    } catch {
      setMsg('تعذّر الاستيراد.');
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const err = nameError(manual.full_name) || emailError(manual.email);
    if (err) return setMsg(err);
    try {
      // addTargets returns the number of newly inserted rows (0 when the email already exists)
      const added = await api.addTargets([manual]);
      setMsg(added > 0 ? 'تمت الإضافة.' : 'البريد موجود مسبقًا في القائمة.');
      if (added > 0) setManual({ full_name: '', email: '' });
      await reload();
    } catch {
      setMsg('تعذّرت الإضافة.');
    }
  }

  async function patch(t: Target, p: Partial<Target>) {
    await api.updateTarget(t.id, p);
    await reload();
  }

  const triState = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const fromTri = (v: string) => (v === '' ? null : v === 'yes');

  function exportCsv() {
    if (!confirm(PII_NOTE)) return;
    downloadCsv(`freelancers-${stamp()}.csv`, [
      ['الاسم', 'البريد', 'لديه حساب (إفادة)', 'حالة الملف (إفادة)', 'الأجزاء الناقصة', 'آخر مشاركة', 'عدد المشكلات', 'عدد الاقتراحات', 'تسجيل متحقق', 'اكتمال متحقق', 'ملاحظة الإدارة'],
      ...rows.map((r) => [
        r.target.full_name,
        r.target.email,
        r.latest ? HAS_ACCOUNT[r.latest.has_account] : 'لم يرد',
        r.latest ? PROFILE_STATUS[r.latest.profile_status] : 'لم يرد',
        r.latest?.missing_parts.map((m) => MISSING_PARTS[m]).join('، ') ?? '',
        r.lastActivity ?? '',
        r.issues,
        r.suggestions,
        r.target.registered_verified === null ? 'غير محدد' : r.target.registered_verified ? 'نعم' : 'لا',
        r.target.profile_verified === null ? 'غير محدد' : r.target.profile_verified ? 'نعم' : 'لا',
        r.target.admin_note ?? '',
      ]),
    ]);
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>استيراد القائمة المرجعية (CSV)</h3>
        <p className="muted small">عمودان على الأقل: الاسم والبريد الإلكتروني. يُطبَّع البريد وتُزال التكرارات تلقائيًا.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0]).then(() => (e.target.value = ''))} />
        <form className="toolbar" style={{ marginTop: 12 }} onSubmit={addManual}>
          <input type="text" placeholder="الاسم الكامل" value={manual.full_name} onChange={(e) => setManual({ ...manual, full_name: e.target.value })} />
          <input type="email" dir="ltr" placeholder="email@example.com" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
          <button className="btn sm">إضافة يدويًا</button>
        </form>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="بحث بالاسم أو البريد" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{shown.length} من {rows.length}</span>
        <button className="btn outline sm" onClick={exportCsv} style={{ marginInlineStart: 'auto' }}>
          تصدير CSV
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>لديه حساب (إفادة)</th>
              <th>الملف (إفادة)</th>
              <th>آخر مشاركة</th>
              <th>مشكلات</th>
              <th>اقتراحات</th>
              <th>تسجيل متحقق</th>
              <th>اكتمال متحقق</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  لا توجد بيانات. استورد القائمة أو أضف مستقلًا يدويًا.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <Fragment key={r.target.id}>
                <tr>
                  <td>{r.target.full_name}</td>
                  <td className="ltr">{r.target.email}</td>
                  <td>{r.latest ? HAS_ACCOUNT[r.latest.has_account] : <span className="muted">لم يرد</span>}</td>
                  <td>
                    {r.latest ? PROFILE_STATUS[r.latest.profile_status] : <span className="muted">—</span>}
                    {r.latest?.missing_parts.length ? (
                      <div className="muted small">ناقص: {r.latest.missing_parts.map((m) => MISSING_PARTS[m]).join('، ')}</div>
                    ) : null}
                  </td>
                  <td>{fmt(r.lastActivity)}</td>
                  <td>{r.issues}</td>
                  <td>{r.suggestions}</td>
                  {(['registered_verified', 'profile_verified'] as const).map((k) => (
                    <td key={k}>
                      <select value={triState(r.target[k])} onChange={(e) => patch(r.target, { [k]: fromTri(e.target.value) })} aria-label={k}>
                        <option value="">غير محدد</option>
                        <option value="yes">نعم</option>
                        <option value="no">لا</option>
                      </select>
                    </td>
                  ))}
                  <td>
                    <button className="btn link" onClick={() => setOpen(open === r.target.id ? null : r.target.id)}>
                      {open === r.target.id ? 'إخفاء' : 'التفاصيل'}
                    </button>
                  </td>
                </tr>
                {open === r.target.id && (
                  <tr>
                    <td colSpan={10} style={{ background: 'var(--bg-alt)' }}>
                      <TargetDetails row={r} onPatch={(p) => patch(r.target, p)} onDelete={async () => {
                        if (confirm(`حذف ${r.target.full_name} من القائمة؟ (لن تُحذف مشاركاته)`)) {
                          await api.deleteTarget(r.target.id);
                          await reload();
                        }
                      }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {outside.length > 0 && (
        <>
          <h3>مستجيبون من خارج القائمة ({outside.length})</h3>
          <p className="muted small">بريد غير موجود في القائمة المرجعية (قد يكون خطأ كتابة أو شخصًا غير مدرج).</p>
          <div className="table-wrap">
            <table>
              <tbody>
                {outside.map((o) => (
                  <tr key={o.email}>
                    <td>{o.full_name}</td>
                    <td className="ltr">{o.email}</td>
                    <td>
                      <button className="btn outline sm" onClick={() => api.addTargets([o]).then(reload)}>
                        إضافة للقائمة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function TargetDetails({ row, onPatch, onDelete }: { row: ReturnType<typeof targetRows>[number]; onPatch: (p: Partial<Target>) => void; onDelete: () => void }) {
  const [note, setNote] = useState(row.target.admin_note ?? '');
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>سجل تحديثات الحالة ({row.history.length})</h3>
      {row.history.length === 0 ? (
        <p className="muted">لا توجد تحديثات.</p>
      ) : (
        <ul>
          {row.history.map((h) => (
            <li key={h.id}>
              {fmt(h.created_at)} — حساب: {HAS_ACCOUNT[h.has_account]}، الملف: {PROFILE_STATUS[h.profile_status]}
              {h.missing_parts.length ? ` (ناقص: ${h.missing_parts.map((m) => MISSING_PARTS[m]).join('، ')})` : ''}
              {h.notes && <div className="muted small">ملاحظة: {h.notes}</div>}
            </li>
          ))}
        </ul>
      )}
      {row.target.verified_at && <p className="muted small">آخر تعديل للتحقق: {fmt(row.target.verified_at)}</p>}
      <div className="toolbar">
        <input type="text" placeholder="ملاحظة الإدارة" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => onPatch({ admin_note: note.trim() || null })}>
          حفظ الملاحظة
        </button>
        <button className="btn outline sm" onClick={onDelete}>
          حذف من القائمة
        </button>
      </div>
    </div>
  );
}

/* ---------------- Tickets ---------------- */

function TicketsTab({ tickets, reload }: { tickets: Ticket[]; reload: () => Promise<void> }) {
  const [f, setF] = useState({ q: '', kind: '', status: '', category: '' });
  const [open, setOpen] = useState<number | null>(null);
  const shown = tickets.filter(
    (t) =>
      (!f.kind || t.kind === f.kind) &&
      (!f.status || t.status === f.status) &&
      (!f.category || t.category === f.category) &&
      (!f.q || [ticketRef(t.id), t.title, t.description, t.full_name, t.email].some((x) => x.toLowerCase().includes(f.q.toLowerCase()))),
  );
  const sel = (k: keyof typeof f, all: string, labels: Record<string, string>) => (
    <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">{all}</option>
      {Object.entries(labels).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  async function setStatus(t: Ticket, status: TicketStatus) {
    await api.setTicketStatus(t.id, status);
    await reload();
  }

  function exportCsv() {
    if (!confirm(PII_NOTE)) return;
    downloadCsv(`tickets-${stamp()}.csv`, [
      ['المرجع', 'النوع', 'التاريخ', 'الاسم', 'البريد', 'التصنيف', 'العنوان', 'الوصف', 'يمنع الإكمال', 'الحالة', 'عدد الصور'],
      ...shown.map((t) => [
        ticketRef(t.id),
        TICKET_KIND[t.kind],
        t.created_at,
        t.full_name,
        t.email,
        t.category ? ISSUE_CATEGORY[t.category] : '',
        t.title,
        t.description,
        t.blocking === null ? '' : t.blocking ? 'نعم' : 'لا',
        TICKET_STATUS[t.status],
        t.attachments.length,
      ]),
    ]);
  }

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="بحث (مرجع، عنوان، اسم، بريد)" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {sel('kind', 'كل الأنواع', TICKET_KIND)}
        {sel('status', 'كل الحالات', TICKET_STATUS)}
        {sel('category', 'كل التصنيفات', ISSUE_CATEGORY)}
        <span className="muted small">{shown.length} من {tickets.length}</span>
        <button className="btn outline sm" onClick={exportCsv} style={{ marginInlineStart: 'auto' }}>
          تصدير CSV
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>المرجع</th>
              <th>النوع</th>
              <th>التاريخ</th>
              <th>الاسم</th>
              <th>التصنيف</th>
              <th>العنوان</th>
              <th>يمنع الإكمال</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  لا توجد نتائج.
                </td>
              </tr>
            )}
            {shown.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td className="ltr">{ticketRef(t.id)}</td>
                  <td>{TICKET_KIND[t.kind]}</td>
                  <td>{fmt(t.created_at)}</td>
                  <td>{t.full_name}</td>
                  <td>{t.category ? ISSUE_CATEGORY[t.category] : '—'}</td>
                  <td>
                    {t.title}
                    {t.attachments.length > 0 && <span className="muted small"> · {t.attachments.length} صور</span>}
                  </td>
                  <td>{t.blocking === null ? '—' : t.blocking ? 'نعم' : 'لا'}</td>
                  <td>
                    <select value={t.status} onChange={(e) => setStatus(t, e.target.value as TicketStatus)} className={'pill ' + t.status} aria-label="الحالة">
                      {Object.entries(TICKET_STATUS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn link" onClick={() => setOpen(open === t.id ? null : t.id)}>
                      {open === t.id ? 'إخفاء' : 'التفاصيل'}
                    </button>
                  </td>
                </tr>
                {open === t.id && (
                  <tr>
                    <td colSpan={9} style={{ background: 'var(--bg-alt)' }}>
                      <TicketDetails t={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TicketDetails({ t }: { t: Ticket }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  useEffect(() => {
    api.attachmentUrls(t.attachments).then(setUrls, () => setUrls([]));
  }, [t]);
  return (
    <div>
      <dl className="kv">
        <dt>المرجع</dt>
        <dd className="ltr">{ticketRef(t.id)}</dd>
        <dt>المرسل</dt>
        <dd>
          {t.full_name} — <span dir="ltr">{t.email}</span>
        </dd>
        <dt>العنوان</dt>
        <dd>{t.title}</dd>
        <dt>الوصف</dt>
        <dd>{t.description}</dd>
        <dt>آخر تحديث</dt>
        <dd>{fmt(t.updated_at)}</dd>
      </dl>
      {t.attachments.length > 0 && (
        <>
          <h3>الصور المرفقة</h3>
          {!urls ? (
            <p className="muted">جارٍ التحميل…</p>
          ) : (
            <div className="shots">
              {urls.map((u, i) =>
                u ? (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                    <img src={u} alt={`مرفق ${i + 1}`} />
                  </a>
                ) : (
                  <span key={i} className="muted small">
                    الصورة غير متاحة{api.mode === 'demo' ? ' (الصور التجريبية لا تبقى بعد إعادة تحميل الصفحة)' : ''}
                  </span>
                ),
              )}
            </div>
          )}
          {api.mode === 'cloud' && <p className="muted small">الروابط مؤقتة (10 دقائق).</p>}
        </>
      )}
    </div>
  );
}

/* ---------------- Notifications ---------------- */

type FeedItem = { kind: FeedKind; id: number; at: string; label: string; who: string; title: string };

function Notifications({ data, fresh, onSeen }: { data: Dataset; fresh: boolean; onSeen: (kind: FeedKind, ids: number[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  // seen_at === undefined means migration 002 is not applied yet: no notifications then
  const items: FeedItem[] = [
    ...data.statuses
      .filter((x) => x.seen_at === null)
      .map((x) => ({ kind: 'status' as const, id: x.id, at: x.created_at, label: 'تحديث حالة حساب', who: x.full_name, title: `${HAS_ACCOUNT[x.has_account]} / ${PROFILE_STATUS[x.profile_status]}` })),
    ...data.tickets
      .filter((x) => x.seen_at === null)
      .map((x) => ({ kind: 'ticket' as const, id: x.id, at: x.created_at, label: `${TICKET_KIND[x.kind]} ${ticketRef(x.id)}`, who: x.full_name, title: x.title })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const ids = (kind: FeedKind) => items.filter((i) => i.kind === kind).map((i) => i.id);

  return (
    <div className={'notif' + (items.length ? ' has-new' : '')}>
      <button className="notif-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Bell size={18} aria-hidden />
        <span>المشاركات الجديدة غير المراجَعة</span>
        <span className="count" aria-label={`${items.length} غير مراجَعة`}>
          {items.length}
        </span>
        {fresh && items.length > 0 && <span className="pill new">وصل جديد</span>}
      </button>
      {open && (
        <div className="notif-panel">
          {items.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              لا توجد مشاركات جديدة.
            </p>
          ) : (
            <>
              <ul>
                {items.slice(0, 30).map((i) => (
                  <li key={i.kind + i.id}>
                    <div>
                      <strong>{i.label}</strong> — {i.who}
                      <div className="muted small">
                        {i.title} · {fmt(i.at)}
                      </div>
                    </div>
                    <button className="btn outline sm" onClick={() => onSeen(i.kind, [i.id])}>
                      تمت المراجعة
                    </button>
                  </li>
                ))}
              </ul>
              {items.length > 30 && <p className="muted small">و{items.length - 30} أخرى…</p>}
              <button
                className="btn sm"
                onClick={async () => {
                  await onSeen('status', ids('status'));
                  await onSeen('ticket', ids('ticket'));
                }}
              >
                <CheckCheck size={16} aria-hidden /> تعليم الكل كمراجَع
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

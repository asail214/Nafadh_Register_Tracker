import { lazy, Suspense } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from './lib/api';
import { NAFADH_URL } from './lib/labels';
import PublicPage from './pages/PublicPage';

const AdminPage = lazy(() => import('./pages/AdminPage'));

// The original Nafadh logo (logo-blue.png) is white on transparent, so the header uses the brand blue as background.
export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <header className="header">
        <div className="container wide">
          <a href="/" className="brand" aria-label="الرئيسية — نفاذ">
            <img src="/nafadh-logo.png" alt="نفاذ NAFADH" width={3848} height={1445} />
          </a>
          <nav>
            {children ?? (
              <a className="header-link" href={NAFADH_URL} target="_blank" rel="noopener noreferrer">
                منصة نفاذ للعمل الحر <ExternalLink size={14} aria-hidden />
              </a>
            )}
          </nav>
        </div>
      </header>
      {api.mode === 'demo' && (
        <div className="demo-bar" role="note">
          بيانات تجريبية لا تُحفظ سحابيًا — المشاركات تبقى في هذا المتصفح فقط.
        </div>
      )}
    </>
  );
}

export default function App() {
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
  return isAdmin ? (
    <Suspense fallback={<p className="container">جارٍ التحميل…</p>}>
      <AdminPage />
    </Suspense>
  ) : (
    <PublicPage />
  );
}

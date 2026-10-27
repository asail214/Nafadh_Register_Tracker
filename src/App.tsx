import { lazy, Suspense } from 'react';
import { api } from './lib/api';
import PublicPage from './pages/PublicPage';

const AdminPage = lazy(() => import('./pages/AdminPage'));

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="header">
      <div className="container wide">
        <a href="/" aria-label="الرئيسية">
          <img src="/nafadh-logo.png" alt="نفاذ" />
        </a>
        <nav>
          {api.mode === 'demo' && <span className="badge-demo">بيانات تجريبية لا تُحفظ سحابيًا</span>}
          {children}
        </nav>
      </div>
    </header>
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

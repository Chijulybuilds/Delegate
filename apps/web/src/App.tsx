import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { FullPageSpinner } from './components/ui';
import LandingPage from './landing/LandingPage';
import { useAuth } from './lib/auth';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const NotFound = lazy(() => import('./pages/NotFound'));
const AppShell = lazy(() => import('./app/AppShell'));
const BoardPage = lazy(() => import('./app/BoardPage'));
const HeartbeatPage = lazy(() => import('./app/HeartbeatPage'));
const VelocityPage = lazy(() => import('./app/VelocityPage'));
const StandupPage = lazy(() => import('./app/StandupPage'));
const TeamPage = lazy(() => import('./app/TeamPage'));
const SettingsPage = lazy(() => import('./app/SettingsPage'));
// The platform console is only reachable by typing /admin — nothing in the product links to it.
const AdminRoot = lazy(() => import('./admin/AdminRoot'));

/** Signed-in users with a workspace only. */
function RequireWorkspace({ children }: { children: ReactNode }) {
  const { booting, token, me } = useAuth();
  const location = useLocation();
  if (booting) return <FullPageSpinner />;
  if (!token || !me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me.membership) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          path="/app"
          element={
            <RequireWorkspace>
              <AppShell />
            </RequireWorkspace>
          }
        >
          <Route index element={<BoardPage />} />
          <Route path="heartbeat" element={<HeartbeatPage />} />
          <Route path="velocity" element={<VelocityPage />} />
          <Route path="standup" element={<StandupPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="/admin/*" element={<AdminRoot />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

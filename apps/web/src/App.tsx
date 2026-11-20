import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { FullPageSpinner } from './components/ui';
import LandingPage from './landing/LandingPage';
import { useAuth } from './lib/auth';
import { useThemeScope } from './lib/theme';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PrivacyPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsPage })));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const NotFound = lazy(() => import('./pages/NotFound'));
const AppShell = lazy(() => import('./app/AppShell'));
const BoardPage = lazy(() => import('./app/BoardPage'));
const HeartbeatPage = lazy(() => import('./app/HeartbeatPage'));
const WaitingPage = lazy(() => import('./app/WaitingPage'));
const RecallPage = lazy(() => import('./app/RecallPage'));
const AuditsPage = lazy(() => import('./app/AuditsPage'));
const InsightsPage = lazy(() => import('./app/InsightsPage'));
const PlaybooksPage = lazy(() => import('./app/PlaybooksPage'));
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

/**
 * If Supabase's redirect allow-list doesn't include /auth/callback, Google sign-in comes back to the
 * Site URL ("/") with the code attached. Finish signing in there instead of showing the landing page.
 */
function Home() {
  const { search, hash } = useLocation();
  const returning = /[?&](code|token_hash|error_description)=/.test(search) || /access_token=|error_description=/.test(hash);
  if (returning) return <Navigate to={`/auth/callback${search}${hash}`} replace />;
  return <LandingPage />;
}

export function App() {
  // Light/dark applies to the dashboard only; everything else stays light.
  useThemeScope(useLocation().pathname);
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/reset" element={<ResetPassword />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
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
          <Route path="waiting" element={<WaitingPage />} />
          <Route path="recall" element={<RecallPage />} />
          <Route path="history" element={<Navigate to="/app/waiting" replace />} />
          <Route path="audits" element={<AuditsPage />} />
          <Route path="activity" element={<HeartbeatPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="playbooks" element={<PlaybooksPage />} />
          {/* Old links keep working. */}
          <Route path="heartbeat" element={<Navigate to="/app/activity" replace />} />
          <Route path="velocity" element={<Navigate to="/app/insights?tab=velocity" replace />} />
          <Route path="standup" element={<Navigate to="/app/insights?tab=standup" replace />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="/admin/*" element={<AdminRoot />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

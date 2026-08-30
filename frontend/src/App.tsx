import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import AppShell from './components/AppShell';
import LandingPage from './pages/LandingPage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import MarketsPage from './pages/MarketsPage';
import HoldingsPage from './pages/HoldingsPage';
import ExplorePage from './pages/ExplorePage';
import ResearchPage from './pages/ResearchPage';
import AlertDetailPage from './pages/AlertDetailPage';
import SettingsPage from './pages/SettingsPage';
import PublicResearchPage from './pages/PublicResearchPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="font-display text-lg" style={{ color: '#D4A843' }}>SignalStack</span>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />

      {/* Public research — SEO-indexed, no auth required */}
      <Route path="/research/:ticker" element={<PublicResearchPage />} />

      {/* Protected app routes */}
      <Route path="/app" element={
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="markets" element={<MarketsPage />} />
        <Route path="holdings" element={<HoldingsPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="research/:ticker" element={<ResearchPage />} />
        <Route path="alerts/:alertId" element={<AlertDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* Backward compat — old routes land on the matching Markets tab */}
        <Route path="alerts" element={<Navigate to="/app/markets" replace state={{ tab: 'alerts' }} />} />
        <Route path="earnings" element={<Navigate to="/app/markets" replace state={{ tab: 'earnings' }} />} />
        <Route path="news" element={<Navigate to="/app/markets" replace state={{ tab: 'news' }} />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

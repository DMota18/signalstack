import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useIntelligenceStream } from '../hooks/useIntelligenceStream';
import { api } from '../api/client';
import TickerSearch from './TickerSearch';
import FearGreedWidget from './FearGreedWidget';
import IntelligenceProgress from './IntelligenceProgress';
import {
  LayoutDashboard, Briefcase, BarChart3, Search, Bell, Settings,
  Calendar, Sun, Moon, LogOut, Zap, Loader2, Menu, X,
} from 'lucide-react';

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const stream = useIntelligenceStream();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [earnings, setEarnings] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [liveTime, setLiveTime] = useState(new Date());

  // Theme tokens
  const gold = isDark ? '#D4A843' : '#8B6914';
  const textPrimary = isDark ? '#E8E6E1' : '#1A1A1D';
  const textMuted = isDark ? '#6A6A6D' : '#9A9A9D';
  const textSecondary = isDark ? '#9A9A9D' : '#5A5A5D';
  const headerBg = isDark ? '#0A0A0B' : '#F0EDE6';
  const sidebarBg = isDark ? '#0C0C0E' : '#F8F7F4';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const mainBg = isDark ? '#0C0C0E' : '#F4F2ED';

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load sidebar data
  useEffect(() => {
    api.getEarningsCalendar().then((res) => {
      if (res.status === 'ok') setEarnings((res.data || []).slice(0, 5));
    });
    api.getUnreadCount().then((res) => {
      if (res.status === 'ok') setUnreadCount(res.data?.unread_count || 0);
    });
  }, [location.pathname]);

  // Intelligence stream handlers
  const handleGenerate = () => {
    setGenerating(true);
    setStreamError(null);
    stream.start();
  };

  useEffect(() => {
    if (stream.result && !stream.isStreaming) {
      setGenerating(false);
      api.getUnreadCount().then((res) => {
        if (res.status === 'ok') setUnreadCount(res.data?.unread_count || 0);
      });
    }
    if (stream.error && !stream.isStreaming) {
      setGenerating(false);
      setStreamError(stream.error);
    }
  }, [stream.result, stream.error, stream.isStreaming]);

  const dateStr = liveTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = liveTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  // Nav items
  const navItems = [
    { label: 'Dashboard', path: '/app', icon: LayoutDashboard, end: true },
    { label: 'Holdings', path: '/app/holdings', icon: Briefcase },
    { label: 'Markets', path: '/app/markets', icon: BarChart3 },
    { label: 'Explore', path: '/app/explore', icon: Search },
    { label: 'Alerts', path: '/app/alerts', icon: Bell, badge: unreadCount },
    { label: 'Settings', path: '/app/settings', icon: Settings },
  ];

  // Close mobile menu on navigation
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div className="flex flex-col h-screen" style={{ background: mainBg }}>

      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between px-5 py-2.5 shrink-0"
        style={{ background: headerBg, borderBottom: `1px solid ${border}` }}>

        {/* Left: Brand + date/time */}
        <div className="flex items-center gap-5">
          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden">
            {mobileOpen ? <X size={18} style={{ color: textPrimary }} /> : <Menu size={18} style={{ color: textPrimary }} />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: gold }}>
              <span className="text-[9px] font-bold" style={{ color: '#0C0C0E' }}>Z</span>
            </div>
            <span className="font-display text-sm hidden sm:inline" style={{ color: textPrimary }}>SignalStack</span>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <span className="text-[11px] font-body" style={{ color: textMuted }}>{dateStr}</span>
            <span className="text-[11px] font-numeric" style={{ color: textSecondary }}>{timeStr}</span>
          </div>
        </div>

        {/* Right: Actions + user */}
        <div className="flex items-center gap-3">
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-1.5 text-[11px] font-body font-medium px-3 py-1.5 rounded-md transition-all disabled:opacity-30"
            style={{ background: gold, color: '#0C0C0E' }}>
            {generating ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            <span className="hidden sm:inline">{generating ? 'Analyzing' : 'Run Analysis'}</span>
          </button>

          <button onClick={() => navigate('/app/settings')}
            className="p-1.5 rounded-md transition-all hover:opacity-70"
            style={{ color: textMuted }}>
            <Settings size={15} />
          </button>

          <span className="text-[11px] font-body hidden sm:inline" style={{ color: textSecondary }}>
            {user?.display_name || 'Manager'}
          </span>
        </div>
      </div>

      {/* ═══ INTELLIGENCE PROGRESS (shows when generating) ═══ */}
      {(generating || streamError) && (
        <div className="px-5 pt-3 shrink-0">
          <IntelligenceProgress
            active={generating}
            holdingsCount={0}
            agents={stream.agents}
            statusMessage={stream.statusMessage}
            currentIndex={stream.currentIndex}
            totalAgents={stream.totalAgents}
            error={streamError}
            onDismiss={() => setStreamError(null)}
          />
        </div>
      )}

      {/* ═══ BODY: SIDEBAR + CONTENT ═══ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Mobile overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* ─── LEFT SIDEBAR (static on desktop, drawer on mobile) ─── */}
        <aside
          className={`
            fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
            w-56 lg:w-[220px] shrink-0 flex flex-col
            overflow-y-auto
            transform transition-transform duration-200
            ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
          style={{ background: sidebarBg, borderRight: `1px solid ${border}` }}
        >
          {/* Mobile: show brand at top of drawer */}
          <div className="lg:hidden px-5 pt-5 pb-3">
            <span className="font-display text-sm" style={{ color: gold }}>SignalStack</span>
          </div>

          {/* Navigation */}
          <nav className="px-3 pt-3 lg:pt-4 space-y-0.5">
            {navItems.map((item) => {
              const isActive = item.end
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path) && item.path !== '/app';
              const dashActive = item.path === '/app' && location.pathname === '/app';
              const active = isActive || dashActive;
              const Icon = item.icon;

              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-[12px] font-body transition-all"
                  style={{
                    background: active ? `${gold}15` : 'transparent',
                    color: active ? gold : textSecondary,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <Icon size={14} />
                  {item.label}
                  {item.badge ? (
                    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: gold, color: '#0C0C0E' }}>
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Ticker search */}
          <div className="px-4 pt-4">
            <TickerSearch />
          </div>

          {/* UPCOMING EARNINGS */}
          <div className="px-3 pt-4">
            <div className="flex items-center gap-1.5 px-2 mb-2">
              <Calendar size={11} style={{ color: gold }} />
              <p className="text-[10px] font-body font-semibold tracking-wider uppercase" style={{ color: gold }}>
                Upcoming Earnings
              </p>
            </div>

            {earnings.length > 0 ? (
              <div className="space-y-1">
                {earnings.map((e: any, i: number) => (
                  <button
                    key={`${e.ticker}-${i}`}
                    onClick={() => navigate(`/app/research/${e.ticker}`)}
                    className="w-full px-3 py-2 rounded-md text-left transition-all hover:opacity-80"
                    style={{
                      background: i === 0 ? `${gold}10` : 'transparent',
                      border: i === 0 ? `0.5px solid ${gold}30` : 'none',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-body font-semibold" style={{ color: i === 0 ? gold : textPrimary }}>
                        {e.ticker}
                      </span>
                      <span className="text-[9px] font-body" style={{ color: textMuted }}>
                        {e.report_time || ''}
                      </span>
                    </div>
                    <p className="text-[10px] font-body" style={{ color: textMuted }}>
                      {e.report_date}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] font-body px-3" style={{ color: textMuted }}>
                No upcoming earnings
              </p>
            )}
          </div>

          {/* Fear & Greed compact */}
          <div className="px-5 pt-4">
            <FearGreedWidget />
          </div>

          {/* Bottom controls */}
          <div className="mt-auto px-3 pb-4 pt-4 space-y-0.5">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-[12px] font-body transition-all hover:opacity-80"
              style={{ color: textSecondary }}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-[12px] font-body transition-all hover:opacity-80"
              style={{ color: textSecondary }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </aside>

        {/* ─── MAIN CONTENT ─── */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

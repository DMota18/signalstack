import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Loader2 } from 'lucide-react';

export default function SignInPage() {
  const { signIn } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#2A2A2D' : '#D0D0D0';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await signIn(email, password);
    setLoading(false);
    if (result.ok) {
      navigate('/app');
    } else {
      setError(result.error || 'Sign in failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: isDark ? '#0C0C0E' : '#FAFAF8' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/">
            <h1 className="font-display text-2xl tracking-wide" style={{ color: gold }}>SignalStack</h1>
          </Link>
          <p className="text-sm font-body mt-2" style={{ color: textMuted }}>Welcome back</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm px-4 py-3 rounded-lg font-body"
              style={{ background: 'rgba(255,69,58,0.1)', color: '#FF453A' }}>
              {error}
            </div>
          )}

          <div>
            <label htmlFor="signin-email" className="block text-xs font-body mb-1.5" style={{ color: textMuted }}>Email</label>
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm font-body outline-none focus:ring-1"
              style={{
                background: surface,
                border: `0.5px solid ${border}`,
                color: isDark ? '#E8E6E1' : '#1A1A1D',
              }}
            />
          </div>

          <div>
            <label htmlFor="signin-password" className="block text-xs font-body mb-1.5" style={{ color: textMuted }}>Password</label>
            <input
              id="signin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm font-body outline-none focus:ring-1"
              style={{
                background: surface,
                border: `0.5px solid ${border}`,
                color: isDark ? '#E8E6E1' : '#1A1A1D',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-gold w-full disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm font-body mt-6" style={{ color: textMuted }}>
          Don't have an account?{' '}
          <Link to="/signup" style={{ color: gold }}>Request access</Link>
        </p>
      </div>
    </div>
  );
}

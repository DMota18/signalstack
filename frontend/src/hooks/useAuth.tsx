import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  display_name?: string;
  tier: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (api.isAuthenticated()) {
      api.getProfile().then((res) => {
        if (res.status === 'ok' && res.data) {
          setUser(res.data);
        } else {
          api.clearTokens();
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await api.signIn(email, password);
    if (res.status === 'ok' && res.data) {
      api.setTokens(res.data.access_token, res.data.refresh_token);
      localStorage.setItem('ss_user_id', res.data.user_id);
      const profile = await api.getProfile();
      if (profile.status === 'ok' && profile.data) {
        setUser(profile.data);
      }
      return { ok: true };
    }
    return { ok: false, error: res.error?.message || 'Sign in failed' };
  };

  const signUp = async (email: string, password: string, name?: string) => {
    const res = await api.signUp(email, password, name);
    if (res.status === 'ok' && res.data) {
      if (res.data.access_token) {
        api.setTokens(res.data.access_token, res.data.refresh_token);
        localStorage.setItem('ss_user_id', res.data.user_id);
        const profile = await api.getProfile();
        if (profile.status === 'ok' && profile.data) {
          setUser(profile.data);
        }
        return { ok: true };
      }
      return { ok: true }; // Email confirmation required
    }
    return { ok: false, error: res.error?.message || 'Sign up failed' };
  };

  const signOut = () => {
    api.clearTokens();
    setUser(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

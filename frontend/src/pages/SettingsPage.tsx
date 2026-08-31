import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Link2, Unlink, Sun, Moon, Bell, BellOff, Loader2, Check, CreditCard, ExternalLink, Zap, Gift, Copy } from 'lucide-react';

const sectorOptions = [
  { value: 'ai_semiconductors', label: 'AI / Semiconductors' },
  { value: 'crypto_blockchain', label: 'Crypto / Blockchain' },
  { value: 'clean_energy', label: 'Clean energy' },
  { value: 'biotech', label: 'Biotech' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'defense', label: 'Defense' },
  { value: 'dividends_income', label: 'Dividends / Income' },
  { value: 'small_cap_growth', label: 'Small cap growth' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [profile, setProfile] = useState<any>({});
  const [investor, setInvestor] = useState<any>({});
  const [connections, setConnections] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [callbackDetected, setCallbackDetected] = useState(false);
  const [callbackSyncing, setCallbackSyncing] = useState(false);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#6A6A6D' : '#8A8A8D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const inputBg = isDark ? '#0C0C0E' : '#F8F7F4';
  const inputBorder = isDark ? '#2A2A2D' : '#D0D0D0';
  const greenColor = isDark ? '#34C759' : '#28A745';

  useEffect(() => {
    Promise.all([
      api.getProfile(),
      api.getInvestorProfile(),
      api.getConnections(),
      api.getBillingStatus(),
      api.getReferralCode(),
      api.getReferralStats(),
    ]).then(([pRes, iRes, cRes, bRes, refRes, refStatsRes]) => {
      if (pRes.status === 'ok') setProfile(pRes.data || {});
      if (iRes.status === 'ok') setInvestor(iRes.data || {});
      if (cRes.status === 'ok') setConnections(cRes.data || []);
      if (bRes.status === 'ok') setBilling(bRes.data || null);
      if (refRes.status === 'ok') setReferral(refRes.data || null);
      if (refStatsRes.status === 'ok') setReferralStats(refStatsRes.data || null);
    });

    // Check push notification status
    if ('Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
  }, []);

  // Billing callback detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      // Refresh billing status after successful checkout
      api.getBillingStatus().then((res) => {
        if (res.status === 'ok') setBilling(res.data || null);
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleUpgrade = async () => {
    setBillingAction('checkout');
    setBillingLoading(true);
    const res = await api.createCheckoutSession();
    if (res.status === 'ok' && res.data?.checkout_url) {
      window.location.href = res.data.checkout_url;
    } else {
      setBillingLoading(false);
      setBillingAction(null);
    }
  };

  const handleManageBilling = async () => {
    setBillingAction('portal');
    setBillingLoading(true);
    const res = await api.createPortalSession();
    if (res.status === 'ok' && res.data?.portal_url) {
      window.location.href = res.data.portal_url;
    } else {
      setBillingLoading(false);
      setBillingAction(null);
    }
  };

  // SnapTrade callback detection — check URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || params.get('connectionStatus');
    if (status === 'success' || status === 'CONNECTED') {
      setCallbackDetected(true);
      // Auto-sync after SnapTrade redirect
      handleSnapTradeCallback();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSnapTradeCallback = async () => {
    setCallbackSyncing(true);
    try {
      await api.connectionCallback();
      await api.syncPortfolio();
      // Refresh connections list
      const cRes = await api.getConnections();
      if (cRes.status === 'ok') setConnections(cRes.data || []);
    } catch { /* ignore */ }
    setCallbackSyncing(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    await api.updateProfile({
      display_name: profile.display_name,
      timezone: profile.timezone,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveInvestorProfile = async () => {
    setSaving(true);
    await api.updateInvestorProfile({
      risk_appetite: investor.risk_appetite,
      sector_interests: investor.sector_interests || [],
      discovery_mode: investor.discovery_mode,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const [connecting, setConnecting] = useState(false);
  const [billing, setBilling] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingAction, setBillingAction] = useState<'checkout' | 'portal' | null>(null);
  const [referral, setReferral] = useState<any>(null);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const connectBrokerage = async () => {
    setConnecting(true);
    const res = await api.registerConnection();
    if (res.status === 'ok' && res.data?.redirect_url) {
      // Redirect in same tab — SnapTrade will send user back to /app/settings?status=success
      window.location.href = res.data.redirect_url;
    } else {
      setConnecting(false);
      alert(res.error?.message || 'Failed to start brokerage connection. Check your SnapTrade configuration.');
    }
  };

  const disconnect = async (id: string) => {
    if (confirm('Disconnect this brokerage? Holdings data will be removed.')) {
      await api.disconnectBrokerage(id);
      const res = await api.getConnections();
      if (res.status === 'ok') setConnections(res.data || []);
    }
  };

  const toggleSector = (value: string) => {
    const current = investor.sector_interests || [];
    const updated = current.includes(value)
      ? current.filter((s: string) => s !== value)
      : [...current, value];
    setInvestor({ ...investor, sector_interests: updated });
  };

  // The service worker is registered on app load (main.tsx); push
  // subscription below uses navigator.serviceWorker.ready.

  const togglePushNotifications = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('Push notifications are not supported in this browser.');
      return;
    }

    setPushLoading(true);

    if (pushEnabled) {
      // Disable — unsubscribe
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await api.deletePushSubscription();
        setPushEnabled(false);
      } catch { /* ignore */ }
    } else {
      // Enable — request permission and subscribe
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPushLoading(false);
          return;
        }

        const reg = await navigator.serviceWorker.ready;

        // VAPID public key from env or fallback
        const vapidKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;

        const subscribeOptions: PushSubscriptionOptionsInit = {
          userVisibleOnly: true,
        };

        if (vapidKey) {
          subscribeOptions.applicationServerKey = urlBase64ToUint8Array(vapidKey);
        }

        const sub = await reg.pushManager.subscribe(subscribeOptions);

        await api.savePushSubscription(sub.toJSON());
        setPushEnabled(true);
      } catch {
        alert('Push notifications are not yet configured. Check back soon.');
      }
    }
    setPushLoading(false);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="font-display text-xl">Settings</h1>

      {/* SnapTrade callback banner */}
      {callbackDetected && (
        <div className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: `${greenColor}12`, border: `0.5px solid ${greenColor}30` }}>
          {callbackSyncing ? (
            <>
              <Loader2 size={16} className="animate-spin" style={{ color: greenColor }} />
              <p className="text-sm font-body" style={{ color: greenColor }}>
                Brokerage connected! Syncing your holdings...
              </p>
            </>
          ) : (
            <>
              <Check size={16} style={{ color: greenColor }} />
              <p className="text-sm font-body" style={{ color: greenColor }}>
                Brokerage connected and synced successfully!
              </p>
            </>
          )}
        </div>
      )}

      {/* Profile */}
      <Section title="Profile" isDark={isDark} surface={surface} border={border}>
        <Field label="Display name" isDark={isDark} textMuted={textMuted}>
          <input type="text" value={profile.display_name || ''} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg text-sm font-body outline-none"
            style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
        </Field>
        <Field label="Email" isDark={isDark} textMuted={textMuted}>
          <p className="text-sm font-body" style={{ color: textMuted }}>{profile.email || user?.email}</p>
        </Field>
        <Field label="Timezone" isDark={isDark} textMuted={textMuted}>
          <select value={profile.timezone || 'America/New_York'} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
            className="w-full px-3 py-2 rounded-lg text-sm font-body outline-none"
            style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
            <option value="UTC">UTC</option>
            <option value="Europe/London">London (GMT/BST)</option>
          </select>
        </Field>
        <div className="flex justify-between items-center pt-2">
          <span className="text-xs font-body" style={{ color: textMuted }}>
            Tier: <span style={{ color: gold }}>{billing?.tier || user?.tier || 'free'}</span>
          </span>
          <button onClick={saveProfile} disabled={saving} className="btn-gold text-sm disabled:opacity-50">
            {saved ? 'Saved' : saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </Section>

      {/* Billing / Subscription */}
      <Section title="Subscription" isDark={isDark} surface={surface} border={border}>
        {billing?.tier === 'pro' ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${greenColor}15` }}>
                  <Zap size={16} style={{ color: greenColor }} />
                </div>
                <div>
                  <p className="text-sm font-body font-medium">
                    Pro <span className="text-[11px] font-normal" style={{ color: greenColor }}>Active</span>
                  </p>
                  <p className="text-[11px] font-body" style={{ color: textMuted }}>
                    {billing.current_period_end
                      ? `Renews ${new Date(billing.current_period_end).toLocaleDateString()}`
                      : 'Unlimited portfolio, AI intelligence, daily digests'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleManageBilling}
                disabled={billingLoading}
                className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg transition-colors"
                style={{ border: `0.5px solid ${inputBorder}`, color: textMuted }}>
                {billingLoading && billingAction === 'portal'
                  ? <Loader2 size={12} className="animate-spin" />
                  : <ExternalLink size={12} />}
                Manage
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${gold}15` }}>
                  <CreditCard size={16} style={{ color: gold }} />
                </div>
                <div>
                  <p className="text-sm font-body font-medium">Upgrade to Pro</p>
                  <p className="text-[11px] font-body" style={{ color: textMuted }}>
                    Unlimited tickers, AI-powered intelligence, daily digests, stock discovery, push alerts
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-lg font-display" style={{ color: gold }}>
                  $15<span className="text-xs font-body" style={{ color: textMuted }}>/month</span>
                </p>
                <button
                  onClick={handleUpgrade}
                  disabled={billingLoading}
                  className="btn-gold text-sm flex items-center gap-2 disabled:opacity-50">
                  {billingLoading && billingAction === 'checkout'
                    ? <><Loader2 size={14} className="animate-spin" /> Redirecting...</>
                    : 'Upgrade'}
                </button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Referrals */}
      {referral && (
        <Section title="Invite friends" isDark={isDark} surface={surface} border={border}>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-body mb-1">Your referral link</p>
              <p className="text-[11px] font-body mb-3" style={{ color: textMuted }}>
                When someone signs up with your link and upgrades to Pro, you earn a free month.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 rounded-lg text-xs font-body truncate"
                  style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}>
                  {referral.link}
                </div>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(referral.link);
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 2000);
                    } catch {
                      window.prompt('Copy this link:', referral.link);
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs font-body px-3 py-2 rounded-lg transition-colors shrink-0"
                  style={{
                    border: `0.5px solid ${codeCopied ? `${greenColor}40` : inputBorder}`,
                    color: codeCopied ? greenColor : textMuted,
                  }}>
                  {codeCopied ? <Check size={12} /> : <Copy size={12} />}
                  {codeCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {referralStats && (
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center"
                    style={{ background: `${gold}12` }}>
                    <Gift size={13} style={{ color: gold }} />
                  </div>
                  <div>
                    <p className="text-sm font-numeric font-medium">{referralStats.signups}</p>
                    <p className="text-[10px] font-body" style={{ color: textMuted }}>Signups</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center"
                    style={{ background: `${greenColor}12` }}>
                    <Zap size={13} style={{ color: greenColor }} />
                  </div>
                  <div>
                    <p className="text-sm font-numeric font-medium">{referralStats.upgrades}</p>
                    <p className="text-[10px] font-body" style={{ color: textMuted }}>Upgrades</p>
                  </div>
                </div>
                {referralStats.credits_remaining > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ background: `${gold}12` }}>
                      <CreditCard size={13} style={{ color: gold }} />
                    </div>
                    <div>
                      <p className="text-sm font-numeric font-medium">{referralStats.credits_remaining}</p>
                      <p className="text-[10px] font-body" style={{ color: textMuted }}>Free months</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Investor Profile */}
      <Section title="Investor profile" isDark={isDark} surface={surface} border={border}>
        <Field label="Risk appetite" isDark={isDark} textMuted={textMuted}>
          <div className="flex gap-1.5">
            {['conservative', 'moderate', 'growth', 'aggressive'].map((r) => (
              <button key={r} onClick={() => setInvestor({ ...investor, risk_appetite: r })}
                className="text-xs font-body px-3 py-1.5 rounded-lg transition-colors flex-1"
                style={{
                  background: investor.risk_appetite === r ? `${gold}15` : 'transparent',
                  color: investor.risk_appetite === r ? gold : textMuted,
                  border: `0.5px solid ${investor.risk_appetite === r ? `${gold}40` : inputBorder}`,
                }}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Sector interests" isDark={isDark} textMuted={textMuted}>
          <div className="flex gap-2 flex-wrap">
            {sectorOptions.map((s) => {
              const active = (investor.sector_interests || []).includes(s.value);
              return (
                <button key={s.value} onClick={() => toggleSector(s.value)}
                  className="text-[11px] font-body px-3 py-1.5 rounded-full transition-colors"
                  style={{
                    background: active ? `${gold}15` : isDark ? '#1A1A1D' : '#F0EEE8',
                    color: active ? gold : textMuted,
                    border: `0.5px solid ${active ? `${gold}40` : inputBorder}`,
                  }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Discovery mode" isDark={isDark} textMuted={textMuted}>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { value: 'adjacent', label: 'Adjacent to holdings' },
              { value: 'contrarian', label: 'Contrarian / hedge' },
              { value: 'momentum', label: 'Momentum' },
              { value: 'under_the_radar', label: 'Under the radar' },
            ].map((d) => (
              <button key={d.value} onClick={() => setInvestor({ ...investor, discovery_mode: d.value })}
                className="text-[11px] font-body px-3 py-1.5 rounded-lg transition-colors"
                style={{
                  background: investor.discovery_mode === d.value ? `${gold}15` : 'transparent',
                  color: investor.discovery_mode === d.value ? gold : textMuted,
                  border: `0.5px solid ${investor.discovery_mode === d.value ? `${gold}40` : inputBorder}`,
                }}>
                {d.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex justify-end pt-2">
          <button onClick={saveInvestorProfile} disabled={saving} className="btn-gold text-sm disabled:opacity-50">
            {saved ? 'Saved' : saving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notifications" isDark={isDark} surface={surface} border={border}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-body">Push notifications</p>
            <p className="text-[11px] font-body" style={{ color: textMuted }}>
              {pushEnabled
                ? 'Enabled — you\'ll receive alerts for price movements, earnings, and daily digests'
                : 'Disabled — enable to get real-time alerts on this device'}
            </p>
          </div>
          <button
            onClick={togglePushNotifications}
            disabled={pushLoading}
            className="flex items-center gap-2 text-xs font-body px-3 py-1.5 rounded-lg transition-colors"
            style={{
              border: `0.5px solid ${pushEnabled ? `${greenColor}40` : inputBorder}`,
              color: pushEnabled ? greenColor : textMuted,
              background: pushEnabled ? `${greenColor}08` : 'transparent',
            }}
          >
            {pushLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : pushEnabled ? (
              <Bell size={14} />
            ) : (
              <BellOff size={14} />
            )}
            {pushEnabled ? 'Enabled' : 'Enable'}
          </button>
        </div>
        {'Notification' in window && Notification.permission === 'denied' && (
          <p className="text-[10px] font-body mt-2" style={{ color: isDark ? '#FF453A' : '#DC3545' }}>
            Notifications are blocked by your browser. Check your browser settings to allow notifications for this site.
          </p>
        )}
      </Section>

      {/* Brokerage Connections */}
      <Section title="Brokerage connections" isDark={isDark} surface={surface} border={border}>
        {connections.filter(c => c.status !== 'disconnected').map((c) => (
          <div key={c.id} className="flex items-center justify-between py-3"
            style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
            <div className="flex items-center gap-3">
              <Link2 size={16} style={{ color: gold }} />
              <div>
                <p className="text-sm font-body font-medium">{c.brokerage_name}</p>
                <p className="text-[11px] font-body" style={{ color: textMuted }}>
                  {c.account_name || c.account_type || 'Connected'}
                  {c.last_sync_at && ` — Synced ${new Date(c.last_sync_at).toLocaleDateString()}`}
                </p>
              </div>
            </div>
            <button onClick={() => disconnect(c.id)}
              className="flex items-center gap-1 text-xs font-body px-2 py-1 rounded"
              style={{ color: isDark ? '#FF453A' : '#DC3545' }}>
              <Unlink size={12} /> Disconnect
            </button>
          </div>
        ))}
        <button onClick={connectBrokerage} disabled={connecting}
          className="btn-outline w-full mt-3 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {connecting ? <><Loader2 size={14} className="animate-spin" /> Connecting to SnapTrade...</> : 'Connect a brokerage'}
        </button>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" isDark={isDark} surface={surface} border={border}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-body">Theme</p>
            <p className="text-[11px] font-body" style={{ color: textMuted }}>
              {isDark ? 'Dark mode' : 'Light mode'}
            </p>
          </div>
          <button onClick={toggleTheme}
            className="flex items-center gap-2 text-xs font-body px-3 py-1.5 rounded-lg"
            style={{ border: `0.5px solid ${inputBorder}`, color: textMuted }}>
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            Switch to {isDark ? 'light' : 'dark'}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children, isDark, surface, border }: {
  title: string; children: React.ReactNode; isDark: boolean; surface: string; border: string;
}) {
  const gold = isDark ? '#D4A843' : '#8B6914';
  return (
    <div className="rounded-xl p-5 space-y-4"
      style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
      <h2 className="font-display text-sm" style={{ color: gold }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, isDark: _isDark, textMuted }: {
  label: string; children: React.ReactNode; isDark: boolean; textMuted: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-body mb-1.5" style={{ color: textMuted }}>{label}</label>
      {children}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

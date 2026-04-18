import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Loader2, ExternalLink, TrendingUp, TrendingDown, Heart, CheckCircle, Users } from 'lucide-react';

interface SocialFeedProps {
  ticker: string;
}

interface STMessage {
  id: number;
  body: string;
  created_at: string;
  user: {
    username: string;
    name: string;
    avatar: string;
    followers: number;
    classification: string;
    official: boolean;
  };
  sentiment: string | null;
  likes: number;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function SocialFeed({ ticker }: SocialFeedProps) {
  const { isDark } = useTheme();
  const [messages, setMessages] = useState<STMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbolInfo, setSymbolInfo] = useState<any>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const surface = isDark ? '#0C0C0E' : '#F8F7F4';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    api.getStockTwits(ticker, 20).then((res) => {
      if (res.status === 'ok' && res.data) {
        setMessages(res.data.messages || []);
        setSymbolInfo(res.data.symbol || null);
      }
      setLoading(false);
    });
  }, [ticker]);

  const stocktwitsUrl = `https://stocktwits.com/symbol/${ticker}`;
  const xSearchUrl = `https://x.com/search?q=%24${ticker}&src=typed_query&f=live`;

  const bullishCount = messages.filter(m => m.sentiment === 'Bullish').length;
  const bearishCount = messages.filter(m => m.sentiment === 'Bearish').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin" style={{ color: gold }} />
        <span className="ml-2 text-xs font-body" style={{ color: textMuted }}>Loading social sentiment...</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-10">
        <Users size={24} style={{ color: `${gold}40` }} className="mx-auto mb-2" />
        <p className="text-sm font-body mb-1" style={{ color: textMuted }}>No verified posts for ${ticker}</p>
        <div className="flex items-center justify-center gap-3 mt-3">
          <a href={stocktwitsUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-body flex items-center gap-1" style={{ color: gold }}>
            StockTwits <ExternalLink size={8} />
          </a>
          <a href={xSearchUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-body flex items-center gap-1" style={{ color: textMuted }}>
            𝕏 Search <ExternalLink size={8} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Sentiment summary bar */}
      {(bullishCount > 0 || bearishCount > 0) && (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 flex h-2 rounded-full overflow-hidden" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
            {bullishCount > 0 && (
              <div className="h-full rounded-l-full" style={{
                width: `${(bullishCount / (bullishCount + bearishCount)) * 100}%`,
                background: greenColor,
              }} />
            )}
            {bearishCount > 0 && (
              <div className="h-full rounded-r-full" style={{
                width: `${(bearishCount / (bullishCount + bearishCount)) * 100}%`,
                background: redColor,
              }} />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-numeric" style={{ color: greenColor }}>{bullishCount} bullish</span>
            <span className="text-[10px] font-numeric" style={{ color: redColor }}>{bearishCount} bearish</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="space-y-1">
        {messages.map((msg) => (
          <div key={msg.id} className="rounded-lg px-4 py-3" style={{ background: surface }}>
            {/* User row */}
            <div className="flex items-center gap-2 mb-1.5">
              {msg.user.avatar ? (
                <img src={msg.user.avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
              ) : (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-body shrink-0"
                  style={{ background: `${gold}18`, color: gold }}>
                  {(msg.user.username || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-body font-medium truncate">{msg.user.name || msg.user.username}</span>
                {(msg.user.official || msg.user.classification === 'verified' || msg.user.classification === 'official') && (
                  <CheckCircle size={10} style={{ color: gold }} className="shrink-0" />
                )}
                <span className="text-[9px] font-body" style={{ color: textMuted }}>@{msg.user.username}</span>
              </div>
              <span className="text-[9px] font-body ml-auto shrink-0" style={{ color: textMuted }}>
                {timeAgo(msg.created_at)}
              </span>
            </div>

            {/* Body */}
            <p className="text-xs font-body leading-relaxed mb-1.5" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
              {msg.body}
            </p>

            {/* Footer: sentiment + likes */}
            <div className="flex items-center gap-3">
              {msg.sentiment && (
                <span className="text-[9px] font-body flex items-center gap-1" style={{
                  color: msg.sentiment === 'Bullish' ? greenColor : redColor,
                }}>
                  {msg.sentiment === 'Bullish' ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                  {msg.sentiment}
                </span>
              )}
              {msg.likes > 0 && (
                <span className="text-[9px] font-body flex items-center gap-1" style={{ color: textMuted }}>
                  <Heart size={8} /> {msg.likes}
                </span>
              )}
              {msg.user.followers > 0 && (
                <span className="text-[9px] font-body" style={{ color: textMuted }}>
                  {msg.user.followers >= 1000 ? `${(msg.user.followers / 1000).toFixed(1)}K` : msg.user.followers} followers
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <p className="text-[9px] font-body" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
          Showing verified and top contributors only.
        </p>
        <div className="flex items-center gap-3">
          <a href={xSearchUrl} target="_blank" rel="noopener noreferrer"
            className="text-[9px] font-body flex items-center gap-1" style={{ color: textMuted }}>
            𝕏 ${ticker} <ExternalLink size={7} />
          </a>
          <a href={stocktwitsUrl} target="_blank" rel="noopener noreferrer"
            className="text-[9px] font-body flex items-center gap-1" style={{ color: gold }}>
            View all on StockTwits <ExternalLink size={7} />
          </a>
        </div>
      </div>
    </div>
  );
}

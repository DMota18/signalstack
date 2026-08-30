import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Plus, Loader2, Check } from 'lucide-react';

interface AddHoldingFormProps {
  onSuccess?: () => void;
  compact?: boolean;
}

interface SearchResult {
  symbol: string;
  name?: string;
  description?: string;
  type?: string;
}

export default function AddHoldingForm({ onSuccess, compact = false }: AddHoldingFormProps) {
  const { isDark } = useTheme();
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [price, setPrice] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('equity');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Ticker search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const inputBg = isDark ? '#0C0C0E' : '#F8F7F4';
  const inputBorder = isDark ? '#2A2A2D' : '#D0D0D0';
  const textColor = isDark ? '#E8E6E1' : '#1A1A1D';
  const surface = isDark ? '#151517' : '#FFFFFF';

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const searchTickers = async (query: string) => {
    if (query.length < 1) { setSearchResults([]); setShowDropdown(false); return; }
    setSearching(true);
    const res = await api.searchSymbols(query);
    if (res.status === 'ok' && Array.isArray(res.data)) {
      setSearchResults(res.data.slice(0, 8));
      setShowDropdown(true);
    }
    setSearching(false);
  };

  const handleTickerChange = (value: string) => {
    setTicker(value.toUpperCase());
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchTickers(value), 300);
  };

  const selectResult = (result: SearchResult) => {
    setTicker(result.symbol || '');
    setName(result.name || result.description || '');
    setShowDropdown(false);
  };

  const reset = () => {
    setTicker('');
    setQuantity('');
    setCostBasis('');
    setPrice('');
    setName('');
    setType('equity');
    setShowAdvanced(false);
    setError(null);
    setSearchResults([]);
    setShowDropdown(false);
  };

  const handleSubmit = async () => {
    const t = (ticker || '').trim().toUpperCase();
    const qty = parseFloat(quantity);

    if (!t) { setError('Ticker is required'); return; }
    if (!qty || qty <= 0) { setError('Quantity must be greater than 0'); return; }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const holding: any = { ticker: t, quantity: qty };
      if ((name || '').trim()) holding.security_name = (name || '').trim();
      if (type !== 'equity') holding.security_type = type;
      if (costBasis) holding.avg_cost_basis = parseFloat(costBasis);
      if (price) holding.current_price = parseFloat(price);

      const res = await api.addManualHolding(holding);

      if (res.status === 'ok') {
        setSuccess(t);
        reset();
        onSuccess?.();
      } else {
        setError(res.error?.message || 'Failed to add holding');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    }

    setSubmitting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ticker && quantity) handleSubmit();
  };

  const inputStyle = {
    background: inputBg,
    border: `0.5px solid ${inputBorder}`,
    color: textColor,
  };

  if (compact) {
    return (
      <div className="space-y-3">
        {/* Compact: single row for quick add */}
        <div className="flex gap-2">
          <div className="relative w-32" ref={dropdownRef}>
            <input
              type="text"
              value={ticker}
              onChange={(e) => handleTickerChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              placeholder="TICKER"
              maxLength={10}
              className="w-full px-3 py-2 rounded-lg text-sm font-body outline-none uppercase"
              style={inputStyle}
            />
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto"
                style={{ background: surface, border: `0.5px solid ${inputBorder}`, minWidth: 240 }}>
                {searchResults.map((r) => (
                  <button key={r.symbol} onClick={() => selectResult(r)}
                    className="w-full px-3 py-2 text-left flex items-center gap-2 transition-colors hover:opacity-80"
                    style={{ borderBottom: `0.5px solid ${inputBorder}` }}>
                    <span className="text-xs font-body font-medium" style={{ color: gold }}>{r.symbol}</span>
                    <span className="text-[11px] font-body truncate" style={{ color: textMuted }}>{r.name || r.description || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Qty"
            min={0}
            step="any"
            className="w-24 px-3 py-2 rounded-lg text-sm font-body outline-none"
            style={inputStyle}
          />
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Price (opt)"
            min={0}
            step="any"
            className="flex-1 px-3 py-2 rounded-lg text-sm font-body outline-none"
            style={inputStyle}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !(ticker || '').trim() || !quantity}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-body font-medium transition-all disabled:opacity-40"
            style={{ background: gold, color: '#0C0C0E' }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>

        {success && (
          <div className="flex items-center gap-2 text-xs font-body" style={{ color: isDark ? '#34C759' : '#28A745' }}>
            <Check size={12} /> {success} successfully added.
            <button onClick={() => { setSuccess(null); }} className="underline" style={{ color: gold }}>Add another?</button>
          </div>
        )}
        {error && (
          <p className="text-xs font-body" style={{ color: isDark ? '#FF453A' : '#DC3545' }}>{error}</p>
        )}
      </div>
    );
  }

  // Full form layout
  return (
    <div className="space-y-4">
      {/* Row 1: Ticker + Quantity */}
      <div className="flex gap-3">
        <div className="flex-1 relative" ref={dropdownRef}>
          <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
            Ticker or company name
          </label>
          <div className="relative">
            <input
              type="text"
              value={ticker}
              onChange={(e) => handleTickerChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              placeholder="e.g. NVDA, Bitcoin, Apple"
              maxLength={30}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none uppercase"
              style={inputStyle}
            />
            {searching && (
              <Loader2 size={14} className="absolute right-3 top-3 animate-spin" style={{ color: textMuted }} />
            )}
          </div>
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto"
              style={{ background: surface, border: `0.5px solid ${inputBorder}` }}>
              {searchResults.map((r) => (
                <button key={r.symbol} onClick={() => selectResult(r)}
                  className="w-full px-3 py-2.5 text-left flex items-center gap-3 transition-colors hover:opacity-80"
                  style={{ borderBottom: `0.5px solid ${inputBorder}` }}>
                  <span className="text-xs font-body font-medium shrink-0" style={{ color: gold, minWidth: 48 }}>{r.symbol}</span>
                  <span className="text-[11px] font-body truncate" style={{ color: textMuted }}>{r.name || r.description || ''}</span>
                  <span className="text-[10px] font-body ml-auto shrink-0 px-1.5 py-0.5 rounded" style={{ color: textMuted, background: `${textMuted}15` }}>{r.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-32">
          <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
            Quantity
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0.00"
            min={0}
            step="any"
            className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Row 2: Price + Cost basis */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
            Current price <span style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>(optional)</span>
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="$0.00"
            min={0}
            step="any"
            className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none"
            style={inputStyle}
          />
        </div>
        <div className="flex-1">
          <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
            Avg cost basis <span style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>(optional)</span>
          </label>
          <input
            type="number"
            value={costBasis}
            onChange={(e) => setCostBasis(e.target.value)}
            placeholder="$0.00"
            min={0}
            step="any"
            className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Advanced fields toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-[11px] font-body transition-opacity hover:opacity-70"
        style={{ color: gold }}
      >
        {showAdvanced ? 'Hide' : 'Show'} advanced fields
      </button>

      {showAdvanced && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
              Security name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NVIDIA Corporation"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none"
              style={inputStyle}
            />
          </div>
          <div className="w-40">
            <label className="block text-[11px] font-body mb-1" style={{ color: textMuted }}>
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-body outline-none"
              style={inputStyle}
            >
              <option value="equity">Equity</option>
              <option value="etf">ETF</option>
              <option value="crypto">Crypto</option>
              <option value="option">Option</option>
              <option value="mutual_fund">Mutual fund</option>
              <option value="bond">Bond</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center justify-between">
        <div>
          {success && (
            <span className="flex items-center gap-2 text-xs font-body" style={{ color: isDark ? '#34C759' : '#28A745' }}>
              <Check size={12} /> {success} successfully added.
              <button onClick={() => setSuccess(null)} className="underline" style={{ color: gold }}>Add another?</button>
            </span>
          )}
          {error && (
            <span className="text-xs font-body" style={{ color: isDark ? '#FF453A' : '#DC3545' }}>{error}</span>
          )}
        </div>
        {!success && (
          <button
            onClick={handleSubmit}
            disabled={submitting || !(ticker || '').trim() || !quantity}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-body font-medium transition-all disabled:opacity-40"
            style={{ background: gold, color: '#0C0C0E' }}
          >
            {submitting ? (
              <><Loader2 size={14} className="animate-spin" /> Adding...</>
            ) : (
              <><Plus size={14} /> Add holding</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

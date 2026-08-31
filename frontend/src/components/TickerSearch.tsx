import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Search, Loader2 } from 'lucide-react';

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
}

export default function TickerSearch() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const dropdownBg = isDark ? '#111113' : '#FFFFFF';
  const hoverBg = isDark ? '#1A1A1D' : '#F0EEE8';
  const borderColor = isDark ? '#2A2A2D' : '#D0D0D0';

  // Debounced search — fires 300ms after user stops typing
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setLoading(true);
    const res = await api.searchSymbols(q);
    if (res.status === 'ok' && Array.isArray(res.data)) {
      setResults(res.data);
      setShowDropdown(res.data.length > 0);
    } else {
      setResults([]);
      setShowDropdown(false);
    }
    setLoading(false);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => doSearch(value.trim()), 300);
    } else {
      setResults([]);
      setShowDropdown(false);
    }
  };

  const handleSelect = (symbol: string) => {
    navigate(`/app/research/${symbol}`);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && results[selectedIndex]) {
        handleSelect(results[selectedIndex].symbol);
      } else if (query.trim()) {
        // Direct navigation if no dropdown selection
        handleSelect(query.trim().toUpperCase());
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSelectedIndex(-1);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: surface,
          border: `0.5px solid ${showDropdown ? gold + '60' : borderColor}`,
        }}>
        {loading ? (
          <Loader2 size={14} className="animate-spin" style={{ color: gold }} />
        ) : (
          <Search size={14} style={{ color: showDropdown ? gold : textMuted }} />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search stocks..."
          aria-label="Search stocks"
          className="flex-1 text-xs font-body outline-none bg-transparent"
          style={{ color: isDark ? '#E8E6E1' : '#1A1A1D' }}
          maxLength={50}
        />
      </div>

      {/* Dropdown */}
      {showDropdown && results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-lg overflow-hidden z-50 shadow-lg"
          style={{
            background: dropdownBg,
            border: `0.5px solid ${borderColor}`,
          }}
        >
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              onMouseEnter={() => setSelectedIndex(i)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === selectedIndex ? hoverBg : 'transparent',
              }}
            >
              {/* Ticker badge */}
              <span className="text-xs font-body font-medium min-w-[52px]"
                style={{ color: gold }}>
                {r.symbol}
              </span>

              {/* Company name */}
              <span className="text-xs font-body flex-1 truncate"
                style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
                {r.name}
              </span>

              {/* Type badge */}
              {r.type && (
                <span className="text-[9px] font-body px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                  {r.type === 'Common Stock' ? 'Stock' : r.type === 'ETP' ? 'ETF' : r.type}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

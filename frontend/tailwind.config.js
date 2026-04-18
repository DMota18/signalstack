/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          black: '#0C0C0E',
          dark: '#111113',
          surface: '#151517',
          border: '#1A1A1D',
          'border-light': '#2A2A2D',
          muted: '#9A9A9D',
          text: '#B0B0B3',
          light: '#E8E6E1',
          gold: '#D4A843',
          'gold-dim': '#8B6914',
          'gold-bg': 'rgba(212, 168, 67, 0.12)',
        },
        signal: {
          bullish: '#34C759',
          'bullish-bg': 'rgba(52, 199, 89, 0.12)',
          bearish: '#FF453A',
          'bearish-bg': 'rgba(255, 69, 58, 0.12)',
          neutral: '#8A8A8D',
          'neutral-bg': 'rgba(138, 138, 141, 0.12)',
          conflicting: '#D4A843',
          'conflicting-bg': 'rgba(212, 168, 67, 0.12)',
        },
        // Light mode overrides
        day: {
          bg: '#FAFAF8',
          surface: '#FFFFFF',
          border: '#E8E6E1',
          'border-hover': '#D0D0D0',
          text: '#1A1A1D',
          muted: '#5A5A5D',
          gold: '#8B6914',
          'gold-bg': 'rgba(139, 105, 20, 0.08)',
          'bullish': '#28A745',
          'bearish': '#DC3545',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        numeric: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        'metric': ['28px', { lineHeight: '1.2', fontWeight: '500' }],
        'heading': ['24px', { lineHeight: '1.3', fontWeight: '500' }],
      },
    },
  },
  plugins: [],
}

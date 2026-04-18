# Frontend Rules (applies to frontend/**/*.{tsx,jsx,ts,js})

## Framework & Tooling
- React with TypeScript — no plain JS files in `frontend/src/`
- Tailwind CSS for styling — no CSS modules, no styled-components
- Vite as build tool with PWA plugin for service worker generation
- React Router for client-side routing

## Component Patterns
- Functional components only — no class components
- Custom hooks for shared logic (e.g., `useAuth`, `usePortfolio`, `useAlerts`)
- Props typed with interfaces, not inline types
- No prop drilling deeper than 2 levels — use context or state management

## API Communication
- All API calls go through a central `api/client.ts` module — never raw fetch in components
- The client automatically attaches the JWT from auth context
- The client automatically handles token refresh on 401 responses
- Error responses are typed to match the `APIResponse` envelope from the backend

## State Management
- React Query (TanStack Query) for server state — caching, refetching, optimistic updates
- React Context for auth state and user preferences
- No global state library (Redux, Zustand) unless complexity demands it later
- Portfolio data is server-managed — React Query handles cache invalidation on sync

## PWA Requirements
- Service worker must cache the app shell for offline access
- Push notification permission requested only after user completes onboarding, never on first visit
- Web Push subscription stored in Supabase via `/push-subscriptions` endpoint
- Offline fallback page shows last-cached portfolio data with "data may be stale" notice

## Accessibility
- All interactive elements must be keyboard-accessible
- Color is never the only indicator of state (use icons or text labels alongside)
- Form inputs have associated labels
- Alert notifications include aria-live regions for screen readers

## Financial Data Display
- All currency values formatted with `Intl.NumberFormat` — never manual string formatting
- Percentages display 2 decimal places (e.g., 11.24%, not 11.2389%)
- Positive changes green, negative red, neutral gray — using semantic CSS variables
- Prices update via React Query polling, not WebSocket (Phase 1 simplicity)
- Always show "as of {timestamp}" on price data — never imply real-time without confirmation

## Compliance
- The disclaimer text is rendered in a persistent footer or banner — never omitted on any intelligence screen
- The Explore/idea engine screen must show "Educational content, not investment advice" prominently
- No language in the UI should say "recommended" or "suggested" — use "based on your interests" or "data shows"

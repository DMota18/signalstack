-- ============================================================================
-- SignalStack — Migration 003: Polymarket Ticker Tags
-- Replaces real-time search-based Polymarket matching with a pre-built
-- local catalog of finance events tagged to stock tickers.
-- ============================================================================

-- ============================================================================
-- 1. POLYMARKET TICKER TAGS
-- Maps Polymarket events/markets to stock tickers.
-- Populated by a background job that fetches + auto-tags every 30 min.
-- ============================================================================

create table if not exists public.polymarket_ticker_tags (
  id              uuid primary key default gen_random_uuid(),

  -- Polymarket identifiers
  event_id        text not null,
  market_id       text,                       -- Null for event-level tags

  -- Ticker mapping
  ticker          text not null,              -- e.g. 'NVDA', 'BTC-USD', 'macro'
  tag_source      text not null default 'auto'
                  check (tag_source in ('auto', 'manual')),

  -- Denormalized display data (avoids join with polymarket_cache on read)
  event_title     text not null,
  question        text,                       -- Market-level question (if market_id set)
  yes_price       numeric(5, 4),              -- 0.0000 to 1.0000
  no_price        numeric(5, 4),
  volume_24h      numeric(16, 2) default 0,
  total_volume    numeric(16, 2) default 0,
  end_date        timestamptz,
  polymarket_url  text,
  image_url       text,

  -- Lifecycle
  active          boolean not null default true,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- One tag per event+market+ticker combo
  unique(event_id, market_id, ticker)
);

-- Fast lookups by ticker (the main query pattern)
create index if not exists idx_polymarket_tags_ticker_active
  on public.polymarket_ticker_tags(ticker, active)
  where active = true;

-- Fast lookups by event for sync updates
create index if not exists idx_polymarket_tags_event
  on public.polymarket_ticker_tags(event_id);

-- No RLS needed — this is public read-only data
-- Service role writes, everyone reads

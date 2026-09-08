-- ============================================================================
-- SignalStack — Migration 001: Initial schema
-- ============================================================================
-- Core tables, the user_case_facts view, row-level security, and the
-- auth trigger that provisions a profiles row for every new user.
--
-- Reconstructed from the backend's query surface (services/, api/, jobs/,
-- tools/). Later migrations build on this file:
--   002 — billing, cost tracking, referrals (adds Stripe columns to profiles)
--   003 — polymarket_ticker_tags catalog
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on row updates
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — one row per auth user, provisioned by the handle_new_user trigger
-- ----------------------------------------------------------------------------

create table public.profiles (
    id                  uuid primary key references auth.users(id) on delete cascade,
    email               text not null,
    display_name        text,
    tier                text not null default 'free'
                        check (tier in ('free', 'pro', 'premium')),
    timezone            text not null default 'America/New_York',
    push_enabled        boolean not null default true,
    email_enabled       boolean not null default true,
    stripe_customer_id  text,
    onboarded_at        timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create trigger profiles_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

-- Auto-provision a profiles row when a user signs up through Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email)
    values (new.id, coalesce(new.email, ''))
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- investor_profiles — risk/interest preferences (one per user, upserted)
-- ----------------------------------------------------------------------------

create table public.investor_profiles (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null unique references auth.users(id) on delete cascade,
    risk_appetite    text not null default 'moderate'
                     check (risk_appetite in ('conservative', 'moderate', 'growth', 'aggressive')),
    sector_interests text[] not null default '{}',
    discovery_mode   text not null default 'adjacent'
                     check (discovery_mode in ('adjacent', 'contrarian', 'momentum', 'under_the_radar')),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create trigger investor_profiles_updated_at
    before update on public.investor_profiles
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- brokerage_connections — SnapTrade links plus the synthetic "manual" account
-- ----------------------------------------------------------------------------

create table public.brokerage_connections (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid not null references auth.users(id) on delete cascade,
    snaptrade_user_id     text not null,
    -- Fernet ciphertext only — plaintext never reaches the database
    snaptrade_user_secret text not null,
    brokerage_name        text not null,
    brokerage_slug        text not null,
    account_id            text not null,
    account_name          text,
    account_type          text default 'brokerage',
    status                text not null default 'disconnected'
                          check (status in ('active', 'disconnected', 'stale')),
    last_sync_at          timestamptz,
    last_sync_error       text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create index idx_brokerage_connections_user on public.brokerage_connections (user_id);

create trigger brokerage_connections_updated_at
    before update on public.brokerage_connections
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- portfolios — one per connection, upserted on sync
-- ----------------------------------------------------------------------------

create table public.portfolios (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    connection_id    uuid not null unique references public.brokerage_connections(id) on delete cascade,
    total_value      numeric(16,2),
    cash_balance     numeric(16,2),
    day_change_pct   numeric,
    day_change_value numeric(16,2),
    synced_at        timestamptz not null default now(),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index idx_portfolios_user on public.portfolios (user_id);

create trigger portfolios_updated_at
    before update on public.portfolios
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- holdings — positions per portfolio; user_id denormalized for RLS and scans
-- ----------------------------------------------------------------------------

create table public.holdings (
    id               uuid primary key default gen_random_uuid(),
    portfolio_id     uuid not null references public.portfolios(id) on delete cascade,
    user_id          uuid not null references auth.users(id) on delete cascade,
    ticker           text not null,
    security_name    text,
    security_type    text not null default 'equity'
                     check (security_type in ('equity', 'etf', 'crypto', 'option', 'mutual_fund', 'bond', 'other')),
    exchange         text,
    quantity         numeric not null,
    avg_cost_basis   numeric,
    current_price    numeric,
    market_value     numeric(16,2),
    pct_of_portfolio numeric(8,3),
    total_gain_pct   numeric,
    total_gain_value numeric(16,2),
    day_gain_pct     numeric,
    day_gain_value   numeric(16,2),
    synced_at        timestamptz not null default now(),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (portfolio_id, ticker)
);

create index idx_holdings_user on public.holdings (user_id);
create index idx_holdings_user_pct on public.holdings (user_id, pct_of_portfolio desc nulls last);
create index idx_holdings_ticker on public.holdings (ticker);
create index idx_holdings_user_synced on public.holdings (user_id, synced_at);

create trigger holdings_updated_at
    before update on public.holdings
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- watchlist
-- ----------------------------------------------------------------------------

create table public.watchlist (
    id       uuid primary key default gen_random_uuid(),
    user_id  uuid not null references auth.users(id) on delete cascade,
    ticker   text not null,
    added_at timestamptz not null default now(),
    unique (user_id, ticker)
);

create index idx_watchlist_user on public.watchlist (user_id);

-- ----------------------------------------------------------------------------
-- alert_history — every intelligence output delivered to a user
-- ----------------------------------------------------------------------------

create table public.alert_history (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    -- Free-form by design: includes dynamic values like explore_{category}
    alert_type      text not null,
    trigger_source  text,
    title           text not null,
    body_json       jsonb not null default '{}',
    related_tickers text[],
    signals_used    text[],
    channels_sent   jsonb not null default '{}',
    read_at         timestamptz,
    dismissed_at    timestamptz,
    feedback        text check (feedback in ('useful', 'not_useful')),
    created_at      timestamptz not null default now()
);

create index idx_alert_history_user_created on public.alert_history (user_id, created_at desc);
create index idx_alert_history_user_type on public.alert_history (user_id, alert_type, created_at desc);

-- ----------------------------------------------------------------------------
-- price_alerts — user-configured movement thresholds
-- ----------------------------------------------------------------------------

create table public.price_alerts (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    ticker        text not null,
    threshold_pct numeric(5,2) not null,
    direction     text not null check (direction in ('above', 'below')),
    enabled       boolean not null default true,
    triggered_at  timestamptz,
    created_at    timestamptz not null default now()
    -- Duplicate (user_id, ticker, direction) rows are prevented in the API
    -- layer, which pre-checks before insert.
);

create index idx_price_alerts_user on public.price_alerts (user_id);
create index idx_price_alerts_enabled on public.price_alerts (enabled) where enabled = true;

-- ----------------------------------------------------------------------------
-- push_subscriptions — Web Push endpoints per user/browser
-- ----------------------------------------------------------------------------

create table public.push_subscriptions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    endpoint        text not null,
    p256dh          text not null default '',
    auth_key        text not null default '',
    -- Raw PushSubscription.expirationTime: epoch milliseconds or null
    expiration_time double precision,
    created_at      timestamptz not null default now(),
    unique (user_id, endpoint)
);

-- ----------------------------------------------------------------------------
-- earnings_calendar — shared (not user-scoped), synced from Finnhub
-- ----------------------------------------------------------------------------

create table public.earnings_calendar (
    id                uuid primary key default gen_random_uuid(),
    ticker            text not null,
    report_date       date not null,
    report_time       text default 'Time TBD',
    consensus_eps     numeric,
    consensus_revenue numeric(20,2),
    actual_eps        numeric,
    actual_revenue    numeric(20,2),
    briefing_sent     boolean not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (ticker, report_date)
);

create index idx_earnings_calendar_date on public.earnings_calendar (report_date);

create trigger earnings_calendar_updated_at
    before update on public.earnings_calendar
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- job_runs — pipeline observability (service role only)
-- ----------------------------------------------------------------------------

create table public.job_runs (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users(id) on delete cascade,
    job_type           text not null,
    status             text not null default 'running'
                       check (status in ('running', 'completed', 'partial', 'failed')),
    agent_results      jsonb not null default '{}',
    alert_id           uuid references public.alert_history(id) on delete set null,
    tokens_used        integer,
    estimated_cost_usd numeric(10,6),
    total_duration_ms  integer,
    error_message      text,
    error_category     text check (error_category in ('transient', 'validation', 'business', 'permission')),
    started_at         timestamptz not null default now(),
    completed_at       timestamptz,
    created_at         timestamptz not null default now()
);

create index idx_job_runs_user_started on public.job_runs (user_id, started_at desc);

-- ----------------------------------------------------------------------------
-- polymarket_cache — shared API response cache (service role only)
-- ----------------------------------------------------------------------------

create table public.polymarket_cache (
    id          uuid primary key default gen_random_uuid(),
    cache_key   text not null unique,
    market_data jsonb not null,
    cache_type  text not null default 'search',
    ttl_seconds integer not null default 900,
    fetched_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index idx_polymarket_cache_expires on public.polymarket_cache (expires_at);

-- ----------------------------------------------------------------------------
-- user_case_facts — one row per user: everything the coordinator needs to
-- build the Case Facts block in a single query (see services/case_facts.py)
-- ----------------------------------------------------------------------------

create or replace view public.user_case_facts as
select
    p.id as user_id,
    p.tier,
    (
        select coalesce(
            json_agg(
                json_build_object(
                    'ticker', h.ticker,
                    'quantity', h.quantity,
                    'pct_of_portfolio', h.pct_of_portfolio,
                    'current_price', h.current_price
                )
                order by h.pct_of_portfolio desc nulls last
            ),
            '[]'::json
        )
        from public.holdings h
        where h.user_id = p.id
    ) as holdings,
    (
        select coalesce(array_agg(w.ticker order by w.added_at), '{}')
        from public.watchlist w
        where w.user_id = p.id
    ) as watchlist_tickers,
    ip.risk_appetite,
    ip.sector_interests,
    ip.discovery_mode,
    (
        select max(a.created_at)
        from public.alert_history a
        where a.user_id = p.id and a.alert_type = 'daily_digest'
    ) as last_digest_at,
    (
        select count(*)::integer
        from public.alert_history a
        where a.user_id = p.id and a.read_at is null and a.dismissed_at is null
    ) as unread_alert_count,
    (
        select coalesce(
            json_agg(
                json_build_object(
                    'ticker', ec.ticker,
                    'report_date', ec.report_date,
                    'report_time', ec.report_time
                )
                order by ec.report_date
            ),
            '[]'::json
        )
        from public.earnings_calendar ec
        where ec.report_date between current_date and current_date + interval '14 days'
          and ec.ticker in (
              select h2.ticker from public.holdings h2 where h2.user_id = p.id
          )
    ) as upcoming_earnings
from public.profiles p
left join public.investor_profiles ip on ip.user_id = p.id;

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
-- The service role bypasses RLS for backend jobs, sync, and alert delivery.
-- Anon-client access with a user JWT is limited to the user's own rows.
-- Write policies exist only where the API writes with the anon client.

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Users can update their own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

alter table public.investor_profiles enable row level security;

create policy "Users can view their own investor profile"
    on public.investor_profiles for select
    using (auth.uid() = user_id);

create policy "Users can create their own investor profile"
    on public.investor_profiles for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own investor profile"
    on public.investor_profiles for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

alter table public.brokerage_connections enable row level security;

create policy "Users can view their own connections"
    on public.brokerage_connections for select
    using (auth.uid() = user_id);

alter table public.portfolios enable row level security;

create policy "Users can view their own portfolios"
    on public.portfolios for select
    using (auth.uid() = user_id);

alter table public.holdings enable row level security;

create policy "Users can view their own holdings"
    on public.holdings for select
    using (auth.uid() = user_id);

alter table public.watchlist enable row level security;

create policy "Users can view their own watchlist"
    on public.watchlist for select
    using (auth.uid() = user_id);

create policy "Users can add to their own watchlist"
    on public.watchlist for insert
    with check (auth.uid() = user_id);

create policy "Users can remove from their own watchlist"
    on public.watchlist for delete
    using (auth.uid() = user_id);

alter table public.alert_history enable row level security;

create policy "Users can view their own alerts"
    on public.alert_history for select
    using (auth.uid() = user_id);

create policy "Users can update their own alerts"
    on public.alert_history for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

alter table public.price_alerts enable row level security;

create policy "Users can view their own price alerts"
    on public.price_alerts for select
    using (auth.uid() = user_id);

create policy "Users can create their own price alerts"
    on public.price_alerts for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own price alerts"
    on public.price_alerts for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their own price alerts"
    on public.price_alerts for delete
    using (auth.uid() = user_id);

alter table public.push_subscriptions enable row level security;

create policy "Users can view their own push subscriptions"
    on public.push_subscriptions for select
    using (auth.uid() = user_id);

create policy "Users can create their own push subscriptions"
    on public.push_subscriptions for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own push subscriptions"
    on public.push_subscriptions for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their own push subscriptions"
    on public.push_subscriptions for delete
    using (auth.uid() = user_id);

-- Shared data: readable by any signed-in user, written by the service role.
alter table public.earnings_calendar enable row level security;

create policy "Authenticated users can read the earnings calendar"
    on public.earnings_calendar for select
    to authenticated
    using (true);

-- Service-role-only tables: RLS on with no policies denies all client access.
alter table public.job_runs enable row level security;

create policy "Users can view their own job runs"
    on public.job_runs for select
    using (auth.uid() = user_id);

alter table public.polymarket_cache enable row level security;

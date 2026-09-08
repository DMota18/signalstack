-- ============================================================================
-- SignalStack — Migration 002: Billing & Cost Tracking
-- Adds Stripe subscription tracking columns to profiles
-- and a daily cost tracking table for Claude API budget control.
-- ============================================================================

-- ============================================================================
-- 1. PROFILES — Add subscription tracking columns
-- stripe_customer_id already exists from migration 001
-- ============================================================================

alter table public.profiles
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text
    check (subscription_status in (
      'active', 'trialing', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    )),
  add column if not exists subscription_current_period_end timestamptz;

-- Index for webhook lookups by Stripe customer ID
create index if not exists idx_profiles_stripe_customer_id
  on public.profiles(stripe_customer_id)
  where stripe_customer_id is not null;


-- ============================================================================
-- 2. DAILY COST TRACKING — Per-user Claude API spend
-- Used by the cost cap system to enforce daily limits.
-- One row per user per day. Upserted by the job tracker.
-- ============================================================================

create table if not exists public.user_daily_costs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cost_date   date not null default current_date,

  -- Running totals for the day
  total_tokens    integer not null default 0,
  total_cost_usd  numeric(8, 4) not null default 0.0,
  job_count       integer not null default 0,

  -- Cap enforcement
  cap_hit_at      timestamptz,  -- When the cap was first reached (null = not hit)

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One row per user per day
  unique(user_id, cost_date)
);

create trigger user_daily_costs_updated_at
  before update on public.user_daily_costs
  for each row execute function public.set_updated_at();

-- Index for quick daily lookups
create index if not exists idx_user_daily_costs_user_date
  on public.user_daily_costs(user_id, cost_date desc);

-- RLS: only the service role writes to this table
alter table public.user_daily_costs enable row level security;

create policy "Users can read their own cost data"
  on public.user_daily_costs
  for select
  using (auth.uid() = user_id);

-- Service role bypasses RLS for writes (handled by backend)


-- ============================================================================
-- 3. TIER SIMPLIFICATION — Collapse premium → pro
-- Premium tier is deprecated. Any existing premium users become pro.
-- The check constraint still allows 'premium' for backward compat but
-- the app treats premium = pro everywhere.
-- ============================================================================

update public.profiles set tier = 'pro' where tier = 'premium';


-- ============================================================================
-- 4. REFERRALS — Track invite codes and credit rewards
-- Each user gets a unique referral code. When a referred user signs up
-- and upgrades to Pro, the referrer gets a free month credit.
-- ============================================================================

-- Add referral tracking columns to profiles
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references auth.users(id),
  add column if not exists referral_credits integer not null default 0;

-- Index for referral code lookups
create index if not exists idx_profiles_referral_code
  on public.profiles(referral_code)
  where referral_code is not null;

-- Referral events log (tracks conversions)
create table if not exists public.referral_events (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in ('signup', 'upgrade', 'credit_applied')),
  created_at  timestamptz not null default now(),

  unique(referrer_id, referred_id, event_type)
);

alter table public.referral_events enable row level security;

create policy "Users can read their own referral events"
  on public.referral_events
  for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

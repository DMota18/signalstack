-- ============================================================================
-- SignalStack — Migration 004: Stripe webhook idempotency
-- ============================================================================
-- Stripe redelivers webhook events on any non-2xx response or timeout.
-- The webhook handler claims each event id here before processing; the
-- primary key turns a duplicate delivery into a conflict, so lifecycle
-- events (and referral credits) are applied exactly once.

create table public.stripe_webhook_events (
    id           text primary key,           -- Stripe event id (evt_...)
    event_type   text not null,
    processed_at timestamptz not null default now()
);

-- Service role only: RLS on with no policies denies all client access.
alter table public.stripe_webhook_events enable row level security;

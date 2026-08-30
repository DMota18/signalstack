# Database Migrations

Numbered SQL migrations, applied in order against a Supabase project.

| File | Contents |
|------|----------|
| `001_initial_schema.sql` | Core tables (profiles, portfolios, holdings, alerts, earnings, jobs), the `user_case_facts` view, row-level security policies, and the `handle_new_user` signup trigger |
| `002_billing_and_cost_tracking.sql` | Stripe subscription columns, per-user daily Claude cost tracking, referral codes and events |
| `003_polymarket_ticker_tags.sql` | Prediction-market catalog auto-tagged to tickers |
| `004_stripe_webhook_events.sql` | Webhook idempotency — each Stripe event id is processed exactly once |

`dev_stub.sql` is **not** a migration — it is a minimal stand-in for the
Supabase-managed environment (the `auth` schema, `auth.uid()`, and the
`anon`/`authenticated`/`service_role` roles) so the chain can be validated
against a plain Postgres in CI and locally.

## Applying to Supabase

Run each numbered file, in order, in the Supabase SQL editor — or with the
Supabase CLI:

```bash
supabase db push        # if using the CLI's migration tracking
```

## Validating locally

```bash
createdb migrations_check
DATABASE_URL=postgresql://postgres@localhost:5432/migrations_check \
  ./scripts/validate_migrations.sh
```

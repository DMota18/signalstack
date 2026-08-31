# Backend Rules (applies to backend/**/*.py)

## Async & I/O
- Use async/await for all I/O operations — database queries, HTTP calls, file reads
- Never use synchronous `requests` in route handlers — use `httpx.AsyncClient`
- Celery tasks use `run_async()` helper to bridge sync Celery with async service layer

## Authentication & Authorization
- Every protected endpoint must depend on `get_current_user()` — no manual JWT parsing in routes
- Tier gating returns `APIResponse.fail(code="tier_required", details={"upgrade_url": ...})` —
  the frontend parses the envelope to render upgrade prompts, so never raise a 403 for tier gates
- Service-role Supabase client in route handlers is reserved for system-level
  operations (Stripe webhooks, SEO/OG rendering, referral bookkeeping,
  connection registration); user-scoped reads go through the anon client with
  `user_jwt=user.jwt_token` so RLS stays in the loop
- Route handlers use the anon client with `user_jwt=user.jwt_token` to respect RLS

## Database Access
- All Supabase queries go through `services/supabase.py` — never construct raw HTTP calls in routes
- All queries use PostgREST filter syntax (parameterized) — no string interpolation of user input
- Upserts specify `on_conflict` column explicitly — never rely on implicit conflict detection
- Always check `result["status_code"]` before accessing `result["data"]`

## Error Handling
- Tool implementations must return `ToolError` on failure, never raise exceptions to the caller
- Route handlers return `APIResponse.fail()` for expected errors — raise `HTTPException` only for auth/permission failures
- Background jobs catch all exceptions, log them, and record via `JobTracker.fail()`
- Never silently swallow exceptions — always log at minimum

## Structured Responses
- All API endpoints return `APIResponse` envelope: `{"status": "ok"|"error", "data": ..., "error": ...}`
- Error responses include `code` (machine-readable) and `message` (human-readable)
- List endpoints return arrays directly in `data`, not wrapped in `{"items": [...]}`
- Never return raw Supabase responses to the client — always transform through Pydantic models or APIResponse

## Import Order
- stdlib (os, json, datetime, typing)
- third-party (fastapi, pydantic, httpx, celery)
- local (backend.services, backend.models, backend.jobs)
- Enforced by isort configuration

## Naming
- Files: snake_case (e.g., `case_facts.py`, `celery_app.py`)
- Classes: PascalCase (e.g., `UserContext`, `JobTracker`)
- Functions: snake_case (e.g., `build_case_facts`, `get_current_user`)
- Constants: UPPER_SNAKE (e.g., `BLOCKED_TOOLS`, `DISCLAIMER`)
- Private functions: prefixed with underscore (e.g., `_normalize_timestamps`)

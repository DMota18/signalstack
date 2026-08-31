# Test Rules (applies to **/test_*.py, **/*_test.py)

## Framework
- pytest with async support (pytest-asyncio); config lives in pyproject.toml
  (testpaths + asyncio_mode=auto), so a bare `pytest` runs the suite
- `tests/conftest.py` injects fake env config so the suite runs from a fresh
  clone and can never touch real credentials
- Frontend: vitest (jsdom) for the API client and SSE hook — `npm test`

## External API Mocking
- Mock ALL external APIs — never call real Supabase, Finnhub, Polymarket, FRED, EDGAR, or SnapTrade in tests
- Use `pytest-httpx` or `respx` for mocking httpx calls (our Supabase client uses httpx)
- Mock responses must include realistic data shapes — not empty dicts or placeholder strings
- Include both success responses and each of the 4 error categories in mock fixtures

## Coverage Requirements
- Tool test files must test both the success path AND all 4 error categories:
  - transient (API timeout, 429 rate limit)
  - validation (bad input, invalid ticker)
  - business (valid request, no results — e.g., no Polymarket markets found)
  - permission (expired JWT, tier gating)
- Route handler tests must verify the `APIResponse` envelope shape on every response
- Hook tests must verify that blocked tool calls return the correct block_reason
- Output interceptor tests must verify advice language is caught and disclaimer is appended

## Agent Loop Tests
- Must verify correct `stop_reason` handling: `tool_use` → execute → loop, `end_turn` → return
- Must verify the safety cap (25 iterations) triggers correctly without being the primary stop
- Must verify that the coordinator receives structured JSON from subagents, not prose
- Must verify context isolation: subagent A's results do not leak into subagent B's prompt

## Job Tests
- JobTracker tests must verify status computation: all agents completed → "completed", mixed → "partial", none → "failed"
- Scan tasks must verify timezone-aware delivery hour logic
- Scan tasks must verify deduplication (no double-sends)
- Per-user tasks must verify retry behavior on transient failures

## Compliance Tests
- Verify disclaimer is present on EVERY output path (digest, alert, explore idea, weekly report)
- Verify advice language filter catches all patterns: "you should buy", "I recommend selling", "buy now", "strong buy"
- Verify PII redaction removes SSNs, account numbers, and emails from brokerage data
- Verify concentration warnings fire when a holding exceeds 25%
- Verify tier gating blocks free users from pro features and pro users from premium features

## Naming Convention
- Files: `test_{module}.py` (e.g., `test_case_facts.py`, `test_hooks.py`)
- Functions: `test_{function}_{scenario}` (e.g., `test_build_case_facts_empty_portfolio`, `test_pre_hook_blocks_trade_tools`)
- Fixtures: descriptive names (e.g., `mock_user_context`, `sample_holdings`, `finnhub_429_response`)

## Test Data
- Use factory functions for test data — never hardcode the same portfolio in multiple test files
- Sample tickers: NVDA, AAPL, GLD, BTC-USD, MTPLF (covers equity, ETF, crypto, foreign listing)
- Sample user tiers: one fixture per tier (free_user, pro_user, premium_user)
- Polymarket mock data should include both active and resolved markets

## What NOT to Test
- Supabase's internal RLS enforcement (that's Supabase's job — test your queries, not their engine)
- JWT signing/verification internals (test that your auth dependency accepts valid tokens and rejects invalid ones)
- Third-party library internals (test your integration, not the library)

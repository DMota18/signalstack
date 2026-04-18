# SignalStack — Claude Code Standards

## System Architecture
- Backend: FastAPI (Python 3.11+), Supabase (PostgreSQL), Redis, Celery
- Frontend: React PWA with service worker for push notifications
- Intelligence Engine: Claude API with agentic loop, 6 specialist subagents (hub-and-spoke)
- Data Providers: Polymarket (Gamma API), Finnhub, FRED, SEC EDGAR, SnapTrade
- Auth: Supabase Auth (JWT) with server-side verification in FastAPI
- Encryption: Application-level Fernet for SnapTrade tokens — database stores ciphertext only

## Agentic Loop Rules
- The ONLY valid loop termination signal is `stop_reason`. No exceptions.
- `stop_reason == "tool_use"` → execute the tool, append tool_result, send again
- `stop_reason == "end_turn"` → return the final response
- NEVER parse natural language to determine when the loop should stop
- NEVER use arbitrary iteration caps as the primary stopping condition (25-iteration safety cap is fine as a backstop)
- NEVER check `response.content[0].type == "text"` as a completion signal
- Model decides WHICH tools to call and in WHAT ORDER (model-driven)
- Business rules involving compliance, financial data, or disclaimers are enforced PROGRAMMATICALLY via hooks — never trusted to prompt compliance alone

## Hub-and-Spoke Agent Architecture
- Coordinator receives user context and dispatches to 6 specialist subagents
- Subagents: Sentiment, Polymarket, Insider, Institutional Flow, Macro, Profile
- Subagents do NOT inherit the coordinator's conversation history
- Subagents do NOT share memory with each other
- Every piece of context a subagent needs must be explicitly passed in its prompt
- Subagents return structured JSON (not prose) back to the coordinator
- 4-5 tools per agent maximum — more than that degrades selection reliability
- Never ask a single agent to analyze more than 10 tickers at once; batch into groups of 5-8

## Code Conventions
- All API endpoints return the standard envelope: `{"status": "ok"|"error", "data": ..., "error": ...}`
- All tool implementations follow the 4-category error pattern (transient/validation/business/permission)
- Financial data is always normalized via `services/hooks.py` before entering the agentic loop
- Every user-facing output includes the compliance disclaimer — injected by the output interceptor, not by the model
- Type hints required on all function signatures
- Docstrings required on all public functions
- Use async/await for all I/O operations
- Import order: stdlib → third-party → local

## File Structure
- `backend/api/` — FastAPI route handlers
- `backend/agents/` — Coordinator and subagent definitions
- `backend/tools/` — MCP tool implementations
- `backend/models/` — Pydantic schemas for request/response validation
- `backend/services/` — Business logic (auth, context, hooks, case_facts, supabase)
- `backend/jobs/` — Celery tasks and scheduling
- `backend/middleware/` — Rate limiting, CORS, request logging
- `frontend/src/` — React PWA source
- `tests/` — Mirrors backend structure

## Hooks Pipeline (Programmatic Enforcement)
- Pre-execution hooks block trade tools entirely, gate features by tier, require investor profile for idea generation
- Post-execution hooks normalize timestamps (ISO 8601), sanitize financial data, redact PII, inject compliance metadata
- Output interceptor scans for advice language ("buy", "sell", "you should", "I recommend") and blocks the response for reformulation
- Disclaimer is appended by the hook, NEVER by the model
- Position concentration > 25% is flagged automatically by the hooks, not dependent on the model noticing
- If consequences involve financial data, compliance, or user-facing alerts → programmatic enforcement
- If it's tone, formatting, or analytical depth → prompt guidance is acceptable

## Context Management
- Case Facts Block is built fresh from `user_case_facts` view and injected at TOP of every coordinator prompt
- Synthesis instructions and schema go at END of every prompt (primacy/recency placement)
- Tool results and subagent outputs go in the MIDDLE
- Scheduled jobs always start fresh sessions — never resume stale sessions (holdings and prices change)
- Real-time alerts fork from base portfolio context, then discard the fork after sending

## Error Handling
- Four error categories: transient (retry), validation (fix input), business (adjust approach), permission (resolve access)
- Empty results from valid operations are BUSINESS errors, not failures (e.g., no Polymarket markets for a ticker)
- Failed API connections are TRANSIENT errors — always retryable
- Job runs track per-subagent status in `agent_results` JSONB: 5/5 = completed, 3-4/5 = partial, 0/5 = failed
- Graceful degradation: always produce output even when signal dimensions fail, noting gaps explicitly

## Security
- Never log raw brokerage credentials, SnapTrade tokens, or full portfolio values
- SnapTrade tokens encrypted with Fernet before storage — database stores ciphertext only
- Supabase JWT verified server-side via PyJWT with the JWT secret
- Rate limiting enforced per-user by tier (20/60/120 req/min for free/pro/premium)
- Row-level security on all user-data tables — users see only their own rows
- Service role used only for backend system operations (alerts, jobs, sync, cache)

## Testing
- All tools must have integration tests that mock external APIs
- Agent tests verify stop_reason handling and error propagation
- Compliance tests verify disclaimer insertion on every output path
- Every test file must test both success and all 4 error categories
- Use pytest with async support (pytest-asyncio)
- Name pattern: `test_{module}_{function}_{scenario}`

## Rate Limits
- Finnhub: 60 calls/min (free tier)
- Polymarket Gamma API: 1000 calls/hr (free, no auth)
- FRED: 120 calls/min (free)
- SEC EDGAR: no formal limit (be respectful — 10 req/sec max)
- Claude API: scale with tier — track tokens_used and estimated_cost_usd per job run
- All external API calls retry on 429 with exponential backoff (5s, 15s, 30s)

## Path-Specific Rules
@import .claude/rules/backend.md
@import .claude/rules/frontend.md
@import .claude/rules/tools.md
@import .claude/rules/tests.md

## What Does NOT Go Here
- Full intelligence pipeline execution logic → lives in `backend/agents/`
- MCP tool implementations → lives in `backend/tools/`
- Prompt templates and few-shot examples → lives in `backend/agents/prompts/`
- Database migrations → lives in `migrations/`
- Codebase investigation before major changes → use plan mode

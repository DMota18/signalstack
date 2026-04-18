# Tool Rules (applies to backend/tools/**/*.py)

## Tool Description Quality
- Every tool function must have a docstring that matches its MCP tool description exactly
- Descriptions must include: what it does (1 sentence), input format, example queries (2-3), and a "Do NOT use for" boundary clause
- The "Do NOT use for" clause prevents misrouting between similar tools — this is non-negotiable
- If two tools could plausibly handle the same query, the boundary clauses must explicitly resolve the ambiguity

## Input Validation
- Tool inputs must be validated with Pydantic models before any API call
- Invalid inputs return a VALIDATION category ToolError immediately — no API call attempted
- Ticker symbols are uppercased and stripped of whitespace before processing
- Date inputs are validated and normalized to ISO 8601 before use

## External API Calls
- All external API calls must have a timeout (30s default)
- All external API calls must have retry logic (3 attempts with exponential backoff)
- Rate limit awareness: check remaining quota before calling (where the API provides this info)
- Never make more than one API call per tool invocation without explicit justification

## Error Responses
- Structured error responses only — never return raw exception strings or stack traces
- Use the factory functions: `transient_error()`, `validation_error()`, `business_error()`, `permission_error()`
- Empty results from valid queries are BUSINESS errors, not failures (e.g., "no Polymarket markets found for MTPLF")
- API timeouts and 429s are TRANSIENT errors — always retryable
- Authentication failures are PERMISSION errors
- The error must include enough context for the coordinator to decide: retry, skip, or surface to user

## Provider-Specific Rules

### Polymarket (Gamma API)
- Base URL: `https://gamma-api.polymarket.com`
- No authentication required
- Rate limit: 1000 calls/hr — cache results in polymarket_cache table
- Outcome prices directly equal implied probabilities (no transformation needed)
- Always filter by `active=true` to exclude resolved markets
- When matching holdings to markets: search by ticker, company name, AND related industry terms

### Finnhub
- Rate limit: 60 calls/min on free tier
- API key required in header: `X-Finnhub-Token`
- Insider trades: filter for meaningful activity (large open-market purchases, cluster buying) — not every Form 4 filing
- News: use configurable lookback period, default 7 days
- Empty news results are business-category (ticker exists but no coverage), not errors

### FRED
- Rate limit: 120 calls/min
- API key in query parameter: `api_key`
- Filter out missing/null values from series data before returning
- Series IDs must be provided in the tool description — Claude cannot guess them

### SEC EDGAR
- No formal rate limit but be respectful (max 10 req/sec)
- Set User-Agent header to identify the application (SEC requires this)
- 13F filings: focus on major funds (Bridgewater, Renaissance, Berkshire, Citadel) for user relevance
- EdgarTools library for Python access (free, open-source)

### SnapTrade
- Per-connection rate limits
- Tokens decrypted at runtime via Fernet — never logged, never passed to Claude
- Holdings data normalized through post-execution hook before entering the agentic loop
- Account numbers and PII redacted by the hooks pipeline

## Tool Distribution
- 4-5 tools per agent maximum
- Each subagent only sees tools relevant to its job
- The coordinator has exactly 6 tools — one Task invocation per subagent
- Legacy v1 tools (get_stock_quote, get_crypto_data, etc.) are mapped to the new MCP server architecture but retain their existing error handling patterns

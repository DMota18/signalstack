# Engineering Retrospective

This is the honest companion to the [README](./README.md). The README says what SignalStack *does*; this says how the running code actually lines up with the design it was built to — where they match, where they diverge, which divergences are deliberate trade-offs and which were bugs, and what I'd do differently if I built it again.

I'd rather a reader see the real state of the edges than a glossy version that falls apart under one good question in an interview. Everything below is written from the code as it stands.

---

## Where the code came from

SignalStack started as a working but rough build — the feature set was real and the app ran, but the repository around it wasn't something I'd want a stranger judging me on. A hardening pass turned it into what's here now. That pass is worth describing because the *gap between "it works on my machine" and "someone else can trust it"* is most of what this project taught me.

The starting state had the kinds of problems that don't show up in a demo but scream at a reviewer:

- The `.gitignore` was saved in the wrong text encoding, so none of its patterns actually matched — it silently protected nothing.
- The initial database migration was missing entirely; the schema only existed in a database I no longer had.
- The test suite couldn't run from a fresh clone — it needed configuration that only lived on my machine.
- There was no CI, no linter config, and the product was referred to by two different names across the files.

None of that is visible in a screenshot. All of it is visible in the first thirty seconds of a hiring manager reading the repo. Fixing it was the point.

---

## Design vs. reality, subsystem by subsystem

### The agentic loop — matches the design

The core loop does exactly what it's supposed to. Termination is driven **only** by the Claude API's `stop_reason` — `tool_use` means execute the tool and loop, `end_turn` means return. There is no natural-language parsing to decide when to stop, and the 25-iteration cap is a backstop, not the primary control. This was a design rule I held to strictly because it's the single most common way agent loops go subtly wrong: people start pattern-matching on the text of a response to decide it's "done," and then one unusual phrasing breaks the whole thing. Keeping the loop honest here is the part of the codebase I'm most confident in.

### The compliance layer — matches now, but didn't at first (the most important fix)

The design promise is strong: financial-advice language is caught by code, not by asking the model nicely, and a disclaimer is appended by a hook rather than by the model. The intent was that **every** delivery path — the REST endpoint, the live browser stream, and the scheduled email/push jobs — passes through one pipeline, so none of them can skip the compliance step.

The reality, before hardening, did **not** hold that promise. The live-streaming (SSE) path had its own separate implementation — a couple hundred lines that duplicated the pipeline logic and, critically, *didn't run the advice-language interceptor*. So the exact surface a user was most likely to see — the real-time report streaming into their browser — was the one that could emit un-screened text. The compliance story was true for the batch paths and false for the interactive one.

The fix was to collapse everything onto a single event-generating pipeline core, and make the SSE endpoint a thin adapter that drains those same events. Now there is genuinely one path, and the interceptor runs on all of them. This is the clearest example in the project of a gap between "the architecture diagram is correct" and "the code matches the diagram" — and it's exactly the kind of gap that only shows up when you go looking honestly.

### The six agents — two are deliberately incomplete

This is the honest core of the "what's real" question:

- **Sentiment, Institutional (13F), Macro, and Profile** are functional. They call their providers, handle the four error categories, return structured JSON, and degrade to a reported gap when a provider is empty or down.
- **Polymarket (prediction markets)** is **partially implemented.** The market-to-holding matching works — it finds active markets by ticker, company, and industry, and a background job keeps a local catalog fresh so the app does fast DB lookups instead of live searches. What's not finished is the breadth of the matching heuristics: it misses markets whose wording doesn't line up with the keyword rules. It's genuinely useful, not a stub, but it's not complete.
- **Insider** is **in development.** The SEC EDGAR plumbing and the tool contracts are in place, but the Form 4 parsing that separates *meaningful* insider activity (large open-market buys, cluster buying) from routine noise (scheduled sales, option exercises) isn't finished. Right now it returns fewer, less-refined signals than it eventually should.

The design decision I'm comfortable with is that **neither of these fails loudly or lies.** When a dimension is thin, the synthesis says so explicitly rather than papering over it. Graceful degradation was built in from the start, and it's what makes shipping with two incomplete agents defensible instead of embarrassing — the system tells the truth about its own coverage.

### Rate limiting — correct, but single-instance

The per-tier rate limiter works and returns a proper `429` with the right envelope. But it's an **in-process** sliding window: the counters live in the memory of one API process. That's correct for a single instance and it's what's deployed, but if this ran on more than one instance behind a load balancer, each instance would count independently and the effective limit would multiply by the instance count. The right fix is to move the counters into Redis (which is already in the stack as the Celery broker). I left it in-process on purpose — it's the honest scope for a single-box deployment — but it's a known ceiling, not something I'd claim is production-scale as written.

### Cost control — the hard cap is real; the model fallback is only partial

The per-user daily spend cap is real and hard: it tracks the true input/output token split per run, records estimated cost, serves cached intelligence once the cap is hit, and resets at midnight UTC. This is the kind of guardrail that's boring until the day it isn't, and building it in early meant "a bug causes a runaway loop" has a financial ceiling by construction rather than by hoping.

The one piece that's weaker than it sounds is the cheaper-model fallback. In the 70–100%-of-cap band the system is supposed to "fall back to Haiku," but in the code the model override is only threaded into the **final synthesis call** — the six subagents always run on the primary model. Since the bulk of the tokens are in the subagent fan-out, switching only synthesis is a partial lever, not the broad cost reduction the phrase implies. It's honest to call this a half-finished feature: the hard ceiling (cache + cap) is what actually bounds spend; the model downgrade barely moves the needle as wired. Extending the override to the subagents (or pricing each call at the model it actually ran on) is the real fix.

### PII redaction — improved, but still coupled to the wrong path

The redactor got better during hardening: the aggressive numeric scrub (which blanks 8–16 digit strings as possible account numbers) is now scoped to brokerage tools only, so market caps, volumes, and millisecond timestamps in market-data results are no longer mangled. But two holes from the original design are still open, and I'd rather name them than imply blanket coverage:

- **No named-entity recognition.** A name is redacted only if it sits in a known key (`full_name`, `legal_name`, and friends). A name embedded in free text isn't caught. There's a genuine tension here — full NER would wrongly redact the *public* insider and fund names (Jensen Huang, Berkshire) the product exists to report — but the gap for the user's own PII is real.
- **The brokerage *ingestion* path doesn't go through the redactor at all.** Redaction runs inside the agentic loop's post-execution hook, on tool results. But the production holdings sync (`sync_user_holdings`) calls the SnapTrade API directly and writes to the database without touching that hook. It's saved today only because the parser hand-picks a fixed allowlist of non-PII fields (ticker, quantity, price, market value) — so no PII actually reaches the database — but that's "safe by what it happens to select," not "safe by redaction." Add one name-bearing field to that parser and there's no backstop. The right fix is to route brokerage ingestion through the same redaction pass the tool path uses, so the guarantee doesn't depend on the parser's field list.

---

## Bugs the hardening pass surfaced

A few of these are worth naming because they're the kind you only catch by actually trying to run things from clean, not by reading the code:

- **A latent `NameError` in a tool's error path** — an error-factory function was used but never imported. It would have thrown the moment that error branch was hit, which tests hadn't exercised. A linter caught it in one pass; it had been sitting in the code invisibly.
- **An SSE frame-splitting bug in the frontend.** The stream parser kept its in-progress event state *inside* the per-chunk read callback, so an event that happened to straddle a network chunk boundary was silently dropped. It only reproduced under specific chunking, which is exactly why it survived casual testing. Writing a test that deliberately splits a frame across chunks exposed it.
- **The typed-client migration flushed out several real frontend bugs.** Replacing loose `any`-typed API responses with real types turned "this compiles" into "this is actually shaped the way the code assumes" — and it wasn't, in a few places (an object being fed into array state, an un-narrowed union being read as if it were one branch). The type system found bugs that had been latent.
- **A stale test that mocked an old API shape.** One test was passing against a data shape the provider no longer returned — a green check that was lying. Updating the mock to the real nested shape made the test meaningful again.

The theme across all of these: **most of them were invisible in the happy path and only appeared when I made the project runnable, typed, and linted from a clean slate.** That's the argument for doing that work at all.

---

## What I'd build differently

- **Move rate-limit counters to Redis from day one.** It's not more work up front and it removes the single-instance ceiling entirely. I know exactly where this bites; I'd just do it.
- **One pipeline core from the start.** The duplicated SSE path was the source of the worst gap in the project. If I'd built the event-generator core first and made *every* entry point (REST, SSE, jobs) an adapter over it from the beginning, that compliance gap could never have existed. The lesson is to build the shared spine before the surfaces, not to grow surfaces and unify them later.
- **Finish one incomplete agent fully before starting the next.** Having two agents partially done (Polymarket and Insider) is a weaker story than having five fully done and one untouched. Depth-first would have read better and been easier to reason about.
- **Make the model fallback cover the whole run.** Right now the Haiku downgrade only touches the synthesis call, so it barely dents cost. Either thread the override through the subagents too, or price each call at the model it actually ran on so the accounting stays honest when the fallback engages.

- **Route brokerage ingestion through the redactor.** PII redaction is coupled to the agentic-loop tool path, but the real holdings sync writes to the database directly and skips it. The guarantee shouldn't depend on the sync parser happening to select only safe fields.

- **Prompt caching on the shared context block.** The Case Facts block is rebuilt and re-sent for each of the six agents in the fan-out. Caching that shared prefix is the obvious next Claude cost win and I'd wire it in earlier.
- **Type the whole frontend, not just the hot pages.** The typed API client caught real bugs; the remaining `any` usages are tracked as visible lint warnings rather than suppressed, but "tracked debt" is still debt. I'd pay it down rather than schedule it.

---

## What I'm proud of

- The agentic loop is disciplined in the way that actually matters — `stop_reason`-driven, no text-parsing shortcuts.
- Compliance is enforced in code and now genuinely covers every delivery path, including the one it used to miss.
- The system tells the truth about its own coverage: incomplete dimensions are reported as gaps, not hidden.
- The repository is something a stranger can clone, run the tests on, read the CI for, and trust — which is a different and harder bar than "it works on my machine."

The honest summary: the *features* were the easy 80%. The last 20% — making the compliance promise true on every path, making the project reproducible from a clean clone, and being willing to write down exactly where the seams are — is the part that turned it from a demo into something I'd hand to a hiring manager.

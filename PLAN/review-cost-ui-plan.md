# Task7.2 — cost/TUI evidence map and remaining verification

## Starting point

Task7.1 is accepted; production source matches candidate110 manifest `139d9151d029ce089fba93e4ab5cb59fb4675e7394f39db3b1cb3baf5dcd1445`. This map prepares task7.2, not its acceptance. No new test was run while mapping. Real-model task1.4 remains separately spending/sample gated.

Fresh writer full-suite evidence for this exact code: `/var/tmp/hermes-71-findings-repair-WPGBFu/logs/07-full.*`,402 passed. Parent/independent task7.1 focused evidence is separate; see `PLAN/shared-review-evidence.md`. Reuse source-relevant observations, not totals alone. Any later production change invalidates affected evidence.

## Existing coverage and limits

| Task7.2 behavior | Existing source/evidence | Limit to respect |
| --- | --- | --- |
| changed/no-change, empty/reasoning-only/invalid/tool response, quotas | `test/review-outcomes.test.ts`; `test/learning-slice.test.ts`; fresh402 log | Real production request/store/ledger path, but not a complete real-PTY outcome matrix. Some inherited options assertions live inside faux callbacks; new observations must capture then assert outside. |
| unknown price/raw usage/cache and visible costs | learning slice, ledger/recovery suites, `src/review-display.ts`;2.4 evidence | Distinguish SDK/model estimates, known subtotal and unknown actuals; never infer remote invoice accuracy. |
| cancel, late usage, explicit recovery, no UI, stale confirmation | `review-recovery-controls`, `review-accounting-fault`, `review-confirmation`, `review-controls`, new coordination regressions | Production SDK controls are covered; UI bindings/formatting assertions are not automatically real terminal evidence. |
| concurrent ownership and killed owner debt | `test/review-ledger.test.ts:19–59` | Two actual child processes reserve through ReviewLedger; killed child does NOT first submit a production provider request. Ledger proof alone is not submitted-request crash/restart proof. |
| persistent real terminal failure through foreground/reload | `test/review-tui.test.ts`; fresh402 log has pass | Official0.99.2 `InteractiveMode` in Linux PTY, isolated HOME/agentDir. It drives MANUAL `/hermes-review run` and an error completion. Not automatic-settled failure/unknown-cost PTY proof. |
| OFF during compaction/reload/shutdown, manual/read functions remain | `PLAN/review-cancellation-evidence.md`, original6.4 OFF probes; schedule/coordination controls | Old6.4 evidence predates7.1 source edits. Reuse narrow OFF cases on final code as needed, not all historic invalidation suites. Separate explicit native compaction2/1/0 calls from plugin auxiliary calls. |
| stream failure | outcomes uses returned error terminal; timeout holds completion until abort | Reviewed sources do not establish a genuine partial/progress-then-broken stream. Do not rename an ordinary error completion as a disconnect. |

## Bounded completion work

1. Demonstrate an actual production auxiliary dispatch in an isolated child before killing it; restart with the same synthetic ledger/session scope. Unknown charge/reservation and pause must survive, no replay or new auxiliary request, status/usage/error surface must agree. Existing reservation-only process test remains useful but separate.
2. Exercise stream interruption through the pinned public provider/stream seam, with captured dispatch/progress and known-partial or unknown usage. Preserve raw/cache/reasoning fields, exactly-once settlement, no hidden second call and no unauthorized save. If public API cannot establish the intended precondition, report that limitation rather than fake it or patch SDK internals.
3. Extend real stock-Pi PTY evidence to automatic-settled background outcomes visible alongside ordinary foreground activity and after reload. Correlate visible status/usage with durable request IDs and actual provider counts. Reuse the small existing Python standard-library driver; avoid a new UI framework. Combine with crash/unknown case when it proves both honestly.
4. Map every requested changed/no-change/invalid/disconnect/unknown/crash/cancel/reload/OFF-compaction/exit row to concrete current evidence. Add only missing cross-layer observations; do not run an unbounded Cartesian product. No production change is presumed necessary.

Original failures and assertions remain preserved. New native fixtures require successful foreground terminals, captured options/call counts and assertions outside provider callbacks. Retain raw terminal/capture/ledger evidence before temporary fixture cleanup. No paid provider, personal config/memory migration, companion edit or external backend is involved.

## Tool/source freshness

Code graph is indexed2026-10-01; targeted display/ledger/TUI/outcomes paths are `not_tracked`. Direct current source is authoritative; no reindex/reconfiguration performed. Serena literal source lookup identified the PTY seam. Current matched tests and fresh log records were inspected, not taken as task completion solely from names/counts.

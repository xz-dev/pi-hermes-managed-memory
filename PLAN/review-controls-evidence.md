# Task 2.4 — persistent review controls evidence

## Verification gate (functional review closed)

Reviewer `396e7ca9-1321-407f-9e53-2cb21aa645d0` approved closure of the sole implementation blocker, independently ran the focused Node test (1/1) and typecheck, and inspected the parent full/negative gates. Report: Pi session artifact `subagent-artifacts/outputs/396e7ca9-1321-407f-9e53-2cb21aa645d0/review/2.4-fault-closure.md`. Review did not independently rerun the entire suite or attest real providers.

- `npm run check`: exit 0.
- `npm test`: 57/57 passed, zero failures.
- Current gate logs: `/var/tmp/hermes-fault-gate-gjJBTi/{focused,check,full}.log`.
- Intentional-break proof: `/var/tmp/hermes-fault-negative-nQMRYs/negative.log`; removing only the local fault display gate reproduces `manual ready; errors 0` and fails the new behavioral check. The repair was restored before the final gate.
- This gate includes all 35 prior tests, not a replacement of the learning slice.

## Delivered behavior and evidence

| Behavior | Implementation | Verification |
| --- | --- | --- |
| Separate persistent status/widget; running model/time, recent result, UTC budget, held/unknown amounts, cache and effective limits | `src/review-display.ts`, session lifecycle in `src/index.ts` | `test/review-controls.test.ts`; stock `Text` narrow-width rendering; `test/review-tui.test.ts` runs the official 0.99.2 public `InteractiveMode` runtime in a real Linux PTY |
| Failure visible during normal foreground answers and after reload; ledger-unavailable warnings survive reload | independent `hermes-review` key, disk reconstruction and refresh | SDK command/UI-binding and PTY foreground/reload tests; corrupt-ledger test confirms no extra review call |
| Status/usage/errors/pause/resume/cancel/retry; automation remains off | production `/hermes-review` command | controls, confirmation, recovery-controls and outcomes tests |
| Explicit recovery: original day/raw/prior usage preserved; full reservation is one confirmation-day budget debit; actual usage remains unknown; no replay/refund | ledger booking under lock, common admission/overview debit function | same/cross-day recovery, repeated confirmation/reload, late complete/partial telemetry, normal next-day budget tests |
| Recovery refuses rollback and live owners; only exact inspected state can be acknowledged | UTC watermark, live lease check, ledger/limits/day/fault fingerprint | recovery, confirmation and SDK controls tests; capture one booking timestamp and checked fault value so later faults aren't acknowledged by rereading them |
| Retry binds prior record and generation/session/project/leaf/current snapshot/model/memory versions/limits; bypasses only selected duplicate | shared `MemoryReview.prepare`, pre-dispatch stamp check and locked admission | real SDK command tests for one new request, unchanged main file/leaf, context/model change, new fault, duplicate guard and quota rejection |
| Declined/unavailable/headless confirmation cannot book, resume or dispatch | public `ctx.ui.confirm`; structured confirmation-required when unavailable | production handler tests, including headless and RPC UI bindings |
| Cancel/pause remain durable, retain charges/unknowns and never implicitly retry | generation/AbortSignal plus persisted pause and request state | recovery-controls and prior timeout/outcome tests |
| Late usage/errors don't disappear; complete or partial overrun re-pauses without a second debit | persisted fault history and acknowledgements; raw subset lower-bound checks | both terminal/late settlement paths, partial reasoning overshoot, fault/reload tests |
| Main and auxiliary quantities remain separate with explicit known-subtotal scopes and unknown-price counts | `usageDetail`; native active-branch usage versus current-session auxiliary records | usage inspection tests; displayed totals are estimates/known subtotals, not complete provider invoices |

## Operation

Use `/hermes-review status`, `usage` or `errors` to inspect. `pause` and `cancel` stop/invalidate local work without claiming the provider charged nothing. `resume` previews debt and asks for confirmation. `retry [request-id]` previews the old result, new model/reservation and allowance and asks for a NEW bounded request. If the displayed state changes, preview again. Print/JSON can inspect durable structured results but cannot substitute command presence for consent; use a working public TUI/RPC confirmation UI to recover/retry.

A confirmed unknown request consumes its complete old reservation on that UTC day, once. Its actual usage can still be unknown. Next normal UTC day refreshes allowance; rollback is refused. Late telemetry preserves history and does not silently refund the booking; overshoot pauses again.

## Boundaries

- PTY evidence is from official npm 0.99.2 public exports, not the installed downstream Pi CLI. Python is an existing standard-library-only isolated PTY driver, with fixture cwd/HOME; no dependency or system installation.
- SDK discovery, credentials, settings, sessions and provider calls remain isolated/faux. No personal installation/config mutation, migration, Git staging/commit/push, remote memory adapter or real provider experiment.
- Real-model task 1.4 remains unexecuted pending separate spending and sanitized-snapshot approval. This proves host controls, not extraction quality, actual invoices or remote enforcement.
- Known accounting failure also fences the current process when both telemetry and fault writes fail. A process-local, path-keyed pending report survives new ledger instances/module reload; display remains paused after reads succeed. Restored writes persist the error and retry only local telemetry settlement (never the provider); the normal explicit inspection/confirmation still gates new paid requests. `test/review-accounting-fault.test.ts` covers cancellation, unknown booking, both failed writes, read success/reload, restored writes, declined retry and explicit recovery. No process can promise crash durability while all persistence is physically impossible.
- Companion contract copy is outside this repo-local edit scope and remains untouched. Synchronization/compatibility, full dispatch/kill/dual-consumer matrix and implementation/OMD links remain tasks 7.1–7.3.

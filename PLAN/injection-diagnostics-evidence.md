# Task 4.4 — independently accepted diagnostics

## Authority and scope

Repo-local `add-managed-memory-lifecycle`, task 4.4 and memory-context “Explain what was used” / “Injection budget too small”; inherited 3.4 and 4.1–4.3 fences remain controlling. CLI current receipt: `/var/tmp/hermes-44-current-gate-MBaTXc/apply.json`, ready 14/26. Task 4.4 was checked only after same-reviewer closure and parent exact-candidate verification below; the cited CLI receipt records its earlier ready 14/26 state.

The candidate adds render metadata to `src/memory-store.ts`, last-owned-boundary metadata to `src/memory-context.ts`, and diagnostic fields to existing `/hermes-memory inspect|refresh` in `src/index.ts`. No new model, storage, accounting, SDK, constraint-state, or command framework. Target disk versions and raw-file scalar sizes are separate from `projection.working` and the locally based/projected selection. `based` and `projected` are local ownership boundaries, not provider submission receipts. A live gate refusal is reported separately from the retained last projection. Stale/unavailable state is not an inclusion or wire-delivery claim.

Worker baseline/deltas/claims: `/var/tmp/hermes-44-worker-T8SWfK/`; producer report: run `b283aae5-a6ff-4dc4-80ca-ff06125ac340`, `implementation/4.4-injection-diagnostics.md`. Producer's 175/175 is historical; current candidate includes three additional parent integrity cases.

## Historical pre-review executable evidence

Parent gates after the latest integrity-test edit: `/var/tmp/hermes-44-current-gate-MBaTXc/`:
- `check.log`: `npm run check`, exit 0.
- `diagnostics.log`: diagnostic and diagnostic-integrity suites, 9/9.
- `full.log`: `npm test`, 178/178, no failing tests.

Finite contract map:
- Actual SDK owned block versus diagnostic scalar counts, source locators and target versions: diagnostic test 1; integrity tests 2–3.
- Whole-entry omission, no auxiliary model request, disk byte preservation: diagnostic test 2; integrity test 1 additionally uses a freshly externally written oversized Unicode file rather than an ordinary admitted save.
- Body privacy in diagnostic/summary fields: diagnostic tests 1–2 and 5–6, all three integrity cases. Existing explicit selected destructive previews are not ordinary diagnostic summaries.
- Inspection cannot establish a new projection: diagnostic test 2; integrity test 2 changes disk after a successful request and verifies latest disk version differs from the retained working/request version with unchanged injection metadata and no provider call.
- Unavailable/read fault and constraint-capacity refusal: diagnostic tests 3–4, with actual provider call counts and native branch checks outside callbacks. A gate refusal does not erase historical projection identity or fabricate a new submission.
- Refresh versus dispatch and no-new-user native compaction: diagnostic test 5; integrity test 3 captures both actual main requests, checks the second version/scalar count, retained projected key, safe metadata and exactly two main calls.
- Current inherited gates: full 178 includes lifecycle, provenance, owned-slot recognition, read fences, scope/branch restoration, compaction cancellation, native constraint ownership/origins/retired versions and mandatory dispatch blocking.

## Failure history and harness correction

`/var/tmp/hermes-44-parent-integrity-UryJpd/integrity.log` initially passed 2/3 but expected the final diagnostic state to be `projected`. The stock runtime can perform a final **local** compaction after the last response, leaving a legitimate `based` boundary with no further provider request. The latest test accepts `based` or `projected`, while still requiring native successful completion, exactly two captured requests, the second request's exact slot size/version, and the retained projected key to equal the working key. It does not accept a third/fabricated submission or a mismatching projection. No product source was changed for this harness correction.

The latest test bytes were independently reconstructed from original session tool entries `a33b82f9` and `6fb14fb5`, through the original successful edit. Current `test/injection-diagnostics-integrity.test.ts` is byte-identical to that recovered state, SHA-256 `44c87454fcd224d42ecb85a53004ae567664062ad284dcce7dceef2492993168`. Parent rerun above is post-edit evidence, not reliance on the edit result.

## Independent findings and repaired candidate

Reviewer `66ddff04-64b2-4b3a-b79d-35e86b58a8b0` rejected the exact 74-file candidate with three reachable diagnostic gaps. Parent verified all 74 hashes unchanged and reproduced the four adverse cases (missing covered twice), 0/4, at `/var/tmp/hermes-44-findings-parent-5n09HO/repro.log`. The pre-review 9/178 totals did not prove the complete external contract.

Narrow repairs:
- `src/index.ts`: ordinary `inspect` emits pending IDs, stamps, target/base/staged/stale and change IDs/kinds, excluding diffs and arbitrary free-text reason/summary. The existing explicit `pending` preview and selected destructive confirmation retain actual diffs. Refresh also reports the live constraint gate separately from a local rebase.
- `src/memory-store.ts`: `read()` preserves physical presence as metadata and adds `missing-file` for absence; raw empty-content hashes, journal, mutation and eligibility policy remain unchanged. The optional snapshot field avoids inventing presence for internal mutation snapshots.
- Renderer mandatory-overflow branch renders no block but retains every whole fact's ID/target/source/line size and reason `constraint-budget`; lifecycle-blocked/tombstoned entries retain their more specific reasons. No budget increase, extra call, file shortening or active-state mutation.

Durable regression file `test/injection-diagnostics-findings.test.ts` has five checks: complete ordinary RPC and non-TUI JSON output privacy (including pending reason canaries), explicit pending preview preserved, absent versus deliberately empty file/no-write inspection, deletion versus historical request projection, and native exact constraint cap versus one-less cap with whole-fact omission, live refresh/inspect gate and zero further dispatch. The output capture replaces only the public stdout sink, not SDK behavior.

Current repaired parent gates beneath `/var/tmp/hermes-44-findings-parent-5n09HO/`:
- `current-check.log`: typecheck exit 0. An earlier required presence field failed at the internal approval snapshot; making diagnostic presence optional kept that mutation path unchanged.
- `closure-tests.log`: new regressions 5/5.
- `diagnostics-current.log`: all diagnostics 14/14.
- `adverse.log`: original independent scratch checks 10/10 without changed assertions.
- `full-current.log`: current full suite 183/183, exit 0.

Repair scope versus reviewed 74: only `src/index.ts`, `src/memory-store.ts`, this evidence/plan record and the new findings test. Memory-context, constraint state, ledger, review engine, SDK fixture, dependencies, OpenSpec authorities and tasks are unchanged. Same-reviewer functional closure and unchanged repaired hashes remain required before checking 4.4.

## Independent acceptance

Same reviewer resumed as `3bf739ee-32f9-416a-abec-3ba403533af1` and approved the exact repaired 75-file candidate with explicit residual risk, no remaining blockers. All three findings closed; independent typecheck, new 5, diagnostic 14, unchanged original 10 + focused 4, inherited 123, full 183 and extra interaction 2 passed. Closure report: `subagent-artifacts/outputs/66ddff04-64b2-4b3a-b79d-35e86b58a8b0/review/4.4-injection-diagnostics.md`; historical rejection preserved at `/var/tmp/hermes-44-closure-review-g0WGm1/historical-rejection.md`. Closure receipts/logs are in that same scratch root.

Parent independently verified all 75 accepted hashes unchanged and exact manifest SHA-256 `04fde709753188bbeadafb71e84849db95ee4c7048bc97e5da258e727e9111b7` before checking 4.4. Receipt: `/var/tmp/hermes-44-findings-parent-5n09HO/parent-acceptance-hashes.json`. Only task/evidence/plan acceptance-status records were updated afterward; no executable candidate changed. Approval covers this task and exact tested behavior, not later tasks or real-model quality.

## Limits and acceptance boundary

Faux native SDK tests prove mechanics only, not real model usefulness, billing, or provider-internal enforcement. No real-provider approval or sanitized snapshots were obtained for 1.4. Accepted 4.3 ancestry availability/performance and local durability limits remain unchanged. Missing/foreign slots cannot be called verified owned injection merely because a desired working render exists. Reviewer must validate the full current 4.4 contract, not infer acceptance from producer or parent green totals. Parent checked the task only after the above independent approval and unchanged-hash verification.

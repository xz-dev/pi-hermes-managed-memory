# Task 6.2 — user-work counting and settled review

## Scope and source

Continue repo-local `add-managed-memory-lifecycle`, ready19/26 after accepted6.1 (`PLAN/foreground-memory-evidence.md`, frozen103b5dbc). This slice connects automatic scheduling to the existing single-request review; it does not complete6.3/6.4/7.x or authorize1.4 real-provider evaluation.

Existing agreed rules: designD6 and `docs/review-contract.md` R1/R3/R6. Default memory cadence is10 user turns, separate from tool-bearing assistant activity. Hermes234badf `agent/turn_context.py:710–727,1078–1085` hydrates user-role history and ticks memory once in the user-turn prologue, not once per tool loop. Official Pi0.99.2 `agent_settled` is the final notification boundary after retries, compaction and queued continuations; `agent_end` is not equivalent. Public `getBranch()` supplies native identities; `buildSessionProjection()` supplies compaction/context-edit-aware review content. Local counting of native IDs/roles must not restore old bodies into the model payload.

Parent already read current seven CLI contextFiles (receipt `/var/tmp/hermes-62-start-Z8XbiE/apply.json`), current index/review/display code, public SDK/extensions/session/message documentation and pinned Hermes counter code. Serena has no active language server; graph reports these source files not tracked. Direct current source is authoritative; no tool reconfiguration needed.

## One coherent implementation seam

One writer owns native work counting, due-state recovery, the settled event binding, review trigger identity and truthful schedule display. Splitting these would create overlapping changes in the same index/review state machine. Reuse `MemoryReview.prepare/run`, `ReviewLedger` admission/settlement and existing public command/UI paths. No second model entry point, store, backend, new dependency or general scheduler framework.

Count distinct genuine native user messages on the selected branch, not converted synthetic user-role summaries/custom messages, tools, duplicate notifications or the independent review's own messages. Track tool-bearing assistant activity separately (one assistant turn, not one tool). Restore branch-sensitive progress without merging sibling branches or trusting an unrelated mutable side database. Use existing native/ledger identities where sufficient; if a native processing marker is necessary it belongs to foreground bookkeeping, never a late background write into main history. No background fork/navigation/leaf movement or review chat insertion.

At the eligible settled boundary capture the current effective snapshot and dispatch once through existing budget/owner/dedup checks. The foreground must not wait for long analysis. Preserve system/tools/thinking, compaction summaries, transformed model-visible context and separate native evidence validation. Stale observations fail visibly rather than falling back to raw history. Own bookkeeping must not create new work or paid duplicate snapshots. Repeated settlement/reload cannot reset cumulative billing or retry a failed job.

Expose actual automation state, cadence/progress and skip/pause reasons instead of hardcoded automatic OFF when enabled. Provide an explicit automatic-off configuration using the existing configuration path; preserve read/recall/foreground/manual controls. Default10 and full-snapshot/same-model/single-request behavior follow the approved contract. No personal configuration is changed. Any unresolved product-default/API conflict must be raised, not silently settled by weakening these rules.

Existing cancellation/generation/version/accounting fences remain active when automatic dispatch is connected. No compaction/shutdown/correction/parse-error paid flush. Do not postpone a safety prerequisite merely because comprehensive6.4 coverage comes later.

## Agreed observable examples

1. Three actual user inputs cause40 actual tool-bearing assistant turns: visible user count3, activity count40, no default memory review. Tool results, summaries and duplicate notifications do not inflate either metric.
2. Nine user turns are not due; the tenth finishes natively and settles: one independent review with trigger=settled, one durable reservation/result and visible usage. Hold the fake review response to prove foreground completion does not await it. Duplicate settled/reload of the same processed work does not submit again.
3. A real native compaction/context edit before eligible settlement: captured review contains current system/tools, summary and retained/effective content, not removed raw-history sentinels or hidden native evidence. Actual native/foreground success and dispatch counts are asserted outside provider callbacks.
4. Current-branch progress survives supported reload and branch selection without sibling contamination; review does not change raw session bytes/leaf after foreground bookkeeping ends.
5. Existing budget exhausted, pause/failure/unknown accounting, disabled automation or unavailable snapshot prevents new submission and remains visible. Existing manual review and foreground saves still work under their own explicit gates.

These are specification-derived acceptance examples, not new model-quality guarantees. Start with one meaningful missing-behavior red through actual SDK extension hooks, then implement and broaden in the existing node:test/sdkFixture style. No new framework, real provider, hidden retry or weakened assertions.

## Ownership and delivery

Allowed product edits: `src/index.ts`, `src/memory-review.ts`, `src/review-display.ts`, a small new `src/review-schedule.ts` if useful, and new `test/review-schedule.test.ts`. `src/review-ledger.ts` may receive only necessary schedule metadata/status/trigger plumbing, not budget/recovery/owner policy changes. A narrowly justified fixture option in `test/sdk-fixture.ts` may isolate existing manual-only fixtures from new automatic defaults while new tests explicitly exercise real defaults; preserve inherited assertions. Any larger surface requires parent approval.

Store/constraints/recall/source validation, other tests, packages, specs, plans, OMD and personal configuration are read-only. No Git staging/commit/branch, other repo edits, installs, network experiments or private/fork imports. Use isolated `/var/tmp` fixtures with HOME/USERPROFILE/agentDir/auth/settings/cwd/session discovery and model networking/retries disabled.

Run focused native scheduling and affected review/foreground/context/accounting tests, typecheck, full suite and strict OpenSpec. Preserve raw red/failures and final command exits. Freeze the final product membership/bytes and return a locatable report normally; ready means parent inspection, not acceptance. Independent review follows parent inspection. Ask through supervisor only for a genuine unresolved decision; no blocking completion handshake.

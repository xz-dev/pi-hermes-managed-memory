# Task 6.4 — cancellation and stale-result acceptance

## Accepted scope

Parent accepted the existing implementation for task6.4 after independent source review and native public-API verification. No production source, package or repository test changes were needed. Hermes token/cancellation/foreground-priority behavior remains the reference; the public Pi0.99.2 adaptation uses generation/AbortSignal/current-runtime guards plus independent store version/epoch validation.

Frozen106-path candidate: `/var/tmp/hermes-64-verification-4NFDsT/candidate/repo`; SHA256 of its sorted path/hash `../manifest.json` bytes: `110b14998312c13fc97e8d419a92ae57d0710b291de1cabeda23cbd63763fa68`. All source/tests/package bytes remain identical to accepted6.3. Differences from that earlier104-path snapshot are only accepted6.3 documentation/checklist and two PLAN files. Acceptance bookkeeping below is not a production change.

## Behavior and evidence

| Existing implementation | Native observation |
|---|---|
| `src/index.ts` current-engine rebinding and input/turn/session/tree/shutdown hooks; `MemoryReview.cancel/run` generation, signal, session/leaf/current-engine/owner checks | A valid held tenth-user review has a positive control saving a supported correction and ordinary additions while staging destructive removal. Input, branch, new session, scope loss, OFF, cancel/pause, reload and runtime shutdown instead cancel before release. An ignored-abort response produces no memory/pending/audit/backup/tombstone/native changes; old usage settles once. |
| Public runtime project transition plus scope checks | Additional real `AgentSessionRuntime.switchSession` A→B case asserts runtime cwd, native header, selected file and `/hermes-memory inspect` resolved project/path B before releasing the old A proposal. Both stores and native files remain unchanged afterwards; one old request/debit, no replay. Original config-only case remains labeled A→unresolved, not A→B. |
| `MemoryStore.mutate/stage` locked snapshot validation | Four nonaborted cases: external version edit or same-byte rollback epoch × mutation or staging. Native branch/session/generation remain unchanged; all return conflict, without rebasing, creating pending or changing authoritative state/audit. This evidence is separate from generation cancellation. |
| ReviewLedger terminal/late settlement and public pause/cancel | Unknown usage retains full64000/4096 reservation. Successful native continuation and reload while held do not release debt, recover or replay. Late actual usage settles the original request once; explicit pause persists. Existing owner/recovery/accounting checks were reused. |
| Settled-only automatic entry and local compaction/shutdown hooks | OFF across successful/failed/cancelled compaction, reload and runtime shutdown starts zero automatic auxiliary requests. Foreground remember, next-request injection, native search/read and explicit manual review remain usable. Operator-requested Pi compaction makes2/1/0 native model calls respectively; these are not plugin correction/flush calls. |

Assertions run outside provider callbacks; captured payloads, native successful terminals, actual dispatch counts and before/after snapshots establish the preconditions. One positive control, ten invalidation cases including resolved A→B, four independent store-fence cases and three OFF cases were exercised. No real provider calls or personal installation/config/memory migration occurred.

## Verification receipts

- Independent workflow `9e76af33-1c7c-4419-9bc1-d624b3883d09`, reviewer `0e6aec59-a23a-4d67-be2c-844c50931255`: approved with explicit metadata residual, no product blocker. Bound report: `/home/xz/.pi/agent/sessions/--home-xz-Code-ai-pi-hermes-managed-memory--/subagent-artifacts/outputs/9e76af33-1c7c-4419-9bc1-d624b3883d09/review/6.4-cancellation-verification.md`; SHA256 `5a7afbe48e49e74f571ce6251331be00fbd30d6ed05c81e6a7dc0c1068055ace`.
- Independent focused128/128, scratch17/17, resolved-project supplement1/1 passed. Raw roots `/var/tmp/hermes-64-review-zbjYPs` and `/var/tmp/hermes-64-project-review-WLbLN2`; evidence-manifest hashes `490b42d4fc34998b60414545b655c55414871c606541a1bce0c2d16838a14c2e` (203 files) and `70970fcd07a1ac15e2e1a34ad22bcd501dc31e2183a180d9a2c926a2c646cd1b` (20 files).
- Parent focused112/112, typecheck and strict OpenSpec passed: `/var/tmp/hermes-64-verification-4NFDsT/parent-logs/commands.json`.
- Parent replayed scratch17/17 and resolved-project1/1. Only output root, or import/output roots, changed; assertions remained exact. Receipts and raw logs: `/var/tmp/hermes-64-verification-4NFDsT/parent-replay/{receipt,project-receipt}.json` and `probe.*` / `project.*`.
- Parent close `/var/tmp/hermes-64-verification-4NFDsT/close/acceptance-hashes.json`: all106 product paths and membership match across live/frozen/parent execution/replay/reviewer copies; all223 independent evidence hashes verified;36 raw native observations checked; five successful parent command records; staging empty. Full365 evidence from accepted6.3 reused for unchanged source, not represented as a fresh run.

## Preserved failed attempts and limits

Reviewer scratch failures remain in raw evidence: missing TypeScript brace; bare `AgentSession.dispose()` incorrectly treated as full lifecycle shutdown; one faux response where native compaction needed summary plus split-turn prefix; pre-transition B-byte comparison rejected legitimate SDK thinking-level metadata. Corrections changed scratch setup only. Public `AgentSessionRuntime.dispose()` emits shutdown; bare session disposal revokes handles but is not that lifecycle event. Required post-transition/pre-release→post-release byte invariance was not weakened. Parent verified these distinctions against pinned public SDK source.

Protected metadata was not wholly static:355/358 paths matched, while `.pi/hindsight/retain-cursors.json`, `retain-queue.jsonl` and `retain-receipts.json` changed during verification. Exact observed hashes and timestamps are in the close receipt and reviewer maps; attribution is not established. Neither parent nor reviewer restored or reconfigured them. Product equality and empty staging are separate verified claims.

This accepts host cancellation, stale-write prevention, accounting and OFF behavior—not universal filesystem ABA detection, remote zero-charge guarantees, model extraction quality, universal human authentication, or companion interoperability. Task1.4 still needs separate spending approval and approved sanitized samples;7.1–7.3 remain separate work. Existing filesystem/accounting durability and pinned-SDK limits are unchanged.

# Task 4.2 — request-level version refresh evidence (accepted exact candidate)

Parent accepted after same-reviewer closure `2a25a5aa-8797-40ae-a8eb-e24f573465ec` **approved with explicit residual risk**, individually closing scope ownership, secondary-slot duplication and revoked-context timer lifetime. Report: `/home/xz/.pi/agent/sessions/--home-xz-Code-ai-pi-hermes-managed-memory--/subagent-artifacts/outputs/2a25a5aa-8797-40ae-a8eb-e24f573465ec/review/4.2-memory-refresh-closure.md`. Independent current-source gates: 77/77 affected, 10/10 original probes, 3/3 new scope-fault/checkpoint/lifetime interactions, 133/133 full at `/var/tmp/hermes-42-closure-8KSizE/`. Parent verified all six frozen hashes still equal, then checked 4.2 and completed its todo. Acceptance is official 0.99.2 faux mechanics only, not model usefulness/submission/invoices/future SDK or 4.3+.

Frozen parent gate: check clean, affected **77/77**, independent probe suite **10/10**, full **133/133** at `/var/tmp/hermes-42-scope-slot-gate-P6C7A1/{check,focused,independent,full}.log`. Six before/after hashes equal; `hashes.json` binds the candidate. Earlier 130/130 and worker 126/126 are superseded, not acceptance. Subsequent source edits need their own affected gates; this is not blanket approval of future changes.

## Independent findings and narrow correction

Reviewer `e13f12f6-8127-4374-9065-bbfb2517f6c5` returned **changes required**, not approval: P1 valid same-turn scope replacement loses native ownership; P2 recognized secondary owner duplicated into head. Full report: `/home/xz/.pi/agent/sessions/--home-xz-Code-ai-pi-hermes-managed-memory--/subagent-artifacts/outputs/e13f12f6-8127-4374-9065-bbfb2517f6c5/review/4.2-memory-refresh.md`.

- Parent actual red: `/var/tmp/hermes-42-scope-slot-red-CnpTfk/`: persistent integrity cases **4/6**, exact independent scope and slot probes **0/1** each. Source assertions are outside callbacks; successful native assistant terminal required. A preceding helper-array type inference error in `...red-xJCrNK/check.log` was corrected with an explicit `SystemLike[]`, not a weakened assertion.
- P1: store replacement now `rebind`s eligibility authority and records a pending scope boundary, without throwing away the original native base/last projection receipts. Next request reads only the new store; no old-scope entries copied into eligibility. Scope boundary consumed only after successful rebase; original native anchor never fictitiously stamped. Persistent case covers three same-turn requests/one start and exact non-owned content/tool preservation.
- P2: re-key only the unique existing owner at its recognized location. Head insertion is reserved for already-authorized known-empty namespace. Secondary content/other sections/head/tool declarations untouched; duplicate input still rejected. Persistent actual SDK + helper replay case proves one owner and inert replay.
- Parent post-fix: `/var/tmp/hermes-42-scope-slot-green-Q265bi/`: refreshed/integrity **12/12**, both original executable probes **1/1** each. Final expanded gate above supersedes this intermediate candidate.
- Rerunning original probe scripts updates their JSON captures in `/var/tmp/hermes-42-independent-9SvfdM/`; those JSONs now represent latest green runs, not preserved red captures. Original independent red logs/report and parent scoped red logs remain the negative evidence.

## Full-suite lifetime failure and closure

`/var/tmp/hermes-42-final-gate-RbAygb/full.log` was **not** a green gate: all 132 behavior cases passed but the integrity file failed due an old status interval using a public context after fixture disposal (uncaught asynchronous stale-context guard). No failed gate discarded or counted as approval.

Added deterministic Node interval-clock test, without SDK monkeypatches: live interval tick, public `session.dispose()`, stock session/trust/usage handles revoked, later ticks must be inert. Red **0/1** at `/var/tmp/hermes-42-timer-red-pl2idc/timer.log`. Index timer now probes its captured public session handle before reading configuration/UI and, if revoked, clears only timer/context references; it does not swallow accounting failures, forge restored state or dispatch a fallback. Current **133/133** includes this case. Store, renderer, SDK fixture, journal, recovery and accounting modules unchanged.

## Parent integrity corrections

`/var/tmp/hermes-42-parent-red-ijmMLF/red.log`: all three new cases failed before corrections. Third actual request of the SAME tool loop revived a forgotten fact from the native v1 base; a corrupted lifecycle receipt silently carried old memory; a missing owned slot permitted blind insertion. Current `test/memory-refresh-integrity.test.ts` closes these and verifies read-only inspection plus failed-compaction version separation.

- The native before_agent_start anchor (`baseText`/`baseKey`) is immutable through projections, explicit refresh and compaction; only a real new start stamps it. Latest projected text is separate. Every fresh-old-base request can revoke forgotten/blocked facts, not only the first request after a write.
- Read/configuration failures cancel stale review ownership and clear only a byte-recognized own slot. Foreign/unrecognized data remains untouched, with unavailable/stale-context visible. Observation failures cannot throw away a safely cleared projection.
- A missing previously nonempty owned slot is stale, not permission to insert or string-delete arbitrary system content. A known empty/omitted base can still establish its previously empty namespace.
- Inspect/pending read cloned projection state rather than stamp a request/promote disk data. Failed native summary with newer disk data leaves working/projected versions unchanged until explicit refresh; refresh does not claim provider submission.

## Change

- `src/memory-context.ts` (new): `MemoryContext` — one owned-slot projector over the public
  `sections.hermes_memory` key. Distinct records: `working` (per-target disk `version`+`epoch`),
  `workingKey` (scope+budget+versions+blocked/tombstones+entries hash), `baseKey`/`basis`
  (session|scope|refresh|compaction), `projected` (last trusted local request projection), `checkpoint`
  (local-only pre-compaction marker), `stale`, `rebases`. `rekeyOwn` re-writes ONLY the
  `hermes_memory` key on system messages that already carry it (or the head when adding); foreign
  keys/content/tools never touched. Slot differing from desired must byte-equal own
  `projected.text` or `baseText` (this run's stamped base) else `owned-slot-foreign-content`;
  duplicate owned slots → `duplicate-owned-section`; no leading system → `no-leading-system-message`;
  non-string slot → `owned-slot-invalid`. Idempotent: slot == desired → same array returned.
- `src/index.ts`: `memory()`/`memoryScope()`/`projectRequest()` helpers; `context_with_system` now
  projects the owned section onto the effective request AND observes the post-projection context
  for review (not the stale pre-projection one). `before_agent_start` calls `memory().base("request")`
  and stamps `projection.section.text` (unchanged 4.1 seam). New hooks: `session_before_compact` →
  local `checkpoint()`; `session_compact` → `base("compact")` rebase + `refresh(ctx)` status;
  `session_compact_failed` → `compactFailed()` discards marker only. `session_before_switch` /
  `session_before_tree` / `session_shutdown` invalidate the projection (basis session/scope).
  Engine identity change now rebinds store authority while retaining only native owned-slot receipts;
  the next successful read rebases new-scope working eligibility. `before_agent_start` catch → `invalidate("session")`. `/hermes-memory`
  gains `refresh` (rebase, inspectable result) and `inspect` now reports `projection{working,
  workingKey, baseKey, basis, projected.key, stale, checkpoint, rebases}`. No store/journal/parser
  changes; `memorySection` untouched.

## Red-before-green

- First run of `test/memory-refresh.test.ts` on the initial wiring: 4/6 failed including
  "next tool-loop request sees the committed v2" (projection refresh missing) — genuine red.
- Mid-run root causes found and fixed: (a) `render` called without budget arg (default 6000) —
  now `this.render(snapshots, this.budget)`; (b) carried slot value is the SDK-rendered
  `<hermes_memory>…</hermes_memory>` envelope — comparisons go through `slotValue()`; (c)
  `session_compact` handler previously did not refresh the status display. The worker's proposed
  overwrite of baseText with the latest projected text was subsequently disproved by the parent's
  third-request regression and replaced with an immutable native-start anchor.

## Historical worker gates (superseded delivery)

- `npx tsc --noEmit` → clean.
- `node --experimental-strip-types --test test/memory-refresh.test.ts` → 6/6.
- `npm test` (full suite) → 126/126 pass.
- Earlier focused: `test/memory-context.test.ts test/public-api.test.ts` → 12/12 after fixes.

## Scenario mapping

1. Mid-tool-loop auto-compaction: tool `execute` commits v2 to disk; native threshold compaction
   fires with public `session_before_compact` summary override; NEXT provider request (same turn,
   `beforeStarts==1`, no new user) sees v2, exactly one `<hermes_memory>` block, foreign
   `fixture_reference` section and `fixture_output` tools intact; faux callCount==2 (no auxiliary
   memory call; compaction summary was the local override).
2. Distinct inspectable versions: `working` (per-target version+epoch), `workingKey`, `baseKey`,
   `projected.key`; unchanged turns reuse identical block; new session/project boundary rebase;
   `/hermes-memory refresh` re-bases next request; successful manual compaction rebases.
3. Checkpoint local-only: `session_before_compact` marks only; `session_compact_failed` (error and
   cancel variants) discards it, no committed refresh claimed, no extraction triggered, store
   state and subsequent prompts unchanged; cancelled compaction made zero provider calls.
4. Idempotent projection: repeated `project` over already-projected and fresh-old-base transcripts
   returns identical messages; foreign/duplicate/invalid owned slots → stale, content preserved,
   no deletion of foreign system data; empty↔nonempty own section handled via `null` patch.
5. Cache safety: `workingKey` binds blocked flags and tombstones — a forget between requests
   changes the key and removes the fact at next projection (blocked targets render `text:""` →
   slot cleared via `null`).

## Residual risks / limits

- Storage-failure carry-through repaired: recognized owned content is revoked without changing authoritative files; foreign/unrecognized structure is preserved and marked unavailable/stale. See parent integrity evidence above.
- Stale-context surfaces via `ctx.ui.setStatus` only (minimal 4.2 visibility); rich diagnostics 4.4.
- Native base may stay v1 for an entire tool loop. Immutable baseText retains that exact ownership anchor separately from projected v2/v3. It never authorizes stale store commits or restoring forgotten eligibility.
- Hash-equality is used only to recognize own previously projected text, never to equate lifecycle
  states (3.4 fences preserved: epoch included in `workingKey`/`working`).

## Historical worker hashes (superseded by parent manifest above)

- src/memory-context.ts 71307ed4d59b1621f6a5a95f3336decfe03934f4f6b470deb475b89e49e66527
- src/index.ts          9db29b97efccabe3d637674871dc838bc8b96e1b5981ef47fb4972350450c649
- test/memory-refresh.test.ts a96110181c6200c9d704425b5661d430df3f3987f2cdf3125f37bea7d61c57ab

No git writes/staging/commit; no deps, no real providers, no private memory/config edits.

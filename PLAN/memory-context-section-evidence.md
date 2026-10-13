# Task 4.1 — memory-context section evidence (accepted with explicit residual risk)

Independent reviewer `8d48c5f1-ded0-475a-bcc0-09bd990ef82d`: **approved with explicit residual risk; no blockers or same-scope changes required**. Report `/home/xz/.pi/agent/sessions/--home-xz-Code-ai-pi-hermes-managed-memory--/subagent-artifacts/outputs/8d48c5f1-ded0-475a-bcc0-09bd990ef82d/review/4.1-memory-context-section.md`; independent check clean, focused **46/46**, adversarial actual SDK probes **2/2** at `/var/tmp/hermes-41-review-pdctt0PX/`. Parent rechecked all five frozen hashes before task completion. Approval covers only task 4.1 delivery mechanics; model obedience/usefulness, future host formatting and later tasks remain excluded.

Parent corrections supersede the worker-only 117/117 candidate. Current check is clean, focused **46/46**, full **120/120** at `/var/tmp/hermes-41-parent-gate-P7vbVF/{check,focused,full}.log`; frozen hashes are in `hashes.json`. All current task 4.1 mechanics passed the independent functional closure above; the checkbox was updated only after parent hash verification.

Seam unchanged: existing `before_agent_start → MemoryStore.readAll → memorySection → sections.hermes_memory` in `src/index.ts`; no second reader, provider path or framework added. Faux fixtures prove request plumbing only, not model adherence or usefulness; real-model 1.4 remains unauthorized and unexecuted.

## Change

- `src/memory-store.ts` `memorySection`: one shared JSON data encoder handles **fact, ID and source** with `<`/`>` escaped to `\u003c`/`\u003e`; JSON encoding also prevents newline/control metadata from creating structure. Target is the validated enum and version the store hash. The actual public SDK `<hermes_memory>` envelope (33 scalars) is reserved in the same total cap. No internal imports or copied core functions; its observed baseline representation is verified at the actual official SDK request seam. Store/journal/recovery functions untouched; `src/index.ts` unchanged.
- `test/memory-context.test.ts`: 9 scenarios against stock official `@earendil-works/pi-coding-agent` 0.99.2 public seams via `sdkFixture`. Parent assertions on captured metadata/budget requests run outside the provider callback. All successful request scenarios also check the native final assistant is not an error turn; an intentional provider callback failure proves this guard rejects instead of producing a false green.
- `test/memory-provenance.test.ts`: assertion spelling reflects JSON-quoted `source="unknown"`; no provenance behavior or protection weakened.

## Acceptance mapping

1. Scoped injection: fresh session in project A receives user/global/A facts with `[target version=… id=… source=…]` metadata and the fallible-boundary prefix; B facts and prior native history absent. Fresh session in B gets B facts, not A. Unresolved-project session (no `projectRoot`) gets user/global only — no global fallback of project facts. Verified over real `before_agent_start` capture in the faux provider.
2. Authority boundary: stored "I prefer concise answers." + detailed current request → verbatim current request, boundary text, other extension's section and `fixture_read` tool declaration preserved; stored file bytes unchanged; 1 provider call only.
3. One owned section: two turns + a fresh session each render exactly one `<hermes_memory>` block (byte-identical across turns and sessions), `other-extension-stable-prefix` and tools intact, total faux calls = prompts only.
4. Bounded scalar selection: exact **actual rendered block** budget includes the complete entry/envelope; one scalar less omits the whole entry. Unit selection and four actual SDK requests cover undersized, ample, exact and one-less budgets. Blocked/tombstoned content remains excluded; `source="unknown"` remains unknown.
5. Parent red-before-green: `/var/tmp/hermes-41-boundary-red-MWCOi4/red.log`, **0/2 passed**: arbitrary supported metadata produced four apparent owned openers; actual block exceeded the body-only cap by 33 scalars. Initially those callback assertions were absorbed by the SDK as provider error turns rather than failing `prompt`; assertions moved outside, and the explicit successful-turn guard is independently failure-tested. Current two boundary cases pass, not merely their request counts.
6. Worker-only fact escaping and 117/117 were delivery evidence, not acceptance; their claim that ID/source are generated-only was false under current `validMetadata`/`validSource`. Current parent corrections and gates replace that claim.

## Historical worker commands (superseded candidate, dir `/var/tmp/hermes-ctx-41/`)

- `npm run check` → exit 0 (`check.log`)
- `node --experimental-strip-types --test test/memory-context.test.ts` → red 5/6, then green 6/6 (`focused.log`)
- `node --experimental-strip-types --test test/memory-context.test.ts test/lifecycle-integrity.test.ts test/learning-slice.test.ts` → 30/30
- `npm test` → 117/117 (`full.log`)
- Source hashes: `hashes.txt` (sha256 of changed/affected files)

## Boundaries / residual risk

- No Git staging/commit/branch/worktree; no network, real provider, private dirs, config or install changes; no OMD/dependency/spec/checkbox edits. 4.2 refresh/compaction, 4.3 constraints, 4.4 diagnostics untouched (rich per-turn injection diagnostics is 4.4, not claimed).
- Data rendering protects prompt **structure**, not a guarantee that a real model will obey every boundary or reject semantic instructions inside quoted facts. Faux proves deterministic SDK plumbing only. The public SDK envelope representation is verified on the pinned official 0.99.2 baseline; newer host compatibility is not asserted here. Larger-file diagnostics/refresh/session constraints remain their later tasks.

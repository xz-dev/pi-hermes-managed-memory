# Task 4.4 — current-request injection diagnostics and budget-omission explanation (independently accepted)

Current authority: task 4.4, memory-context "Explain what was used" requirement, design D4. Tasks 4.1–4.3 are independently accepted (frozen-hashes.json 45 files parent-verified). This plan is a source-derived implementation boundary, not implementation or acceptance evidence.

## Implementation seam

Reuse the EXISTING owned seams only: `MemoryStore.readAll` → `memorySection` render → `MemoryContext` base/project/snapshot → `/hermes-memory inspect|refresh` publish. No generic diagnostic service, new storage, DB, new UI framework, or provider path. The diagnostic view is metadata only (locators, ids, sizes, reasons, versions) — never fact bodies, quotes, or private content; it must not contain secret canaries.

The renderer returns complete-entry metadata `{ id, target, source, scalars, reason? }` plus the budget. Omission reasons are `budget`, `constraint-budget`, `blocked` and `tombstoned`. Mandatory-set overflow renders no block but preserves whole-fact omission metadata; it never authorizes dispatch without the complete active constraint set.

`MemoryProjection.diagnostic` records scope, working/base/projected keys, budget, working-render/slot scalar sizes, entries and constraints. Its state is `based | projected | stale | unavailable`; an inspect before any base uses a throwaway `absent` view. These are local owned boundaries, not provider receipts. Inspection never rebases, registers or refreshes.

`/hermes-memory inspect` separately publishes latest disk target/version/epoch/presence/scalars/blocked metadata, retained working/request identity, and the live gate. Ordinary inspect's pending queue is metadata-only; existing explicit pending and selected destructive previews retain private diffs. `/hermes-memory refresh` publishes the same local diagnostic and live gate. Automatic status remains safe counts; no new commands or knobs.

## Observable acceptance examples

1. Real SDK request: the owned block's exact scalar size equals the inspect diagnostic; per-target locator (target/version/path) and per-entry id/target/source appear without any fact text.
2. Over-cap big file: whole entry omitted with reason `budget`; captured provider payload omits the fact; on-disk bytes hash-identical; zero auxiliary provider calls (faux callCount counts only the authorized foreground request); inspect state unchanged before/after.
3. Secret canary stored as a fact: injected block contains it but the inspect/status diagnostic JSON does not contain the canary or any fact body.
4. Read fault/stale: injected `blocked`/`stale` reason truthful — after a mid-loop storage fault the diagnostic reports `storage-unavailable` and does not claim a current projected block; a budget-blocked request reports `blocked` instead of falsely presenting a last-success projection.
5. Refresh/compaction/scope paths: diagnostics follow the actual owned projection versions (workingKey/projected.key), including failed/cancelled compaction leaving prior records and a subsequent rebase updating them.
6. Constraint-shared budget: active constraints fully present with source/scope/version inside the shared cap while facts are omitted with reason — diagnostic explains it; registration-refused and request-blocked cases show the gate reason, and no diagnostic claims injection succeeded.

## Delivery boundaries

No Git writes, no live install/config/data, no private memory files, no real providers, no dependencies, no SDK/fork edits, no monkeypatching, no tasks 5–7, no checkbox changes. Inspect must not fall back to a global scope when the project is unresolved (existing rule). If a real API gap appears (e.g. a needed public field missing), stop and report rather than fake the diagnostic.

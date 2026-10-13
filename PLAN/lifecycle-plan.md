# Task 3.4 — storage lifecycle (backups, audit journal, pending, tombstones, rollback)

Single coherent seam inside `MemoryStore.mutate`; all lifecycle mutations (additions, replacements, removals/forget, rollback, approved pending) pass that one commit entry. No new dependencies, no Git/network/provider work.

## Layout

Per-target append-only journal beside the file: `<target>.journal.jsonl`, with `<target>.lifecycle.json` storing canonical scope and the last durable journal prefix length/hash. Every auxiliary path receives containment/symlink checks. First journal record is `{v:1,type:"init",scope}`. Other records `{v:1,type,...}`:

- `intent` — `{id, proposal?, base, after, outcome, ids, forgotten?, tombstones:[{id,factHash}], restores?, rollback?, reverts?, at}` fsynced BEFORE the file change. A rollback binds the selected prior commit and its exact inverse forgetting effects; the audit history is never erased.
- `result` — `{intent, proposal?, status, ids, forgotten?, at}` fsynced AFTER the write (or an explicit no-change/conflict); must match an existing intent.
- `pending` — `{id, base, epoch, batch, reason, summary, at}` bound to canonical scope, captured Markdown hash and logical lifecycle epoch; later `pending-status` `{id,status:approved|denied|stale}` folds state. Approved acknowledgement follows an applied result.
- Tombstones and rollback classification live in the intent rather than separate, lossy post-result appends.

Known record shapes and relationships fail closed. Legacy Markdown with no lifecycle files remains readable, but initialized missing/corrupt/truncated history is never empty. A durable intent matching live `after` restores result/tombstones. An unresolved state-changing intent is uncertain even when live matches `base`: stale external saves can produce exactly those bytes after application, so no nonapplication/conflict outcome is invented. The target's automatic injection, old pending validity and writes are quarantined while content stays unchanged; paid review skips uncertain storage. Recovery persists metadata only under lock and never replays a file change. Total loss of both lifecycle files is not reconstructible locally.

`local-state.ts`: `appendLine` uses mkdir + `openSync("a",0o600)` + file and parent-directory fsync. The existing atomic-write helper persists the receipt and immutable version-addressed backups (including empty initial content).

## Mutate flow (existing order kept)

lock → validate/recover journal → proposal receipt replay → captured-base and batch validation → final cap → verify/create immutable backup → intent with tombstones → final live-version recheck → atomic write if changed → result. No-change receipts also reference an intent. Pending approval acknowledges only successful/no-change results. Rollback uses this same commit seam and validates addressed backup bytes before writing. Per the user's 2026-10-02 decision, explicit approved rollback reverses the selected commit's forgetting effects and restores eligibility, without erasing unrelated tombstones or reauthorizing old snapshots.

## API surface (store)

- `forget(snapshot, ids)` — direct user deletion = `mutate` removals + tombstones, commits immediately (user asked; not a model proposal).
- `stage(targetOrSnapshot, batch, reason)` — persist pending bound to canonical scope/content/base; background callers pass their captured snapshot and cannot silently rebase.
- `pending(target)` — unresolved pending with exact record stamp and per-entry diff.
- `approve(target, id, stamp?)` — under lock: selected immutable record must match the preview stamp when supplied, be unresolved and have the live base. Apply via `mutateLocked`; successful/no-change result resolves approved. Validation failure retains pending; interrupted applied result recovers its acknowledgement.
- `deny(target, id, stamp?)` — mark only the selected unchanged proposal denied.
- `rollbackPreview(target)` — inspect verified backup diff/from/to versions and the selected forgetting effects to undo, without writing or starting a provider call.
- `rollback(target, expectedVersion?, expectedHead?)` — require previewed live version/head when supplied, last committed after-hash, verified backup hash and current cap; apply inverse forgetting effects through the common commit seam.

## Callers/UI

- `memory-review.run`: additions commit with `proposal = record.id`; destructive/conflicting replacement batches stage against the captured snapshot. Per-target statuses remain separate, and only actual saved fact IDs enter `record.saved`. Automatic extraction/classification is still owned by 6.x; this storage slice does not claim its completeness.
- `candidates()`: accept optional `removals` key bounded to 16; validated against snapshot ids/facts before staging.
- `index.ts` `hermes-memory`: subcommands `inspect`(default, adds pending/tombstone/interrupted counts + retention notice), `pending`, `approve <target> <id>`, `deny <target> <id>`, `forget <target> <id...>`, `rollback <target>`. Destructive/approval actions require `ctx.ui.confirm` (same stock pattern as `hermes-review`); headless → structured `confirmation-required`; declined → `declined`, no mutation. Responses carry retention-boundary notice: forgotten content persists in backups/journal/raw sessions with independent cleanup.

## Tests (new `test/lifecycle.test.ts` + focused additions)

Isolated `/var/tmp` fixtures (store-level) + one real-SDK command test through `sdkFixture` (faux provider, json/rpc modes):

1. Journal intent→result ordering; proposal replay returns recorded result without rewrite (file mtime/bytes unchanged).
2. Forget removes entry + tombstones; reload: stale proposal re-adding same id/fact lands in `forgotten`, new facts still save; injected section excludes it.
3. Interrupted intent → matching-after metadata-only recovery; unresolved changing intent stays uncertain even at exact base. Corruption, missing initialized history and acknowledged-prefix truncation fail closed. Applied forget/result failure/stale editor save (exact base or added note) → actual next SDK request excludes the affected target, preserves bytes, exposes diagnostics and fences old snapshot/pending commits.
4. Pending: stage → approve commits exact batch; file changed between → approve refuses/stale; deny persists; headless/declined command path mutates nothing.
5. Rollback refuses manual drift and unverified backups; explicit approval restores the selected forgotten fact's eligibility, leaves other forgetting intact and supports undoing that restoration. An old snapshot/pending proposal cannot submit even when restored Markdown bytes exactly match its old base.
6. Multi-target partial: one target saved, one pending → per-target statuses accurate; review record commits list both.

Gates: `npm run check`, focused test file, full `npm test`; red-run once by deleting tombstone check.

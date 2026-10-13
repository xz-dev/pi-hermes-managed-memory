# Single-plugin learning slice — task 1.3

## Verified implementation

The actual extension (`src/index.ts`, `src/memory-review.ts`, `src/memory-store.ts`, `src/review-ledger.ts`) now runs a single explicit `/hermes-review run` through:

1. Public effective branch projection, with latest observed request-level transformations/system prefix plus subsequent canonical messages. Stale observed history fails closed; active tool declarations are read-only evidence, never executed.
2. One same-model independent `streamSimple` request with retries disabled, bounded output/time and cancellation.
3. Bounded JSON proposals with explicit preference/project classification, verbatim user evidence and session/entry provenance. Temporary/private/inferred or malformed proposals are rejected.
4. Source/version/capacity validation and per-target saves; editor races preserve the authoritative file and record conflict.
5. A genuinely new official SDK session automatically injects the saved facts and links included entry IDs to the original review request. Injection is observable reuse, not proof the model obeyed the facts.
6. Durable phases distinguish admitted/skipped/no-proposal/conflict/saved/recalled. Duplicate review at the same endpoint does not issue another request.

## Reproduction

- `npm run check`: exit 0.
- `npm test`: exit 0, 9 tests passed (5 actual-extension learning cases, 3 API seam cases, 1 isolation case).
- Detailed logs for this run: `/var/tmp/hermes-verified-slice-mdgLGJ/{check,test}.log` (temporary local verification artifacts).

Learning assertions cover preference/project saves, no main session byte/leaf changes, other-extension system prefix and transient context evidence, read-only tool declaration retention, fresh-session injection, same request ID/cost retention, no second review charge, budget skip, empty/invalid proposals, editor conflict, and unknown prices.

Price estimates explicitly retain `sdk-reported-estimate`, `model-table-estimate`, or `unknown` basis. The native faux provider reports zero price placeholders; the priced fixture uses rates 1/2/0.1/0.2 per million input/output/cache-read/cache-write tokens. Estimates use reported raw usage; they are not bills. Unpriced usage remains cost-unknown instead of zero.

## Boundaries

Task 1.4 real-model evaluation is **not executed**: no spending or sanitized-snapshot approval. Scripted proposals verify the host lifecycle, not model recognition, retention quality, provider-side limit enforcement, or actual bills. Automatic extraction remains off pending the durable budget/UI stages. Later four-scope storage, mutation/pending/tombstone, compaction refresh, retrieval, and companion-coordination tasks remain unchecked; this slice is not a claim those are implemented.

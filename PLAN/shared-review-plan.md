# Task 7.1 — one shared review, independent consumers

## Scope and existing authority

Continue `add-managed-memory-lifecycle` after accepted6.4: current apply output `/var/tmp/hermes-64-verification-4NFDsT/close/next-apply.stdout`, ready22/26. All seven contextFiles read; only the accepted6.4 checkbox changed since their preceding full reads. DesignD7, automatic-memory shared review requirement and `docs/review-contract.md` R1–R7 already require this behavior. Use a repo-local skill protocol double; no companion repository edits or claim of actual companion compatibility. Task1.4 still requires separate spending approval and sanitized samples.7.2/7.3 remain separate.

## Concrete gap

Current `src/index.ts` schedules the memory engine directly. `MemoryReview.prepare/run` prepares only memory targets and owns the one accounted stream; `ReviewLedger.admit` fixes owner.plugin to `hermes-memory`. The existing ledger provides cross-process reservation/owner/duplicate protection, not participant discovery, combined targets, deterministic plugin-owner selection or independent consumer results. Source/test search finds no `hermes.review.v1`/`pi.events` integration. Do not treat two cooperating test stubs or ledger unit tests as production coordination.

Pinned public Pi0.99.2 `EventBus.emit(channel,data):void` is a notification, not an acknowledgement. Its async safeHandler catches listener exceptions; extension `pi.events.on` subscriptions are runtime-tracked, and API handles revoke on reload/disposal. Therefore collect/commit outcomes need explicit bounded acknowledgements and stale-participant checks; an emit return or swallowed exception cannot authorize dispatch or report success. Use root exports only; inspect public declarations/source but do not copy/patch core.

## First vertical example (already specified by D7/R1)

At one real final settled boundary, ten genuine user turns and qualifying tool-bearing work make memory and the skill protocol double due. Production coordination collects both eligible targets for the same current effective snapshot, selects one owner by fixed participant identity, and admits one request through the existing durable budget. That one actual captured payload contains both selected contributions; its response yields a real memory save and an independently version-validated write inside the double's own isolated skill directory. One request ID/reservation/debit; separate consumer outcomes; no native chat/leaf writes. Demonstrate the missing behavior through this seam before implementation, then satisfy it before extending the matrix.

## Minimal implementation boundary

- Add only the thin repo-local versioned coordination needed for two independent consumers over public `pi.events`; no general plugin framework, backend, queues or new dependency.
- Integrate native settled dispatch and existing explicit review entry through the one paid path. Preserve current manual intent, confirmation/retry binding, budgets, same-model effective snapshot, source/ContextEdit separation and cancellation. Do not silently broaden a manual/retry target set. Ask parent if an actual user-visible ambiguity remains.
- Reuse `MemoryReview` proposal validation and `MemoryStore` commits as memory's own consumer. Peer receives only its proposal and declared bounded evidence/version context, not a memory store or generic write/tool authority. No model-supplied approval or target ownership.
- Retain the single cross-process ledger and all existing recovery semantics. Record merged targets, real selected owner, per-consumer terminal results and usage once. Partial consumer rejection/failure must not automatically rerun the model or erase a successful independent commit. Keep memory recall-credit semantics from conflating peer IDs.
- Update only this repository's shared contract with the actual wire/ack/lifecycle agreement, including current pending outcome and fail-closed compatibility. Do not modify its companion copy or claim an unintegrated/older plugin participates.
- This is one tightly coupled coordination/admission/dispatch seam: one writer owns the call-path change rather than overlapping owners in index/MemoryReview/ledger. Storage, injection and recall implementation stay out of scope unless a concrete required integration defect is demonstrated.

## Required follow-on examples

After the first real mixed success, use the same native fixture and public event transport for:

1. Either registration/event order and duplicate settled notifications still elect one owner and submit once. Late-added target at a processed snapshot waits for a new eligible boundary, not immediate second billing. Participant disappearance/stale identity or failed acknowledgement does not masquerade as standalone success.
2. Consumers retain separate permissions/version/approval/cap checks. One successful commit plus one rejected/conflicting/failed consumer is visible per target; no automatic whole-request retry. No skill workflow saved as memory.
3. Declared incompatible protocol/duplicate ambiguous identity or broken ledger prevents model dispatch, visibly pauses/reports the cause and never falls back to two requests. Missing optional companion remains ordinary standalone operation, not a compatibility failure.
4. Native input/project/branch/reload/shutdown invalidation prevents late commits from either consumer; cancellation still accounts once. OFF/disabled targets are not automatically included or used to bypass their opt-out. Existing manual/read behavior, unknown holds and explicit recovery remain intact.
5. Target/version/participant changes during paid retry confirmation invalidate the preview; no-UI recovery/retry remains confirmation-required. Do not introduce a hidden new spending permission.

These are applications of existing requirements, not new budget or semantic-learning claims. Protocol double demonstrates the boundary and independent fake consumer, not real skill extraction quality.

## Validation and delivery

Use existing node:test/sdkFixture, actual public native session/event paths and fake provider. Assert native successful terminals and captured dispatches outside provider callbacks. Every fixture has unique /var/tmp HOME/USERPROFILE/agentDir/auth/settings/cwd/session; projectTrusted:false and discovery/network/retry/resource controls remain. No personal installs/config/history, Git writes, paid providers, private/fork APIs, SDK mutation or fallback.

Freeze pre-edit product bytes and protected metadata; use exact edits, never rebuild inherited files/tests/plans. Preserve unmet-example and setup failures. Scope changes require justification/parent decision. Deliver the smallest implemented slice with raw command/cwd/exit evidence, typed contract, focused tests, typecheck and strict validation. Run affected native6.2–6.4/accounting checks; new edits invalidate affected prior evidence. Freeze final source plus manifest and return normally through bound artifact; parent verifies, then obtains fresh independent review before acceptance. No task checkbox or parent evidence edits by writer, no subdelegation or completion handshake.

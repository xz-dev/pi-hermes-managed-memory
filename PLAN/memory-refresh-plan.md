# Task 4.2 — request-level version refresh

## Authority and existing seam

Current `add-managed-memory-lifecycle` task 4.2, memory-context versioned-refresh/local-compaction requirements, design D3/D4; tasks 3.4 and 4.1 are accepted dependencies. Task 1.2 proved stock public mid-tool-loop compaction hooks; this task must implement those behaviors in the actual memory extension, not reuse fixture-only success as completion.

A bounded stock 0.99.2 probe (`/var/tmp/hermes-42-seam-JiOwQY/probe.eval.mjs`, `probe.log`) showed request-level system messages have `role/content/sections/timestamp` and an independently keyed `sections.hermes_memory`, with other prompt sections alongside. Own block was in sections, not content. Prefer this public namespace over whole-prompt string surgery. This is a seam observation, not task acceptance or future-host proof.

## Observable scenarios

1. Start with v1 facts; the actual fixture tool writes a valid v2; native auto-compaction succeeds; the next actual provider request sees v2 with one owned block, although `before_agent_start` ran only once. First system role/content, other sections, transient context and active tool declarations stay intact. Memory plugin adds no model call and no main-chat/leaf/session-file mutation.
2. Disk/read version, working snapshot and last own request projection have distinct inspectable version records, including lifecycle epoch where needed. Unchanged ordinary requests reuse a stable version without appending another block. New session, explicit local refresh, project/branch boundary and successful compaction rebase the next effective request.
3. Before-compaction checkpoint is local only. Native failure/cancellation discards uncommitted refresh and does not claim success or start extraction; active snapshot/state remain, except accepted eligibility/uncertainty fences cannot be bypassed by cache. Distinguish legitimate native faux compaction requests from zero auxiliary memory calls.
4. Repeating request projection over old-base or already-projected public messages is idempotent. Missing/changed/duplicate owned slot cannot authorize arbitrary system deletion: report stale-context and do not overwrite foreign sections/content. Preserve tools and first system. Rich omission/UI diagnostics remain 4.4; minimal refresh/version/stale visibility needed here is in scope.
5. Cached snapshots must not revive forgotten/blocked data, mistake equal Markdown hashes for equal lifecycle state, weaken scope containment, or omit current effective/transformed context from the existing isolated-review observer. Keep 3.4 inverse rollback policy intact.

## Minimal delivery

One tightly coupled source seam: existing `before_agent_start` and `context_with_system` hooks plus local snapshot/checkpoint state. One small helper module is acceptable if it makes state/projection clearer; no generic plugin framework, second store or new billing path. Reuse `/hermes-memory` for explicit refresh/inspection. Observe the resulting projected context before handing it to existing review; do not implement 4.3 constraints, 4.4 richer diagnostics, recall or scheduling early.

Capture actual SDK requests and check success outside provider callbacks (4.1 found SDK-converted callback failures). Show red-before-green for missing mid-tool behavior; run current affected tests/check/full suite and bounded independent functional review. Parent owns task checkbox and acceptance.

All fixtures use fresh disposable `/var/tmp` HOME/USERPROFILE/agentDir/auth/settings/cwd/sessions and public discovery-disable options. No real providers, personal config/memory migration, companion edits, dependency installs, Git writes or subagent fanout by children. Preserve accumulated unborn/untracked repo work. Escalate a genuine spec/API/design conflict rather than weaken any scenario.

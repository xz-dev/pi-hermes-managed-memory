# Task 5.3 — project scope, declared sources and recall guidance

## Authority and starting point

The user approved these two choices through `ask_user_question` after the source/API gap was explained:

1. **批准显式生产者接入**: this repository may supply a minimal native producer declaration and reader using official Pi public API. Verify the production writer's actual native output, not only hand-labelled records. Unintegrated producers and old history remain unknown. This does not claim existing pi-subagents integration or authorize edits there.
2. **当前 Pi 原生会话库**: explicit cross-project tool scope may search other projects inside current Pi `agentDir/sessions`. No other agentDir, arbitrary roots or private old-plugin storage. Development uses isolated temporary sessions only; startup does not scan history.

Hermes remains the standard, with D5's approved Pi/native-format and budget adaptations. Baseline 5.2 was already independently approved on manifest `8cfaad70aced3906031fa055ed85fc4e777e33c7391c57dda5e2aa631a9b3909`; do not resume its failed writers or repeat its acceptance. Task5.2 checkbox/evidence are recorded; CLI is ready,17/26. Task5.3 remains unchecked until complete independent acceptance and parent byte verification.

## Source basis and precise differences

- Hermes pinned `234badf4012af380d23c91eae55d045a69c69ffb`, `tools/session_search_tool.py:21–32,354–523`: browse/search hide kanban/subagent/tool; cron is searchable and demoted before dedup in search. Explicit session reads operate within ONE selected store; a bare ID/miss never searches other stores.
- Hermes `run_agent.py:369` supplies source when creating the session row. This is a producer declaration, not message/title/fork inference.
- Official Pi0.99.2 `SessionHeader`/`NewSessionOptions` and `SessionManager.newSession` contain no equivalent source. `CustomEntry` plus public `appendCustomEntry` provide the native carrier. `parentSession` identifies a fork, not a background producer.
- Public package exports include SessionManager/getAgentDir/parseSessionEntries/projection helpers. `getDefaultSessionDir` is not a root-package export and creates directories; do not import that internal helper or call create/open/resume in the reader. Official native storage has project collections under agentDir/sessions; public listAll follows symlinks and does not provide the accepted staged/scope accounting, so retain the existing fenced reader rather than bypass it.
- Archives: `/var/tmp/hermes-source-reference-5cpd2f8m/planning/hermes-agent-234badf4012af380d23c91eae55d045a69c69ffb/`. Relevant source equality with64ad33e3 was already verified; no new clone/runtime needed.

## Small implementation path

One coherent recall path, one writer; no dependency/backend/framework change.

1. A small `src/session-source.ts` production API creates a NEW native session through public SessionManager and appends a session-ID-bound source declaration before conversation entries. Caller explicitly chooses the source. This is producer opt-in, not automatic classification or a source-labelling tool. Reader derives bounded source metadata from genuine native entries only; copied declarations cannot label a new fork's producer, malformed/late/conflicting declarations cannot invent an origin. The reader never adds or repairs declarations. Source declarations are descriptive, not grants of authority. The supported producer path must be executable through public SDK with faux completion/native persistence.
2. Extend the accepted index narrowly for the authorized native-store layout (files plus direct project collections, not arbitrary recursive traversal) and canonical project-cwd matching. Keep authorization before source body decoding and every outward fence, recheck roots/aliases, preserve staged≤4MiB per invocation and truthful work/coverage. Derived caches grant no scope. Default current project uses already resolved project identity, including descendant cwd; if unavailable, restrict to exact current cwd. Preserve current host collection access for a custom current collection, without treating it as an arbitrary cross-project grant. Cross-project mode may only use agentDir/sessions. No source selector accepts a filesystem path.
3. Add explicit tool scope and session filtering over the same recall/index chain. Return each source cwd and honest declared-source metadata, excluding arbitrary payloads. Default project remains enforced on explicit session IDs and every continuation; a wider-scope cursor is not authority in narrower scope. Search/browse hide known noise, search ranks cron after other eligible matches, direct read by ID remains possible only within selected authorized scope, following Hermes. Bind relevant scope/source policy to continuations without breaking accepted unchanged historical append continuation. Add public tool/prompt guidance for relevant earlier work; results remain historical reference, not new user instructions or authorization.

No changes to accepted budgets, constraints, billing, review scheduling, shared companion contract or unrelated functionality. No automatic new-session markers from retrieval. Producer-owned new session creation is distinct from read-only recall and does not permit mutation of pre-existing sources or main chat.

## Acceptance examples and evidence

Existing spec scenarios plus the user's source/scope choices control behavior. Use existing node:test/public SDK fixture style. Preserve an expected-behavior red before implementing each slice; errors in test setup/imports are not behavior-red evidence.

- A/B have the same keyword under separate real native collections: default A returns A only; explicit cross-project returns both with genuine cwd/session/entry/branch/file/time metadata. A bare B ID under default A is unavailable, not a fallback. Known project descendants work; unrelated cwd and symlink escape do not. No real personal sources are scanned.
- Use the **production source-creating API**, official public SDK and faux successful completion to produce a declared subagent/tool/kanban/cron session. Ordinary creation remains unknown. Search/browse hide the three known noise classes; cron remains reachable and ranks behind other matches. Explicit scoped read of a known ID follows Hermes. A fork's copied marker does not fabricate the fork's source; message text resembling metadata is not a declaration.
- Call the actual registered tool through successful native faux model turns, capture requests outside provider callbacks, assert exact foreground dispatch count and no auxiliary/model/remote fallback, including a no-hit query. The next request receives historical tool/reference data, not a newly injected user instruction. The public model-visible guidance explains relevant-history search without claiming guaranteed recall.
- Snapshot source bytes and main leaf around retrieval; unchanged after search/read/catalog/no-hit. Producer creation writes only its newly owned session. No startup history scan or installation/configuration changes.
- Retain affected cursor, file-integrity, body/metadata budget, native fork, staged-work and existing index regressions. Source eligibility/policy changes cannot leak stale results or authorize a broader source.
- Run `npm run check`, focused source/scope/registered-tool tests, inherited recall/index tests and full `npm test`; strict OpenSpec validation. All fake-provider mechanics, no real-provider usefulness claim.

Freeze exact candidate bytes and command evidence. Fresh-context independent reviewer tests this5.3 delta and actual producer→native→reader path; parent reads evidence, verifies current/frozen hashes, then alone checks5.3. Failures remain in logs. Scope/authority/API conflicts go to parent rather than weakening scenarios.

## Exclusions and known limitations

Task1.4 real-provider trials remain separately unapproved.6.x/7.x are separate. No companion edits, staging/commit/push/branches, migrations, private history, personal install/config, real providers, backend adapters or network sync. Repository is unborn/untracked: byte backups/manifests replace Git diff baselines. Existing non-CAS filesystem boundaries, unbounded fingerprint IO/ancestry cost and instance-scoped cursor restart remain explicitly disclosed, not claimed solved.

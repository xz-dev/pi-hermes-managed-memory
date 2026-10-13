# Task 3.1 — verification evidence (review approved)

Reviewer `6913bc96-8470-4d56-8adf-597ef77ab544` approved with no findings, independently ran the focused 7/7 test and typecheck, and inspected the parent full/negative gates. Review artifact: `subagent-artifacts/outputs/6913bc96-8470-4d56-8adf-597ef77ab544/review/3.1-scope.md` in the recorded Pi session.

`npm run check` exit 0; full `npm test` 64/64 passed. Logs: `/var/tmp/hermes-scope-gate-ye7EZy/{check,full}.log`. Focused 7/7 scope tests: `/var/tmp/hermes-scopes-focused-n6Dj61/scopes.log` (the final full run also adds the Unicode-scalar assertion).

- `src/memory-store.ts`: three prescribed canonical file scopes and capacities, configurable caps, explicit/trusted Git root resolution, worktree-local identity, managed-path symlink refusal and own-target snapshot check; fourth target is public native session ID/leaf/file descriptor, not SESSION.md.
- `src/index.ts`: existing global/options config carries capacities, refresh identity includes them, inspector reports all four storage targets without raw facts.
- `src/memory-review.ts`: file-only candidate target type retained; no session-promotion or extra provider request.
- `test/memory-scopes.test.ts`: A knowledge excluded from B with user/global shared; unresolved project has no global fallback; stale empty A snapshot cannot write B; explicit non-Git/canonical root; actual orphan worktree identities with no staging/commits/pushes; redirected/dangling managed symlinks refused; default/overridden capacities and Unicode-scalar counting; real SDK inspector/session locator with no extra call.
- Negative proof: `/var/tmp/hermes-scope-negative-jhTjQn/negative.log`. Removing only snapshot-scope check caused the cross-project scenario to fail; guard restored before full gate.

No private profile/config migration, real provider or external adapter. Only task-scoped fixture Git repositories/worktrees were created; the source repo's Git state remains untouched. Native session state mutation/constraints belong to 4.3; metadata/transaction/pending/tombstone completeness belongs to 3.2–3.4, not claimed here. D1 prescribes scalar file caps only for user/global/project; session descriptor explicitly states native storage and separate injection bounds.

Tool boundaries: graph generation 2026-10-01 reports new source as not tracked; Serena symbol lookup reports no active language servers. Direct current-source reads and public SDK tests are verification evidence, not stale graph/tool readiness.

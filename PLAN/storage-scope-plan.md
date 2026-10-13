# Task 3.1 — scoped target resolution

Implement only the approved D1 target resolution/default-capacity slice. Keep native-session state operations for task 4.3 and mutation/pending/audit completeness for 3.2–3.4; don't mark those complete here.

- File targets: canonical agentDir USER/MEMORY, canonical projectRoot PROJECT; default Unicode-scalar file caps 1375/2200/2200, configurable in the existing global config/options. No new dependency or store abstraction.
- Project: explicit non-Git root or trusted Git/worktree top-level; canonical path identity, not remote identity. Unresolved/outside explicit root disables project, never global fallback. Reject managed-path symlinks escaping/mixing scope and stale snapshots from another resolved file target.
- Session: public session ID/leaf/file descriptor for native custom-entry storage; no SESSION.md or invented long-term file capacity. D1 only sets file caps for user/global/project. Injection bounds and active-constraint mutation remain 4.x.
- Inspector lists all four targets, including disabled-project reason and native-session identity, without logging raw facts.
- Existing Node tests/temporary SDK fixture only. Acceptance examples: A facts absent in B while user/global remain; no-root project write rejected; explicit non-Git root works; independent worktree identities; redirected managed paths rejected; default/configured file caps visible and enforced; real native session locator. Temporary Git fixtures must use no staging/commits/pushes.
- No project branch/commit actions, personal config or migration, real provider calls, external memory adapters. Reviewer gate follows functional changes before checkbox completion.

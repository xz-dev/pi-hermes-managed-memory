# Session recall scope and sources — task 5.3 accepted evidence

Task5.3 is implemented, independently approved with explicit residuals and parent hash-verified. This does not accept6.x extraction,7.x integration or real-provider1.4.

## Accepted bytes

- Candidate94: `/var/tmp/hermes-53-three-fixed2-EcfWvZ/{repo/,manifest.json}`.
- **Raw manifest file SHA256:** `828fae9f65b32c146e85b26bd1cda41eaf918343b67633998767a17e3931b27c`.
- Original independent reviewer `897103b5-b617-47f0-8ff2-933bf289bbe7`: **approved with explicit residuals**, no remaining code findings in the scoped recheck. Report: Pi session artifact `subagent-artifacts/outputs/1fae8f61-4b79-423b-abad-02c1dee993ba/review/5.3-three-rule-recheck.md`.
- Parent acceptance receipt: `/var/tmp/hermes-53-three-fixed2-EcfWvZ/parent-acceptance-hashes.json`,2026-10-04T14:20:29Z. All94 current/frozen entries match; staging empty; unborn master/no HEAD. Checkbox and this evidence document are post-acceptance bookkeeping, not part of accepted94.
- Authority: D5, `PLAN/session-recall-scope-plan.md`, pinned Hermes behavior and official Pi0.99.2. User-approved producer opt-in and current-Pi-native-store cross-project boundary were not reopened.

## Delivered behavior

One existing index→recall→registered-tool path remains local/read-only, without a new backend, model request or alternate filesystem reader.

Default uses trusted/configured canonical project identity and includes its descendant cwds across authorized native direct collections. Without project identity it uses exact current cwd, not containment. The host's current custom collection remains available under this default policy. Explicit tool `scope:"project"` selects **all projects in current Pi agentDir/sessions only**; it does not include an external custom host directory, other agentDirs or old private stores. Bare IDs, misses and cursors never widen authority. Collection discovery refreshes on invocation; startup does not scan history.

Production `createDeclaredSession` creates only a new owned session through public SessionManager and writes a native CustomEntry declaration. Pure `interpretSessionSource` consumes validated native records behind existing index gates. Declaration must be actual first/root entry, bound to its own header and genuine entry ID; physically first user/assistant conversation decides chain validity. A disconnected first conversation cannot be repaired by later messages. Missing/malformed/copied/late/conflicting evidence cannot invent attribution. Ordinary/unintegrated histories remain unknown; no existing pi-subagents integration or cryptographic authorship is claimed.

Hermes rules: search/catalog hide declared kanban/subagent/tool; search retains cron but demotes it before dedup/limit. Explicit known-ID reads may access hidden sources only inside selected authority. Search/read locators carry validated header cwd and genuine native location metadata. Both browse/search continuations bind relevant source classification/eligibility; changes require visible restart. Unchanged historical suffix append remains usable. Tool guidance makes history a fallible reference, never new user instructions or authorization.

Native body reads require direct lexical/canonical membership in selected collections. Derived hints cannot authorize deeper or unselected sources. Cache ownership separately protects entire source trees: canonical write-parent and resolved target must BOTH remain outside every authorized collection. Constructor, persist and reset use the same fence; both symlink directions are covered. Source JSONL remains sole truth and is not rewritten by retrieval.

Existing limits remain default3/max10 groups, fragment body2000, page body12000 Unicode scalars with separately bounded metadata. One staged advance budget per invocation; measured work is not a total IO/latency promise.

## Verification

Independent evidence: `/var/tmp/hermes-53-final-review-g00tOZ/` (gates, before/after hashes, exact probe-copy receipts). Parent code/byte gates: `/var/tmp/hermes-53-parent-three-naxb8avw/` and `/var/tmp/hermes-53-parent-final-gate-77vw837m/`.

| Check | Result |
| --- | --- |
| Independent typecheck | exit0 |
| Affected source/scope/tool/index/recall suite |73/73 |
| Independent full suite |256/256 |
| Strict OpenSpec validation | valid |
| Original coupled rule probes |3/3 |
| Old/current cache-tree comparison |1/1 |
| Original registered/native probe |3 top-level /11 expectations |
| Original malformed-declaration/cache probe |3/3 |
| Unauthorized cache-body probe |1/1, staged/decoded/projection0, no cached private body |
| Parent inverse alias probe |1/1 |
| Parent collection/continuation rules |2/2 |
| Independent persist/reset/pending-path probes |2/2 |

Original scripts/assertions and failure logs preserved; replay copies alter only unique scratch output roots. Reviewer independently verified all candidate94 hashes, prior snapshots and434-file repository snapshot before/after; no edits or staging.

Actual production creator→six successful public SDK faux turns→native persistence→pure reader→registered tool is independently exercised. Six core retrievals produce exactly12 foreground requests captured outside response callbacks, with zero auxiliary dispatch and no-hit0. Twelve main leaf/hash boundaries and eight archive hashes stay unchanged. Public reference-only guidance reaches the next actual faux request; no new user-role instruction is inserted. Per-result cwd and metadata/body budgets are checked.

Parent inspected actual control flow before allowing final recheck, not just green totals. Parent extra probes verify both alias directions, separately authorized external collection targets, true non-anchor hide/promote changes in both APIs, and visible-anchor suffix append. Final parent source/scope24 and typecheck also pass.

## Preserved failure history

- Initial producer reader bypass and missing-ID/null defects: `/var/tmp/hermes-53-workflow-recovery-xtiwvgfs/`; native pure reader replaced the second path reader.
- Original blocked94 manifest `8189f1fa…`: `/var/tmp/hermes-53-candidate-SzLtCZ/`; eight independent failures and parent replay `/var/tmp/hermes-53-findings-repair-5zbdv2qs/` retained.
- First repaired94 manifest `c8999ac1…`: `/var/tmp/hermes-53-repaired-M9yfiQ/`; original probes passed but coupled F2/F3/F5 boundaries still failed. Review `/var/tmp/hermes-53-rereview-MrCAjB/`, failures `/var/tmp/hermes-53-rereview-coupled-vrRNJd/`, parent replay `/var/tmp/hermes-53-three-repair-n3mo0whh/`.
- Intermediate `eeb53da3…`: `/var/tmp/hermes-53-three-fixed-Dh8S6i/`; parent detected inverse cache-alias regression before reviewer start. Exact inverse failure and inspection gate remain under parent-three evidence. Final fix restored parent protection without removing target protection.
- Intermediate full suite had one stock PTY `manual ready` timeout; dedicated unchanged PTY and full retry passed. Final independent full256 passes. Initial failure remains preserved; underlying timing cause is not claimed proven and this is not a never-failed history.

## Residuals

- Real-provider usefulness, semantic quality, obedience and actual cost remain untested;1.4 requires separate spending approval and approved sanitized snapshots.
- Structural native-file source trust is not cryptographic producer authentication; unintegrated producers remain unknown.
- Non-CAS filesystem races, unbounded total fingerprint/ancestry IO and instance-scoped cursor restart remain disclosed. Staging bounds are not total performance guarantees.
- Corpus/classification changes can invalidate cursors; guidance does not guarantee model recall.
- Later affected changes need fresh checks. This acceptance is not blanket approval for subsequent6.x/7.x work.

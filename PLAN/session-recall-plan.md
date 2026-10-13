# Task 5.2 — Hermes-standard bounded native recall

## Source and decisions

Hermes is the functional/data-flow standard, not an optional inspiration. Fixed reference `234badf4012af380d23c91eae55d045a69c69ffb`; its session-search tool and relevant search tests/helpers checked byte-identical at current `64ad33e32dad...`. See `docs/hermes-reference-decisions.md` for primary links and prior decisions. Read actual `tools/session_search_tool.py` and relevant storage/helper tests when deciding behavior.

User explicitly selected content-only counting after the source comparison: fragment body≤2000 Unicode characters; page body sum≤12000; locator/pagination/progress metadata remains independently bounded and cannot hide raw bodies/tool arguments. Complete response may exceed12000. Then user explicitly required Hermes memory system as standard: default search now3, maximum10 (not our old arbitrary default10). Current D5 reflects both decisions; strict OpenSpec validation passes.

Official Pi0.99.2 / a4715ec9 remains the host boundary. Pi JSONL, explicit canonical scopes and native entries replace Hermes SQLite/profile/message-number identity. No hidden inference, remote fallback or model-generated recall; no source opening/migration/navigation/writes. No automatic history scan at session start.

## Deliverable

A usable `hermes_session_search` public extension tool and small recall layer over accepted `SessionIndex`, not another index or backend. Keep the Hermes search→actual-message read→entry-anchor continuation flow and explicit content truncation/original-length/continuation information. Search should provide matching-session context with genuine matched entry anchors, not a bag of arbitrary snippets called final facts. Native fork-copy source identities must be handled without merging unrelated same-text conversations.

Register through a narrow existing-extension binding; current host native session collection and canonical cwd provide the initial authorized source boundary. Tool arguments must not authorize arbitrary filesystem roots. Full default-project/cross-project selector, background source filtering and recall guidance remain task5.3; the initial5.2 binding must still be safely scoped and useful. No5.3 completion claim.

Prefer Hermes argument-based discovery/read/anchored continuation semantics where Pi IDs allow it; do not add a generic query framework. Metadata-only empty-query browsing may reuse the same bounded catalog if needed for the standard entry flow; no unrelated time/ranking/profile option expansion. Respect Hermes's distinction between currently visible context and recallable archived history: use the public current projection to avoid recursively retrieving the tool's own live request/result, without treating all native branch ancestors as currently visible. Explain any actual API/design conflict before narrowing required behavior.

## Core invariants

1. Search and read are read-only local operations, never a provider path. Main leaf and original indexed files remain untouched by plugin work; ordinary host recording of an explicitly invoked foreground tool is distinguished from plugin mutation.
2. Every outward hit/read/cursor relies on current eligible source identity and revision. Missing/replaced/changed/out-of-scope selected content or stale cursor yields explicit unavailable/restart, never cached raw text. Ordinary host appends of later messages must not make unchanged historical-entry pagination permanently stale: bind selected entry content/identity and stable ordering anchors, not only an indiscriminate whole-corpus epoch. Narrow index metadata/revision access is allowed only through its existing live source fences and defensive-copy semantics.
3. Page body caps are semantic returned-content Unicode counts, NOT tokens or whole serialized JSON size. Every fragment≤2000, sum≤12000; search default3,max10. Read/continuation cannot take an uncapped path for huge tool output. Truncation/budget/next entry-or-content position is explicit; successive pages on an unchanged source make finite progress without losing text or splitting Unicode scalars.
4. Metadata is allowlisted and bounded separately: source identity/path/time/branch, necessary cursor/ref, summary coverage/work/budget counts. No whole entry, tool-call arguments, message body, all-file work list, all-fork locator list or duplicated corpus in details/error/cursor fields. Do not count metadata inside the12000 body allowance or advertise whole response≤12000. Use a small deterministic independent metadata bound, disclose it as implementation of the user's bounded-metadata requirement, not a Hermes default or configurable framework. Full locator fields must be honest; metadata too large must be explained rather than silently mangled.
5. Match and source locators remain genuine session/entry/parent/path/time plus physical/native reload branch relation. History is returned as tool/reference data, not new user instructions or a claim that a failed branch is final truth.
6. Fork-copy dedup follows verified authorized native parent-session links plus same-entry/content evidence, not text-only dedup or guessed ancestry. Keep unrelated equal text and divergent edits distinct. Missing/unreadable/out-of-scope ancestor gives honest unknown/unmerged local provenance; do not traverse outside authorization or invent origin. Multi-generation fork fixtures prove actual copied-origin handling. Search pagination occurs over the chosen deduplicated presentation so copies do not reappear on later pages.
7. Index preparation uses accepted bounded staging and honest coverage/work. No unbounded per-tool auto-loop pretending to be a small page, no stat-only source validation, no silent suppression of pending/unavailable regions. Existing full-source verification IO cost remains explicit; no new totalIO/CPU ceiling.

## Finite acceptance examples

| Area | Required external observation |
| --- | --- |
| Search/paging | Default3,max10 matching result groups, genuine anchors; next page on unchanged sources visits the remaining results without copy repeats; exhausted/no-hit explicit |
| Huge read/tool output | Actual production response fragments≤2000/body sum≤12000; numeric counted lengths and truncation/next pointers agree; repeated read/continuation reconstructs selected source content with no gaps or accidental repetition; Unicode boundary exact |
| Metadata/hidden payload | Whole returned object/content/details inspected: no uncapped body/tool arguments in metadata, cursor, error, progress or alternatives; independent metadata bound and body/metadata distinction visible |
| Fork provenance | Public Pi native forks over two generations; copied entries displayed once with truthful source, unique child entries and unrelated equal text retained; missing/changed/cyclic/outside ancestry cannot falsely dedup or read outside |
| Current source/cursors | Changed/deleted/corrupt/read-failed files and source drift between pages invalidate old page/ref; malformed/forged/cross-scope cursor/locator cannot become arbitrary read permission |
| Actual SDK tool | Production registered tool executes via official public seam, result/next foreground request measured outside callbacks; successful positive native terminal, exact faux dispatch count, no auxiliary stream calls; no private SDK patches |
| Inherited fences | Source and main-leaf receipts around read-only operations, no index source writes; accepted index33 and full216 plus new recall cases and typecheck pass; original tests not weakened |

No success from internal object checks, green totals or producer reports alone. Parent freezes current candidate; fresh-context independent reviewer verifies the finite5.2 contract before checkbox. Later5.3/6.x/7.x and real-provider1.4 approval remain separate.

## Ownership and exclusions

One writer for new recall module/tool/tests, plus narrow `src/index.ts` registration and genuinely needed `src/session-index.ts` fenced metadata access. Preserve store/context/constraints/ledger/review/fixture/package/dependency and all planning/OMD files. No old test reconstruction, personal configuration/history, companion edits, source Git operations, SQLite/embedding/service/adapters, real provider or upstream runtime execution. Use isolated official SDK fixtures under unique `/var/tmp` roots; don't install or activate the extension in the user's live setup.

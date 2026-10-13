# Task 4.3 — session constraint state contract (user decisions approved; implementation pending)

Current authority: task 4.3, design D1/D4, memory-context explicit constraints/branch-aware state/local checkpoint requirements. This table is a source-derived implementation boundary, not implementation or acceptance evidence. Task 4.2 is independently accepted, its six hashes parent-verified and checkbox checked; current CLI ready progress 13/26.

## Approved product decisions

User selected explicit task switching: explicit foreground start/switch/complete operations control taskId; ordinary continuation does not clear registered constraints. Do not infer completion from a final assistant turn, settled or compaction.

User selected active-constraints-first within the EXISTING shared injection budget: fit all active constraints plus source/scope/version metadata before complete durable-fact entries. Refuse over-cap registration without mutation. If a later budget reduction makes existing constraints impossible to fit, block the actual foreground provider request and show an actionable reason; never silently omit constraints/raise budget/add summarization. Prove the public SDK gate with zero actual provider calls; a callback error or status string is not proof of blocking. Public API gap is a stop/report condition.

One owned request/projection seam, native branch custom entries and a small state fold. No generic state framework or new storage/paid path. Expected implementation size is a small native-state module plus narrow index/render/projection integration and existing-style behavioral tests; stop before any large multi-module redesign.

## States and actors

Native current-branch custom entries are the source of truth. Constraints carry explicit origin user entry, task identity, scope, version and status. Current request/projection is derived; reading it does not register, complete or cancel anything. Stored ordinary user prose is not silently promoted into an explicit constraint or permanent profile.

| Actor/event | Permitted state transition | Next effective request | Failure/invariant |
| --- | --- | --- | --- |
| Explicit foreground registration with valid current user source | absent → active, scoped to stated task/current branch | active constraint and source visible | Invalid/stale source/scope refuses mutation; no fabricated user authority |
| Explicit replacement | prior active version → superseded; replacement active | only latest applicable version | Old proposal/version cannot revive superseded state |
| Explicit cancellation | active → cancelled | constraint absent | Raw historical entry retained, terminal state is not deletion of native history |
| Explicit task/constraint completion | active → completed | constraint absent from subsequent task | No automatic resurrection based on old entry bytes |
| Viewing current state | no transition | unchanged | Inspector cannot act as a registration or refresh commit |
| Successful native compaction | local checkpoint → request re-projection of still-active current-branch state | registered “this task: do not deploy” remains visible | No plugin-paid summary, no unrelated history restore |
| Failed/cancelled native compaction | discard uncommitted checkpoint | prior active state remains | No false success, hidden extraction or state rollback over later valid user changes |
| Sibling branch without registration | fold only current getBranch() | absent | Do not merge all JSONL branches or global pending state |
| Different explicit task identity | select only that task's applicable active state | previous task's constraint absent | Do not infer all task semantics or guarantee unregistered prose survives |
| Explicit start/switch taskId | change only current task selection | new task excludes old-task constraints | Ordinary input/settled/compaction cannot guess a task boundary |
| Over-cap registration | no transition | prior valid state | Whole active set plus source metadata must fit before accepting |
| Later budget too small | no transition; refuse model dispatch | no unprotected provider request | Show reason; restore budget or explicitly process constraints; no silent omission |
| Read/schema/ownership uncertainty | no fabricated state | safe owned projection/stale diagnostics per accepted seams | Cached state cannot bypass scope, cancellation or completion |

## One observable behavior chain

Explicitly register current-user “this task: do not deploy” → see scoped native state → native compaction → actual next SDK request includes active constraint/source → explicit cancel or complete → actual next request excludes it → sibling branch without the registration and a different task do not inherit it. The original ordinary instruction without registration remains subject to native Pi history/compaction, with no mechanical preservation claim.

The acceptance chain also covers ordinary continuation retaining taskId, explicit new task selection omitting old constraints, valid origin-user entry/source refusal, stale versions and idempotence. Capacity slice: active constraints displace lower-priority complete facts, excess new registration is a no-write error, post-registration tiny budget makes zero foreground provider calls and leaves state/source files unchanged. Assert actual public requests outside faux callbacks and reject native error terminals for successful cases.

Before coding, use the current CLI contextFiles and public SDK custom-entry/branch seams. Carry forward actual final-request assertions outside faux callbacks, successful assistant-terminal checks, repeated same-turn request/forget/read-failure/readonly-inspector cases from 4.1–4.2. Do not treat task 1.2 fixture-only API success as task 4.3 implementation proof.

## Delivery boundaries

One small native-state fold + existing owned prompt/tool seam, not a new framework/store/billing path. Integrate with accepted total-budget/data-encoding/namespace/version rules without silently weakening active-state preservation. If constraint capacity/priority or task identity introduces a genuine policy conflict not resolved by current artifacts, ask the owner before implementation rather than store an “active” guarantee that cannot be delivered.

No main-session navigation/chat writes by background processing, permanent-profile promotion, external adapters, private data, live install/config, companion edits, real providers, dependencies or Git publication. Only disposable stock 0.99.2 public-API fixtures; parent owns current-source gates, independent functional acceptance and checkbox.

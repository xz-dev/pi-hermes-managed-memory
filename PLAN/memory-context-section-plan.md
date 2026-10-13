# Task 4.1 — bounded factual memory section

## Accepted behavior and scope

Authority: current `add-managed-memory-lifecycle` tasks 4.1, memory-context automatic injection/facts authority requirements, design D1/D4. Actor: a user starting an ordinary task in a fresh native Pi session; value: relevant durable facts arrive without a recall command, without becoming authorization or replacing the current request.

Use the existing single seam `before_agent_start → MemoryStore.readAll → memorySection → sections.hermes_memory`. Do not create a second reader, provider path or framework. Preserve other system sections, tools, native chat and lifecycle quarantine. Existing store containment, provenance, logical epoch and deletion/rollback semantics are accepted dependencies, not redesign targets.

## Observable acceptance examples

1. Seed disposable USER/global/A/B project facts; fresh official SDK session A automatically receives user/global/A, not B or entire unrelated native history. Fresh B receives its own facts, not A. Scope/version/source remain visible. Unresolved project never falls back into global.
2. Old profile says concise answers; current user requests a detailed explanation. Provider receives the intact current request and a fallible-reference/current-authority boundary. Ordinary prompt processing does not rewrite the stored preference or change tool permissions. Faux replies prove plumbing, not model adherence or usefulness.
3. Two normal turns and a new session do not accumulate a second owned section; another extension's stable section and tool declaration remain intact. No auxiliary model call occurs to read or shorten memory.
4. Exact and under-sized Unicode-scalar budgets select complete source-quoted entries or omit them; the emitted section stays bounded. Unknown provenance remains unknown and unsafe/unavailable target content stays excluded. Rich persistent diagnosis is separately 4.4, not silently claimed here.

## Delivery sequence

- Inspect existing source/test conventions and public SDK seams; demonstrate missing behavior before the narrow fix, or document cases already established without inventing unnecessary code.
- Implement only the section seam and its current acceptance evidence; leave 4.2 request refresh/compaction, 4.3 constraints, 4.4 diagnostics, 5–7 and real-model 1.4 untouched.
- Current-source typecheck, focused official SDK scenarios and full regression; independent functional review. Parent owns acceptance and checkbox.

No Git writes/publication, live installation/configuration, private memory, companion edits, real provider experiments, dependency installs or new delegation by children. Fixtures use `/var/tmp`, fresh HOME/USERPROFILE/agentDir/credentials/settings/cwd/sessions and public disabled discovery options. Repo is an unborn/untracked accumulated working tree: preserve everything, no worktree allocation or branch creation.

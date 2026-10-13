# Official API continuity — task 1.2

Baseline: installed official Pi SDK 0.99.2, public package-root exports only.

`test/sdk-fixture.ts` creates isolated HOME, agentDir, project, auth and session storage. Default resource discovery, built-in tools, cache warming and retries are disabled. Tests bind actual SDK extensions in JSON mode; only the explicit fixture tool is executable.

`test/public-api.test.ts` verifies:

- Active branch and compaction-aware projection exclude sibling/compacted raw history. An independent `modelRegistry.streamSimple` success and abort preserve the main session ID, leaf, branch, entries, messages and JSONL bytes. Request retry, timeout and output-limit options reach the fake provider.
- A native threshold compaction occurs between two requests in one tool loop, with only one user input/before_agent_start. Request-level context hooks refresh one named section and retain the leading system, other section and tool declaration. Request-only evidence is not persisted.
- Native compaction failure and cancellation emit failure events and preserve the prior projection and JSONL. Cancellation adds no provider request.

Commands: `npm run check`; `npm test` (1 package test + 3 public API tests).

Failure-sensitivity check: temporarily enabling request retries, omitting the post-compaction version increment, and replacing the scripted compaction failure each made its corresponding test fail. All temporary changes were restored before the final passing run. These are SDK characterization/contract checks, not a claim that stock Pi was implemented test-first here.

Scope: these checks establish usable public seams and main-session isolation. They do not implement memory storage, automatic review, budget accounting, TUI, or the production injection/constraint policy. The fake provider does not prove real-model quality, price, remote token-limit compliance, or cache parity.

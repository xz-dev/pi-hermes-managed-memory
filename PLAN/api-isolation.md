# API isolation slice — task 1.1

Scope: minimal official Pi extension package + deterministic fake-provider validation entry, all public API.

## Files

- `package.json` — host packages `@earendil-works/pi-{ai,agent-core,coding-agent,tui}` + `typebox` as `peerDependencies "*"`; devDependencies pinned exact `0.99.2` (`typebox 1.3.27`, `typescript`). `pi.extensions` declares `./src/index.ts`.
- `tsconfig.json` — strict, bundler resolution, typecheck only.
- `src/index.ts` — extension factory exporting default; registers inspect-only `/hermes-memory` command (notify-only, no model work, no writes).
- `test/api-isolation.test.ts` — `node:test` + `--experimental-strip-types` (Node 26), no framework.
- `.gitignore` — `node_modules/`.

## Validation design (test/api-isolation.test.ts)

- Fresh `mkdtempSync("/var/tmp/hermes-1-1-")` is the agentDir; cwd=`agentDir/project/` and HOME=`agentDir/home/`. The test scopes `PI_CODING_AGENT_DIR`, `HOME`, and `USERPROFILE`, then restores them during cleanup.
- `SettingsManager.inMemory(..., { projectTrusted: false })` prevents package-manager ancestor skill discovery. The public loader disables automatic extensions, skills, prompts, themes and context files; only the explicit extension path loads. Explicit system/append prompts suppress prompt-file discovery. Default tools, retry, compaction and cache warming are disabled.
- Deterministic provider: official `fauxProvider()` from `@earendil-works/pi-ai` root export, `fauxAssistantMessage` scripted response.
- Isolated auth: `agentDir/auth.json` written inside fixture with `hermes-faux` api_key; `ModelRuntime.create({authPath, modelsPath, allowModelNetwork:false})`; `registerNativeProvider(faux.provider)`. Settings are in memory and deny project discovery.
- Extension loaded through real `DefaultResourceLoader` (`additionalExtensionPaths: [src/index.ts]`) + `createAgentSession` — not a fake ExtensionContext.
- Assertions: `extensionsResult.errors` empty; `faux.state.callCount===0` after load (no model call on load); no `hermes-memory` dir created; `hermes-memory` command registered; `session.prompt("ping")` → exactly 1 faux call, `stopReason:"stop"`, response `fake-ok`; session file `realpath`-contained under agentDir and contains `fake-ok`.

## Commands

- `npx tsc --noEmit` — clean.
- `npm test` — 1 test, pass.

## Boundary / gaps

- Only public root exports used. pi-ai `@earendil-works/pi-ai/compat` subpath NOT used (faux provider also exported from root).
- Task 1.2 (branch/projection/compaction/context transforms/isolated streamSimple assertions) not implemented — deferred to next slice.
- `session.prompt` runs the full agent loop through the official request path including `before_agent_start`/context transforms; no extra hooks registered by this extension yet.
- Fixture note: `/var/tmp` may itself be a symlink on this machine; assertion canonicalizes via `realpathSync`.

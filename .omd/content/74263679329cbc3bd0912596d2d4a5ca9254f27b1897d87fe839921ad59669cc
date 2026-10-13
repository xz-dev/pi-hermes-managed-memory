import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CAPS, MemoryStore, memorySection, projectRoot, type MemoryEntry } from "../src/memory-store.ts";
import { createMemoryExtension } from "../src/index.ts";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { sdkFixture } from "./sdk-fixture.ts";

function fixture(t: TestContext) {
	const root = mkdtempSync("/var/tmp/hermes-scopes-"), home = join(root, "home"), agent = join(root, "agent");
	for (const path of [home, agent, join(root, "A"), join(root, "B")]) mkdirSync(path);
	const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
	Object.assign(process.env, { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agent, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
	return { root, agent, a: join(root, "A"), b: join(root, "B") };
}
function entry(id: string, fact: string): MemoryEntry {
	return { id, fact, source: { kind: "user-authored" }, created: "unknown", updated: "unknown" };
}
test("A project facts do not enter B while user/global remain shared", t => {
	const f = fixture(t), a = new MemoryStore(f.agent, f.a), b = new MemoryStore(f.agent, f.b);
	a.add(a.read("user"), [entry("user", "I prefer concise replies.")]);
	a.add(a.read("global"), [entry("global", "My workstation uses Linux.")]);
	a.add(a.read("project"), [entry("project-a", "A uses pnpm.")]);
	assert.match(memorySection(a.readAll()).text, /A uses pnpm/);
	const result = memorySection(b.readAll()).text;
	assert.match(result, /concise replies/); assert.match(result, /workstation uses Linux/); assert.doesNotMatch(result, /A uses pnpm/);
	assert.equal(b.read("project").entries.length, 0);
});
test("unresolved project cannot redirect facts globally or accept another project's empty snapshot", t => {
	const f = fixture(t), none = new MemoryStore(f.agent), a = new MemoryStore(f.agent, f.a), b = new MemoryStore(f.agent, f.b);
	assert.throws(() => none.read("project"), /global fallback is forbidden/);
	assert.throws(() => b.add(a.read("project"), [entry("stale", "Only A owns this fact.")]), /another target scope/);
	assert.equal(existsSync(b.path("project")), false);
	assert.equal(none.read("global").entries.length, 0);
});
test("explicit non-Git root must contain the current directory and has canonical identity", t => {
	const f = fixture(t); mkdirSync(join(f.a, "nested"));
	assert.equal(projectRoot(join(f.a, "nested"), f.a), f.a);
	assert.equal(projectRoot(f.b, f.a), undefined);
	assert.equal(projectRoot(f.b), undefined);
	const alias = join(f.root, "alias"); symlinkSync(f.a, alias, "dir");
	assert.equal(projectRoot(alias, alias), f.a);
});
test("worktrees have independent canonical project roots without staging or commits", t => {
	const f = fixture(t), linked = join(f.root, "linked");
	execFileSync("git", ["-C", f.a, "-c", "init.defaultBranch=fixture", "init"], { stdio: "pipe" });
	execFileSync("git", ["-C", f.a, "worktree", "add", "--orphan", "-b", "fixture-linked", linked], { stdio: "pipe" });
	assert.equal(projectRoot(f.a), f.a); assert.equal(projectRoot(linked), linked);
	const a = new MemoryStore(f.agent, projectRoot(f.a)), other = new MemoryStore(f.agent, projectRoot(linked));
	a.add(a.read("project"), [entry("main", "Main worktree only.")]);
	assert.equal(other.read("project").entries.length, 0);
	assert.notEqual(a.project, other.project);
});
test("managed-directory and file symlinks cannot redirect a memory scope", t => {
	const f = fixture(t); mkdirSync(join(f.a, ".pi"));
	symlinkSync(f.b, join(f.a, ".pi", "hermes-memory"), "dir");
	assert.throws(() => new MemoryStore(f.agent, f.a).read("project"), /scope redirect refused/);
	mkdirSync(join(f.agent, "hermes-memory"));
	symlinkSync(join(f.b, "missing.md"), join(f.agent, "hermes-memory", "USER.md"));
	assert.throws(() => new MemoryStore(f.agent).read("user"), /scope redirect refused/);
	assert.equal(existsSync(join(f.b, "PROJECT.md")), false);
});
test("prescribed file capacities are enforced and explicit capacities are effective", t => {
	const f = fixture(t), defaults = new MemoryStore(f.agent);
	assert.deepEqual(defaults.caps, { user: 1375, global: 2200, project: 2200 });
	assert.deepEqual(defaults.caps, CAPS);
	const long = entry("long", "x".repeat(2000));
	assert.throws(() => defaults.add(defaults.read("user"), [long]), /Capacity exceeded/);
	const configured = new MemoryStore(f.agent, undefined, { user: 5000 });
	assert.equal(configured.add(configured.read("user"), [long]).status, "saved");
	assert.equal(configured.read("user").entries[0].fact.length, 2000);
	assert.equal(defaults.add(defaults.read("global"), [entry("unicode", "😀".repeat(1800))]).status, "saved", "capacity counts Unicode scalars, not UTF-16 units");
	assert.throws(() => new MemoryStore(f.agent, undefined, { user: 0 }), /Invalid memory capacity/);
});
test("actual inspector resolves all four targets and native session locator with effective file caps", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project"), caps: { user: 2000 } })(pi)] });
	f.faux.setResponses([fauxAssistantMessage("foreground")]); await f.session.prompt("Normal work.");
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await f.session.prompt("/hermes-memory"); } finally { process.stdout.write = write; }
	const detail = JSON.parse(output.join("").trim()).detail;
	assert.deepEqual(detail.storage.map((target: { target: string }) => target.target), ["user", "global", "project", "session"]);
	assert.equal(detail.storage[0].path, join(f.agentDir, "hermes-memory", "USER.md"));
	assert.equal(detail.storage[0].capacity, 2000);
	assert.equal(detail.storage[2].path, join(f.cwd, ".pi", "hermes-memory", "PROJECT.md"));
	assert.equal(detail.storage[3].scope, f.sessionManager.getSessionId());
	assert.equal(detail.storage[3].leaf, f.sessionManager.getLeafId());
	assert.equal(detail.storage[3].path, f.sessionManager.getSessionFile());
	assert.equal(detail.storage[3].capacity, null, "native session is not an invented short-memory file");
	assert.equal(f.faux.state.callCount, 1, "inspection never calls a model");
});

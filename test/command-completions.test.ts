import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { constraintVersion, SESSION_CUSTOM_TYPE } from "../src/session-constraints.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
async function fixture(t: TestContext) {
	const commands = new Map<string, Command>();
	const f = await sdkFixture(t, { extensions: [pi => {
		const wrapped = Object.create(pi) as ExtensionAPI;
		wrapped.registerCommand = (name, options) => { commands.set(name, options); pi.registerCommand(name, options); };
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(wrapped);
	}] });
	const complete = async (name: string, prefix: string) => {
		const callback = commands.get(name)?.getArgumentCompletions;
		assert.ok(callback, `${name} must register argument completions`);
		return (await callback(prefix))?.map(item => item.value) ?? [];
	};
	return { ...f, complete };
}
function files(root: string): Record<string, string> {
	return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile()).map(entry => {
			const path = join(entry.parentPath, entry.name);
			return [path.slice(root.length), readFileSync(path).toString("base64")];
		}));
}

test("managed-memory commands complete actual actions and only valid target positions", async t => {
	const f = await fixture(t);
	assert.deepEqual(await f.complete("hermes-memory", ""), ["inspect", "refresh", "pending", "approve", "deny", "forget", "rollback", "task", "task-complete", "cancel", "finish"]);
	assert.deepEqual(await f.complete("hermes-memory", "ta"), ["task", "task-complete"]);
	for (const action of ["inspect", "pending", "approve", "deny", "forget", "rollback"]) {
		assert.deepEqual(await f.complete("hermes-memory", `${action} `), ["user", "global", "project"].map(target => `${action} ${target}`));
	}
	assert.deepEqual(await f.complete("hermes-memory", "  approve\t g"), ["approve global"]);
	for (const prefix of ["unknown", "refresh ", "task ", "pending user ", "approve user ", "forget user ", "rollback user "]) {
		assert.deepEqual(await f.complete("hermes-memory", prefix), [], prefix);
	}
	assert.deepEqual(await f.complete("hermes-review", ""), ["status", "usage", "errors", "pause", "resume", "cancel", "retry", "run"]);
	assert.deepEqual(await f.complete("hermes-review", "re"), ["resume", "retry"]);
	for (const prefix of ["enable", "recover", "status ", "retry "]) assert.deepEqual(await f.complete("hermes-review", prefix), [], prefix);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("forget IDs are read only from the selected target without changing memory", async t => {
	const f = await fixture(t);
	const store = new MemoryStore(f.agentDir, f.cwd);
	const entry = (id: string) => ({ id, fact: `Fixture ${id}.`, source: { kind: "user-authored" as const }, created: "unknown", updated: "unknown" });
	store.add(store.read("user"), [entry("user-one"), entry("user-two")]);
	store.add(store.read("global"), [entry("global-only")]);
	const before = files(f.agentDir);
	assert.deepEqual(await f.complete("hermes-memory", "forget user u"), ["forget user user-one", "forget user user-two"]);
	assert.deepEqual(await f.complete("hermes-memory", "forget user user-one "), ["forget user user-one user-two"]);
	assert.deepEqual(await f.complete("hermes-memory", "forget global "), ["forget global global-only"]);
	assert.deepEqual(await f.complete("hermes-memory", "forget project "), []);
	assert.deepEqual(await f.complete("hermes-memory", "forget ../../ "), []);
	assert.deepEqual(files(f.agentDir), before);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("session IDs and expected versions come only from the live current branch", async t => {
	const f = await fixture(t);
	await f.session.prompt("/hermes-memory task selected-task");
	const parent = f.sessionManager.getLeafId()!;
	f.sessionManager.appendMessage({ role: "user", content: "Do not deploy.", timestamp: Date.now() });
	const source = f.sessionManager.getLeafId()!;
	const record = { id: "no-deploy", task: "selected-task", scope: "session" as const, text: "Do not deploy.",
		source: { session: f.sessionManager.getSessionId(), entry: source, quote: "Do not deploy." }, registeredAt: new Date().toISOString() };
	f.sessionManager.appendCustomEntry(SESSION_CUSTOM_TYPE, { v: 1, op: "register", ...record });
	assert.deepEqual(await f.complete("hermes-memory", "task-complete s"), ["task-complete selected-task"]);
	for (const action of ["cancel", "finish"]) {
		assert.deepEqual(await f.complete("hermes-memory", `${action} no`), [`${action} no-deploy`]);
		assert.deepEqual(await f.complete("hermes-memory", `${action} no-deploy `), [`${action} no-deploy ${constraintVersion(record)}`]);
		assert.deepEqual(await f.complete("hermes-memory", `${action} unknown `), []);
		assert.deepEqual(await f.complete("hermes-memory", `${action} no-deploy wrong `), []);
	}
	const leaf = f.sessionManager.getLeafId()!;
	f.sessionManager.branch(parent);
	assert.deepEqual(await f.complete("hermes-memory", "cancel "), []);
	f.sessionManager.branch(leaf);
	assert.deepEqual(await f.complete("hermes-memory", "finish "), ["finish no-deploy"]);
	const before = files(f.agentDir);
	for (const prefix of ["", "approve user ", "forget global ", "cancel ", "finish no-deploy ", "task-complete "]) await f.complete("hermes-memory", prefix);
	for (const prefix of ["", "retry ", "resume "]) await f.complete("hermes-review", prefix);
	assert.deepEqual(files(f.agentDir), before, "Tab does not create locks, recover ledgers, change files or append session entries");
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
	f.session.dispose();
	assert.deepEqual(await f.complete("hermes-memory", "cancel "), []);
});

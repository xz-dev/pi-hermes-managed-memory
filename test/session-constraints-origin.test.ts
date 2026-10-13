import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createMemoryExtension } from "../src/index.ts";
import { foldConstraints, SESSION_CUSTOM_TYPE } from "../src/session-constraints.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const state = (f: Fixture) => foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
const records = (f: Fixture) => f.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === SESSION_CUSTOM_TYPE);
function registration(f: Fixture): object {
	for (const entry of records(f)) {
		if (entry.type === "custom" && entry.data && typeof entry.data === "object" && "op" in entry.data && entry.data.op === "register") return entry.data;
	}
	assert.fail("actual native registration required");
}
async function success(f: Fixture, text: string) {
	await f.session.prompt(text);
	const last = f.sessionManager.getBranch().filter(e => e.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : undefined, "stop", "successful native terminal outside callbacks");
}
async function register(f: Fixture) {
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c", text: "This task do not deploy." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("registered"),
	]);
	await success(f, "This task do not deploy.");
	assert.equal(state(f).constraints.length, 1);
}
async function blocked(f: Fixture) {
	const calls = f.faux.state.callCount, captured: string[] = [], before = records(f);
	f.faux.setResponses([c => { captured.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("MUST NOT SEND"); }]);
	await f.session.prompt("Continue only with verified eligible constraints.");
	assert.equal(f.faux.state.callCount, calls);
	assert.deepEqual(captured, []);
	assert.deepEqual(records(f), before);
	assert.equal(state(f).uncertain, true);
	assert.deepEqual(f.errors, []);
}

test("origin session must be verified, not merely a plausible UUID beside a genuine user quote", async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	await register(f);
	const raw = registration(f);
	f.sessionManager.appendCustomEntry(SESSION_CUSTOM_TYPE, { ...raw, id: "unverified", source: {
		...state(f).constraints[0].source, session: "00000000-0000-4000-8000-000000000000" } });
	await blocked(f);
	assert.equal(state(f).constraints.some(r => r.id === "unverified"), false);
	assert.equal(foldConstraints(f.sessionManager.getBranch()).uncertain, true, "a context-free fold cannot fabricate origin authority");
});

for (const terminal of ["cancel", "finish"] as const) test(`exact original registration replay after ${terminal} stays retired, including older than a fresh valid version`, async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	await register(f);
	const raw = registration(f);
	const original = state(f).constraints[0];
	await f.session.prompt(`/hermes-memory ${terminal} c`);
	assert.equal(state(f).constraints.length, 0);
	// A genuine fresh, explicit same-task registration remains allowed. Its new user origin
	// makes a new version, while every previously retired version remains in the native fold.
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c", text: original.text }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("fresh registration"),
	]);
	await success(f, original.text);
	const fresh = state(f).constraints[0];
	assert.notEqual(fresh.version, original.version);
	await f.session.prompt(`/hermes-memory ${terminal} c`);
	f.sessionManager.appendCustomEntry(SESSION_CUSTOM_TYPE, structuredClone(raw));
	await blocked(f);
	assert.equal(state(f).constraints.length, 0, "replay cannot restore either cancelled version");
});

test("native replacement cannot transfer a session-global ID to the selected other task", async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	await register(f);
	const original = state(f).constraints[0];
	await f.session.prompt("/hermes-memory task b");
	f.sessionManager.appendCustomEntry(SESSION_CUSTOM_TYPE, { v: 1, op: "replace", id: "c", task: "b", scope: "session",
		text: original.text, source: original.source, expect: original.version, registeredAt: new Date().toISOString() });
	await blocked(f);
	assert.equal(state(f).constraints.length, 0);
});

for (const terminal of ["cancel", "finish", "task-complete"] as const) test(`session-global ID ownership survives ${terminal}; other-task collision refuses before append`, async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	await register(f);
	await f.session.prompt(`/hermes-memory ${terminal} ${terminal === "task-complete" ? "a" : "c"}`);
	await f.session.prompt("/hermes-memory task b");
	const before = records(f);
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c", text: "For task b do not restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("refused"),
	]);
	await success(f, "For task b do not restart.");
	const result = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "hermes_memory").at(-1)!;
	assert.equal(result.type === "message" && result.message.role === "toolResult" ? result.message.isError : undefined, true);
	assert.deepEqual(records(f), before);
	assert.equal(state(f).uncertain, false, "foreground refusal leaves the branch healthy");
	assert.deepEqual(f.errors, []);
});

test("genuine native file forks preserve the original session locator and version across ancestry and reload", async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	await register(f);
	const original = state(f).constraints[0], origin = f.sessionManager.getSessionId();
	for (let i = 0; i < 2; i++) {
		assert.ok(f.sessionManager.createBranchedSession(f.sessionManager.getLeafId()!));
		assert.notEqual(f.sessionManager.getSessionId(), origin);
		await f.session.reload();
		const captured: string[] = [];
		f.faux.setResponses([c => { captured.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("forked"); }]);
		await success(f, "Continue the explicitly forked task without re-registering.");
		assert.equal(captured.length, 1);
		assert.ok(captured[0].includes(`${original.source.session}/${original.source.entry}`));
		assert.ok(captured[0].includes(original.version));
		assert.deepEqual(state(f).constraints, [original]);
	}
	f.sessionManager.newSession(); await f.session.reload();
	const captured: string[] = [];
	f.faux.setResponses([c => { captured.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("new"); }]);
	await success(f, "Begin a genuinely new native session.");
	assert.doesNotMatch(captured[0], /Active task constraint/);
	assert.deepEqual(f.errors, []);
});

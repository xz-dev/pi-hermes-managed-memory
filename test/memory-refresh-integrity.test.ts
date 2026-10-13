import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryContext, type SystemLike } from "../src/memory-context.ts";
import { MemoryStore, memorySection, type MemoryEntry } from "../src/memory-store.ts";
import { sdkFixture } from "./sdk-fixture.ts";

const fact = (id: string, text: string): MemoryEntry => ({ id, fact: text, source: { kind: "user-authored" }, created: "unknown", updated: "unknown" });
async function successful(session: Awaited<ReturnType<typeof sdkFixture>>["session"], text: string) {
	await session.prompt(text);
	const last = session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "unsuccessful SDK terminal");
}
function withoutOwn(messages: SystemLike[]): SystemLike[] {
	return messages.map(message => {
		if (message.role !== "system" || !message.sections) return message;
		const { hermes_memory: _own, ...sections } = message.sections;
		return { ...message, sections };
	});
}
function ownedCopies(messages: SystemLike[]): number {
	return messages.filter(message => message.role === "system" && Object.hasOwn(message.sections ?? {}, "hermes_memory")).length;
}

test("forgetting during one tool loop stays excluded on every later request over the original base", async t => {
	let store: MemoryStore, executions = 0, beforeStarts = 0, forgotten: string | undefined;
	const prompts: string[] = [], tools: string[][] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.registerTool({ name: "fixture_step", label: "Fixture", description: "Execute the authorized isolated step", parameters: Type.Object({}), execute: async () => {
			if (++executions === 1) {
				const snapshot = store.read("user");
				forgotten = store.forget(snapshot, [{ id: "retired", expectedFact: "Retired loop fact." }]).status;
			}
			return { content: [{ type: "text", text: "step finished" }], details: undefined };
		} });
		pi.on("before_agent_start", event => { beforeStarts++; event.systemPromptOptions.sections.fixture_reference = "foreign stable reference"; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("retired", "Retired loop fact.")]);
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }, again: boolean) => {
		prompts.push(getCurrentSystemPrompt(context.messages));
		tools.push(getCurrentTools(context.messages).map(tool => tool.name));
		return again ? fauxAssistantMessage(fauxToolCall("fixture_step", {}), { stopReason: "toolUse" }) : fauxAssistantMessage("done");
	};
	f.faux.setResponses([c => capture(c, true), c => capture(c, true), c => capture(c, false)]);
	await successful(f.session, "Run the two isolated steps and retire the fixture fact.");
	assert.equal(forgotten, "saved"); assert.equal(beforeStarts, 1); assert.equal(prompts.length, 3);
	assert.match(prompts[0], /Retired loop fact/);
	for (const prompt of prompts.slice(1)) {
		assert.doesNotMatch(prompt, /Retired loop fact/, "a fresh-old-base must not reopen forgotten eligibility");
		assert.match(prompt, /foreign stable reference/);
	}
	for (const declarations of tools) assert.deepEqual(declarations, ["fixture_step", "hermes_memory", "hermes_session_search"]);
	assert.equal(f.faux.state.callCount, 3); assert.deepEqual(f.errors, []);
});

test("mid-loop unreadable lifecycle metadata clears only the recognized owned block and exposes failure", async t => {
	let store: MemoryStore, context: ExtensionContext | undefined;
	const prompts: string[] = [], tools: string[][] = [], statuses: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		pi.registerTool({ name: "fixture_fault", label: "Fixture", description: "Inject an isolated storage fault", parameters: Type.Object({}), execute: async () => {
			writeFileSync(`${store.path("user")}.lifecycle.json`, "damaged lifecycle receipt");
			return { content: [{ type: "text", text: "fault injected" }], details: undefined };
		} });
		pi.on("before_agent_start", event => { event.systemPromptOptions.sections.fixture_reference = "foreign stable reference"; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("uncertain", "Unverifiable loop fact.")]);
	const original = readFileSync(store.path("user"));
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, setStatus: (key, value) => { if (key === "hermes-memory") statuses.push(value ?? ""); } } });
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages)); tools.push(getCurrentTools(c.messages).map(tool => tool.name));
	};
	f.faux.setResponses([c => { capture(c); return fauxAssistantMessage(fauxToolCall("fixture_fault", {}), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("done"); }]);
	await successful(f.session, "Run the isolated storage fault step.");
	assert.equal(prompts.length, 2); assert.match(prompts[0], /Unverifiable loop fact/);
	assert.doesNotMatch(prompts[1], /Unverifiable loop fact/, "read failure is not permission to carry cached facts");
	assert.match(prompts[1], /foreign stable reference/);
	for (const declarations of tools) assert.deepEqual(declarations, ["fixture_fault", "hermes_memory", "hermes_session_search"]);
	assert.ok(statuses.some(status => /unavailable|stale-context/.test(status)), "the storage failure must be visible");
	assert.deepEqual(readFileSync(store.path("user")), original);
	assert.equal(f.faux.state.callCount, 2); assert.deepEqual(f.errors, []);
});

test("inspection preserves working/injected versions across failed compaction until an explicit refresh", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { settings: { compaction: { enabled: false, keepRecentTokens: 1 } }, extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("first", "First diagnostic fact.")]);
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { notices.push(message); } } });
	f.faux.setResponses([fauxAssistantMessage("ack")]);
	await successful(f.session, "Ordinary task.");
	await f.session.prompt("/hermes-memory inspect");
	const before = JSON.parse(notices.at(-1)!);
	store.add(store.read("user"), [fact("later", "Later disk-only diagnostic fact.")]);
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "isolated compaction failure" })]);
	await assert.rejects(f.session.compact(), /isolated compaction failure/);
	await f.session.prompt("/hermes-memory inspect");
	const after = JSON.parse(notices.at(-1)!);
	assert.notEqual(after.targets.find((target: { target: string }) => target.target === "user").version,
		before.targets.find((target: { target: string }) => target.target === "user").version, "disk version changed");
	assert.equal(after.projection.workingKey, before.projection.workingKey, "inspection/failure does not commit a working rebase");
	assert.deepEqual(after.projection.projected, before.projection.projected, "no new main request was projected");
	assert.equal(after.projection.checkpoint, undefined);
	assert.deepEqual(after.projection.rebases, before.projection.rebases);
	await f.session.prompt("/hermes-memory refresh");
	await f.session.prompt("/hermes-memory inspect");
	const refreshed = JSON.parse(notices.at(-1)!);
	assert.notEqual(refreshed.projection.workingKey, before.projection.workingKey);
	assert.deepEqual(refreshed.projection.projected, before.projection.projected, "refresh is not a claim that a provider request was sent");
	assert.equal(f.faux.state.callCount, 2, "one main prompt and one native failed summary, zero auxiliary memory calls");
	assert.deepEqual(f.errors, []);
});

test("same-turn valid project scope replacement keeps native ownership but never the old eligible facts", async t => {
	let steps = 0, starts = 0;
	const inputs: SystemLike[][] = [], outputs: SystemLike[][] = [];
	const captures: Parameters<typeof getCurrentSystemPrompt>[0][] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("before_agent_start", event => { starts++; event.systemPromptOptions.sections.fixture_reference = "FOREIGN_SCOPE_KEEP"; });
		pi.registerTool({ name: "fixture_scope", label: "Fixture", description: "Change an isolated authorized project root", parameters: Type.Object({}), execute: async () => {
			if (++steps === 1) writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ projectRoot: f.agentDir }));
			return { content: [{ type: "text", text: "scope step finished" }], details: undefined };
		} });
		pi.on("context_with_system", event => { inputs.push(structuredClone(event.messages)); });
		createMemoryExtension()(pi);
		pi.on("context_with_system", event => { outputs.push(structuredClone(event.messages)); });
	}] });
	const oldStore = new MemoryStore(f.agentDir, f.cwd), newStore = new MemoryStore(f.agentDir, f.agentDir);
	oldStore.add(oldStore.read("project"), [fact("old-project", "OLD_CHILD_PROJECT_FACT")]);
	newStore.add(newStore.read("project"), [fact("new-project", "NEW_PARENT_PROJECT_FACT")]);
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ projectRoot: f.cwd }));
	f.faux.setResponses([true, true, false].map(again => context => {
		captures.push(structuredClone(context.messages));
		return again ? fauxAssistantMessage(fauxToolCall("fixture_scope", {}), { stopReason: "toolUse" }) : fauxAssistantMessage("done");
	}));
	await successful(f.session, "Run the authorized fixture project change and another step.");
	assert.equal(starts, 1); assert.equal(captures.length, 3);
	assert.match(getCurrentSystemPrompt(captures[0]), /OLD_CHILD_PROJECT_FACT/);
	for (const messages of captures.slice(1)) {
		const prompt = getCurrentSystemPrompt(messages);
		assert.match(prompt, /NEW_PARENT_PROJECT_FACT/);
		assert.doesNotMatch(prompt, /OLD_CHILD_PROJECT_FACT/);
		assert.match(prompt, /FOREIGN_SCOPE_KEEP/);
		assert.deepEqual(getCurrentTools(messages).map(tool => tool.name), ["fixture_scope", "hermes_memory", "hermes_session_search"]);
	}
	for (const [i, output] of outputs.entries()) {
		assert.equal(ownedCopies(output), 1);
		assert.deepEqual(withoutOwn(output), withoutOwn(inputs[i]), "scope rebase changes only the recognized own key");
	}
	assert.equal(f.faux.state.callCount, 3); assert.deepEqual(f.errors, []);
});

test("single recognized secondary owned slot refreshes in place and replays without duplicating the head", async t => {
	let store: MemoryStore, steps = 0;
	const inputs: SystemLike[][] = [], outputs: SystemLike[][] = [];
	const captures: Parameters<typeof getCurrentSystemPrompt>[0][] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.registerTool({ name: "fixture_slot", label: "Fixture", description: "Write an isolated next memory version", parameters: Type.Object({}), execute: async () => {
			steps++; store.add(store.read("user"), [fact(`new-${steps}`, `New secondary slot fact ${steps}`)]);
			return { content: [{ type: "text", text: "slot step finished" }], details: undefined };
		} });
		pi.on("context_with_system", event => {
			const messages = structuredClone(event.messages), head = messages[0];
			if (steps && head?.role === "system" && typeof head.sections?.hermes_memory === "string") {
				const { hermes_memory: own, ...sections } = head.sections;
				messages[0] = { ...head, sections };
				messages.push({ role: "system", content: "FOREIGN_SECONDARY_CONTENT", sections: { hermes_memory: own, fixture_reference: "FOREIGN_SECONDARY_KEEP" }, timestamp: 0 });
			}
			inputs.push(structuredClone(messages)); return { messages };
		});
		createMemoryExtension()(pi);
		pi.on("context_with_system", event => { outputs.push(structuredClone(event.messages)); });
	}] });
	store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("original", "Original secondary slot fact")]);
	f.faux.setResponses([true, true, false].map(again => context => {
		captures.push(structuredClone(context.messages));
		return again ? fauxAssistantMessage(fauxToolCall("fixture_slot", {}), { stopReason: "toolUse" }) : fauxAssistantMessage("done");
	}));
	await successful(f.session, "Run the two isolated slot steps.");
	assert.equal(captures.length, 3);
	for (const [i, output] of outputs.entries()) {
		assert.equal(ownedCopies(output), 1, "one input owner remains one output owner");
		assert.deepEqual(withoutOwn(output), withoutOwn(inputs[i]));
		if (i) assert.ok(!Object.hasOwn(output[0].sections ?? {}, "hermes_memory"), "do not manufacture a leading owner");
	}
	assert.match(getCurrentSystemPrompt(captures[2]), /New secondary slot fact 2/);
	assert.match(getCurrentSystemPrompt(captures[2]), /FOREIGN_SECONDARY_KEEP/);
	assert.deepEqual(getCurrentTools(captures[2]).map(tool => tool.name), ["fixture_slot", "hermes_memory", "hermes_session_search"]);
	const memory = new MemoryContext(store, 6000, memorySection), scope = { scope: "secondary fixture" };
	const base = memory.base("request", scope);
	const messages: SystemLike[] = [{ role: "system", content: "HEAD_KEEP", sections: { fixture_reference: "HEAD_KEEP" } },
		{ role: "system", content: "TAIL_KEEP", sections: { hermes_memory: `<hermes_memory>\n${base.section.text}\n</hermes_memory>` } }];
	store.add(store.read("user"), [fact("final", "Final secondary slot fact")]);
	const first = memory.project(messages, scope), replay = memory.project(first.messages, scope);
	assert.equal(ownedCopies(first.messages), 1); assert.equal(replay.projection.stale, undefined);
	assert.deepEqual(withoutOwn(first.messages), withoutOwn(messages));
	assert.strictEqual(replay.messages, first.messages, "already-projected replay is inert");
	assert.equal(f.faux.state.callCount, 3); assert.deepEqual(f.errors, []);
});

test("status interval cannot keep using a disposed public context", async t => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let context: ExtensionContext | undefined;
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui } });
	t.mock.timers.tick(1000);
	f.session.dispose();
	const guards = [() => context!.sessionManager.getSessionId(), () => context!.isProjectTrusted(), () => context!.getContextUsage()]
		.map(read => { try { read(); return false; } catch { return true; } });
	assert.deepEqual(guards, [true, true, true], "the stock public context itself is revoked after disposal");
	assert.doesNotThrow(() => t.mock.timers.tick(1000), "dispose/reload invalidates the context, not just its visible UI");
	assert.doesNotThrow(() => t.mock.timers.tick(1000), "no continuing stale periodic callback");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("a missing previously nonempty owned slot does not authorize blind insertion or system-string deletion", async t => {
	const f = await sdkFixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("owned", "Owned fixture fact.")]);
	const memory = new MemoryContext(store, 6000, memorySection), scope = { scope: "fixture" };
	const base = memory.base("request", scope);
	const moved = [{ role: "system", content: `<hermes_memory>\n${base.section.text}\n</hermes_memory>`, sections: { fixture_reference: "foreign stable reference" }, timestamp: 0 },
		{ role: "user", content: "next", timestamp: 1 }];
	const original = structuredClone(moved);
	const result = memory.project(moved, scope);
	assert.equal(result.projection.stale, "owned-slot-missing");
	assert.deepEqual(result.messages, original, "unrecognized system content remains byte-identical");
});

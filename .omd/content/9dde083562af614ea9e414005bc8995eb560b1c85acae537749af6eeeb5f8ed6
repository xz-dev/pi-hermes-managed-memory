import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { MemoryStore, memorySection, type MemoryEntry } from "../src/memory-store.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const sourced = (id: string, fact: string): MemoryEntry => ({ id, fact,
	source: { session: "seed-session", entry: "seed-entry", quote: fact }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" });

/** Provider callback assertions become SDK error turns; assert success outside callbacks (4.1 lesson). */
async function promptSucceeded(session: Fixture["session"], text: string): Promise<void> {
	await session.prompt(text);
	const last = session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant", "the SDK request must finish with an assistant response");
	if (last?.message.role === "assistant") assert.notEqual(last.message.stopReason, "error", last.message.errorMessage ?? "SDK request failed");
}
const hermesBlock = (prompt: string) => /<hermes_memory>\n([\s\S]*?)\n<\/hermes_memory>/.exec(prompt)?.[0];

test("native auto-compaction mid-tool-loop refreshes the owned section without a new user boundary", async t => {
	let beforeStarts = 0, compactions = 0, failures = 0;
	const requests: { prompt: string; tools: string[]; firstRole: string }[] = [];
	const f = await sdkFixture(t, {
		models: [{ id: "compact-fixture", contextWindow: 8000, maxTokens: 100 }],
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensions: [pi => {
			pi.registerTool({
				name: "fixture_output", label: "Fixture", description: "Produce isolated fixture evidence",
				parameters: Type.Object({}),
				execute: async () => {
					// The extension's own tool path commits a new disk version inside the tool loop.
					store.add(store.read("user"), [sourced("v2fact", "Version two fixture fact.")]);
					return { content: [{ type: "text", text: "fixture output ".repeat(4000) }], details: undefined };
				},
			});
			pi.on("before_agent_start", event => {
				beforeStarts++;
				event.systemPromptOptions.sections.fixture_reference = "other-extension-stable-section";
			});
			// Public deterministic native compaction override (1.2 pattern); no plugin-paid summary.
			pi.on("session_before_compact", event => ({ compaction: {
				summary: "fixture compacted summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			} }));
			pi.on("session_compact", () => { compactions++; });
			pi.on("session_compact_failed", () => { failures++; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("v1fact", "Version one fixture fact.")]);
	f.faux.setResponses([
		context => {
			requests.push({ prompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages).map(tool => tool.name), firstRole: context.messages[0]?.role ?? "missing" });
			return fauxAssistantMessage(fauxToolCall("fixture_output", {}), { stopReason: "toolUse" });
		},
		context => {
			requests.push({ prompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages).map(tool => tool.name), firstRole: context.messages[0]?.role ?? "missing" });
			return fauxAssistantMessage("finished after compaction");
		},
	]);
	// The tool commits the new disk version while the SAME turn is still running.
	await promptSucceeded(f.session, "Run the isolated fixture tool.");
	assert.equal(beforeStarts, 1, "no new user boundary between the two provider requests");
	assert.ok(compactions >= 1, "native auto-compaction must have run inside the tool loop");
	assert.equal(failures, 0);
	assert.equal(requests.length, 2);
	assert.match(requests[0].prompt, /Version one fixture fact/);
	assert.match(requests[1].prompt, /Version two fixture fact/, "next tool-loop request sees the committed v2 without a new before_agent_start");
	// One owned block only: prior facts never persist as parallel effective copies.
	assert.equal(requests[1].prompt.match(/<hermes_memory>/g)?.length, 1, "exactly one owned section");
	assert.match(requests[1].prompt, /other-extension-stable-section/);
	for (const request of requests) {
		assert.equal(request.firstRole, "system");
		assert.deepEqual(request.tools, ["fixture_output", "hermes_memory", "hermes_session_search"], "tool declarations stay intact");
	}
	// Foreground requests only; compaction summary came from the public local override.
	assert.equal(f.faux.state.callCount, 2);
	assert.deepEqual(f.errors, []);
});

test("store write between turns refreshes the next request; compacted transcript keeps one owned block", async t => {
	let compactions = 0;
	const requests: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_compact", () => { compactions++; });
			// Local summary override: no paid/plugin model work for the native compaction itself.
			pi.on("session_before_compact", event => ({ compaction: {
				summary: "fixture manual summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			} }));
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("first", "First disk fact.")]);
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		requests.push(getCurrentSystemPrompt(context.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "turn one");
	const v1Block = hermesBlock(requests.at(-1)!);
	assert.match(v1Block!, /First disk fact/);
	// Tool-loop-free path: a committed write between prompts re-renders the next request.
	store.add(store.read("user"), [sourced("second", "Second disk fact.")]);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "turn two");
	assert.match(requests.at(-1)!, /Second disk fact/);
	assert.equal(requests.at(-1)!.match(/<hermes_memory>/g)?.length, 1);
	assert.notEqual(hermesBlock(requests.at(-1)!), v1Block, "the working snapshot version changed");
	// Manual compaction followed by another store write refreshes the post-compaction request.
	store.add(store.read("user"), [sourced("third", "Post-compaction disk fact.")]);
	await f.session.compact();
	assert.equal(compactions, 1);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "turn three after compaction");
	assert.match(requests.at(-1)!, /Post-compaction disk fact/);
	assert.equal(requests.at(-1)!.match(/<hermes_memory>/g)?.length, 1, "compaction rebase keeps a single owned block");
	assert.doesNotMatch(requests.at(-1)!, /turn one|turn two/, "compacted history is not re-injected");
	assert.deepEqual(f.errors, []);
});

test("failed and cancelled native compaction commit no refresh or new injected version", async t => {
	let compactions = 0;
	const failures: { aborted: boolean }[] = [];
	const prompts: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_compact", () => { compactions++; });
			pi.on("session_compact_failed", event => { failures.push({ aborted: event.aborted }); });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("kept", "Kept fixture fact.")]);
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(context.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "first task");
	// Failed compaction: faux summary request errors.
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture compaction failure" })]);
	await assert.rejects(f.session.compact(), /fixture compaction failure/);
	store.add(store.read("user"), [sourced("late", "Late committed fact.")]);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "second task");
	assert.match(prompts.at(-1)!, /Late committed fact/, "ordinary working snapshot still applies after failure");
	assert.equal(compactions, 0, "no successful compaction was claimed");
	assert.deepEqual(failures, [{ aborted: false }]);
	// Cancelled compaction via a fixture hook: no provider request, no committed refresh.
	let cancel = false;
	const f2 = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_before_compact", () => cancel ? { cancel: true } : undefined);
			pi.on("session_compact_failed", event => { failures.push({ aborted: event.aborted }); });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	const store2 = new MemoryStore(f2.agentDir, f2.cwd);
	store2.add(store2.read("user"), [sourced("kept2", "Second fixture fact.")]);
	f2.faux.setResponses([capture]);
	await promptSucceeded(f2.session, "task");
	cancel = true;
	const calls = f2.faux.state.callCount;
	await assert.rejects(f2.session.compact(), /cancelled/i);
	assert.equal(f2.faux.state.callCount, calls, "cancelled compaction made no provider request at all");
	f2.faux.setResponses([capture]);
	await promptSucceeded(f2.session, "after cancel");
	assert.match(prompts.at(-1)!, /Second fixture fact/);
	assert.deepEqual(failures, [{ aborted: false }, { aborted: true }]);
	assert.deepEqual(f.errors, []);
	assert.deepEqual(f2.errors, []);
});

test("explicit /hermes-memory refresh rebases the next request; unchanged turns reuse the stable block", async t => {
	const prompts: string[] = [];
	let context: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("a", "Alpha fixture fact.")]);
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(context.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "task one");
	const v1 = hermesBlock(prompts[0]!);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "task two");
	assert.equal(hermesBlock(prompts[1]!), v1, "unchanged turn reuses the stable block, no second copy");
	const notices: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { notices.push(message); } } });
	await f.session.prompt("/hermes-memory refresh");
	const refreshed = JSON.parse(notices.at(-1)!);
	assert.equal(refreshed.status, "refreshed");
	assert.equal(refreshed.basis, "refresh");
	assert.ok(Array.isArray(refreshed.working) && refreshed.working.length >= 1, "distinct disk/read version records are inspectable");
	assert.ok(typeof refreshed.workingKey === "string" && typeof refreshed.baseKey === "string");
	store.add(store.read("user"), [sourced("c", "Gamma fixture fact.")]);
	await f.session.prompt("/hermes-memory refresh");
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "task five");
	assert.match(prompts.at(-1)!, /Gamma fixture fact/, "explicit refresh applies the latest allowed version next effective request");
	// Inspect exposes working/base/projected/checkpoint distinctly.
	notices.length = 0;
	await f.session.prompt("/hermes-memory inspect");
	const inspected = JSON.parse(notices.at(-1)!);
	assert.ok(inspected.projection, "inspect surfaces the version records");
	assert.ok(typeof inspected.projection.workingKey === "string");
	assert.ok(typeof inspected.projection.projected?.key === "string");
	assert.equal(f.faux.state.callCount, 3, "refresh/inspect commands never call the provider");
	assert.deepEqual(f.errors, []);
});

test("new session and project boundary rebase the owned block; foreign scope stays out", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	const dirB = join(f.agentDir, "project-b");
	mkdirSync(dirB);
	const storeA = new MemoryStore(f.agentDir, f.cwd), storeB = new MemoryStore(f.agentDir, dirB);
	storeA.add(storeA.read("project"), [sourced("pa", "Project A marker.")]);
	storeB.add(storeB.read("project"), [sourced("pb", "Project B marker.")]);
	const prompts: string[] = [];
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(context.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "A task");
	assert.match(prompts.at(-1)!, /Project A marker/);
	f.session.dispose();
	await f.loader.reload();
	const second = await createAgentSession({
		cwd: f.cwd, agentDir: f.agentDir, model: f.model, modelRuntime: f.modelRuntime, settingsManager: f.settingsManager,
		sessionManager: SessionManager.create(f.cwd, join(f.agentDir, "sessions")), resourceLoader: f.loader, noTools: "builtin",
	});
	t.after(() => second.session.dispose());
	await second.session.bindExtensions({ mode: "json" });
	f.faux.setResponses([capture]);
	await promptSucceeded(second.session, "new session task");
	assert.match(prompts.at(-1)!, /Project A marker/, "new session re-bases onto the current working snapshot");
	const loaderB = new DefaultResourceLoader({
		cwd: dirB, agentDir: f.agentDir, settingsManager: f.settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		appendSystemPrompt: [], extensionFactories: [pi => createMemoryExtension({ projectRoot: dirB })(pi)],
	});
	await loaderB.reload();
	const { session: b, extensionsResult } = await createAgentSession({
		cwd: dirB, agentDir: f.agentDir, model: f.model, modelRuntime: f.modelRuntime, settingsManager: f.settingsManager,
		sessionManager: SessionManager.create(dirB, join(f.agentDir, "sessions")), resourceLoader: loaderB, noTools: "builtin",
	});
	assert.deepEqual(extensionsResult.errors, []);
	await b.bindExtensions({ mode: "json" });
	t.after(() => b.dispose());
	f.faux.setResponses([capture]);
	await promptSucceeded(b, "B task");
	assert.match(prompts.at(-1)!, /Project B marker/);
	assert.doesNotMatch(prompts.at(-1)!, /Project A marker/, "project boundary never leaks the sibling scope");
	assert.deepEqual(f.errors, []);
});

test("repeated projection over fresh-old-base and already-projected requests is idempotent; foreign slots go stale", async t => {
	const statuses: string[] = [];
	let context: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("x", "Idempotent fixture fact.")]);
	const prompts: string[] = [];
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "seed");
	const v1Block = hermesBlock(prompts.at(-1)!)!;
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, setStatus: (key, value) => { if (key === "hermes-memory") statuses.push(value ?? ""); } } });
	// Commit v2 and verify the already-projected block is replaced exactly once, twice in a row.
	store.add(store.read("user"), [sourced("y", "Newer idempotent fact.")]);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "after v2");
	const v2Block = hermesBlock(prompts.at(-1)!)!;
	assert.match(v2Block, /Newer idempotent fact/);
	assert.equal(prompts.at(-1)!.match(/<hermes_memory>/g)?.length, 1);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "unchanged");
	assert.equal(hermesBlock(prompts.at(-1)!), v2Block, "re-projection over an already-projected request changes nothing");
	// Foreign owned-slot content is never overwritten; it surfaces as stale-context instead.
	const foreign: string[] = [];
	f.faux.setResponses([c => {
		foreign.push(JSON.stringify(c.messages.filter(m => m.role === "system").map(m => m.sections?.hermes_memory)));
		return fauxAssistantMessage("ack");
	}]);
	// Simulate a foreign writer by mutating the transcript through a public context_edit-free path is not exposed;
	// instead assert the store-level guard: a slot not matching our own projection stays untouched.
	const { MemoryContext } = await import("../src/memory-context.ts");
	const mc = new MemoryContext(store, 6000, memorySection);
	const scope = { scope: "fixture" };
	mc.base("request", scope);
	const foreignMessages = [
		{ role: "system", content: "", sections: { hermes_memory: "foreign authored block", preamble: "keep" }, timestamp: 0 },
		{ role: "user", content: "next", timestamp: 1 },
	];
	const outcome = mc.project(foreignMessages, scope);
	assert.equal(outcome.projection.stale, "owned-slot-foreign-content");
	assert.equal(outcome.messages[0].sections?.hermes_memory, "foreign authored block", "foreign system data is never overwritten");
	// Duplicate owned slots also refuse to be silently collapsed into deletion.
	const duplicated = mc.project([
		{ role: "system", content: "", sections: { hermes_memory: "a" }, timestamp: 0 },
		{ role: "system", content: "", sections: { hermes_memory: "b" }, timestamp: 1 },
		{ role: "user", content: "next", timestamp: 2 },
	], scope);
	assert.equal(duplicated.projection.stale, "duplicate-owned-section");
	// A fresh-old-base (slot = own previously projected text, working advanced) re-projects cleanly.
	const fresh = new MemoryContext(store, 6000, memorySection);
	fresh.base("request", scope);
	const oldRendered = memorySection(store.readAll(), 6000).text;
	const projected1 = fresh.project([
		{ role: "system", content: "", sections: { hermes_memory: `<hermes_memory>\n${oldRendered}\n</hermes_memory>` }, timestamp: 0 },
		{ role: "user", content: "n", timestamp: 1 },
	], scope);
	assert.equal(projected1.projection.stale, undefined);
	const projected2 = fresh.project(projected1.messages, scope);
	assert.equal(projected2.messages, projected1.messages, "second projection over an already-projected request is a no-op");
	store.add(store.read("user"), [sourced("z", "Third fact.")]);
	const projected3 = fresh.project([
		{ role: "system", content: "", sections: { hermes_memory: projected1.messages[0].sections?.hermes_memory as string }, timestamp: 0 },
		{ role: "user", content: "n2", timestamp: 2 },
	], scope);
	assert.equal(projected3.projection.stale, undefined, "fresh-old-base still matches own projected text and rebases");
	assert.match(projected3.messages[0].sections?.hermes_memory as string, /Third fact/);
	assert.deepEqual(f.errors, []);
});

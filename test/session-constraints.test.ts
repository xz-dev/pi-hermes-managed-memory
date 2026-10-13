import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore, memorySection } from "../src/memory-store.ts";
import { foldConstraints, SESSION_CUSTOM_TYPE } from "../src/session-constraints.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const fact = (id: string, text: string) => ({ id, fact: text, source: { kind: "user-authored" as const }, created: "unknown", updated: "unknown" });
/** Successful native terminal asserted outside provider callbacks (4.1 lesson). */
async function promptSucceeded(session: Fixture["session"], text: string) {
	await session.prompt(text);
	const last = session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "unsuccessful SDK terminal");
}
const lastAssistant = (f: Fixture) => f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "assistant").at(-1);
const toolResults = (f: Fixture, toolName = "hermes_memory") =>
	f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "toolResult" &&
		(entry.message as { toolName?: string }).toolName === toolName);
const customRecords = (f: Fixture) => f.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === SESSION_CUSTOM_TYPE);

test("registered 'this task do not deploy' survives native mid-loop compaction in the next actual request", async t => {
	let compactions = 0;
	const prompts: string[] = [], tools: string[][] = [];
	const f = await sdkFixture(t, {
		models: [{ id: "compact-fixture", contextWindow: 8000, maxTokens: 100 }],
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
		extensions: [pi => {
			pi.registerTool({ name: "fixture_output", label: "Fixture", description: "Produce isolated fixture evidence",
				parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "fixture output ".repeat(4000) }], details: undefined }) });
			// Public deterministic native compaction override (1.2 pattern); no plugin-paid summary.
			pi.on("session_before_compact", event => ({ compaction: {
				summary: "fixture compacted summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			} }));
			pi.on("session_compact", () => { compactions++; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	const capture = (context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(context.messages));
		tools.push(getCurrentTools(context.messages).map(tool => tool.name));
	};
	// Turn 1: ordinary user instruction; model registers it via the foreground tool.
	f.faux.setResponses([c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", {
		action: "task", task: "deploy-safety" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", {
			action: "register", id: "no-deploy", text: "This task do not deploy." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("registered"); }]);
	await promptSucceeded(f.session, "This task do not deploy.");
	assert.equal(prompts.length, 3);
	// Registration request/result lands inside the same turn; the request AFTER register carries it.
	assert.doesNotMatch(prompts[0], /do not deploy.*Active task constraint/s);
	assert.match(prompts[2], /Active task constraint/);
	assert.match(prompts[2], /This task do not deploy\./);
	assert.match(prompts[2], /task=\\?"?deploy-safety|deploy-safety/);
	assert.equal(customRecords(f).length, 2);
	// Ordinary continuation keeps the constraint; no new task was selected.
	f.faux.setResponses([c => { capture(c); return fauxAssistantMessage(fauxToolCall("fixture_output", {}), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("done after compaction"); }]);
	await promptSucceeded(f.session, "Continue the same task.");
	assert.ok(compactions >= 1, "native compaction must have run mid-loop");
	assert.equal(prompts.length, 5);
	// Mid-loop request after successful compaction still carries the active constraint once.
	for (const prompt of prompts.slice(3)) {
		assert.match(prompt, /Active task constraint: "This task do not deploy\./);
		assert.equal(prompt.match(/<hermes_memory>/g)?.length, 1);
	}
	assert.deepEqual(tools.at(-1), ["fixture_output", "hermes_memory", "hermes_session_search"]);
	assert.equal(f.faux.state.callCount, 5);
	assert.deepEqual(f.errors, []);
});

test("explicit cancel/complete and a new explicit task exclude the old constraint from actual requests", async t => {
	const prompts: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages));
		return fauxAssistantMessage("ack");
	};
	// Register on task A.
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	assert.match(prompts.at(-1)!, /never restart/);
	// Cancel: next actual request must omit the constraint.
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "cancel", id: "c1" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "Cancel that constraint and continue task a.");
	assert.doesNotMatch(prompts.at(-1)!, /Active task constraint/, "cancelled constraint absent from next actual request");
	// Register another on task A, then explicitly switch to task B: no inheritance.
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c2", text: "For task a keep it read-only." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "b" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "For task a keep it read-only.");
	assert.equal(prompts.length, 8);
	assert.doesNotMatch(prompts.at(-1)!, /Active task constraint/, "task b does not inherit task a constraints");
	assert.equal(f.faux.state.callCount, 8);
	assert.deepEqual(f.errors, []);
});

test("a sibling branch without registration never inherits the active constraint", async t => {
	const prompts: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	// Public branch seam: fork before the constraint entries; the sibling branch has none.
	const parent = f.sessionManager.getBranch()
		.filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
	const oldLeaf = f.sessionManager.getLeafId()!;
	f.sessionManager.branch(parent.id);
	f.sessionManager.appendMessage({ role: "user", content: "sibling question", timestamp: Date.now() });
	const fold = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(fold.constraints.length, 0, "fold is branch-local; sibling never sees the custom records");
	// The same extension still folds only the current branch on the next actual request.
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "answer the sibling");
	assert.doesNotMatch(prompts.at(-1)!, /Active task constraint/);
	// Returning to the original branch restores the active constraint.
	f.sessionManager.branch(oldLeaf);
	f.faux.setResponses([capture]);
	await promptSucceeded(f.session, "back to original branch");
	assert.match(prompts.at(-1)!, /Active task constraint: "For task a never restart\./);
	assert.equal(f.faux.state.callCount, 5);
	assert.deepEqual(f.errors, []);
});

test("unfit registration is refused without native append; duplicate/stale/foreign sources refused", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project"), injectionBudget: 120 })(pi)],
	});
	const toolCalls = [
		fauxToolCall("hermes_memory", { action: "task", task: "a" }),
		fauxToolCall("hermes_memory", { action: "register", id: "big", text: "X".repeat(200) }),
		fauxToolCall("hermes_memory", { action: "view" }),
	];
	f.faux.setResponses(toolCalls.map(call => () => fauxAssistantMessage(call, { stopReason: "toolUse" })).concat([() => fauxAssistantMessage("done")]));
	await f.session.prompt("For task a: " + "X".repeat(200));
	const results = toolResults(f);
	assert.equal(results.length, 3);
	const refused = results[1].type === "message" ? results[1].message as { isError?: boolean; content?: unknown } : assert.fail("tool result expected");
	assert.equal(refused.isError, true, "over-cap registration must surface as an error result");
	assert.match(JSON.stringify(refused.content), /constraint-capacity|exceed injection budget/);
	const records = customRecords(f);
	assert.equal(records.length, 1, "only the task switch was appended; refused register wrote nothing");
	const viewMessage = results[2].type === "message" ? results[2].message : undefined;
	const view = JSON.stringify(viewMessage?.role === "toolResult" ? viewMessage.content : []);
	assert.match(view, /\\"task\\":\\"a\\"/, "view reports the selected task");
	assert.doesNotMatch(view, /\\"id\\":\\"big/, "view confirms no active 'big' constraint");
	const last = lastAssistant(f);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : undefined, "stop");
	assert.equal(f.faux.state.callCount, 4);
	assert.deepEqual(f.errors, []);
});

test("a later tiny budget blocks the actual foreground provider request with zero calls", async t => {
	let context: ExtensionContext | undefined;
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => {
			pi.on("session_start", (_e, ctx) => { context = ctx; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	// Register a valid active constraint while the budget still fits.
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	assert.equal(f.faux.state.callCount, 3);
	assert.equal(customRecords(f).length, 2);
	// Tighten the shared budget so the existing active set can no longer fit.
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: 40 }));
	const calls = f.faux.state.callCount;
	f.faux.setResponses([() => fauxAssistantMessage("MUST-NOT-SEND")]);
	await f.session.prompt("continue task a");
	// Public input gate consumed the submission: no provider request, no assistant turn, state intact.
	assert.equal(f.faux.state.callCount, calls, "zero foreground provider calls while the gate holds");
	const branch = f.sessionManager.getBranch();
	const lastAssistantEntry = branch.filter(entry => entry.type === "message" && entry.message.role === "assistant").at(-1);
	assert.equal(lastAssistantEntry?.type === "message" && lastAssistantEntry.message.role === "assistant" ? lastAssistantEntry.message.stopReason : undefined, "stop",
		"last assistant message remains the earlier successful turn, not an SDK-converted error");
	assert.ok(!branch.some(entry => entry.type === "message" && entry.message.role === "user" &&
		JSON.stringify((entry.message as { content?: unknown }).content).includes("continue task a")), "blocked input never entered native history as a request");
	assert.equal(customRecords(f).length, 2, "gate never mutates session constraint state");
	// Restore budget: the same input becomes an ordinary successful request.
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: 6000 }));
	f.faux.setResponses([c => {
		assert.match(getCurrentSystemPrompt(c.messages), /Active task constraint: "For task a never restart\./);
		return fauxAssistantMessage("ack");
	}]);
	await promptSucceeded(f.session, "continue task a");
	assert.equal(f.faux.state.callCount, calls + 1);
	assert.deepEqual(f.errors, []);
});

test("mid-loop tool gate terminates the batch with an actionable reason and zero further requests", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	// Fixture tool shrinks the shared budget inside the tool loop; the plugin's hermes_memory
	// gate-check call afterwards is blocked and terminates the batch before the next request.
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	const shrinker = Type.Object({});
	let shrunk = false;
	const f2 = f;
	const extra = await (async () => {
		// register fixture tool on same loader is not possible post-hoc; instead script the model to
		// call hermes_memory gate-check after a fixture step that tightened the budget before the turn.
	})();
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => {
			if (!shrunk) { shrunk = true; writeFileSync(join(f2.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: 40 })); }
			return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "gate-check" }), { stopReason: "toolUse" });
		},
		() => fauxAssistantMessage("MUST-NOT-SEND"),
	]);
	await f.session.prompt("For task a never restart.");
	const results = toolResults(f);
	const gateEntry = results.at(-1)!;
	const gate = gateEntry.type === "message" ? gateEntry.message as { isError?: boolean; content?: unknown } : assert.fail("tool result expected");
	assert.equal(gate.isError, true);
	assert.match(JSON.stringify(gate.content), /session-constraint-budget|restore the budget/);
	assert.equal(f.faux.state.callCount, 3, "the fourth scripted response was never requested");
	const lastA = lastAssistant(f);
	assert.equal(lastA?.type === "message" && lastA.message.role === "assistant" ? lastA.message.stopReason : undefined, "toolUse",
		"turn terminates on the tool batch; no SDK-converted error or hidden retry");
	assert.equal(customRecords(f).length, 2);
	assert.deepEqual(f.errors, []);
});

test("/hermes-memory inspect surfaces the session fold (task, constraints, source, version)", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => {
			pi.on("session_start", (_e, ctx) => { context = ctx; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { notices.push(message); } } });
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	await f.session.prompt("/hermes-memory inspect");
	const inspected = JSON.parse(notices.at(-1)!);
	assert.equal(inspected.session.task, "a");
	assert.equal(inspected.session.constraints.length, 1);
	const record = inspected.session.constraints[0];
	assert.equal(record.id, "c1"); assert.equal(record.task, "a"); assert.equal(record.scope, "session");
	assert.ok(record.version && record.source, "inspect exposes source entry and version");
	assert.equal(f.faux.state.callCount, 3, "inspect never calls the provider");
	assert.deepEqual(f.errors, []);
});

test("view is read-only: it appends nothing and cannot act as a registration", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "view" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "This task keep it reversible.");
	assert.equal(customRecords(f).length, 1, "view made no state transition");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.task, "a");
	assert.equal(state.constraints.length, 0);
	// A stale replace/cancel on an unknown id is refused without append.
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "cancel", id: "ghost" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Cancel the ghost constraint.");
	assert.equal(customRecords(f).length, 1);
	const refusedEntry = toolResults(f).at(-1)!;
	const refused = refusedEntry.type === "message" ? refusedEntry.message as { isError?: boolean; content?: unknown } : assert.fail("tool result expected");
	assert.equal(refused.isError, true);
	assert.match(JSON.stringify(refused.content), /unknown active constraint/);
	assert.equal(f.faux.state.callCount, 5);
	assert.deepEqual(f.errors, []);
});

test("constraints displace durable facts within the exact complete-block cap", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project"), injectionBudget: 6000 })(pi)],
	});
	const store = new MemoryStore(f.agentDir, f.cwd);
	// Two ~500-scalar facts: with the constraint taking headroom, the cap must omit one or both
	// rather than truncate a fact or drop the constraint.
	store.add(store.read("user"), [fact("f1", "F".repeat(500)), fact("f2", "G".repeat(500))]);
	const prompts: string[] = [];
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	const last = prompts.at(-1)!;
	const block = last.match(/<hermes_memory>[\s\S]*?<\/hermes_memory>/)?.[0] ?? "";
	assert.match(block, /Active task constraint: "For task a never restart\./, "constraint rides first");
	assert.ok([...block].length <= 6000, "emitted owned block stays within the exact cap");
	assert.ok(block.indexOf("Active task constraint") < block.indexOf("Source-quoted reference fact") || !block.includes("Source-quoted reference fact"),
		"constraints are emitted before any durable fact line");
	// Unit-level budget proof: same renderer used by projection — constraints first, facts only after.
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	const tight = memorySection(store.readAll(), 6000, { constraints: ["[session constraint] x\n"], constraintIds: ["x"] });
	assert.equal(tight.constraintOmitted, undefined);
	const blockedRender = memorySection(store.readAll(), 10, { constraints: ["[session constraint] x\n"], constraintIds: ["x"] });
	assert.equal(blockedRender.constraintOmitted, true, "whole active set fails closed below the cap");
	assert.equal(state.constraints.length, 1);
	assert.equal(f.faux.state.callCount, 3);
	assert.deepEqual(f.errors, []);
});

test("task-complete terminalizes the whole task; reselecting the id does not revive constraints", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	const prompts: string[] = [];
	const capture = (c: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
		prompts.push(getCurrentSystemPrompt(c.messages));
		return fauxAssistantMessage("ack");
	};
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task-complete", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "Complete task a.");
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "b" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "Select task b.");
	f.faux.setResponses([
		c => { capture(c); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }); },
		c => { capture(c); return fauxAssistantMessage("ok"); },
	]);
	await promptSucceeded(f.session, "Select task a again.");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.task, "a");
	assert.equal(state.constraints.length, 0, "task-complete terminalized task a; reselect does not revive");
	assert.ok(state.completedTasks.includes("a"));
	assert.doesNotMatch(prompts.at(-1)!, /Active task constraint/);
	assert.equal(f.faux.state.callCount, 9);
	assert.deepEqual(f.errors, []);
});

test("register accepts an explicit on-branch user source locator and refuses assistant sources", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	f.faux.setResponses([
		() => fauxAssistantMessage("ack"),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Remember: never deploy on Fridays.");
	await promptSucceeded(f.session, "Select task a.");
	const firstUser = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user")[0];
	assert.ok(firstUser);
	// Register citing the first user entry by explicit locator, not the latest prompt.
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "never deploy on Fridays", source: firstUser.id }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Register the deploy freeze for task a.");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.constraints.length, 1);
	assert.equal(state.constraints[0].source.entry, firstUser.id);
	assert.equal(state.constraints[0].source.session, f.sessionManager.getSessionId(), "recorded source names the real session");
	const assistantEntry = f.sessionManager.getBranch().find(e => e.type === "message" && e.message.role === "assistant")!;
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c2", text: "never deploy on Fridays", source: assistantEntry.id }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Try registering with an assistant source.");
	const refusedEntry = toolResults(f).at(-1)!;
	const refused = refusedEntry.type === "message" ? refusedEntry.message as { isError?: boolean } : assert.fail("tool result expected");
	assert.equal(refused.isError, true);
	assert.equal(foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined).constraints.length, 1);
	assert.equal(f.faux.state.callCount, 7);
	assert.deepEqual(f.errors, []);
});

test("replace/cancel/stale-version and duplicate tool flows append only the intended transition", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	const version = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined).constraints[0].version;
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "replace", id: "c1", text: "x", expect: "bogus" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Try replacing with a stale version.");
	assert.equal(customRecords(f).length, 2, "stale replace made no append");
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "Register c1 again.");
	assert.equal(customRecords(f).length, 2, "duplicate registration made no append");
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "replace", id: "c1", text: "For task a never restart.", expect: version }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "finish", id: "c1" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart. Then finish c1.");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.constraints.length, 0, "finish with the folded version terminalizes");
	assert.equal(f.faux.state.callCount, 10);
	assert.deepEqual(f.errors, []);
});

test("failed and cancelled native compaction leave the registered constraint state intact", async t => {
	let compactions = 0;
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_compact", () => { compactions++; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	const before = customRecords(f).length;
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture compaction failure" })]);
	await assert.rejects(f.session.compact(), /fixture compaction failure/);
	let state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.constraints.length, 1, "failed compaction did not drop the active constraint");
	assert.equal(customRecords(f).length, before);
	assert.equal(compactions, 0);
	const prompts: string[] = [];
	f.faux.setResponses([c => { prompts.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("ack"); }]);
	await promptSucceeded(f.session, "continue task a");
	assert.match(prompts.at(-1)!, /Active task constraint: "For task a never restart\./);
	let cancel = false;
	const f2 = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_before_compact", () => cancel ? { cancel: true } : undefined);
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	f2.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f2.session, "For task a never restart.");
	cancel = true;
	const calls = f2.faux.state.callCount;
	await assert.rejects(f2.session.compact(), /cancelled/i);
	assert.equal(f2.faux.state.callCount, calls, "cancelled compaction made no provider request");
	state = foldConstraints(f2.sessionManager.getBranch(), f2.sessionManager.getHeader() ?? undefined);
	assert.equal(state.constraints.length, 1);
	assert.deepEqual(f.errors, []);
	assert.deepEqual(f2.errors, []);
});

test("/hermes-memory task/cancel control stays usable while the budget gate blocks prompts", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => {
			pi.on("session_start", (_e, ctx) => { context = ctx; });
			createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		}],
	});
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: m => notices.push(m) } });
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: 40 }));
	const calls = f.faux.state.callCount;
	await f.session.prompt("continue");
	assert.equal(f.faux.state.callCount, calls, "gated prompt made no provider request");
	await f.session.prompt("/hermes-memory cancel c1");
	const reply = JSON.parse(notices.at(-1)!);
	assert.equal(reply.status, "ok");
	assert.equal(foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined).constraints.length, 0, "explicit cancel resolved the gate");
	f.faux.setResponses([() => fauxAssistantMessage("ack")]);
	await promptSucceeded(f.session, "continue after cancel");
	assert.equal(f.faux.state.callCount, calls + 1);
	assert.deepEqual(f.errors, []);
});

test("damaged fold records gate the request instead of silently dropping constraint protection", async t => {
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false } },
		extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)],
	});
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "For task a never restart." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("ok"),
	]);
	await promptSucceeded(f.session, "For task a never restart.");
	f.sessionManager.appendCustomEntry(SESSION_CUSTOM_TYPE, { v: 9, op: "bogus" });
	const calls = f.faux.state.callCount;
	f.faux.setResponses([() => fauxAssistantMessage("MUST NOT SEND")]);
	await f.session.prompt("continue");
	assert.equal(f.faux.state.callCount, calls, "uncertain fold must not dispatch an unprotected request");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.uncertain, true);
	assert.deepEqual(f.errors, []);
});

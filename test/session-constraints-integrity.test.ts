import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, Type } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { SESSION_CUSTOM_TYPE } from "../src/session-constraints.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const customRecords = (f: Fixture) => f.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === SESSION_CUSTOM_TYPE);
const results = (f: Fixture) => f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "hermes_memory");
async function successful(f: Fixture, text: string) {
	await f.session.prompt(text);
	const last = f.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : undefined, "stop", "reject native SDK error/abort terminals");
}
async function register(f: Fixture, capture?: (messages: Parameters<typeof getCurrentSystemPrompt>[0]) => void) {
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "no-deploy", text: "This task do not deploy." }), { stopReason: "toolUse" }),
		context => { capture?.(context.messages); return fauxAssistantMessage("registered"); },
	]);
	await successful(f, "This task do not deploy.");
}

test("completed task constraints cannot revive by selecting another task and the completed task again", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	await register(f);
	const prompts: string[] = [];
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task-complete", task: "a" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "b" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "a" }), { stopReason: "toolUse" }),
		context => { prompts.push(getCurrentSystemPrompt(context.messages)); return fauxAssistantMessage("done"); },
	]);
	await successful(f, "Explicitly complete task a, select b, and select a again without registering any new constraint.");
	assert.equal(prompts.length, 1);
	assert.doesNotMatch(prompts[0], /Active task constraint/, "completed state is terminal, not just a hidden task selector");
	assert.deepEqual(f.errors, []);
});

test("capacity admission counts the actual emitted version and refuses one-less than complete SDK block", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	let block = "";
	await register(f, messages => { block = getCurrentSystemPrompt(messages).match(/<hermes_memory>[\s\S]*?<\/hermes_memory>/)?.[0] ?? ""; });
	assert.ok(block.includes("Active task constraint"));
	const required = [...block].length;
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "cancel", id: "no-deploy" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("cancelled"),
	]);
	await successful(f, "Explicitly cancel that constraint.");
	const before = customRecords(f).length;
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: required - 1 }));
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "no-deploy", text: "This task do not deploy." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("done"),
	]);
	await successful(f, "This task do not deploy.");
	const last = results(f).at(-1)!;
	assert.equal(last.type === "message" && last.message.role === "toolResult" ? last.message.isError : undefined, true, "an admission placeholder cannot undercount the stored version");
	assert.equal(customRecords(f).length, before, "refused active state must never be appended");
	assert.deepEqual(f.errors, []);
});

test("an ordinary tool reducing capacity cannot trigger an unprotected next request without optional gate-check", async t => {
	let shrinks = 0;
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.registerTool({ name: "fixture_shrink", label: "Fixture", description: "Change a disposable budget", parameters: Type.Object({}), execute: async () => {
			shrinks++;
			writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: 40 }));
			return { content: [{ type: "text", text: "budget changed" }], details: undefined };
		} });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	await register(f);
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	const before = f.faux.state.callCount;
	const leaked: string[] = [];
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("fixture_shrink", {}), { stopReason: "toolUse" }),
		context => { leaked.push(getCurrentSystemPrompt(context.messages)); return fauxAssistantMessage("MUST NOT SEND"); },
	]);
	await f.session.prompt("Run the authorized fixture step. The task remains active.");
	assert.equal(shrinks, 1);
	assert.equal(f.faux.state.callCount, before + 1, "only the pre-change request is allowed; no post-tool provider submission");
	assert.deepEqual(leaked, [], "the model need not cooperate by requesting gate-check");
	assert.equal(customRecords(f).length, 2);
	assert.deepEqual(f.errors, []);
});

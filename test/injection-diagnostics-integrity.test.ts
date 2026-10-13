import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, Type } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const fact = (id: string, text: string) => ({ id, fact: text, source: { kind: "user-authored" as const }, created: "unknown", updated: "unknown" });
const block = (text: string) => text.match(/<hermes_memory>[\s\S]*?<\/hermes_memory>/)?.[0] ?? "";
async function success(f: Fixture, text: string) {
	await f.session.prompt(text);
	const last = f.sessionManager.getBranch().filter(e => e.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : undefined, "stop");
}

test("an externally oversized Unicode file is wholly omitted with a safe reason, never rewritten or model-shortened", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_e, ctx) => { context = ctx; });
		createMemoryExtension({ injectionBudget: 300 })(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: text => notices.push(text) } });
	const store = new MemoryStore(f.agentDir), path = store.path("user"), canary = "EXTERNAL-PRIVATE-CANARY-44";
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	const raw = `${canary} ${"猫🐈 private sentence. ".repeat(400)}\n`;
	writeFileSync(path, raw);
	const captured: string[] = [];
	f.faux.setResponses([c => { captured.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("done"); }]);
	await success(f, "Work without rewriting my oversized memory.");
	assert.equal(captured.length, 1);
	assert.equal(block(captured[0]), "", "no prefix of a non-fitting whole fact is injected");
	assert.equal(readFileSync(path, "utf8"), raw);
	await f.session.prompt("/hermes-memory inspect");
	const report = JSON.parse(notices.at(-1)!), diag = report.injection;
	assert.equal(diag.state, "projected");
	assert.equal(diag.slotScalars, 0);
	assert.equal(diag.budget, 300);
	assert.ok(diag.entries.length > 0);
	for (const row of diag.entries) { assert.equal(row.target, "user"); assert.equal(row.reason, "budget"); assert.ok(row.scalars > 300); }
	assert.ok(!JSON.stringify(report).includes(canary));
	assert.ok(!JSON.stringify(diag).includes("private sentence"));
	assert.equal(readFileSync(path, "utf8"), raw);
	assert.equal(f.faux.state.callCount, 1);
	assert.deepEqual(f.errors, []);
});

test("readonly inspection distinguishes latest disk versions from the last locally projected request", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_e, ctx) => { context = ctx; }); createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: text => notices.push(text) } });
	const store = new MemoryStore(f.agentDir);
	store.add(store.read("user"), [fact("first", "Private original body.")]);
	const original = store.read("user");
	const captured: string[] = [];
	f.faux.setResponses([c => { captured.push(block(getCurrentSystemPrompt(c.messages))); return fauxAssistantMessage("done"); }]);
	await success(f, "Use the initial version.");
	await f.session.prompt("/hermes-memory inspect");
	const first = JSON.parse(notices.at(-1)!);
	store.add(store.read("user"), [fact("later", "PRIVATE-NOT-YET-PROJECTED")]);
	const latest = store.read("user");
	await f.session.prompt("/hermes-memory inspect");
	const second = JSON.parse(notices.at(-1)!);
	assert.notEqual(latest.version, original.version);
	assert.equal(second.targets.find((target: { target: string }) => target.target === "user").version, latest.version);
	assert.equal(second.projection.working.find((target: { target: string }) => target.target === "user").version, original.version);
	assert.deepEqual(second.injection, first.injection, "a read cannot establish a projection of newly changed disk content");
	assert.equal(second.injection.slotScalars, [...captured[0]].length);
	assert.deepEqual(second.injection.entries.map((row: { id: string }) => row.id), ["first"]);
	assert.ok(!JSON.stringify(second.injection).includes("PRIVATE-NOT-YET-PROJECTED"));
	assert.equal(f.faux.state.callCount, 1);
	assert.deepEqual(f.errors, []);
});

test("diagnostics follow the actual no-new-user request after successful native mid-loop compaction", async t => {
	let context: ExtensionContext | undefined, store: MemoryStore;
	let compactions = 0;
	const notices: string[] = [], captured: string[] = [];
	const f = await sdkFixture(t, { models: [{ id: "diagnostic-compact", contextWindow: 8000, maxTokens: 100 }],
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } }, extensions: [pi => {
			pi.on("session_start", (_e, ctx) => { context = ctx; });
			pi.registerTool({ name: "fixture_output", label: "Fixture", description: "Trigger isolated native compaction", parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "fixture output ".repeat(4000) }], details: undefined }) });
			pi.on("session_before_compact", e => {
				store.add(store.read("user"), [fact("after", "PRIVATE-POST-COMPACTION-BODY")]);
				return { compaction: { summary: "fixture summary", firstKeptEntryId: e.preparation.firstKeptEntryId, tokensBefore: e.preparation.tokensBefore } };
			});
			pi.on("session_compact", () => { compactions++; });
			createMemoryExtension()(pi);
		}] });
	store = new MemoryStore(f.agentDir);
	store.add(store.read("user"), [fact("before", "PRIVATE-INITIAL-BODY")]);
	const old = store.read("user").version;
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: text => notices.push(text) } });
	f.faux.setResponses([
		c => { captured.push(block(getCurrentSystemPrompt(c.messages))); return fauxAssistantMessage(fauxToolCall("fixture_output", {}), { stopReason: "toolUse" }); },
		c => { captured.push(block(getCurrentSystemPrompt(c.messages))); return fauxAssistantMessage("after compaction"); },
	]);
	await success(f, "Perform this one user task.");
	assert.ok(compactions >= 1);
	assert.equal(captured.length, 2);
	const latest = store.read("user");
	assert.notEqual(latest.version, old);
	assert.ok(captured[1].includes(latest.version));
	await f.session.prompt("/hermes-memory inspect");
	const report = JSON.parse(notices.at(-1)!);
	// Stock Pi may perform a final local compaction after the last response. That is a
	// based boundary, not a new dispatch; the retained projected key/size must still agree
	// with the actual second request. Never require a fabricated dispatch receipt.
	assert.ok(["projected", "based"].includes(report.injection.state));
	assert.equal(report.injection.slotScalars, [...captured[1]].length);
	assert.equal(report.injection.workingKey, report.projection.projected.key);
	assert.equal(report.projection.working.find((target: { target: string }) => target.target === "user").version, latest.version);
	assert.deepEqual(report.injection.entries.map((row: { id: string }) => row.id).sort(), ["after", "before"]);
	assert.ok(!JSON.stringify(report.injection).includes("PRIVATE-POST-COMPACTION-BODY"));
	assert.equal(f.faux.state.callCount, 2, "only the two main requests, no plugin summary");
	assert.deepEqual(f.errors, []);
});

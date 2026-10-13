import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { sdkFixture } from "./sdk-fixture.ts";

const fact = (id: string, text: string) => ({ id, fact: text, source: { kind: "user-authored" as const }, created: "unknown", updated: "unknown" });
async function fixture(t: TestContext) {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; }); createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: text => notices.push(text) } });
	return { ...f, notices, inspect: async () => { await f.session.prompt("/hermes-memory inspect"); return JSON.parse(notices.at(-1)!); } };
}
async function success(f: Awaited<ReturnType<typeof fixture>>, text: string) {
	await f.session.prompt(text);
	const last = f.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : undefined, "stop");
}

for (const mode of ["rpc", "json"] as const) test(`ordinary ${mode} inspection hides pending bodies and free-text reasons; explicit pending preview still works`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir);
	const old = "PRIVATE-OLD-PENDING-CANARY", next = "PRIVATE-NEW-PENDING-CANARY", reason = "PRIVATE-PENDING-REASON-CANARY";
	store.add(store.read("user"), [fact("old", old)]);
	const proposal = store.stage(store.read("user"), { replacements: [{ id: "old", expectedFact: old, entry: fact("old", next) }] }, reason);
	const before = store.read("user");
	let output = "";
	let report: ReturnType<typeof JSON.parse>;
	if (mode === "json") {
		await f.session.bindExtensions({ mode: "json" });
		// Capture only the public output sink; no SDK behavior or dispatch is mocked.
		t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => { output += chunk.toString(); return true; });
		try { await f.session.prompt("/hermes-memory inspect"); }
		finally { t.mock.restoreAll(); }
		report = output.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(row => row.type === "hermes-memory").detail;
		assert.ok(!output.includes(old) && !output.includes(next) && !output.includes(reason));
	} else report = await f.inspect();
	const serialized = JSON.stringify(report);
	assert.ok(!serialized.includes(old) && !serialized.includes(next) && !serialized.includes(reason));
	assert.equal(report.pending[0].id, proposal.id);
	assert.equal(report.pending[0].stamp, proposal.stamp);
	assert.deepEqual(report.pending[0].changes, [{ id: "old", kind: "replacement" }]);
	assert.equal(store.read("user").raw, before.raw);
	assert.equal(store.pending("user")[0].stamp, proposal.stamp);
	assert.equal(f.faux.state.callCount, 0);
	if (mode === "rpc") {
		await f.session.prompt("/hermes-memory pending user");
		const preview = JSON.parse(f.notices.at(-1)!);
		assert.equal(preview.pending[0].diff[0].old, old);
		assert.equal(preview.pending[0].diff[0].fact, next);
		assert.equal(store.read("user").raw, before.raw, "explicit preview is not approval");
	}
	assert.deepEqual(f.errors, []);
});

test("missing and deliberately empty files have explicit distinct metadata without inspection writes", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir), path = store.path("user");
	const missing = (await f.inspect()).targets.find((row: { target: string }) => row.target === "user");
	assert.equal(missing.present, false); assert.ok(missing.diagnostics.includes("missing-file"));
	assert.equal(missing.scalars, 0); assert.equal(existsSync(path), false);
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true }); writeFileSync(path, "");
	const empty = (await f.inspect()).targets.find((row: { target: string }) => row.target === "user");
	assert.equal(empty.present, true); assert.ok(!empty.diagnostics.includes("missing-file"));
	assert.equal(empty.scalars, 0); assert.equal(empty.version, missing.version, "presence does not invent a content version");
	assert.equal(readFileSync(path, "utf8"), ""); assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("deleted saved target reports missing while keeping its earlier request projection historical", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir);
	store.add(store.read("user"), [fact("deleted", "PRIVATE-DELETED-44")]);
	f.faux.setResponses([fauxAssistantMessage("done")]); await success(f, "Use the saved version.");
	const before = await f.inspect(); unlinkSync(store.path("user"));
	const after = await f.inspect(), target = after.targets.find((row: { target: string }) => row.target === "user");
	assert.equal(target.present, false); assert.ok(target.diagnostics.includes("missing-file"));
	assert.equal(target.scalars, 0); assert.notEqual(target.version, before.targets.find((row: { target: string }) => row.target === "user").version);
	assert.deepEqual(after.injection, before.injection, "viewing missing disk cannot relabel the earlier actual request");
	assert.equal(existsSync(store.path("user")), false); assert.equal(f.faux.state.callCount, 1); assert.deepEqual(f.errors, []);
});

test("exact mandatory cap and one-less overflow both explain whole-fact omission and expose the live gate", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir), captures: string[] = [];
	store.add(store.read("user"), [fact("budget-fact", "PRIVATE-BUDGET-44")]);
	const disk = store.read("user").raw;
	f.faux.setResponses([
		c => { captures.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "shared" }), { stopReason: "toolUse" }); },
		c => { captures.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "no-deploy", text: "Do not deploy this task." }), { stopReason: "toolUse" }); },
		c => { captures.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("registered"); },
	]);
	await success(f, "Do not deploy this task.");
	const original = await f.inspect(); assert.ok(captures[2].includes("Active task constraint"));
	const row = original.injection.entries.find((entry: { id: string }) => entry.id === "budget-fact");
	const exact = original.injection.slotScalars - row.scalars;
	const config = join(f.agentDir, "hermes-memory", "config.json");
	writeFileSync(config, JSON.stringify({ injectionBudget: exact }));
	await f.session.prompt("/hermes-memory refresh");
	const fits = JSON.parse(f.notices.at(-1)!);
	assert.equal(fits.gate.ok, true); assert.equal(fits.injection.slotScalars, exact);
	assert.deepEqual(fits.injection.constraints, ["no-deploy"]);
	assert.deepEqual(fits.omitted, ["budget-fact"]); assert.equal(fits.injection.entries[0].reason, "budget");
	writeFileSync(config, JSON.stringify({ injectionBudget: exact - 1 }));
	await f.session.prompt("/hermes-memory refresh");
	const blocked = JSON.parse(f.notices.at(-1)!);
	assert.equal(blocked.gate.ok, false); assert.match(blocked.gate.reason, /session-constraint-budget/);
	assert.equal(blocked.injection.constraintOmitted, true); assert.equal(blocked.injection.slotScalars, 0);
	assert.deepEqual(blocked.included, []); assert.deepEqual(blocked.omitted, ["budget-fact"]);
	assert.deepEqual(blocked.injection.entries, [{ ...row, reason: "constraint-budget" }]);
	assert.ok(!JSON.stringify(blocked).includes("PRIVATE-BUDGET-44"));
	await f.session.prompt("Continue without changing the constraint.");
	assert.equal(f.faux.state.callCount, 3, "the actual next request stays blocked; no auxiliary calls");
	const inspected = await f.inspect(); assert.equal(inspected.gate.ok, false);
	assert.deepEqual(inspected.injection.entries, blocked.injection.entries);
	assert.equal(readFileSync(store.path("user"), "utf8"), disk); assert.deepEqual(f.errors, []);
});

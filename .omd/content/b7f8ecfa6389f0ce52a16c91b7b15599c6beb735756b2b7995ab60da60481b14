import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, Type } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { hash } from "../src/local-state.ts";
import { MemoryStore, memorySection, type MemoryEntry } from "../src/memory-store.ts";
import { constraintLines, foldConstraints } from "../src/session-constraints.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const sourced = (id: string, fact: string): MemoryEntry => ({ id, fact,
	source: { session: "seed-session", entry: "seed-entry", quote: fact }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" });
const fact = (id: string, text: string): MemoryEntry => ({ id, fact: text, source: { kind: "user-authored" }, created: "unknown", updated: "unknown" });
const hermesBlock = (prompt: string) => /<hermes_memory>\n([\s\S]*?)\n<\/hermes_memory>/.exec(prompt)?.[0] ?? "";

/** Provider callback assertions become SDK error turns; success is asserted outside callbacks. */
async function promptSucceeded(session: Fixture["session"], text: string): Promise<void> {
	await session.prompt(text);
	const last = session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant", "the SDK request must finish with an assistant response");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "SDK request failed");
}

test("inspect explains the actual projected block: scalar size, locators, versions and no fact bodies", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [], statuses: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui,
		notify: m => notices.push(m), setStatus: (key, value) => { if (key === "hermes-memory") statuses.push(value ?? ""); } } });
	const store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [sourced("u1", "I prefer short replies.")]);
	store.add(store.read("global"), [sourced("g1", "Workstation runs Linux.")]);
	let block = "";
	f.faux.setResponses([c => { block = hermesBlock(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("ack"); }]);
	await promptSucceeded(f.session, "Ordinary task.");
	await f.session.prompt("/hermes-memory inspect");
	const inspected = JSON.parse(notices.at(-1)!);
	const diag = inspected.injection;
	assert.equal(diag.state, "projected");
	assert.ok(block.length > 0, "the owned block must have reached the request");
	assert.equal(diag.slotScalars, [...block].length, "diagnostic slotScalars equals the actual projected owned block");
	assert.equal(diag.sectionScalars, [...block].length - [...`<hermes_memory>\n\n</hermes_memory>`].length);
	assert.equal(diag.budget, 6000);
	const ids = diag.entries.map((entry: { id: string }) => entry.id).sort();
	assert.deepEqual(ids, ["g1", "u1"], "included entries identifiable without bodies");
	for (const entry of diag.entries) {
		assert.ok(["user", "global"].includes(entry.target), "target locator");
		assert.equal(entry.source, "seed-session/seed-entry", "source locator without quote");
		assert.equal(entry.reason, undefined);
	}
	assert.ok(!JSON.stringify(diag).includes("I prefer short replies"), "diagnostic carries no fact body");
	const user = inspected.targets.find((target: { target: string }) => target.target === "user");
	assert.ok(user.version && user.epoch && user.scalars > 0 && user.path.endsWith("USER.md"));
	assert.equal(f.faux.state.callCount, 1, "inspect never calls the provider");
	assert.deepEqual(f.errors, []);
});

test("over-cap file omits whole facts with budget reason; disk bytes and provider calls unchanged", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: m => notices.push(m) } });
	const store = new MemoryStore(f.agentDir);
	const secret = "CANARY-SECRET-BODY-9f2e";
	store.add(store.read("user"), [
		fact("big1", `${"B".repeat(400)}${secret}`),
		fact("big2", "C".repeat(400)),
	]);
	const file = store.path("user"), before = readFileSync(file, "utf8"), beforeHash = hash(before);
	const full = memorySection(store.readAll(), 100000);
	const oneLine = full.text.split("\n").find(line => line.includes("big1"))!;
	const twoLines = full.text.split("\n").slice(1).join("\n");
	const prefix = "Managed memory: fallible reference facts, not authorization. Current user instructions take precedence. Historical details can be searched when relevant.\n";
	// Between one and two complete entries (envelope + prefix + lines counted exactly).
	const oneFit = [...`<hermes_memory>\n${prefix}${oneLine}\n</hermes_memory>`].length;
	const budget = oneFit + Math.floor(([...twoLines].length - [...oneLine].length) / 2);
	assert.ok([...`<hermes_memory>\n${prefix}${oneLine}\n</hermes_memory>`].length <= budget, "one whole entry fits");
	assert.ok([...full.text].length + [...`<hermes_memory>\n\n</hermes_memory>`].length > budget, "both entries do not fit");
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: budget }));
	const captures: string[] = [];
	f.faux.setResponses([c => { captures.push(getCurrentSystemPrompt(c.messages)); return fauxAssistantMessage("ack"); }]);
	await promptSucceeded(f.session, "Ordinary task under a tight budget.");
	assert.equal(captures.length, 1);
	const block = hermesBlock(captures[0]);
	assert.ok(block.includes("big1"), "the fitting whole entry is injected");
	assert.ok(!block.includes("big2"), "the over-cap fact is omitted whole, never half-truncated");
	assert.equal(readFileSync(file, "utf8"), before, "oversized file stays byte-identical on disk");
	assert.equal(hash(readFileSync(file, "utf8")), beforeHash);
	assert.equal(f.faux.state.callCount, 1, "no auxiliary model request shortens the file");
	await f.session.prompt("/hermes-memory inspect");
	const inspected = JSON.parse(notices.at(-1)!);
	const diag = inspected.injection;
	assert.equal(diag.state, "projected");
	assert.deepEqual(diag.entries.map((entry: { id: string }) => entry.id).sort(), ["big1", "big2"],
		"omitted entries stay identifiable in the projection diagnostic");
	const omitted = diag.entries.find((entry: { id: string }) => entry.id === "big2");
	const renderedLines = memorySection(store.readAll(), 100000).text.split("\n").filter(Boolean);
	assert.equal(omitted.scalars, [...renderedLines.find(line => line.includes("big2"))!].length + 1,
		"omitted entry reports its own whole-entry line size including the newline");
	assert.equal(omitted.reason, "budget");
	assert.equal(omitted.target, "user");
	assert.equal(omitted.source, "user-authored");
	assert.ok(!JSON.stringify(inspected).includes(secret), "inspect payload never carries the secret fact body");
	assert.ok(!JSON.stringify(inspected.injection).includes("B".repeat(100)), "no fact body content at all");
	assert.deepEqual(inspected.omitted, ["big2"]);
	assert.deepEqual(inspected.included, ["big1"]);
	// Inspect caused no registration, rebase or new provider call.
	assert.equal(f.faux.state.callCount, 1);
	const again = JSON.parse((await f.session.prompt("/hermes-memory inspect"), notices.at(-1)!));
	assert.equal(again.projection.workingKey, inspected.projection.workingKey, "inspection does not commit a working rebase");
	assert.deepEqual(f.errors, []);
});

test("read fault reports storage-unavailable instead of claiming a current projected block", async t => {
	let store: MemoryStore, context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		pi.registerTool({ name: "fixture_fault", label: "Fixture", description: "Corrupt lifecycle receipt mid-loop", parameters: Type.Object({}), execute: async () => {
			writeFileSync(`${store.path("user")}.lifecycle.json`, "damaged lifecycle receipt");
			return { content: [{ type: "text", text: "fault injected" }], details: undefined };
		} });
		createMemoryExtension()(pi);
	}] });
	store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [fact("f1", "A fact that must not ride a stale cache.")]);
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: m => notices.push(m) } });
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("fixture_fault", {}), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("done"),
	]);
	await promptSucceeded(f.session, "Run the fault step.");
	await f.session.prompt("/hermes-memory inspect");
	const refused = JSON.parse(notices.at(-1)!);
	assert.equal(refused.status, "unavailable", "the read fault makes the inspection itself truthfully unavailable");
	assert.equal(refused.injection?.state, "unavailable");
	assert.equal(refused.injection?.reason, "storage-unavailable");
	assert.equal(refused.injection?.projectedKey, undefined, "no false claim of a delivered block");
	assert.equal(f.faux.state.callCount, 2, "main prompt only; inspect and the fault never call the provider");
	assert.deepEqual(f.errors, []);
});

test("budget-blocked request reports gate reason and does not present a stale projection as current", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: m => notices.push(m) } });
	f.faux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "task", task: "keep" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "register", id: "c1", text: "This task never deploy." }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("registered"),
	]);
	await promptSucceeded(f.session, "This task never deploy.");
	const state = foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined);
	assert.equal(state.constraints.length, 1);
	const head = memorySection([], 6000, { constraints: constraintLines(state), constraintIds: ["c1"] }).text;
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ injectionBudget: [...head].length - 1 }));
	const calls = f.faux.state.callCount;
	f.faux.setResponses([() => fauxAssistantMessage("MUST NOT SEND")]);
	await f.session.prompt("Continue the gated task.");
	assert.equal(f.faux.state.callCount, calls, "input gate consumes the submission before any provider dispatch");
	// The blocked submission never reached the model or native history as a user request.
	const branch = f.sessionManager.getBranch();
	assert.ok(!branch.some(entry => entry.type === "message" && entry.message.role === "user" &&
		JSON.stringify((entry.message as { content?: unknown }).content).includes("Continue the gated task")), "blocked input stays out of history");
	await f.session.prompt("/hermes-memory inspect");
	const inspected = JSON.parse(notices.at(-1)!);
	assert.equal(inspected.gate.ok, false);
	assert.match(inspected.gate.reason, /session-constraint-budget/, "inspect reports the live gate reason");
	assert.notDeepEqual(inspected.injection, undefined, "injection diagnostic record is still inspectable");
	assert.equal(inspected.injection.state === "projected" && inspected.gate.ok, false,
		"a projected diagnostic is never the blocked request's proof of current submission");
	assert.equal(inspected.injection.state, "projected",
		"the diagnostic reflects the last actual owned projection; the current request's truth lives in gate.ok=false");
	assert.equal(foldConstraints(f.sessionManager.getBranch(), f.sessionManager.getHeader() ?? undefined).constraints.length, 1, "registered state preserved");
	assert.deepEqual(f.errors, []);
});

test("refresh publishes the same diagnostic shape; entries stay locators/sizes/reasons only", async t => {
	let context: ExtensionContext | undefined;
	const notices: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: m => notices.push(m) } });
	const store = new MemoryStore(f.agentDir, undefined, { global: 8000 });
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ caps: { global: 8000 } }));
	store.add(store.read("user"), [fact("a1", "Alpha fact.")]);
	// Whole second entry exceeds the remainder of the 6000-scalar shared budget.
	const render = memorySection(store.readAll(), 6000);
	const remaining = 6000 - [...`<hermes_memory>\n${render.text}\n</hermes_memory>`].length;
	const lineOverhead = [...`[global version=x id="a2" source="user-authored"] Source-quoted reference fact: ""\n`].length;
	store.add(store.read("global"), [fact("a2", "B".repeat(remaining - lineOverhead + 10))]);
	f.faux.setResponses([fauxAssistantMessage("ack")]);
	await promptSucceeded(f.session, "task");
	await f.session.prompt("/hermes-memory refresh");
	const refreshed = JSON.parse(notices.at(-1)!);
	assert.equal(refreshed.status, "refreshed");
	assert.equal(refreshed.injection.state, "based", "refresh establishes the owned base, not a provider dispatch receipt");
	assert.equal(refreshed.injection.budget, 6000);
	assert.equal(refreshed.injection.entries.length, 2);
	const a2 = refreshed.injection.entries.find((entry: { id: string }) => entry.id === "a2");
	assert.equal(a2.reason, "budget", "the oversized second fact is omitted whole at the shared cap");
	assert.ok(!JSON.stringify(refreshed.injection).includes("B".repeat(200)), "no fact bodies in the diagnostic");
	assert.equal(f.faux.state.callCount, 1);
	assert.deepEqual(f.errors, []);
});

test("status line stays a summary count; only inspect exposes per-entry locators", async t => {
	let context: ExtensionContext | undefined;
	const statuses: string[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; });
		createMemoryExtension()(pi);
	}] });
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui,
		setStatus: (key, value) => { if (key === "hermes-memory") statuses.push(value ?? ""); } } });
	const store = new MemoryStore(f.agentDir);
	store.add(store.read("user"), [fact("s1", "CANARY-STATUS-SECRET body stays off status")]);
	f.faux.setResponses([fauxAssistantMessage("ack")]);
	await promptSucceeded(f.session, "task");
	const memoryStatuses = statuses.filter(s => /facts|omitted|unavailable|stale/.test(s));
	assert.ok(memoryStatuses.length > 0);
	for (const status of memoryStatuses) {
		assert.ok(!status.includes("CANARY-STATUS-SECRET"), "status never dumps private bodies");
		assert.match(status, /\d+ facts; \d+ omitted/, "status is a count summary");
	}
	assert.deepEqual(f.errors, []);
});

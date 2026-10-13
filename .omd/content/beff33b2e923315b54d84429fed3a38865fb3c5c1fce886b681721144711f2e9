import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxToolCall, Type, type TranscriptContext } from "@earendil-works/pi-ai";
import { getAgentDir, AgentSessionRuntime, type ExtensionFactory, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { REVIEW_CHANNEL, type ReviewEvent } from "../src/review-coordinator.ts";
import { sdkFixture } from "./sdk-fixture.ts";

const CHANNEL = REVIEW_CHANNEL;
interface SkillControls {
	id?: string; version?: number; due?: boolean; present?: boolean;
	collectAck?: "missing" | "duplicate"; dispatchAck?: "missing";
	dispatch?: (event: Extract<ReviewEvent, { type: "dispatch" }>) => void; ui?: ExtensionUIContext;
	commit?: "rejected" | "pending" | "failed" | "missing" | "late";
	cap?: number; approvalRequired?: boolean; approved?: boolean;
	path?: string; off?: () => void; onCollect?: () => void;
}
async function until(check: () => boolean, label: string) {
	const end = Date.now() + 4000;
	while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
	assert.ok(check(), label);
}

// Explicit protocol double. Own isolated directory, own version/cap/permission checks.
// No memory Store, generic tools, or write capability crosses consumer boundary.
function skillDouble(id: string, commits: string[], controls: SkillControls = {}): ExtensionFactory {
	return pi => {
		const instance = `${id}-fixture-instance`;
		const off = pi.events.on(CHANNEL, data => {
			const event = data as ReviewEvent;
			if (controls.present === false) return;
			if (event.type === "discover") { event.ack({ id: controls.id ?? id, instance, version: controls.version ?? 1 }); return; }
			if (event.participant !== id || event.instance !== instance) return;
			const path = controls.path = join(getAgentDir(), "skill-double", "workflow.md");
			if (event.type === "collect") {
				mkdirSync(join(getAgentDir(), "skill-double"), { recursive: true });
				let version = "absent";
				try { version = readFileSync(path, "utf8"); } catch {}
				if (controls.collectAck === "missing") return;
				controls.onCollect?.();
				const contribution = (controls.due ?? (event.trigger !== "manual" && event.snapshot.toolTurns >= 10)) ? {
					targets: [{ target: "workflow", version }],
					instruction: "Propose a bounded reusable workflow, never a memory fact.",
					context: { sentinel: "SKILL-READ-VERSION", version },
				} : undefined;
				event.ack(contribution);
				if (controls.collectAck === "duplicate") event.ack(contribution);
			} else if (event.type === "validate") {
				let version = "absent"; try { version = readFileSync(path, "utf8"); } catch {}
				event.ack(version === event.contribution.targets[0].version);
			} else if (event.type === "dispatch") {
				if (controls.dispatch) { controls.dispatch(event); return; }
				if (controls.dispatchAck === "missing") { void event.execute().catch(() => {}); return; }
				event.ack(); void event.execute();
			} else if (event.type === "commit") {
				let version = "absent"; try { version = readFileSync(path, "utf8"); } catch {}
				if (controls.commit === "missing") return;
				if (controls.commit === "late") {
					setTimeout(() => { if (event.valid()) writeFileSync(path, "ILLEGAL-LATE-COMMIT"); }, 250); return;
				}
				if (controls.commit === "failed") { event.ack([{ target: "workflow", status: "failed", ids: [] }]); return; }
				if (controls.commit === "rejected" || controls.commit === "pending") {
					event.ack([{ target: "workflow", status: controls.commit, ids: [] }]); return;
				}
				const body = (event.proposal as { workflow?: unknown } | undefined)?.workflow;
				if (!event.valid() || version !== event.contribution.targets[0].version) {
					event.ack([{ target: "workflow", status: "conflict", ids: [] }]); return;
				}
				if (typeof body !== "string" || body.length > (controls.cap ?? 256)) {
					event.ack([{ target: "workflow", status: "rejected", ids: [] }]); return;
				}
				if (controls.approvalRequired && !controls.approved) {
					event.ack([{ target: "workflow", status: "pending", ids: [] }]); return;
				}
				writeFileSync(path, body); commits.push(event.requestId);
				event.ack([{ target: "workflow", status: "saved", ids: ["skill-entry"] }]);
			}
		});
		controls.off = off;
	};
}

for (const peerId of ["aaa-skill", "zzz-skill"]) for (const peerFirst of [true, false]) test(`real mixed native settlement pays once and commits independently (${peerId}; ${peerFirst ? "skill" : "memory"} registered first)`, async t => {
	const captures: TranscriptContext[] = [], peerCommits: string[] = [];
	const memory: ExtensionFactory = pi => {
		pi.registerTool({ name: "joint_work", label: "Work", description: "Fixture work", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "native tool result" }], details: undefined }) });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	};
	const peer = skillDouble(peerId, peerCommits);
	const f = await sdkFixture(t, { automaticReview: true, extensions: peerFirst ? [peer, memory] : [memory, peer] });
	for (let n = 1; n <= 9; n++) {
		f.faux.setResponses([() => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" }), () => fauxAssistantMessage("foreground ok")]);
		await f.session.prompt(`Work ${n}.`);
		const last = f.session.messages.at(-1);
		assert.equal(last?.role, "assistant");
		if (last?.role === "assistant") assert.equal(last.stopReason, "stop");
	}
	let release!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
	const delayed = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([() => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" }), () => fauxAssistantMessage("foreground ok"), context => {
		captures.push(structuredClone(context)); return delayed;
	}]);
	try {
		await f.session.prompt("I prefer concise answers.");
		const last = f.session.messages.at(-1);
		assert.equal(last?.role, "assistant");
		if (last?.role === "assistant") assert.equal(last.stopReason, "stop");
		await until(() => captures.length === 1, "one actual auxiliary dispatch");
		const payload = JSON.stringify(captures[0]);
		assert.match(payload, /SKILL-READ-VERSION/, "production must collect skill contribution into same full request");
		assert.match(payload, /Work 1\./);
		assert.match(payload, /I prefer concise answers\./);
		const source = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
		const before = { bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId(), messages: JSON.stringify(f.session.messages) };
		release(fauxAssistantMessage(JSON.stringify({ consumers: {
			"hermes-memory": { candidates: [{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry: source }] },
			[peerId]: { workflow: "Run fixture work; inspect result; report outcome." },
		} })));
		const ledger = new ReviewLedger(f.agentDir);
		await until(() => ledger.status()[0]?.status !== "admitted", "shared terminal");
		const records = ledger.status();
		assert.equal(records.length, 1);
		assert.equal(records[0].status, "saved");
		assert.equal(records[0].owner?.plugin, peerId === "aaa-skill" ? peerId : "hermes-memory");
		assert.equal(records[0].usageState, "reported");
		assert.equal(ledger.overview().daily.requests, 1);
		assert.equal(records[0].commits?.filter(c => c.status === "saved").length, 2);
		assert.deepEqual(peerCommits, [records[0].id]);
		assert.equal(new MemoryStore(f.agentDir, f.cwd).read("user").entries[0]?.fact, "I prefer concise answers.");
		assert.match(readFileSync(join(f.agentDir, "skill-double", "workflow.md"), "utf8"), /inspect result/);
		assert.deepEqual({ bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId(), messages: JSON.stringify(f.session.messages) }, before);
		assert.equal(f.faux.state.callCount, 21);
		assert.deepEqual(f.errors, []);
		t.diagnostic(JSON.stringify({ nativeUsers: 10, nativeToolTurns: 10, paidRequests: captures.length, actualPayload: captures[0], nativeTerminal: last, totalProviderCalls: f.faux.state.callCount, owner: records[0].owner?.plugin, debit: ledger.overview().daily.requests, commits: records[0].commits }));
	} finally { release?.(fauxAssistantMessage('{"candidates":[]}')); }
});

async function jointFixture(t: TestContext, controls: SkillControls = {}, id = "zzz-skill", automaticReview = true) {
	const commits: string[] = [], requests: TranscriptContext[] = [];
	const f = await sdkFixture(t, { automaticReview, extensions: [skillDouble(id, commits, controls), pi => {
		pi.on("session_start", (_event, ctx) => { controls.ui = ctx.ui; });
		pi.registerTool({ name: "joint_work", label: "Work", description: "Fixture work", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "native work" }], details: undefined }) });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	return { ...f, commits, requests, controls, ledger: new ReviewLedger(f.agentDir), store: new MemoryStore(f.agentDir, f.cwd), id };
}
type JointFixture = Awaited<ReturnType<typeof jointFixture>>;
async function nativeWork(f: JointFixture, count: number, tools = true) {
	for (let n = 0; n < count; n++) {
		f.faux.setResponses([...(tools ? [() => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })] : []), () => fauxAssistantMessage("foreground ok")]);
		await f.session.prompt(`Work ${n + 1}.`);
		const last = f.session.messages.at(-1);
		assert.equal(last?.role, "assistant");
		if (last?.role === "assistant") assert.equal(last.stopReason, "stop", last.errorMessage ?? "native foreground failed");
	}
}
async function dueWork(f: JointFixture) {
	await nativeWork(f, 9);
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const result = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([() => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" }), () => fauxAssistantMessage("foreground ok"), context => {
		f.requests.push(structuredClone(context)); return result;
	}]);
	await f.session.prompt("I prefer concise answers.");
	const last = f.session.messages.at(-1);
	assert.equal(last?.role, "assistant");
	if (last?.role === "assistant") assert.equal(last.stopReason, "stop", last.errorMessage ?? "native foreground failed");
	const source = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
	const response = (memory: unknown = { candidates: [{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry: source }] }, workflow: unknown = "Run fixture work; inspect result.") => fauxAssistantMessage(JSON.stringify({ consumers: { "hermes-memory": memory, [f.id]: { workflow } } }));
	return { release, response };
}
async function duplicateBoundary(f: JointFixture) {
	f.faux.setResponses([() => fauxAssistantMessage("continued foreground")]);
	await f.session.sendCustomMessage({ customType: "joint-repeat", content: "no new user", display: false }, { triggerTurn: true });
	await new Promise(resolve => setTimeout(resolve, 450));
}
function state(f: JointFixture) {
	return { bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId(), messages: JSON.stringify(f.session.messages) };
}

for (const commit of ["rejected", "pending", "failed", "missing", "late"] as const) test(`independent ${commit} skill outcome preserves memory commit without replay`, async t => {
	const f = await jointFixture(t, { commit });
	const pending = await dueWork(f);
	try {
		await until(() => f.requests.length === 1, "mixed request submitted");
		const before = state(f);
		pending.release(pending.response());
		await until(() => f.ledger.status()[0]?.usageState === "reported", "partial accounting terminal");
		const record = f.ledger.status()[0];
		assert.equal(record.status, commit === "pending" ? "pending" : ["failed", "missing", "late"].includes(commit) ? "failed" : "conflict");
		assert.equal(record.commits?.find(c => c.consumer === f.id)?.status, ["missing", "late"].includes(commit) ? "failed" : commit);
		assert.equal(f.store.read("user").entries[0]?.fact, "I prefer concise answers.");
		assert.equal(record.saved.length, 1, "memory recall-credit IDs only");
		assert.deepEqual(state(f), before);
		await duplicateBoundary(f);
		assert.equal(f.requests.length, 1);
		assert.equal(f.ledger.overview().daily.requests, 1);
		assert.equal(f.ledger.status().filter(r => r.usageState !== "not-sent").length, 1);
		assert.deepEqual(f.commits, []);
		assert.throws(() => readFileSync(f.controls.path!), /ENOENT/);
		assert.deepEqual(f.errors, []);
	} finally { pending.release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("invalid memory proposal does not erase successful skill commit or grant memory recall credit", async t => {
	const f = await jointFixture(t);
	const pending = await dueWork(f);
	try {
		await until(() => f.requests.length === 1, "mixed request submitted");
		pending.release(pending.response({ candidates: [{ kind: "procedure", fact: "Run workflow", quote: "Run workflow", entry: "foreign" }] }));
		await until(() => f.ledger.status()[0]?.usageState === "reported", "partial terminal");
		const record = f.ledger.status()[0];
		assert.equal(record.status, "conflict");
		assert.deepEqual(record.saved, []);
		assert.equal(record.commits?.find(c => c.consumer === f.id)?.status, "saved");
		assert.equal(f.store.read("user").entries.length, 0);
		f.ledger.recalled(f.sessionManager.getSessionId(), ["skill-entry"]);
		assert.deepEqual(f.ledger.status()[0].recalls, []);
		assert.equal(f.requests.length, 1);
	} finally { pending.release(fauxAssistantMessage('{"candidates":[]}')); }
});

for (const fault of ["incompatible", "ambiguous", "collect-missing", "collect-duplicate", "dispatch-missing", "ledger"] as const) test(`${fault} fences automatic spending visibly, never standalone fallback`, async t => {
	const controls: SkillControls = fault === "incompatible" ? { version: 2 } : fault === "ambiguous" ? { id: "hermes-memory" } :
		fault === "collect-missing" ? { collectAck: "missing" } : fault === "collect-duplicate" ? { collectAck: "duplicate" } :
		fault === "dispatch-missing" ? { dispatchAck: "missing" } : {};
	const f = await jointFixture(t, controls, "aaa-skill");
	if (fault === "ledger") {
		const old = f.ledger.admit({ digest: "prior", session: "prior", model: "fixture", estimatedInput: 1 });
		f.ledger.finish(old.id, "no-proposal", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 });
		writeFileSync(f.ledger.path, "broken ledger");
	}
	const pending = await dueWork(f);
	await new Promise(resolve => setTimeout(resolve, 650));
	assert.equal(f.requests.length, 0);
	assert.equal(f.faux.state.callCount, 20, "only successful native work paid");
	if (fault !== "ledger") {
		assert.ok(f.ledger.overview().paused?.startsWith("review-"));
		assert.ok(f.ledger.status().some(r => r.reason?.startsWith("review-")));
		assert.equal(f.ledger.overview().daily.requests, 0);
		assert.ok(f.ledger.status().every(r => r.usageState === "not-sent"));
	} else assert.equal(readFileSync(f.ledger.path, "utf8"), "broken ledger");
	await duplicateBoundary(f);
	assert.equal(f.requests.length, 0);
	assert.deepEqual(f.commits, []);
	assert.deepEqual(f.errors, []);
	pending.release(fauxAssistantMessage('{"candidates":[]}'));
});

for (const invalidation of ["input", "branch", "reload", "shutdown", "disappear", "version"] as const) test(`mixed delayed result after ${invalidation} retains one debit and blocks stale consumer writes`, async t => {
	const f = await jointFixture(t);
	const pending = await dueWork(f);
	try {
		await until(() => f.requests.length === 1, "mixed request submitted");
		if (invalidation === "input") { f.faux.setResponses([() => fauxAssistantMessage("new foreground")]); await f.session.prompt("New task."); }
		else if (invalidation === "branch") {
			const user = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-2)!;
			await f.session.navigateTree(user.id, { summarize: false });
		} else if (invalidation === "reload") await f.session.reload();
		else if (invalidation === "shutdown") {
			const runtime = new AgentSessionRuntime(f.session, { cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.modelRuntime, settingsManager: f.settingsManager, resourceLoader: f.loader, diagnostics: [] }, async () => { throw new Error("shutdown must not recreate runtime"); });
			await runtime.dispose();
		} else if (invalidation === "disappear") f.controls.off!();
		else writeFileSync(f.controls.path!, "USER-EDITED-SKILL");
		const before = state(f);
		pending.release(pending.response());
		await until(() => f.ledger.status()[0]?.usageState === "reported", "late accounting");
		assert.equal(f.ledger.overview().daily.requests, 1);
		assert.deepEqual(f.commits, []);
		assert.equal(f.requests.length, 1);
		assert.deepEqual(state(f), before);
		if (invalidation === "version") {
			assert.equal(f.ledger.status()[0].status, "conflict");
			assert.equal(f.store.read("user").entries.length, 1);
			assert.equal(readFileSync(f.controls.path!, "utf8"), "USER-EDITED-SKILL");
		} else {
			assert.equal(f.ledger.status()[0].status, "cancelled");
			assert.equal(f.store.read("user").entries.length, 0);
		}
		assert.deepEqual(f.errors, []);
	} finally { pending.release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("skill due alone uses shared path but never consumes memory user cadence", async t => {
	const f = await jointFixture(t);
	f.faux.setResponses([...Array.from({ length: 10 }, () => () => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })),
		() => fauxAssistantMessage("foreground ok"), context => { f.requests.push(structuredClone(context)); return fauxAssistantMessage(JSON.stringify({ consumers: { [f.id]: { workflow: "Independent skill." } } })); }]);
	await f.session.prompt("Perform ten native tool turns.");
	await until(() => f.ledger.status()[0]?.usageState === "reported", "skill-only terminal");
	assert.deepEqual(f.ledger.status()[0].targets, [`${f.id}:workflow`]);
	assert.equal(f.ledger.status()[0].owner?.plugin, f.id);
	assert.equal(f.ledger.status()[0].status, "saved");
	assert.deepEqual(f.ledger.status()[0].saved, []);
	assert.equal(f.store.read("user").entries.length, 0);
	assert.equal(f.requests.length, 1);
	assert.doesNotMatch(JSON.stringify(f.requests[0]), /Select short verbatim spans/);
});

test("late due peer waits past processed memory snapshot; duplicate boundary/reload never repays", async t => {
	const f = await jointFixture(t, { due: false });
	await nativeWork(f, 9, false);
	f.faux.setResponses([() => fauxAssistantMessage("foreground ok"), context => {
		f.requests.push(structuredClone(context)); return fauxAssistantMessage('{"candidates":[]}');
	}]);
	await f.session.prompt("Tenth work.");
	await until(() => f.ledger.status()[0]?.usageState === "reported", "memory-only terminal");
	f.controls.due = true;
	await duplicateBoundary(f);
	await f.session.reload();
	assert.equal(f.requests.length, 1);
	assert.equal(f.ledger.overview().daily.requests, 1);
	assert.deepEqual(f.commits, []);
});

test("manual review never acquires newly due peer; memory OFF cannot silently joint-dispatch", async t => {
	const f = await jointFixture(t, { due: true }, "aaa-skill", false);
	await nativeWork(f, 10);
	await new Promise(resolve => setTimeout(resolve, 450));
	assert.equal(f.ledger.status().length, 0);
	f.faux.setResponses([context => { f.requests.push(structuredClone(context)); return fauxAssistantMessage('{"candidates":[]}'); }]);
	await f.session.prompt("/hermes-review run");
	assert.equal(f.requests.length, 1);
	assert.ok(f.ledger.status()[0].targets.every(t => t.startsWith("memory:")));
	assert.equal(f.ledger.status()[0].owner?.plugin, "hermes-memory");
	assert.deepEqual(f.commits, []);
});

for (const change of ["version", "participant", "target"] as const) test(`paid mixed retry confirmation invalidates ${change} without booking or new request`, async t => {
	let base: ExtensionUIContext | undefined;
	const controls: SkillControls = {}, commits: string[] = [];
	const f = await sdkFixture(t, { automaticReview: true, extensions: [skillDouble("zzz-skill", commits, controls), pi => {
		pi.on("session_start", (_event, ctx) => { base = ctx.ui; });
		pi.registerTool({ name: "joint_work", label: "Work", description: "Fixture work", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "native work" }], details: undefined }) });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	const joint: JointFixture = { ...f, controls, commits, requests: [], id: "zzz-skill", ledger: new ReviewLedger(f.agentDir), store: new MemoryStore(f.agentDir, f.cwd) };
	const held = await dueWork(joint);
	try {
		await until(() => joint.requests.length === 1, "initial mixed dispatch");
		held.release(fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture failed shared request" }));
		await until(() => joint.ledger.status()[0]?.status === "failed", "initial request failed");
		const notices: string[] = [];
		assert.ok(base);
		const ui: ExtensionUIContext = { ...base, notify: message => { notices.push(message); }, confirm: async (_title, message) => {
			assert.match(message, /newReservation/);
			if (change === "version") writeFileSync(controls.path!, "EDITED-DURING-CONFIRMATION");
			else if (change === "participant") controls.id = "new-skill";
			else controls.due = false;
			return true;
		} };
		t.after(async () => { await f.session.bindExtensions({ mode: "json" }); });
		await f.session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => f.errors.push(error.error) });
		const calls = f.faux.state.callCount;
		await f.session.prompt(`/hermes-review retry ${joint.ledger.status()[0].id}`);
		assert.equal(f.faux.state.callCount, calls);
		assert.equal(joint.ledger.status().length, 1);
		assert.equal(joint.ledger.status()[0].acknowledged, undefined);
		assert.equal(joint.ledger.status()[0].recovery, undefined);
		assert.ok(["confirmation-invalidated", "unavailable"].includes(JSON.parse(notices.at(-1)!).detail.status));
		assert.deepEqual(commits, []);
		assert.deepEqual(f.errors, []);
	} finally { held.release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("missing commit acknowledgement is failure; explicit retry keeps same consumers and spends exactly once more", async t => {
	let base: ExtensionUIContext | undefined;
	const controls: SkillControls = { commit: "missing" }, commits: string[] = [];
	const f = await sdkFixture(t, { automaticReview: true, extensions: [skillDouble("zzz-skill", commits, controls), pi => {
		pi.on("session_start", (_event, ctx) => { base = ctx.ui; });
		pi.registerTool({ name: "joint_work", label: "Work", description: "Fixture work", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "native work" }], details: undefined }) });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	const joint: JointFixture = { ...f, controls, commits, requests: [], id: "zzz-skill", ledger: new ReviewLedger(f.agentDir), store: new MemoryStore(f.agentDir, f.cwd) };
	const held = await dueWork(joint);
	try {
		await until(() => joint.requests.length === 1, "initial mixed request");
		held.release(held.response());
		await until(() => joint.ledger.status()[0]?.status === "failed", "ack failure visible");
		assert.equal(joint.store.read("user").entries.length, 1);
		assert.ok(joint.ledger.overview().paused);
		controls.commit = undefined;
		assert.ok(base);
		const ui: ExtensionUIContext = { ...base, confirm: async () => true, notify: () => {} };
		t.after(async () => { await f.session.bindExtensions({ mode: "json" }); });
		await f.session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => f.errors.push(error.error) });
		const before = state(joint);
		f.faux.setResponses([context => { joint.requests.push(structuredClone(context)); return held.response({ candidates: [] }); }]);
		await f.session.prompt(`/hermes-review retry ${joint.ledger.status()[0].id}`);
		assert.equal(joint.requests.length, 2);
		assert.equal(joint.ledger.status().length, 2);
		assert.equal(joint.ledger.status()[1].status, "saved");
		assert.equal(joint.ledger.status()[1].retryOf, joint.ledger.status()[0].id);
		assert.equal(joint.ledger.overview().daily.requests, 2);
		assert.deepEqual(state(joint), before);
		assert.equal(commits.length, 1);
	} finally { held.release(fauxAssistantMessage('{"candidates":[]}')); }
});

for (const permission of ["cap", "approval"] as const) test(`skill's own ${permission} veto cannot reject valid memory or inherit model permission`, async t => {
	const f = await jointFixture(t, permission === "cap" ? { cap: 8 } : { approvalRequired: true });
	const held = await dueWork(f);
	try {
		await until(() => f.requests.length === 1, "mixed request");
		held.release(held.response());
		await until(() => f.ledger.status()[0]?.usageState === "reported", "independent validation terminal");
		assert.equal(f.ledger.status()[0].status, permission === "cap" ? "conflict" : "pending");
		assert.equal(f.ledger.status()[0].commits?.find(c => c.consumer === f.id)?.status, permission === "cap" ? "rejected" : "pending");
		assert.equal(f.store.read("user").entries.length, 1);
		assert.throws(() => readFileSync(f.controls.path!), /ENOENT/);
		assert.equal(f.ledger.overview().daily.requests, 1);
		assert.deepEqual(f.commits, []);
	} finally { held.release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("queued native user input during collect invalidates old due snapshot before reservation or dispatch", async t => {
	const controls: SkillControls = {};
	const f = await jointFixture(t, controls);
	await nativeWork(f, 9);
	let once = false;
	controls.onCollect = () => {
		if (once) return;
		once = true;
		// Native input arrives during bounded async collection; do not let old preview spend.
		void f.session.prompt("New native work during collection.");
	};
	f.faux.setResponses([() => fauxAssistantMessage("tenth foreground"), () => fauxAssistantMessage("new foreground"), context => {
		f.requests.push(structuredClone(context)); return fauxAssistantMessage('{"candidates":[]}');
	}]);
	await f.session.prompt("Tenth native work.");
	await new Promise(resolve => setTimeout(resolve, 650));
	// New eligible boundary may spend once; old tenth snapshot must never be reserved.
	const users = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user");
	assert.equal(users.length, 11);
	assert.ok(f.ledger.status().every(r => r.schedule?.user !== users.at(-2)?.id));
	assert.ok(f.ledger.overview().daily.requests <= 1);
	assert.ok(f.requests.length <= 1);
	assert.deepEqual(f.errors, []);
});

// Focused native repair regressions are appended below; inherited cases stay intact.

test("reserved peer ID memory fails visibly before auxiliary admission and preserves memory cadence", async t => {
	const f = await jointFixture(t, {}, "memory");
	const captures: { context: TranscriptContext; options: { maxRetries?: number; maxTokens?: number } }[] = [];
	f.faux.setResponses([...Array.from({ length: 10 }, () => () => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })),
		() => fauxAssistantMessage("native foreground success"), (context, options) => {
			captures.push({ context: structuredClone(context), options: { maxRetries: options?.maxRetries, maxTokens: options?.maxTokens } });
			return fauxAssistantMessage(JSON.stringify({ consumers: { memory: { workflow: "Must not write." } } }));
		}]);
	await f.session.prompt("One user with ten tool-bearing native turns.");
	const last = f.session.messages.at(-1);
	assert.equal(last?.role, "assistant");
	if (last?.role === "assistant") assert.equal(last.stopReason, "stop", last.errorMessage ?? "foreground failed");
	await until(() => f.ledger.status().some(r => r.reason === "review-protocol-incompatible-or-ambiguous"), "reserved ID visible");
	assert.equal(f.faux.state.callCount, 11, "ten genuine tools plus final foreground, zero auxiliary");
	assert.deepEqual(captures, []);
	assert.equal(f.ledger.overview().daily.requests, 0);
	assert.ok(f.ledger.overview().paused);
	assert.ok(f.ledger.status().every(r => r.usageState === "not-sent"));
	assert.deepEqual(f.commits, []);
	assert.equal(f.store.read("user").entries.length, 0);
	const view: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { view.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await f.session.prompt("/hermes-review status"); } finally { process.stdout.write = write; }
	const schedule = JSON.parse(view.join("").trim()).detail.schedule;
	assert.equal(schedule.progress, 1);
	assert.equal(schedule.attempted, false);
	assert.deepEqual(f.errors, []);
	t.diagnostic(JSON.stringify({ providerCalls: f.faux.state.callCount, auxiliary: captures.length, debit: f.ledger.overview().daily.requests, schedule, protocolError: f.ledger.overview().paused }));
});

for (const first of ["memory", "peer"] as const) test(`new qualifying tool work after ${first}-only request admits peer once without a new user`, async t => {
	const f = await jointFixture(t);
	const captures: { context: TranscriptContext; maxRetries?: number }[] = [];
	const reply = (context: TranscriptContext, options?: { maxRetries?: number }) => {
		captures.push({ context: structuredClone(context), maxRetries: options?.maxRetries });
		return fauxAssistantMessage(JSON.stringify({ consumers: { [f.id]: { workflow: "Independent new tool work." } } }));
	};
	if (first === "memory") {
		await nativeWork(f, 9, false);
		f.faux.setResponses([() => fauxAssistantMessage("tenth native foreground"), (context, options) => {
			captures.push({ context: structuredClone(context), maxRetries: options?.maxRetries }); return fauxAssistantMessage('{"candidates":[]}');
		}]);
		await f.session.prompt("Tenth native user.");
	} else {
		f.faux.setResponses([...Array.from({ length: 10 }, () => () => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })),
			() => fauxAssistantMessage("first native tool work"), reply]);
		await f.session.prompt("One user, first ten native tools.");
	}
	const initial = f.session.messages.at(-1);
	assert.equal(initial?.role, "assistant");
	if (initial?.role === "assistant") assert.equal(initial.stopReason, "stop");
	await until(() => f.ledger.status()[0]?.usageState === "reported", "initial accounted request");
	const users = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length;
	await duplicateBoundary(f);
	assert.equal(f.ledger.overview().daily.requests, 1);
	assert.equal(captures.length, 1);
	f.faux.setResponses([...Array.from({ length: 10 }, () => () => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })),
		() => fauxAssistantMessage("new qualifying tool work completed"), reply]);
	await f.session.sendCustomMessage({ customType: "joint-new-tools", content: "Ten new real tools, same native user.", display: false }, { triggerTurn: true });
	const last = f.session.messages.at(-1);
	assert.equal(last?.role, "assistant");
	if (last?.role === "assistant") assert.equal(last.stopReason, "stop");
	await until(() => f.ledger.status().filter(r => r.usageState === "reported").length === 2, "new peer-only request");
	assert.equal(f.ledger.overview().daily.requests, 2);
	assert.equal(captures.length, 2);
	assert.deepEqual(f.ledger.status()[1].targets, [`${f.id}:workflow`]);
	assert.equal(f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length, users);
	await duplicateBoundary(f);
	await f.session.reload();
	await duplicateBoundary(f);
	assert.equal(f.ledger.overview().daily.requests, 2);
	assert.equal(captures.length, 2);
	assert.deepEqual(f.errors, []);
	t.diagnostic(JSON.stringify({ first, users, auxiliary: captures.length, debit: f.ledger.overview().daily.requests, payloads: captures }));
});

test("post-confirmation peer dispatch input revokes retry before unknown debt recovery or pause mutation", async t => {
	const f = await jointFixture(t, { due: true }, "aaa-skill");
	const held = await dueWork(f);
	try {
		await until(() => f.requests.length === 1, "initial paid request");
		await f.session.prompt("/hermes-review cancel");
		await until(() => f.ledger.status()[0].status === "cancelled", "unknown cancelled debt");
		const old = f.ledger.status()[0];
		assert.equal(old.usageState, "unknown");
		mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
		writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ automaticReview: false }));
		await f.session.prompt("/hermes-review status");
		assert.ok(f.controls.ui);
		let before: ReturnType<ReviewLedger["overview"]> | undefined;
		const notices: string[] = [];
		const ui: ExtensionUIContext = { ...f.controls.ui, notify: message => { notices.push(message); }, confirm: async () => { before = f.ledger.overview(); return true; } };
		t.after(async () => { await f.session.bindExtensions({ mode: "json" }); });
		await f.session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => f.errors.push(error.error) });
		let newInput: Promise<void> | undefined;
		f.controls.dispatch = event => {
			event.ack(); void event.execute().catch(() => {});
			f.faux.setResponses([() => fauxAssistantMessage("new native foreground success")]);
			newInput = f.session.prompt("New input after paid retry confirmation, during peer dispatch.");
		};
		const calls = f.faux.state.callCount;
		await f.session.prompt(`/hermes-review retry ${old.id}`);
		await newInput;
		const last = f.session.messages.at(-1);
		assert.equal(last?.role, "assistant");
		if (last?.role === "assistant") assert.equal(last.stopReason, "stop");
		assert.ok(before);
		const after = f.ledger.overview();
		assert.equal(f.faux.state.callCount, calls + 1, "new foreground only, zero retry auxiliary");
		assert.equal(f.requests.length, 1);
		assert.deepEqual({ acknowledged: after.requests[0].acknowledged, recovery: after.requests[0].recovery, paused: after.paused },
			{ acknowledged: before.requests[0].acknowledged, recovery: before.requests[0].recovery, paused: before.paused });
		assert.equal(after.requests.length, before.requests.length, "revoked confirmation never enters admission");
		assert.equal(JSON.parse(notices.at(-1)!).detail.reason, "retry-context-changed");
		assert.deepEqual(f.errors, []);
	} finally { held.release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("ordinary peer-only confirmed retry keeps bound skill targets and unconsumed memory cadence", async t => {
	const f = await jointFixture(t);
	const captures: TranscriptContext[] = [];
	f.faux.setResponses([...Array.from({ length: 10 }, () => () => fauxAssistantMessage(fauxToolCall("joint_work", {}), { stopReason: "toolUse" })),
		() => fauxAssistantMessage("native foreground success"), context => { captures.push(structuredClone(context)); return fauxAssistantMessage("", { stopReason: "error", errorMessage: "synthetic peer request failure" }); }]);
	await f.session.prompt("One native user, ten genuine tool turns.");
	const last = f.session.messages.at(-1);
	assert.equal(last?.role, "assistant");
	if (last?.role === "assistant") assert.equal(last.stopReason, "stop");
	await until(() => f.ledger.status()[0]?.status === "failed", "peer-only failure");
	assert.deepEqual(f.ledger.status()[0].targets, [`${f.id}:workflow`]);
	assert.ok(f.controls.ui);
	const notices: string[] = [];
	const ui: ExtensionUIContext = { ...f.controls.ui, notify: message => { notices.push(message); }, confirm: async (_title, message) => {
		assert.deepEqual(JSON.parse(message).targets, [`${f.id}:workflow`]); return true;
	} };
	t.after(async () => { await f.session.bindExtensions({ mode: "json" }); });
	await f.session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => f.errors.push(error.error) });
	const before = state(f);
	f.faux.setResponses([context => { captures.push(structuredClone(context)); return fauxAssistantMessage(JSON.stringify({ consumers: { [f.id]: { workflow: "Retry own skill only." } } })); }]);
	await f.session.prompt(`/hermes-review retry ${f.ledger.status()[0].id}`);
	assert.equal(captures.length, 2);
	assert.equal(f.faux.state.callCount, 13);
	assert.equal(f.ledger.overview().daily.requests, 2);
	assert.deepEqual(f.ledger.status()[1].targets, [`${f.id}:workflow`]);
	assert.equal(f.ledger.status()[1].status, "saved");
	assert.deepEqual(f.ledger.status()[1].saved, []);
	assert.equal(f.store.read("user").entries.length, 0);
	assert.deepEqual(state(f), before);
	await f.session.prompt("/hermes-review status");
	const schedule = JSON.parse(notices.at(-1)!).detail.schedule;
	assert.equal(schedule.progress, 1);
	assert.equal(schedule.attempted, false);
	assert.deepEqual(f.errors, []);
});

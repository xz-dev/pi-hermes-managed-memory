import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, Type, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, getAgentDir, SessionManager, type ExtensionContext, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { MemoryStore, type MemoryEntry, type FileTarget } from "../src/memory-store.ts";
import { reviewLines } from "../src/review-display.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
function isReview(context: TranscriptContext): boolean {
	const last = context.messages.at(-1);
	return last?.role === "user" && typeof last.content === "string" && last.content.includes('"instruction":"Review the existing effective snapshot.');
}
async function until(check: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
	assert.ok(check(), label);
}
async function promptSucceeded(f: Fixture, input: string): Promise<void> {
	await f.session.prompt(input);
	const last = f.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "native foreground failed");
}
async function fixture(t: TestContext, options: MemoryOptions = {}, before: ExtensionFactory = () => {}) {
	return sdkFixture(t, { automaticReview: true, extensions: [pi => { before(pi); createMemoryExtension({ projectRoot: join(getAgentDir(), "project"), ...options })(pi); }] });
}
const seed = (id: string, fact: string): MemoryEntry => ({ id, fact, source: { kind: "user-authored" }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" });

for (const relation of ['Correction: "I prefer concise answers." -> "I prefer detailed answers."', '更正：“I prefer concise answers.” → “I prefer detailed answers.”']) test(`automatic explicit old→new correction updates same entry without pending: ${relation}`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd), requests: { auxiliary: boolean; context: TranscriptContext }[] = [];
	store.add(store.read("user"), [seed("preference", "I prefer concise answers.")]);
	const before = store.read("user");
	const capture = (context: TranscriptContext) => { requests.push({ auxiliary: isReview(context), context: structuredClone(context) }); return fauxAssistantMessage("foreground ok"); };
	f.faux.setResponses(Array.from({ length: 9 }, () => capture));
	for (let n = 1; n <= 9; n++) await promptSucceeded(f, `Native proposal work ${n}.`);
	f.faux.setResponses([capture, context => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context) });
		const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
		return fauxAssistantMessage(JSON.stringify({ candidates: [{ kind: "preference", fact: "I prefer detailed answers.", quote: "I prefer detailed answers.", entry: source, replaces: "preference" }] }));
	}]);
	await promptSucceeded(f, relation);
	const native = { bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId() };
	const ledger = new ReviewLedger(f.agentDir);
	await until(() => ledger.status()[0]?.usageState === "reported", "automatic correction accounts one response");
	const after = store.read("user");
	assert.equal(after.entries[0].fact, "I prefer detailed answers.", "direct native old→new correction must commit without approval");
	assert.equal(after.entries[0].id, "preference");
	assert.equal(after.entries[0].created, before.entries[0].created);
	assert.notEqual(after.version, before.version);
	assert.equal(store.pending("user").length, 0);
	assert.equal(ledger.status()[0].status, "saved");
	assert.equal(ledger.status()[0].trigger, "settled");
	assert.equal(ledger.overview().daily.requests, 1);
	assert.equal(requests.filter(r => !r.auxiliary).length, 10);
	assert.equal(requests.filter(r => r.auxiliary).length, 1);
	assert.deepEqual({ bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId() }, native);
	assert.deepEqual(f.errors, []);
});


const OLD = "I prefer concise answers.", NEW = "I prefer detailed answers.";
const correction = (old = OLD, next = NEW) => `Correction: "${old}" -> "${next}"`;
const proposal = (value: unknown) => fauxAssistantMessage(JSON.stringify(value));
const pref = (entry: string, fact = NEW, replaces?: string) => ({ kind: "preference", fact, quote: fact, entry, ...(replaces ? { replaces } : {}) });
function nativeState(f: Fixture) { return { bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId(),
	entries: JSON.stringify(f.sessionManager.getEntries()), messages: JSON.stringify(f.session.messages) }; }
async function automatic(f: Fixture, input: string, reply: (entry: string) => ReturnType<typeof fauxAssistantMessage>, afterAdmission?: () => void | Promise<void>) {
	const requests: { auxiliary: boolean; context: TranscriptContext; options?: SimpleStreamOptions }[] = [];
	const foreground = (context: TranscriptContext, options?: SimpleStreamOptions) => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return fauxAssistantMessage("foreground ok");
	};
	f.faux.setResponses(Array.from({ length: 9 }, () => foreground));
	for (let n = 1; n <= 9; n++) await promptSucceeded(f, `Native work ${n}.`);
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([foreground, (context, options) => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return held;
	}]);
	try {
		await promptSucceeded(f, input);
		await until(() => requests.some(r => r.auxiliary), "default tenth native settlement submits one proposal request");
		const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
		const native = nativeState(f), ledger = new ReviewLedger(f.agentDir);
		assert.equal(ledger.status()[0].status, "admitted");
		await afterAdmission?.();
		release(reply(source));
		await until(() => ledger.status()[0]?.usageState === "reported", "every proposal outcome settles actual usage");
		const record = ledger.status()[0];
		assert.equal(record.trigger, "settled"); assert.equal(ledger.status().length, 1); assert.equal(ledger.overview().daily.requests, 1);
		assert.equal(requests.filter(r => !r.auxiliary).length, 10); assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.equal(requests.find(r => r.auxiliary)?.options?.maxRetries, 0);
		assert.equal(requests.find(r => r.auxiliary)?.options?.toolChoice, "none");
		assert.deepEqual(nativeState(f), native, "background proposal cannot write native chat, custom entries or leaf");
		assert.deepEqual(f.errors, []);
		return { record, requests, ledger, source, native };
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
}
async function stdoutOf(run: () => Promise<void>): Promise<string> {
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await run(); } finally { process.stdout.write = write; }
	return output.join("");
}
function noPending(store: MemoryStore) { for (const snapshot of store.readAll()) assert.equal(store.pending(snapshot.target).length, 0); }

test("natural tenth-turn preference saves with genuine source and fresh native session reuses it without remember wording", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	const sent = await automatic(f, OLD, entry => proposal({ candidates: [pref(entry, OLD)] }));
	assert.equal(sent.record.status, "saved");
	const fact = store.read("user").entries[0];
	assert.deepEqual(fact.source, { session: f.sessionManager.getSessionId(), entry: sent.source, quote: OLD });
	assert.deepEqual(sent.record.saved, [fact.id]);
	noPending(store);
	const instruction = sent.requests.find(r => r.auxiliary)!.context.messages.at(-1)!;
	assert.equal(instruction.role, "user");
	assert.match(JSON.stringify(instruction.content), /replaces\?|removals\?/);
	assert.doesNotMatch(JSON.stringify(instruction.content), /No tool execution, deletions or replacements/);
	f.session.dispose(); await f.loader.reload();
	const created = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, model: f.model, modelRuntime: f.modelRuntime,
		settingsManager: f.settingsManager, resourceLoader: f.loader, noTools: "builtin", sessionManager: SessionManager.create(f.cwd, join(f.agentDir, "sessions")) });
	t.after(() => created.session.dispose());
	const errors = created.extensionsResult.errors.map(error => error.error);
	await created.session.bindExtensions({ mode: "json", onError: error => errors.push(error.error) });
	let request: TranscriptContext | undefined;
	f.faux.setResponses([context => { request = structuredClone(context); return fauxAssistantMessage("used scoped memory"); }]);
	await created.session.prompt("Explain current task in detail.");
	const terminal = created.session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1)?.message;
	assert.equal(terminal?.role, "assistant"); if (terminal?.role === "assistant") assert.equal(terminal.stopReason, "stop");
	assert.match(getCurrentSystemPrompt(request!.messages), /I prefer concise answers\./);
	assert.match(getCurrentSystemPrompt(request!.messages), new RegExp(store.read("user").version));
	assert.ok(getCurrentSystemPrompt(request!.messages).includes(`${fact.source && "session" in fact.source ? fact.source.session : ""}/${sent.source}`));
	assert.match(getCurrentSystemPrompt(request!.messages), /Current user instructions take precedence/);
	assert.equal(sent.ledger.status()[0].recalls.length, 1); assert.equal(sent.ledger.overview().daily.requests, 1);
	assert.equal(f.faux.state.callCount, 12); assert.deepEqual(errors, []);
	t.diagnostic(JSON.stringify({ saved: 1, reusedInFreshSession: 1, foreground: 11, auxiliary: 1, debit: 1 }));
});

test("direct Chinese native old→new correction changes same USER entry and stores new source", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd), old = "我偏好简洁回答。", next = "我偏好详细回答。";
	store.add(store.read("user"), [seed("preference", old)]); const before = store.read("user");
	const sent = await automatic(f, `更正：“${old}” → “${next}”`, entry => proposal({ candidates: [pref(entry, next, "preference")] }));
	const after = store.read("user");
	assert.equal(sent.record.status, "saved"); assert.equal(after.entries[0].fact, next); assert.equal(after.entries[0].id, "preference");
	assert.deepEqual(after.entries[0].source, { session: f.sessionManager.getSessionId(), entry: sent.source, quote: next });
	assert.equal(after.entries[0].created, before.entries[0].created); assert.notEqual(after.version, before.version); noPending(store);
});

for (const input of [
	NEW,
	`Perhaps change "${OLD}" to "${NEW}"?`,
	correction("I prefer short responses."),
	`"${OLD}"\nCorrection:\n"${NEW}"`,
	`Correction: "${OLD}" <- "${NEW}"`,
	`Example: ${correction()}`,
	`\`\`\`text\n${correction()}\n\`\`\`\n${NEW}`,
	`> ${correction()}\n${NEW}`,
	`${correction()}\n${correction(OLD, "I prefer examples.")}`,
	`${correction()}\n${correction()}`,
]) test(`unsupported/ambiguous relation stages whole same-target batch: ${input}`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [seed("preference", OLD)]); const before = store.read("user");
	const sent = await automatic(f, input, entry => proposal({ candidates: [pref(entry, NEW, "preference")] }));
	assert.equal(sent.record.status, "pending"); assert.deepEqual(sent.record.phases, ["admitted", "pending"]);
	assert.deepEqual(sent.record.saved, []); assert.equal(sent.record.commits?.[0].status, "pending");
	assert.equal(store.read("user").raw, before.raw);
	const pending = store.pending("user"); assert.equal(pending.length, 1); assert.equal(pending[0].base, before.version);
	assert.deepEqual(pending[0].diff, [{ id: "preference", kind: "replacement", old: OLD, fact: NEW }]);
	assert.match(reviewLines(sent.ledger.overview()).join("\n"), /Latest: pending/);
	// Real native continuation does not re-dispatch processed user work or add another pending row.
	f.faux.setResponses([fauxAssistantMessage("continued")]);
	await f.session.sendCustomMessage({ customType: "proposal-observer", content: "continue without new user", display: false }, { triggerTurn: true });
	assert.equal(sent.ledger.status().length, 1); assert.equal(store.pending("user").length, 1);
});

test("one ambiguous same-target change keeps safe addition and explicit correction pending together", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [seed("one", OLD), seed("two", "I prefer tables.")]); const before = store.read("user");
	const input = `${correction()}\nI prefer examples.\nI prefer prose.`;
	const sent = await automatic(f, input, entry => proposal({ candidates: [pref(entry, NEW, "one"), pref(entry, "I prefer examples."), pref(entry, "I prefer prose.", "two")] }));
	assert.equal(sent.record.status, "pending"); assert.equal(store.read("user").raw, before.raw);
	assert.deepEqual(store.pending("user")[0].diff.map(change => change.kind), ["addition", "replacement", "replacement"]);
});

for (const action of ["replacement", "removal"] as const) test(`automatic ${action} pending uses real no-UI, decline and exact public approval once`, async t => {
	let context: ExtensionContext | undefined;
	const f = await fixture(t, {}, pi => { pi.on("session_start", (_event, ctx) => { context = ctx; }); });
	const store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const before = store.read("user");
	const sent = await automatic(f, NEW, entry => proposal(action === "replacement" ? { candidates: [pref(entry, NEW, "preference")] } : { candidates: [], removals: [{ target: "user", id: "preference" }] }));
	assert.equal(sent.record.status, "pending"); const pending = store.pending("user")[0];
	const command = `/hermes-memory approve user ${pending.id}`;
	const noUI = await stdoutOf(() => f.session.prompt(command));
	assert.equal(JSON.parse(noUI).detail.status, "confirmation-required"); assert.equal(store.read("user").raw, before.raw);
	const previews: string[] = [], notices: string[] = [];
	const ui = { ...context!.ui, notify: (message: string) => { notices.push(message); }, confirm: async (_title: string, body: string) => { previews.push(body); return false; } };
	await f.session.bindExtensions({ mode: "rpc", uiContext: ui });
	await f.session.prompt(command);
	assert.equal(JSON.parse(notices.at(-1)!).status, "declined"); assert.equal(store.read("user").raw, before.raw); assert.equal(store.pending("user").length, 1);
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...ui, confirm: async (_title, body) => { previews.push(body); return true; } } });
	await f.session.prompt(command);
	assert.equal(JSON.parse(notices.at(-1)!).status, "saved");
	const approvedPreview = JSON.parse(previews.at(-1)!);
	assert.equal(approvedPreview.proposal.id, pending.id); assert.equal(approvedPreview.proposal.stamp, pending.stamp);
	assert.deepEqual(approvedPreview.proposal.diff, pending.diff);
	if (action === "removal") { assert.equal(store.read("user").entries.length, 0); assert.equal(store.read("user").tombstones.length, 1); }
	else assert.equal(store.read("user").entries[0].fact, NEW);
	assert.equal(store.pending("user").length, 0); const applied = store.read("user");
	await f.session.prompt(command);
	assert.equal(store.read("user").raw, applied.raw); assert.equal(JSON.parse(notices.at(-1)!).status, "unavailable");
	assert.equal(f.faux.state.callCount, 11); assert.equal(sent.ledger.overview().daily.requests, 1);
	assert.deepEqual(nativeState(f), sent.native); assert.deepEqual(f.errors, []);
	await f.session.bindExtensions({ mode: "json" });
});

for (const invalid of ["source", "privacy", "temporary", "quoted", "fenced", "foreign-session", "model-flag"] as const) test(`invalid ${invalid} rejects whole proposal, never persists refused body in pending`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const before = store.readAll().map(s => s.raw);
	const input = { source: "Ordinary work only.", privacy: `password label\n${correction()}`, temporary: `This time:\n${correction()}`,
		quoted: `webpage quote:\n${correction()}`, fenced: `\`\`\`text\n${correction()}\n\`\`\``, "foreign-session": correction(), "model-flag": correction() }[invalid];
	const sent = await automatic(f, input, entry => proposal({ candidates: [pref(invalid === "foreign-session" ? "foreign-entry" : entry, NEW, "preference"),
		// Valid-looking second target cannot escape whole-proposal source/schema rejection.
		{ kind: "environment", fact: NEW, quote: NEW, entry, ...(invalid === "model-flag" ? { explicitCorrection: true } : {}) }], removals: [{ target: "user", id: "preference" }] }));
	assert.equal(sent.record.status, "no-proposal"); assert.equal(sent.record.reason, "proposal-validation");
	assert.equal(sent.record.commits, undefined); noPending(store); assert.deepEqual(store.readAll().map(s => s.raw), before);
});

for (const idCase of ["missing", "foreign-target"] as const) test(`replacement ${idCase} ID refuses, never moves across targets`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [seed("preference", OLD)]); store.add(store.read("global"), [seed("global-id", OLD)]);
	const before = store.readAll().map(s => s.raw);
	const sent = await automatic(f, correction(), entry => proposal({ candidates: [pref(entry, NEW, idCase === "missing" ? "absent" : "global-id")] }));
	assert.equal(sent.record.status, "conflict"); assert.equal(sent.record.commits?.[0].status, "conflict");
	noPending(store); assert.deepEqual(store.readAll().map(s => s.raw), before);
});

for (const change of ["version", "epoch"] as const) test(`stale ${change} refuses explicit correction without rebasing or pending`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const before = store.read("user"); let live = before;
	const sent = await automatic(f, correction(), entry => proposal({ candidates: [pref(entry, NEW, "preference")] }), () => {
		if (change === "version") writeFileSync(before.path, before.raw + "\nExternal correction.\n");
		else { store.add(store.read("user"), [seed("other", "Another durable fact.")]); store.rollback("user"); }
		live = store.read("user");
	});
	if (change === "epoch") { assert.equal(live.version, before.version); assert.notEqual(live.epoch, before.epoch); }
	assert.equal(sent.record.status, "conflict"); assert.equal(sent.record.commits?.[0].status, "conflict");
	assert.equal(store.read("user").raw, live.raw); assert.equal(store.read("user").entries[0].fact, OLD); noPending(store);
});

test("oversize explicit correction preserves target and reports rejected without consolidation", async t => {
	const f = await fixture(t, { caps: { user: 360 } }), store = new MemoryStore(f.agentDir, f.cwd, { user: 360 });
	store.add(store.read("user"), [seed("preference", OLD)]); const before = store.read("user");
	const next = "I prefer " + "detailed ".repeat(45) + "answers.";
	const sent = await automatic(f, correction(OLD, next), entry => proposal({ candidates: [pref(entry, next, "preference")] }));
	assert.equal(sent.record.status, "conflict"); assert.equal(sent.record.commits?.[0].status, "rejected");
	assert.equal(store.read("user").raw, before.raw); noPending(store);
});

test("forgotten fact cannot revive through fresh addition identity", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	store.forget(store.read("user"), [{ id: "preference", expectedFact: OLD }]); const before = store.read("user");
	const sent = await automatic(f, OLD, entry => proposal({ candidates: [pref(entry, OLD)] }));
	assert.equal(sent.record.status, "no-change"); assert.deepEqual(sent.record.saved, []); assert.equal(store.read("user").raw, before.raw);
	assert.equal(store.read("user").entries.length, 0); assert.deepEqual(store.read("user").tombstones, before.tombstones); noPending(store);
});

test("mixed targets independently report saved/pending/rejected and keep one paid response", async t => {
	const f = await fixture(t, { caps: { global: 80 } }), store = new MemoryStore(f.agentDir, f.cwd, { global: 80 });
	store.add(store.read("project"), [seed("project-old", "This project uses npm.")]); const before = store.read("project");
	const input = `${OLD}\nMy workstation uses Linux.`;
	const sent = await automatic(f, input, entry => proposal({ candidates: [pref(entry, OLD), { kind: "environment", fact: "My workstation uses Linux.", quote: "My workstation uses Linux.", entry }],
		removals: [{ target: "project", id: "project-old" }] }));
	assert.equal(sent.record.status, "conflict");
	assert.deepEqual(Object.fromEntries(sent.record.commits!.map(commit => [commit.target, commit.status])), { user: "saved", global: "rejected", project: "pending" });
	assert.equal(store.read("user").entries[0].fact, OLD); assert.equal(store.read("global").raw, ""); assert.equal(store.read("project").raw, before.raw);
	assert.equal(store.pending("project").length, 1); assert.equal(sent.record.saved.length, 1);
});

for (const response of ["invalid-json", "unsupported-field", "unsupported-candidate-field", "too-many", "tool-call", "incomplete"] as const) test(`${response} yields accounted no-proposal, no arbitrary tool execution or hidden retry`, async t => {
	let executions = 0;
	const f = await fixture(t, {}, pi => { pi.registerTool({ name: "proposal_attack", label: "Attack", description: "Never executes during review", parameters: Type.Object({}),
		execute: async () => { executions++; return { content: [{ type: "text", text: "executed" }], details: undefined }; } }); });
	const store = new MemoryStore(f.agentDir, f.cwd), before = store.readAll().map(s => s.raw);
	const sent = await automatic(f, OLD, entry => {
		if (response === "invalid-json") return fauxAssistantMessage('{"candidates":[');
		if (response === "tool-call") return fauxAssistantMessage(fauxToolCall("proposal_attack", {}), { stopReason: "toolUse" });
		if (response === "incomplete") return fauxAssistantMessage('{"candidates":[]}', { stopReason: "length" });
		if (response === "too-many") return proposal({ candidates: Array.from({ length: 17 }, () => pref(entry, OLD)) });
		if (response === "unsupported-field") return proposal({ candidates: [pref(entry, OLD)], execute: { command: "touch forbidden" } });
		return proposal({ candidates: [{ ...pref(entry, OLD), approved: true }] });
	});
	assert.equal(sent.record.status, "no-proposal"); assert.equal(executions, 0); assert.deepEqual(store.readAll().map(s => s.raw), before); noPending(store);
	assert.equal(existsSync(join(f.cwd, "forbidden")), false);
});

test("ContextEdit-displayed relation cannot manufacture native correction authority or leak hidden native bytes", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const requests: TranscriptContext[] = [];
	f.faux.setResponses(Array.from({ length: 9 }, () => fauxAssistantMessage("foreground ok")));
	for (let n = 1; n <= 9; n++) await promptSucceeded(f, n === 9 ? `${NEW} NATIVE-RAW-ONLY-MARKER` : `Work ${n}.`);
	const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
	f.sessionManager.appendContextEdit(source, { content: correction() });
	f.faux.setResponses([fauxAssistantMessage("foreground ok"), context => { requests.push(structuredClone(context)); return proposal({ candidates: [pref(source, NEW, "preference")] }); }]);
	await promptSucceeded(f, "Finish current work.");
	const ledger = new ReviewLedger(f.agentDir); await until(() => ledger.status()[0]?.usageState === "reported", "displayed proposal settles");
	assert.equal(ledger.status()[0].status, "pending"); assert.equal(store.read("user").entries[0].fact, OLD);
	assert.equal(requests.length, 1); assert.doesNotMatch(JSON.stringify(requests[0]), /NATIVE-RAW-ONLY-MARKER/);
	assert.match(readFileSync(f.sessionManager.getSessionFile()!, "utf8"), /NATIVE-RAW-ONLY-MARKER/); assert.deepEqual(f.errors, []);
});


test("explicit correction cannot revive a tombstoned value under an existing live entry ID", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [seed("preference", OLD), seed("forgotten", NEW)]);
	store.forget(store.read("user"), [{ id: "forgotten", expectedFact: NEW }]); const before = store.read("user");
	const sent = await automatic(f, correction(), entry => proposal({ candidates: [pref(entry, NEW, "preference")] }));
	assert.equal(sent.record.status, "no-change"); assert.deepEqual(sent.record.saved, []);
	assert.equal(store.read("user").raw, before.raw); assert.equal(store.read("user").entries[0].fact, OLD);
	assert.deepEqual(store.read("user").tombstones, before.tombstones); noPending(store);
});

test("saved and pending independent targets show pending aggregate with saved IDs, not fabricated conflict or global success", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const before = store.read("user");
	const sent = await automatic(f, `${NEW}\nMy workstation uses Linux.`, entry => proposal({ candidates: [pref(entry, NEW, "preference"),
		{ kind: "environment", fact: "My workstation uses Linux.", quote: "My workstation uses Linux.", entry }] }));
	assert.equal(sent.record.status, "pending"); assert.deepEqual(sent.record.phases, ["admitted", "saved", "pending"]);
	assert.deepEqual(Object.fromEntries(sent.record.commits!.map(commit => [commit.target, commit.status])), { user: "pending", global: "saved" });
	assert.equal(store.read("user").raw, before.raw); assert.equal(store.pending("user").length, 1);
	assert.equal(store.read("global").entries[0].fact, "My workstation uses Linux."); assert.equal(sent.record.saved.length, 1);
});

test("ContextEdit cannot launder whole-native private qualifier into automatic correction or pending", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd); store.add(store.read("user"), [seed("preference", OLD)]);
	const before = store.read("user"), requests: TranscriptContext[] = [];
	f.faux.setResponses(Array.from({ length: 9 }, () => fauxAssistantMessage("foreground ok")));
	for (let n = 1; n <= 9; n++) await promptSucceeded(f, n === 9 ? `password PRIVATE-NATIVE-ONLY-MARKER\n${correction()}` : `Work ${n}.`);
	const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
	f.sessionManager.appendContextEdit(source, { content: correction() });
	f.faux.setResponses([fauxAssistantMessage("foreground ok"), context => { requests.push(structuredClone(context)); return proposal({ candidates: [pref(source, NEW, "preference")] }); }]);
	await promptSucceeded(f, "Complete work."); const ledger = new ReviewLedger(f.agentDir);
	await until(() => ledger.status()[0]?.usageState === "reported", "native private-source refusal accounted");
	assert.equal(ledger.status()[0].status, "no-proposal"); assert.equal(ledger.status()[0].reason, "proposal-validation");
	assert.equal(store.read("user").raw, before.raw); noPending(store);
	assert.equal(requests.length, 1); assert.doesNotMatch(JSON.stringify(requests[0]), /PRIVATE-NATIVE-ONLY-MARKER/);
	assert.equal(f.faux.state.callCount, 11); assert.equal(ledger.overview().daily.requests, 1); assert.deepEqual(f.errors, []);
});


test("removal keeps otherwise explicit same-target correction pending and pending status survives supported reload", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd);
	store.add(store.read("user"), [seed("preference", OLD), seed("obsolete", "I prefer bullet lists.")]); const before = store.read("user");
	const sent = await automatic(f, correction(), entry => proposal({ candidates: [pref(entry, NEW, "preference")], removals: [{ target: "user", id: "obsolete" }] }));
	assert.equal(sent.record.status, "pending"); assert.equal(store.read("user").raw, before.raw);
	assert.deepEqual(store.pending("user")[0].diff.map(change => change.kind), ["replacement", "removal"]);
	const restored = await stdoutOf(() => f.session.reload());
	assert.ok(restored.includes('"status":"pending"'));
	const status = await stdoutOf(() => f.session.prompt("/hermes-review status"));
	assert.equal(JSON.parse(status).detail.requests[0].status, "pending");
	assert.equal(sent.ledger.overview().daily.requests, 1); assert.equal(f.faux.state.callCount, 11);
	assert.equal(store.read("user").raw, before.raw); assert.deepEqual(f.errors, []);
});


const authorityThird = "I prefer examples.";
const authorityCn = (old: string, next: string) => `更正：“${old}” → “${next}”`;
const authorityCases: { id: string; early: string; later: string; select: "early" | "latest"; fact: string; status: "pending" | "saved" }[] = [
	{ id: "F1 older English competing correction", early: correction(), later: correction(OLD, authorityThird), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 older English reversal", early: correction(), later: correction(NEW, OLD), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 later correction starts from proposed value", early: correction(), later: correction(NEW, authorityThird), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 later correction returns to bound old value", early: correction(), later: correction(authorityThird, OLD), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 older Chinese competing correction", early: authorityCn(OLD, NEW), later: authorityCn(OLD, authorityThird), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 older Chinese reversal", early: authorityCn(OLD, NEW), later: authorityCn(NEW, OLD), select: "early", fact: NEW, status: "pending" },
	{ id: "F1 later competing relation uses other supported language", early: correction(), later: authorityCn(OLD, authorityThird), select: "early", fact: NEW, status: "pending" },
	{ id: "latest English correction retains automatic permission", early: correction(), later: correction(OLD, authorityThird), select: "latest", fact: authorityThird, status: "saved" },
	{ id: "latest Chinese correction retains automatic permission", early: authorityCn(OLD, NEW), later: authorityCn(OLD, authorityThird), select: "latest", fact: authorityThird, status: "saved" },
	{ id: "unrelated later work does not revoke correction", early: correction(), later: "Continue ordinary work.", select: "early", fact: NEW, status: "saved" },
	{ id: "unrelated later exact relation does not revoke correction", early: correction(), later: correction("I prefer tables.", "I prefer prose."), select: "early", fact: NEW, status: "saved" },
	{ id: "compatible later repeated decision does not compete", early: correction(), later: correction(), select: "early", fact: NEW, status: "saved" },
	{ id: "F2 English whole-message negation", early: "Ordinary work.", later: `Do not apply the following correction:\n${correction()}`, select: "latest", fact: NEW, status: "pending" },
	{ id: "F2 Chinese whole-message qualifier", early: "Ordinary work.", later: `不要执行以下更正：\n${authorityCn(OLD, NEW)}`, select: "latest", fact: NEW, status: "pending" },
	{ id: "F2 unsupported trailing context", early: "Ordinary work.", later: `${correction()}\nDo not apply the above.`, select: "latest", fact: NEW, status: "pending" },
	{ id: "F2 extra context need not belong to negation vocabulary", early: "Ordinary work.", later: `Compare these options:\n${correction()}`, select: "latest", fact: NEW, status: "pending" },
	{ id: "outer whitespace around entire direct message remains supported", early: "Ordinary work.", later: `  \n ${correction()} \n `, select: "latest", fact: NEW, status: "saved" },
];
for (const c of authorityCases) test(`correction authority repair: ${c.id}`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd), ledger = new ReviewLedger(f.agentDir);
	store.add(store.read("user"), [seed("preference", OLD)]); const before = store.read("user");
	const requests: { auxiliary: boolean; context: TranscriptContext; options?: SimpleStreamOptions }[] = [];
	const foreground = (context: TranscriptContext, options?: SimpleStreamOptions) => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return fauxAssistantMessage("foreground ok");
	};
	f.faux.setResponses(Array.from({ length: 9 }, () => foreground));
	for (let n = 1; n <= 9; n++) await promptSucceeded(f, n === 9 ? c.early : `Authority work ${n}.`);
	const early = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
	assert.equal(ledger.status().length, 0);
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([foreground, (context, options) => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return held;
	}]);
	try {
		await promptSucceeded(f, c.later);
		const latest = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
		await until(() => requests.some(r => r.auxiliary), "actual tenth-user automatic dispatch");
		const native = nativeState(f), selected = c.select === "early" ? early : latest;
		const auxiliary = requests.find(r => r.auxiliary)!;
		const instruction = auxiliary.context.messages.at(-1)!;
		assert.equal(instruction.role, "user");
		if (instruction.role === "user" && typeof instruction.content === "string") {
			const sources = JSON.parse(instruction.content).sources as { entry: string; text: string }[];
			assert.deepEqual(sources.slice(-2), [{ entry: early, text: c.early }, { entry: latest, text: c.later }]);
		}
		release(proposal({ candidates: [pref(selected, c.fact, "preference")] }));
		await until(() => ledger.status()[0]?.usageState === "reported", "authority result accounted once");
		const record = ledger.status()[0], after = store.read("user");
		assert.equal(record.status, c.status); assert.equal(record.trigger, "settled"); assert.equal(record.usageState, "reported");
		assert.equal(record.commits?.[0].status, c.status); assert.equal(ledger.status().length, 1); assert.equal(ledger.overview().daily.requests, 1);
		assert.equal(requests.filter(r => !r.auxiliary).length, 10); assert.equal(requests.filter(r => r.auxiliary).length, 1); assert.equal(f.faux.state.callCount, 11);
		assert.equal(auxiliary.options?.maxRetries, 0); assert.equal(auxiliary.options?.toolChoice, "none");
		assert.deepEqual(nativeState(f), native); assert.deepEqual(f.errors, []);
		if (c.status === "pending") {
			assert.equal(after.raw, before.raw, "later competing relation or unsupported enclosing context cannot grant automatic overwrite");
			assert.deepEqual(record.saved, []); assert.equal(store.pending("user").length, 1);
			assert.deepEqual(store.pending("user")[0].diff, [{ id: "preference", kind: "replacement", old: OLD, fact: c.fact }]);
		} else {
			assert.equal(after.entries[0].id, "preference"); assert.equal(after.entries[0].fact, c.fact); assert.notEqual(after.version, before.version);
			assert.equal(after.entries[0].created, before.entries[0].created);
			assert.deepEqual(after.entries[0].source, { session: f.sessionManager.getSessionId(), entry: selected, quote: c.fact });
			assert.deepEqual(record.saved, ["preference"]); noPending(store);
		}
		t.diagnostic(JSON.stringify({ finding: c.id, status: record.status, foreground: 10, auxiliary: 1, calls: 11, debit: 1, nativeUnchanged: true }));
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});


const compositionCases = [
	{ id: "English later denial", early: correction(), later: `Do not apply the following correction:\n${correction()}`, batch: false },
	{ id: "Chinese later denial", early: authorityCn(OLD, NEW), later: `不要执行以下更正：\n${authorityCn(OLD, NEW)}`, batch: false },
	{ id: "trailing denial", early: correction(), later: `${correction()}\nDo not apply the above.`, batch: false },
	{ id: "qualified comparison", early: correction(), later: `Compare these options:\n${correction()}`, batch: false },
	{ id: "later veto keeps addition and replacement whole-target pending", early: correction(), later: `Compare these options:\n${correction()}`, batch: true },
];
for (const c of compositionCases) test(`composition authority: ${c.id}`, async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir, f.cwd), ledger = new ReviewLedger(f.agentDir);
	store.add(store.read("user"), [seed("preference", OLD)]); const before = store.read("user");
	const requests: { auxiliary: boolean; context: TranscriptContext; options?: SimpleStreamOptions }[] = [];
	const capture = (context: TranscriptContext, options?: SimpleStreamOptions) => {
		requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return fauxAssistantMessage("foreground ok");
	};
	f.faux.setResponses(Array.from({ length: 9 }, () => capture));
	let additionSource = "";
	for (let n = 1; n <= 9; n++) {
		await promptSucceeded(f, n === 1 ? "I prefer bullet lists." : n === 9 ? c.early : `Composition work ${n}.`);
		if (n === 1) additionSource = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
	}
	const selected = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!.id;
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture, (context, options) => { requests.push({ auxiliary: isReview(context), context: structuredClone(context), options }); return held; }]);
	try {
		await promptSucceeded(f, c.later);
		await until(() => requests.some(r => r.auxiliary), "default tenth-user composition dispatch");
		const native = nativeState(f);
		release(proposal({ candidates: [pref(selected, NEW, "preference"), ...(c.batch ? [pref(additionSource, "I prefer bullet lists.")] : [])] }));
		await until(() => ledger.status()[0]?.usageState === "reported", "composition usage reported once");
		const record = ledger.status()[0], auxiliary = requests.find(r => r.auxiliary)!;
		assert.equal(record.trigger, "settled"); assert.equal(record.usageState, "reported"); assert.equal(ledger.status().length, 1);
		assert.equal(ledger.overview().daily.requests, 1); assert.equal(f.faux.state.callCount, 11);
		assert.equal(requests.filter(r => !r.auxiliary).length, 10); assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.equal(auxiliary.options?.maxRetries, 0); assert.equal(auxiliary.options?.toolChoice, "none");
		assert.deepEqual(nativeState(f), native); assert.deepEqual(f.errors, []);
		t.diagnostic(JSON.stringify({ case: c.id, status: record.status, foreground: 10, auxiliary: 1, calls: 11, debit: 1, nativeUnchanged: true }));
		assert.equal(record.status, "pending"); assert.equal(record.commits?.[0].status, "pending"); assert.deepEqual(record.saved, []);
		assert.equal(store.read("user").raw, before.raw, "later unsupported enclosing context vetoes older positive authority");
		assert.equal(store.pending("user").length, 1); assert.equal(store.pending("user")[0].base, before.version);
		assert.deepEqual(store.pending("user")[0].diff.map(change => change.kind), c.batch ? ["addition", "replacement"] : ["replacement"]);
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});

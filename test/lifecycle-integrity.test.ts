import assert from "node:assert/strict";
import fs, { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MemoryStore, memorySection, type MemoryEntry } from "../src/memory-store.ts";
import { createMemoryExtension } from "../src/index.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

function fixture(t: TestContext) {
	const root = mkdtempSync("/var/tmp/hermes-lifecycle-integrity-");
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new MemoryStore(root) };
}
const fact = (id: string, text: string): MemoryEntry => ({ id, fact: text, source: { kind: "user-authored" }, created: "unknown", updated: "unknown" });

test("lost initialized lifecycle history refuses stale revival and preserves the authoritative file", t => {
	const { root, store } = fixture(t), old = fact("old", "Forgotten fixture preference.");
	store.add(store.read("user"), [old]);
	store.forget(store.read("user"), [{ id: old.id, expectedFact: old.fact }]);
	const snapshot = store.read("user");
	unlinkSync(store.journalPath("user"));
	const reloaded = new MemoryStore(root);
	assert.throws(() => reloaded.read("user"), /journal|history/i);
	assert.throws(() => reloaded.add(snapshot, [old]), /journal|history/i);
	assert.equal(readFileSync(snapshot.path, "utf8"), snapshot.raw);
});

test("known journal record types require valid fields and references before any mutation", t => {
	for (const record of [
		{ v: 1, type: "tombstone" },
		{ v: 1, type: "intent", id: "bad", base: "invalid", after: "invalid", at: "x" },
		{ v: 1, type: "result", intent: "ghost", status: "saved", ids: [], at: new Date().toISOString() },
		{ v: 1, type: "pending", id: "bad", base: "0".repeat(64), batch: {}, reason: "fixture", summary: "fixture", at: new Date().toISOString() },
	]) {
		const { root } = fixture(t), folder = join(root, record.type); mkdirSync(folder);
		const store = new MemoryStore(folder); store.add(store.read("user"), [fact("one", "Original fact.")]);
		const before = store.read("user");
		appendFileSync(store.journalPath("user"), JSON.stringify(record) + "\n");
		assert.throws(() => store.read("user"), /journal|history|record|intent/i, record.type);
		assert.throws(() => store.add(before, [fact("two", "New fact.")]), /journal|history|record|intent/i);
		assert.equal(readFileSync(before.path, "utf8"), before.raw);
	}
});

test("journal scalar fields cannot be substituted with coercible arrays", t => {
	for (const kind of ["pending-status", "result"] as const) {
		const { store } = fixture(t), old = fact("old", "Original fact."); store.add(store.read("user"), [old]);
		const before = store.read("user"), at = new Date().toISOString();
		if (kind === "pending-status") {
			const pending = store.stage(before, { removals: [{ id: old.id, expectedFact: old.fact }] }, "fixture deletion");
			appendFileSync(store.journalPath("user"), JSON.stringify({ v: 1, type: kind, id: pending.id, status: ["denied"], at }) + "\n");
		} else {
			appendFileSync(store.journalPath("user"), JSON.stringify({ v: 1, type: "intent", id: "array-target", base: before.version, after: "0".repeat(64), outcome: "saved", ids: ["new"], tombstones: [], at }) + "\n");
			appendFileSync(store.journalPath("user"), JSON.stringify({ v: 1, type: kind, intent: ["array-target"], status: "conflict", ids: [], at }) + "\n");
		}
		assert.throws(() => store.read("user"), /Damaged.*journal/, kind);
		assert.equal(readFileSync(before.path, "utf8"), before.raw);
	}
});

test("rollback verifies addressed backup bytes and never applies tampered valid Markdown", t => {
	const { store } = fixture(t);
	store.add(store.read("user"), [fact("one", "First fact.")]);
	const first = store.read("user"); store.add(first, [fact("two", "Second fact.")]);
	const before = store.read("user");
	writeFileSync(`${first.path}.backups/${first.version}.md`, "Tampered but valid Markdown.\n");
	const result = store.rollback("user");
	assert.equal(result.status, "conflict");
	assert.match(result.reason!, /backup.*(?:hash|integrity)/i);
	assert.equal(store.read("user").raw, before.raw);
	assert.equal(result.version, store.read("user").version);
});

test("journal and backup symlinks cannot redirect lifecycle writes outside target scope", t => {
	const { root } = fixture(t), agent = join(root, "agent"), outside = join(root, "outside"); mkdirSync(agent); mkdirSync(outside);
	const store = new MemoryStore(agent), path = store.path("user"); mkdirSync(join(agent, "hermes-memory"));
	const external = join(outside, "journal"); writeFileSync(external, "Outside bytes.\n");
	const journalPath = store.journalPath("user");
	symlinkSync(external, journalPath);
	assert.throws(() => store.read("user"), /symlink/i);
	assert.equal(readFileSync(external, "utf8"), "Outside bytes.\n");
	unlinkSync(journalPath);
	symlinkSync(outside, `${path}.backups`);
	assert.throws(() => store.add(store.read("user"), [fact("one", "First fact.")]), /symlink/i);
	assert.equal(fs.readdirSync(outside).length, 1);
});

test("an interrupted applied forget recovers tombstones and proposal receipt without rewriting content", t => {
	const { root, store } = fixture(t), old = fact("old", "Forgotten fixture preference.");
	store.add(store.read("user"), [old]);
	const write = fs.writeFileSync;
	let failed = false;
	fs.writeFileSync = ((path, data, ...options) => {
		if (!failed && typeof data === "string" && data.includes('"type":"result"')) {
			failed = true; throw Object.assign(new Error("fixture result append failure"), { code: "EIO" });
		}
		return write(path, data, ...options);
	}) as typeof fs.writeFileSync;
	syncBuiltinESMExports();
	try {
		const outcome = store.mutate(store.read("user"), { removals: [{ id: old.id, expectedFact: old.fact }], proposal: "forget-proposal" });
		assert.equal(outcome.status, "saved", "applied content must not be mislabeled rejected when only the result write fails");
		assert.equal(outcome.reason, "audit-recovery-required");
	}
	finally { fs.writeFileSync = write; syncBuiltinESMExports(); }
	assert.equal(failed, true);
	const reloaded = new MemoryStore(root), after = reloaded.read("user");
	assert.equal(after.entries.length, 0);
	assert.ok(after.tombstones.some(stone => stone.id === old.id));
	const replay = reloaded.mutate(after, { additions: [old], proposal: "forget-proposal" });
	assert.equal(replay.reason, "replayed-commit");
	assert.equal(reloaded.read("user").raw, after.raw);
	reloaded.add(reloaded.read("user"), [fact("alias", old.fact)]);
	assert.doesNotMatch(memorySection(reloaded.readAll()).text, /Forgotten fixture preference/);
});

test("approved rollback undoes corresponding forgetting without reopening an old snapshot", t => {
	const { store } = fixture(t), old = fact("old", "Forgotten fixture preference.");
	store.add(store.read("user"), [old]);
	const before = store.read("user");
	store.forget(before, [{ id: old.id, expectedFact: old.fact }]);
	assert.equal(store.rollback("user").status, "saved");
	const restored = store.read("user");
	assert.equal(restored.version, before.version, "the exact old bytes are restored");
	assert.match(memorySection(store.readAll()).text, /Forgotten fixture preference/);
	assert.equal(store.add(before, [fact("late", "Unapproved late fixture fact.")]).status, "conflict", "identical Markdown must not reopen the old lifecycle snapshot");
	assert.equal(store.read("user").raw, restored.raw);
});

test("rollback only reverses its selected forgetting effects and undoing restore forgets again", t => {
	const { store } = fixture(t), first = fact("first", "First forgotten fact."), second = fact("second", "Second forgotten fact.");
	store.add(store.read("user"), [first, second]);
	store.forget(store.read("user"), [{ id: first.id, expectedFact: first.fact }]);
	store.forget(store.read("user"), [{ id: second.id, expectedFact: second.fact }]);
	assert.equal(store.rollback("user").status, "saved");
	const section = memorySection(store.readAll()).text;
	assert.doesNotMatch(section, /First forgotten fact/); assert.match(section, /Second forgotten fact/);
	assert.equal(store.rollback("user").status, "saved");
	assert.doesNotMatch(memorySection(store.readAll()).text, /Second forgotten fact/);
});

test("old pending approval stays stale after an explicit rollback restores identical bytes", t => {
	const { store } = fixture(t), old = fact("old", "Original fact."); store.add(store.read("user"), [old]);
	const before = store.read("user"), batch = { removals: [{ id: old.id, expectedFact: old.fact }] };
	const pending = store.stage(before, batch, "fixture deletion");
	store.forget(store.read("user"), batch.removals); store.rollback("user");
	assert.equal(store.read("user").version, before.version);
	assert.equal(store.pending("user").find(proposal => proposal.id === pending.id)!.stale, true);
	assert.equal(store.approve("user", pending.id, pending.stamp).status, "conflict");
	const fresh = store.stage(store.read("user"), batch, "fixture deletion");
	assert.notEqual(fresh.id, pending.id, "a new explicit proposal has a new lifecycle basis");
	assert.equal(store.approve("user", fresh.id, fresh.stamp).status, "saved");
});

for (const suffix of ["", "\nNew user-authored note.\n"]) test(`unresolved forgetting quarantines ${suffix ? "changed" : "exact-base"} stale saves without reopening snapshots`, async t => {
	let context: ExtensionContext | undefined, unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; }); createMemoryExtension()(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir), old = fact("old", "Forgotten fixture preference.");
	store.add(store.read("user"), [old]); store.add(store.read("global"), [fact("global", "Independent global fixture fact.")]);
	const before = store.read("user"), write = fs.writeFileSync;
	const pending = store.stage(before, { removals: [{ id: old.id, expectedFact: old.fact }] }, "older pending deletion");
	let failed = false;
	fs.writeFileSync = ((path, data, ...options) => {
		if (!failed && typeof data === "string" && data.includes('"type":"result"')) { failed = true; throw new Error("fixture result failure"); }
		return write(path, data, ...options);
	}) as typeof fs.writeFileSync;
	syncBuiltinESMExports();
	try { assert.equal(store.forget(before, [{ id: old.id, expectedFact: old.fact }]).reason, "audit-recovery-required"); }
	finally { fs.writeFileSync = write; syncBuiltinESMExports(); }
	const edited = before.raw + suffix; writeFileSync(before.path, edited);
	const uncertain = new MemoryStore(f.agentDir).read("user");
	assert.match(uncertain.diagnostics.join(" "), /ambiguous|uncertain/);
	assert.throws(() => store.add(uncertain, [fact("new", "New fact.")]), /Ambiguous/);
	assert.throws(() => store.add(before, [fact("late", "Unapproved late fact.")]), /Ambiguous/);
	assert.equal(store.pending("user").find(proposal => proposal.id === pending.id)!.stale, true);
	assert.throws(() => store.approve("user", pending.id, pending.stamp), /Ambiguous/);
	const statuses: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, setStatus: (key, value) => { if (key === "hermes-memory") statuses.push(value ?? ""); } } });
	let prompt = "";
	f.faux.setResponses([modelContext => { prompt = getCurrentSystemPrompt(modelContext.messages); return fauxAssistantMessage("Fixture acknowledgement."); }]);
	await f.session.prompt("A normal fixture request.");
	assert.doesNotMatch(prompt, /Forgotten fixture preference/);
	assert.match(prompt, /Independent global fixture fact/);
	assert.match(statuses.at(-1)!, /uncertain|unavailable/i);
	assert.equal(readFileSync(before.path, "utf8"), edited);
	await f.session.prompt("/hermes-review run");
	assert.equal(f.faux.state.callCount, 1, "uncertain storage must not dispatch a paid review");
	assert.match(new ReviewLedger(f.agentDir).status().at(-1)!.reason!, /storage-lifecycle-uncertain/);
});

test("pending deletion approval discloses retained history in confirmation and successful result", async t => {
	let context: ExtensionContext | undefined, unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; }); createMemoryExtension()(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir), old = fact("old", "Deleted fixture fact."); store.add(store.read("user"), [old]);
	const before = store.read("user"), proposal = store.stage(before, { removals: [{ id: old.id, expectedFact: old.fact }] }, "fixture deletion");
	const previews: string[] = [], notices: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { notices.push(message); }, confirm: async (_title, body) => { previews.push(body); return true; } } });
	await f.session.prompt(`/hermes-memory approve user ${proposal.id}`);
	const result = JSON.parse(notices.at(-1)!);
	assert.equal(result.status, "saved");
	for (const value of [previews.at(-1)!, result.retention]) assert.match(value, /backups.*raw Pi sessions.*retain/);
	assert.equal(store.read("user").entries.length, 0);
	assert.match(readFileSync(`${before.path}.backups/${before.version}.md`, "utf8"), /Deleted fixture fact/);
	assert.doesNotMatch(memorySection(store.readAll()).text, /Deleted fixture fact/);
	assert.equal(f.faux.state.callCount, 0);
});

test("initialized valid-prefix truncation cannot erase forgetting history", t => {
	const { store } = fixture(t), old = fact("old", "Forgotten fixture preference.");
	store.add(store.read("user"), [old]); store.forget(store.read("user"), [{ id: old.id, expectedFact: old.fact }]);
	const snapshot = store.read("user"), path = store.journalPath("user");
	writeFileSync(path, readFileSync(path, "utf8").split("\n")[0] + "\n");
	assert.throws(() => store.read("user"), /truncated.*history/i);
	assert.throws(() => store.add(snapshot, [old]), /truncated.*history/i);
	assert.equal(readFileSync(snapshot.path, "utf8"), snapshot.raw);
});

test("pending approval requires the previewed record and keeps failed validation pending", t => {
	const { store } = fixture(t), old = fact("old", "Original fact."); store.add(store.read("user"), [old]);
	const snapshot = store.read("user"), proposal = store.stage(snapshot, { replacements: [{ id: old.id, expectedFact: old.fact, entry: fact(old.id, "Corrected fact.") }] }, "fixture correction");
	assert.throws(() => store.approve("user", proposal.id, "wrong-preview"), /confirmation-changed/);
	assert.equal(store.read("user").raw, snapshot.raw);
	const small = new MemoryStore(store.agentDir, undefined, { user: 10 });
	assert.throws(() => small.approve("user", proposal.id, proposal.stamp), /Capacity/);
	assert.equal(store.pending("user").length, 1, "failed validation must not consume approval or lose the pending proposal");
	assert.equal(store.approve("user", proposal.id, proposal.stamp).status, "saved");
	assert.equal(store.read("user").entries[0].id, old.id);
	assert.equal(store.read("user").entries[0].fact, "Corrected fact.");
});

test("staging a background batch never silently rebases an old snapshot", t => {
	const { store } = fixture(t), old = fact("old", "Original fact."); store.add(store.read("user"), [old]);
	const before = store.read("user"); store.add(before, [fact("new", "Newer fact.")]);
	const after = store.read("user");
	assert.throws(() => store.stage(before, { removals: [{ id: old.id, expectedFact: old.fact }] }, "late review"), /base-version-mismatch/);
	assert.equal(store.read("user").raw, after.raw);
	assert.deepEqual(store.pending("user"), []);
});

test("rollback to the initial empty version is verified and reported truthfully", t => {
	const { store } = fixture(t), empty = store.read("user"); store.add(empty, [fact("one", "First fact.")]);
	const result = store.rollback("user"); assert.equal(result.status, "saved");
	assert.equal(store.read("user").raw, ""); assert.equal(result.version, empty.version);
});

test("public confirmation cannot undo a newer commit or mutate after the session leaf changes", async t => {
	let context: ExtensionContext | undefined, unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { context = ctx; }); createMemoryExtension()(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir), messages: string[] = [];
	store.add(store.read("user"), [fact("one", "First fact.")]);
	store.add(store.read("user"), [fact("two", "Second fact.")]);
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { messages.push(message); }, confirm: async () => {
		store.add(store.read("user"), [fact("three", "Newer fact.")]); return true;
	} } });
	await f.session.prompt("/hermes-memory rollback user");
	assert.equal(JSON.parse(messages.at(-1)!).status, "conflict");
	assert.ok(store.read("user").entries.some(entry => entry.id === "three"));
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...context!.ui, notify: message => { messages.push(message); }, confirm: async () => {
		f.sessionManager.appendMessage({ role: "user", content: "A different fixture task.", timestamp: Date.now() }); return true;
	} } });
	await f.session.prompt("/hermes-memory forget user one");
	assert.equal(JSON.parse(messages.at(-1)!).status, "confirmation-invalidated");
	assert.ok(store.read("user").entries.some(entry => entry.id === "one"));
	assert.equal(f.faux.state.callCount, 0, "memory confirmation itself never starts a provider request");
});

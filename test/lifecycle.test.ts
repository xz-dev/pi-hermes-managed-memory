import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { memorySection, MemoryStore, type MemoryEntry } from "../src/memory-store.ts";
import { appendLine, hash } from "../src/local-state.ts";
import { sdkFixture } from "./sdk-fixture.ts";

function fixture(t: TestContext) {
	const root = mkdtempSync("/var/tmp/hermes-lifecycle-"); t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new MemoryStore(root) };
}
function fact(id: string, text: string): MemoryEntry {
	return { id, fact: text, source: { kind: "user-authored" }, created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z" };
}
function journal(store: MemoryStore, target: "user" | "global" | "project" = "user") {
	return readFileSync(store.journalPath(target), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
}

test("durable intent precedes the file commit and result follows it; proposal dedupes on replay", t => {
	const { store } = fixture(t);
	const result = store.mutate(store.read("user"), { additions: [fact("one", "First fact.")], proposal: "proposal-1" });
	assert.equal(result.status, "saved");
	const records = journal(store);
	assert.deepEqual(records.map(record => record.type), ["init", "intent", "result"]);
	assert.equal(records[1].proposal, "proposal-1");
	assert.equal(records[2].intent, records[1].id);
	const bytes = readFileSync(store.path("user"), "utf8");
	const replay = store.mutate(store.read("user"), { additions: [fact("two", "Ignored.")], proposal: "proposal-1" });
	assert.equal(replay.status, "saved");
	assert.deepEqual(replay.ids, result.ids);
	assert.equal(replay.reason, "replayed-commit");
	assert.equal(readFileSync(store.path("user"), "utf8"), bytes, "replay must not rewrite");
	assert.equal(journal(store).length, 3, "replay does not duplicate audit records");
});
test("a committed change restores the versioned backup; manual edits block rollback", t => {
	const { store } = fixture(t), first = fact("one", "First fact.");
	store.add(store.read("user"), [first]);
	const beforeSecond = store.read("user");
	store.add(beforeSecond, [fact("two", "Second fact.")]);
	assert.equal(store.read("user").entries.length, 2);
	const rollback = store.rollback("user");
	assert.equal(rollback.status, "saved");
	const reverted = store.read("user");
	assert.deepEqual(reverted.entries.map(entry => entry.id), ["one"]);
	assert.equal(reverted.version, beforeSecond.version);
	writeFileSync(store.path("user"), reverted.raw + "\nManual note.\n");
	const refused = store.rollback("user");
	assert.equal(refused.status, "conflict");
	assert.match(refused.reason!, /after-hash-mismatch/);
	assert.match(readFileSync(store.path("user"), "utf8"), /Manual note\./, "manual edit is never overwritten");
});
test("forget removes injection eligibility and tombstones block revival after reload", t => {
	const { root } = fixture(t);
	let store = new MemoryStore(root), old = fact("old", "I prefer tea.");
	store.add(store.read("user"), [old]);
	const removed = store.forget(store.read("user"), [{ id: "old", expectedFact: old.fact }]);
	assert.equal(removed.status, "saved");
	assert.equal(store.read("user").entries.length, 0);
	assert.doesNotMatch(memorySection(store.readAll()).text, /I prefer tea/);
	// Late proposals cannot revive the forgotten id or identical fact; fresh facts still save.
	store = new MemoryStore(root);
	const revival = store.mutate(store.read("user"), { additions: [fact("old", "I prefer tea."), fact("new", "I use Linux.")] });
	assert.equal(revival.status, "saved");
	assert.deepEqual(revival.forgotten, ["old"]);
	const after = store.read("user");
	assert.deepEqual(after.entries.map(entry => entry.id), ["new"]);
	assert.match(memorySection([after]).text, /I use Linux/);
	assert.deepEqual(after.tombstones.map(stone => stone.id), ["old"]);
	// Tombstones survive rollback too: forgetting is not silently undone.
	store.rollback("user");
	const again = store.mutate(store.read("user"), { additions: [fact("other-id", "I prefer tea.")] });
	assert.deepEqual(again.forgotten, ["other-id"]);
	assert.ok(store.read("user").tombstones.some(stone => stone.factHash === hash("I prefer tea.")));
});
test("interrupted intent is diagnosed, not mistaken for empty history or applied silently", t => {
	const { store } = fixture(t);
	store.add(store.read("user"), [fact("one", "First fact.")]);
	const before = store.read("user");
	// Simulate crash after intent, before file write: intent after-hash mismatches live.
	appendLine(store.journalPath("user"), JSON.stringify({ v: 1, type: "intent", id: "crash-1", base: before.version, after: "0".repeat(64), outcome: "saved", ids: ["one"], tombstones: [], at: new Date().toISOString() }) + "\n");
	let snapshot = store.read("user");
	// The fixture knows no write occurred, but base bytes alone cannot prove that to recovery.
	assert.match(snapshot.diagnostics.join(" "), /interrupted commit crash-1 ambiguous/);
	assert.equal(snapshot.blocked, true);
	assert.equal(snapshot.entries.length, 1, "content preserved");
	// Intent whose after-hash equals live bytes reports verified-applied.
	appendLine(store.journalPath("user"), JSON.stringify({ v: 1, type: "intent", id: "crash-2", base: hash("unavailable fixture base"), after: store.read("user").version, outcome: "saved", ids: ["one"], tombstones: [], at: new Date().toISOString() }) + "\n");
	snapshot = store.read("user");
	assert.match(snapshot.diagnostics.join(" "), /crash-2 verified applied/);
});
test("corrupt or unknown journal records fail closed and never overwrite the file", t => {
	const { store } = fixture(t);
	store.add(store.read("user"), [fact("one", "First fact.")]);
	const before = store.read("user");
	appendFileSync(store.journalPath("user"), "{broken json\n");
	assert.throws(() => store.read("user"), /JSON|Damaged/);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	appendFileSync(store.journalPath("user"), JSON.stringify({ v: 1, type: "mystery" }) + "\n");
	assert.throws(() => store.add(before, [fact("two", "Second.")]), /Damaged|Unknown|JSON/);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	const { store: other } = fixture(t);
	other.add(other.read("user"), [fact("one", "First fact.")]);
	appendFileSync(other.journalPath("user"), JSON.stringify({ v: 1, type: "pending-status", id: "ghost", status: "denied", at: new Date().toISOString() }) + "\n");
	assert.throws(() => other.read("user"), /without proposal/);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
});
test("pending approve binds the unchanged proposal and base; deny and drift refuse mutation", t => {
	const { store } = fixture(t), old = fact("old", "Original preference.");
	store.add(store.read("user"), [old]);
	const pending = store.stage("user", { removals: [{ id: "old", expectedFact: old.fact }] }, "review-proposal");
	assert.deepEqual(store.pending("user").map(proposal => proposal.id), [pending.id]);
	assert.equal(store.read("user").entries.length, 1, "staging never mutates");
	const denied = store.stage("user", { removals: [{ id: "old", expectedFact: old.fact }] }, "different-reason");
	store.deny("user", denied.id);
	assert.throws(() => store.approve("user", denied.id), /already denied/);
	assert.equal(store.read("user").entries.length, 1);
	const applied = store.approve("user", pending.id);
	assert.equal(applied.status, "saved");
	assert.equal(store.read("user").entries.length, 0);
	assert.throws(() => store.approve("user", pending.id), /already approved/);
	// Base drift: stage on one version, edit file, approve must refuse.
	store.add(store.read("user"), [fact("two", "Second fact.")]);
	const stale = store.stage("user", { removals: [{ id: "two", expectedFact: "Second fact." }] }, "review-proposal");
	writeFileSync(store.path("user"), store.read("user").raw + "\nManual line.\n");
	const refused = store.approve("user", stale.id);
	assert.equal(refused.status, "conflict");
	assert.equal(refused.reason, "pending-base-stale");
	assert.match(readFileSync(store.path("user"), "utf8"), /Manual line\./);
	assert.equal(store.pending("user").length, 0, "stale pending resolved, not lingering");
});
test("per-target outcomes stay separate: one saved, one pending, one rejected by capacity", async t => {
	let ctx: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension({ caps: { global: 120 }, projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	const padded = "This environment uses Linux and more padding to overflow a small capacity cap. Additional environment padding keeps the file far beyond one hundred and twenty scalars.";
	await f.session.prompt(`I prefer concise answers. ${padded}`);
	const entry = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
	const store = new MemoryStore(f.agentDir, join(f.agentDir, "project"));
	store.add(store.read("project"), [fact("existing", "Existing project fact.")]);
	f.faux.setResponses([fauxAssistantMessage(JSON.stringify({
		candidates: [
			{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry: entry.id },
			{ kind: "environment", fact: padded, quote: padded, entry: entry.id },
		],
		removals: [{ target: "project", id: "existing" }],
	}))]);
	await f.session.prompt("/hermes-review run");
	const { ReviewLedger } = await import("../src/review-ledger.ts");
	const record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "conflict", "mixed target outcomes are not a fake global success");
	const byTarget = Object.fromEntries((record.commits ?? []).map(commit => [commit.target, commit.status]));
	assert.equal(byTarget.user, "saved");
	assert.equal(byTarget.project, "pending");
	assert.equal(byTarget.global, "rejected");
	assert.deepEqual(record.saved, store.read("user").entries.map(entry => entry.id), "pending proposal IDs are not saved fact IDs");
	assert.equal(store.read("user").entries[0].fact, "I prefer concise answers.");
	assert.equal(store.read("project").entries[0].fact, "Existing project fact.", "staged removal leaves bytes intact");
	assert.equal(store.read("global").raw, "");
	assert.equal(store.pending("project").length, 1);
	assert.equal(f.faux.state.callCount, 2, "no replay of the whole request");
});

test("public command surface: headless confirm cannot mutate; confirmed forget + rollback report retention boundary", async t => {
	let ctx: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension()(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const store = new MemoryStore(f.agentDir);
	store.add(store.read("user"), [fact("keep", "Keep me."), fact("drop", "Drop me.")]);
	// Headless/json mode: no confirm UI -> confirmation-required, no mutation.
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await f.session.prompt("/hermes-memory forget user drop"); } finally { process.stdout.write = write; }
	const lines = output.join("").trim().split("\n").map(line => { try { return JSON.parse(line) as { type?: string; detail?: { status?: string } }; } catch { return undefined; } });
	const required = lines.filter(line => line?.type === "hermes-memory").at(-1)!;
	assert.equal(required?.detail?.status, "confirmation-required");
	assert.equal(store.read("user").entries.length, 2);
	assert.ok(ctx);
	// Declined confirm -> no mutation.
	const messages: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...ctx!.ui,
		notify: message => { messages.push(message); }, confirm: async () => false } });
	await f.session.prompt("/hermes-memory forget user drop");
	assert.equal(JSON.parse(messages.at(-1)!).status, "declined");
	assert.equal(store.read("user").entries.length, 2);
	const beforeForget = store.read("user");
	const previews: string[] = [];
	// Confirmed forget commits and reports the retention boundary.
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...ctx!.ui,
		notify: message => { messages.push(message); }, confirm: async (_title, body) => { previews.push(body); return true; } } });
	await f.session.prompt("/hermes-memory forget user drop");
	const forgotten = JSON.parse(messages.at(-1)!);
	assert.equal(forgotten.status, "saved");
	assert.match(forgotten.retention, /backups.*raw Pi sessions.*retain/);
	assert.equal(store.read("user").entries.length, 1);
	// Confirmed rollback reports the same boundary and restores bytes.
	await f.session.prompt("/hermes-memory rollback user");
	const rolled = JSON.parse(messages.at(-1)!);
	assert.equal(rolled.status, "saved");
	assert.match(rolled.retention, /retention/);
	assert.equal(store.read("user").entries.length, 2);
	assert.ok(JSON.parse(previews.at(-1)!).diff.some((change: { id: string; kind: string }) => change.id === "drop" && change.kind === "addition"), "rollback confirmation shows the fact being restored");
	assert.match(memorySection(store.readAll()).text, /Drop me/);
	assert.equal(store.add(beforeForget, [fact("late", "Unapproved late fact.")]).status, "conflict", "explicit restoration never reauthorizes an old snapshot");
	const again = store.mutate(store.read("user"), { additions: [fact("again", "Drop me.")] });
	assert.equal(again.status, "no-change", "already-restored facts still deduplicate");
});

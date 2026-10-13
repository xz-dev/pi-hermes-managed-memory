import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { MemoryStore, type MemoryEntry } from "../src/memory-store.ts";

function fixture(t: TestContext, cap = 2200) {
	const root = mkdtempSync("/var/tmp/hermes-mutations-"); t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new MemoryStore(root, undefined, { global: cap }) };
}
function fact(id: string, text: string): MemoryEntry {
	return { id, fact: text, source: { kind: "user-authored" }, created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z" };
}
test("same-target replacement and addition commit only their final fitting size", t => {
	const { store } = fixture(t, 700), old = fact("old", "x".repeat(400)), added = fact("new", "y".repeat(250));
	store.add(store.read("global"), [old]);
	const before = store.read("global");
	assert.throws(() => store.add(before, [added]), /Capacity exceeded/);
	const replacement = { ...fact("old", "A shorter fact."), created: "unknown", updated: "2026-10-02T00:00:00.000Z" };
	const result = store.mutate(before, { additions: [added], replacements: [{ id: old.id, expectedFact: old.fact, entry: replacement }] });
	assert.equal(result.status, "saved");
	const after = store.read("global");
	assert.deepEqual(after.entries.map(entry => entry.fact), [replacement.fact, added.fact]);
	assert.equal(after.entries[0].created, old.created, "replacement preserves identity creation time");
	assert.equal(after.entries[0].updated, replacement.updated);
	assert.ok(Array.from(after.raw).length <= 700);
	assert.equal(readFileSync(`${after.path}.backups/${before.version}.md`, "utf8"), before.raw);
});
test("oversize or invalid same-target batches cannot partially replace or add", t => {
	const { store } = fixture(t, 700), old = fact("old", "Original authoritative fact.");
	store.add(store.read("global"), [old]); const before = store.read("global");
	assert.throws(() => store.mutate(before, { replacements: [{ id: old.id, expectedFact: old.fact, entry: fact("old", "Changed.") }], additions: [fact("huge", "z".repeat(800))] }), /Capacity exceeded/);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	assert.throws(() => store.mutate(before, { replacements: [{ id: old.id, expectedFact: old.fact, entry: fact("old", "Changed.") }], additions: [{ ...fact("invalid", "Another fact."), source: { session: "s", entry: "e", quote: "unrelated" } }] }), /provenance/);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
});
test("external edits and wrong expected old values reject the whole batch", t => {
	const { store } = fixture(t), old = fact("old", "Original."); store.add(store.read("global"), [old]);
	const before = store.read("global"), replacement = fact("old", "Changed.");
	assert.equal(store.mutate(before, { replacements: [{ id: "old", expectedFact: "Wrong old fact.", entry: replacement }], additions: [fact("new", "New.")] }).status, "conflict");
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	const edited = before.raw + "\nA manual note.\n"; writeFileSync(before.path, edited);
	assert.equal(store.mutate(before, { replacements: [{ id: "old", expectedFact: old.fact, entry: replacement }] }).status, "conflict");
	assert.equal(readFileSync(before.path, "utf8"), edited);
});
test("duplicate additions/no-op updates retain bytes while reused identities conflict", t => {
	const { store } = fixture(t), old = fact("old", "Original."); store.add(store.read("global"), [old]);
	const before = store.read("global");
	assert.equal(store.mutate(before, { additions: [old, fact("alias", old.fact)], replacements: [{ id: "old", expectedFact: old.fact, entry: old }] }).status, "no-change");
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	assert.equal(store.mutate(before, { additions: [fact("old", "Different.")] }).status, "conflict");
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
});
test("reordered entry and source keys are a semantic no-op but changed facts still save", t => {
	const { store } = fixture(t), old = { ...fact("one", "A stable fact."), source: { session: "s", entry: "e", quote: "A stable fact." } };
	store.add(store.read("global"), [old]); const before = store.read("global");
	const reordered: MemoryEntry = { updated: old.updated, source: { quote: old.source.quote, entry: old.source.entry, session: old.source.session },
		fact: old.fact, created: "unknown", id: old.id };
	const result = store.mutate(before, { replacements: [{ id: old.id, expectedFact: old.fact, entry: reordered }] });
	assert.equal(result.status, "no-change"); assert.deepEqual(result.ids, []); assert.equal(result.version, before.version);
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
	const corrected = { ...reordered, fact: "A corrected fact.", source: { ...reordered.source, quote: "A corrected fact." }, updated: "2026-10-02T00:00:00.000Z" };
	assert.equal(store.mutate(before, { replacements: [{ id: old.id, expectedFact: old.fact, entry: corrected }] }).status, "saved");
	assert.equal(store.read("global").entries[0].fact, corrected.fact);
});
test("incompatible replacements reject together rather than pick an arbitrary last value", t => {
	const { store } = fixture(t), old = fact("old", "Original."); store.add(store.read("global"), [old]);
	const before = store.read("global");
	assert.equal(store.mutate(before, { replacements: [
		{ id: "old", expectedFact: old.fact, entry: fact("old", "First.") },
		{ id: "old", expectedFact: old.fact, entry: fact("old", "Second.") },
	] }).status, "conflict");
	assert.equal(readFileSync(before.path, "utf8"), before.raw);
});
test("independent processes cannot both commit different facts from one base version", async t => {
	const { root, store } = fixture(t), before = store.read("global");
	const module = new URL("../src/memory-store.ts", import.meta.url).href, run = promisify(execFile);
	const results = await Promise.all(["one", "two"].map(id => run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
		import {MemoryStore} from ${JSON.stringify(module)};
		try { console.log(JSON.stringify(new MemoryStore(${JSON.stringify(root)}).mutate(${JSON.stringify(before)}, {additions:[${JSON.stringify(fact(id, id))}]}))); }
		catch(error) { console.log(JSON.stringify({status:'locked',message:error.message})); }
	`], { cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: root } })));
	const statuses = results.map(result => JSON.parse(result.stdout).status);
	assert.equal(statuses.filter(status => status === "saved").length, 1);
	assert.ok(statuses.every(status => ["saved", "conflict", "locked"].includes(status)));
	assert.equal(store.read("global").entries.length, 1);
});

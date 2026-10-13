import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MemoryStore, memorySection, type MemoryEntry } from "../src/memory-store.ts";
import { createMemoryExtension } from "../src/index.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { sdkFixture } from "./sdk-fixture.ts";

function fixture(t: TestContext) {
	const dir = mkdtempSync("/var/tmp/hermes-provenance-"); t.after(() => rmSync(dir, { recursive: true, force: true }));
	const store = new MemoryStore(dir); mkdirSync(join(dir, "hermes-memory"));
	return store;
}
const entry: MemoryEntry = { id: "stable-id", fact: "I prefer concise answers.", source: { session: "source-session", entry: "source-entry", quote: "I prefer concise answers." },
	created: "2026-10-01T12:00:00.000Z", updated: "2026-10-01T12:00:00.000Z" };
function raw(value: unknown, fact = entry.fact) { return `<!-- hermes-entry ${JSON.stringify(value)} -->\n- ${fact}\n`; }
function metadata() { const { fact: _fact, ...value } = entry; return value; }

test("managed identity, schema, source and raw version survive repeated reading", t => {
	const store = fixture(t); store.add(store.read("user"), [entry]);
	assert.match(readFileSync(store.path("user"), "utf8"), /"schema":1/);
	const first = store.read("user"), next = store.read("user");
	assert.deepEqual(first.entries, [entry]); assert.deepEqual(next.entries, first.entries);
	assert.equal(first.version, next.version); assert.deepEqual(first.diagnostics, []);
	writeFileSync(store.path("global"), raw(metadata()));
	assert.deepEqual(store.read("global").entries, [entry], "unversioned existing entries remain readable");
});
test("plain user-authored headings and multiline notes retain content without fictional provenance", t => {
	const store = fixture(t), text = "# User notes\nI use Linux.\nKeep this complete note.\n\nI like concise explanations.\n";
	writeFileSync(store.path("user"), text);
	const result = store.read("user");
	assert.equal(result.entries[0].fact, "# User notes\nI use Linux.\nKeep this complete note.");
	assert.equal(result.entries[1].fact, "I like concise explanations.");
	for (const item of result.entries) { assert.deepEqual(item.source, { kind: "user-authored" }); assert.equal(item.created, "unknown"); assert.equal(item.updated, "unknown"); }
	assert.deepEqual(store.read("user").entries.map(item => item.id), result.entries.map(item => item.id));
	assert.equal(readFileSync(store.path("user"), "utf8"), text, "inspection does not canonicalize or overwrite a user file");
});
test("mixed managed/plain identities cannot discard notes during unrelated addition", t => {
	const store = fixture(t), original = "Original user note.", path = store.path("user");
	writeFileSync(path, original);
	const imported = store.read("user"), id = imported.entries[0].id;
	const managed = raw({ schema: 1, id, source: { kind: "user-authored" }, created: "unknown", updated: "unknown" }, "Edited user note.");
	for (const content of [`${managed}\n${original}\n`, `${original}\n\n${managed}`]) {
		writeFileSync(path, content);
		assert.throws(() => store.read("user"), /Duplicate memory identity/);
		assert.throws(() => store.add(imported, [entry]), /Duplicate memory identity/);
		assert.equal(readFileSync(path, "utf8"), content, "neither colliding note may be lost");
	}
	writeFileSync(store.path("global"), `${original}\n\n${original}\n`);
	assert.equal(store.read("global").entries.length, 1, "identical plain blocks still deduplicate");
});
test("ordinary prose mentioning hermes-entry is plain content, not a metadata marker", t => {
	const store = fixture(t), content = "# Format notes\nThe hermes-entry field is documented here.\n";
	writeFileSync(store.path("user"), content);
	const snapshot = store.read("user");
	assert.equal(snapshot.entries[0].fact, content.trimEnd());
	assert.deepEqual(snapshot.entries[0].source, { kind: "user-authored" });
	assert.equal(snapshot.entries[0].updated, "unknown");
	assert.equal(store.add(snapshot, [entry]).status, "saved");
	assert.ok(store.read("user").entries.some(item => item.fact === content.trimEnd()));
});
test("editing a managed body keeps identity but cannot reuse the old citation or pretend a new timestamp", t => {
	const store = fixture(t); store.add(store.read("user"), [entry]);
	const before = store.read("user"), edited = before.raw.replace(`- ${entry.fact}`, "- I prefer detailed answers.");
	writeFileSync(store.path("user"), edited);
	const after = store.read("user");
	assert.equal(after.entries[0].id, entry.id); assert.equal(after.entries[0].fact, "I prefer detailed answers.");
	assert.deepEqual(after.entries[0].source, { kind: "user-authored" }); assert.equal(after.entries[0].updated, "unknown");
	assert.notEqual(after.version, before.version); assert.match(after.diagnostics[0], /original citation not applied/);
	assert.doesNotMatch(memorySection([after]).text, /source-session\/source-entry/);
	assert.equal(readFileSync(store.path("user"), "utf8"), edited);
});
test("explicit unknown source is not labeled user-authored or given a session citation", t => {
	const store = fixture(t); store.add(store.read("user"), [{ ...entry, source: { kind: "unknown" }, created: "unknown", updated: "unknown" }]);
	assert.match(memorySection(store.readAll()).text, /source="unknown"/);
	assert.doesNotMatch(memorySection(store.readAll()).text, /source-session|source="user-authored"/);
});
for (const [name, value] of [
	["missing source", { id: "broken", created: "unknown", updated: "unknown" }],
	["invalid origin", { ...metadata(), source: { session: "", entry: "x", quote: entry.fact } }],
	["invalid timestamp", { ...metadata(), created: "made-up-time" }],
	["unsupported schema", { ...metadata(), schema: 2 }],
] as const) {
	test(`${name} fails closed and an old proposal cannot overwrite it`, t => {
		const store = fixture(t), old = store.read("user"), damaged = raw(value);
		writeFileSync(store.path("user"), damaged);
		assert.throws(() => store.read("user"), /metadata/);
		assert.throws(() => store.add(old, [entry]));
		assert.equal(readFileSync(store.path("user"), "utf8"), damaged);
	});
}
test("malformed marker, duplicate managed IDs and unreadable file are not empty stores", t => {
	const store = fixture(t), path = store.path("user");
	for (const damaged of ["<!-- hermes-entry {broken} -->\n- Fact.\n", raw(metadata()) + "\n" + raw(metadata()), "<!-- hermes-entry incomplete\n- Fact.\n"]) {
		writeFileSync(path, damaged); assert.throws(() => store.read("user")); assert.equal(readFileSync(path, "utf8"), damaged);
	}
	rmSync(path); mkdirSync(path);
	assert.throws(() => store.read("user"));
});
test("invalid new provenance is refused before a file is written", t => {
	const store = fixture(t), snapshot = store.read("user");
	assert.throws(() => store.add(snapshot, [{ ...entry, source: { session: "source-session", entry: "source-entry", quote: "An unrelated quote." } }]), /provenance/);
	assert.equal(store.read("user").raw, "");
});
test("real inspector exposes provenance pointers and edit diagnostic without quote text or another model call", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	const store = new MemoryStore(f.agentDir); store.add(store.read("user"), [entry]);
	writeFileSync(store.path("user"), store.read("user").raw.replace(`- ${entry.fact}`, "- User-edited private display text."));
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await f.session.prompt("/hermes-memory"); } finally { process.stdout.write = write; }
	const detail = JSON.parse(output.join("").trim()).detail.targets.find((target: { target: string }) => target.target === "user");
	assert.deepEqual(detail.records[0].source, { kind: "user-authored" }); assert.equal(detail.records[0].id, entry.id);
	assert.match(detail.diagnostics[0], /user-edited body/);
	assert.doesNotMatch(output.join(""), /I prefer concise answers|User-edited private display text/);
	assert.equal(f.faux.state.callCount, 0);
});

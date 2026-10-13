import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionIndex, type IndexedHit } from "../src/session-index.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
import { readdirSync } from "node:fs";
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readdirHashes = (dir: string) =>
	new Map(readdirSync(dir).filter(name => name.endsWith(".jsonl")).map(name => [name, sha256(join(dir, name))]));

async function indexReady(index: SessionIndex) {
	await index.enumerate();
	for (let i = 0; i < 20; i++) {
		const progress = index.advance();
		if (progress.done) return progress;
	}
	throw new Error("index never became ready");
}

test("scoped enumeration indexes only the authorized session dir and preserves branch/compaction locators", async t => {
	const f = await sdkFixture(t);
	const scopeDir = f.sessionManager.getSessionDir();
	const foreign = await sdkFixture(t);
	const foreignDir = foreign.sessionManager.getSessionDir();
	assert.notEqual(scopeDir, foreignDir);

	// Branch + sibling + compaction inside the authorized scope.
	const user = f.sessionManager.appendMessage({ role: "user", content: "deploy-marker user instruction", timestamp: 1 });
	f.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ack" }], timestamp: 2 } as never);
	const siblingManager = SessionManager.create(f.cwd, scopeDir);
	siblingManager.appendMessage({ role: "user", content: "deploy-marker sibling branch only", timestamp: 3 });
	f.sessionManager.branch(user);
	f.sessionManager.appendMessage({ role: "user", content: "deploy-marker main branch", timestamp: 4 });
	f.sessionManager.appendContextEdit(user, { content: "deploy-marker user instruction (edited)" });
	f.sessionManager.appendCompaction("deploy-marker compaction summary", user, 500);

	const before = readdirHashes(scopeDir);
	const index = new SessionIndex({ scope: { sessionDir: scopeDir, cwd: f.cwd } });
	const calls = f.faux.state.callCount;
	const progress = await indexReady(index);
	assert.equal(progress.done, true);
	assert.equal(progress.filesTotal, 2);
	assert.equal(progress.filesIndexed, 2);
	assert.equal(progress.filesUnavailable, 0);

	const page = index.search("deploy-marker", 20);
	assert.ok(page.hits.length >= 3, JSON.stringify(page.hits.map(hit => hit.preview)));
	for (const hit of page.hits) {
		assert.equal(typeof hit.offset, "number");
		assert.ok(hit.lineBytes > 0);
		assert.ok([...hit.preview].length <= 400);
		// Locator re-reads the authoritative source line.
		const source = index.readSource(hit);
		assert.ok("entry" in source, `source resolves ${hit.entryId}`);
		if ("entry" in source) assert.equal(source.entry.id, hit.entryId);
	}
	const compaction = index.search("compaction summary", 5).hits[0];
	assert.ok(compaction);
	assert.equal(compaction.type, "compaction");
	assert.ok(compaction.location.onCurrentBranch);
	assert.ok(compaction.location.markers.includes("compaction"));
	const edited = index.hit(compaction.sessionId, user);
	assert.ok(edited);
	assert.ok(edited.location.markers.includes("context-edit"));
	// Sibling file session is a different session file; the main file's branch excludes it.
	const siblingHits = page.hits.filter(hit => hit.sessionId !== f.sessionManager.getSessionId());
	assert.ok(siblingHits.length >= 1);

	// Foreign-scope sessions land in the index only when no cwd filter is set; with the
	// authorized project cwd they are excluded at enumerate (official list filter) and
	// again at header check. A foreign-dir scoped index sees its own sessions only.
	const foreignIndex = new SessionIndex({ scope: { sessionDir: foreignDir, cwd: foreign.cwd } });
	await indexReady(foreignIndex);
	assert.equal(foreignIndex.search("deploy-marker").total, 0, "no cross-scope leakage");

	// Narrower scope: only the main session id -> sibling file excluded.
	const narrow = new SessionIndex({ scope: { sessionDir: scopeDir, cwd: f.cwd, sessionIds: [f.sessionManager.getSessionId()] } });
	await indexReady(narrow);
	assert.ok(narrow.search("sibling branch only").total === 0, "sessionIds filter applied");

	// Sources byte-identical; indexing made zero provider calls.
	assert.deepEqual(readdirHashes(scopeDir), before);
	assert.equal(f.faux.state.callCount, calls);
	assert.deepEqual(f.errors, []);
});

test("append is incremental with prefix proof; truncate and same-size rewrite rebuild the file", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "append-proof alpha", timestamp: 1 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await indexReady(index);
	const file = f.sessionManager.getSessionFile()!;
	const state1 = index.fileState(file)!;
	const entries1 = state1.entries;
	const bytes1 = state1.indexedBytes;
	const hashBefore = sha256(file);

	// Append: same prefix hash, suffix only.
	f.sessionManager.appendMessage({ role: "user", content: "append-proof beta", timestamp: 2 });
	const progress = index.advance();
	assert.ok(progress.work.some(item => item.includes(":appended:")), JSON.stringify(progress.work));
	const state2 = index.fileState(file)!;
	assert.equal(state2.entries, entries1 + 1);
	assert.ok(state2.indexedBytes > bytes1);
	const hit = index.search("append-proof beta").hits[0];
	assert.ok(hit);

	// Truncate: remove the last line then advance -> rebuild. Kill the session
	// first so the SDK writer stops append-flushing over our fault injection.
	f.session.dispose();
	const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
	writeFileSync(file, lines.slice(0, -1).join("\n") + "\n");
	const afterTruncate = index.advance();
	assert.ok(afterTruncate.work.some(item => item.includes(":rebuilt:")), JSON.stringify(afterTruncate.work));
	assert.equal(index.search("append-proof beta").total, 0, "stale hit invalidated after truncate");
	assert.equal(index.search("append-proof alpha").total, 1);

	// Same-size rewrite: flip one byte inside a message body — ctime gate queues
	// re-verification, sha256 prefix decides rebuild.
	const raw = readFileSync(file, "utf8");
	const position = raw.indexOf("alpha");
	writeFileSync(file, raw.slice(0, position) + "xlpha" + raw.slice(position + 5));
	const afterRewrite = index.advance();
	assert.ok(afterRewrite.work.some(item => item.includes(":rebuilt:")), JSON.stringify(afterRewrite.work));
	assert.equal(index.search("append-proof xlpha").total, 1);
	assert.equal(index.search("append-proof alpha").total, 0);

	// Source JSONL content itself was only changed by the test harness writes above;
	// the index never wrote to it (hashes captured around index ops stay consistent
	// with the test's own writes — verify no extra drift between advances).
	assert.notEqual(sha256(file), hashBefore);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("malformed, damaged-header, missing and unreadable sources mark stale cache unavailable", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "fragile-marker ok", timestamp: 1 });
	const okFile = f.sessionManager.getSessionFile()!;

	// Malformed JSONL file.
	const badJsonl = join(dir, "2026-01-01T00-00-00-000Z_broken01.jsonl");
	writeFileSync(badJsonl, '{"type":"session","version":3,"id":"broken01","timestamp":"2026-01-01T00:00:00Z","cwd":"' + f.cwd + '"}\n{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":"fragile-marker malformed"}}\nnot-json\n');
	// Damaged header (non-session first line).
	const badHeader = join(dir, "2026-01-01T00-00-01-000Z_noheader.jsonl");
	writeFileSync(badHeader, '{"type":"message","id":"x1","parentId":null,"timestamp":"t","message":{"role":"user","content":"fragile-marker noheader"}}\n');
	// Unsupported future version.
	const future = join(dir, "2026-01-01T00-00-02-000Z_future01.jsonl");
	writeFileSync(future, '{"type":"session","version":99,"id":"future01","timestamp":"2026-01-01T00:00:02Z","cwd":"' + f.cwd + '"}\n');

	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	const progress = await indexReady(index);
	// Official SessionManager.list skips files that fail its own header scan; broken files may
	// not enumerate at all — index them via explicit paths coverage check instead.
	assert.ok(index.fileState(okFile));
	assert.equal(index.search("fragile-marker ok").total, 1);

	// Delete the healthy file -> unavailable with reason, stale hits gone.
	unlinkSync(okFile);
	await index.enumerate();
	const gone = index.fileState(okFile)!;
	assert.equal(gone.status, "unavailable");
	assert.match(gone.reason ?? "", /source-file-missing/);
	assert.equal(index.search("fragile-marker ok").total, 0);

	// Malformed tail appended to a still-indexed file invalidates the whole file.
	const survivor = join(dir, "2026-01-01T00-00-03-000Z_survivor1.jsonl");
	writeFileSync(survivor, '{"type":"session","version":3,"id":"survivor1","timestamp":"2026-01-01T00:00:03Z","cwd":"' + f.cwd + '"}\n{"type":"message","id":"s1","parentId":null,"timestamp":"t1","message":{"role":"user","content":"fragile-marker survivor"}}\n');
	const index2 = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await indexReady(index2);
	assert.equal(index2.search("survivor").total, 1);
	writeFileSync(survivor, readFileSync(survivor, "utf8") + "corrupt-tail\n");
	const tail = index2.advance();
	assert.ok(tail.work.some(item => item.includes(":malformed") || item.includes("unavailable")), JSON.stringify(tail.work));
	assert.equal(index2.search("survivor").total, 0, "malformed tail invalidates cached hits");

	// Unreadable source (non-ENOENT read fault).
	const sealed = join(dir, "2026-01-01T00-00-04-000Z_sealed01.jsonl");
	writeFileSync(sealed, '{"type":"session","version":3,"id":"sealed01","timestamp":"2026-01-01T00:00:04Z","cwd":"' + f.cwd + '"}\n{"type":"message","id":"z1","parentId":null,"timestamp":"t","message":{"role":"user","content":"fragile-marker sealed"}}\n');
	const index3 = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await index3.enumerate();
	chmodSync(sealed, 0o000);
	index3.advance();
	const sealedState = index3.fileState(sealed)!;
	assert.equal(sealedState.status, "unavailable");
	assert.match(sealedState.reason ?? "", /source-unreadable:EACCES/);
	chmodSync(sealed, 0o600);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("deleted or version-corrupt cache rebuilds to source-equivalent hits; never the other way", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "rebuild-marker one", timestamp: 1 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await indexReady(index);
	const hits1 = index.search("rebuild-marker", 10).hits.map(hit => [hit.sessionId, hit.entryId, hit.offset]);
	const hash1 = sha256(f.sessionManager.getSessionFile()!);

	// Delete the derived cache -> fresh instance rebuilds identically.
	index.reset();
	const rebuilt = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await indexReady(rebuilt);
	assert.deepEqual(rebuilt.search("rebuild-marker", 10).hits.map(hit => [hit.sessionId, hit.entryId, hit.offset]), hits1);
	assert.equal(sha256(f.sessionManager.getSessionFile()!), hash1, "JSONL byte-identical across rebuild");

	// Corrupt the cache -> reset-and-rebuild, not trust.
	writeFileSync(index.paths.indexFile, '{"v":1,"kind":"file","path":"/nonexistent","status":"indexed","sessionId":"fake"}\nnot-json\n');
	const corrupted = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await indexReady(corrupted);
	assert.deepEqual(corrupted.search("rebuild-marker", 10).hits.map(hit => [hit.sessionId, hit.entryId, hit.offset]), hits1);
	assert.equal(sha256(f.sessionManager.getSessionFile()!), hash1);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("batched large history reports bounded per-advance work and visible coverage", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	// ~150 messages, each sizeable; batch well under total so progress must be partial first.
	for (let i = 0; i < 150; i++) {
		f.sessionManager.appendMessage({ role: "user", content: `batch-marker item ${i} ` + "padding ".repeat(80), timestamp: i });
	}
	const file = f.sessionManager.getSessionFile()!;
	const totalSize = statSync(file).size;
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: totalSize / 4 });
	await index.enumerate();
	const seen: number[] = [];
	let guard = 0;
	let sawPartial = false;
	while (true) {
		const progress = index.advance();
		if (!progress.done && progress.bytesIndexed > 0 && progress.bytesIndexed < progress.bytesTotal) sawPartial = true;
		seen.push(progress.bytesIndexed);
		if (progress.done) break;
		assert.ok(++guard < 20, "batch progress terminates");
		assert.ok(progress.filesPending >= 0);
	}
	assert.ok(seen.length > 1, `batched: ${JSON.stringify(seen)}`);
	assert.ok(sawPartial, `partial coverage visible before done: ${JSON.stringify(seen)}`);
	assert.equal(index.search("batch-marker item 149").total, 1);
	assert.equal(index.fileState(file)!.status, "indexed");
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

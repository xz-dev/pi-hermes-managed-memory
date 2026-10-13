import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionIndex, SESSION_INDEX_VERSION } from "../src/session-index.ts";
import { sdkFixture } from "./sdk-fixture.ts";

/** Fixed-findings regression closure for the Task 5.1 repair (F1–F10). Each test encodes a
 *  reviewer-reproduced failure as a real assertion; all run against disposable fixtures. */

async function ready(index: SessionIndex, max = 150) {
	await index.enumerate();
	for (let i = 0; i < max; i++) if (index.advance().done) return;
	throw new Error("index never became ready");
}
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("F1: a cache target inside another native collection is refused before any destruction", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "OWN-NATIVE-SOURCE", timestamp: 1 });
	const foreignRoot = join(f.agentDir, "foreign"), foreignDir = join(foreignRoot, "sessions");
	const foreign = SessionManager.create(f.cwd, foreignDir);
	foreign.appendMessage({ role: "user", content: "FOREIGN-NATIVE-MUST-STAY", timestamp: 2 });
	const foreignFile = foreign.getSessionFile()!;
	const before = sha256(foreignFile);
	assert.throws(() => new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: foreignFile }));
	assert.throws(() => new SessionIndex({ scope: { sessionDir: dir }, indexFile: foreignFile }));
	assert.equal(sha256(foreignFile), before, "refused before load/persist/reset could touch native bytes");
	assert.ok(readFileSync(foreignFile, "utf8").startsWith('{"type":"session"'), "native header intact");
	// An existing corrupt derived cache at the same path is still rebuildable (version marker check).
	const cacheTarget = join(foreignRoot, "rebuildable.jsonl");
	writeFileSync(cacheTarget, '{"v":1,"kind":"file","path":"/gone"}\nnot-json\n');
	const rebuilt = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: cacheTarget });
	await ready(rebuilt);
	assert.equal(rebuilt.search("OWN-NATIVE-SOURCE").total, 1);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F2: external aliases never widen scope — before discovery, after discovery, or via parent swap", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "INSIDE-COLLECTION", timestamp: 1 });
	const outsideDir = join(f.agentDir, "outside-sessions");
	const outside = SessionManager.create(f.cwd, outsideDir);
	outside.appendMessage({ role: "user", content: "ALIAS-OUTSIDE-CANARY", timestamp: 2 });
	const outsideFile = outside.getSessionFile()!, outsideOriginal = readFileSync(outsideFile);

	// Initial symlink placed before enumeration: no hits, outside bytes untouched.
	symlinkSync(outsideFile, join(dir, basename(outsideFile)));
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index);
	assert.equal(index.search("ALIAS-OUTSIDE-CANARY").total, 0);
	assert.equal(index.fileState(join(dir, basename(outsideFile)))!.status, "unavailable");

	// Alias swapped in AFTER discovery replacing a tracked native file: unavailable, no re-read.
	const ownFile = f.sessionManager.getSessionFile()!;
	const index2 = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index2);
	f.session.dispose();
	renameSync(ownFile, ownFile + ".hidden");
	symlinkSync(outsideFile, ownFile);
	const after = index2.advance();
	assert.equal(after.filesUnavailable, 2);
	assert.equal(index2.search("ALIAS-OUTSIDE-CANARY").total, 0);
	assert.equal(index2.search("INSIDE-COLLECTION").total, 0, "swapped source loses eligibility");

	// Parent-directory replacement of the whole collection: visible failure, not silent read.
	const saved = dir + "-saved";
	f.session.dispose();
	renameSync(dir, saved);
	// The SAME index tracking the original collection must now visibly fail, not silently
	// re-read through whatever replaced it, and never report a perfect empty success.
	const swapped = await index2.enumerate();
	assert.equal(swapped.collectionError, "collection-unreadable:ENOENT");
	assert.equal(swapped.filesUnavailable + swapped.filesIndexed, swapped.filesTotal, "tracked sources visible");
	assert.deepEqual(readFileSync(outsideFile), outsideOriginal);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F3: headerless sources and cache-claimed identities yield unavailable, never fabricated provenance", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "HEADER-AUTHORITY-CANARY", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!;
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index);
	f.session.dispose();
	// Rewrite without the header line.
	writeFileSync(file, readFileSync(file, "utf8").split("\n").slice(1).join("\n"));
	const after = index.advance();
	assert.equal(after.filesUnavailable, 1);
	assert.equal(index.search("HEADER-AUTHORITY-CANARY").total, 0);
	assert.match(index.fileState(file)!.reason ?? "", /missing-session-header/);

	// Cache-seeded identity for a headerless body cannot authorize anything.
	const root = join(f.agentDir, "seeded"), seededDir = join(root, "sessions");
	const seeded = SessionManager.create(f.cwd, seededDir);
	seeded.appendMessage({ role: "user", content: "SEED-AUTH-CANARY", timestamp: 1 });
	const seededFile = seeded.getSessionFile()!;
	writeFileSync(seededFile, readFileSync(seededFile, "utf8").split("\n").slice(1).join("\n"));
	const cache = join(root, "cache.jsonl");
	writeFileSync(cache, JSON.stringify({ v: SESSION_INDEX_VERSION, kind: "file", path: seededFile, sessionId: "cache-claims-authorized-id" }) + "\n");
	const seededIndex = new SessionIndex({ scope: { sessionDir: seededDir, cwd: f.cwd }, indexFile: cache });
	seededIndex.advance();
	assert.equal(seededIndex.search("SEED-AUTH-CANARY").total, 0);
	assert.match(seededIndex.fileState(seededFile)!.reason ?? "", /missing-session-header/);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F4: buffered drift, growth rewrites and shrinkage all rebuild the current source", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const id = f.sessionManager.appendMessage({ role: "user", content: "OLD-FRAGMENT-CANARY " + "猫🐈 pad ".repeat(350), timestamp: 1 });
	f.session.dispose();
	const file = f.sessionManager.getSessionFile()!;
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 256 });
	await index.enumerate();
	index.advance(); index.advance();
	// Same-size edit INSIDE the buffered (uncommitted) fragment.
	writeFileSync(file, readFileSync(file, "utf8").replace("OLD-FRAGMENT-CANARY", "NEW-FRAGMENT-CANARY"));
	const currentHash = sha256(file);
	for (let i = 0; i < 100; i++) if (index.advance().done) break;
	assert.equal(index.search("OLD-FRAGMENT-CANARY").total, 0, "stale buffered text never searchable");
	assert.equal(index.search("NEW-FRAGMENT-CANARY").total, 1, "current bytes indexed");
	assert.equal(sha256(file), currentHash);
	const held = index.hit(f.sessionManager.getSessionId(), id);
	assert.ok(held);
	const raw = index.readSource(held);
	assert.ok("entry" in raw, "current locator resolves");	if ("entry" in raw) {
		const content = (raw.entry as { message?: { content?: unknown } }).message?.content;
		assert.ok(typeof content === "string" && content.includes("NEW-FRAGMENT-CANARY"), "locator reads current content");
	}

	// Valid truncation below the buffered cursor rebuilds (no false unreadable).
	const truncated = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 256 });
	await truncated.enumerate();
	for (let i = 0; i < 5; i++) truncated.advance();
	const rows = readFileSync(file, "utf8").split("\n").filter(Boolean);
	// Shorten the giant record so the new complete file ends below the buffered scan cursor.
	const giantRow = rows.findIndex(row => row.includes("NEW-FRAGMENT-CANARY"));
	const shortened = JSON.parse(rows[giantRow]);
	shortened.message.content = "NEW-FRAGMENT-CANARY";
	rows[giantRow] = JSON.stringify(shortened);
	writeFileSync(file, rows.slice(0, giantRow + 1).join("\n") + "\n"
		+ JSON.stringify({ type: "message", id: "short-tail", parentId: id, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "TRUNCATED-REBUILD-CANARY" } }) + "\n");
	assert.ok(readFileSync(file).length < 5 * 256, "fixture genuinely shrinks below its staged cursor");
	for (let i = 0; i < 20; i++) if (truncated.advance().done) break;
	assert.equal(truncated.fileState(file)!.status, "indexed", "valid truncation rebuilds, not unavailable");
	assert.equal(truncated.search("TRUNCATED-REBUILD-CANARY").total, 1);
	assert.equal(truncated.search("NEW-FRAGMENT-CANARY").total, 1, "retained prefix content survives a proven rebuild");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F5: malformed native shapes are explained unavailable; duplicate identities lose no corpus silently", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const shapes = [
		["null", "null"],
		["missing-message", JSON.stringify({ type: "message", id: "bad", parentId: null, timestamp: "t" })],
		["unknown-type", JSON.stringify({ type: "made_up", id: "bad", parentId: null, timestamp: "t" })],
		["missing-time-parent", JSON.stringify({ type: "message", id: "bad", message: { role: "user", content: "BAD-SHAPE" } })],
	] as const;
	for (const [name, row] of shapes) {
		const fixture = await sdkFixture(t);
		const shapeDir = fixture.sessionManager.getSessionDir();
		fixture.sessionManager.appendMessage({ role: "user", content: `HEALTHY-${name}`, timestamp: 1 });
		const shapeFile = fixture.sessionManager.getSessionFile()!;
		writeFileSync(shapeFile, readFileSync(shapeFile, "utf8") + row + "\n");
		const index = new SessionIndex({ scope: { sessionDir: shapeDir } });
		let error: unknown;
		try { await ready(index); } catch (e) { error = e; }
		assert.equal(error, undefined, `${name}: no uncaught exception`);
		assert.equal(index.fileState(shapeFile)!.status, "unavailable", `${name}: explained unavailable`);
		assert.ok(index.fileState(shapeFile)!.reason, `${name}: carries a reason`);
	}

	// Conflicting duplicate ids: refused rather than silently overwritten corpus.
	const dup = await sdkFixture(t), dupDir = dup.sessionManager.getSessionDir();
	dup.sessionManager.appendMessage({ role: "user", content: "DUPLICATE-ID-ORIGINAL", timestamp: 1 });
	const dupFile = dup.sessionManager.getSessionFile()!;
	const rows = readFileSync(dupFile, "utf8").split("\n").filter(Boolean);
	const original = JSON.parse(rows[1]);
	const conflicting = { ...original, message: { ...original.message, content: "DUPLICATE-ID-NEW" } };
	writeFileSync(dupFile, rows.join("\n") + "\n" + JSON.stringify(conflicting) + "\n");
	const dupIndex = new SessionIndex({ scope: { sessionDir: dupDir } });
	await dupIndex.enumerate();
	dupIndex.advance();
	assert.equal(dupIndex.fileState(dupFile)!.status, "unavailable");
	assert.match(dupIndex.fileState(dupFile)!.reason ?? "", /duplicate-entry-id/);
	assert.equal(dupIndex.search("DUPLICATE-ID").total, 0, "no partial eligible corpus");
	// Byte-identical duplicated row is tolerated (idempotent native write).
	const twin = await sdkFixture(t), twinDir = twin.sessionManager.getSessionDir();
	twin.sessionManager.appendMessage({ role: "user", content: "TWIN-ROW-CANARY", timestamp: 1 });
	const twinFile = twin.sessionManager.getSessionFile()!;
	writeFileSync(twinFile, readFileSync(twinFile, "utf8") + readFileSync(twinFile, "utf8").split("\n").filter(Boolean)[1] + "\n");
	const twinIndex = new SessionIndex({ scope: { sessionDir: twinDir } });
	await ready(twinIndex);
	assert.equal(twinIndex.search("TWIN-ROW-CANARY").total, 1, "identical duplicate row is one record");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F6: damaged/oversized/missing-collection discovery is visible, canonical-cwd aliases stay eligible", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const broken = join(dir, "2026-01-01T00-00-00-000Z_broken.jsonl");
	writeFileSync(broken, "not-json\n");
	const headerless = join(dir, "2026-01-01T00-00-01-000Z_noheader.jsonl");
	writeFileSync(headerless, JSON.stringify({ type: "message", id: "x1", parentId: null, timestamp: "t", message: { role: "user", content: "NO-HEADER" } }) + "\n");
	const sealed = join(dir, "2026-01-01T00-00-02-000Z_sealed.jsonl");
	writeFileSync(sealed, "sealed-fixture\n");
	chmodSync(sealed, 0o000);
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	const progress = await index.enumerate();
	assert.equal(progress.filesUnavailable + progress.filesPending, 3, "damaged candidates visible, not perfect empty");
	assert.equal(index.fileState(broken)!.status, "unavailable");
	assert.equal(index.fileState(headerless)!.status, "unavailable");
	assert.equal(index.fileState(sealed)!.status, "unavailable");
	chmodSync(sealed, 0o600);

	// Oversized (12KB) valid header: indexed via the parse phase, not silently dropped.
	const big = await sdkFixture(t), bigDir = big.sessionManager.getSessionDir();
	big.sessionManager.appendMessage({ role: "user", content: "LARGE-HEADER-CANARY", timestamp: 1 });
	const bigFile = big.sessionManager.getSessionFile()!;
	const bigRows = readFileSync(bigFile, "utf8").split("\n");
	const header = JSON.parse(bigRows[0]);
	header.reviewFixtureMetadata = "z".repeat(12000);
	bigRows[0] = JSON.stringify(header);
	writeFileSync(bigFile, bigRows.join("\n"));
	const bigIndex = new SessionIndex({ scope: { sessionDir: bigDir } });
	await ready(bigIndex);
	assert.equal(bigIndex.search("LARGE-HEADER-CANARY").total, 1);

	// Canonical cwd alias (header cwd is a symlink to the authorized canonical cwd): eligible.
	const alias = join(f.agentDir, "cwd-alias");
	symlinkSync(f.cwd, alias, "dir");
	const aliasSm = SessionManager.create(alias, dir);
	aliasSm.appendMessage({ role: "user", content: "CANONICAL-CWD-CANARY", timestamp: 9 });
	const scoped = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await scoped.enumerate();
	const aliasState = scoped.fileState(aliasSm.getSessionFile()!);
	assert.ok(aliasState, "canonical-cwd alias candidate tracked");
	assert.notEqual(aliasState!.status, "unavailable");

	// Missing collection directory at construction: visible refusal, not a silent empty index.
	const goneDir = join(f.agentDir, "gone", "sessions");
	assert.throws(() => new SessionIndex({ scope: { sessionDir: goneDir } }), /sessionDir must exist/,
		"a missing collection cannot construct a perfect-empty index");
	// A tracked collection that disappears later surfaces collectionError per call.
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F7: branch membership is native ancestry from the last physical entry; markers are branch-local effective", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	// Compacted ancestor still lies on the native branch.
	const ancestor = f.sessionManager.appendMessage({ role: "user", content: "ANCESTOR-SUMMARIZED", timestamp: 1 });
	const kept = f.sessionManager.appendMessage({ role: "user", content: "KEPT", timestamp: 2 });
	f.sessionManager.appendCompaction("COMPACTION-SUMMARY", kept, 400);
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index);
	const ancestryHit = index.hit(f.sessionManager.getSessionId(), ancestor);
	assert.ok(ancestryHit);
	assert.equal(ancestryHit!.location.onCurrentBranch, true, "summarized ancestor is on the native branch");
	assert.ok(f.sessionManager.getBranch().map(entry => entry.id).includes(ancestor), "matches SDK native branch");

	// Sibling-only edit + label set/clear: no current-effective markers after branching away.
	const sibling = await sdkFixture(t), siblingDir = sibling.sessionManager.getSessionDir();
	const root = sibling.sessionManager.appendMessage({ role: "user", content: "ROOT-ORIGINAL", timestamp: 1 });
	sibling.sessionManager.appendContextEdit(root, { content: "SIBLING-REPLACEMENT" });
	sibling.sessionManager.appendLabelChange(root, "bookmark");
	sibling.sessionManager.appendLabelChange(root, undefined);
	sibling.sessionManager.branch(root);
	sibling.sessionManager.appendMessage({ role: "user", content: "FINAL-BRANCH", timestamp: 3 });
	const siblingIndex = new SessionIndex({ scope: { sessionDir: siblingDir, cwd: sibling.cwd } });
	await ready(siblingIndex);
	const rootHit = siblingIndex.hit(sibling.sessionManager.getSessionId(), root);
	assert.ok(rootHit);
	assert.equal(rootHit!.location.onCurrentBranch, true, "root is on the native ancestry");
	assert.deepEqual(rootHit!.location.markers, [], "off-branch edit and cleared label are not effective markers");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F8: duplicate cache file metadata yields one native hit, not two", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "DUP-CACHE-CANARY", timestamp: 1 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index);
	const metadata = readFileSync(index.paths.indexFile, "utf8").split("\n").filter(Boolean)
		.find(line => JSON.parse(line).kind === "file")!;
	writeFileSync(index.paths.indexFile, metadata + "\n" + metadata + "\n");
	const warm = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: index.paths.indexFile });
	await ready(warm);
	const result = warm.search("DUP-CACHE-CANARY");
	assert.equal(result.total, 1, "one physical native entry = one hit");
	assert.equal(warm.status().filesTotal, 1);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F9: readSource binds the supplied span to the current owned locator; forged spans rejected", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const first = f.sessionManager.appendMessage({ role: "user", content: "OWN-FIRST-LINE", timestamp: 1 });
	f.sessionManager.appendMessage({ role: "user", content: "OWN-SECOND-LINE-CANARY", timestamp: 2 });
	const file = f.sessionManager.getSessionFile()!;
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index);
	const hit = index.hit(f.sessionManager.getSessionId(), first)!;

	// Forged enlarged span returning two records as one: rejected.
	const counterfeit = { ...hit, lineBytes: readFileSync(file).length - hit.offset };
	const enlarged = index.readSource(counterfeit);
	assert.ok("error" in enlarged, "enlarged span refused");
	if ("raw" in enlarged) assert.ok(!(enlarged.raw as string).includes("OWN-SECOND-LINE-CANARY"), "no second record leaked");

	// Held stale span after a blank line shifts offsets: rejected, current locator resolves exactly.
	const held = { ...hit };
	f.session.dispose();
	writeFileSync(file, readFileSync(file, "utf8").replace("\n", "\n\n"));
	index.advance();
	const current = index.hit(f.sessionManager.getSessionId(), first)!;
	assert.equal(current.offset, held.offset + 1, "current locator relocated");
	const stale = index.readSource(held);
	assert.ok("error" in stale, "stale span refused");
	const exact = index.readSource(current);
	assert.ok("entry" in exact && exact.entry.id === first);
	if ("raw" in exact) assert.ok(exact.raw.startsWith('{"type":"message"'), "exact current line, no leading newline");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F10: per-stage work is measured and disclosed; staging stays the only budgeted stage", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "GIANT-DECODE " + "猫🐈".repeat(1800), timestamp: 1 });
	for (let i = 0; i < 60; i++) {
		f.sessionManager.appendMessage({ role: "user", content: `STAGE-CANARY-${i} ` + "pad ".repeat(64), timestamp: i });
	}
	const file = f.sessionManager.getSessionFile()!;
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 4096 });
	const enumerated = await index.enumerate();
	assert.ok(enumerated.enumeratedBytes > 0, "enumeration reads measured");
	let first: ReturnType<SessionIndex["advance"]>["stagedBytes"] = 0;
	let sawDecode = false;
	for (let i = 0; i < 40; i++) {
		const progress = index.advance();
		assert.ok(progress.stagedBytes <= 4096, "new-byte staging is bounded by batchBytes");
		if (i === 0) first = progress.stagedBytes;
		if (progress.decodedBytes > progress.stagedBytes) sawDecode = true;
		if (progress.done) break;
	}
	assert.equal(first, 4096, "first advance stages exactly the budget");
	assert.ok(sawDecode, "giant completion decode is separately disclosed beyond staging");
	const readyAdvance = index.advance();
	assert.ok(readyAdvance.verifiedBytes >= readFileSync(file).length, "ready no-op advance reports its verification work");
	assert.ok(readyAdvance.cacheWriteBytes > 0, "cache serialization reported, not zero work");
	const page = index.search("STAGE-CANARY-59");
	assert.ok(page.coverage.verifiedBytes >= readFileSync(file).length, "query verification work disclosed");
	assert.equal(page.total, 1);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F9 closure: returned hit objects cannot change owned source spans", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const id = f.sessionManager.appendMessage({ role: "user", content: "IMMUTABLE-LOCATOR-ONE", timestamp: 1 });
	f.sessionManager.appendMessage({ role: "user", content: "IMMUTABLE-LOCATOR-TWO", timestamp: 2 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	const original = index.hit(f.sessionManager.getSessionId(), id)!;
	const expected = structuredClone(original);
	original.offset += 1;
	original.location.markers.push("caller-invented");
	assert.deepEqual(index.hit(f.sessionManager.getSessionId(), id), expected, "hit returns a value, not the internal authority object");
	const page = index.search("IMMUTABLE-LOCATOR-ONE");
	page.hits[0].lineBytes += 1;
	assert.deepEqual(index.hit(f.sessionManager.getSessionId(), id), expected, "search also cannot expose mutable authority");
	assert.ok("error" in index.readSource(original));
	assert.ok("error" in index.readSource(page.hits[0]));
	assert.ok("entry" in index.readSource(expected));
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F10 closure: decode, projection, fingerprint and cache validation are distinct measured stages", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "STAGE-BASE", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index); const before = readFileSync(file).length;
	const id = f.sessionManager.appendMessage({ role: "user", content: "STAGE-APPEND", timestamp: 2 });
	const sourceBytes = readFileSync(file).length;
	const appended = index.advance();
	assert.equal(appended.stagedBytes, sourceBytes - before);
	assert.equal(appended.decodedBytes, sourceBytes - before, "old entries may be revisited for branch metadata, not decoded again");
	assert.equal(appended.nativeProjectionEntries, 1);
	assert.equal(appended.branchEntries, index.fileState(file)!.entries);
	assert.equal(appended.fingerprintBytes, sourceBytes);
	assert.equal(appended.prefixProofBytes, before + sourceBytes);
	assert.equal(appended.fragmentProofBytes, 0);
	assert.equal(appended.locatorReadBytes, 0);
	assert.equal(appended.verifiedBytes, appended.fingerprintBytes + appended.prefixProofBytes + appended.fragmentProofBytes + appended.locatorReadBytes);
	assert.ok(appended.cacheReadBytes > 0, "pre-write cache target validation reads are not free");
	const idle = index.advance();
	assert.equal(idle.decodedBytes, 0); assert.equal(idle.nativeProjectionEntries, 0); assert.equal(idle.branchEntries, 0);
	assert.equal(idle.fingerprintBytes, sourceBytes); assert.equal(idle.prefixProofBytes, 0);
	const hit = index.hit(f.sessionManager.getSessionId(), id)!;
	assert.ok("entry" in index.readSource(hit));
	assert.equal(index.status().locatorReadBytes, hit.lineBytes);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("F5 closure validates subtype provenance before native projection", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "VALID-PREFIX", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file, "utf8");
	for (const fields of [
		{ type: "compaction", summary: {}, firstKeptEntryId: "missing", tokensBefore: 1 },
		{ type: "context_edit", targetId: 7, replacement: null },
		{ type: "label", targetId: "missing", label: {} },
		{ type: "message", message: { role: "user", content: "DANGLING-PARENT" }, parentId: "missing" },
		{ type: "message", message: { role: "user", content: "SELF-PARENT" }, parentId: "bad-shape" },
	]) {
		writeFileSync(file, original + JSON.stringify({ id: "bad-shape", parentId: null, timestamp: "t", ...fields }) + "\n");
		const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
		assert.equal(index.fileState(file)!.status, "unavailable", `${fields.type}: malformed native subtype cannot become eligible`);
		assert.equal(index.search("VALID-PREFIX").total, 0);
	}
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("R1: whitespace before native content never grants destructive cache ownership", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "OWN-PRESERVED", timestamp: 1 });
	const foreign = SessionManager.create(f.cwd, join(f.agentDir, "foreign-sessions"));
	foreign.appendMessage({ role: "user", content: "FOREIGN-PRESERVED", timestamp: 2 });
	const ownFile = f.sessionManager.getSessionFile()!, foreignFile = foreign.getSessionFile()!;
	const own = readFileSync(ownFile), native = readFileSync(foreignFile, "utf8");
	for (const prefix of ["\n", " \t\n\r\n", " ".repeat(5000)]) {
		writeFileSync(foreignFile, prefix + native);
		const before = readFileSync(foreignFile);
		assert.throws(() => new SessionIndex({ scope: { sessionDir: dir }, indexFile: foreignFile }));
		assert.deepEqual(readFileSync(foreignFile), before);
	}
	const cache = join(f.agentDir, "explicit-cache.jsonl");
	writeFileSync(cache, "");
	const index = new SessionIndex({ scope: { sessionDir: dir }, indexFile: cache }); await ready(index);
	const derived = readFileSync(cache, "utf8");
	writeFileSync(cache, "\n \t\n" + derived);
	const reloaded = new SessionIndex({ scope: { sessionDir: dir }, indexFile: cache }); await ready(reloaded);
	assert.equal(reloaded.search("OWN-PRESERVED").total, 1);
	// Check the destructive consumers again when the target changes after construction.
	for (const changed of ["\n" + native, " \t\n", "\n".repeat(5000)]) {
		writeFileSync(cache, changed);
		assert.throws(() => index.advance()); assert.throws(() => index.reset());
		assert.equal(readFileSync(cache, "utf8"), changed);
	}
	assert.deepEqual(readFileSync(ownFile), own);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("R2: context-edit replacement content must have a native shape", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const targetId = f.sessionManager.appendMessage({ role: "user", content: "EDIT-PREFIX", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, prefix = readFileSync(file, "utf8"), leaf = f.sessionManager.getLeafId();
	const valid = [null, { content: "replacement" }, { content: [] }, { content: [
		{ type: "text", text: "replacement" }, { type: "image", data: "Zg==", mimeType: "image/png" },
		{ type: "thinking", thinking: "fixture" }, { type: "toolCall", id: "t", name: "fixture", arguments: {} },
	] }];
	const invalid = [{}, { content: 7 }, { content: null }, { content: [null] }, { content: [{ type: "text" }] }];
	for (const [values, expected] of [[valid, "indexed"], [invalid, "unavailable"]] as const) {
		for (const replacement of values) {
			const raw = prefix + JSON.stringify({ type: "context_edit", id: "edit", parentId: targetId,
				targetId, timestamp: "t", replacement }) + "\n";
			writeFileSync(file, raw);
			const index = new SessionIndex({ scope: { sessionDir: dir } }); await ready(index);
			assert.equal(index.fileState(file)!.status, expected, JSON.stringify(replacement));
			if (expected === "unavailable") assert.equal(index.search("EDIT-PREFIX").total, 0);
			assert.equal(readFileSync(file, "utf8"), raw);
		}
	}
	assert.equal(f.sessionManager.getLeafId(), leaf);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("R3: duplicate search identities retain the actual last physical native leaf", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const a = f.sessionManager.appendMessage({ role: "user", content: "DUP-ROOT", timestamp: 1 });
	const b = f.sessionManager.appendMessage({ role: "user", content: "DUP-CHILD", timestamp: 2 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file, "utf8");
	const rootRow = original.split("\n").find(row => row && JSON.parse(row).id === a)!;
	const index = new SessionIndex({ scope: { sessionDir: dir } }); await ready(index);
	const duplicated = original + rootRow + "\n";
	writeFileSync(file, duplicated); index.advance();
	const check = (candidate: SessionIndex) => {
		assert.equal(candidate.fileState(file)!.status, "indexed");
		assert.equal(candidate.hit(f.sessionManager.getSessionId(), a)!.location.onCurrentBranch, true);
		assert.equal(candidate.hit(f.sessionManager.getSessionId(), b)!.location.onCurrentBranch, false);
		assert.equal(candidate.search("DUP-ROOT").total, 1);
		assert.equal(candidate.search("DUP-CHILD").total, 1);
		assert.equal(readFileSync(file, "utf8"), duplicated);
	};
	check(index); // append path
	const warm = new SessionIndex({ scope: { sessionDir: dir } }); await ready(warm); check(warm);
	warm.reset(); await ready(warm); check(warm); // no derived data
	writeFileSync(file, "\n" + duplicated); index.advance();
	assert.equal(index.hit(f.sessionManager.getSessionId(), b)!.location.onCurrentBranch, false, "rewrite path uses physical order too");
	assert.equal(f.sessionManager.getLeafId(), b, "index never changes the live leaf to the reload leaf");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

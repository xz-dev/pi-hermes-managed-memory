import assert from "node:assert/strict";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionIndex } from "../src/session-index.ts";
import { sdkFixture } from "./sdk-fixture.ts";

async function ready(index: SessionIndex) {
	await index.enumerate();
	for (let i = 0; i < 100; i++) if (index.advance().done) return;
	throw new Error("native index did not finish");
}

function offsetOf(file: string, id: string) {
	const raw = readFileSync(file, "utf8");
	const line = raw.split("\n").find(value => value && JSON.parse(value).id === id)!;
	return Buffer.byteLength(raw.slice(0, raw.indexOf(line)), "utf8");
}

test("Unicode native locators use byte offsets and resolve every physical entry", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "猫🐈 Unicode first", timestamp: 1 });
	const second = f.sessionManager.appendMessage({ role: "user", content: "UNICODE-SECOND-LOCATOR", timestamp: 2 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file), leaf = f.sessionManager.getLeafId();
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	const hit = index.hit(f.sessionManager.getSessionId(), second)!;
	assert.equal(hit.offset, offsetOf(file, second), "characters are not native byte offsets");
	const source = index.readSource(hit);
	assert.ok("entry" in source, JSON.stringify(source));
	if ("entry" in source) assert.equal(source.entry.id, second);
	assert.deepEqual(readFileSync(file), original); assert.equal(f.sessionManager.getLeafId(), leaf);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("oversized line progress neither double-counts bytes nor hides unread following records", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const big = f.sessionManager.appendMessage({ role: "user", content: "GIANT-LOCATOR " + "猫🐈 output ".repeat(600), timestamp: 1 });
	const tailIds: string[] = [];
	for (let i = 0; i < 40; i++) tailIds.push(f.sessionManager.appendMessage({ role: "user", content: `POST-GIANT-${i} ` + "tail ".repeat(40), timestamp: i + 2 }));
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file), leaf = f.sessionManager.getLeafId();
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 1024 });
	await ready(index);
	const state = index.fileState(file)!, progress = index.status();
	assert.equal(state.indexedBytes, original.length, "committed coverage must not count buffered bytes twice");
	assert.equal(progress.bytesIndexed, progress.bytesTotal);
	assert.equal(index.search("POST-GIANT-", 100).total, tailIds.length, "done must include the native tail beyond the giant line");
	for (const id of [big, ...tailIds]) {
		const hit = index.hit(f.sessionManager.getSessionId(), id);
		assert.ok(hit, `missing ${id}`);
		assert.equal(hit.offset, offsetOf(file, id));
		const source = index.readSource(hit);
		assert.ok("entry" in source, JSON.stringify(source));
		if ("entry" in source) assert.equal(source.entry.id, id);
	}
	assert.deepEqual(readFileSync(file), original); assert.equal(f.sessionManager.getLeafId(), leaf);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("outward search and hit invalidate changed source without optional advance cooperation", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	const id = f.sessionManager.appendMessage({ role: "user", content: "BOUNDARY-OLD-CANARY", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index); f.session.dispose();
	writeFileSync(file, readFileSync(file, "utf8").replace("BOUNDARY-OLD-CANARY", "BOUNDARY-NEW-CANARY"));
	const changed = readFileSync(file);
	assert.equal(index.search("BOUNDARY-OLD-CANARY").total, 0, "an outward read cannot authorize old cached bodies");
	assert.equal(index.hit(f.sessionManager.getSessionId(), id), undefined);
	assert.deepEqual(readFileSync(file), changed);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("readSource refuses locators belonging to a different explicitly authorized collection", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir(), outsideDir = join(f.agentDir, "outside-sessions");
	f.sessionManager.appendMessage({ role: "user", content: "OWNED-COLLECTION", timestamp: 1 });
	const outside = SessionManager.create(f.cwd, outsideDir);
	outside.appendMessage({ role: "user", content: "OUTSIDE-COLLECTION-PRIVATE", timestamp: 2 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	const foreignIndex = new SessionIndex({ scope: { sessionDir: outsideDir, cwd: f.cwd } }); await ready(foreignIndex);
	const foreign = foreignIndex.search("OUTSIDE-COLLECTION-PRIVATE").hits[0];
	assert.ok(foreign);
	const source = index.readSource(foreign);
	assert.ok("error" in source, "a valid foreign native locator is still unauthorized in this collection");
	assert.ok(!JSON.stringify(source).includes("OUTSIDE-COLLECTION-PRIVATE"));
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("native filename aliases cannot expand the authorized source collection", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir(), outsideDir = join(f.agentDir, "outside-sessions");
	f.sessionManager.appendMessage({ role: "user", content: "INTERNAL-COLLECTION", timestamp: 1 });
	const outside = SessionManager.create(f.cwd, outsideDir);
	outside.appendMessage({ role: "user", content: "SYMLINK-OUTSIDE-CANARY", timestamp: 2 });
	const file = outside.getSessionFile()!, original = readFileSync(file);
	symlinkSync(file, join(dir, basename(file)));
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	assert.equal(index.search("SYMLINK-OUTSIDE-CANARY").total, 0, "canonical source paths must remain in the authorized collection");
	assert.deepEqual(readFileSync(file), original);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("corrected native source is freshly revalidated rather than permanently misreported unavailable", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "REPAIR-SOURCE-CANARY", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file);
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	f.session.dispose(); writeFileSync(file, Buffer.concat([original, Buffer.from("not-json\n")]));
	index.advance(); assert.equal(index.fileState(file)?.status, "unavailable");
	writeFileSync(file, original); await ready(index);
	assert.equal(index.fileState(file)?.status, "indexed", "only fresh validated bytes, not the old cache, may restore eligibility");
	assert.equal(index.search("REPAIR-SOURCE-CANARY").total, 1);
	assert.deepEqual(readFileSync(file), original);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

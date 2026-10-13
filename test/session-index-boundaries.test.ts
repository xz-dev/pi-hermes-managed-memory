import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionIndex } from "../src/session-index.ts";
import { sdkFixture } from "./sdk-fixture.ts";

async function ready(index: SessionIndex) {
	await index.enumerate();
	for (let i = 0; i < 40; i++) if (index.advance().done) return;
	throw new Error("index never finished bounded batches");
}

test("a warm derived cache cannot authorize a different cwd scope", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "SCOPE-A-CANARY", timestamp: 1 });
	const cwdB = join(f.agentDir, "project-b"); mkdirSync(cwdB);
	const b = SessionManager.create(cwdB, dir); b.appendMessage({ role: "user", content: "SCOPE-B-CANARY", timestamp: 2 });
	const broad = new SessionIndex({ scope: { sessionDir: dir } }); await ready(broad);
	assert.equal(broad.search("SCOPE-B-CANARY").total, 1);
	const narrow = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(narrow);
	assert.equal(narrow.search("SCOPE-B-CANARY").total, 0, "cached indexed state must be reauthorized under the new scope");
	assert.equal(narrow.search("SCOPE-A-CANARY").total, 1);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("one native record larger than a batch must still finish indexing across bounded advances", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "LARGE-LINE-CANARY " + "猫 private output ".repeat(600), timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file);
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 1024 });
	await ready(index);
	assert.equal(index.search("LARGE-LINE-CANARY").total, 1);
	assert.deepEqual(readFileSync(file), original);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("observed rewrite loses eligibility even when an earlier file exhausts the current batch", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "cache-old-a", timestamp: 1 });
	const b = SessionManager.create(f.cwd, dir); b.appendMessage({ role: "user", content: "cache-old-b", timestamp: 2 });
	const warm = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(warm);
	const infos = await SessionManager.list(f.cwd, dir), first = infos[0].path, second = infos[1].path;
	const firstManager = first === f.sessionManager.getSessionFile() ? f.sessionManager : b;
	const old = readFileSync(second, "utf8").includes("cache-old-a") ? "cache-old-a" : "cache-old-b";
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, batchBytes: 1024 }); await ready(index);
	firstManager.appendMessage({ role: "user", content: "consume batch ".repeat(200), timestamp: 3 });
	writeFileSync(second, readFileSync(second, "utf8").replace(old, old.replace("old", "new")));
	index.advance();
	assert.equal(index.search(old).total, 0, "a known content-hash mismatch cannot leave old indexed hits eligible");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("corrupted native source is unavailable rather than falsely fully indexed after skipped lines", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "CORRUPT-CACHE-CANARY", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(index); const raw = readFileSync(file, "utf8");
	// A rewrite (not merely appended tail) contains invalid JSONL after valid native rows.
	writeFileSync(file, raw.replace("CORRUPT-CACHE-CANARY", "CORRUPT-CACHE-CHANGED") + "not-json\n");
	index.advance();
	assert.equal(index.fileState(file)!.status, "unavailable", "permissive parse skipping is not complete native-source validation");
	assert.equal(index.search("CORRUPT-CACHE").total, 0);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("a cache parent symlink cannot make derived persistence overwrite native JSONL", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "SOURCE-MUST-STAY-NATIVE", timestamp: 1 });
	const file = f.sessionManager.getSessionFile()!, original = readFileSync(file);
	const alias = join(f.agentDir, "source-alias"); symlinkSync(dir, alias, "dir");
	let refused = false;
	try {
		const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: join(alias, basename(file)) });
		await ready(index);
	} catch { refused = true; }
	assert.deepEqual(readFileSync(file), original, "derived cache writes must never target original JSONL through a parent alias");
	assert.equal(refused, true, "the alias must be refused before cache writes");
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

test("keyword coverage cannot silently stop at the presentation preview boundary", async t => {
	const f = await sdkFixture(t), dir = f.sessionManager.getSessionDir();
	f.sessionManager.appendMessage({ role: "user", content: "prefix ".repeat(100) + "DEEP-KEYWORD-CANARY", timestamp: 1 });
	const index = new SessionIndex({ scope: { sessionDir: dir, cwd: f.cwd } }); await ready(index);
	const result = index.search("DEEP-KEYWORD-CANARY");
	assert.equal(result.total, 1, "short previews bound presentation, not the searchable native source");
	assert.ok([...result.hits[0].preview].length <= 400);
	assert.equal(f.faux.state.callCount, 0); assert.deepEqual(f.errors, []);
});

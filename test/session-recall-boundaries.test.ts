import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionRecall } from "../src/session-recall.ts";
import { sdkFixture } from "./sdk-fixture.ts";

async function ready(recall: SessionRecall) {
	await recall.index.enumerate();
	for (let i = 0; i < 100; i++) if (recall.index.advance().done) return;
	assert.fail("fixture indexing did not finish");
}

test("search caps aggregate body, not just the size of each hit", async t => {
	const f = await sdkFixture(t);
	for (let i = 0; i < 8; i++) {
		const s = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
		s.appendMessage({ role: "user", content: "BODYBUDGET " + "🐈".repeat(3000), timestamp: i });
	}
	const r = new SessionRecall({ scope: { sessionDir: f.sessionManager.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const p = r.search("BODYBUDGET", { limit: 10 });
	assert.ok("groups" in p);
	assert.ok(p.groups.reduce((sum, g) => sum + [...g.snippet.text].length, 0) <= 12000);
	assert.ok(p.nextCursor, "budget-limited remaining groups need a continuation");
});

test("every read fragment is bounded and continuation reaches third and later entries", async t => {
	const f = await sdkFixture(t);
	const s = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	const bodies = ["small first", "second 猫🐈\n\t".repeat(1800), "third after the huge output", "fourth final"];
	const ids = bodies.map((content, timestamp) => s.appendMessage({ role: "user", content, timestamp }));
	const r = new SessionRecall({ scope: { sessionDir: s.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const reconstructed = new Map<string, string>();
	let entryId = ids[0], cursor: string | undefined;
	for (let n = 0; n < 100; n++) {
		const p = r.read(s.getSessionId(), entryId, cursor);
		assert.ok("fragments" in p, JSON.stringify(p));
		assert.ok(p.bodyChars <= 12000);
		for (const f of p.fragments) {
			assert.ok([...f.text].length <= 2000, "later fragments cannot bypass the per-fragment cap");
			const text = f.truncated && f.text.endsWith("…") ? f.text.slice(0, -1) : f.text;
			reconstructed.set(f.locator.entryId, (reconstructed.get(f.locator.entryId) ?? "") + text);
		}
		if (!p.nextCursor) break;
		cursor = p.nextCursor; entryId = p.nextEntryId ?? entryId;
		assert.ok(n < 99, "read must terminate");
	}
	assert.deepEqual(ids.map(id => reconstructed.get(id)), bodies);
});

test("raw read preserves whitespace and rejects malformed continuation instead of restarting", async t => {
	const f = await sdkFixture(t);
	const text = "  literal source\n\t  indentation 🐈\n\n";
	const id = f.sessionManager.appendMessage({ role: "user", content: text, timestamp: 1 });
	const r = new SessionRecall({ scope: { sessionDir: f.sessionManager.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const p = r.read(f.sessionManager.getSessionId(), id, undefined);
	assert.ok("fragments" in p);
	assert.equal(p.fragments[0].text, text);
	assert.ok("error" in r.read(f.sessionManager.getSessionId(), id, "not-a-cursor"));
});

test("search does not silently lose sessions after the first 1000 matching entries", async t => {
	const f = await sdkFixture(t);
	const early = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	for (let i = 0; i < 1002; i++) early.appendMessage({ role: "user", content: "SCANBOUND match", timestamp: i });
	const late = SessionManager.create(f.cwd, early.getSessionDir());
	late.appendMessage({ role: "user", content: "SCANBOUND late session", timestamp: 2000 });
	const r = new SessionRecall({ scope: { sessionDir: early.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const p = r.search("SCANBOUND", { limit: 10 });
	assert.ok("groups" in p);
	assert.ok(p.groups.some(g => g.locator.sessionId === late.getSessionId()));
});

test("divergent fork entries are not merged merely because another entry was copied", async t => {
	const f = await sdkFixture(t);
	const parent = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	parent.appendMessage({ role: "user", content: "shared prefix", timestamp: 1 });
	const id = parent.appendMessage({ role: "user", content: "FORKVALUE original decision", timestamp: 2 });
	const child = SessionManager.forkFrom(parent.getSessionFile()!, f.cwd, parent.getSessionDir());
	const file = child.getSessionFile()!;
	writeFileSync(file, readFileSync(file, "utf8").replace("FORKVALUE original decision", "FORKVALUE divergent decision"));
	const r = new SessionRecall({ scope: { sessionDir: parent.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const p = r.search("FORKVALUE", { limit: 10 });
	assert.ok("groups" in p);
	assert.equal(p.groups.length, 2);
	assert.deepEqual(new Set(p.groups.map(g => g.locator.sessionId)), new Set([parent.getSessionId(), child.getSessionId()]));
	assert.ok(p.groups.every(g => g.locator.entryId === id));
});

test("fork origin never promotes a different-cwd parent header into authorized provenance", async t => {
	const f = await sdkFixture(t);
	const parent = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	parent.appendMessage({ role: "user", content: "ORIGINSCOPE original", timestamp: 1 });
	const child = SessionManager.forkFrom(parent.getSessionFile()!, f.cwd, parent.getSessionDir());
	const foreign = SessionManager.create(join(f.agentDir, "home"), parent.getSessionDir());
	foreign.appendMessage({ role: "user", content: "private other project", timestamp: 2 });
	const file = child.getSessionFile()!;
	const rows = readFileSync(file, "utf8").split("\n");
	const header = JSON.parse(rows[0]); header.parentSession = foreign.getSessionFile(); rows[0] = JSON.stringify(header);
	writeFileSync(file, rows.join("\n"));
	const r = new SessionRecall({ scope: { sessionDir: parent.getSessionDir(), cwd: f.cwd } });
	await ready(r);
	const origin = r.originOf(file);
	assert.equal(origin.originUnknown, true);
	assert.notEqual(origin.originSessionId, foreign.getSessionId());
});

test("search continuation binds the native header identity as well as the selected entry", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	for (let i = 0; i < 3; i++) {
		const s = SessionManager.create(f.cwd, dir);
		s.appendMessage({ role: "user", content: "CURSORIDENTITY match", timestamp: i });
	}
	const r = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await ready(r);
	const first = r.search("CURSORIDENTITY", { limit: 1 });
	assert.ok("groups" in first && first.nextCursor);
	const file = first.groups[0].locator.sessionFile;
	const lines = readFileSync(file, "utf8").split("\n");
	const header = JSON.parse(lines[0]);
	header.id = SessionManager.create(f.cwd, dir).getSessionId();
	lines[0] = JSON.stringify(header); writeFileSync(file, lines.join("\n"));
	await ready(r);
	const resumed = r.search("CURSORIDENTITY", { limit: 1, cursor: first.nextCursor });
	assert.ok("error" in resumed, "same entry bytes in a replaced native session must not validate the old cursor");
});

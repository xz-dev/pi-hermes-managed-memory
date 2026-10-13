import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	FRAGMENT_MAX_CHARS, METADATA_MAX_CHARS, PAGE_BODY_MAX_CHARS,
	SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, SessionRecall,
} from "../src/session-recall.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;

async function recallReady(recall: SessionRecall) {
	let progress = await recall.index.enumerate();
	// Always run at least one advance(): its verification pass is what detects appends on
	// already-"indexed" files (enumerate alone reports done=true on stale state).
	for (let i = 0; i < 40; i++) {
		progress = recall.index.advance();
		if (progress.done) break;
	}
	return progress;
}
const scalars = (text: string) => [...text].length;

test("search default 3 / max 10 with genuine session+entry anchors and finite pagination", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	for (let i = 0; i < 7; i++) {
		const m = SessionManager.create(f.cwd, dir);
		m.appendMessage({ role: "user", content: `needle alpha session-${i}`, timestamp: i + 100 });
	}
	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);

	// Default 3: no limit argument.
	const first = recall.search("needle", {});
	assert.ok("groups" in first);
	assert.equal(first.groups.length, SEARCH_DEFAULT_LIMIT);
	assert.ok(first.groups.every(group => group.locator.sessionId && group.locator.entryId && group.locator.sessionFile.endsWith(".jsonl")));
	assert.equal(first.total, 7, "the 7 matching fixture sessions form 7 distinct groups");
	assert.ok(first.nextCursor);

	// limit clamp: above max collapses to 10, garbage falls back to the default.
	const clamped = recall.search("needle", { limit: 99 });
	const fallback = recall.search("needle", { limit: "junk" });
	assert.ok("groups" in clamped && "groups" in fallback);
	assert.ok(clamped.groups.length <= SEARCH_MAX_LIMIT);
	assert.equal(fallback.groups.length, SEARCH_DEFAULT_LIMIT);

	// Finite pagination over the deduplicated presentation: no repeats, exhaustion explicit.
	const seen: string[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 12; page++) {
		const result = recall.search("needle", { cursor });
		assert.ok("groups" in result, JSON.stringify(result));
		for (const group of result.groups) {
			const key = group.locator.sessionFile;
			assert.ok(!seen.includes(key), `copy ${key} reappeared on a later page`);
			seen.push(key);
		}
		cursor = result.nextCursor;
		if (!cursor) break;
	}
	assert.equal(seen.length, first.total, "pagination visits every distinct group exactly once");

	// No-hit is explicit, not empty-success-with-cursor.
	const miss = recall.search("definitely-absent-term", {});
	assert.ok("groups" in miss);
	assert.equal(miss.groups.length, 0);
	assert.equal(miss.total, 0);
	assert.equal(miss.nextCursor, undefined);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("two-generation native fork copies present once with truthful origin; unrelated equal text stays distinct", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	// Gen 0: origin session.
	const origin = SessionManager.create(f.cwd, dir);
	origin.appendMessage({ role: "user", content: "forkline shared copied marker", timestamp: 1 });
	const originFile = origin.getSessionFile()!;
	// Gen 1: fork copy in the same authorized collection (copies all entries, new header id).
	const gen1 = SessionManager.forkFrom(originFile, f.cwd, dir);
	gen1.appendMessage({ role: "user", content: "forkline gen1 unique child entry", timestamp: 2 });
	// Gen 2: fork of the fork.
	const gen2 = SessionManager.forkFrom(gen1.getSessionFile()!, f.cwd, dir);
	gen2.appendMessage({ role: "user", content: "forkline gen2 unique child entry", timestamp: 3 });
	// Unrelated session with EXACTLY equal text: must NOT merge.
	const unrelated = SessionManager.create(f.cwd, dir);
	unrelated.appendMessage({ role: "user", content: "forkline shared copied marker", timestamp: 4 });

	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	const page = recall.search("forkline", {});
	assert.ok("groups" in page, JSON.stringify(page));
	// Two groups: the fork lineage (deduped across 3 files) + the unrelated equal-text session.
	assert.equal(page.groups.length, 2, JSON.stringify(page.groups.map(group => group.locator.sessionFile)));
	const lineage = page.groups.find(group => group.matches === 3);
	const stranger = page.groups.find(group => group.matches === 1);
	assert.ok(lineage && stranger, "lineage group and unrelated group both present");
	assert.equal(lineage.matches, 3, "three distinct native entries; copied entry IDs/bytes count once");
	assert.equal(stranger.matches, 1, "unrelated equal-text session stays its own group");
	// Truthful provenance: the lineage group carries the VERIFIED native origin id.
	assert.equal(lineage.origin.originSessionId, origin.getSessionId());
	assert.equal(lineage.origin.originUnknown, false);
	assert.notEqual(stranger.origin.originSessionId, origin.getSessionId());
	// Divergent edits remain reachable: unique child entries still match in their own session.
	assert.ok("groups" in recall.search("gen1 unique child", {}));
	const child = recall.search("gen2 unique child", {});
	assert.ok("groups" in child && child.groups.length === 1);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("missing / outside / cyclic ancestry never creates a false origin or reads outside the collection", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	const origin = SessionManager.create(f.cwd, dir);
	origin.appendMessage({ role: "user", content: "chainline origin content", timestamp: 1 });
	const originFile = origin.getSessionFile()!;
	const child = SessionManager.forkFrom(originFile, f.cwd, dir);
	child.appendMessage({ role: "user", content: "chainline child content", timestamp: 2 });
	const childFile = child.getSessionFile()!;

	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	// Healthy chain first.
	assert.deepEqual(recall.originOf(childFile), { originSessionId: origin.getSessionId(), originUnknown: false, reason: undefined });
	// Outside-collection parent: fork into another root — the parent path is outside, so the
	// chain must report unknown WITHOUT opening the outside file.
	const outsideRoot = join(f.agentDir, "outside"), outsideDir = join(outsideRoot, "sessions");
	const outside = SessionManager.forkFrom(originFile, f.cwd, outsideDir);
	outside.appendMessage({ role: "user", content: "chainline outside content", timestamp: 3 });
	const outsideOrigin = recall.originOf(outside.getSessionFile()!);
	assert.equal(outsideOrigin.originUnknown, true);
	assert.match(outsideOrigin.reason ?? "", /outside-collection|source-unavailable/);
	// Missing parent: delete the origin file, then re-walk the child chain (fresh engine).
	const outsideBefore = readFileSync(outside.getSessionFile()!);
	const { rmSync } = await import("node:fs");
	rmSync(originFile);
	const fresh = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: join(f.agentDir, "ix1.jsonl") });
	await recallReady(fresh);
	const missing = fresh.originOf(childFile);
	assert.equal(missing.originUnknown, true);
	assert.match(missing.reason ?? "", /parent-unavailable/);
	// Cyclic ancestry: rewrite the child header's parentSession to point at the child itself.
	const { writeFileSync } = await import("node:fs");
	const lines = readFileSync(childFile, "utf8").split("\n").filter(Boolean);
	const header = JSON.parse(lines[0]);
	header.parentSession = childFile;
	lines[0] = JSON.stringify(header);
	writeFileSync(childFile, lines.join("\n") + "\n");
	const cycler = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd }, indexFile: join(f.agentDir, "ix2.jsonl") });
	await recallReady(cycler);
	const cyclic = cycler.originOf(childFile);
	assert.equal(cyclic.originUnknown, true);
	assert.match(cyclic.reason ?? "", /cyclic-ancestry/);
	assert.deepEqual(readFileSync(outside.getSessionFile()!), outsideBefore, "no read or write outside the collection");
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("huge tool-output entry: bounded fragments, exact Unicode boundaries, lossless continuation, page budget", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	// One entry with a body far above both caps, containing astral-plane scalars.
	const huge = "猫🐈 build log 𝕏 ".repeat(1500); // 7 scalars/rep ≈ 10500 scalars
	f.sessionManager.appendMessage({ role: "user", content: `HUGEREAD start ${huge} end`, timestamp: 1 });
	f.sessionManager.appendMessage({ role: "user", content: "HUGEREAD tail entry", timestamp: 2 });
	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	const hit = recall.index.search("HUGEREAD start").hits[0];
	assert.ok(hit);

	// First page: single fragment, strict 2000 budget INCLUDING the truncation marker.
	let page = recall.read(hit.sessionId, hit.entryId, undefined);
	assert.ok("fragments" in page, JSON.stringify(page));
	let collected = "";
	let calls = 0;
	let cursor: unknown = undefined;
	const expected = `HUGEREAD start ${huge} end`;
	for (;;) {
		const current = recall.read(hit.sessionId, hit.entryId, cursor);
		assert.ok("fragments" in current, JSON.stringify(current));
		for (const fragment of current.fragments) {
			const length = scalars(fragment.text);
			assert.ok(length <= FRAGMENT_MAX_CHARS, `fragment ${length} > ${FRAGMENT_MAX_CHARS}`);
			assert.ok(current.bodyChars <= PAGE_BODY_MAX_CHARS, `page body ${current.bodyChars} > ${PAGE_BODY_MAX_CHARS}`);
			if (fragment.truncated) {
				assert.ok(fragment.originalChars > scalars(fragment.text));
				assert.ok(fragment.text.endsWith("…"), "marker present");
			}
		}
		// bodyChars is a numeric count that agrees with the fragments.
		assert.equal(current.bodyChars, current.fragments.reduce((sum, fragment) => sum + scalars(fragment.text), 0));
		collected += current.fragments.filter(fragment => fragment.locator.entryId === hit.entryId)
			.map(fragment => fragment.truncated ? fragment.text.slice(0, -1) : fragment.text).join("");
		calls++;
		if (!current.nextCursor) break;
		cursor = current.nextCursor;
		assert.ok(calls < 100, "continuation must terminate");
	}
	// Lossless: continuation reconstructs the entry body with no gap and no repetition.
	assert.equal(collected, expected);
	// The tail entry is reachable as its own anchored read (finite progress past a huge entry).
	const tail = recall.index.search("HUGEREAD tail").hits[0];
	const tailRead = recall.read(tail.sessionId, tail.entryId, undefined);
	assert.ok("fragments" in tailRead);
	assert.match(tailRead.fragments[0].text, /HUGEREAD tail entry/);
	// Page budget actually stops multi-entry pages with an explicit cursor.
	const big = recall.read(tail.sessionId, hit.entryId, undefined);
	assert.ok("fragments" in big);
	assert.ok(big.bodyChars <= PAGE_BODY_MAX_CHARS);
	if (big.fragments.length > 1) assert.ok(big.nextCursor);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("metadata stays bounded and separate: no raw bodies, tool arguments, fork lists or whole entries leak", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	const secretBody = "METAHIDE secret body content ".repeat(300);
	f.sessionManager.appendMessage({ role: "user", content: secretBody, timestamp: 1 });
	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	const page = recall.search("METAHIDE", {});
	assert.ok("groups" in page);
	const group = page.groups[0];
	// Snippet is a bounded fragment, not the whole body.
	assert.ok(scalars(group.snippet.text) <= FRAGMENT_MAX_CHARS);
	assert.ok(group.snippet.truncated);
	assert.equal(group.snippet.originalChars, scalars(secretBody));
	// Catalog is metadata-only: no bodies at all.
	const catalog = recall.sessions();
	for (const session of catalog) {
		assert.ok(!JSON.stringify(session).includes("secret body content"), "catalog must not carry bodies");
		assert.equal(typeof session.entries, "number");
	}
	// Errors are bounded metadata, never a raw corpus dump.
	const refused = recall.read("no-such-session", "no-such-entry", undefined);
	assert.ok("error" in refused);
	assert.ok(scalars(refused.error) <= METADATA_MAX_CHARS + 100, "error string itself stays bounded");
	// A forged cursor is refused, never a read permission.
	const forged = Buffer.from(JSON.stringify({ v: 1, sessionId: "x", entryId: "y", offset: 0, digest: "z" }), "utf8").toString("base64url");
	const denied = recall.read("no-such-session", "no-such-entry", forged);
	assert.ok("error" in denied);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("changed source invalidates stale pages; ordinary host appends keep unchanged history pagination valid", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	const first = f.sessionManager.appendMessage({ role: "user", content: "STALEPAGE first history entry ".repeat(600), timestamp: 1 });
	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	const page1 = recall.read(f.sessionManager.getSessionId(), first, undefined);
	assert.ok("fragments" in page1);

	// Ordinary append of a LATER message: the earlier entry's read must still work unchanged.
	f.sessionManager.appendMessage({ role: "user", content: "STALEPAGE later appended message", timestamp: 2 });
	await recallReady(recall);
	const page2 = recall.read(f.sessionManager.getSessionId(), first, undefined);
	assert.ok("fragments" in page2, JSON.stringify(page2));
	if ("fragments" in page2) {
		assert.equal(page2.fragments[0].text, page1.fragments[0].text);
		assert.equal(page2.fragments[0].locator.entryId, first);
	}
	// A cursor emitted before the append remains valid for the unchanged entry.
	assert.ok(page1.nextCursor, "the pre-append page must actually require continuation");
	const resumed = recall.read(f.sessionManager.getSessionId(), first, page1.nextCursor);
	assert.ok("fragments" in resumed, JSON.stringify(resumed));

	// Changing the entry itself invalidates an old cursor with an explicit restart.
	const bigEntry = f.sessionManager.appendMessage({ role: "user", content: "STALEPAGE mutable ".repeat(1000), timestamp: 3 });
	await recallReady(recall);
	const mutable = recall.read(f.sessionManager.getSessionId(), bigEntry, undefined);
	assert.ok("fragments" in mutable && mutable.nextCursor, "long entry emits a continuation cursor");
	f.session.dispose();
	const { writeFileSync } = await import("node:fs");
	const file = f.sessionManager.getSessionFile()!;
	writeFileSync(file, readFileSync(file, "utf8").replace("STALEPAGE mutable ", "STALEPAGE mutated "));
	// Re-preparation rebuilds the changed source; the OLD cursor must then fail the digest check.
	await recallReady(recall);
	const stale = recall.read(f.sessionManager.getSessionId(), bigEntry, mutable.nextCursor);
	assert.ok("error" in stale, "changed entry body must invalidate the old cursor");
	assert.match(stale.error, /stale-cursor/);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

test("read refuses cross-target cursors and out-of-scope/corrupt locators without side effects", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	const a = f.sessionManager.appendMessage({ role: "user", content: "CURSORX target entry body ".repeat(800), timestamp: 1 });
	const b = SessionManager.create(f.cwd, dir);
	const other = b.appendMessage({ role: "user", content: "CURSORX other session entry", timestamp: 2 });
	const recall = new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } });
	await recallReady(recall);
	const page = recall.read(f.sessionManager.getSessionId(), a, undefined);
	assert.ok("fragments" in page && page.nextCursor);
	// Cursor names entry A but is presented against entry B: refused.
	const mismatch = recall.read(b.getSessionId(), other, page.nextCursor);
	assert.ok("error" in mismatch);
	assert.match(mismatch.error, /cursor-target-mismatch/);
	// Malformed cursors must be refused, never silently treated as a fresh read.
	for (const bad of ["!!!not-base64!!!", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, sessionId: a, entryId: a, offset: -5, digest: "x" })]) {
		const attempt = recall.read(f.sessionManager.getSessionId(), a, bad === "!!!not-base64!!!" ? bad : Buffer.from(bad).toString("base64url"));
		assert.ok("error" in attempt);
	}
	// Unknown session/entry pair is an explicit unavailable.
	const unavailable = recall.read("00000000-0000-4000-8000-000000000000", "deadbeef", undefined);
	assert.ok("error" in unavailable);
	assert.match(unavailable.error, /unavailable/);
	assert.equal(f.faux.state.callCount, 0);
	assert.deepEqual(f.errors, []);
});

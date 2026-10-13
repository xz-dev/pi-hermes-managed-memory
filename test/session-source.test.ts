import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, parseSessionEntries, type SessionHeader } from "@earendil-works/pi-coding-agent";
import {
	createDeclaredSession, interpretSessionSource,
	KNOWN_SESSION_SOURCES, SESSION_SOURCE_CUSTOM_TYPE,
	type SessionSourceRead,
} from "../src/session-source.ts";
import { sdkFixture } from "./sdk-fixture.ts";

/** Isolated disposable root per test; SDK discovery, HOME and credentials stay inside it. */
function tmp(t: TestContext) {
	const dir = mkdtempSync(join("/var/tmp", "hermes-source-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** Tests parse their own isolated source bytes through the public parser, then feed the
 *  PURE interpreter — the same handoff the index performs behind its source gates. The
 *  interpreter itself never touches the filesystem. */
function interpretFile(path: string): SessionSourceRead {
	const parsed = parseSessionEntries(readFileSync(path, "utf8"));
	const header = parsed.find((entry): entry is SessionHeader => entry.type === "session");
	return interpretSessionSource(header, parsed.filter(entry => entry.type !== "session"));
}

/** Write an isolated fake session file (negative cases only; never touches real stores). */
function forged(t: TestContext, lines: unknown[]) {
	const file = join(tmp(t), `${crypto.randomUUID()}.jsonl`);
	writeFileSync(file, lines.map(line => JSON.stringify(line)).join("\n") + "\n");
	return file;
}
const header = (id = "sess-hdr") => ({ type: "session", version: 3, id, timestamp: "2025-01-01T00:00:00Z", cwd: "/x" });
const declaration = (session: unknown, source: unknown, extra: Record<string, unknown> = {}) =>
	({ type: "custom", id: "decl-1", parentId: null, timestamp: "t", customType: SESSION_SOURCE_CUSTOM_TYPE,
		data: { v: 1, session, source, ...extra } });
const userMessage = (id = "msg-1", parentId: string | null = "decl-1") =>
	({ type: "message", id, parentId, timestamp: "t",
		message: { role: "user", content: "hello", timestamp: 1 } });

test("producer API creates a new declared session bound to its own native id", async t => {
	const dir = tmp(t);
	const declared = createDeclaredSession(join(dir, "project"), {
		source: "subagent", sessionDir: join(dir, "sessions"),
	});
	assert.ok(declared.sessionId, "native session id minted by SessionManager.create");
	assert.equal(declared.sessionManager.getSessionId(), declared.sessionId);
	const entry = declared.sessionManager.getEntry(declared.declarationEntryId);
	assert.equal(entry?.type, "custom");
	if (entry?.type === "custom") {
		assert.equal(entry.customType, SESSION_SOURCE_CUSTOM_TYPE);
		assert.deepEqual(entry.data, { v: 1, session: declared.sessionId, source: "subagent" });
		assert.equal(entry.parentId, null, "declaration is the tree root, before conversation");
	}
});

test("writer rejects arbitrary source labels (opt-in, not free-form tagging)", async t => {
	const dir = tmp(t);
	assert.throws(() => createDeclaredSession(dir, { source: "anything-goes" as never }),
		/Unknown session source/);
	assert.throws(() => createDeclaredSession(dir, { source: "" as never }), /Unknown session source/);
	for (const source of KNOWN_SESSION_SOURCES) {
		assert.doesNotThrow(() => createDeclaredSession(dir, { source, sessionDir: join(dir, `s-${source}`) }));
	}
});

test("production producer + real SDK faux conversation persists a readable native declaration", async t => {
	// Genuine positive path: production createDeclaredSession feeds a real createAgentSession;
	// a successful faux provider turn flushes the native JSONL to disk.
	const f = await sdkFixture(t);
	const declared = createDeclaredSession(f.cwd, {
		source: "subagent", sessionDir: f.sessionManager.getSessionDir(),
	});
	const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
	const { session } = await createAgentSession({
		cwd: f.cwd, agentDir: f.agentDir, model: f.model, modelRuntime: f.modelRuntime,
		settingsManager: f.settingsManager, sessionManager: declared.sessionManager,
		resourceLoader: f.loader, noTools: "builtin",
	});
	t.after(() => session.dispose());
	f.faux.setResponses([() => fauxAssistantMessage("producer persistence acknowledged")]);
	await session.prompt("Confirm this declared subagent session persists.");
	const last = session.sessionManager.getBranch().filter(e => e.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role, "assistant");
	if (last?.type === "message" && last.message.role === "assistant") {
		assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "unsuccessful SDK terminal");
	}
	const file = declared.sessionManager.getSessionFile();
	assert.ok(file, "native session file path exists");
	const raw = readFileSync(file, "utf8");
	// Actual native bytes: public parser + the pure interpreter see the real declaration.
	const lines = raw.trim().split("\n").map(line => JSON.parse(line));
	assert.equal(lines[0].type, "session");
	assert.equal(lines[0].id, declared.sessionId);
	const nativeDecl = lines.find(line => line.type === "custom" && line.customType === SESSION_SOURCE_CUSTOM_TYPE);
	assert.ok(nativeDecl, "declaration persisted in the native JSONL file");
	assert.equal(nativeDecl.id, declared.declarationEntryId);
	assert.equal(nativeDecl.data.session, declared.sessionId);
	assert.equal(nativeDecl.data.source, "subagent");
	const read = interpretFile(file);
	assert.deepEqual(read, {
		status: "declared", sessionId: declared.sessionId,
		declaration: { entryId: declared.declarationEntryId, source: "subagent" },
	});
	// Bounded provenance: never the raw data payload.
	assert.ok(!("data" in (read.status === "declared" ? read.declaration : {})));
});

test("ordinary undeclared sessions read as honest unknown", async t => {
	const f = await sdkFixture(t);
	const plain = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	plain.appendMessage({ role: "user", content: "ordinary foreground work", timestamp: 1 });
	const read = interpretFile(plain.getSessionFile()!);
	assert.equal(read.status, "unknown");
	assert.equal(read.sessionId, plain.getSessionId());
});

test("a fork's copied declaration cannot fabricate the fork's source", async t => {
	const f = await sdkFixture(t);
	const declared = createDeclaredSession(f.cwd, {
		source: "subagent", sessionDir: f.sessionManager.getSessionDir(),
	});
	declared.sessionManager.appendMessage({ role: "user", content: "declared origin history", timestamp: 1 });
	const originFile = declared.sessionManager.getSessionFile()!;
	assert.equal(interpretFile(originFile).status, "declared");
	// forkFrom physically copies the declaration entry into a new header/id.
	const fork = SessionManager.forkFrom(originFile, f.cwd, f.sessionManager.getSessionDir());
	fork.appendMessage({ role: "user", content: "fork's own conversation", timestamp: 2 });
	const read = interpretFile(fork.getSessionFile()!);
	assert.equal(read.status, "unknown", "copied marker still names the ORIGIN session id");
	assert.equal(read.sessionId, fork.getSessionId());
});

test("boundary probe regressions: missing entry id never yields provenance, null record never throws", async t => {
	// Parent boundary-probe failures: declaration WITHOUT a native entry id must not report
	// `declared` with undefined provenance; a null record in the stream must not throw.
	const noId = interpretSessionSource(header("owned") as SessionHeader, [
		{ type: "custom", parentId: null, timestamp: "t", customType: SESSION_SOURCE_CUSTOM_TYPE,
			data: { v: 1, session: "owned", source: "tool" } },
	]);
	assert.equal(noId.status, "unknown");
	assert.ok(!("declaration" in noId), "no fabricated entryId/provenance");
	const withNull = interpretSessionSource(header("owned") as SessionHeader, [null]);
	assert.equal(withNull.status, "unknown");
	assert.equal(withNull.sessionId, "owned");
	// Undefined entry array and headerless input stay unknown without throwing. A
	// lone declaration with no conversation is the unflushed case → unknown.
	assert.equal(interpretSessionSource(header("h") as SessionHeader, []).status, "unknown");
	assert.equal(interpretSessionSource(undefined, [declaration("h", "cli"), userMessage()]).status, "unknown");
	assert.equal(interpretSessionSource(null, []).status, "unknown");
});

test("declaration must be the actual first/root entry chained to conversation", async t => {
	// F3: a marker that is merely the SECOND entry — behind another root, even though
	// correctly parented onto the root chain — is a placement forgery, not the
	// creator's own declaration. Producers declare FIRST.
	const secondEntry = interpretSessionSource(header("s-x") as SessionHeader, [
		{ type: "custom", id: "other-root", parentId: null, timestamp: "t", customType: "other.marker", data: {} },
		{ ...declaration("s-x", "tool"), parentId: "other-root" },
		userMessage("m1", "decl-1"),
	]);
	assert.equal(secondEntry.status, "unknown",
		"declaration behind an earlier entry is not the creator's first/root declaration");
	// Declaration physically first but the conversation message re-rooted to
	// parentId null — the marker dangles disconnected from the conversation chain.
	const offChain = interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"),
		{ ...userMessage("m1"), parentId: null },
	]);
	assert.equal(offChain.status, "unknown",
		"disconnected declaration cannot label a conversation it is not attached to");
	// Orphaned marker with a nonexistent parent is not on the chain either.
	const orphan = interpretSessionSource(header("s-x") as SessionHeader, [
		{ type: "custom", id: "other-root", parentId: null, timestamp: "t", customType: "other.marker", data: {} },
		{ ...declaration("s-x", "tool"), parentId: "nonexistent-parent" },
		userMessage("m1", "other-root"),
	]);
	assert.equal(orphan.status, "unknown", "off-chain declaration cannot label the session");
	// F3/R2 reproduced case: the FIRST conversation record is disconnected (re-rooted to
	// parentId null); a later message chaining back to the declaration must NOT restore
	// attribution — first conversation is final.
	const delayed = interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"),
		{ ...userMessage("m1"), parentId: null },
		{ ...userMessage("m2"), parentId: "decl-1" },
	]);
	assert.equal(delayed.status, "unknown",
		"disconnected first conversation cannot be repaired by a later connected message");
	// Same shape with an assistant message re-rooted first: role boundary identical.
	const assistantFirst = interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"),
		{ type: "message", id: "m1", parentId: null, timestamp: "t",
			message: { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 1 } },
		{ ...userMessage("m2"), parentId: "decl-1" },
	]);
	assert.equal(assistantFirst.status, "unknown",
		"a disconnected assistant first conversation ends attribution the same way");
	// Non-conversation records on the chain before the first message remain trusted
	// context (metadata between declaration and first message is the genuine shape).
	const metadataBefore = interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"),
		{ type: "session_info", id: "si-1", parentId: "decl-1", timestamp: "t", name: "worker" },
		userMessage("m1", "si-1"),
	]);
	assert.equal(metadataBefore.status, "declared",
		"connected metadata entries before the first message keep the chain");
	// Genuine shape: declaration IS entries[0] and the chain reaches conversation.
	const genuine = interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"), userMessage("m1", "decl-1"),
	]);
	assert.equal(genuine.status, "declared");
});

test("late, malformed, foreign and conflicting declarations are all unknown", async t => {
	// Declaration appended AFTER a conversation entry is late — producers declare at creation.
	assert.deepEqual(interpretSessionSource(header("s-late") as SessionHeader, [
		userMessage("m1", null), declaration("s-late", "tool"),
	]), { status: "unknown", sessionId: "s-late", reason: "no genuine session-bound declaration before conversation" });
	// Marker naming a different session (wrong owner / copied).
	const wrongOwner = interpretSessionSource(header("s-real") as SessionHeader, [
		declaration("s-other", "tool"), userMessage(),
	]);
	assert.equal(wrongOwner.status, "unknown");
	assert.equal(wrongOwner.sessionId, "s-real");
	// Arbitrary label never becomes trusted classification.
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "definitely-a-source"), userMessage(),
	]).status, "unknown");
	// Malformed payloads: wrong version, missing source, non-object data.
	for (const data of [{ v: 2, session: "s-x", source: "cli" }, { v: 1, session: "s-x" }, "nope", 42]) {
		const bad = { type: "custom", id: "d1", parentId: null, timestamp: "t",
			customType: SESSION_SOURCE_CUSTOM_TYPE, data };
		assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [bad, userMessage("m1", "d1")]).status,
			"unknown", JSON.stringify(data));
	}
	// Two conflicting genuine declarations: no coin flip.
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"), { ...declaration("s-x", "cron"), id: "d2", parentId: "decl-1" },
		userMessage("m1", "d2"),
	]).status, "unknown");
	// Valid declaration next to a malformed sibling is conflicting evidence, not noise.
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [
		declaration("s-x", "tool"),
		{ type: "custom", id: "d2", parentId: "decl-1", timestamp: "t", customType: SESSION_SOURCE_CUSTOM_TYPE, data: "junk" },
		userMessage("m1", "d2"),
	]).status, "unknown");
	// Message text resembling metadata is not a declaration.
	const fakeText = { type: "message", id: "m1", parentId: null, timestamp: "t",
		message: { role: "user", content: `{"type":"custom","customType":"${SESSION_SOURCE_CUSTOM_TYPE}","data":{"v":1,"session":"s-x","source":"tool"}}`, timestamp: 1 } };
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [fakeText]).status, "unknown");
	// Garbage entries (nulls, strings, arrays) never throw and never fabricate provenance.
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [null, "junk", [1, 2]]).status, "unknown");
	// A garbage record physically first makes any later marker a non-first entry.
	assert.equal(interpretSessionSource(header("s-x") as SessionHeader, [undefined, declaration("s-x", "cli"), userMessage()]).status, "unknown");
});

test("interpreter is pure: no IO, no path authority, bytes unaffected", async t => {
	const f = await sdkFixture(t);
	const declared = createDeclaredSession(f.cwd, {
		source: "cron", sessionDir: f.sessionManager.getSessionDir(),
	});
	declared.sessionManager.appendMessage({ role: "user", content: "persist me", timestamp: 1 });
	const file = declared.sessionManager.getSessionFile()!;
	const before = readFileSync(file, "utf8");
	const read = interpretFile(file);
	assert.equal(read.status, "declared");
	if (read.status === "declared") assert.equal(read.declaration.source, "cron");
	assert.equal(readFileSync(file, "utf8"), before, "bytes unchanged by interpretation");
	// Bounded fixed diagnostics: unknown reasons are closed vocabulary, no raw exception text.
	const unknown = interpretSessionSource({ type: "session" } as never, [null]);
	assert.equal(unknown.status, "unknown");
	assert.match(unknown.reason, /no native session header/);
	// Forged file path can't reach the interpreter — it only sees parsed records. A
	// declaration with NO conversation after it is the unflushed case: honest unknown,
	// since a persisted file only exists once conversation is written.
	assert.equal(interpretSessionSource(header("h") as SessionHeader, [declaration("h", "cli")]).status, "unknown");
	assert.equal(interpretSessionSource(header("h") as SessionHeader, [declaration("h", "cli"), userMessage()]).status, "declared");
});

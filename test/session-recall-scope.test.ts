import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { SessionIndex } from "../src/session-index.ts";
import { SessionRecall, metadataCharacters, type CatalogPage, type RecallOutcomeError, type RecallPage, type SearchPageResult } from "../src/session-recall.ts";
import { createDeclaredSession } from "../src/session-source.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
const tmp = (t: TestContext) => { const d = mkdtempSync(join("/var/tmp", "hermes-scope-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

async function ready(index: SessionIndex) {
	await index.enumerate();
	for (let i = 0; i < 30; i++) { const p = index.advance(); if (p.done) return p; }
	throw new Error("index never became ready");
}
async function prepared(recall: SessionRecall) { await recall.prepare(); return recall; }

/** Persist a minimal session in an explicit collection dir (native JSONL, real SDK). */
function persistedSession(cwd: string, sessionDir: string, texts: string[], stamp = 1) {
	mkdirSync(cwd, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
	const manager = SessionManager.create(cwd, sessionDir);
	for (const [i, text] of texts.entries()) {
		manager.appendMessage({ role: "user", content: text, timestamp: stamp + i });
	}
	assert.ok(manager.getSessionFile(), "session persisted natively");
	return manager;
}

/** Session ids of every native file in a collection (test-side reading of our own
 *  isolated fixture bytes — never real stores). */
function readdirSessions(dir: string): string[] {
	return readdirSync(dir).filter(n => n.endsWith(".jsonl"))
		.map(n => JSON.parse(readFileSync(join(dir, n), "utf8").split("\n")[0]).id);
}

type Payload = Partial<RecallPage & SearchPageResult & CatalogPage> & {
	status: string; mode: string; scope?: string; metadataChars: number;
	filters?: { hiddenSources: string[]; demotedSources: string[]; hidden: number };
	groups?: { locator: { sessionId: string; sessionFile: string; collection: string; source: string } }[];
	sessions?: { sessionId: string; sessionFile: string; collection: string; cwd: string; source: string }[];
};
const toolTexts = (f: Fixture, name: string) => f.sessionManager.getBranch()
	.filter(e => e.type === "message").filter(e => e.message.role === "toolResult" && e.message.toolName === name)
	.map(e => e.message.role === "toolResult" ? e.message.content.filter(b => b.type === "text").map(b => b.text).join("") : "");

/** Registered-tool invocation over real faux turns. Requests captured OUTSIDE the
 *  provider callback; exact foreground dispatch count asserted per call. */
async function invoke(f: Fixture, args: Parameters<typeof fauxToolCall>[1], expectedRequests = 2): Promise<{ payload: Payload; request: unknown }> {
	const before = f.faux.state.callCount;
	let actualRequest: unknown;
	f.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("hermes_session_search", args), { stopReason: "toolUse" }),
		context => { actualRequest = structuredClone(context.messages); return fauxAssistantMessage("recall fixture complete"); },
	]);
	await f.session.prompt("Continue the foreground recall fixture.");
	const last = f.sessionManager.getBranch().filter(e => e.type === "message").at(-1);
	assert.equal(last?.type === "message" && last.message.role === "assistant" ? last.message.stopReason : "missing", "stop");
	assert.equal(f.faux.state.callCount - before, expectedRequests, "exact foreground dispatches: tool call + reply, no auxiliary/model fallback");
	const text = toolTexts(f, "hermes_session_search").at(-1)!;
	return { payload: JSON.parse(text), request: actualRequest };
}

test("default project scope stays inside the current collection; explicit project scope spans the native store", async t => {
	const f = await sdkFixture(t);
	const hostDir = f.sessionManager.getSessionDir();
	// Same keyword in a DIFFERENT project collection of the same native store.
	const otherCwd = join(f.agentDir, "other-project"); 
	const otherDir = join(f.agentDir, "sessions", "--other-project--");
	const other = persistedSession(otherCwd, otherDir, ["shared-keyword from project B"]);
	const mine = persistedSession(f.cwd, hostDir, ["shared-keyword from project A"]);

	const def = await prepared(new SessionRecall({ scope: { sessionDir: hostDir, cwd: f.cwd } }));
	const dsearch = def.search("shared-keyword") as SearchPageResult;
	assert.equal(dsearch.total, 1);
	assert.equal(dsearch.groups[0].locator.sessionId, mine.getSessionId());
	assert.equal(dsearch.groups[0].locator.collection, hostDir);
	assert.equal(dsearch.groups[0].locator.source, "unknown");
	// Bare B id under default scope: unavailable, never a fallback.
	const dread = def.read(other.getSessionId());
	assert.ok("error" in dread, JSON.stringify(dread));

	// Explicit cross-project scope = the native store (root + its direct collections).
	const wide = await prepared(new SessionRecall({ scope: {
		sessionDir: join(f.agentDir, "sessions"),
		collections: [join(f.agentDir, "sessions"), hostDir, otherDir],
		cwd: undefined,
	} }));
	const wsearch = wide.search("shared-keyword", { limit: 10 }) as SearchPageResult;
	assert.equal(wsearch.total, 2);
	const ids = wsearch.groups.map(g => g.locator.sessionId).sort();
	assert.deepEqual(ids, [mine.getSessionId(), other.getSessionId()].sort());
	for (const g of wsearch.groups) {
		assert.ok(g.locator.sessionFile.startsWith(g.locator.collection));
		assert.equal(typeof g.locator.source, "string");
		assert.equal(g.origin.originUnknown, false);
	}
	// Genuine cwd/file/time metadata per group.
	const bHit = wsearch.groups.find(g => g.locator.sessionId === other.getSessionId())!;
	assert.equal(bHit.locator.collection, otherDir);
	assert.ok(bHit.locator.timestamp);
	// Explicit scoped read of B works under the wide scope.
	const bread = wide.read(other.getSessionId());
	assert.ok(!("error" in bread), JSON.stringify(bread));
	assert.ok(bread.fragments.length >= 1);
	// Explainable filters on every page.
	assert.deepEqual(wsearch.filters.hiddenSources, ["kanban", "subagent", "tool"]);
	assert.deepEqual(wsearch.filters.demotedSources, ["cron"]);
});

test("project-descendant cwd matches; unrelated cwd and symlink escape do not", async t => {
	const f = await sdkFixture(t);
	const sessionsRoot = join(f.agentDir, "sessions");
	const hostDir = f.sessionManager.getSessionDir();
	const descCwd = join(f.cwd, "nested", "deeper");
	const descDir = join(sessionsRoot, "desc-coll");
	const desc = persistedSession(descCwd, descDir, ["descendant project hit"]);
	const unrelCwd = join(f.agentDir, "unrelated");
	const unrelDir = join(sessionsRoot, "unrel-coll");
	persistedSession(unrelCwd, unrelDir, ["unrelated project hit"]);
	persistedSession(f.cwd, hostDir, ["current project hit"]);

	const project = await prepared(new SessionRecall({ scope: {
		sessionDir: sessionsRoot, collections: [sessionsRoot, hostDir, descDir, unrelDir],
		cwd: f.cwd, cwdMode: "project",
	} }));
	const page = project.search("project hit", { limit: 10 }) as SearchPageResult;
	const found = page.groups.map(g => g.locator.sessionId);
	assert.ok(found.includes(desc.getSessionId()), "canonical descendant cwd is inside the project");
	assert.equal(found.length, 2, "current + descendant only");
	const catalog = project.catalog({ limit: 10 }) as CatalogPage;
	assert.ok(catalog.sessions.every(s => s.cwd === f.cwd || s.cwd.startsWith(f.cwd + "/")), "catalog cwd is project-bounded");
	// Unrelated cwd session not eligible; its id cannot be read either.
	for (const id of readdirSessions(unrelDir)) assert.ok("error" in project.read(id), `unrelated session ${id} refused`);

	// Symlink escape: an alias inside a collection pointing outside must never be read.
	const outside = persistedSession(unrelCwd, join(tmp(t), "outside-coll"), ["escaped body"]);
	const alias = join(hostDir, "escape.jsonl");
	symlinkSync(outside.getSessionFile()!, alias);
	const fenced = await prepared(new SessionRecall({ scope: { sessionDir: hostDir, cwd: f.cwd } }));
	assert.ok("error" in fenced.read(outside.getSessionId()));
	const progress = fenced.progress();
	assert.ok(progress.filesUnavailable >= 1, "symlink alias tracked as unavailable, not read");
});

test("declared sources filter search/catalog; cron demoted; explicit read still opens hidden ids", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	// Production producer API for every label — real native declarations, not hand-labelled.
	const mk = (source: "cli" | "kanban" | "subagent" | "tool" | "cron", text: string) => {
		const d = createDeclaredSession(f.cwd, { source, sessionDir: dir });
		d.sessionManager.appendMessage({ role: "user", content: text, timestamp: 1 });
		return d;
	};
	const declIds = new Map<string, string>();
	for (const [source, text] of [["cli","noise-marker interactive cli"],["kanban","noise-marker kanban worker"],
		["subagent","noise-marker subagent run"],["tool","noise-marker tool integration"],["cron","noise-marker cron job"]] as const) {
		declIds.set(source, mk(source, text).sessionId);
	}
	persistedSession(f.cwd, dir, ["noise-marker ordinary unknown session"]);

	const recall = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const page = recall.search("noise-marker", { limit: 10 }) as SearchPageResult;
	const sources = page.groups.map(g => g.locator.source);
	assert.ok(!sources.includes("kanban") && !sources.includes("subagent") && !sources.includes("tool"),
		`hidden sources absent from search: ${sources}`);
	assert.equal(page.filters.hidden, 3, "three declared noise sessions hidden");
	// Cron retained but demoted behind cli + unknown.
	assert.deepEqual(sources, ["cli", "unknown", "cron"]);
	const catalog = recall.catalog({ limit: 10 }) as CatalogPage;
	const catSources = catalog.sessions.map(s => s.source);
	assert.ok(!catSources.includes("kanban") && !catSources.includes("subagent") && !catSources.includes("tool"));
	assert.equal(catalog.filters.hidden, 3);
	// Read by id follows Hermes: hidden-source sessions remain directly readable in scope.
	for (const [source, id] of declIds) {
		const read = recall.read(id);
		assert.ok(!("error" in read), `declared ${source} session readable by id: ${JSON.stringify(read)}`);
	}
	// A fork that physically copies the declaration is NOT labelled: copied marker
	// names the origin id (producer boundary — no fabricated fork source).
	const subFile = readdirSync(dir).filter(n => n.endsWith(".jsonl"))
		.map(n => join(dir, n))
		.find(p => JSON.parse(readFileSync(p, "utf8").split("\n")[0]).id === declIds.get("subagent"))!;
	const fork = SessionManager.forkFrom(subFile, f.cwd, dir);
	fork.appendMessage({ role: "user", content: "fork noise-marker copy", timestamp: 9 });
	const again = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const forkPage = again.search("fork noise-marker", { limit: 10 }) as SearchPageResult;
	assert.equal(forkPage.groups.every(g => g.locator.source !== "subagent"), true,
		"copied declaration cannot label the fork (binds origin id)");
});

test("cross-scope cursors are refused; same-scope continuation still works", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	for (let i = 0; i < 6; i++) persistedSession(f.cwd, dir, [`pageable history ${i}`], i + 1);
	const narrow = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const first = narrow.catalog({ limit: 2 }) as CatalogPage;
	assert.ok(first.nextCursor, "paginated catalog mints a cursor");
	// A different authorized scope must not accept the narrower cursor.
	const wide = await prepared(new SessionRecall({ scope: {
		sessionDir: join(f.agentDir, "sessions"), collections: [join(f.agentDir, "sessions"), dir], cwd: f.cwd } }));
	const refused = wide.catalog({ cursor: first.nextCursor });
	assert.ok("error" in refused && /scope|invalid|stale/.test(refused.error), JSON.stringify(refused));
	const refusedSearch = wide.search("pageable", { cursor: first.nextCursor });
	assert.ok("error" in refusedSearch);
	// Same instance continues fine.
	const next = narrow.catalog({ cursor: first.nextCursor }) as CatalogPage;
	assert.ok(!("error" in next), "same-scope cursor still valid");
	assert.ok(next.sessions.length >= 1);
});

test("registered tool: default hides other projects, scope=project searches the store; immutability + guidance", async t => {
	const boundaries: { leaf: string | null; bytes: string }[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		pi.on("tool_call", (event, ctx) => {
			if (event.toolName === "hermes_session_search") boundaries.push({ leaf: ctx.sessionManager.getLeafId(), bytes: readFileSync(ctx.sessionManager.getSessionFile()!, "utf8") });
		});
		pi.on("tool_result", (event, ctx) => {
			if (event.toolName === "hermes_session_search") boundaries.push({ leaf: ctx.sessionManager.getLeafId(), bytes: readFileSync(ctx.sessionManager.getSessionFile()!, "utf8") });
		});
	}] });
	// Project B in a second collection of the SAME native store (cwd OUTSIDE project A:
	// scope=project searches the store, project-cwd narrowing applies to default only).
	const otherDir = join(f.agentDir, "sessions", "coll-b");
	const b = persistedSession(join(f.agentDir, "b"), otherDir, ["unique-marker from B"]);
	const collA = f.sessionManager.getSessionDir();
	const a = persistedSession(f.cwd, collA, ["unique-marker from A"]);
	const narrow = await invoke(f, { query: "unique-marker" });
	assert.equal(narrow.payload.mode, "search");
	assert.equal(narrow.payload.scope, "default");
	// Host collection is its own project dir: A is in-scope, B stays hidden.
	assert.equal(narrow.payload.total, 1, "default project scope hides B");
	assert.equal(narrow.payload.groups![0].locator.sessionId, a.getSessionId());
	assert.equal(narrow.payload.groups![0].locator.collection, collA);
	assert.deepEqual(narrow.payload.filters!.hiddenSources, ["kanban", "subagent", "tool"]);
	// scope=project widens to the native store without project-cwd narrowing; project
	// descendants are already covered by the earlier index-level test.
	const wide = await invoke(f, { query: "unique-marker", scope: "project" });
	assert.equal(wide.payload.scope, "project");
	assert.equal(wide.payload.total, 2, "explicit cross-project sees both collections");
	const colls = wide.payload.groups!.map(g => g.locator.collection).sort();
	assert.deepEqual(colls, [otherDir, f.sessionManager.getSessionDir()].sort());
	// Model-visible guidance: tool description reaches the next request's tool schema.
	const reqText = JSON.stringify(wide.request);
	assert.match(reqText, /Search earlier work|earlier work/, "guidance is model-visible through the public tool API");
	// Wrong-scope id under default: explicit refusal.
	const miss = await invoke(f, { sessionId: b.getSessionId() });
	assert.equal(miss.payload.status, "unavailable", JSON.stringify(miss.payload));
	// Main session leaf/bytes unchanged around every retrieval; source bytes untouched.
	const srcBefore = readFileSync(b.getSessionFile()!, "utf8");
	for (let i = 0; i < boundaries.length; i += 2) {
		assert.equal(boundaries[i].leaf, boundaries[i + 1].leaf, "main leaf unmoved");
		assert.equal(boundaries[i].bytes, boundaries[i + 1].bytes, "main session bytes untouched");
	}
	assert.equal(readFileSync(b.getSessionFile()!, "utf8"), srcBefore, "B source bytes immutable");
});

test("no-hit query: exact foreground dispatch count, no auxiliary calls, history stays reference-only", async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	const before = f.faux.state.callCount;
	const { payload, request } = await invoke(f, { query: "absolutely-no-such-term-zz9" });
	assert.equal(payload.mode, "search");
	assert.equal(payload.total, 0);
	assert.equal(payload.status, "ok");
	assert.equal(f.faux.state.callCount - before, 2, "exactly two foreground dispatches incl. no-hit; no auxiliary/model/remote fallback");
	// Next request carries the tool result as historical reference — no injected user instruction.
	const messages = request as { role?: string }[];
	const lastUserIdx = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0).at(-1)!;
	const toolIdx = messages.findIndex(m => m.role === "toolResult");
	assert.ok(toolIdx > 0, "tool result present in request");
	assert.ok(lastUserIdx < toolIdx, "no new user-role content injected after retrieval");
	assert.equal(messages.filter(m => m.role === "user").length, 1, "single real user turn; recall adds toolResult only");
});

test("one global staged budget across project collections", async t => {
	const f = await sdkFixture(t);
	const root = join(f.agentDir, "sessions");
	const collA = join(root, "ca"), collB = join(root, "cb");
	persistedSession(f.cwd, collA, ["budget-marker " + "a".repeat(4000)]);
	persistedSession(join(f.agentDir, "b"), collB, ["budget-marker " + "b".repeat(4000)]);
	const index = new SessionIndex({ scope: { sessionDir: root, collections: [root, collA, collB] }, batchBytes: 1024 });
	await index.enumerate();
	const p = index.advance();
	assert.ok(p.stagedBytes <= 1024, `one advance() stages ≤1024B across all collections, got ${p.stagedBytes}`);
	assert.equal(p.done, false, "two 4KB files cannot complete in one 1KB budget");
	let steps = 1;
	while (!index.advance().done && steps++ < 40);
	assert.ok(steps > 1, "multi-collection corpus respects the shared budget, not per-project");
	assert.equal(index.search("budget-marker").total, 2);
});
test("metadata limits and provenance boundedness hold under scope", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	persistedSession(f.cwd, dir, ["bounded marker " + "x".repeat(3000)], 1);
	const recall = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const page = recall.search("bounded marker", { limit: 5 }) as SearchPageResult;
	assert.ok(metadataCharacters(page) <= 12000, "metadata envelope bounded");
	for (const g of page.groups) {
		assert.equal(typeof g.locator.collection, "string");
		assert.equal(typeof g.locator.source, "string");
		assert.equal(typeof g.locator.cwd, "string", "per-result validated-header cwd");
		assert.ok(!JSON.stringify(g).includes('"data"'), "no declaration payload leaks into locators");
	}
});

test("F1: explicit exact mode never grants project containment; standalone cwd alone stays exact", async t => {
	const f = await sdkFixture(t);
	const dir = f.sessionManager.getSessionDir();
	persistedSession(join(f.cwd, "descendant"), dir, ["descendant-marker"]);
	persistedSession(f.cwd, dir, ["exact-marker"]);
	// cwd alone (no mode) → exact semantics: descendant excluded.
	const exact = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	assert.equal((exact.search("marker", { limit: 10 }) as SearchPageResult).total, 1, "cwd alone must not acquire project containment");
	// Explicit project mode → descendant included.
	const project = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd, cwdMode: "project" } }));
	assert.equal((project.search("marker", { limit: 10 }) as SearchPageResult).total, 2);
});

test("F2: cached path deeper than flat selected collection is never adopted or read", async t => {
	const f = await sdkFixture(t);
	const root = join(f.agentDir, "sessions"), selected = join(root, "selected"), deeper = join(selected, "deeper");
	const m = persistedSession(f.cwd, deeper, ["cached-deep-body-marker"]);
	const cache = join(f.agentDir, "deep-ix.jsonl");
	const { writeFileSync } = await import("node:fs");
	writeFileSync(cache, JSON.stringify({ v: 3, kind: "file", path: m.getSessionFile(), sessionId: m.getSessionId() }) + "\n");
	const index = new SessionIndex({ scope: { sessionDir: root, collections: [root, selected] }, indexFile: cache });
	await index.enumerate();
	const progress = index.advance();
	assert.equal(progress.stagedBytes, 0, "cached deeper path must not stage body bytes");
	assert.equal(progress.decodedBytes, 0);
	assert.ok(!readFileSync(cache, "utf8").includes("cached-deep-body-marker"));
	assert.equal(index.search("cached-deep-body-marker").total, 0);
});

test("F5: declared-source mutation invalidates a minted search cursor", async t => {
	const f = await sdkFixture(t);
	const dir = join(f.agentDir, "cursor-coll");
	const base = createDeclaredSession(f.cwd, { source: "cron", sessionDir: dir });
	base.sessionManager.appendMessage({ role: "user", content: "policy-marker base", timestamp: 1 });
	persistedSession(f.cwd, dir, ["policy-marker plain"]);
	const recall = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const first = recall.search("policy-marker", { limit: 1 }) as SearchPageResult;
	assert.ok(first.nextCursor);
	// Mutate ONLY the declaration source label; matched entry/header bytes unchanged.
	const file = base.sessionManager.getSessionFile()!;
	const lines = readFileSync(file, "utf8").trim().split("\n").map((l: string) => JSON.parse(l));
	lines[1].data.source = "cli";
	writeFileSync(file, lines.map(x => JSON.stringify(x)).join("\n") + "\n");
	await prepared(recall);
	const resumed = recall.search("policy-marker", { limit: 1, cursor: first.nextCursor });
	assert.ok("error" in resumed && /stale-cursor/.test(resumed.error), JSON.stringify(resumed));
});

test("F7: engine re-creation after a new collection appears is honest, not stale", async t => {
	const f = await sdkFixture(t);
	const root = join(f.agentDir, "sessions");
	// Key includes the live collection list — the registered binding refreshes it
	// per call, so a new collection dir changes scope identity and invalidates
	// cached cursors instead of silently missing the new history.
	const early = persistedSession(f.cwd, join(root, "early"), ["early-marker"]);
	const before = await prepared(new SessionRecall({ scope: { sessionDir: root, collections: [root, join(root, "early")] } }));
	assert.equal((before.search("marker", { limit: 10 }) as SearchPageResult).total, 1);
	const late = persistedSession(join(f.agentDir, "late-proj"), join(root, "late"), ["late-marker"]);
	const after = await prepared(new SessionRecall({ scope: { sessionDir: root, collections: [root, join(root, "early"), join(root, "late")] } }));
	const afterPage = after.search("marker", { limit: 10 }) as SearchPageResult;
	assert.equal(afterPage.total, 2, "new direct project collection reachable");
});

test("R1: derived-cache alias anywhere inside an authorized source tree is refused", async t => {
	const f = await sdkFixture(t);
	const store = join(f.agentDir, "sessions"), selected = join(store, "selected"), deeper = join(selected, "deeper");
	mkdirSync(deeper, { recursive: true });
	// Canonical target exists but is EMPTY and lives deep inside an authorized
	// collection; the lexical alias lives outside. Whole-tree protection must
	// refuse even though flat read-membership never authorized the target.
	const target = join(deeper, "empty-target.jsonl");
	writeFileSync(target, "");
	const alias = join(f.agentDir, "outside-cache.jsonl");
	symlinkSync(target, alias);
	for (const collections of [[store, selected], [selected]]) {
		let error: unknown;
		try { new SessionIndex({ scope: { sessionDir: store, collections }, indexFile: alias }); }
		catch (e) { error = e; }
		assert.ok(error instanceof Error, `alias must be refused for collections ${JSON.stringify(collections)}`);
	}
	// A real cache-shaped body deep inside the collection is refused too.
	const cacheShaped = join(deeper, "cache-shaped.jsonl");
	writeFileSync(cacheShaped, JSON.stringify({ v: 3, kind: "file", path: "x", sessionId: "y" }) + "\n");
	const alias2 = join(f.agentDir, "outside-cache-2.jsonl");
	symlinkSync(cacheShaped, alias2);
	assert.throws(() => new SessionIndex({ scope: { sessionDir: store, collections: [store, selected] }, indexFile: alias2 }),
		/authorized session collection|aliases a source/);
	// Sanity: flat READ membership still only covers direct files — the deeper
	// empty target is never treated as a source either.
	assert.equal(new SessionIndex({ scope: { sessionDir: selected } }).search("empty-target").total, 0);
});

test("R1 inverse: cache WRITE LOCATION inside a source collection is refused even when the symlink target is external", async t => {
	const f = await sdkFixture(t);
	const store = join(f.agentDir, "inv-sessions");
	mkdirSync(store, { recursive: true });
	// Inverse of the outgoing-alias case: the lexical cache path lives INSIDE the
	// collection while its canonical target is a legitimate external derived cache.
	// Write fence must refuse — temp/rename/reset files would mutate the tree.
	const external = join(f.agentDir, "external-derived.jsonl");
	writeFileSync(external, "");
	const alias = join(store, "cache-alias.jsonl");
	symlinkSync(external, alias);
	assert.throws(() => new SessionIndex({ scope: { sessionDir: store }, indexFile: alias }),
		/authorized session collection/, "empty external target must not unblock an in-tree write location");
	const external2 = join(f.agentDir, "external-derived-2.jsonl");
	writeFileSync(external2, JSON.stringify({ v: 3, kind: "file", path: "x", sessionId: "y" }) + "\n");
	const aliasB = join(store, "cache-alias-b.jsonl");
	symlinkSync(external2, aliasB);
	assert.throws(() => new SessionIndex({ scope: { sessionDir: store }, indexFile: aliasB }),
		/authorized session collection/, "cache-shaped external target must not unblock an in-tree write location");
});

test("R3: catalog continuation binds non-anchor hidden/visible classification changes", async t => {
	const f = await sdkFixture(t);
	const dir = join(f.agentDir, "catalog-coll");
	const hidden = createDeclaredSession(f.cwd, { source: "tool", sessionDir: dir });
	hidden.sessionManager.appendMessage({ role: "user", content: "catalog-marker", timestamp: 1 });
	const a = createDeclaredSession(f.cwd, { source: "cli", sessionDir: dir });
	a.sessionManager.appendMessage({ role: "user", content: "catalog-marker A", timestamp: 2 });
	const b = createDeclaredSession(f.cwd, { source: "cli", sessionDir: dir });
	b.sessionManager.appendMessage({ role: "user", content: "catalog-marker B", timestamp: 3 });
	const d = createDeclaredSession(f.cwd, { source: "cli", sessionDir: dir });
	d.sessionManager.appendMessage({ role: "user", content: "catalog-marker C", timestamp: 4 });
	const recall = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const first = recall.catalog({ limit: 1 }) as CatalogPage;
	assert.ok(first.nextCursor && first.sessions[0].sessionId === a.sessionId);
	// hidden→visible on a NON-anchor session invalidates the cursor.
	const file = hidden.sessionManager.getSessionFile()!;
	const lines = readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l));
	lines[1].data.source = "cli";
	writeFileSync(file, lines.map(x => JSON.stringify(x)).join("\n") + "\n");
	await prepared(recall);
	const resumed = recall.catalog({ limit: 10, cursor: first.nextCursor });
	assert.ok("error" in resumed && /stale-cursor/.test(resumed.error), JSON.stringify(resumed));

	// visible→hidden on a NON-anchor row is equally stale. Anchor of the fresh
	// page is its first row; demote a different visible session so the anchor
	// itself still resolves — only the classification tuple changed.
	const file2 = a.sessionManager.getSessionFile()!;
	const lines2 = readFileSync(file2, "utf8").trim().split("\n").map(l => JSON.parse(l));
	lines2[1].data.source = "tool";
	writeFileSync(file2, lines2.map(x => JSON.stringify(x)).join("\n") + "\n");
	await prepared(recall);
	const fresh = recall.catalog({ limit: 1 }) as CatalogPage;
	const anchorId = fresh.sessions[0].sessionId;
	const nonAnchor = [b, d].find(s => s.sessionId !== anchorId)!;
	const file3 = nonAnchor.sessionManager.getSessionFile()!;
	const lines3 = readFileSync(file3, "utf8").trim().split("\n").map(l => JSON.parse(l));
	assert.notEqual(lines3[1].data.source, "tool", "non-anchor must currently be visible");
	lines3[1].data.source = "tool";  // demote a non-anchor session after cursor mint
	writeFileSync(file3, lines3.map(x => JSON.stringify(x)).join("\n") + "\n");
	await prepared(recall);
	const stale = recall.catalog({ limit: 10, cursor: fresh.nextCursor }) as CatalogPage | RecallOutcomeError;
	assert.ok("error" in stale && /stale-cursor/.test(stale.error), JSON.stringify(stale));

	// unchanged historical append keeps catalog pagination valid.
	const recall2 = await prepared(new SessionRecall({ scope: { sessionDir: dir, cwd: f.cwd } }));
	const page = recall2.catalog({ limit: 1 }) as CatalogPage;
	assert.ok(page.nextCursor);
	a.sessionManager.appendMessage({ role: "user", content: "appended tail body", timestamp: 4 });
	await prepared(recall2);
	const cont = recall2.catalog({ limit: 10, cursor: page.nextCursor }) as CatalogPage;
	assert.ok(!("error" in cont), `unchanged append must keep catalog continuation valid: ${JSON.stringify(cont)}`);
});

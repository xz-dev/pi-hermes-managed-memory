import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { metadataCharacters, type RecallPage, type SearchPageResult, type CatalogPage } from "../src/session-recall.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
/** Successful native terminal asserted OUTSIDE provider callbacks (4.1 lesson). */
async function promptSucceeded(session: Fixture["session"], text: string) {
	await session.prompt(text);
	const last = session.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "unsuccessful SDK terminal");
}
const toolResults = (f: Fixture, toolName: string) =>
	f.sessionManager.getBranch().filter(entry => entry.type === "message").filter(entry => entry.message.role === "toolResult" &&
		entry.message.toolName === toolName);

type Payload = Partial<RecallPage & SearchPageResult & CatalogPage> & { status: string; mode: string; metadataChars: number };
function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value && typeof value === "object") return Object.values(value).flatMap(strings);
	return [];
}
async function invoke(f: Fixture, args: Parameters<typeof fauxToolCall>[1]): Promise<Payload> {
	const before = f.faux.state.callCount;
	let actualRequest: unknown;
	f.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("hermes_session_search", args), { stopReason: "toolUse" }),
		context => { actualRequest = structuredClone(context.messages); return fauxAssistantMessage("recall fixture complete"); },
	]);
	await promptSucceeded(f.session, "Continue the foreground recall fixture.");
	assert.equal(f.faux.state.callCount - before, 2, "one tool request + one successful foreground reply, no auxiliary calls");
	const last = toolResults(f, "hermes_session_search").at(-1)!;
	assert.equal(last.message.role, "toolResult");
	if (last.message.role !== "toolResult") assert.fail("missing native tool result");
	assert.equal(last.message.isError, false, JSON.stringify(last.message.content));
	const text = last.message.content.filter(block => block.type === "text").map(block => block.text).join("");
	assert.ok(strings(actualRequest).includes(text), "actual following model request contains the exact tool result");
	const payload: Payload = JSON.parse(text);
	assert.ok(["ok", "partial"].includes(payload.status), text);
	assert.equal(payload.metadataChars, metadataCharacters(payload));
	assert.ok(payload.metadataChars + [...JSON.stringify(last.message.details)].length <= 12000);
	assert.deepEqual(f.errors, []);
	return payload;
}

test("registered tool searches an archive and losslessly reads through normal foreground appends", async t => {
	const boundaries: { when: string; leaf: string | null; bytes: string }[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
		pi.on("tool_call", (event, ctx) => {
			if (event.toolName === "hermes_session_search") boundaries.push({ when: "before", leaf: ctx.sessionManager.getLeafId(),
				bytes: readFileSync(ctx.sessionManager.getSessionFile()!, "utf8") });
		});
		pi.on("tool_result", (event, ctx) => {
			if (event.toolName === "hermes_session_search") boundaries.push({ when: "after", leaf: ctx.sessionManager.getLeafId(),
				bytes: readFileSync(ctx.sessionManager.getSessionFile()!, "utf8") });
		});
	}] });
	const archive = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
	archive.appendMessage({ role: "user", content: "Earlier deploy discussion", timestamp: 1 });
	const huge = "ARCHIVED-BUILD-OUTPUT\n\t  🐈 preserve indentation and blank lines\n\n".repeat(700) + "literal final …";
	const ids = [archive.appendMessage({ role: "toolResult", toolCallId: "archived-build", toolName: "build",
		content: [{ type: "text", text: huge }], details: { privateFixtureField: "NOT-A-METADATA-BODY".repeat(3000) },
		isError: false, timestamp: 2 }),
		archive.appendMessage({ role: "user", content: "third message\n  exact spacing", timestamp: 3 }),
		archive.appendMessage({ role: "user", content: "fourth message\tfinal", timestamp: 4 })];
	const expected = [huge, "third message\n  exact spacing", "fourth message\tfinal"];
	const file = archive.getSessionFile()!, bytes = readFileSync(file), leaf = archive.getLeafId();
	const search = await invoke(f, { query: "ARCHIVED-BUILD-OUTPUT" });
	assert.equal(search.mode, "search");
	assert.equal(search.total, 1);
	const group = search.groups![0];
	assert.equal(group.locator.sessionId, archive.getSessionId());
	assert.equal(group.locator.entryId, ids[0]);
	assert.equal(group.locator.sessionFile, file);
	assert.equal(group.snippet.originalChars, [...huge].length);
	assert.ok(group.snippet.truncated);
	assert.ok([...group.snippet.text].length <= 2000);
	const collected = new Map<string, string>();
	let cursor: string | undefined, pages = 0, maximumFragment = 0, maximumPageBody = 0;
	do {
		const page = await invoke(f, { sessionId: archive.getSessionId(), entryId: ids[0], ...(cursor ? { cursor } : {}) });
		assert.equal(page.mode, "read");
		assert.ok(page.fragments?.length);
		assert.equal(page.bodyChars, page.fragments.reduce((n, part) => n + [...part.text].length, 0));
		assert.ok(page.bodyChars <= 12000);
		maximumPageBody = Math.max(maximumPageBody, page.bodyChars);
		for (const part of page.fragments) {
			maximumFragment = Math.max(maximumFragment, [...part.text].length);
			assert.ok([...part.text].length <= 2000);
			const body = part.truncated ? part.text.slice(0, -1) : part.text;
			collected.set(part.locator.entryId, (collected.get(part.locator.entryId) ?? "") + body);
		}
		assert.ok(!JSON.stringify(page).includes("NOT-A-METADATA-BODY"));
		cursor = page.nextCursor;
		assert.ok(++pages < 20, "continuation must progress and terminate");
	} while (cursor);
	assert.ok(pages > 1, "huge output really exercised continuation");
	assert.deepEqual(ids.map(id => collected.get(id)), expected, "expected text comes from fixture literals, not the index/renderer");
	assert.deepEqual(readFileSync(file), bytes);
	assert.equal(archive.getLeafId(), leaf);
	const again = await invoke(f, { query: "ARCHIVED-BUILD-OUTPUT" });
	assert.equal(again.total, 1, "the current live query/results do not recursively become recall hits");
	assert.equal(boundaries.length, (pages + 2) * 2);
	for (let i = 0; i < boundaries.length; i += 2) {
		assert.equal(boundaries[i].when, "before"); assert.equal(boundaries[i + 1].when, "after");
		assert.equal(boundaries[i].leaf, boundaries[i + 1].leaf, "plugin does not move the main leaf");
		assert.equal(boundaries[i].bytes, boundaries[i + 1].bytes, "plugin does not write native chat/source files");
	}
	t.diagnostic(JSON.stringify({ archiveSession: archive.getSessionId(), selectedEntry: ids[0],
		sourceBodyChars: [...huge].length, pages, maximumFragment, maximumPageBody,
		foregroundDispatches: f.faux.state.callCount, auxiliaryDispatches: 0,
		checkedNativeReadOnlyBoundaries: boundaries.length / 2 }));
});

test("registered catalog is paginated and metadata cannot echo an enormous query", async t => {
	const f = await sdkFixture(t, { extensions: [createMemoryExtension()] });
	const expected = new Set<string>();
	for (let i = 0; i < 8; i++) {
		const s = SessionManager.create(f.cwd, f.sessionManager.getSessionDir());
		s.appendMessage({ role: "user", content: "catalog fixture", timestamp: i }); expected.add(s.getSessionId());
	}
	const seen: string[] = []; let cursor: string | undefined;
	for (let n = 0; n < 10; n++) {
		const page = await invoke(f, cursor ? { cursor } : {});
		assert.equal(page.mode, "catalog"); assert.ok(page.sessions && page.sessions.length <= 3);
		seen.push(...page.sessions.map(s => s.sessionId));
		cursor = page.nextCursor; if (!cursor) break;
		assert.ok(n < 9);
	}
	assert.equal(seen.length, 8); assert.deepEqual(new Set(seen), expected);
	const query = "absent-query-".repeat(2000);
	const miss = await invoke(f, { query });
	assert.equal(miss.total, 0);
	assert.ok(!JSON.stringify(miss).includes(query));
});

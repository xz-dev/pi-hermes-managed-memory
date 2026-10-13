import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, getCurrentSystemPrompt, getCurrentTools, Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

function extension(options: MemoryOptions = {}) {
	return createMemoryExtension({ ...options, projectRoot: join(getAgentDir(), "project") });
}
function reported(content: string): AssistantMessage { return fauxAssistantMessage(content); }
async function learningFixture(t: TestContext, options: MemoryOptions = {}) {
	return sdkFixture(t, {
		models: [{ id: "learning-faux", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 } }],
		extensions: [pi => {
			pi.registerTool({ name: "fixture_read", label: "Read", description: "Readonly fixture declaration",
				parameters: Type.Object({}), execute: async () => { throw new Error("Review must not execute a tool"); } });
			pi.on("before_agent_start", event => { event.systemPromptOptions.sections.fixture_reference = "other-extension-stable-prefix"; });
			pi.on("context", event => { event.messages.push({ role: "user", content: "ephemeral-transformed-context", timestamp: 123 }); });
			extension(options)(pi);
		}],
	});
}
function assertPriced(record: ReturnType<ReviewLedger["status"]>[number]): void {
	assert.ok(record.costEstimate! > 0);
	assert.equal(record.costBasis, "model-table-estimate");
	const usage = record.usage!;
	assert.ok(usage.input !== undefined && usage.output !== undefined && usage.cacheRead !== undefined && usage.cacheWrite !== undefined);
	assert.equal(record.costEstimate, (usage.input + usage.output * 2 + usage.cacheRead * 0.1 + usage.cacheWrite * 0.2) / 1e6);
}
function userEntry(f: Awaited<ReturnType<typeof sdkFixture>>): string {
	const user = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1);
	assert.ok(user); return user.id;
}

test("actual extension saves sourced facts and a new session recalls them on the same billed request", async t => {
	const f = await learningFixture(t);
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("I prefer concise answers. This project uses pnpm.");
	const entry = userEntry(f);
	const sourceFile = f.sessionManager.getSessionFile();
	assert.ok(sourceFile);
	const before = readFileSync(sourceFile);
	const leaf = f.sessionManager.getLeafId();
	let inspected: { prompt: string; messages: string; tools: string[]; maxRetries?: number; maxTokens?: number; signal: boolean } | undefined;
	f.faux.setResponses([(_context, options) => {
		inspected = { prompt: getCurrentSystemPrompt(_context.messages), messages: JSON.stringify(_context.messages),
			tools: getCurrentTools(_context.messages).map(tool => tool.name), maxRetries: options?.maxRetries,
			maxTokens: options?.maxTokens, signal: !!options?.signal };
		return reported(JSON.stringify({ candidates: [
			{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry },
			{ kind: "project-fact", fact: "This project uses pnpm.", quote: "This project uses pnpm.", entry },
		] }));
	}]);
	await f.session.prompt("/hermes-review run");
	assert.ok(inspected);
	assert.match(inspected.prompt, /other-extension-stable-prefix/);
	assert.match(inspected.messages, /ephemeral-transformed-context/);
	assert.match(inspected.messages, /acknowledged/);
	assert.deepEqual(inspected.tools, ["fixture_read", "hermes_memory", "hermes_session_search"]);
	assert.equal(inspected.maxRetries, 0);
	assert.equal(inspected.maxTokens, 4096);
	assert.equal(inspected.signal, true);
	assert.equal(f.faux.state.callCount, 2, "one foreground request and exactly one independent review");
	assert.deepEqual(readFileSync(sourceFile), before);
	assert.equal(f.sessionManager.getLeafId(), leaf);
	const store = new MemoryStore(f.agentDir, join(f.agentDir, "project"));
	assert.equal(store.read("user").entries[0].fact, "I prefer concise answers.");
	assert.equal(store.read("project").entries[0].fact, "This project uses pnpm.");
	const source = store.read("user").entries[0].source;
	assert.ok("session" in source);
	assert.equal(source.session, f.sessionManager.getSessionId());
	assert.equal(source.entry, entry);
	const ledger = new ReviewLedger(f.agentDir);
	const saved = ledger.status()[0];
	assert.equal(saved.status, "saved");
	assert.deepEqual(saved.phases, ["admitted", "saved"]);
	assert.equal(saved.usageState, "reported");
	assert.ok(saved.input! > 0);
	assert.ok(saved.output! > 0);
	assert.equal(saved.input, saved.usage!.totalTokens! - saved.usage!.output!);
	assert.equal(saved.output, saved.usage!.output);
	assert.equal(saved.usage?.cacheRead, 0);
	assertPriced(saved);
	assert.equal(saved.saved.length, 2);

	// Same settled endpoint cannot silently incur a second review request.
	await f.session.prompt("/hermes-review run");
	assert.equal(f.faux.state.callCount, 2);
	assert.equal(ledger.status()[1].status, "skipped");
	assert.equal(ledger.status()[1].reason, "duplicate-snapshot");

	f.session.dispose();
	await f.loader.reload();
	const { session } = await createAgentSession({
		cwd: f.cwd, agentDir: f.agentDir, model: f.model, modelRuntime: f.modelRuntime,
		settingsManager: f.settingsManager, resourceLoader: f.loader, noTools: "all",
		sessionManager: SessionManager.create(f.cwd, join(f.agentDir, "sessions")),
	});
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "json" });
	f.faux.setResponses([context => {
		const prompt = getCurrentSystemPrompt(context.messages);
		assert.match(prompt, /I prefer concise answers/);
		assert.match(prompt, /This project uses pnpm/);
		assert.match(prompt, /Current user instructions take precedence/);
		assert.match(prompt, /\[user version=/);
		assert.match(prompt, /\[project version=/);
		return fauxAssistantMessage("used scoped memory");
	}]);
	await session.prompt("Explain the next step in detail.");
	const recalled = ledger.status()[0];
	assert.equal(recalled.id, saved.id);
	assert.equal(recalled.status, "saved");
	assert.equal(recalled.costEstimate, saved.costEstimate);
	assert.deepEqual(recalled.phases, ["admitted", "saved", "recalled"]);
	assert.equal(recalled.recalls[0].session, session.sessionManager.getSessionId());
	assert.deepEqual(new Set(recalled.recalls[0].ids), new Set(saved.saved));
	assert.equal(ledger.status().filter(record => record.usageState !== "not-sent").length, 1);
	assert.deepEqual(f.errors, []);
});

for (const rejection of ["capacity", "editor"] as const) {
	test(`production review ${rejection} rejection settles once without paid consolidation`, async t => {
		const f = await learningFixture(t, rejection === "capacity" ? { caps: { user: 100 } } : {});
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt("I prefer concise answers.");
		const entry = userEntry(f), store = new MemoryStore(f.agentDir, f.cwd);
		const manual = "Manual authoritative note.\n";
		f.faux.setResponses([() => {
			if (rejection === "editor") {
				mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
				writeFileSync(store.path("user"), manual);
			}
			return reported(JSON.stringify({ candidates: [{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry }] }));
		}]);
		await f.session.prompt("/hermes-review run");
		assert.equal(f.faux.state.callCount, 2, "one foreground and one review, no consolidation/retry");
		const record = new ReviewLedger(f.agentDir).status()[0];
		assert.equal(record.status, "conflict"); assert.equal(record.usageState, "reported"); assertPriced(record);
		assert.equal(record.commits?.[0].status, rejection === "capacity" ? "rejected" : "conflict");
		assert.equal(store.read("user").raw, rejection === "capacity" ? "" : manual);
	});
}

test("budget skip is distinct from charged no-proposal and never calls a fallback", async t => {
	const f = await learningFixture(t, { limits: { input: 128, output: 64, dailyInput: 512, dailyOutput: 256 } });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("I prefer concise answers.");
	await f.session.prompt("/hermes-review run");
	const record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "skipped");
	assert.equal(record.usageState, "not-sent");
	assert.equal(record.reason, "input-budget");
	assert.deepEqual(record.phases, ["skipped"]);
	assert.equal(f.faux.state.callCount, 1);
	assert.equal(existsSync(join(f.agentDir, "hermes-memory", "USER.md")), false);
});

test("empty and invalid proposals retain one request's usage without saving guessed facts", async t => {
	const f = await learningFixture(t);
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("This time do not deploy.");
	f.faux.setResponses([reported(JSON.stringify({ candidates: [] }))]);
	await f.session.prompt("/hermes-review run");
	const first = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(first.status, "no-proposal");
	assert.deepEqual(first.phases, ["admitted", "no-proposal"]);
	assertPriced(first);
	assert.equal(f.faux.state.callCount, 2);
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("I prefer concise answers.");
	f.faux.setResponses([reported(JSON.stringify({ candidates: [
		{ kind: "preference", fact: "The user is impatient.", quote: "I prefer concise answers.", entry: userEntry(f) },
	] }))]);
	await f.session.prompt("/hermes-review run");
	const last = new ReviewLedger(f.agentDir).status().at(-1);
	assert.equal(last?.status, "no-proposal");
	assert.equal(last?.reason, "proposal-validation");
	assert.ok(last);
	assertPriced(last);
	assert.equal(f.faux.state.callCount, 4);
	assert.equal(existsSync(join(f.agentDir, "hermes-memory", "USER.md")), false);
});

test("an editor race records conflict and preserves the edited authoritative file", async t => {
	const f = await learningFixture(t);
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("I prefer concise answers.");
	const entry = userEntry(f);
	const path = join(f.agentDir, "hermes-memory", "USER.md");
	f.faux.setResponses([() => {
		mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
		writeFileSync(path, "User-authored correction.\n");
		return reported(JSON.stringify({ candidates: [
			{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry },
		] }));
	}]);
	await f.session.prompt("/hermes-review run");
	const record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "conflict");
	assert.deepEqual(record.phases, ["admitted", "conflict"]);
	assertPriced(record);
	assert.equal(record.saved.length, 0);
	assert.equal(readFileSync(path, "utf8"), "User-authored correction.\n");
	assert.equal(f.faux.state.callCount, 2);
});

test("an unpriced SDK response remains cost-unknown rather than a zero-cost request", async t => {
	const f = await sdkFixture(t, { extensions: [pi => extension()(pi)] });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("Ordinary work with no stable fact.");
	f.faux.setResponses([reported(JSON.stringify({ candidates: [] }))]);
	await f.session.prompt("/hermes-review run");
	const record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "no-proposal");
	assert.equal(record.usageState, "reported");
	assert.ok(record.input! > 0);
	assert.equal(record.costBasis, "unknown");
	assert.equal(record.costEstimate, undefined);
	assert.equal(record.usage?.cost?.total, 0, "SDK placeholder is retained, not described as a free request");
	assert.equal(f.faux.state.callCount, 2);
	assert.deepEqual(f.errors, []);
});

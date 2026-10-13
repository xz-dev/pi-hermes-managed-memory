import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, Type, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { reviewLines, type ReviewOverview } from "../src/review-display.ts";
import type { ReviewSchedule } from "../src/review-schedule.ts";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
type Request = { context: TranscriptContext; options?: SimpleStreamOptions; auxiliary: boolean };
function isReview(context: TranscriptContext): boolean {
	const last = context.messages.at(-1);
	return last?.role === "user" && typeof last.content === "string" && last.content.includes('"instruction":"Review the existing effective snapshot.');
}
async function until(check: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
	assert.ok(check(), label);
}
async function promptSucceeded(f: Fixture, text: string): Promise<void> {
	await f.session.prompt(text);
	const last = f.sessionManager.getBranch().filter(entry => entry.type === "message").at(-1);
	assert.equal(last?.message.role, "assistant", "native terminal must be assistant");
	if (last?.message.role === "assistant") assert.equal(last.message.stopReason, "stop", last.message.errorMessage ?? "native foreground failed");
}
function capture(requests: Request[], answer = "foreground ok") {
	return (context: TranscriptContext, options: SimpleStreamOptions | undefined) => {
		const auxiliary = isReview(context);
		requests.push({ context: structuredClone(context), options, auxiliary });
		return fauxAssistantMessage(auxiliary ? '{"candidates":[]}' : answer);
	};
}
async function fixture(t: TestContext, options: MemoryOptions = {}, before: ExtensionFactory = () => {}) {
	return sdkFixture(t, { automaticReview: true, settings: { compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 0 } }, extensions: [pi => {
		before(pi);
		if (!options.projectRoot) options.projectRoot = join(getAgentDir(), "project");
		createMemoryExtension(options)(pi);
	}] });
}
async function work(f: Fixture, requests: Request[], count: number, prefix = "Work"): Promise<void> {
	// setResponses replaces queued steps, NOT cumulative callCount (Pi0.99.2).
	f.faux.setResponses(Array.from({ length: count + 1 }, () => capture(requests)));
	for (let n = 1; n <= count; n++) await promptSucceeded(f, `${prefix} ${n}.`);
}
async function status(f: Fixture): Promise<ReviewOverview & { schedule: ReviewSchedule }> {
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await f.session.prompt("/hermes-review status"); } finally { process.stdout.write = write; }
	return JSON.parse(output.join("").trim()).detail;
}
function nativeState(f: Fixture) {
	return { bytes: readFileSync(f.sessionManager.getSessionFile()!), leaf: f.sessionManager.getLeafId(),
		messages: JSON.stringify(f.session.messages), entries: JSON.stringify(f.sessionManager.getEntries()) };
}

test("default tenth native settlement dispatches once, does not await delayed review, and survives duplicate settlement/reload", async t => {
	const f = await fixture(t);
	const requests: Request[] = [];
	await work(f, requests, 9);
	assert.equal(requests.filter(r => !r.auxiliary).length, 9);
	assert.equal(requests.filter(r => r.auxiliary).length, 0);
	assert.equal((await status(f)).schedule.progress, 9);
	let release!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
	const delayed = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) });
		return delayed;
	}]);
	try {
		await Promise.race([promptSucceeded(f, "Work ten."), new Promise<never>((_resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("foreground waited for review")), 1500); timeout.unref();
		})]);
		await until(() => requests.some(r => r.auxiliary), "tenth settlement must submit auxiliary request");
		const ledger = new ReviewLedger(f.agentDir);
		assert.equal(ledger.status().length, 1);
		assert.equal(ledger.status()[0].trigger, "settled");
		assert.equal(ledger.status()[0].status, "admitted", "foreground finishes before review response exists");
		const before = nativeState(f);
		release(fauxAssistantMessage('{"candidates":[]}'));
		await until(() => ledger.status()[0].status === "no-proposal", "review must settle accounting");
		assert.deepEqual(nativeState(f), before, "background result never writes native chat/entries or moves leaf");
		assert.equal(requests.filter(r => !r.auxiliary).length, 10);
		assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.equal(ledger.status()[0].usageState, "reported");
		const detail = await status(f);
		assert.equal(detail.automaticReview, true);
		assert.deepEqual(detail.schedule, { enabled: true, cadence: 10, userTurns: 10, toolTurns: 0, progress: 0, due: false, attempted: true, reason: "no-stable-facts" });
		assert.equal(detail.daily.requests, 1);
		assert.ok(detail.daily.input > 0);
		assert.match(reviewLines(detail).join("\n"), /automatic ON[\s\S]*progress 0\/10/);
		// Public native continuation settles again WITHOUT a new native user entry.
		f.faux.setResponses([capture(requests)]);
		await f.session.sendCustomMessage({ customType: "fixture-repeat", content: "native continuation without user work", display: false }, { triggerTurn: true });
		assert.equal((await status(f)).schedule.userTurns, 10);
		await f.session.reload();
		assert.equal((await status(f)).schedule.progress, 0);
		assert.equal(ledger.status().length, 1);
		assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.deepEqual(f.errors, []);
		t.diagnostic(JSON.stringify({ nativeUsers: 10, auxiliaryRequests: 1, foregroundReturnedWhileReviewAdmitted: true, reportedUsage: true, nativeBytesAndLeafUnchanged: true, reloadDuplicateRequests: 0 }));
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});

test("three actual user inputs and forty tool-bearing assistant turns remain three users; summaries/custom/context noise do not count", async t => {
	const requests: Request[] = [];
	const f = await fixture(t, {}, pi => {
		pi.registerTool({ name: "fixture_noise", label: "Noise", description: "Bounded fixture output", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "tool result, not user work" }], details: undefined }) });
		pi.on("context", event => ({ messages: [...event.messages, { role: "user", content: "synthetic request-only user role", timestamp: 0 }] }));
	});
	for (const loops of [14, 13, 13]) {
		f.faux.setResponses([...Array.from({ length: loops }, () => (context: TranscriptContext, options: SimpleStreamOptions | undefined) => {
			requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) });
			return fauxAssistantMessage(fauxToolCall("fixture_noise", {}), { stopReason: "toolUse" });
		}), capture(requests)]);
		await promptSucceeded(f, `Perform ${loops} fixture iterations.`);
	}
	f.sessionManager.appendCustomMessageEntry("fixture-background", "custom user-role conversion", false);
	const last = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
	f.sessionManager.appendCompaction("converted summary is not another native user", last.id, 100);
	const detail = await status(f);
	assert.equal(detail.schedule.userTurns, 3);
	assert.equal(detail.schedule.toolTurns, 40);
	assert.equal(detail.schedule.progress, 3);
	assert.equal(detail.schedule.due, false);
	assert.equal(requests.filter(r => !r.auxiliary).length, 43);
	assert.equal(requests.filter(r => r.auxiliary).length, 0);
	assert.deepEqual(new ReviewLedger(f.agentDir).status(), []);
	assert.deepEqual(f.errors, []);
	t.diagnostic(JSON.stringify({ actualUserInputs: 3, toolBearingAssistantTurns: 40, foregroundRequests: 43, auxiliaryRequests: 0 }));
});

test("selected-branch progress restores after reload without sibling review contamination", async t => {
	const requests: Request[] = [];
	const f = await fixture(t);
	await work(f, requests, 2, "Shared");
	const common = f.sessionManager.getLeafId()!;
	await work(f, requests, 8, "Branch A");
	const ledger = new ReviewLedger(f.agentDir);
	await until(() => ledger.status()[0]?.status === "no-proposal", "branch A accounting completes");
	const branchA = f.sessionManager.getLeafId()!;
	assert.equal((await status(f)).schedule.progress, 0);
	await f.session.navigateTree(common, { summarize: false });
	await work(f, requests, 1, "Branch B");
	assert.equal((await status(f)).schedule.progress, 3);
	await f.session.reload();
	assert.equal((await status(f)).schedule.progress, 3);
	await work(f, requests, 7, "Branch B continuation");
	await until(() => ledger.status().filter(r => r.usageState === "reported").length === 2, "branch B independently reviews due work");
	assert.equal((await status(f)).schedule.userTurns, 10);
	assert.equal((await status(f)).schedule.progress, 0);
	await f.session.navigateTree(branchA, { summarize: false });
	const restored = await status(f);
	assert.equal(restored.schedule.userTurns, 10);
	assert.equal(restored.schedule.progress, 0);
	assert.equal(ledger.status().length, 2);
	assert.equal(requests.filter(r => r.auxiliary).length, 2);
	assert.deepEqual(f.errors, []);
});

test("native compaction and ContextEdit retain effective full system/tools/thinking but never restore removed raw history or native-only secret", async t => {
	const requests: Request[] = [];
	let compactions = 0;
	const f = await sdkFixture(t, { automaticReview: true,
		models: [{ id: "schedule-reasoning", reasoning: true, contextWindow: 64000 }],
		settings: { compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 0 } },
		extensions: [pi => {
			pi.registerTool({ name: "fixture_read", label: "Read", description: "Fixture declaration", parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "readonly" }], details: undefined }) });
			pi.on("before_agent_start", event => { event.systemPromptOptions.sections.fixture = "effective-system-sentinel"; });
			pi.on("context", event => ({ messages: [...event.messages, { role: "user", content: "transformed-request-sentinel", timestamp: 0 }] }));
			pi.on("session_before_compact", event => {
				const lastUser = event.branchEntries.filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
				return { compaction: { summary: "effective-summary-sentinel", firstKeptEntryId: lastUser.id, tokensBefore: event.preparation.tokensBefore } };
			});
			pi.on("session_compact", () => { compactions++; });
			createMemoryExtension()(pi);
		}] });
	f.session.setThinkingLevel("medium", { persist: false });
	await work(f, requests, 8, "REMOVED-RAW-HISTORY-SENTINEL");
	f.faux.setResponses([capture(requests)]);
	await promptSucceeded(f, "My password is NATIVE-ONLY-SECRET-SENTINEL.");
	const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
	f.sessionManager.appendContextEdit(source.id, { content: "effective-retained-display-sentinel" });
	await f.session.compact();
	assert.equal(compactions, 1);
	assert.equal(requests.filter(r => r.auxiliary).length, 0, "compaction hook cannot dispatch paid review");
	f.faux.setResponses([capture(requests), capture(requests)]);
	await promptSucceeded(f, "Finish tenth user work.");
	await until(() => new ReviewLedger(f.agentDir).status()[0]?.status === "no-proposal", "review current projected snapshot");
	const auxiliary = requests.filter(r => r.auxiliary);
	assert.equal(auxiliary.length, 1);
	const snapshot = auxiliary[0], body = JSON.stringify(snapshot.context);
	assert.match(body, /effective-summary-sentinel/);
	assert.match(body, /effective-retained-display-sentinel/);
	assert.match(body, /transformed-request-sentinel/);
	assert.match(getCurrentSystemPrompt(snapshot.context.messages), /effective-system-sentinel/);
	assert.ok(getCurrentTools(snapshot.context.messages).some(tool => tool.name === "fixture_read"));
	assert.equal(snapshot.options?.reasoning, "medium");
	assert.equal(snapshot.options?.maxRetries, 0);
	assert.equal(snapshot.options?.maxTokens, 4096);
	assert.equal(snapshot.options?.toolChoice, "none");
	assert.doesNotMatch(body, /REMOVED-RAW-HISTORY-SENTINEL|NATIVE-ONLY-SECRET-SENTINEL/);
	assert.match(readFileSync(f.sessionManager.getSessionFile()!, "utf8"), /NATIVE-ONLY-SECRET-SENTINEL/);
	assert.equal((await status(f)).schedule.userTurns, 10);
	assert.deepEqual(f.errors, []);
	t.diagnostic(JSON.stringify({ nativeCompactions: compactions, effectiveSystemToolsThinking: true, removedRawHistoryExcluded: true, nativeOnlySecretExcluded: true, auxiliaryRequests: auxiliary.length }));
});

test("automatic OFF preserves foreground remember, manual review and recall; compaction/shutdown never flush", async t => {
	const requests: Request[] = [];
	let f!: Fixture;
	f = await fixture(t, {}, pi => { pi.on("session_before_compact", event => ({ compaction: {
		summary: "off-mode summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore,
	} })); });
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ automaticReview: false }));
	await work(f, requests, 10);
	assert.equal(requests.filter(r => r.auxiliary).length, 0);
	const detail = await status(f);
	assert.equal(detail.automaticReview, false);
	assert.equal(detail.schedule.progress, 10);
	assert.equal(detail.schedule.reason, "disabled");
	assert.match(reviewLines(detail).join("\n"), /automatic OFF/);
	f.faux.setResponses([(context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) });
		return fauxAssistantMessage(fauxToolCall("hermes_memory", { action: "remember", kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers." }), { stopReason: "toolUse" });
	}, capture(requests)]);
	await promptSucceeded(f, "I prefer concise answers.");
	assert.equal(new MemoryStore(f.agentDir, f.cwd).read("user").entries.length, 1);
	f.faux.setResponses([capture(requests)]);
	await f.session.prompt("/hermes-review run");
	assert.equal(new ReviewLedger(f.agentDir).status()[0].trigger, "manual");
	assert.equal(requests.filter(r => r.auxiliary).length, 1);
	const recalled: Request[] = [];
	f.faux.setResponses([capture(recalled)]);
	await promptSucceeded(f, "Current detailed question.");
	assert.match(getCurrentSystemPrompt(recalled[0].context.messages), /I prefer concise answers/);
	const calls = f.faux.state.callCount;
	await f.session.compact();
	f.session.dispose();
	assert.equal(f.faux.state.callCount, calls);
	assert.deepEqual(f.errors, []);
});

for (const fence of ["budget", "paused", "unknown", "failure", "stale-snapshot", "unavailable"] as const) test(`settled ${fence} stays visible and never pays hidden retry on continuation/reload`, async t => {
	const requests: Request[] = [];
	let editAfterAnswer = false;
	const f = await fixture(t, fence === "budget" ? { limits: { dailyRequests: 1 } } : {}, pi => {
		if (fence === "unavailable") pi.on("context_with_system", event => {
			if (editAfterAnswer) return { messages: [...event.messages, { role: "system", content: "", sections: { hermes_memory: "foreign owned slot" }, timestamp: 0 }] };
		});
		if (fence === "stale-snapshot") pi.on("agent_before_settle", (_event, ctx) => {
			if (!editAfterAnswer) return;
			const user = ctx.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!;
			return { entries: [{ type: "context_edit", targetId: user.id, replacement: { content: "changed after last observed request" } }] };
		});
	});
	const ledger = new ReviewLedger(f.agentDir, { ...new ReviewLedger(f.agentDir).limits, ...(fence === "budget" ? { dailyRequests: 1 } : {}) });
	if (fence === "paused") ledger.pause();
	if (fence === "budget" || fence === "unknown") {
		const old = ledger.admit({ digest: "prior", session: "other", model: "fixture", estimatedInput: 1 });
		ledger.finish(old.id, "no-proposal", fence === "unknown" ? undefined : { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 });
	}
	await work(f, requests, 9);
	editAfterAnswer = fence === "stale-snapshot" || fence === "unavailable";
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) });
		return fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture auxiliary failure" });
	}]);
	await promptSucceeded(f, "Tenth user work.");
	await until(() => ledger.status().some(r => r.trigger === "settled" && r.status !== "admitted"), "settled terminal/skip recorded");
	const record = ledger.status().filter(r => r.trigger === "settled")[0];
	const reason = { budget: "daily-budget", paused: "user-paused", unknown: "review-failed-or-usage-unknown", failure: "provider-error-or-abort", "stale-snapshot": "stale-observed-context", unavailable: "effective-context-unavailable" }[fence];
	assert.equal(record.reason, reason);
	assert.equal(record.status, fence === "failure" ? "failed" : "skipped");
	assert.equal(requests.filter(r => r.auxiliary).length, fence === "failure" ? 1 : 0);
	assert.match(reviewLines(await status(f)).join("\n"), new RegExp(reason));
	const priorCount = ledger.status().length;
	editAfterAnswer = false;
	f.faux.setResponses([capture(requests)]);
	await f.session.sendCustomMessage({ customType: "fixture-repeat", content: "native continuation without user work", display: false }, { triggerTurn: true });
	await f.session.reload();
	assert.equal(ledger.status().length, priorCount);
	assert.equal(requests.filter(r => r.auxiliary).length, fence === "failure" ? 1 : 0);
	assert.deepEqual(f.errors, []);
});

for (const invalidation of ["input", "branch", "project", "disabled", "version", "shutdown"] as const) test(`delayed automatic result cannot commit after ${invalidation}; accounting remains`, async t => {
	const requests: Request[] = [], policy: MemoryOptions = {};
	const f = await fixture(t, policy);
	await work(f, requests, 9);
	const common = f.sessionManager.getLeafId()!;
	let release!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
	const delayed = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) }); return delayed;
	}]);
	await promptSucceeded(f, "I prefer concise answers.");
	await until(() => requests.some(r => r.auxiliary), "automatic request exists before invalidation");
	const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
	const ledger = new ReviewLedger(f.agentDir), store = new MemoryStore(f.agentDir, f.cwd);
	try {
		if (invalidation === "input") {
			f.faux.setResponses([capture(requests)]); await promptSucceeded(f, "Another user task.");
		} else if (invalidation === "branch") await f.session.navigateTree(common, { summarize: false });
		else if (invalidation === "disabled" || invalidation === "project") {
			mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
			writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify(invalidation === "disabled" ? { automaticReview: false } : {}));
			if (invalidation === "project") {
				policy.projectRoot = join(f.agentDir, "project-other"); mkdirSync(policy.projectRoot);
			}
		} else if (invalidation === "version") {
			mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
			writeFileSync(store.path("user"), "External user-edited fact.\n");
		} else f.session.dispose();
		const before = nativeState(f);
		release(fauxAssistantMessage(JSON.stringify({ candidates: [{ kind: "preference", fact: "I prefer concise answers.", quote: "I prefer concise answers.", entry: source }] })));
		await until(() => ledger.status()[0]?.usageState === "reported", "late usage must be accounted");
		assert.notEqual(ledger.status()[0].status, "saved");
		assert.equal(store.read("user").entries.some(entry => entry.fact === "I prefer concise answers."), false);
		assert.deepEqual(nativeState(f), before);
		assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.deepEqual(f.errors, []);
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});


test("tool-loop compaction at tenth user work dispatches only at native final settled boundary", async t => {
	const requests: Request[] = [], boundaries: { event: string; auxiliary: number }[] = [];
	let compactions = 0;
	let f!: Fixture;
	f = await sdkFixture(t, { automaticReview: true,
		models: [{ id: "mid-loop-schedule", contextWindow: 64000, maxTokens: 100 }],
		settings: { compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 0 } },
		extensions: [pi => {
			pi.registerTool({ name: "fixture_large", label: "Large", description: "Trigger native compaction", parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "REMOVED-TOOL-HISTORY-SENTINEL ".repeat(16000) }], details: undefined }) });
			pi.on("turn_end", event => event.message.role === "assistant" && event.message.content.some(block => block.type === "toolCall")
				? { entries: [{ type: "custom", customType: "fixture-compaction-cutoff" }] } : undefined);
			pi.on("session_before_compact", event => {
				boundaries.push({ event: "before_compact", auxiliary: requests.filter(r => r.auxiliary).length });
				return { compaction: { summary: "mid-loop-current-summary", firstKeptEntryId: event.branchEntries.at(-1)!.id, tokensBefore: event.preparation.tokensBefore } };
			});
			pi.on("session_compact", () => { compactions++; f.session.setAutoCompactionEnabled(false); });
			pi.on("agent_end", () => { boundaries.push({ event: "agent_end", auxiliary: requests.filter(r => r.auxiliary).length }); });
			createMemoryExtension()(pi);
			pi.on("agent_settled", () => { boundaries.push({ event: "settled", auxiliary: requests.filter(r => r.auxiliary).length }); });
		}] });
	await work(f, requests, 9);
	f.session.setAutoCompactionEnabled(true);
	f.faux.setResponses([(context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) });
		return fauxAssistantMessage(fauxToolCall("fixture_large", {}), { stopReason: "toolUse" });
	}, capture(requests), capture(requests)]);
	await promptSucceeded(f, "Tenth user runs large fixture.");
	await until(() => new ReviewLedger(f.agentDir).status()[0]?.usageState === "reported", "settled review is accounted");
	assert.ok(compactions >= 1);
	assert.ok(boundaries.some(b => b.event === "before_compact"));
	assert.ok(boundaries.filter(b => b.event !== "settled").every(b => b.auxiliary === 0));
	const auxiliary = requests.filter(r => r.auxiliary);
	assert.equal(auxiliary.length, 1);
	assert.match(JSON.stringify(auxiliary[0].context), /mid-loop-current-summary/);
	assert.doesNotMatch(JSON.stringify(auxiliary[0].context), /REMOVED-TOOL-HISTORY-SENTINEL/);
	assert.equal((await status(f)).schedule.userTurns, 10);
	assert.deepEqual(f.errors, []);
});

test("context handler redaction cannot be undone by source labels sent to automatic reviewer", async t => {
	const requests: Request[] = [];
	const f = await fixture(t, {}, pi => {
		pi.on("context", event => ({ messages: event.messages.map(message => message.role === "user" && JSON.stringify(message.content).includes("CONTEXT-PRIVATE-SENTINEL")
			? { ...message, content: "effective redacted user display" } : message) }));
	});
	await work(f, requests, 9);
	f.faux.setResponses([capture(requests), capture(requests)]);
	await promptSucceeded(f, "Native user has CONTEXT-PRIVATE-SENTINEL only.");
	await until(() => new ReviewLedger(f.agentDir).status()[0]?.usageState === "reported", "redacted review completes");
	const auxiliary = requests.filter(r => r.auxiliary);
	assert.equal(auxiliary.length, 1);
	assert.match(JSON.stringify(auxiliary[0].context), /effective redacted user display/);
	assert.doesNotMatch(JSON.stringify(auxiliary[0].context), /CONTEXT-PRIVATE-SENTINEL/);
	assert.match(readFileSync(f.sessionManager.getSessionFile()!, "utf8"), /CONTEXT-PRIVATE-SENTINEL/);
	assert.deepEqual(f.errors, []);
});


test("same native settled boundary is deduplicated under ledger lock even when observation timestamp/digest differs", t => {
	const dir = mkdtempSync("/var/tmp/hermes-schedule-ledger-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const a = new ReviewLedger(dir), b = new ReviewLedger(dir);
	const input = { session: "native-session", project: "native-project", leaf: "native-leaf", trigger: "settled" as const,
		schedule: { user: "native-user" }, model: "fixture", estimatedInput: 1 };
	const first = a.admit({ ...input, digest: "observer-a" });
	a.finish(first.id, "no-proposal", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 });
	assert.equal(b.admit({ ...input, digest: "observer-b" }).reason, "duplicate-snapshot");
	assert.equal(b.overview().daily.requests, 1);
});


interface ReviewNotice {
	type: string; action: string;
	detail: { id?: string; session?: string; project?: string; trigger?: string; status?: string; reason?: string;
		usageState?: string; error?: string; request?: ReturnType<ReviewLedger["status"]>[number]; automaticReview?: boolean };
}
async function capturePublication(run: (output: string[]) => Promise<void>): Promise<ReviewNotice[]> {
	const output: string[] = [], write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
	try { await run(output); } finally { process.stdout.write = write; }
	return output.join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}
function noticesIn(output: string[]): ReviewNotice[] {
	return output.join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}
async function publicationFixture(t: TestContext, before: ExtensionFactory = () => {}) {
	const f = await sdkFixture(t, { automaticReview: true, extensions: [pi => { before(pi); createMemoryExtension()(pi); }] });
	mkdirSync(join(f.agentDir, "hermes-memory"), { recursive: true });
	writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ projectRoot: f.cwd }));
	return f;
}

for (const fault of ["invalid-config", "missing-ledger", "async-missing-ledger"] as const) test(`publication F1 ${fault} emits bounded structured unavailable through registered hooks`, async t => {
	const requests: Request[] = [];
	let inject = false;
	const f = await publicationFixture(t, pi => {
		pi.on("agent_before_settle", () => {
			if (!inject || fault === "async-missing-ledger") return;
			if (fault === "invalid-config") writeFileSync(join(getAgentDir(), "hermes-memory", "config.json"), '{"secret":"PUBLICATION-RAW-ERROR-SENTINEL" invalid');
			else {
				mkdirSync(join(getAgentDir(), "hermes-review"), { recursive: true });
				writeFileSync(join(getAgentDir(), "hermes-review.initialized"), "hermes-review-v1\n");
			}
		});
	});
	await work(f, requests, 9);
	inject = true;
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) }); return held;
	}]);
	let savedLedger: Buffer | undefined;
	const ledgerPath = join(f.agentDir, "hermes-review", "ledger.json");
	try {
		const notices = await capturePublication(async output => {
			await promptSucceeded(f, "Tenth publication-fault work.");
			const native = nativeState(f);
			if (fault === "async-missing-ledger") {
				await until(() => requests.some(r => r.auxiliary), "async fault occurs only after one real auxiliary dispatch");
				savedLedger = readFileSync(ledgerPath);
				rmSync(ledgerPath);
				release(fauxAssistantMessage('{"candidates":[]}'));
			}
			await until(() => noticesIn(output).some(n => n.type === "hermes-review" && n.action === "settled" && n.detail.status === "unavailable"), "automatic exception must publish structured unavailable");
			assert.deepEqual(nativeState(f), native);
		});
		const failure = notices.filter(n => n.type === "hermes-review" && n.action === "settled" && n.detail.status === "unavailable");
		assert.equal(failure.length, 1);
		assert.match(failure[0].detail.error ?? "", /ledger\/storage\/configuration error; no fallback request/);
		assert.doesNotMatch(JSON.stringify(notices), /PUBLICATION-RAW-ERROR-SENTINEL|SyntaxError|ENOENT|\{invalid/);
		assert.equal(requests.filter(r => !r.auxiliary).length, 10);
		assert.equal(requests.filter(r => r.auxiliary).length, fault === "async-missing-ledger" ? 1 : 0);
		assert.deepEqual(f.errors, []);
		t.diagnostic(JSON.stringify({ finding: "F1", fault, foreground: 10, auxiliary: fault === "async-missing-ledger" ? 1 : 0, unavailableNotices: failure.length, rawExceptionExcluded: true, nativeUnchanged: true }));
	} finally {
		if (savedLedger) writeFileSync(ledgerPath, savedLedger);
		release(fauxAssistantMessage('{"candidates":[]}'));
	}
});

for (const rebind of ["off", "project"] as const) for (const late of [false, true]) test(`publication F2 ${rebind} rebind publishes old ${late ? "terminal and late usage" : "reported terminal"} without proposal/native authority`, async t => {
	const f = await publicationFixture(t), requests: Request[] = [];
	await work(f, requests, 9);
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) }); return held;
	}]);
	await promptSucceeded(f, "This project uses pnpm.");
	await until(() => requests.some(r => r.auxiliary), "one automatic request exists before rebind");
	const ledger = new ReviewLedger(f.agentDir), old = ledger.status()[0], native = nativeState(f);
	const source = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1)!.id;
	const nextRoot = join(f.agentDir, "project-other"); mkdirSync(nextRoot);
	const oldStore = new MemoryStore(f.agentDir, f.cwd), newStore = new MemoryStore(f.agentDir, nextRoot);
	const beforeFiles = [oldStore, newStore].map(store => store.readAll().map(s => ({ path: s.path, raw: s.raw, present: s.present })));
	try {
		const notices = await capturePublication(async output => {
			writeFileSync(join(f.agentDir, "hermes-memory", "config.json"), JSON.stringify({ projectRoot: rebind === "project" ? nextRoot : f.cwd, automaticReview: rebind !== "off" }));
			if (late) {
				// Public status forces supported current-engine rebind/cancellation BEFORE held response.
				await f.session.prompt("/hermes-review status");
				await until(() => ledger.status()[0].usageState === "unknown", "rebound old request cancels before response");
				await until(() => noticesIn(output).some(n => n.action === "settled" && n.detail.id === old.id && n.detail.usageState === "unknown"), "old cancelled terminal must remain visible after rebind");
			}
			release(fauxAssistantMessage(JSON.stringify({ candidates: [{ kind: "project-fact", fact: "This project uses pnpm.", quote: "This project uses pnpm.", entry: source }] })));
			await until(() => ledger.status()[0].usageState === "reported", "old request usage accounted");
			await until(() => noticesIn(output).some(n => late
				? n.action === "usage-updated" && n.detail.request?.id === old.id && n.detail.request.usageState === "reported"
				: n.action === "settled" && n.detail.id === old.id && n.detail.usageState === "reported"), "old request terminal/late accounting must be published through live context");
		});
		const terminal = notices.filter(n => n.action === "settled" && n.detail.id === old.id);
		assert.equal(terminal.length, 1);
		assert.equal(terminal[0].detail.status, "cancelled");
		assert.equal(terminal[0].detail.session, old.session);
		assert.equal(terminal[0].detail.project, old.project);
		assert.equal(terminal[0].detail.trigger, "settled");
		if (late) {
			const updated = notices.filter(n => n.action === "usage-updated" && n.detail.request?.id === old.id);
			assert.equal(updated.length, 1);
			assert.equal(updated[0].detail.request?.project, old.project);
			assert.equal(updated[0].detail.request?.status, "cancelled");
			assert.equal(updated[0].detail.automaticReview, rebind !== "off", "usage update carries current automation state, not obsolete authority");
		}
		const row = ledger.status()[0], view = ledger.overview();
		assert.equal(row.status, "cancelled"); assert.equal(row.usageState, "reported");
		assert.equal(view.daily.requests, 1); assert.equal(view.daily.input, row.input); assert.equal(view.daily.output, row.output);
		assert.equal(view.held.requests, 0); assert.equal(ledger.status().length, 1);
		assert.deepEqual([oldStore, newStore].map(store => store.readAll().map(s => ({ path: s.path, raw: s.raw, present: s.present }))), beforeFiles);
		assert.deepEqual(nativeState(f), native);
		assert.equal(requests.filter(r => !r.auxiliary).length, 10); assert.equal(requests.filter(r => r.auxiliary).length, 1);
		assert.deepEqual(f.errors, []);
		t.diagnostic(JSON.stringify({ finding: "F2", rebind, late, request: old.id, terminalNotices: terminal.length, usageState: row.usageState, paidRequests: view.daily.requests, nativeAndMemoryUnchanged: true }));
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});

for (const revoke of ["dispose", "reload"] as const) test(`publication stays silent on revoked ${revoke} context while late usage is recorded`, async t => {
	const f = await publicationFixture(t), requests: Request[] = [];
	await work(f, requests, 9);
	let release!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
	const held = new Promise<ReturnType<typeof fauxAssistantMessage>>(resolve => { release = resolve; });
	f.faux.setResponses([capture(requests), (context, options) => {
		requests.push({ context: structuredClone(context), options, auxiliary: isReview(context) }); return held;
	}]);
	await promptSucceeded(f, "This project uses pnpm.");
	await until(() => requests.some(r => r.auxiliary), "request admitted before context revocation");
	const ledger = new ReviewLedger(f.agentDir);
	try {
		await capturePublication(async () => { if (revoke === "reload") await f.session.reload(); else f.session.dispose(); });
		const native = nativeState(f);
		const notices = await capturePublication(async () => {
			release(fauxAssistantMessage('{"candidates":[]}'));
			await until(() => ledger.status()[0].usageState === "reported", "revoked result still accounts late usage");
			await new Promise(resolve => setTimeout(resolve, 30));
		});
		assert.deepEqual(notices, [], "revoked context must emit no terminal, late usage or unavailable notice");
		assert.deepEqual(nativeState(f), native);
		assert.equal(ledger.status()[0].status, "cancelled"); assert.equal(ledger.overview().daily.requests, 1);
		assert.equal(new MemoryStore(f.agentDir, f.cwd).read("project").entries.length, 0);
		assert.equal(requests.filter(r => r.auxiliary).length, 1); assert.deepEqual(f.errors, []);
	} finally { release(fauxAssistantMessage('{"candidates":[]}')); }
});

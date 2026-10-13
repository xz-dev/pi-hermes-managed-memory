import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, Type,
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sdkFixture } from "./sdk-fixture.ts";

type Fixture = Awaited<ReturnType<typeof sdkFixture>>;
function mainState(f: Fixture) {
	const file = f.sessionManager.getSessionFile();
	assert.ok(file);
	return {
		id: f.sessionManager.getSessionId(), leaf: f.sessionManager.getLeafId(), file,
		bytes: readFileSync(file), entries: JSON.stringify(f.sessionManager.getEntries()),
		branch: JSON.stringify(f.sessionManager.getBranch()), messages: JSON.stringify(f.session.messages),
	};
}

test("effective branch snapshot streams independently without changing the main session", async t => {
	const contexts: ExtensionContext[] = [];
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { contexts.push(ctx); });
	}] });
	f.faux.setResponses([fauxAssistantMessage("seed answer")]);
	await f.session.prompt("old compacted input");
	const common = f.sessionManager.getLeafId();
	assert.ok(common);
	const kept = f.sessionManager.appendMessage({ role: "user", content: "active branch evidence", timestamp: 1 });
	const active = f.sessionManager.appendMessage(fauxAssistantMessage("active answer"));
	f.sessionManager.branch(common);
	f.sessionManager.appendMessage({ role: "user", content: "sibling-only evidence", timestamp: 2 });
	f.sessionManager.appendMessage(fauxAssistantMessage("sibling answer"));
	f.sessionManager.branch(active);
	f.sessionManager.appendCompaction("current compacted summary", kept, 100);
	f.session.refreshContext();
	const ctx = contexts[0];
	assert.ok(ctx);
	const projection = ctx.sessionManager.buildSessionProjection();
	const snapshot = { messages: convertToLlm(structuredClone(projection.messages)) };
	assert.match(JSON.stringify(snapshot), /current compacted summary/);
	assert.match(JSON.stringify(snapshot), /active branch evidence/);
	assert.doesNotMatch(JSON.stringify(snapshot), /old compacted input|sibling-only evidence/);
	assert.equal(ctx.sessionManager.getBranch().at(-1)?.type, "compaction");
	const before = mainState(f);
	const controller = new AbortController();
	f.faux.setResponses([(context, options) => {
		assert.deepEqual(context.messages, snapshot.messages);
		assert.equal(options?.maxRetries, 0);
		assert.equal(options?.maxTokens, 64);
		assert.equal(options?.timeoutMs, 1000);
		assert.ok(options?.signal);
		return fauxAssistantMessage("review-only response");
	}]);
	const calls = f.faux.state.callCount;
	const result = await ctx.modelRegistry.streamSimple(f.model, snapshot, {
		signal: controller.signal, maxRetries: 0, maxTokens: 64, timeoutMs: 1000,
	}).result();
	assert.equal(result.stopReason, "stop");
	assert.equal(f.faux.state.callCount, calls + 1);
	assert.deepEqual(mainState(f), before);
	assert.doesNotMatch(readFileSync(before.file, "utf8"), /review-only response/);

	let started = () => {};
	const requestStarted = new Promise<void>(resolve => { started = resolve; });
	const cancellation = new AbortController();
	f.faux.setResponses([(_context, options) => {
		const signal = options?.signal;
		assert.ok(signal);
		started();
		return new Promise<AssistantMessage>(resolve => {
			signal.addEventListener("abort", () => resolve(fauxAssistantMessage("", {
				stopReason: "aborted", errorMessage: "fixture cancellation",
			})), { once: true });
		});
	}]);
	const aborted = ctx.modelRegistry.streamSimple(f.model, snapshot, {
		signal: cancellation.signal, maxRetries: 0, maxTokens: 64, timeoutMs: 1000,
	});
	await requestStarted;
	cancellation.abort();
	assert.equal((await aborted.result()).stopReason, "aborted");
	assert.equal(f.faux.state.callCount, calls + 2);
	assert.deepEqual(mainState(f), before);
	assert.deepEqual(f.errors, []);
});

test("public request hooks refresh their own section after mid-tool-loop compaction", async t => {
	let beforeStarts = 0;
	let contextCalls = 0;
	let version = 1;
	let compactions = 0;
	const requests: { prompt: string; tools: string[]; firstRole: string; version: number }[] = [];
	const f = await sdkFixture(t, {
		models: [{ id: "compact-fixture", contextWindow: 8000, maxTokens: 100 }],
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
		extensions: [pi => {
			pi.registerTool({
				name: "fixture_output", label: "Fixture", description: "Produce isolated fixture evidence",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "fixture output ".repeat(4000) }], details: undefined }),
			});
			pi.on("before_agent_start", event => {
				beforeStarts++;
				event.systemPromptOptions.sections.hermes_memory = "fixture-memory-v1";
				event.systemPromptOptions.sections.other_fixture = "other-extension-section";
			});
			pi.on("context", event => {
				contextCalls++;
				assert.ok(event.messages.every(message => message.role !== "system"));
				return { messages: [...event.messages, { role: "user", content: "request-only evidence", timestamp: 0 }] };
			});
			pi.on("context_with_system", event => {
				assert.equal(event.messages[0]?.role, "system");
				return { messages: [...event.messages, {
					role: "system", content: "", sections: { hermes_memory: `fixture-memory-v${version}` }, timestamp: 0,
				}] };
			});
			pi.on("session_before_compact", event => ({ compaction: {
				summary: "fixture compacted summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			} }));
			pi.on("session_compact", () => { compactions++; version++; });
		}],
	});
	assert.deepEqual(f.session.getActiveToolNames(), ["fixture_output"]);
	const observe = (messages: Parameters<typeof getCurrentSystemPrompt>[0]) => {
		requests.push({
			prompt: getCurrentSystemPrompt(messages), tools: getCurrentTools(messages).map(tool => tool.name),
			firstRole: messages[0]?.role ?? "missing", version,
		});
	};
	f.faux.setResponses([
		context => {
			observe(context.messages);
			assert.match(JSON.stringify(context.messages), /request-only evidence/);
			return fauxAssistantMessage(fauxToolCall("fixture_output", {}), { stopReason: "toolUse" });
		},
		context => { observe(context.messages); return fauxAssistantMessage("finished after compaction"); },
	]);
	await f.session.prompt("Run the isolated fixture tool.");
	assert.equal(f.faux.state.callCount, 2);
	assert.equal(beforeStarts, 1, "no new user boundary between the two provider requests");
	assert.equal(contextCalls, 2);
	assert.ok(compactions >= 1);
	assert.equal(requests[0].version, 1);
	assert.ok(requests[1].version > 1, "the next tool-loop request sees the committed refresh");
	for (const request of requests) {
		assert.equal(request.firstRole, "system");
		assert.match(request.prompt, /other-extension-section/);
		assert.ok(request.prompt.includes(`fixture-memory-v${request.version}`));
		assert.equal(request.prompt.match(/fixture-memory-v\d+/g)?.length, 1);
		assert.deepEqual(request.tools, ["fixture_output"]);
	}
	assert.doesNotMatch(requests[1].prompt, /fixture-memory-v1/);
	assert.equal(f.sessionManager.getEntries().filter(entry => entry.type === "message" && entry.message.role === "user").length, 1);
	assert.doesNotMatch(readFileSync(f.sessionManager.getSessionFile()!, "utf8"), /request-only evidence/);
	assert.deepEqual(f.errors, []);
});

test("failed or cancelled native compaction does not commit a new projection", async t => {
	let cancel = false;
	let successes = 0;
	const failures: { aborted: boolean }[] = [];
	const f = await sdkFixture(t, {
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		extensions: [pi => {
			pi.on("session_before_compact", () => cancel ? { cancel: true } : undefined);
			pi.on("session_compact", () => { successes++; });
			pi.on("session_compact_failed", event => { failures.push({ aborted: event.aborted }); });
		}],
	});
	f.faux.setResponses([fauxAssistantMessage("first reply"), fauxAssistantMessage("second reply")]);
	await f.session.prompt("first evidence");
	await f.session.prompt("second evidence");
	const projection = structuredClone(f.sessionManager.buildSessionProjection());
	const before = mainState(f);
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture compaction failure" })]);
	await assert.rejects(f.session.compact(), /fixture compaction failure/);
	assert.deepEqual(f.sessionManager.buildSessionProjection(), projection);
	assert.deepEqual(mainState(f), before);
	assert.equal(successes, 0);
	assert.deepEqual(failures, [{ aborted: false }]);
	cancel = true;
	const calls = f.faux.state.callCount;
	await assert.rejects(f.session.compact(), /cancelled/i);
	assert.equal(f.faux.state.callCount, calls);
	assert.deepEqual(f.sessionManager.buildSessionProjection(), projection);
	assert.deepEqual(mainState(f), before);
	assert.deepEqual(failures, [{ aborted: false }, { aborted: true }]);
	assert.deepEqual(f.errors, []);
});

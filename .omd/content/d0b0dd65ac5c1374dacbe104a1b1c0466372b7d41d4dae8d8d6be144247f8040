import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { sdkFixture } from "./sdk-fixture.ts";

async function fixture(t: TestContext, options: MemoryOptions = {}) {
	return sdkFixture(t, { models: [{ id: "bounded", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 } }],
		extensions: [pi => {
			pi.registerTool({ name: "never_execute", label: "Never", description: "Read-only declaration, not review execution authority",
				parameters: Type.Object({}), execute: async () => { throw new Error("Review tool execution is forbidden"); } });
			createMemoryExtension({ ...options, projectRoot: join(getAgentDir(), "project") })(pi);
		}] });
}
const reasoning = fauxAssistantMessage("");
reasoning.content = [{ type: "thinking", thinking: "Reasoning without a proposal" }];

for (const [name, message, status] of [
	["empty output", fauxAssistantMessage(""), "no-proposal"],
	["reasoning-only", reasoning, "no-proposal"],
	["invalid JSON", fauxAssistantMessage("{bad-json"), "no-proposal"],
	["tool request", fauxAssistantMessage([fauxToolCall("never_execute", {})]), "no-proposal"],
	["provider failure", fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture failure" }), "failed"],
] as const) {
	test(`${name} has a durable terminal outcome and no second request`, async t => {
		const f = await fixture(t);
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt("Ordinary work.");
		f.faux.setResponses([(_context, options) => {
			assert.equal(options?.maxRetries, 0);
			assert.equal(options?.maxTokens, 4096);
			assert.equal(options?.timeoutMs, 90000);
			assert.equal(options?.toolChoice, "none");
			return message;
		}]);
		await f.session.prompt("/hermes-review run");
		const records = new ReviewLedger(f.agentDir).status();
		assert.equal(records.length, 1);
		assert.equal(records[0].status, status);
		assert.ok(records[0].ended);
		assert.notEqual(records[0].usageState, "reserved");
		if (status === "failed") {
			assert.equal(records[0].usageState, "reported");
			assert.ok(records[0].costEstimate! > 0, "native fake provider still consumes input on failure");
		}
		assert.deepEqual(records[0].saved, []);
		assert.equal(f.faux.state.callCount, 2);
		assert.deepEqual(f.errors, []);
	});
}

test("reported output beyond the request cap stops before saving and pauses new requests", async t => {
	const f = await fixture(t, { limits: { output: 8 } });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("Ordinary work.");
	f.faux.setResponses([(_context, options) => {
		assert.equal(options?.maxTokens, 8);
		return fauxAssistantMessage("oversized-output ".repeat(300));
	}]);
	await f.session.prompt("/hermes-review run");
	const ledger = new ReviewLedger(f.agentDir), record = ledger.status()[0];
	assert.equal(record.status, "failed");
	assert.equal(record.reason, "reported-budget-overrun");
	assert.ok(record.output! > 8);
	assert.deepEqual(record.saved, []);
	await f.session.prompt("/hermes-review run");
	assert.equal(ledger.status()[1].status, "skipped");
	assert.equal(f.faux.state.callCount, 2);
});

test("host timeout is bounded even when the provider has not returned a proposal", async t => {
	const f = await fixture(t, { limits: { timeoutMs: 40 } });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("Ordinary work.");
	f.faux.setResponses([(_context, options) => {
		assert.equal(options?.timeoutMs, 40);
		assert.ok(options.signal);
		return new Promise<AssistantMessage>(resolve => {
			options.signal!.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), { once: true });
		});
	}]);
	await f.session.prompt("/hermes-review run");
	const record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "cancelled");
	assert.ok(record.ended);
	assert.deepEqual(record.saved, []);
	assert.equal(f.faux.state.callCount, 2);
});

for (const [name, limits] of [
	["input", { input: 100 }],
	["daily input", { dailyInput: 63999 }],
	["daily output", { dailyOutput: 4095 }],
] as const) {
	test(`${name} admission rejects the full snapshot without another provider call`, async t => {
		const f = await fixture(t, { limits });
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt("Ordinary work.");
		await f.session.prompt("/hermes-review run");
		const record = new ReviewLedger(f.agentDir).status()[0];
		assert.equal(record.status, "skipped");
		assert.equal(record.usageState, "not-sent");
		assert.equal(f.faux.state.callCount, 1);
	});
}

test("daily request allowance includes no-proposal instead of treating it as free", async t => {
	const f = await fixture(t, { limits: { dailyRequests: 1 } });
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("First work.");
	f.faux.setResponses([fauxAssistantMessage('{"candidates":[]}')]);
	await f.session.prompt("/hermes-review run");
	f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
	await f.session.prompt("Different work.");
	await f.session.prompt("/hermes-review run");
	const records = new ReviewLedger(f.agentDir).status();
	assert.equal(records[0].status, "no-proposal");
	assert.equal(records[1].reason, "daily-budget");
	assert.equal(f.faux.state.callCount, 3, "two foreground calls, one review only");
});

test("actual extension no-change preserves the file but still accounts for its request", async t => {
	const f = await fixture(t), store = new MemoryStore(f.agentDir);
	for (let round = 0; round < 2; round++) {
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt("I prefer concise answers.");
		const entry = f.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1);
		assert.ok(entry);
		const before = store.read("user").raw;
		f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [{ kind: "preference", fact: "I prefer concise answers.",
			quote: "I prefer concise answers.", entry: entry.id }] }))]);
		await f.session.prompt("/hermes-review run");
		if (round === 1) assert.equal(store.read("user").raw, before);
	}
	const records = new ReviewLedger(f.agentDir).status();
	assert.equal(records[0].status, "saved");
	assert.equal(records[1].status, "no-change");
	assert.equal(records[1].usageState, "reported");
	assert.ok(records[1].costEstimate! > 0);
	assert.deepEqual(records[1].saved, []);
	assert.equal(f.faux.state.callCount, 4);
	assert.deepEqual(f.errors, []);
});

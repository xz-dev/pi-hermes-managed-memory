import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { ReviewLedger, type UsageReport } from "../src/review-ledger.ts";

function ledger(t: TestContext) {
	const dir = mkdtempSync("/var/tmp/hermes-accounting-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return new ReviewLedger(dir);
}
const cached: UsageReport = { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, cacheWrite1h: 4,
	reasoning: 15, totalTokens: 180, cost: { input: 0.1, output: 0.2, cacheRead: 0.05, cacheWrite: 0.01, total: 0.36 } };

for (const outcome of ["saved", "no-change", "no-proposal", "conflict", "failed", "cancelled"] as const) {
	test(`${outcome} retains raw cache/reasoning and settles exactly once`, t => {
		const store = ledger(t);
		const request = store.admit({ digest: outcome, session: "fixture", project: "project-a", model: "fixture/model", estimatedInput: 1000,
			trigger: "manual", targets: ["memory:user"], leaf: "active-endpoint", generation: 3 });
		const result = store.finish(request.id, outcome, cached);
		assert.deepEqual(result.usage, cached);
		assert.equal(result.input, 160, "cache and 1h subset not counted twice");
		assert.equal(result.output, 20, "reasoning is already included in output");
		assert.equal(result.usageBasis, "sdk-total-minus-output");
		assert.equal(result.costEstimate, 0.36);
		assert.equal(result.costBasis, "sdk-reported-estimate");
		assert.equal(result.job, request.digest);
		assert.equal(result.leaf, "active-endpoint");
		assert.equal(result.generation, 3);
		assert.equal(result.inputEstimateBasis, "serialized-utf8-bytes");
		const before = readFileSync(store.path);
		store.finish(request.id, outcome, cached);
		store.lateUsage(request.id, cached);
		assert.deepEqual(readFileSync(store.path), before, "duplicate final callbacks do not change tally/history");
		assert.equal(store.status().length, 1);
	});
}

test("partial failure usage and unknown cost survive without releasing any allowance", t => {
	const store = ledger(t);
	const request = store.admit({ digest: "partial", session: "fixture", model: "fixture/model", estimatedInput: 100 });
	const partial = { input: 80, cacheRead: 12, reasoning: 7 };
	const result = store.finish(request.id, "failed", partial);
	assert.deepEqual(result.usage, partial);
	assert.equal(result.usageState, "unknown");
	assert.equal(result.input, undefined);
	assert.equal(result.output, undefined);
	assert.equal(result.costBasis, "unknown");
	assert.equal(result.costEstimate, undefined);
	assert.deepEqual(result.reserved, request.reserved);
	assert.equal(store.admit({ digest: "next", session: "fixture", model: "fixture/model", estimatedInput: 100 }).status, "skipped");
	store.lateUsage(request.id, cached);
	const settled = store.status()[0];
	assert.equal(settled.status, "failed");
	assert.equal(settled.usageState, "reported");
	assert.equal(settled.input, 160);
	assert.equal(settled.costEstimate, 0.36);
	const before = readFileSync(store.path);
	store.lateUsage(request.id, cached);
	assert.deepEqual(readFileSync(store.path), before);
});

test("a late partial report is retained without releasing debt or duplicating its callback", t => {
	const store = ledger(t);
	const request = store.admit({ digest: "late-partial", session: "fixture", model: "fixture/model", estimatedInput: 100 });
	store.finish(request.id, "cancelled");
	const partial = { input: 80, cacheRead: 12, cost: { total: 0.04 } };
	store.lateUsage(request.id, partial);
	const pending = store.status()[0];
	assert.deepEqual(pending.usage, partial);
	assert.equal(pending.usageState, "unknown");
	assert.equal(pending.costEstimate, 0.04);
	const before = readFileSync(store.path);
	store.lateUsage(request.id, partial);
	assert.deepEqual(readFileSync(store.path), before);
	store.lateUsage(request.id, cached);
	assert.deepEqual(store.status()[0].priorUsage, [partial]);
	assert.equal(store.status()[0].costEstimate, 0.36, "partial estimate is not added again to complete usage");
});

test("unknown rates and unsupported 1h pricing cannot manufacture a zero price", t => {
	for (const report of [undefined, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
		{ ...cached, cost: undefined }, { ...cached, cost: { total: 0 } }]) {
		const store = ledger(t);
		const request = store.admit({ digest: "unknown", session: "fixture", model: "fixture/model", estimatedInput: 100,
			prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
		const result = store.finish(request.id, "no-proposal", report);
		assert.equal(result.costEstimate, undefined);
		assert.equal(result.costBasis, "unknown");
		assert.deepEqual(result.usage, report);
	}
	const store = ledger(t);
	const request = store.admit({ digest: "hourly", session: "fixture", model: "fixture/model", estimatedInput: 100,
		prices: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 } });
	const result = store.finish(request.id, "no-proposal", { ...cached, cost: { total: 0 } });
	assert.equal(result.usageState, "reported");
	assert.equal(result.costBasis, "unknown", "generic model rates cannot price the 1h cache-write subset");
	assert.equal(result.costEstimate, undefined);
});

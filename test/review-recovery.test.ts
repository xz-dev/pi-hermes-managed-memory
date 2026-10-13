import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { DEFAULT_LIMITS, ReviewLedger, type UsageReport } from "../src/review-ledger.ts";

const report: UsageReport = { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135, cost: { total: 0.02 } };
function fixture(t: TestContext) {
	const dir = mkdtempSync("/var/tmp/hermes-recovery-");
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	let date = new Date("2026-10-01T12:00:00Z");
	const clock = () => date;
	const ledger = new ReviewLedger(dir, DEFAULT_LIMITS, clock);
	const admit = (digest: string) => ledger.admit({ digest, session: "fixture", model: "fixture/model", estimatedInput: 200 });
	return { ledger, admit, reload: () => new ReviewLedger(dir, DEFAULT_LIMITS, clock), setDate: (value: string) => { date = new Date(value); } };
}
for (const crossDay of [false, true]) {
	test(`${crossDay ? "cross" : "same"}-day confirmed unknown recovery debits once through reload and late telemetry`, t => {
		const f = fixture(t), old = f.admit("unknown");
		f.ledger.finish(old.id, "cancelled", { input: 12 });
		if (crossDay) f.setDate("2026-10-02T12:00:00Z");
		const preview = f.ledger.preview();
		f.ledger.resume(preview.stamp);
		assert.equal(f.ledger.status()[0].usageState, "unknown");
		assert.equal(f.ledger.status()[0].day, "2026-10-01");
		assert.equal(f.ledger.overview().daily.input, DEFAULT_LIMITS.input);
		assert.equal(f.ledger.overview().daily.requests, 1);
		assert.throws(() => f.ledger.resume(preview.stamp), /confirmation-state-changed/);
		const reload = f.reload();
		reload.resume(reload.preview().stamp);
		assert.equal(reload.overview().daily.input, DEFAULT_LIMITS.input);
		reload.lateUsage(old.id, report);
		assert.equal(reload.status()[0].input, 115);
		assert.deepEqual(reload.status()[0].priorUsage, [{ input: 12 }]);
		assert.equal(reload.overview().daily.input, DEFAULT_LIMITS.input, "no automatic refund or original-day second debit");
		assert.equal(reload.overview().paused, undefined);
		assert.equal(reload.overview().daily.requests, 1);
		assert.equal(f.admit("new").status, "admitted");
		f.setDate(crossDay ? "2026-10-03T12:00:00Z" : "2026-10-02T12:00:00Z");
		// A live new call blocks admission, but the confirmed old booking does not carry into this day.
		assert.equal(reload.overview().daily.input, 0);
		assert.equal(reload.overview().daily.requests, 0);
	});
}
test("recovery rejects date rollback and a live owner without mutations", t => {
	const f = fixture(t), old = f.admit("unknown"); f.ledger.finish(old.id, "failed");
	const preview = f.ledger.preview();
	const before = readFileSync(f.ledger.path);
	f.setDate("2026-09-30T12:00:00Z");
	assert.throws(() => f.ledger.resume(preview.stamp), /clock-rollback/);
	assert.deepEqual(readFileSync(f.ledger.path), before);
	f.setDate("2026-10-01T12:00:00Z"); f.ledger.resume(preview.stamp);
	const running = f.admit("live");
	const view = f.ledger.preview();
	const owned = readFileSync(f.ledger.path);
	assert.throws(() => f.ledger.resume(view.stamp), /live-owner/);
	assert.deepEqual(readFileSync(f.ledger.path), owned);
	assert.equal(f.ledger.status().find(record => record.id === running.id)?.usageState, "reserved");
});
for (const lateMethod of ["lateUsage", "finish"] as const) {
	test(`${lateMethod} overrun after confirmed recovery re-pauses without another booking`, t => {
		const f = fixture(t), old = f.admit("unknown"); f.ledger.finish(old.id, "cancelled");
		f.ledger.resume(f.ledger.preview().stamp);
		const over = { ...report, input: DEFAULT_LIMITS.input + 1, totalTokens: DEFAULT_LIMITS.input + 36 };
		if (lateMethod === "finish") f.ledger.finish(old.id, "cancelled", over); else f.ledger.lateUsage(old.id, over);
		assert.equal(f.ledger.overview().paused, "reported-budget-overrun");
		assert.equal(f.ledger.overview().errors.length, 1);
		assert.equal(f.ledger.overview().daily.input, DEFAULT_LIMITS.input);
		assert.equal(f.ledger.overview().daily.requests, 1);
		assert.equal(f.admit("blocked").status, "skipped");
	});
}
test("new late error invalidates confirmation without acknowledging unseen failures", t => {
	const f = fixture(t), late = f.admit("late"); f.ledger.finish(late.id, "cancelled");
	f.ledger.resume(f.ledger.preview().stamp);
	const old = f.admit("old"); f.ledger.finish(old.id, "failed");
	const preview = f.ledger.preview();
	f.ledger.lateUsage(late.id, { ...report, input: DEFAULT_LIMITS.input + 1, totalTokens: DEFAULT_LIMITS.input + 36 });
	assert.throws(() => f.ledger.resume(preview.stamp), /confirmation-state-changed/);
	assert.equal(f.ledger.status().find(record => record.id === old.id)?.acknowledged, undefined);
	assert.equal(f.ledger.status().find(record => record.id === old.id)?.recovery, undefined);
	assert.equal(f.ledger.overview().errors.length, 2);
});
test("explicit retry bypasses only selected duplicate and retains daily quota", t => {
	const f = fixture(t), old = f.admit("same"); f.ledger.finish(old.id, "failed", report);
	const preview = f.ledger.preview();
	const retry = f.ledger.admit({ digest: "same", session: "fixture", model: "fixture/model", estimatedInput: 200,
		retryOf: old.id, confirmation: preview.stamp, trigger: "retry" });
	assert.equal(retry.status, "admitted"); f.ledger.finish(retry.id, "no-proposal", report);
	const next = f.ledger.admit({ digest: "same", session: "fixture", model: "fixture/model", estimatedInput: 200,
		retryOf: old.id, confirmation: f.ledger.preview().stamp });
	assert.equal(next.reason, "duplicate-snapshot");
	assert.equal(f.ledger.overview().daily.requests, 2);
});
test("partial late telemetry above a reserved subset re-pauses acknowledged debt without another debit", t => {
	const f = fixture(t), old = f.admit("unknown-partial");
	f.ledger.finish(old.id, "cancelled"); f.ledger.resume(f.ledger.preview().stamp);
	f.ledger.lateUsage(old.id, { reasoning: DEFAULT_LIMITS.output + 1 });
	assert.equal(f.ledger.overview().paused, "reported-budget-overrun");
	assert.equal(f.ledger.overview().errors.length, 1);
	assert.equal(f.ledger.status()[0].usageState, "unknown");
	assert.equal(f.ledger.overview().daily.requests, 1);
	assert.equal(f.ledger.overview().daily.output, DEFAULT_LIMITS.output);
});

test("late settlement faults remain visible and block across reload until exact confirmation", t => {
	const f = fixture(t); f.ledger.noteFault("old-request");
	assert.equal(f.reload().overview().paused, "ledger-settlement-error");
	assert.equal(f.admit("blocked").status, "skipped");
	const preview = f.ledger.preview(); f.ledger.noteFault("new-request");
	assert.throws(() => f.ledger.resume(preview.stamp), /confirmation-state-changed/);
	f.ledger.resume(f.ledger.preview().stamp);
	assert.equal(f.reload().overview().fault, undefined);
	assert.equal(f.admit("allowed").status, "admitted");
});

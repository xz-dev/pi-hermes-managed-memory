import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { createMemoryExtension, type MemoryOptions } from "../src/index.ts";
import { DEFAULT_LIMITS, ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

async function fixture(t: TestContext, options: MemoryOptions = {}, hasUI = true) {
	let base: ExtensionUIContext | undefined;
	let unbind = async () => {};
	// Register before sdkFixture's cleanup so no UI timer survives restored personal env.
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, ctx) => { base = ctx.ui; });
		createMemoryExtension({ ...options, projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	const statuses = new Map<string, string | undefined>(), widgets = new Map<string, string[]>(), notices: string[] = [];
	let confirm = async (_title: string, _message: string) => true;
	assert.ok(base);
	const ui: ExtensionUIContext = { ...base, confirm: (title, message) => confirm(title, message),
		setStatus: (key, value) => { statuses.set(key, value); },
		setWidget: (key, content) => { if (Array.isArray(content)) widgets.set(key, content); },
		notify: message => { notices.push(message); } };
	if (hasUI) await f.session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => f.errors.push(error.error) });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	return { ...f, statuses, widgets, notices, setConfirm: (value: typeof confirm) => { confirm = value; }, ledger: new ReviewLedger(f.agentDir, { ...DEFAULT_LIMITS, ...options.limits }) };
}
async function fail(f: Awaited<ReturnType<typeof fixture>>) {
	f.faux.setResponses([fauxAssistantMessage("foreground acknowledged")]);
	await f.session.prompt("Ordinary user work.");
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture failure" })]);
	await f.session.prompt("/hermes-review run");
	assert.equal(f.ledger.status()[0].status, "failed");
}

test("failed review stays visible through ordinary answers and public SDK reload; separate status keys and bounded stock rendering", async t => {
	const f = await fixture(t); await fail(f);
	const before = f.ledger.status()[0];
	assert.match(f.statuses.get("hermes-review")!, /PAUSED.*errors 1/);
	f.faux.setResponses([fauxAssistantMessage("ordinary foreground answer")]);
	await f.session.prompt("Answer this normal foreground question.");
	assert.match(f.statuses.get("hermes-memory")!, /memory:/);
	assert.match(f.statuses.get("hermes-review")!, /PAUSED.*errors 1/);
	assert.match(f.widgets.get("hermes-review")!.join("\n"), /failed.*provider-error-or-abort/);
	await f.session.reload();
	assert.match(f.statuses.get("hermes-review")!, /PAUSED.*errors 1/);
	assert.equal(f.ledger.status()[0].id, before.id);
	await f.session.prompt("/hermes-review usage");
	const detail = JSON.parse(f.notices.at(-1)!).detail;
	assert.equal(detail.usage.auxiliary.unknownPrice, 1);
	assert.equal(detail.usage.primary.unknownPrice, 2);
	assert.equal(detail.usage.combined.unknownPrice, 3);
	assert.match(detail.usage.combined.scope, /not a complete provider bill/);
	for (const width of [20, 40, 80]) {
		const lines = new Text(f.widgets.get("hermes-review")!.join("\n"), 0, 0).render(width);
		assert.ok(lines.length > 0);
		assert.ok(lines.every(line => visibleWidth(line) <= width));
	}
	assert.deepEqual(f.errors, []);
});
test("declining recovery does not acknowledge, resume or dispatch", async t => {
	const f = await fixture(t); await fail(f);
	f.setConfirm(async (_title, message) => {
		assert.match(message, /remainingBeforeBooking/); assert.match(message, /Unknown actual usage remains unknown/); return false;
	});
	const calls = f.faux.state.callCount;
	await f.session.prompt("/hermes-review resume");
	await f.session.prompt("/hermes-review retry");
	assert.equal(f.ledger.status()[0].acknowledged, undefined);
	assert.ok(f.ledger.overview().paused);
	assert.equal(f.faux.state.callCount, calls);
	assert.equal(JSON.parse(f.notices.at(-1)!).detail.status, "declined");
});
test("headless recovery/retry return structured confirmation-required without booking or calls", async t => {
	const f = await fixture(t, {}, false);
	const old = f.ledger.admit({ digest: "lost", session: f.sessionManager.getSessionId(), model: "fixture", estimatedInput: 10 });
	f.ledger.finish(old.id, "failed");
	const output: unknown[] = [];
	const write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => {
		for (const line of String(chunk).split("\n")) { try { output.push(JSON.parse(line)); } catch { /* Ignore test-runner output. */ } }
		return true;
	}) as typeof process.stdout.write;
	try {
		await f.session.prompt("/hermes-review resume");
		await f.session.prompt("/hermes-review retry");
	} finally { process.stdout.write = write; }
	const controls = output.filter((value): value is { type: string; detail: { status: string } } => !!value && typeof value === "object" && "type" in value && value.type === "hermes-review");
	assert.equal(controls.length, 2);
	assert.ok(controls.every(value => value.detail.status === "confirmation-required"));
	assert.equal(f.ledger.status()[0].recovery, undefined);
	assert.equal(f.ledger.status()[0].acknowledged, undefined);
	assert.equal(f.faux.state.callCount, 0);
});
test("production retry confirmation dispatches one new request without main-session writes", async t => {
	const f = await fixture(t); await fail(f);
	const old = f.ledger.status()[0];
	const file = f.sessionManager.getSessionFile()!, bytes = readFileSync(file), leaf = f.sessionManager.getLeafId();
	f.faux.setResponses([fauxAssistantMessage('{"candidates":[]}')]);
	await f.session.prompt(`/hermes-review retry ${old.id}`);
	assert.equal(f.faux.state.callCount, 3);
	const result = f.ledger.status()[1];
	assert.equal(result.trigger, "retry"); assert.equal(result.retryOf, old.id);
	assert.equal(result.status, "no-proposal"); assert.equal(result.usageState, "reported");
	assert.deepEqual(readFileSync(file), bytes); assert.equal(f.sessionManager.getLeafId(), leaf);
	assert.equal(f.ledger.overview().paused, undefined);
});
test("confirmed retry cannot spend beyond daily request quota", async t => {
	const f = await fixture(t, { limits: { dailyRequests: 1 } }); await fail(f);
	await f.session.prompt("/hermes-review retry");
	assert.equal(f.faux.state.callCount, 2);
	assert.equal(f.ledger.status()[1].status, "skipped");
	assert.equal(f.ledger.status()[1].reason, "daily-budget");
});
test("foreground context changes during confirmation invalidate it before acknowledgement or new calls", async t => {
	const f = await fixture(t); await fail(f);
	f.setConfirm(async () => {
		f.faux.setResponses([fauxAssistantMessage("changed foreground")]);
		await f.session.prompt("New user input while confirmation was open."); return true;
	});
	await f.session.prompt("/hermes-review retry");
	assert.equal(f.faux.state.callCount, 3, "the only new request is foreground");
	assert.equal(f.ledger.status().length, 1); assert.equal(f.ledger.status()[0].acknowledged, undefined);
	assert.equal(JSON.parse(f.notices.at(-1)!).detail.reason, "retry-context-changed");
});
test("unavailable confirmation UI cannot acknowledge, and ledger corruption stays visible through foreground/reload", async t => {
	const f = await fixture(t); await fail(f);
	f.setConfirm(async () => { throw new Error("UI unavailable"); });
	await f.session.prompt("/hermes-review resume");
	assert.equal(JSON.parse(f.notices.at(-1)!).detail.status, "confirmation-required");
	assert.equal(f.ledger.status()[0].acknowledged, undefined);
	writeFileSync(f.ledger.path, "{corrupted");
	f.faux.setResponses([fauxAssistantMessage("foreground still works")]);
	await f.session.prompt("Ordinary foreground question.");
	assert.match(f.statuses.get("hermes-review")!, /unavailable/);
	await f.session.reload(); assert.match(f.statuses.get("hermes-review")!, /unavailable/);
	await f.session.prompt("/hermes-review run");
	assert.equal(f.faux.state.callCount, 3, "no extra review through corrupt ledger");
	assert.equal(readFileSync(f.ledger.path, "utf8"), "{corrupted");
});

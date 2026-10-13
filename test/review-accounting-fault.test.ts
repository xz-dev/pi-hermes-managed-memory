import assert from "node:assert/strict";
import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

test("late accounting plus fault-write failure remains fenced through read success/reload and restored writes until explicit recovery", async t => {
	let ctx: ExtensionContext | undefined, unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	assert.ok(ctx);
	const statuses = new Map<string, string | undefined>(), notices: string[] = [];
	let consent = true, observeLate = false, lateObserved!: () => void;
	const lateNotification = new Promise<void>(resolve => { lateObserved = resolve; });
	await f.session.bindExtensions({ mode: "tui", uiContext: { ...ctx.ui,
		confirm: async () => consent,
		setStatus: (key, value) => { statuses.set(key, value); if (observeLate && key === "hermes-review" && value?.includes("unavailable")) lateObserved(); },
		notify: message => { notices.push(message); },
	} });
	f.faux.setResponses([fauxAssistantMessage("foreground")]); await f.session.prompt("Ordinary work.");
	let release!: (message: AssistantMessage) => void, entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	f.faux.setResponses([() => { entered(); return new Promise<AssistantMessage>(resolve => { release = resolve; }); }]);
	const run = f.session.prompt("/hermes-review run"); await started;
	await f.session.prompt("/hermes-review cancel"); await run;
	const ledger = new ReviewLedger(f.agentDir), old = ledger.status()[0];
	assert.equal(old.usageState, "unknown");
	await f.session.prompt("/hermes-review resume");
	assert.equal(ledger.status()[0].recovery?.input, 64000);
	// Owned temporary lock directories inject the two persistence failures, no permissions or SDK patching.
	mkdirSync(`${ledger.path}.lock`); mkdirSync(`${ledger.faultPath}.lock`);
	observeLate = true; release(fauxAssistantMessage('{"candidates":[]}'));
	await lateNotification;
	rmdirSync(`${ledger.path}.lock`);
	await f.session.prompt("/hermes-review status");
	assert.match(statuses.get("hermes-review")!, /PAUSED/);
	assert.equal(JSON.parse(notices.at(-1)!).detail.fault.code, "late-accounting-unpersisted");
	await f.session.reload();
	assert.match(statuses.get("hermes-review")!, /PAUSED/);
	const restoredFault = new ReviewLedger(f.agentDir).overview().fault;
	assert.ok(restoredFault && typeof restoredFault === "object" && "code" in restoredFault);
	assert.equal(restoredFault.code, "late-accounting-unpersisted");
	rmdirSync(`${ledger.faultPath}.lock`);
	await f.session.prompt("/hermes-review run");
	assert.equal(f.faux.state.callCount, 2, "restoring writes cannot authorize another auxiliary call");
	assert.equal(ledger.status().at(-1)?.reason, "ledger-settlement-error");
	assert.ok(ledger.overview().fault, "the pending error must be durable before it can be confirmed");
	assert.equal(ledger.status()[0].usageState, "reported", "received telemetry is retained and settled locally, not replayed at the provider");
	assert.equal(ledger.overview().daily.requests, 1);
	assert.equal(ledger.overview().daily.input, 64000, "late settlement does not refund the booking");
	consent = false; await f.session.prompt(`/hermes-review retry ${old.id}`);
	assert.equal(f.faux.state.callCount, 2);
	consent = true; await f.session.prompt("/hermes-review resume");
	f.faux.setResponses([fauxAssistantMessage('{"candidates":[]}')]);
	await f.session.prompt(`/hermes-review retry ${old.id}`);
	assert.equal(f.faux.state.callCount, 3, "only explicit recovered-and-confirmed retry permits the next call");
});

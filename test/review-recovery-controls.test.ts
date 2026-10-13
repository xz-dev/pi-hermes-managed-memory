import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

// Drive the production command through a real SDK context with a public UI binding.
test("unknown request confirmation books reservation without dispatching, survives reload and late partial history", async t => {
	let unbind = async () => {};
	t.after(() => unbind());
	let ctx: ExtensionContext | undefined;
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const ledger = new ReviewLedger(f.agentDir);
	const old = ledger.admit({ digest: "unknown", session: f.sessionManager.getSessionId(), model: "fixture/model", estimatedInput: 100 });
	ledger.finish(old.id, "failed", { input: 12 });
	assert.ok(ctx);
	const ui = { ...ctx.ui, confirm: async (_title: string, message: string) => {
		const preview = JSON.parse(message);
		assert.deepEqual(preview.booking, [{ request: old.id, input: 64000, output: 4096 }]);
		assert.equal(preview.remainingAfterBooking.requests, preview.remainingBeforeBooking.requests);
		return true;
	} };
	await f.session.bindExtensions({ mode: "rpc", uiContext: ui });
	// RPC supports public dialog requests; no TUI component is introduced.
	await f.session.prompt("/hermes-review resume");
	assert.equal(f.faux.state.callCount, 0);
	assert.equal(ledger.status()[0].usageState, "unknown");
	assert.equal(ledger.overview().daily.input, 64000);
	assert.equal(ledger.overview().held.requests, 0);
	await f.session.reload();
	assert.equal(ledger.overview().paused, undefined);
	assert.equal(ledger.status()[0].recovery?.input, 64000);
	ledger.lateUsage(old.id, { input: 30 });
	assert.equal(ledger.overview().daily.input, 64000);
	assert.deepEqual(ledger.status()[0].priorUsage, [{ input: 12 }]);
	assert.equal(f.faux.state.callCount, 0);
	await f.session.bindExtensions({ mode: "json" });
});

test("production cancellation and pause retain charged/unknown records and do not make a second call", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	f.faux.setResponses([fauxAssistantMessage("foreground")]); await f.session.prompt("User work.");
	let signal: AbortSignal | undefined;
	let started!: () => void;
	const entered = new Promise<void>(resolve => { started = resolve; });
	f.faux.setResponses([(_context, options) => {
		signal = options?.signal; assert.ok(signal); started();
		return new Promise<AssistantMessage>(resolve => {
			signal!.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), { once: true });
		});
	}]);
	const running = f.session.prompt("/hermes-review run"); await entered;
	await f.session.prompt("/hermes-review cancel"); await running;
	assert.ok(signal?.aborted);
	const ledger = new ReviewLedger(f.agentDir);
	assert.equal(ledger.status()[0].status, "cancelled");
	assert.notEqual(ledger.status()[0].usageState, "not-sent");
	assert.equal(ledger.overview().daily.requests, 1);
	await f.session.reload(); assert.equal(ledger.overview().paused, "user-paused");
	await f.session.prompt("/hermes-review pause");
	await f.session.prompt("/hermes-review run");
	assert.equal(f.faux.state.callCount, 2);
	assert.equal(ledger.status().at(-1)?.reason, "user-paused");
});

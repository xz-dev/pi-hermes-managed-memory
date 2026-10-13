import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

test("new settlement failure during production confirmation leaves old errors unacknowledged and dispatches nothing", async t => {
	let ctx: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	f.faux.setResponses([fauxAssistantMessage("foreground")]); await f.session.prompt("Ordinary work.");
	f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error" })]); await f.session.prompt("/hermes-review run");
	const ledger = new ReviewLedger(f.agentDir);
	assert.ok(ctx);
	const messages: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...ctx.ui,
		notify: message => { messages.push(message); },
		confirm: async () => { ledger.noteFault("another-request"); return true; },
	} });
	await f.session.prompt("/hermes-review retry");
	assert.equal(f.faux.state.callCount, 2);
	assert.equal(ledger.status().length, 1);
	assert.equal(ledger.status()[0].acknowledged, undefined);
	assert.equal(JSON.parse(messages.at(-1)!).detail.reason, "confirmation-state-changed");
	assert.ok(ledger.overview().fault);
});

test("model change during production confirmation requires new consent and cannot consume unknown reservation", async t => {
	let ctx: ExtensionContext | undefined;
	let unbind = async () => {};
	t.after(() => unbind());
	const f = await sdkFixture(t, { models: [{ id: "first" }, { id: "second" }], extensions: [pi => {
		pi.on("session_start", (_event, context) => { ctx = context; });
		createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi);
	}] });
	unbind = () => f.session.bindExtensions({ mode: "json" });
	const ledger = new ReviewLedger(f.agentDir);
	const old = ledger.admit({ digest: "old", session: f.sessionManager.getSessionId(), model: "fixture/first", estimatedInput: 100 });
	ledger.finish(old.id, "failed");
	assert.ok(ctx);
	const messages: string[] = [];
	await f.session.bindExtensions({ mode: "rpc", uiContext: { ...ctx.ui,
		notify: message => { messages.push(message); },
		confirm: async () => { const model = f.faux.getModel("second"); assert.ok(model); await f.session.setModel(model); return true; },
	} });
	await f.session.prompt("/hermes-review retry");
	assert.equal(f.faux.state.callCount, 0);
	assert.equal(ledger.status()[0].recovery, undefined);
	assert.equal(ledger.status()[0].acknowledged, undefined);
	assert.equal(JSON.parse(messages.at(-1)!).detail.reason, "retry-context-changed");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createMemoryExtension } from "../src/index.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { ReviewLedger } from "../src/review-ledger.ts";
import { sdkFixture } from "./sdk-fixture.ts";

const fact = "I prefer concise answers.", project = "This project uses Cedar build.";
test("one complete json fence saves sourced facts through native review without main-session writes", async t => {
	const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
	f.faux.setResponses([fauxAssistantMessage("acknowledged"), fauxAssistantMessage("acknowledged")]);
	await f.session.prompt(fact);
	const user = f.sessionManager.getBranch().at(-2)!;
	await f.session.prompt(project);
	const source = f.sessionManager.getBranch().at(-2)!;
	const before = readFileSync(f.sessionManager.getSessionFile()!), leaf = f.sessionManager.getLeafId();
	f.faux.setResponses([fauxAssistantMessage("```json\n" + JSON.stringify({ candidates: [
		{ kind: "preference", fact, quote: fact, entry: user.id },
		{ kind: "project-fact", fact: project, quote: project, entry: source.id },
	] }) + "\n```")]);
	await f.session.prompt("/hermes-review run");
	const store = new MemoryStore(f.agentDir, f.cwd), record = new ReviewLedger(f.agentDir).status()[0];
	assert.equal(record.status, "saved");
	assert.equal(store.read("user").entries[0].fact, fact);
	assert.equal(store.read("project").entries[0].fact, project);
	assert.deepEqual(store.read("user").entries[0].source, { session: f.sessionManager.getSessionId(), entry: user.id, quote: fact });
	assert.deepEqual(store.read("project").entries[0].source, { session: f.sessionManager.getSessionId(), entry: source.id, quote: project });
	assert.equal(record.saved.length, 2);
	assert.equal(record.usageState, "reported");
	assert.deepEqual(readFileSync(f.sessionManager.getSessionFile()!), before);
	assert.equal(f.sessionManager.getLeafId(), leaf);
	assert.equal(f.faux.state.callCount, 3);
	assert.deepEqual(f.errors, []);
});

for (const [name, wrap, status] of [
	["outer whitespace and CRLF", (json: string) => ` \n\`\`\`json\r\n${json}\r\n\`\`\`\t`, "saved"],
	["prose before", (json: string) => `Here it is:\n\`\`\`json\n${json}\n\`\`\``, "no-proposal"],
	["prose after", (json: string) => `\`\`\`json\n${json}\n\`\`\`\nDone.`, "no-proposal"],
	["multiple fences", (json: string) => `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``, "no-proposal"],
	["unclosed fence", (json: string) => `\`\`\`json\n${json}`, "no-proposal"],
	["unlabelled fence", (json: string) => `\`\`\`\n${json}\n\`\`\``, "no-proposal"],
	["invalid JSON", (_json: string) => "```json\n{bad-json}\n```", "no-proposal"],
	["invalid schema", (json: string) => `\`\`\`json\n{"extra":true,${json.slice(1)}\n\`\`\``, "no-proposal"],
	["forged entry", (json: string) => `\`\`\`json\n${json.replace(/"entry":"[^"]+"/, '"entry":"foreign"')}\n\`\`\``, "no-proposal"],
] as const) {
	test(`review envelope ${name} keeps one charged request and native authority`, async t => {
		const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt(fact);
		const source = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!;
		const before = readFileSync(f.sessionManager.getSessionFile()!);
		f.faux.setResponses([fauxAssistantMessage(wrap(JSON.stringify({ candidates: [{ kind: "preference", fact, quote: fact, entry: source.id }] })))]);
		await f.session.prompt("/hermes-review run");
		const record = new ReviewLedger(f.agentDir).status()[0], store = new MemoryStore(f.agentDir, f.cwd);
		assert.equal(record.status, status);
		assert.equal(record.usageState, "reported");
		assert.equal(record.saved.length, status === "saved" ? 1 : 0);
		assert.equal(store.read("user").entries.length, status === "saved" ? 1 : 0);
		if (status === "no-proposal") assert.equal(record.reason, "proposal-validation");
		assert.equal(f.faux.state.callCount, 2);
		assert.deepEqual(readFileSync(f.sessionManager.getSessionFile()!), before);
		assert.deepEqual(f.errors, []);
	});
}

for (const [name, sourceText] of [
	["temporary whole source", `${fact}\nFor this task only, do not deploy.`],
	["private whole source", `${fact}\nSecret: do not store this message.`],
] as const) {
	test(`a valid JSON fence cannot bypass ${name} exclusion`, async t => {
		const f = await sdkFixture(t, { extensions: [pi => createMemoryExtension({ projectRoot: join(getAgentDir(), "project") })(pi)] });
		f.faux.setResponses([fauxAssistantMessage("acknowledged")]);
		await f.session.prompt(sourceText);
		const source = f.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").at(-1)!;
		f.faux.setResponses([fauxAssistantMessage(`\`\`\`json\n${JSON.stringify({ candidates: [{ kind: "preference", fact, quote: fact, entry: source.id }] })}\n\`\`\``)]);
		await f.session.prompt("/hermes-review run");
		const record = new ReviewLedger(f.agentDir).status()[0];
		assert.equal(record.status, "no-proposal");
		assert.equal(record.reason, "proposal-validation");
		assert.deepEqual(record.saved, []);
		assert.equal(new MemoryStore(f.agentDir, f.cwd).read("user").entries.length, 0);
		assert.equal(f.faux.state.callCount, 2);
		assert.deepEqual(f.errors, []);
	});
}


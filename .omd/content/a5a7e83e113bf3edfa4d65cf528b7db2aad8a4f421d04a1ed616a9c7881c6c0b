import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import { DEFAULT_LIMITS, ReviewLedger } from "../src/review-ledger.ts";

function root(t: TestContext): string {
	const path = mkdtempSync("/var/tmp/hermes-budget-");
	t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
const usage: Usage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 2, totalTokens: 132,
	cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 } };
function claim(ledger: ReviewLedger, digest = "work") {
	return ledger.admit({ digest, session: "fixture-session", project: "fixture-project", model: "fixture/model", estimatedInput: 1000 });
}
function startOwner(agentDir: string, digest: string, hold: boolean): ChildProcess {
	const module = new URL("../src/review-ledger.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
		import {ReviewLedger} from ${JSON.stringify(module)};
		process.on('message', () => {
			try {
				const row = new ReviewLedger(process.env.FIXTURE_AGENT_DIR).admit({digest:${JSON.stringify(digest)}, session:'fixture', model:'fixture/model', estimatedInput:100});
				process.send({status:row.status, id:row.id});
			} catch(error) { process.send({blocked:true, error:error.message}); }
			if (!${hold}) process.disconnect();
		});
		process.send({ready:true});
	`], { env: { ...process.env, HOME: join(agentDir, "home"), USERPROFILE: join(agentDir, "home"),
		PI_CODING_AGENT_DIR: agentDir, FIXTURE_AGENT_DIR: agentDir }, cwd: agentDir, stdio: ["ignore", "ignore", "pipe", "ipc"] });
	return child;
}

test("two actual processes cannot double-reserve an agentDir and killed owner keeps unknown debt", async t => {
	const dir = root(t);
	const children = [startOwner(dir, "same-work", true), startOwner(dir, "same-work", true)];
	t.after(() => { for (const child of children) child.kill("SIGKILL"); });
	await Promise.all(children.map(child => once(child, "message")));
	const results = children.map(child => once(child, "message"));
	for (const child of children) child.send("claim");
	const replies = await Promise.all(results);
	assert.equal(replies.filter(([row]) => row.status === "admitted").length, 1);
	assert.equal(replies.filter(([row]) => row.blocked || row.status === "skipped").length, 1);
	const ledger = new ReviewLedger(dir);
	const admitted = ledger.status().find(row => row.status === "admitted");
	assert.ok(admitted?.owner);
	assert.deepEqual(admitted.reserved, { input: DEFAULT_LIMITS.input, output: DEFAULT_LIMITS.output });
	const owner = children.find(child => child.pid === admitted.owner?.pid);
	assert.ok(owner);
	const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
	const recovered = new ReviewLedger(dir).status().find(row => row.id === admitted.id);
	assert.equal(recovered?.status, "cancelled");
	assert.equal(recovered?.usageState, "unknown");
	assert.equal(recovered?.costEstimate, undefined);
	assert.deepEqual(recovered?.reserved, admitted.reserved);
	assert.equal(claim(new ReviewLedger(dir), "new-work").status, "skipped");
	assert.equal(new ReviewLedger(dir).status().filter(row => row.usageState !== "not-sent").length, 1);
});

test("reload, duplicate work, and date rollback do not restore spent daily allowance", t => {
	const dir = root(t);
	let date = new Date("2026-10-02T12:00:00Z");
	const clock = () => date;
	const ledger = new ReviewLedger(dir, { ...DEFAULT_LIMITS, dailyRequests: 1 }, clock);
	const admitted = claim(ledger);
	assert.equal(admitted.status, "admitted");
	assert.throws(() => new ReviewLedger(dir).finish(admitted.id, "no-change", usage), /another coordinator/);
	ledger.finish(admitted.id, "no-change", usage);
	date = new Date("2026-10-01T12:00:00Z");
	const reloaded = new ReviewLedger(dir, { ...DEFAULT_LIMITS, dailyRequests: 1 }, clock);
	assert.equal(claim(reloaded).reason, "duplicate-snapshot");
	const blocked = claim(reloaded, "other-work");
	assert.equal(blocked.status, "skipped");
	assert.equal(blocked.reason, "daily-budget");
	assert.equal(blocked.day, "2026-10-02");
	date = new Date("2026-10-03T12:00:00Z");
	assert.equal(claim(reloaded, "next-day-work").status, "admitted");
});

test("expired lease loses commit authority without releasing reservation, including across UTC days", t => {
	const dir = root(t);
	let date = new Date("2026-10-02T23:59:00Z");
	const ledger = new ReviewLedger(dir, { ...DEFAULT_LIMITS, timeoutMs: 1000 }, () => date);
	const admitted = claim(ledger);
	assert.equal(ledger.canCommit(admitted.id), true);
	date = new Date("2026-10-03T00:01:00Z");
	assert.equal(ledger.canCommit(admitted.id), false);
	const unknown = ledger.status()[0];
	assert.equal(unknown.usageState, "unknown");
	assert.deepEqual(unknown.reserved, admitted.reserved);
	assert.equal(claim(ledger, "next-day").status, "skipped");
	const late = ledger.finish(admitted.id, "saved", usage, { saved: ["must-not-commit"] });
	assert.equal(late.status, "cancelled");
	assert.equal(late.usageState, "reported");
	assert.deepEqual(late.saved, []);
	assert.equal(claim(ledger, "after-late-usage").status, "skipped", "late settlement is not automatic user acknowledgement");
});

test("abandoned transaction lock blocks recovery writes without erasing the reserved record", t => {
	const dir = root(t), ledger = new ReviewLedger(dir);
	const admitted = claim(ledger);
	const before = readFileSync(ledger.path);
	mkdirSync(`${ledger.path}.lock`);
	assert.throws(() => claim(new ReviewLedger(dir), "new-work"), /State locked/);
	assert.deepEqual(readFileSync(ledger.path), before);
	assert.equal(JSON.parse(before.toString()).records[0].id, admitted.id);
});

test("missing or corrupt ledger is never initialized as zero usage after first claim", t => {
	for (const damage of ["missing-file", "missing-directory", "invalid-json", "incompatible-version"]) {
		const dir = root(t), ledger = new ReviewLedger(dir);
		claim(ledger);
		if (damage === "missing-file") rmSync(ledger.path);
		else if (damage === "missing-directory") rmSync(join(dir, "hermes-review"), { recursive: true });
		else writeFileSync(ledger.path, damage === "invalid-json" ? "{broken" : JSON.stringify({ version: 2, day: "", records: [] }));
		assert.throws(() => claim(new ReviewLedger(dir), "new-work"));
		assert.equal(readFileSync(ledger.marker, "utf8"), "hermes-review-v1\n");
	}
});

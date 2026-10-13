import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import type { Usage } from "@earendil-works/pi-ai";
import { atomicWrite, hash, readText, withLock } from "./local-state.ts";

export const DEFAULT_LIMITS = { input: 64000, output: 4096, timeoutMs: 90000, dailyRequests: 4, dailyInput: 256000, dailyOutput: 16384 };
export type ReviewLimits = typeof DEFAULT_LIMITS;
export type UsageReport = Partial<Omit<Usage, "cost">> & { cost?: Partial<Usage["cost"]> };
export type ReviewStatus = "admitted" | "saved" | "no-change" | "no-proposal" | "pending" | "conflict" | "failed" | "cancelled" | "skipped";
export interface ReviewRecord {
	id: string; digest: string; day: string; session: string; project?: string; model: string;
	started: string; ended?: string; status: ReviewStatus; reason?: string;
	owner?: { plugin: string; pid: number; host: string; instance: string; deadline: string };
	reserved: { input: number; output: number }; estimatedInput: number;
	job: string; trigger: "manual" | "settled" | "retry"; targets: string[];
	leaf?: string | null; generation?: number;
	/** Settled cadence anchor; native identity only, no source bodies. */
	schedule?: { user: string };
	inputEstimateBasis: "serialized-utf8-bytes"; usageBasis?: "sdk-total-minus-output";
	usage?: UsageReport; priorUsage?: UsageReport[]; input?: number; output?: number; costEstimate?: number;
	prices?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	costBasis?: "sdk-reported-estimate" | "model-table-estimate" | "unknown";
	usageState: "not-sent" | "reserved" | "reported" | "unknown";
	saved: string[]; commits?: { target: string; status: string; ids: string[]; consumer?: string }[];
	phases: ("admitted" | "skipped" | "no-proposal" | "pending" | "conflict" | "saved" | "recalled")[];
	inspected?: string; acknowledged?: string; overrun?: boolean;
	recovery?: { day: string; input: number; output: number; confirmed: string };
	retryOf?: string;
	recalls: { session: string; ids: string[] }[];
}
interface LedgerState { version: 1; day: string; paused?: string; faultAck?: string; records: ReviewRecord[] }
function errorKey(record: ReviewRecord): string {
	return hash(JSON.stringify([record.id, record.status, record.reason, record.overrun]));
}
function attention(record: ReviewRecord): boolean {
	return (record.status === "failed" || record.overrun === true || (record.usageState === "unknown" && !record.recovery)) && record.acknowledged !== errorKey(record);
}
// A recovery booking replaces the original debit; actual telemetry remains separate.
function debit(record: ReviewRecord, day: string): { input: number; output: number } | undefined {
	if (record.usageState === "not-sent" || (record.recovery?.day ?? record.day) !== day) return;
	return record.recovery ?? { input: record.input ?? record.reserved.input, output: record.output ?? record.reserved.output };
}
function tokens(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
export function usageTotals(usage: UsageReport | undefined): { input: number; output: number } | undefined {
	if (!usage || !tokens(usage.input) || !tokens(usage.output) || !tokens(usage.cacheRead) || !tokens(usage.cacheWrite) || !tokens(usage.totalTokens)) return;
	// SDK total includes cache; reasoning and 1h writes are subsets, not extra tokens.
	if (usage.totalTokens < usage.output || usage.totalTokens === 0 ||
		(usage.reasoning !== undefined && (!tokens(usage.reasoning) || usage.reasoning > usage.output)) ||
		(usage.cacheWrite1h !== undefined && (!tokens(usage.cacheWrite1h) || usage.cacheWrite1h > usage.cacheWrite))) return;
	return { input: usage.totalTokens - usage.output, output: usage.output };
}
function price(record: ReviewRecord, usage: UsageReport | undefined): { costEstimate?: number; costBasis: ReviewRecord["costBasis"] } {
	const reported = usage?.cost?.total;
	if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) return { costEstimate: reported, costBasis: "sdk-reported-estimate" };
	const rates = record.prices;
	const values = [rates?.input, rates?.output, rates?.cacheRead, rates?.cacheWrite];
	if (usageTotals(usage) && usage && rates && !usage.cacheWrite1h && values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) && values.some(value => value !== undefined && value > 0)) {
		return { costEstimate: (usage.input! * rates.input + usage.output! * rates.output + usage.cacheRead! * rates.cacheRead + usage.cacheWrite! * rates.cacheWrite) / 1e6, costBasis: "model-table-estimate" };
	}
	return { costEstimate: undefined, costBasis: "unknown" };
}
function settleUsage(record: ReviewRecord, usage: UsageReport | undefined): void {
	if (record.usage && JSON.stringify(record.usage) !== JSON.stringify(usage)) record.priorUsage = [...(record.priorUsage ?? []), record.usage];
	const totals = usageTotals(usage);
	Object.assign(record, { usage, input: totals?.input, output: totals?.output,
		usageState: totals ? "reported" : "unknown", usageBasis: totals ? "sdk-total-minus-output" : undefined, ...price(record, usage) });
}
// A failed disk write still fences every ledger instance for this path in this process.
// No volatile state can promise crash durability while all storage is unwritable.
const pendingKey = Symbol.for("pi-hermes-managed-memory.pending-accounting.v1");
const processState = globalThis as typeof globalThis & { [pendingKey]?: Map<string, Map<string, UsageReport | undefined>> };
const pendingFaults = processState[pendingKey] ??= new Map<string, Map<string, UsageReport | undefined>>();
export class ReviewLedger {
	readonly path: string;
	readonly marker: string;
	readonly faultPath: string;
	private readonly instance = randomUUID();
	private readonly now: () => Date;
	readonly limits: ReviewLimits;
	constructor(agentDir: string, limits: ReviewLimits = DEFAULT_LIMITS, now: () => Date = () => new Date()) {
		this.now = now;
		this.limits = limits;
		this.path = join(agentDir, "hermes-review", "ledger.json");
		this.marker = join(agentDir, "hermes-review.initialized");
		this.faultPath = join(agentDir, "hermes-review.error.json");
		for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid review limit");
	}
	private read(initialize = false): LedgerState {
		const raw = readText(this.path);
		if (raw === undefined) {
			if (existsSync(this.marker) || (!initialize && existsSync(dirname(this.path)))) throw new Error("Ledger missing; refusing to reset budget");
			return { version: 1, day: "", records: [] };
		}
		const state: unknown = JSON.parse(raw);
		if (!state || typeof state !== "object" || !("version" in state) || state.version !== 1 ||
			!("records" in state) || !Array.isArray(state.records) || !("day" in state) || typeof state.day !== "string") throw new Error("Invalid review ledger");
		const seen = new Set<string>();
		for (const record of state.records) {
			const statuses = ["admitted", "saved", "no-change", "no-proposal", "pending", "conflict", "failed", "cancelled", "skipped"];
			const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
			if (!record || typeof record.id !== "string" || seen.has(record.id) || typeof record.digest !== "string" ||
				typeof record.session !== "string" || typeof record.model !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.day) ||
				!statuses.includes(record.status) || !["not-sent", "reserved", "reported", "unknown"].includes(record.usageState) ||
				!number(record.estimatedInput) || !record.reserved || !number(record.reserved.input) || !number(record.reserved.output) ||
				!Array.isArray(record.saved) || !record.saved.every((id: unknown) => typeof id === "string") ||
				!Array.isArray(record.phases) || !Array.isArray(record.recalls)) throw new Error("Damaged request ledger");
			if (record.schedule && (record.trigger !== "settled" || !record.leaf || typeof record.schedule.user !== "string" || !record.schedule.user ||
				Object.keys(record.schedule).some(key => key !== "user"))) throw new Error("Invalid schedule anchor");
			if (record.owner && (typeof record.owner.plugin !== "string" || !Number.isSafeInteger(record.owner.pid) || record.owner.pid < 1 ||
				typeof record.owner.host !== "string" || typeof record.owner.instance !== "string" || !Number.isFinite(Date.parse(record.owner.deadline)))) throw new Error("Invalid request owner");
			if ((record.inspected !== undefined && !/^[a-f0-9]{64}$/.test(record.inspected)) ||
				(record.acknowledged !== undefined && !/^[a-f0-9]{64}$/.test(record.acknowledged)) ||
				(record.overrun !== undefined && typeof record.overrun !== "boolean")) throw new Error("Invalid review acknowledgement");
			if (record.recovery && (!/^\d{4}-\d{2}-\d{2}$/.test(record.recovery.day) || record.recovery.day < record.day ||
				record.recovery.confirmed?.slice(0, 10) !== record.recovery.day ||
				!number(record.recovery.input) || !number(record.recovery.output) ||
				record.recovery.input !== record.reserved.input || record.recovery.output !== record.reserved.output ||
				!Number.isFinite(Date.parse(record.recovery.confirmed)) || ["reserved", "not-sent"].includes(record.usageState))) throw new Error("Invalid recovery booking");
			if (record.usageState === "reported") {
				const totals = usageTotals(record.usage);
				if (!totals || record.input !== totals.input || record.output !== totals.output) throw new Error("Inconsistent reported usage");
			}
			if ((record.status === "admitted") !== (record.usageState === "reserved") ||
				(record.status === "skipped") !== (record.usageState === "not-sent")) throw new Error("Inconsistent request state");
			seen.add(record.id);
		}
		const watermark = state.day;
		if ((watermark === "" && state.records.length > 0) || (watermark !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(watermark)) ||
			state.records.some(record => record.day > watermark || (record.recovery && record.recovery.day > watermark))) throw new Error("Invalid budget date watermark");
		return state as LedgerState;
	}
	private write(state: LedgerState): void {
		if (!existsSync(this.marker)) atomicWrite(this.marker, "hermes-review-v1\n");
		atomicWrite(this.path, JSON.stringify(state, null, 2) + "\n");
	}
	private recover(state: LedgerState): boolean {
		let changed = false;
		for (const record of state.records) {
			if (record.usageState !== "reserved") continue;
			let alive = false;
			if (record.owner?.host === hostname()) {
				try { process.kill(record.owner.pid, 0); alive = true; }
				catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
			}
			if (alive && record.owner && Date.parse(record.owner.deadline) > this.now().getTime()) continue;
			Object.assign(record, { status: "cancelled", usageState: "unknown", costBasis: "unknown",
				ended: this.now().toISOString(), reason: "orphaned-or-expired-request-usage-unknown" });
			state.paused = "unresolved-request-after-recovery"; changed = true;
		}
		return changed;
	}
	status(): ReviewRecord[] {
		if (!existsSync(this.path)) return this.read().records;
		return withLock(`${this.path}.lock`, () => {
			const state = this.read();
			if (this.recover(state)) this.write(state);
			return state.records;
		});
	}
	private fault(): unknown { const raw = readText(this.faultPath); return raw ? JSON.parse(raw) : undefined; }
	private pending(): string[] { return [...(pendingFaults.get(this.path)?.keys() ?? [])]; }
	noteFault(id: string, usage?: UsageReport): void {
		const pending = pendingFaults.get(this.path) ?? new Map<string, UsageReport | undefined>();
		if (usage || !pending.has(id)) pending.set(id, usage ? structuredClone(usage) : undefined);
		pendingFaults.set(this.path, pending);
		this.flushFaults();
	}
	private flushFaults(): void {
		const entries = [...(pendingFaults.get(this.path)?.entries() ?? [])]; if (!entries.length) return;
		withLock(`${this.faultPath}.lock`, () => {
			let previous = this.fault();
			for (const [id, usage] of entries) previous = { code: "late-usage-settlement-failed", id: randomUUID(), request: id,
				at: this.now().toISOString(), unsettledUsage: usage, previous };
			atomicWrite(this.faultPath, JSON.stringify(previous) + "\n");
		});
		// Retry local telemetry settlement only, never the provider request.
		for (const [id, usage] of entries) { if (usage) this.lateUsage(id, usage); pendingFaults.get(this.path)?.delete(id); }
		if (!this.pending().length) pendingFaults.delete(this.path);
	}
	private unresolvedFault(state: LedgerState): unknown {
		const fault = this.fault(); return fault && state.faultAck !== hash(JSON.stringify(fault)) ? fault : undefined;
	}
	private stamp(state: LedgerState, captured = { fault: this.fault(), day: this.now().toISOString().slice(0, 10) }): string {
		const faults = captured.fault && state.faultAck !== hash(JSON.stringify(captured.fault)) ? captured.fault : undefined;
		return hash(JSON.stringify([state, faults, this.limits, captured.day]));
	}
	private summary(state: LedgerState) {
		const today = this.now().toISOString().slice(0, 10);
		const day = today > state.day ? today : state.day;
		const charged = state.records.flatMap(record => { const amount = debit(record, day); return amount ? [{ record, amount }] : []; });
		const input = charged.reduce((sum, item) => sum + item.amount.input, 0);
		const output = charged.reduce((sum, item) => sum + item.amount.output, 0);
		const sent = state.records.filter(record => record.usageState !== "not-sent");
		const errors = state.records.filter(attention);
		const fault = this.pending().length ? { code: "late-accounting-unpersisted", requests: this.pending(), durable: this.unresolvedFault(state) } : this.unresolvedFault(state);
		const unknown = sent.filter(record => ["unknown", "reserved"].includes(record.usageState));
		const held = sent.filter(record => record.usageState === "reserved" || (record.usageState === "unknown" && !record.recovery));
		return { held: { requests: held.length, input: held.reduce((sum, record) => sum + record.reserved.input, 0), output: held.reduce((sum, record) => sum + record.reserved.output, 0) },
			automaticReview: false, paused: state.paused ?? (fault ? "ledger-settlement-error" : errors.length ? "unacknowledged-errors" : undefined),
			fault, day, clockRollback: today < state.day, limits: this.limits, requests: state.records, errors,
			running: state.records.filter(record => record.status === "admitted"), unknownUsage: unknown.length,
			daily: { requests: charged.length, input, output, cacheRead: charged.reduce((sum, item) => sum + (tokens(item.record.usage?.cacheRead) ? item.record.usage!.cacheRead! : 0), 0),
				cacheWrite: charged.reduce((sum, item) => sum + (tokens(item.record.usage?.cacheWrite) ? item.record.usage!.cacheWrite! : 0), 0),
				cacheUnknown: charged.filter(item => !tokens(item.record.usage?.cacheRead) || !tokens(item.record.usage?.cacheWrite)).length,
				remaining: { requests: Math.max(0, this.limits.dailyRequests - charged.length), input: Math.max(0, this.limits.dailyInput - input), output: Math.max(0, this.limits.dailyOutput - output) } },
			knownCostSubtotal: sent.reduce((sum, record) => sum + (record.costEstimate ?? 0), 0),
			unknownPrice: sent.filter(record => record.costEstimate === undefined).length, costBasis: "estimates, not provider invoices",
		};
	}
	overview() {
		if (!existsSync(this.path)) return this.summary(this.read());
		return withLock(`${this.path}.lock`, () => { const state = this.read(); if (this.recover(state)) this.write(state); return this.summary(state); });
	}
	preview() {
		this.flushFaults();
		if (!existsSync(this.path)) { const state = this.read(); return { stamp: this.stamp(state), ...this.summary(state) }; }
		return withLock(`${this.path}.lock`, () => {
			const state = this.read(); this.recover(state);
			for (const record of state.records.filter(attention)) record.inspected = errorKey(record);
			this.write(state); return { stamp: this.stamp(state), ...this.summary(state) };
		});
	}
	pause(reason = "user-paused"): void {
		const fresh = !existsSync(dirname(this.path)) && !existsSync(this.marker);
		withLock(`${this.path}.lock`, () => { const state = this.read(fresh); this.recover(state);
			state.day = [state.day, this.now().toISOString().slice(0, 10)].sort().at(-1)!;
			state.paused = reason; this.write(state); });
	}
	private recoverConfirmed(state: LedgerState, stamp: string): void {
		if (this.pending().length) throw new Error("confirmation-state-changed; accounting fault requires a fresh preview");
		const now = this.now().toISOString(), day = now.slice(0, 10), fault = this.fault();
		if (day < state.day) throw new Error("clock-rollback; recovery refused");
		if (stamp !== this.stamp(state, { fault, day })) throw new Error("confirmation-state-changed; preview again");
		this.recover(state);
		if (state.records.some(record => record.usageState === "reserved")) throw new Error("live-owner; recovery refused");
		for (const record of state.records.filter(attention)) {
			if (record.inspected !== errorKey(record)) throw new Error("uninspected-error; preview again");
			if (record.usageState === "unknown" && !record.recovery) record.recovery = { day, ...record.reserved, confirmed: now };
			record.acknowledged = errorKey(record);
		}
		state.day = day; state.paused = undefined;
		if (fault) state.faultAck = hash(JSON.stringify(fault));
	}
	resume(stamp: string): void {
		const fresh = !existsSync(dirname(this.path)) && !existsSync(this.marker);
		withLock(`${this.path}.lock`, () => { const state = this.read(fresh); this.recoverConfirmed(state, stamp); this.write(state); });
	}
	canCommit(id: string): boolean {
		const record = this.status().find(record => record.id === id);
		return record?.status === "admitted" && record.owner?.instance === this.instance && record.owner.pid === process.pid &&
			Date.parse(record.owner.deadline) > this.now().getTime();
	}
	admit(input: { digest: string; session: string; project?: string; model: string; prices?: ReviewRecord["prices"]; estimatedInput: number; unsupported?: string;
		trigger?: ReviewRecord["trigger"]; targets?: string[]; leaf?: string | null; generation?: number; schedule?: ReviewRecord["schedule"];
		retryOf?: string; confirmation?: string; ownerPlugin?: string }): ReviewRecord {
		this.flushFaults();
		const fresh = !existsSync(dirname(this.path)) && !existsSync(this.marker);
		return withLock(`${this.path}.lock`, () => {
			const state = this.read(fresh);
			if (input.retryOf) {
				if (!input.confirmation || !state.records.some(record => record.id === input.retryOf && !["admitted", "skipped"].includes(record.status))) throw new Error("retry-confirmation-required");
				this.recoverConfirmed(state, input.confirmation);
			}
			this.recover(state);
			const today = this.now().toISOString().slice(0, 10);
			const day = today > state.day ? today : state.day;
			state.day = day;
			let reason = input.unsupported ?? state.paused ?? (this.pending().length ? "late-accounting-unpersisted" : this.unresolvedFault(state) ? "ledger-settlement-error" : undefined);
			const prior = state.records.find(record => record.usageState !== "not-sent" && record.id !== input.retryOf &&
				(record.digest === input.digest || input.trigger === "settled" && input.schedule && record.trigger === "settled" &&
					record.session === input.session && record.project === input.project && record.leaf === input.leaf && record.schedule?.user === input.schedule.user));
			if (prior) reason ??= "duplicate-snapshot";
			if (state.records.some(record => record.usageState === "reserved" || attention(record))) reason ??= "unresolved-or-failed-request";
			if (input.estimatedInput > this.limits.input) reason ??= "input-budget";
			const charged = state.records.flatMap(record => { const amount = debit(record, day); return amount ? [amount] : []; });
			const usedInput = charged.reduce((sum, amount) => sum + amount.input, 0);
			const usedOutput = charged.reduce((sum, amount) => sum + amount.output, 0);
			if (charged.length >= this.limits.dailyRequests || usedInput + this.limits.input > this.limits.dailyInput ||
				usedOutput + this.limits.output > this.limits.dailyOutput) reason ??= "daily-budget";
			const { confirmation: _confirmation, ownerPlugin: _ownerPlugin, ...request } = input;
			const record: ReviewRecord = {
				...request, id: randomUUID(), job: input.digest, trigger: input.trigger ?? "manual", targets: input.targets ?? ["memory"],
				inputEstimateBasis: "serialized-utf8-bytes", day, started: this.now().toISOString(),
				status: reason ? "skipped" : "admitted", reason,
				owner: reason ? undefined : { plugin: input.ownerPlugin ?? "hermes-memory", pid: process.pid, host: hostname(), instance: this.instance,
					deadline: new Date(this.now().getTime() + this.limits.timeoutMs).toISOString() },
				reserved: { input: this.limits.input, output: this.limits.output },
				usageState: reason ? "not-sent" : "reserved", saved: [], recalls: [], phases: [reason ? "skipped" : "admitted"],
			};
			state.records.push(record); this.write(state); return record;
		});
	}
	finish(id: string, status: Exclude<ReviewStatus, "admitted" | "skipped">, usage?: UsageReport, details: {
		reason?: string; saved?: string[]; commits?: ReviewRecord["commits"];
	} = {}): ReviewRecord {
		return withLock(`${this.path}.lock`, () => {
			const state = this.read();
			const record = state.records.find(record => record.id === id);
			if (!record) throw new Error("Unknown review request");
			const totals = usageTotals(usage);
			if (record.status !== "admitted") {
				if (record.usageState === "unknown" && usage && JSON.stringify(record.usage) !== JSON.stringify(usage)) {
					settleUsage(record, usage);
					this.overrun(state, record);
					this.write(state);
				}
				return record;
			}
			if (record.owner?.instance !== this.instance || record.owner.pid !== process.pid) throw new Error("Request owned by another coordinator");
			Object.assign(record, details, { status, ended: this.now().toISOString() });
			settleUsage(record, usage);
			if (!totals || status === "failed") state.paused ??= details.reason ?? "review-failed-or-usage-unknown";
			this.overrun(state, record);
			if (record.saved.length) record.phases.push("saved");
			if (["conflict", "no-proposal", "pending"].includes(status)) record.phases.push(status as "conflict" | "no-proposal" | "pending");
			this.write(state); return record;
		});
	}
	private overrun(state: LedgerState, record: ReviewRecord): void {
		const lowerBound = (fields: (keyof UsageReport)[]) => Math.max(0, ...fields.map(field => tokens(record.usage?.[field]) ? record.usage![field] as number : 0));
		const input = record.input ?? lowerBound(["input", "cacheRead", "cacheWrite", "cacheWrite1h"]);
		const output = record.output ?? lowerBound(["output", "reasoning"]);
		if (input > record.reserved.input || output > record.reserved.output || lowerBound(["totalTokens"]) > record.reserved.input + record.reserved.output) {
			record.overrun = true; record.acknowledged = undefined; state.paused = "reported-budget-overrun";
		}
	}
	lateUsage(id: string, usage: UsageReport): void {
		withLock(`${this.path}.lock`, () => {
			const state = this.read();
			const record = state.records.find(record => record.id === id);
			if (!record || record.usageState !== "unknown") return;
			if (JSON.stringify(record.usage) === JSON.stringify(usage)) return;
			settleUsage(record, usage);
			this.overrun(state, record);
			this.write(state);
		});
	}
	recalled(session: string, ids: string[]): void {
		if (!readText(this.path)) return;
		withLock(`${this.path}.lock`, () => {
			const state = this.read();
			for (const record of state.records) {
				const used = ids.filter(id => record.saved.includes(id));
				if (!used.length || record.recalls.some(recall => recall.session === session && JSON.stringify(recall.ids) === JSON.stringify(used))) continue;
				record.recalls.push({ session, ids: used });
				if (!record.phases.includes("recalled")) record.phases.push("recalled");
			}
			this.write(state);
		});
	}
}

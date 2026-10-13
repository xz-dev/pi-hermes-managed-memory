import { randomUUID } from "node:crypto";
import type { Message, Tool } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hash } from "./local-state.ts";

export const REVIEW_CHANNEL = "hermes.review.v1";
export const MEMORY_PARTICIPANT = "hermes-memory";
export interface ReviewSnapshot {
	digest: string; session: string; project?: string; leaf: string | null; generation: number;
	messages: Message[]; tools: Tool[]; userTurns: number; toolTurns: number;
}
export interface ReviewContribution {
	targets: { target: string; version: string }[];
	instruction: string; context: unknown;
}
export interface ConsumerResult { target: string; status: string; ids: string[]; consumer?: string }
export interface Participant { id: string; instance: string; version: number }
export type ReviewEvent =
	| { type: "discover"; ack: (participant: Participant) => void }
	| { type: "collect"; participant: string; instance: string; snapshot: ReviewSnapshot; trigger: "settled" | "manual" | "retry"; ack: (contribution: ReviewContribution | undefined) => void }
	| { type: "validate"; participant: string; instance: string; contribution: ReviewContribution; ack: (valid: boolean) => void }
	| { type: "dispatch"; participant: string; instance: string; execute: () => Promise<unknown>; ack: () => void }
	| { type: "commit"; participant: string; instance: string; requestId: string; contribution: ReviewContribution; proposal: unknown; valid: () => boolean; ack: (results: ConsumerResult[]) => void };
export interface SharedReview {
	owner: string; stamp: string; targets: string[];
	participants: Participant[]; contributions: { participant: Participant; contribution: ReviewContribution }[];
}
const ACK_MS = 100;
const identity = (p: Participant) => /^[a-z][a-z0-9-]{0,63}$/.test(p.id) && typeof p.instance === "string" && p.instance.length > 0 && p.instance.length <= 128;
function immutable<T>(value: T): T {
	const copy = structuredClone(value);
	const freeze = (item: unknown) => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
	freeze(copy); return copy;
}

/** One in-process rendezvous; durable admission/accounting remain exclusively in ReviewLedger.
 * EventBus.emit is void and swallows listener failures. Only bounded explicit acks count. */
export class ReviewCoordinator {
	private readonly self: Participant = { id: MEMORY_PARTICIPANT, instance: randomUUID(), version: 1 };
	private known: Participant[] = [];
	private readonly events: ExtensionAPI["events"];
	constructor(events: ExtensionAPI["events"]) { this.events = events; }
	private async discover(): Promise<Participant[]> {
		const found: Participant[] = [this.self];
		let open = true, invalid = false;
		this.events.emit(REVIEW_CHANNEL, { type: "discover", ack: (p: Participant) => {
			if (!open) return;
			if (!p || typeof p.id !== "string" || typeof p.instance !== "string" || typeof p.version !== "number" || found.length >= 2) { invalid = true; return; }
			found.push({ id: p.id, instance: p.instance, version: p.version });
		} } satisfies ReviewEvent);
		await new Promise(resolve => setTimeout(resolve, ACK_MS)); open = false;
		if (invalid || found.some(p => p.id === "memory" || !identity(p) || p.version !== 1) || new Set(found.map(p => p.id)).size !== found.length) throw new Error("review-protocol-incompatible-or-ambiguous");
		const peers = found.filter(p => p.id !== MEMORY_PARTICIPANT);
		if (this.known.some(p => !peers.some(q => p.id === q.id && p.instance === q.instance))) throw new Error("review-participant-stale");
		this.known = peers;
		return found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	}
	private ack<T>(build: (ack: (value: T) => void, active: () => boolean) => ReviewEvent): Promise<T> {
		return new Promise((resolve, reject) => {
			let open = true, count = 0, value: T;
			const timer = setTimeout(() => {
				open = false;
				if (count !== 1) reject(new Error("review-ack-missing-or-duplicate")); else resolve(value);
			}, ACK_MS);
			try { this.events.emit(REVIEW_CHANNEL, build(v => { if (open) { count++; value = v; } }, () => open && count === 0)); }
			catch { clearTimeout(timer); open = false; reject(new Error("review-transport-unavailable")); }
		});
	}
	async collect(snapshot: ReviewSnapshot, memory: ReviewContribution | undefined, trigger: "settled" | "manual" | "retry", selected?: string[]): Promise<SharedReview | undefined> {
		const participants = await this.discover();
		const contributions: SharedReview["contributions"] = [];
		for (const participant of participants) {
			const contribution = participant.id === MEMORY_PARTICIPANT ? memory : await this.ack<ReviewContribution | undefined>(ack => ({
				type: "collect", participant: participant.id, instance: participant.instance, snapshot: immutable(snapshot), trigger, ack,
			}));
			if (!contribution || !contribution.targets.length) continue;
			if (contribution.targets.length > 16 || typeof contribution.instruction !== "string" ||
				contribution.targets.some(t => !/^[a-z][a-z0-9-]{0,63}$/.test(t.target) || typeof t.version !== "string") ||
				new Set(contribution.targets.map(t => t.target)).size !== contribution.targets.length ||
				Buffer.byteLength(JSON.stringify(contribution)) > 64000) throw new Error("review-contribution-invalid");
			// Manual review means memory intent. Retry cannot silently acquire newly due targets.
			if (participant.id !== MEMORY_PARTICIPANT && trigger === "manual") continue;
			const prefix = participant.id === MEMORY_PARTICIPANT ? "memory" : participant.id;
			const targets = contribution.targets.map(t => `${prefix}:${t.target}`);
			if (selected && targets.some(t => !selected.includes(t))) throw new Error("retry-context-changed");
			contributions.push({ participant, contribution: immutable(contribution) });
		}
		const targets = contributions.flatMap(c => c.contribution.targets.map(t => `${c.participant.id === MEMORY_PARTICIPANT ? "memory" : c.participant.id}:${t.target}`));
		if (selected && JSON.stringify([...selected].sort()) !== JSON.stringify([...targets].sort())) throw new Error("retry-context-changed");
		if (!targets.length) return;
		const owner = contributions[0].participant.id;
		return { owner, participants, contributions, targets, stamp: hash(JSON.stringify([participants, contributions])) };
	}
	async checkParticipants(shared: SharedReview): Promise<void> {
		if (JSON.stringify(await this.discover()) !== JSON.stringify(shared.participants)) throw new Error("review-participant-changed");
	}
	async validate(shared: SharedReview): Promise<void> {
		await this.checkParticipants(shared);
		for (const { participant, contribution } of shared.contributions) {
			if (participant.id === MEMORY_PARTICIPANT) continue;
			if (await this.ack<boolean>(ack => ({ type: "validate", participant: participant.id, instance: participant.instance, contribution, ack })) !== true) throw new Error("review-contribution-stale");
		}
	}
	async dispatch(shared: SharedReview, execute: () => Promise<unknown>): Promise<unknown> {
		if (shared.owner === MEMORY_PARTICIPANT) return execute();
		const owner = shared.contributions.find(c => c.participant.id === shared.owner)!.participant;
		let released = false, called = false;
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		let result: Promise<unknown> | undefined;
		const invoke = () => {
			if (called) return Promise.reject(new Error("review-dispatch-duplicate"));
			called = true;
			result = gate.then(() => { if (!released) throw new Error("review-dispatch-revoked"); return execute(); });
			void result.catch(() => {}); return result;
		};
		try {
			await this.ack<void>(ack => ({ type: "dispatch", participant: owner.id, instance: owner.instance, execute: invoke, ack }));
			if (!called) throw new Error("review-owner-did-not-dispatch");
			await this.checkParticipants(shared);
			released = true; release(); return await result;
		} finally { release(); }
	}
	async commit(shared: SharedReview, requestId: string, proposals: Record<string, unknown>, valid: () => boolean): Promise<ConsumerResult[]> {
		const results: ConsumerResult[] = [];
		for (const { participant, contribution } of shared.contributions) {
			if (participant.id === MEMORY_PARTICIPANT) continue;
			try {
				if (!valid() || JSON.stringify(await this.discover()) !== JSON.stringify(shared.participants)) throw new Error("review-commit-stale");
				const commits = await this.ack<ConsumerResult[]>((ack, active) => ({ type: "commit", participant: participant.id, instance: participant.instance,
					requestId, contribution, proposal: immutable(proposals[participant.id]), valid: () => active() && valid(), ack }));
				if (!Array.isArray(commits) || commits.length !== contribution.targets.length || commits.some(c =>
					!contribution.targets.some(t => t.target === c.target) || !["saved", "no-change", "no-proposal", "pending", "conflict", "rejected", "failed", "cancelled"].includes(c.status) ||
					!Array.isArray(c.ids) || c.ids.length > 16 || c.ids.some(id => typeof id !== "string" || id.length > 128)) || new Set(commits.map(c => c.target)).size !== commits.length) throw new Error("review-commit-invalid");
				results.push(...commits.map(c => ({ status: c.status, ids: [...c.ids], consumer: participant.id, target: `${participant.id}:${c.target}` })));
			} catch { results.push(...contribution.targets.map(t => ({ consumer: participant.id, target: `${participant.id}:${t.target}`, status: "failed", ids: [] }))); }
		}
		return results;
	}
}

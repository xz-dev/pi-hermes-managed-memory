import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ReviewRecord } from "./review-ledger.ts";

export interface ReviewSchedule {
	enabled: boolean; cadence: number; userTurns: number; toolTurns: number;
	progress: number; due: boolean; attempted: boolean; reason?: string;
}
/** Native selected-branch identities count work, never converted summaries or message bodies.
 * Ledger leaves anchor consumed work to this branch without late native bookkeeping writes. */
export function reviewSchedule(branch: SessionEntry[], records: ReviewRecord[], session: string, project: string | undefined, enabled: boolean): ReviewSchedule {
	const native = [...new Map(branch.map(entry => [entry.id, entry])).values()];
	const users = native.filter(entry => entry.type === "message" && entry.message.role === "user");
	const toolTurns = native.filter(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(block => block.type === "toolCall")).length;
	const positions = new Map(native.map((entry, index) => [entry.id, index]));
	const relevant = records.filter(record => record.targets.some(target => target === "memory" || target.startsWith("memory:")) && record.trigger === "settled" && record.session === session && record.project === project && record.schedule && record.leaf && positions.has(record.leaf) &&
		users.some(user => user.id === record.schedule!.user && positions.get(user.id)! <= positions.get(record.leaf!)!));
	const processed = relevant.filter(record => record.usageState !== "not-sent").reduce((end, record) => Math.max(end, positions.get(record.leaf!)!), -1);
	const progress = users.filter(entry => positions.get(entry.id)! > processed).length;
	const latest = relevant.filter(record => record.schedule?.user === users.at(-1)?.id).at(-1);
	return { enabled, cadence: 10, userTurns: users.length, toolTurns, progress, due: progress >= 10,
		attempted: !!latest, reason: !enabled ? "disabled" : latest?.reason };
}

/** Shared attempts consume a native work boundary, not every descendant of its user.
 * A new user OR tool-bearing assistant entry beyond the last on-branch attempt permits
 * collection. Custom/no-work continuations and repeated/reloaded boundaries do not. */
export function reviewWorkPending(branch: SessionEntry[], records: ReviewRecord[], session: string, project: string | undefined): boolean {
	const native = [...new Map(branch.map(entry => [entry.id, entry])).values()];
	const positions = new Map(native.map((entry, index) => [entry.id, index]));
	const attempted = records.filter(record => record.trigger === "settled" && record.session === session && record.project === project &&
		record.schedule && record.leaf && positions.has(record.leaf) && native.some(entry => entry.id === record.schedule!.user &&
			entry.type === "message" && entry.message.role === "user" && positions.get(entry.id)! <= positions.get(record.leaf!)!))
		.reduce((end, record) => Math.max(end, positions.get(record.leaf!)!), -1);
	return native.slice(attempted + 1).some(entry => entry.type === "message" && (entry.message.role === "user" ||
		entry.message.role === "assistant" && entry.message.content.some(block => block.type === "toolCall")));
}

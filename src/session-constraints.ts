import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseSessionEntries, type SessionEntry, type SessionHeader } from "@earendil-works/pi-coding-agent";
import { hash, readText } from "./local-state.ts";

/** Branch-local custom entry type carrying the explicit session/task lifecycle (D1 session target). */
export const SESSION_CUSTOM_TYPE = "hermes.session";

export type ConstraintOp = "task" | "task-complete" | "register" | "replace" | "cancel" | "finish";
export interface ConstraintSource { session: string; entry: string; quote: string }
export interface ConstraintRecord {
	id: string;
	task: string;
	scope: "session";
	text: string;
	source: ConstraintSource;
	version: string;
	registeredAt: string;
}
export interface SessionConstraintState {
	/** Current explicitly selected task; undefined means no task is selected. */
	task?: string;
	/** Completed task ids; terminal, never re-activated by re-selecting the same task. */
	completedTasks: string[];
	/** Active constraints eligible for the current task only. */
	constraints: ConstraintRecord[];
	/** Content identity of task + active constraint versions + diagnostics; binds the working key. */
	version: string;
	/** Fold-time rejections: invalid sources, stale versions, duplicates, damaged records. */
	diagnostics: string[];
	/** True when the fold saw damaged/uncertain records; callers must not gate on an empty set. */
	uncertain: boolean;
}

const OPS: ConstraintOp[] = ["task", "task-complete", "register", "replace", "cancel", "finish"];
const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && !!value.trim();

/** Content-bound version of one committed constraint record; the same function must be used by
 *  admission-time capacity checks and the fold so a saved record can never undercount. */
export function constraintVersion(record: Omit<ConstraintRecord, "version"> & { replaces?: string }): string {
	return hash(JSON.stringify([record.id, record.task, record.scope, record.text, record.source, record.registeredAt, record.replaces])).slice(0, 16);
}

function validSource(value: unknown): value is ConstraintSource {
	return object(value) && Object.keys(value).every(key => ["session", "entry", "quote"].includes(key)) &&
		identifier(value.session) && identifier(value.entry) && identifier(value.quote);
}

function userMessageText(message: SessionEntry & { type: "message" }): string {
	const content = message.message.role === "user" ? message.message.content : undefined;
	return typeof content === "string" ? content :
		Array.isArray(content) ? content.map(part => part.type === "text" ? part.text : "").join("") : "";
}

/** Latest ordinary user message entry on the current branch; commands themselves are not messages. */
export function latestUserEntry(entries: SessionEntry[]): { id: string; text: string } | undefined {
	const message = [...entries].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
	if (!message || message.type !== "message") return undefined;
	return { id: message.id, text: userMessageText(message) };
}

/** Resolve a user-message entry on the CURRENT branch; refuses assistant/tool/custom/foreign ids. */
export function userEntryById(entries: SessionEntry[], id: string): { id: string; text: string } | undefined {
	const entry = entries.find(candidate => candidate.id === id);
	if (!entry || entry.type !== "message" || entry.message.role !== "user") return undefined;
	return { id: entry.id, text: userMessageText(entry) };
}

/** Trusted public header of the selected native session, never taken from tool arguments. */
export type ConstraintOrigin = Pick<SessionHeader, "id" | "parentSession">;

/** Verify only the declared native fork ancestry; never discover or merge other timelines.
 *  The original locator survives copying, but must name an ancestor's identical user entry.
 *  Missing, cyclic or unreadable origin evidence remains unknown rather than fabricated. */
function verifiedOrigin(source: ConstraintSource, user: { id: string; text: string }, origin?: ConstraintOrigin): boolean {
	if (!origin) return false;
	if (source.session === origin.id) return true;
	let parent = origin.parentSession;
	const visited = new Set<string>();
	while (parent) {
		try {
			if (!isAbsolute(parent)) return false;
			const path = realpathSync(parent);
			if (visited.has(path)) return false;
			visited.add(path);
			const text = readText(path);
			if (text === undefined) return false;
			const entries = parseSessionEntries(text);
			const header = entries[0];
			if (header?.type !== "session") return false;
			if (header.id === source.session) {
				const evidence = userEntryById(entries.filter((entry): entry is SessionEntry => entry.type !== "session"), source.entry);
				return evidence?.text === user.text;
			}
			parent = header.parentSession;
		} catch { return false; }
	}
	return false;
}

/**
 * Fold the current-branch custom-entry tail into session constraint state. Entries from other
 * branches never reach this fold because the caller supplies `getBranch()` output only.
 * Terminal semantics: cancel/finish retire one constraint; task-complete terminalizes the whole
 * task so re-selecting the same task id does not revive its constraints. Damaged/foreign-source/
 * stale-version records are reported in `diagnostics` and set `uncertain` — never silently
 * erased, never treated as proof that zero constraints exist.
 */
export function foldConstraints(entries: SessionEntry[], origin?: ConstraintOrigin): SessionConstraintState {
	const records = new Map<string, ConstraintRecord & { terminal?: boolean }>();
	const retired = new Map<string, Set<string>>();
	const retire = (record: ConstraintRecord) => {
		const versions = retired.get(record.id) ?? new Set<string>();
		versions.add(record.version); retired.set(record.id, versions);
	};
	const diagnostics: string[] = [];
	const completedTasks = new Set<string>();
	let uncertain = false;
	let task: string | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SESSION_CUSTOM_TYPE) continue;
		const data: unknown = entry.data;
		if (!object(data) || data.v !== 1 || typeof data.op !== "string" || !OPS.includes(data.op as ConstraintOp)) {
			diagnostics.push(`${entry.id}: damaged session constraint record`);
			uncertain = true;
			continue;
		}
		const op = data.op as ConstraintOp;
		if (op === "task") {
			if (!identifier(data.task)) { diagnostics.push(`${entry.id}: task switch without task id`); uncertain = true; continue; }
			task = data.task;
			continue;
		}
		if (op === "task-complete") {
			// Terminalizes the named (or current) task: selector cleared and every constraint for
			// that task is terminal. Re-selecting the id never revives terminal records.
			const finished = identifier(data.task) ? data.task : task;
			if (!finished) { diagnostics.push(`${entry.id}: task-complete without a task`); uncertain = true; continue; }
			if (identifier(data.task) && data.task !== task) {
				// Completing a non-current task is an explicit terminal op for that task only.
				completedTasks.add(data.task);
				for (const [id, record] of records) if (record.task === data.task) { retire(record); records.set(id, { ...record, terminal: true }); }
				continue;
			}
			completedTasks.add(finished);
			for (const [id, record] of records) if (record.task === finished) { retire(record); records.set(id, { ...record, terminal: true }); }
			if (task === finished) task = undefined;
			continue;
		}
		if (op === "register" || op === "replace") {
			if (!identifier(data.id) || !identifier(data.task) || !identifier(data.text) ||
				!identifier(data.registeredAt) || !validSource(data.source)) {
				diagnostics.push(`${entry.id}: damaged ${op} record`); uncertain = true; continue;
			}
			if (data.scope !== undefined && data.scope !== "session") {
				diagnostics.push(`${entry.id}: unsupported scope ${String(data.scope)}`); uncertain = true; continue;
			}
			if (!identifier(task) || data.task !== task) {
				diagnostics.push(`${entry.id}: ${op} for non-current task ${String(data.task)}`); uncertain = true; continue;
			}
			if (completedTasks.has(task)) {
				diagnostics.push(`${entry.id}: ${op} into completed task ${task}`); uncertain = true; continue;
			}
			const source = userEntryById(entries, data.source.entry);
			if (!source || data.source.quote !== data.text || !source.text.includes(data.source.quote) || !verifiedOrigin(data.source, source, origin)) {
				diagnostics.push(`${entry.id}: ${op} source session/entry/quote is not verified on the current branch`);
				uncertain = true; continue;
			}
			const prior = records.get(data.id);
			// IDs remain owned by their original task, including after cancellation/completion.
			if (prior && prior.task !== data.task) {
				diagnostics.push(`${entry.id}: ${op} cannot transfer constraint ${data.id} to task ${data.task}`); uncertain = true; continue;
			}
			if (op === "register") {
				if (prior && !prior.terminal) { diagnostics.push(`${entry.id}: duplicate registration ${data.id}`); uncertain = true; continue; }
			} else {
				if (!prior || prior.terminal) { diagnostics.push(`${entry.id}: replace of unknown/terminal ${data.id}`); uncertain = true; continue; }
				if (!identifier(data.expect) || data.expect !== prior.version) {
					diagnostics.push(`${entry.id}: stale replace version for ${data.id}`); uncertain = true; continue;
				}
			}
			const record: ConstraintRecord = {
				id: data.id, task: data.task, scope: "session",
				text: data.text, source: data.source, registeredAt: data.registeredAt,
				version: constraintVersion({ id: data.id, task: data.task, scope: "session", text: data.text,
					source: data.source, registeredAt: data.registeredAt, replaces: op === "replace" ? prior!.version : undefined }),
			};
			if (retired.get(record.id)?.has(record.version)) {
				diagnostics.push(`${entry.id}: replay of retired constraint version ${record.id}`); uncertain = true; continue;
			}
			if (prior) retire(prior);
			records.set(record.id, record);
			continue;
		}
		// cancel | finish: explicit terminal transition bound to the exact observed version.
		if (!identifier(data.id)) { diagnostics.push(`${entry.id}: ${op} without constraint id`); uncertain = true; continue; }
		const prior = records.get(data.id);
		if (!prior || prior.terminal) { diagnostics.push(`${entry.id}: ${op} of unknown/terminal ${data.id}`); uncertain = true; continue; }
		if (!identifier(data.expect) || data.expect !== prior.version) {
			diagnostics.push(`${entry.id}: stale ${op} version for ${data.id}`); uncertain = true; continue;
		}
		retire(prior);
		records.set(data.id, { ...prior, terminal: true });
	}
	const constraints = [...records.values()]
		.filter(record => !record.terminal && record.task === task && !completedTasks.has(record.task))
		.map(({ terminal: _t, ...record }) => record);
	return {
		task, constraints, diagnostics, uncertain, completedTasks: [...completedTasks],
		version: hash(JSON.stringify({ task, completed: [...completedTasks],
			active: constraints.map(record => [record.id, record.version]) })).slice(0, 16),
	};
}

/** Exact scalar-bounded lines, first in the owned section before durable facts (shared budget D4). */
export function constraintLines(state: SessionConstraintState): string[] {
	const quote = (value: string) => JSON.stringify(value).replace(/[<>]/g, char => char === "<" ? "\\u003c" : "\\u003e");
	return state.constraints.map(record =>
		`[session constraint id=${quote(record.id)} task=${quote(record.task)} scope=${quote(record.scope)} version=${quote(record.version)} source=${quote(`${record.source.session}/${record.source.entry}`)}] Active task constraint: ${quote(record.text)}\n`);
}

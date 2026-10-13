import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendLine, atomicWrite, hash, readText, withLock } from "./local-state.ts";

export type FileTarget = "user" | "global" | "project";
export type Target = FileTarget | "session";
export type Source = { session: string; entry: string; quote: string } | { kind: "user-authored" | "unknown" };
export interface MemoryEntry { id: string; fact: string; source: Source; created: string; updated: string }
export interface Removal { id: string; expectedFact: string }
export interface MemoryBatch { additions?: MemoryEntry[]; replacements?: { id: string; expectedFact: string; entry: MemoryEntry }[]; removals?: Removal[]; proposal?: string }
export interface MutationResult { status: "saved" | "no-change" | "conflict"; ids: string[]; version: string; forgotten?: string[]; reason?: string }
export interface Tombstone { id: string; factHash: string }
export interface MemorySnapshot { target: FileTarget; path: string; present?: boolean; version: string; epoch: string; blocked: boolean; entries: MemoryEntry[]; raw: string; diagnostics: string[]; tombstones: Tombstone[]; journal: string }
export const CAPS: Record<FileTarget, number> = { user: 1375, global: 2200, project: 2200 };
const NAMES: Record<FileTarget, string> = { user: "USER.md", global: "MEMORY.md", project: "PROJECT.md" };
function contains(root: string, path: string): boolean {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}
function scopedPath(root: string, path: string): string {
	if (!contains(root, path)) throw new Error("Memory target outside scope");
	for (let current = path; current !== root; current = dirname(current)) {
		try { if (lstatSync(current).isSymbolicLink()) throw new Error("Symlinked memory target; scope redirect refused"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
	return path;
}

export function projectRoot(cwd: string, explicit?: string): string | undefined {
	if (explicit) {
		const root = realpathSync(explicit), current = realpathSync(cwd);
		return contains(root, current) ? root : undefined;
	}
	try {
		const root = realpathSync(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3000,
		}).trim());
		return contains(root, realpathSync(cwd)) ? root : undefined;
	} catch { return undefined; }
}
function validSource(value: unknown): value is Source {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	if ("kind" in value) return keys.length === 1 && (value.kind === "user-authored" || value.kind === "unknown");
	return keys.length === 3 && "session" in value && typeof value.session === "string" && !!value.session.trim() &&
		"entry" in value && typeof value.entry === "string" && !!value.entry.trim() && "quote" in value && typeof value.quote === "string" && !!value.quote.trim();
}
function validMetadata(value: unknown): value is Omit<MemoryEntry, "fact"> & { schema?: 1 } {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["schema", "id", "source", "created", "updated"].includes(key))) return false;
	const timestamp = (date: unknown) => typeof date === "string" && (date === "unknown" || (/^\d{4}-\d{2}-\d{2}T/.test(date) && Number.isFinite(Date.parse(date))));
	return (!("schema" in value) || value.schema === 1) && "id" in value && typeof value.id === "string" && !!value.id.trim() &&
		"source" in value && validSource(value.source) && "created" in value && timestamp(value.created) && "updated" in value && timestamp(value.updated);
}
function parse(raw: string): { entries: MemoryEntry[]; diagnostics: string[] } {
	const entries: MemoryEntry[] = [], diagnostics: string[] = [], plainBlocks = new Set<string>();
	for (const block of raw.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)) {
		const managed = /^<!-- hermes-entry (.+) -->\n([\s\S]+)$/.exec(block);
		if (managed) {
			const value: unknown = JSON.parse(managed[1]);
			if (!validMetadata(value)) throw new Error("Invalid or unsupported managed entry metadata");
			const fact = managed[2].replace(/^- /, "").trimEnd();
			if (!fact.trim()) throw new Error("Empty managed fact");
			let source = value.source, updated = value.updated;
			if ("quote" in source && fact !== source.quote.trim()) {
				source = { kind: "user-authored" }; updated = "unknown";
				diagnostics.push(`${value.id}: user-edited body; original citation not applied`);
			}
			entries.push({ id: value.id, fact, source, created: value.created, updated });
		} else {
			if (/<!--\s*hermes-entry\b/.test(block)) throw new Error("Damaged managed entry; refusing overwrite");
			if (plainBlocks.has(block)) continue;
			plainBlocks.add(block);
			const id = `authored-${hash(block).slice(0,16)}`;
			entries.push({ id, fact: block.replace(/^- /, ""),
				source: { kind: "user-authored" }, created: "unknown", updated: "unknown" });
		}
	}
	if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Duplicate memory identity");
	return { entries, diagnostics };
}
function render(entries: MemoryEntry[]): string {
	return entries.map(({ fact, ...metadata }) => `<!-- hermes-entry ${JSON.stringify({ schema: 1, ...metadata })} -->\n- ${fact}`).join("\n\n") + (entries.length ? "\n" : "");
}
function validateEntry(entry: MemoryEntry): void {
	if (typeof entry.fact !== "string" || !entry.fact.trim() || /[\r\n]|<!--|-->/.test(entry.fact)) throw new Error("Memory must be one complete fact");
	const { fact, ...metadata } = entry;
	if (!validMetadata(metadata) || ("quote" in entry.source && entry.source.quote.trim() !== fact)) throw new Error("Invalid addition provenance");
}
type Intent = { v: 1; type: "intent"; id: string; proposal?: string; base: string; after: string; at: string;
	outcome: "saved" | "no-change"; ids: string[]; forgotten?: string[]; tombstones: Tombstone[]; restores?: Tombstone[]; rollback?: boolean; reverts?: string };
type Result = { v: 1; type: "result"; intent: string; proposal?: string; status: MutationResult["status"]; ids: string[]; forgotten?: string[]; at: string };
type PendingRecord = { v: 1; type: "pending"; id: string; base: string; epoch: string; batch: MemoryBatch; reason: string; summary: string; at: string };
type JournalRecord = Intent | Result | PendingRecord
	| { v: 1; type: "init"; scope: string }
	| { v: 1; type: "pending-status"; id: string; status: "approved" | "denied" | "stale"; at: string };
export interface PendingProposal { id: string; stamp: string; target: FileTarget; base: string; reason: string; summary: string; staged: string; stale?: boolean; diff: { id: string; kind: "addition" | "replacement" | "removal"; old?: string; fact: string }[] }
interface Journal {
	intents: Map<string, Intent>;
	results: Map<string, Result>;
	byProposal: Map<string, Result>;
	pending: Map<string, PendingRecord>;
	pendingStatus: Map<string, "approved" | "denied" | "stale">;
	tombstones: Tombstone[];
	diagnostics: string[];
	recovery: JournalRecord[];
	blocked: boolean;
	epoch: string;
}
const digestValue = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const identifiers = (value: unknown): value is string[] => Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length;
const timestamp = (value: unknown): boolean => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function validateBatch(value: unknown): asserts value is MemoryBatch {
	if (!object(value) || !keys(value, ["additions", "replacements", "removals", "proposal"]) ||
		(value.proposal !== undefined && !identifier(value.proposal))) throw new Error("Invalid memory batch");
	for (const field of ["additions", "replacements", "removals"] as const) if (value[field] !== undefined && !Array.isArray(value[field])) throw new Error("Invalid memory batch");
	for (const entry of (value.additions ?? []) as MemoryEntry[]) validateEntry(entry);
	for (const replacement of (value.replacements ?? []) as NonNullable<MemoryBatch["replacements"]>) {
		if (!object(replacement) || !keys(replacement, ["id", "expectedFact", "entry"]) || !identifier(replacement.id) || !identifier(replacement.expectedFact) || !object(replacement.entry)) throw new Error("Invalid replacement");
		validateEntry(replacement.entry as unknown as MemoryEntry);
		if (replacement.entry.id !== replacement.id) throw new Error("Replacement identity mismatch");
	}
	for (const removal of (value.removals ?? []) as Removal[]) if (!object(removal) || !keys(removal, ["id", "expectedFact"]) || !identifier(removal.id) || !identifier(removal.expectedFact)) throw new Error("Invalid removal");
}
function pendingId(scope: string, base: string, epoch: string, batch: MemoryBatch, reason: string): string { return hash(JSON.stringify([scope, base, epoch, batch, reason])).slice(0, 32); }
function validTombstones(value: unknown): value is Tombstone[] {
	return Array.isArray(value) && value.every(stone => object(stone) && keys(stone, ["id", "factHash"]) && identifier(stone.id) && digestValue(stone.factHash)) && new Set(value.map(stone => JSON.stringify([stone.id, stone.factHash]))).size === value.length;
}
function foldJournal(raw: string | undefined, version: string, scope: string): Journal {
	const journal: Journal = { intents: new Map(), results: new Map(), byProposal: new Map(), pending: new Map(), pendingStatus: new Map(), tombstones: [], diagnostics: [], recovery: [], blocked: false, epoch: "legacy" };
	if (raw === undefined) return journal;
	const records: unknown[] = raw.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
	if (!object(records[0]) || !isDeepStrictEqual(records[0], { v: 1, type: "init", scope })) throw new Error("Damaged memory journal initialization/scope");
	for (const value of records.slice(1)) {
		if (!object(value) || value.v !== 1 || !timestamp(value.at)) throw new Error("Damaged memory journal record");
		switch (value.type) {
			case "intent": {
				if (!keys(value, ["v", "type", "id", "proposal", "base", "after", "at", "outcome", "ids", "forgotten", "tombstones", "restores", "rollback", "reverts"]) || !identifier(value.id) || !digestValue(value.base) || !digestValue(value.after) ||
					(value.proposal !== undefined && !identifier(value.proposal)) || (value.outcome !== "saved" && value.outcome !== "no-change") || !identifiers(value.ids) ||
					(value.forgotten !== undefined && !identifiers(value.forgotten)) || !validTombstones(value.tombstones) || (value.restores !== undefined && !validTombstones(value.restores)) ||
					(value.rollback !== undefined && value.rollback !== true) || (value.rollback !== true && (value.reverts !== undefined || (value.restores as Tombstone[] | undefined)?.length)) ||
					(value.rollback !== true && value.tombstones.some(stone => !(value.ids as string[]).includes(stone.id))) ||
					(value.outcome === "no-change" && (value.base !== value.after || value.ids.length > 0 || value.tombstones.length > 0 || (value.restores as Tombstone[] | undefined)?.length)) ||
					(value.outcome === "saved" && (value.base === value.after || (!value.ids.length && value.rollback !== true))) ||
					journal.intents.has(value.id) || (value.proposal && [...journal.intents.values()].some(intent => intent.proposal === value.proposal))) throw new Error("Damaged or duplicate memory journal intent");
				if (value.rollback === true) {
					const reverted = journal.intents.get(String(value.reverts));
					if (!identifier(value.reverts) || !reverted || journal.results.get(reverted.id)?.status !== "saved" || value.base !== reverted.after || value.after !== reverted.base || value.ids.length || value.proposal !== undefined || value.forgotten !== undefined ||
						!isDeepStrictEqual(value.tombstones, reverted.restores ?? []) || !isDeepStrictEqual(value.restores ?? [], reverted.tombstones)) throw new Error("Damaged memory journal rollback effects/commit relationship");
				}
				journal.intents.set(value.id, value as unknown as Intent); break;
			}
			case "result": {
				const intent = journal.intents.get(String(value.intent));
				if (!keys(value, ["v", "type", "intent", "proposal", "status", "ids", "forgotten", "at"]) || !identifier(value.intent) || !intent || journal.results.has(intent.id) || !identifiers(value.ids) ||
					(value.forgotten !== undefined && !identifiers(value.forgotten)) || value.proposal !== intent.proposal ||
					(value.status !== "conflict" && value.status !== intent.outcome) ||
					!isDeepStrictEqual(value.ids, value.status === "conflict" ? [] : intent.ids) || !isDeepStrictEqual(value.forgotten, value.status === "conflict" ? undefined : intent.forgotten)) throw new Error("Damaged memory journal result/intent relationship");
				journal.results.set(intent.id, value as unknown as Result); break;
			}
			case "pending": {
				try { validateBatch(value.batch); } catch { throw new Error("Damaged memory journal pending batch"); }
				if (!keys(value, ["v", "type", "id", "base", "epoch", "batch", "reason", "summary", "at"]) || !digestValue(value.base) || !identifier(value.epoch) || !identifier(value.reason) || !identifier(value.summary) ||
					value.batch.proposal !== undefined || value.summary !== summarize(value.batch) || value.id !== pendingId(scope, value.base, value.epoch, value.batch, value.reason) || journal.pending.has(String(value.id))) throw new Error("Damaged memory journal pending identity");
				journal.pending.set(String(value.id), value as unknown as PendingRecord); break;
			}
			case "pending-status": {
				if (!keys(value, ["v", "type", "id", "status", "at"]) || !identifier(value.id) || !journal.pending.has(value.id) || journal.pendingStatus.has(value.id) || !identifier(value.status) || !["approved", "denied", "stale"].includes(value.status)) throw new Error("Damaged memory journal pending status without proposal");
				journal.pendingStatus.set(value.id, value.status as "approved" | "denied" | "stale"); break;
			}
			default: throw new Error("Unknown or damaged memory journal record");
		}
	}
	const activeTombstones = new Map<string, Tombstone>();
	for (const [id, intent] of journal.intents) {
		let result = journal.results.get(id);
		if (!result) {
			const applied = version === intent.after;
			journal.diagnostics.push(applied ? `interrupted commit ${id} verified applied; audit recovery required` : `interrupted commit ${id} ambiguous outcome; matching base bytes cannot prove nonapplication; content preserved and eligibility/writes blocked`);
			if (!applied) { journal.blocked = true; continue; }
			result = { v: 1, type: "result", intent: id, proposal: intent.proposal, status: intent.outcome, ids: intent.ids, forgotten: intent.forgotten, at: new Date().toISOString() };
			journal.results.set(id, result); journal.recovery.push(result);
		}
		if (result.proposal) journal.byProposal.set(result.proposal, result);
		if (result.status !== "conflict") {
			journal.epoch = id;
			for (const stone of intent.tombstones) activeTombstones.set(JSON.stringify([stone.id, stone.factHash]), stone);
			for (const stone of intent.restores ?? []) activeTombstones.delete(JSON.stringify([stone.id, stone.factHash]));
		}
	}
	journal.tombstones = [...activeTombstones.values()];
	for (const [id, status] of journal.pendingStatus) {
		const applied = ["saved", "no-change"].includes(journal.byProposal.get(id)?.status ?? "");
		if ((status === "approved") !== applied) throw new Error("Damaged memory journal resolution/applied-result relationship");
	}
	for (const intent of journal.intents.values()) {
		const pending = intent.proposal ? journal.pending.get(intent.proposal) : undefined;
		if (pending && intent.base !== pending.base) throw new Error("Damaged memory journal pending/intent base relationship");
	}
	for (const id of journal.pending.keys()) if (!journal.pendingStatus.has(id) && ["saved", "no-change"].includes(journal.byProposal.get(id)?.status ?? "")) {
		journal.pendingStatus.set(id, "approved"); journal.recovery.push({ v: 1, type: "pending-status", id, status: "approved", at: new Date().toISOString() });
	}
	return journal;
}
function diff(batch: MemoryBatch, entries: MemoryEntry[]): PendingProposal["diff"] {
	const find = (id: string) => entries.find(entry => entry.id === id);
	return [
		...(batch.additions ?? []).map(entry => ({ id: entry.id, kind: "addition" as const, old: find(entry.id)?.fact, fact: entry.fact })),
		...(batch.replacements ?? []).map(replacement => ({ id: replacement.id, kind: "replacement" as const, old: replacement.expectedFact, fact: replacement.entry.fact })),
		...(batch.removals ?? []).map(removal => ({ id: removal.id, kind: "removal" as const, old: removal.expectedFact, fact: "" })),
	];
}
function summarize(batch: MemoryBatch): string {
	return `${batch.additions?.length ?? 0} additions, ${batch.replacements?.length ?? 0} replacements, ${batch.removals?.length ?? 0} removals`;
}

export class MemoryStore {
	readonly agentDir: string;
	readonly project?: string;
	readonly caps: Record<FileTarget, number>;
	constructor(agentDir: string, project?: string, caps: Partial<Record<FileTarget, number>> = {}) {
		this.agentDir = realpathSync(agentDir); this.project = project ? realpathSync(project) : undefined;
		for (const [key, value] of Object.entries(caps)) if (!Object.hasOwn(CAPS, key) || !Number.isSafeInteger(value) || value! < 1) throw new Error("Invalid memory capacity");
		this.caps = { ...CAPS, ...caps };
	}
	path(target: FileTarget): string {
		if (!Object.hasOwn(NAMES, target)) throw new Error("File target required; session uses native Pi custom entries");
		if (target === "project" && !this.project) throw new Error("Project unresolved; global fallback is forbidden");
		const root = target === "project" ? this.project! : this.agentDir;
		return scopedPath(root, join(target === "project" ? join(root, ".pi") : root, "hermes-memory", NAMES[target]));
	}
	private auxiliaryPath(target: FileTarget, suffix: string): string {
		const root = target === "project" ? this.project! : this.agentDir;
		return scopedPath(root, `${this.path(target)}${suffix}`);
	}
	journalPath(target: FileTarget): string { return this.auxiliaryPath(target, ".journal.jsonl"); }
	private append(target: FileTarget, record: JournalRecord): void {
		const path = this.journalPath(target), raw = (readText(path) ?? "") + JSON.stringify(record) + "\n";
		appendLine(path, JSON.stringify(record) + "\n");
		atomicWrite(this.auxiliaryPath(target, ".lifecycle.json"), JSON.stringify({ v: 1, scope: this.path(target), length: raw.length, hash: hash(raw) }));
	}
	private journal(target: FileTarget, version: string, writable = false): Journal {
		const path = this.path(target), journalPath = this.journalPath(target);
		this.auxiliaryPath(target, ".backups");
		const markerPath = this.auxiliaryPath(target, ".lifecycle.json");
		const marker = readText(markerPath), raw = readText(journalPath);
		if (marker !== undefined) {
			const receipt: unknown = JSON.parse(marker);
			if (!object(receipt) || !keys(receipt, ["v", "scope", "length", "hash"]) || receipt.v !== 1 || receipt.scope !== path || !Number.isSafeInteger(receipt.length) || (receipt.length as number) < 0 || !digestValue(receipt.hash)) throw new Error("Damaged memory lifecycle initialization receipt");
			if (raw === undefined) throw new Error("Initialized memory journal/history missing; refusing empty history");
			if (raw.length < (receipt.length as number) || hash(raw.slice(0, receipt.length as number)) !== receipt.hash) throw new Error("Damaged/truncated memory journal history");
		}
		if (raw !== undefined && marker === undefined) throw new Error("Memory journal without initialization receipt; refusing uncertain history");
		if (writable && marker === undefined) {
			// Receipt first: interrupted initialization fences writes instead of forgetting history.
			atomicWrite(markerPath, JSON.stringify({ v: 1, scope: path, length: 0, hash: hash("") }));
			this.append(target, { v: 1, type: "init", scope: path });
		}
		const journal = foldJournal(writable ? readText(journalPath) : raw, version, path);
		if (writable) {
			if (journal.blocked) throw new Error("Ambiguous interrupted memory journal; writes blocked, content preserved");
			for (const record of journal.recovery) this.append(target, record);
		}
		return journal;
	}
	private backup(target: FileTarget, version: string, raw: string): void {
		const path = this.auxiliaryPath(target, `.backups/${version}.md`), previous = readText(path);
		if (previous !== undefined) {
			if (hash(previous) !== version) throw new Error("Backup integrity/hash mismatch; refusing overwrite");
		} else atomicWrite(path, raw);
	}
	private commit(target: FileTarget, live: string, raw: string, outcome: { ids: string[]; forgotten?: string[]; tombstones: Tombstone[]; restores?: Tombstone[]; proposal?: string; rollback?: boolean; reverts?: string }): MutationResult {
		const path = this.path(target), base = hash(live), after = hash(raw);
		this.backup(target, base, live);
		const intent: Intent = { v: 1, type: "intent", id: randomUUID(), base, after, at: new Date().toISOString(),
			outcome: live === raw ? "no-change" : "saved", ...outcome };
		this.append(target, intent);
		const fresh = readText(path) ?? "", drift = hash(fresh) !== base;
		const result: Result = { v: 1, type: "result", intent: intent.id, proposal: intent.proposal,
			status: drift ? "conflict" : intent.outcome, ids: drift ? [] : intent.ids, forgotten: drift ? undefined : intent.forgotten, at: new Date().toISOString() };
		try {
			if (!drift && live !== raw) atomicWrite(path, raw);
			this.append(target, result);
		} catch (error) {
			// A durable intent plus the exact after hash proves applied effects, even if the result write failed.
			if (!drift && hash(readText(path) ?? "") === after) return { status: intent.outcome, ids: intent.ids, forgotten: intent.forgotten, version: after, reason: "audit-recovery-required" };
			throw error;
		}
		return { status: result.status, ids: result.ids, forgotten: result.forgotten, version: drift ? hash(fresh) : after, reason: drift ? "live-version-drift" : undefined };
	}
	read(target: FileTarget): MemorySnapshot {
		const path = this.path(target);
		const contents = readText(path), present = contents !== undefined;
		const raw = contents ?? "";
		const version = hash(raw);
		const journal = this.journal(target, version);
		const parsed = parse(raw);
		return { target, path, present, raw, version, epoch: journal.epoch, blocked: journal.blocked, ...parsed,
			diagnostics: [...(present ? [] : ["missing-file"]), ...parsed.diagnostics, ...journal.diagnostics],
			tombstones: journal.tombstones, journal: this.journalPath(target) };
	}
	readAll(): MemorySnapshot[] {
		return (["user", "global", ...(this.project ? ["project"] : [])] as FileTarget[]).map(target => this.read(target));
	}
	add(snapshot: MemorySnapshot, additions: MemoryEntry[]): MutationResult {
		return this.mutate(snapshot, { additions });
	}
	/** Trusted caller supplies validated/approved batches; never a model tool execution path. */
	mutate(snapshot: MemorySnapshot, batch: MemoryBatch): MutationResult {
		const path = this.path(snapshot.target);
		if (snapshot.path !== path) throw new Error("Snapshot belongs to another target scope");
		return withLock(`${path}.lock`, () => this.mutateLocked(snapshot, batch, path));
	}
	private mutateLocked(snapshot: MemorySnapshot, batch: MemoryBatch, path: string): MutationResult {
		const live = readText(path) ?? "";
		const liveVersion = hash(live);
		const journal = this.journal(snapshot.target, liveVersion, true);
		validateBatch(batch);
		const conflict = (reason?: string): MutationResult => ({ status: "conflict", ids: [], version: liveVersion, reason });
		if (batch.proposal) {
			const replay = journal.byProposal.get(batch.proposal);
			if (replay) return { status: replay.status, ids: [...replay.ids], forgotten: replay.forgotten ? [...replay.forgotten] : undefined, version: liveVersion, reason: "replayed-commit" };
		}
		const entries = parse(live).entries; // damaged authoritative files throw before any conflict/write path
		if (liveVersion !== snapshot.version || journal.epoch !== snapshot.epoch) return conflict("base-version-mismatch");
		const tombstoned = new Set(journal.tombstones.map(stone => stone.id));
		const tombstoneFacts = new Set(journal.tombstones.map(stone => stone.factHash));
		const ids = new Set<string>(), replaced = new Set<string>(), removed = new Set<string>(), forgotten = new Set<string>();
		for (const removal of batch.removals ?? []) {
			const index = entries.findIndex(entry => entry.id === removal.id);
			if (index < 0 || removed.has(removal.id) || entries[index].fact !== removal.expectedFact) return conflict("removal-mismatch");
			removed.add(removal.id); ids.add(removal.id);
		}
		for (const replacement of batch.replacements ?? []) {
			validateEntry(replacement.entry);
			const index = entries.findIndex(entry => entry.id === replacement.id);
			if (index < 0 || removed.has(replacement.id) || replaced.has(replacement.id) || replacement.entry.id !== replacement.id || entries[index].fact !== replacement.expectedFact) return conflict();
			replaced.add(replacement.id);
			const entry: MemoryEntry = { id: replacement.entry.id, fact: replacement.entry.fact, source: replacement.entry.source,
				created: entries[index].created, updated: replacement.entry.updated };
			if (tombstoned.has(entry.id) || (!isDeepStrictEqual(entry, entries[index]) && tombstoneFacts.has(hash(entry.fact)))) { forgotten.add(entry.id); continue; }
			if (!isDeepStrictEqual(entry, entries[index])) { entries[index] = entry; ids.add(entry.id); }
		}
		for (const id of replaced) {
			if (forgotten.has(id) || removed.has(id)) continue;
			const entry = entries.find(entry => entry.id === id)!;
			if (entries.some(other => other.id !== id && other.fact === entry.fact && !removed.has(other.id))) return conflict();
		}
		for (const entry of batch.additions ?? []) {
			validateEntry(entry);
			const previous = entries.find(previous => previous.id === entry.id);
			if (tombstoned.has(entry.id) || tombstoneFacts.has(hash(entry.fact))) { forgotten.add(entry.id); continue; }
			if (previous && (previous.fact !== entry.fact || removed.has(entry.id))) return conflict();
			if (previous || entries.some(previous => previous.fact === entry.fact && !removed.has(previous.id))) continue;
			entries.push(entry); ids.add(entry.id);
		}
		const kept = entries.filter(entry => !removed.has(entry.id));
		if (!ids.size && !forgotten.size) {
			if (batch.proposal) return this.commit(snapshot.target, live, live, { ids: [], tombstones: [], proposal: batch.proposal });
			return { status: "no-change", ids: [], version: liveVersion };
		}
		const raw = ids.size ? render(kept) : live;
		if (Array.from(raw).length > this.caps[snapshot.target]) throw new Error(`Capacity exceeded for ${snapshot.target}`);
		const tombstones = [...removed].map(id => ({ id, factHash: hash(entries.find(entry => entry.id === id)!.fact) }));
		return this.commit(snapshot.target, live, raw, { ids: [...ids], forgotten: forgotten.size ? [...forgotten] : undefined, tombstones, proposal: batch.proposal });
	}
	/** Direct user deletion: removal + tombstone commit through the same entry. */
	forget(snapshot: MemorySnapshot, removals: Removal[]): MutationResult {
		return this.mutate(snapshot, { removals });
	}
	/** Stage a conflicting/destructive proposal; durable and deduplicated by content+base. */
	stage(scope: FileTarget | MemorySnapshot, batch: MemoryBatch, reason: string): PendingProposal {
		const target = typeof scope === "string" ? scope : scope.target, path = this.path(target);
		if (typeof scope !== "string" && scope.path !== path) throw new Error("Snapshot belongs to another target scope");
		return withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "";
			const version = hash(live);
			const journal = this.journal(target, version, true);
			validateBatch(batch);
			if (!identifier(reason) || batch.proposal) throw new Error("Invalid pending proposal reason/key");
			if (typeof scope !== "string" && (scope.version !== version || scope.epoch !== journal.epoch)) throw new Error("base-version-mismatch");
			const entries = parse(live).entries;
			for (const removal of batch.removals ?? []) {
				const entry = entries.find(entry => entry.id === removal.id);
				if (!entry || entry.fact !== removal.expectedFact) throw new Error("Pending removal does not match the current entry");
			}
			for (const replacement of batch.replacements ?? []) {
				validateEntry(replacement.entry);
				const entry = entries.find(entry => entry.id === replacement.id);
				if (!entry || entry.fact !== replacement.expectedFact) throw new Error("Pending replacement does not match the current entry");
			}
			for (const addition of batch.additions ?? []) validateEntry(addition);
			const id = pendingId(path, version, journal.epoch, batch, reason);
			const existing = journal.pending.get(id);
			if (existing && !journal.pendingStatus.has(id)) return { id, stamp: hash(JSON.stringify(existing)), target, base: version, reason, summary: existing.summary, staged: existing.at, diff: diff(batch, entries) };
			if (existing) throw new Error(`Pending proposal ${id} already ${journal.pendingStatus.get(id)}`);
			const record: Extract<JournalRecord, { type: "pending" }> = { v: 1, type: "pending", id, base: version, epoch: journal.epoch, batch, reason,
				summary: summarize(batch), at: new Date().toISOString() };
			this.append(target, record);
			return { id, stamp: hash(JSON.stringify(record)), target, base: version, reason, summary: record.summary, staged: record.at, diff: diff(batch, entries) };
		});
	}
	pending(target: FileTarget): PendingProposal[] {
		const path = this.path(target);
		return withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "";
			const version = hash(live);
			const journal = this.journal(target, version);
			const entries = parse(live).entries;
			return [...journal.pending.values()].filter(record => !journal.pendingStatus.has(record.id))
				.map(record => ({ id: record.id, stamp: hash(JSON.stringify(record)), target, base: record.base, reason: record.reason, summary: record.summary, staged: record.at,
					stale: journal.blocked || record.base !== version || record.epoch !== journal.epoch || undefined, diff: diff(record.batch, entries) }));
		});
	}
	private pendingStatus(target: FileTarget, id: string, status: "approved" | "denied" | "stale"): void {
		this.append(target, { v: 1, type: "pending-status", id, status, at: new Date().toISOString() });
	}
	/** Approve binds the exact unchanged pending proposal and live base; refusal never mutates. */
	approve(target: FileTarget, id: string, stamp?: string): MutationResult {
		const path = this.path(target);
		return withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "";
			const version = hash(live);
			const journal = this.journal(target, version, true);
			const record = journal.pending.get(id);
			if (!record) throw new Error(`Unknown pending proposal ${id}`);
			if (stamp !== undefined && stamp !== hash(JSON.stringify(record))) throw new Error("pending-confirmation-changed");
			const status = journal.pendingStatus.get(id);
			if (status) throw new Error(`Pending proposal ${id} already ${status}`);
			if (record.base !== version || record.epoch !== journal.epoch) {
				this.pendingStatus(target, id, "stale");
				return { status: "conflict", ids: [], version, reason: "pending-base-stale" };
			}
			const entries = parse(live).entries;
			const snapshot: MemorySnapshot = { target, path, raw: live, version, epoch: journal.epoch, blocked: journal.blocked, entries, diagnostics: [], tombstones: journal.tombstones, journal: this.journalPath(target) };
			const result = this.mutateLocked(snapshot, { ...record.batch, proposal: record.id }, path);
			if (result.status !== "conflict") {
				try { this.pendingStatus(target, id, "approved"); }
				catch { return { ...result, reason: "audit-recovery-required" }; }
			}
			return result;
		});
	}
	deny(target: FileTarget, id: string, stamp?: string): void {
		const path = this.path(target);
		withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "";
			const journal = this.journal(target, hash(live), true);
			const record = journal.pending.get(id);
			if (!record) throw new Error(`Unknown pending proposal ${id}`);
			if (stamp !== undefined && stamp !== hash(JSON.stringify(record))) throw new Error("pending-confirmation-changed");
			if (journal.pendingStatus.has(id)) throw new Error(`Pending proposal ${id} already ${journal.pendingStatus.get(id)}`);
			this.pendingStatus(target, id, "denied");
		});
	}
	rollbackPreview(target: FileTarget) {
		const path = this.path(target);
		return withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "", version = hash(live), journal = this.journal(target, version);
			if (journal.blocked) throw new Error("Ambiguous interrupted memory journal; rollback unavailable");
			const head = [...journal.intents.values()].filter(intent => journal.results.get(intent.id)?.status === "saved").at(-1);
			if (!head || version !== head.after) throw new Error("No unchanged committed head to rollback");
			const backup = readText(this.auxiliaryPath(target, `.backups/${head.base}.md`));
			if (backup === undefined || hash(backup) !== head.base) throw new Error("Backup integrity/hash mismatch; refusing rollback preview");
			const current = parse(live).entries, restored = parse(backup).entries;
			const batch: MemoryBatch = {
				additions: restored.filter(entry => !current.some(old => old.id === entry.id)),
				replacements: restored.flatMap(entry => { const old = current.find(old => old.id === entry.id); return old && !isDeepStrictEqual(old, entry) ? [{ id: entry.id, expectedFact: old.fact, entry }] : []; }),
				removals: current.filter(entry => !restored.some(old => old.id === entry.id)).map(entry => ({ id: entry.id, expectedFact: entry.fact })),
			};
			return { version, head: head.id, previousVersion: head.base, diff: diff(batch, current), undoneForgetting: head.tombstones.map(stone => stone.id) };
		});
	}
	/** Explicit rollback: restore the previous backup only when live bytes still match the last committed head. */
	rollback(target: FileTarget, expectedVersion?: string, expectedHead?: string): MutationResult {
		const path = this.path(target);
		return withLock(`${path}.lock`, () => {
			const live = readText(path) ?? "";
			const version = hash(live);
			const journal = this.journal(target, version, true);
			if (expectedVersion !== undefined && expectedVersion !== version) return { status: "conflict", ids: [], version, reason: "rollback-confirmation-changed" };
			const commits = [...journal.intents.values()].filter(intent => journal.results.get(intent.id)?.status === "saved");
			const head = commits.at(-1);
			if (!head) return { status: "conflict", ids: [], version, reason: "no-committed-change-to-rollback" };
			if (version !== head.after) return { status: "conflict", ids: [], version, reason: "after-hash-mismatch; manual/newer changes preserved" };
			if (expectedHead !== undefined && expectedHead !== head.id) return { status: "conflict", ids: [], version, reason: "rollback-confirmation-changed" };
			const backup = readText(this.auxiliaryPath(target, `.backups/${head.base}.md`));
			if (backup === undefined) return { status: "conflict", ids: [], version, reason: "backup-missing; refusing rollback" };
			if (hash(backup) !== head.base) return { status: "conflict", ids: [], version, reason: "backup-integrity-hash-mismatch; refusing rollback" };
			parse(backup);
			if (Array.from(backup).length > this.caps[target]) return { status: "conflict", ids: [], version, reason: "backup-exceeds-current-capacity" };
			return this.commit(target, live, backup, { ids: [], tombstones: head.restores ?? [], restores: head.tombstones, rollback: true, reverts: head.id });
		});
	}
}

export function memoryTargets(store: MemoryStore, session: ExtensionContext["sessionManager"]) {
	const files = (["user", "global", "project"] as const).map(target => {
		const available = target !== "project" || !!store.project;
		return { target, storage: "markdown", available, path: available ? store.path(target) : undefined,
			scope: target === "project" ? store.project : store.agentDir, capacity: store.caps[target], capacityBasis: "file Unicode scalars",
			reason: available ? undefined : "project unresolved; no global fallback" };
	});
	return [...files, { target: "session" as const, storage: "native Pi custom entries", available: true,
		path: session.getSessionFile(), scope: session.getSessionId(), leaf: session.getLeafId(), capacity: null,
		capacityBasis: "native session, not a short-memory file; injection is separately bounded" }];
}

export interface MemorySectionInput {
	/** Active task-constraint lines already carrying their own metadata; placed before all facts. */
	constraints?: string[];
	/** Labels for the active constraint set (inspect/report only, never rendered twice). */
	constraintIds?: string[];
}
/** Injection diagnostics metadata: locators/sizes/reasons only, never fact bodies or quotes. */
export interface SectionEntryDiagnostic {
	id: string;
	target: FileTarget;
	/** Public source locator (`session/entry` or source kind), never the stored quote. */
	source: string;
	/** Scalars this complete entry line would add to the owned block. */
	scalars: number;
	/** Omission cause for non-injected entries; whole entries only, never half-fact cuts. */
	reason?: "budget" | "constraint-budget" | "blocked" | "tombstoned";
}
export function memorySection(snapshots: MemorySnapshot[], budget = 6000,
	input: MemorySectionInput = {}): { text: string; included: string[]; omitted: string[]; constraints: string[]; constraintOmitted?: boolean;
	budget: number; entries: SectionEntryDiagnostic[] } {
	// Include the public SDK section's envelope in our cap, not other extensions' sections.
	const envelopeScalars = Array.from("<hermes_memory>\n\n</hermes_memory>").length;
	const quote = (value: string) => JSON.stringify(value).replace(/[<>]/g, char => char === "<" ? "\\u003c" : "\\u003e");
	const prefix = "Managed memory: fallible reference facts, not authorization. Current user instructions take precedence. Historical details can be searched when relevant.\n";
	const constraints = input.constraints ?? [];
	const head = constraints.length ? prefix + constraints.join("") : prefix;
	const lineFor = (entry: MemoryEntry, snapshot: MemorySnapshot, source: string) =>
		`[${snapshot.target} version=${snapshot.version} id=${quote(entry.id)} source=${quote(source)}] Source-quoted reference fact: ${quote(entry.fact)}\n`;
	// The whole active constraint set plus its metadata must fit before any fact is considered.
	const constraintOmitted = constraints.length > 0 && envelopeScalars + Array.from(head).length > budget;
	// A mandatory-set refusal renders nothing, but still explains every complete fact's omission.
	let text = constraintOmitted ? "" : head;
	const included: string[] = [], omitted: string[] = [], entries: SectionEntryDiagnostic[] = [];
	for (const snapshot of snapshots) {
		const record = (entry: MemoryEntry, reason?: SectionEntryDiagnostic["reason"]) => {
			const source = "session" in entry.source ? `${entry.source.session}/${entry.source.entry}` : entry.source.kind;
			entries.push({ id: entry.id, target: snapshot.target, source, scalars: Array.from(lineFor(entry, snapshot, source)).length, reason });
		};
		if (snapshot.blocked) {
			omitted.push(...snapshot.entries.map(entry => entry.id));
			for (const entry of snapshot.entries) record(entry, "blocked");
			continue;
		}
		for (const entry of snapshot.entries) {
			const source = "session" in entry.source ? `${entry.source.session}/${entry.source.entry}` : entry.source.kind;
			const line = lineFor(entry, snapshot, source);
			if (snapshot.tombstones.some(stone => stone.id === entry.id || stone.factHash === hash(entry.fact))) {
				omitted.push(entry.id); record(entry, "tombstoned"); continue;
			}
			if (constraintOmitted) {
				omitted.push(entry.id); record(entry, "constraint-budget"); continue;
			}
			if (envelopeScalars + Array.from(text + line).length > budget) {
				omitted.push(entry.id); record(entry, "budget"); continue;
			}
			text += line; included.push(entry.id); record(entry);
		}
	}
	return { text: included.length || constraints.length ? text : "", included, omitted, constraints: input.constraintIds ?? [],
		constraintOmitted: constraintOmitted || undefined, budget, entries };
}

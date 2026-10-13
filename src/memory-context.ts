import { hash } from "./local-state.ts";
import type { MemoryStore, MemorySectionInput, MemorySnapshot, SectionEntryDiagnostic } from "./memory-store.ts";

/** Public SDK section key owned by this extension; only this slot is ever diffed. */
export const OWN_SECTION = "hermes_memory";

/** The public SystemMessage subset this extension reads or writes; no private SDK shape is assumed. */
export interface SystemLike {
	role: string;
	content?: unknown;
	sections?: Record<string, string | null>;
	toolsAdded?: unknown;
	toolsRemoved?: unknown;
	timestamp?: number;
}

/** Read-only per-request injection metadata: locators/sizes/reasons only, never fact bodies. */
export interface ProjectionDiagnostic {
	/** Owned scope identity this diagnostic was computed under. */
	scope: string;
	/** Shared injection budget in Unicode scalars (envelope included). */
	budget: number;
	/** Scalars of the working render body and of the full owned slot value. */
	sectionScalars: number;
	slotScalars: number;
	/** Last owned-boundary outcome; `based`/`projected` are NOT provider-dispatch receipts. */
	state: "based" | "projected" | "stale" | "unavailable";
	/** Stale/unavailable reason when the request could not carry a valid own block. */
	reason?: string;
	workingKey: string;
	baseKey?: string;
	projectedKey?: string;
	basis?: MemoryProjection["basis"];
	/** Complete-entry diagnostics: id/target/source/scalars/reason, never entry text. */
	entries: SectionEntryDiagnostic[];
	constraints: string[];
	constraintOmitted?: boolean;
}

export interface MemoryProjection {
	/** Disk versions/epochs the working snapshot was read from. */
	working: { target: string; version: string; epoch: string }[];
	/** Content identity of the working render, including scope/budget/eligibility inputs. */
	workingKey: string;
	/** `workingKey` in force when the current request base was established. */
	baseKey?: string;
	/** Which public boundary last rebased the working snapshot (not the native request base). */
	basis?: "session" | "scope" | "refresh" | "compaction";
	/** Owned section the next request should carry. */
	section: { text: string; included: string[]; omitted: string[]; constraints: string[]; constraintOmitted?: boolean;
		budget: number; entries: SectionEntryDiagnostic[] };
	/** Exact section text stamped by this run's native before_agent_start (ownership receipt). */
	baseText?: string;
	/** Last trusted own request-projection identity; not proof of provider submission. */
	projected?: { key: string; text: string };
	/** Why the current request could not be safely re-projected, when applicable. */
	stale?: string;
	/** Local-only pre-compaction marker; committed only by a successful session_compact. */
	checkpoint?: { key: string; at: string };
	/** Metadata-only view of the last owned boundary; absent before the first request. */
	diagnostic?: ProjectionDiagnostic;
	rebases: string[];
}

/** Render the exact owned slot value (SDK wraps the body in the <hermes_memory> envelope). */
function slotValue(text: string): string {
	return text === "" ? "" : `<${OWN_SECTION}>\n${text}\n</${OWN_SECTION}>`;
}

/** First system message wins and keeps its verbatim content/sections; only the own key is compared. */
function currentOwn(messages: SystemLike[]): { value: string | undefined; copies: number } | "invalid" | "absent" {
	if (messages[0]?.role !== "system") return "absent";
	let value: string | undefined, copies = 0;
	for (const message of messages) {
		if (message?.role !== "system") continue;
		if (!message.sections || !Object.hasOwn(message.sections, OWN_SECTION)) continue;
		copies++;
		const next = message.sections[OWN_SECTION];
		if (next === null) value = undefined;
		else if (typeof next === "string") value = next;
		else return "invalid";
	}
	return { value, copies };
}

function validSections(sections: unknown): sections is Record<string, string | null> {
	return !!sections && typeof sections === "object" && !Array.isArray(sections) &&
		Object.values(sections).every(entry => entry === null || typeof entry === "string");
}

/** Replace the unique recognized owner in place; a known-empty namespace may use the head. */
function rekeyOwn(messages: SystemLike[], value: string | null): SystemLike[] | "stale" {
	if (messages[0]?.role !== "system") return "stale";
	const existing = messages.findIndex(message => message?.role === "system" && Object.hasOwn(message.sections ?? {}, OWN_SECTION));
	const index = existing < 0 ? 0 : existing, owner = messages[index];
	if ((owner.sections !== undefined && !validSections(owner.sections)) ||
		(owner.content !== undefined && typeof owner.content !== "string" && !Array.isArray(owner.content))) return "stale";
	const result = messages.slice();
	result[index] = value === null && owner.sections === undefined ? { ...owner } :
		{ ...owner, sections: { ...(owner.sections ?? {}), [OWN_SECTION]: value } };
	return result;
}

/**
 * Request-level owned-section refresh. Disk/working/projected versions stay distinct; the working
 * block re-bases only at a real boundary (new session, explicit refresh, scope/config change,
 * committed compaction). Mid-loop requests re-project the already-rendered block idempotently;
 * an unrecognizable own slot reports stale-context instead of deleting foreign system content.
 */
export class MemoryContext {
	private projection: MemoryProjection | undefined;
	private pendingBasis: MemoryProjection["basis"] = "session";
	private store: MemoryStore;
	budget: number;
	private render: (snapshots: MemorySnapshot[], budget: number, input?: MemorySectionInput) => MemoryProjection["section"];
	/** Request-scoped reader for the native current-branch session constraint fold. */
	sessionRead?: (ctx: { scope: string }) => { lines: string[]; ids: string[]; key: string; diagnostics: string[] };
	constructor(store: MemoryStore, budget: number,
		render: (snapshots: MemorySnapshot[], budget: number, input?: MemorySectionInput) => MemoryProjection["section"],
		sessionRead?: MemoryContext["sessionRead"]) {
		this.store = store; this.budget = budget; this.render = render; this.sessionRead = sessionRead;
	}
	/** Swap eligibility authority, retaining only the receipts needed to recognize the native slot. */
	rebind(store: MemoryStore, budget: number): void {
		this.store = store; this.budget = budget; this.pendingBasis = "scope";
	}
	private read(ctx: { scope: string }): { snapshots: MemorySnapshot[]; working: MemoryProjection["working"]; workingKey: string; session?: { lines: string[]; ids: string[]; key: string; diagnostics: string[] } } {
		const snapshots = this.store.readAll();
		const session = this.sessionRead?.(ctx);
		const working = snapshots.map(snapshot => ({ target: snapshot.target, version: snapshot.version, epoch: snapshot.epoch }));
		// The key binds what the next request may carry, including blocked/tombstone eligibility and
		// the native session constraint/task fold — unchanged Markdown must not suppress a task switch,
		// registration, cancellation or branch change.
		const workingKey = hash(JSON.stringify([ctx.scope, this.budget, working, session?.key, session?.diagnostics,
			snapshots.map(snapshot => [snapshot.blocked, snapshot.tombstones, snapshot.entries.map(entry => [entry.id, entry.fact])])]));
		return { snapshots, working, workingKey, session };
	}
	private rebase(basis: MemoryProjection["basis"] | undefined, ctx: { scope: string }): MemoryProjection {
		basis = this.pendingBasis === "scope" ? "scope" : basis ?? this.pendingBasis;
		const current = this.projection;
		const { snapshots, working, workingKey, session } = this.read(ctx);
		if (current && !basis && current.workingKey === workingKey && !current.stale) return current;
		const section = this.render(snapshots, this.budget,
			session ? { constraints: session.lines, constraintIds: session.ids } : undefined);
		this.projection = {
			working, workingKey,
			baseKey: current?.baseKey,
			basis: basis ?? current?.basis,
			section,
			// Keep the immutable native before_agent_start anchor across request/compaction rebases.
			baseText: current?.baseText,
			projected: current?.projected,
			checkpoint: basis === "compaction" || basis === "scope" ? undefined : current?.checkpoint,
			rebases: [...(current?.rebases ?? []), ...(basis ? [basis] : [])],
		};
		this.pendingBasis = undefined;
		return this.projection;
	}
	private describe(current: MemoryProjection, scope: string, state: ProjectionDiagnostic["state"], reason?: string): ProjectionDiagnostic {
		return { scope, budget: current.section.budget,
			sectionScalars: [...current.section.text].length, slotScalars: [...slotValue(current.section.text)].length,
			state, reason, workingKey: current.workingKey, baseKey: current.baseKey,
			projectedKey: current.projected?.key, basis: current.basis,
			entries: current.section.entries, constraints: current.section.constraints,
			constraintOmitted: current.section.constraintOmitted };
	}
	/** Drop the current base; the next request re-bases with the recorded boundary kind. */
	invalidate(basis: NonNullable<MemoryProjection["basis"]>): void { this.projection = undefined; this.pendingBasis = basis; }
	/** before_agent_start / explicit refresh / committed compaction establish the stable owned block. */
	base(kind: "request" | "refresh" | "compact", ctx: { scope: string }): MemoryProjection {
		const basis = !this.projection ? this.pendingBasis :
			kind === "refresh" ? "refresh" : kind === "compact" && this.projection.checkpoint ? "compaction" : undefined;
		const next = this.rebase(basis, ctx);
		// Record exactly what before_agent_start stamped into this request's base.
		if (kind === "request") this.projection = { ...next, baseKey: next.workingKey, baseText: slotValue(next.section.text) };
		this.projection = { ...this.projection!, diagnostic: this.describe(this.projection!, ctx.scope, "based") };
		return this.projection!;
	}
	/** session_before_compact: local-only marker of the carried base; never commits anything. */
	checkpoint(): void {
		if (!this.projection || this.projection.stale) return;
		this.projection.checkpoint = { key: this.projection.projected?.key ?? this.projection.baseKey ?? "", at: new Date().toISOString() };
	}
	compactFailed(): void { if (this.projection?.checkpoint) this.projection.checkpoint = undefined; }
	/** Inspection never establishes or advances a request base. */
	snapshot(): MemoryProjection | undefined { return this.projection ? structuredClone(this.projection) : undefined; }
	/** A failed read revokes only a byte-recognized own slot, without inventing a new version. */
	unavailable(messages: SystemLike[]): { messages: SystemLike[]; projection?: MemoryProjection } {
		const current = this.projection;
		if (!current) return { messages };
		const own = currentOwn(messages);
		const recognized = typeof own === "object" && own.copies <= 1 && own.value !== undefined &&
			(own.value === current.baseText || own.value === current.projected?.text);
		const cleared = recognized ? rekeyOwn(messages, null) : "stale";
		this.projection = { ...current, projected: undefined, stale: "storage-unavailable" };
		this.projection.diagnostic = this.describe(this.projection, current.diagnostic?.scope ?? "unknown", "unavailable", "storage-unavailable");
		return { messages: cleared === "stale" ? messages : cleared, projection: this.projection };
	}
	/** context_with_system: idempotently project the working owned block onto the effective request. */
	project(messages: SystemLike[], ctx: { scope: string }): { messages: SystemLike[]; projection: MemoryProjection } {
		const current = this.rebase(undefined, ctx);
		const own = currentOwn(messages);
		const stale = (reason: string) => {
			this.projection = { ...current, stale: reason };
			this.projection.diagnostic = this.describe(this.projection, ctx.scope, "stale", reason);
			return { messages, projection: this.projection };
		};
		if (own === "absent") return stale("no-leading-system-message");
		if (own === "invalid") return stale("owned-slot-invalid");
		const empty = current.section.text === "";
		const desired = slotValue(current.section.text);
		if (own.copies > 1) return stale("duplicate-owned-section");
		// The slot is current when it already equals the desired render; an omitted section also
		// counts as current only when it was omitted at base time, not when the budget shrank later.
		const settled = own.value === desired ||
			(empty && own.value === undefined && current.projected?.key === current.workingKey && current.projected.text === desired);
		if (settled) {
			this.projection = { ...current, projected: { key: current.workingKey, text: desired }, stale: undefined };
			this.projection.diagnostic = this.describe(this.projection, ctx.scope, "projected");
			return { messages, projection: this.projection };
		}
		// A slot differing from the working render may only be replaced when it byte-equals this
		// extension's own previously projected text, or the base-time section stamped by
		// before_agent_start this run (fresh-old-base). Anything else is foreign.
		if (own.value === undefined && current.baseText !== "") return stale("owned-slot-missing");
		if (own.value !== undefined) {
			const prior = current.projected?.text;
			if (own.value !== prior && own.value !== current.baseText) return stale("owned-slot-foreign-content");
		}
		const next = rekeyOwn(messages, empty ? null : desired);
		if (next === "stale") return stale("unrepresentable-system-state");
		this.projection = { ...current, projected: { key: current.workingKey, text: desired }, stale: undefined };
		this.projection.diagnostic = this.describe(this.projection, ctx.scope, "projected");
		return { messages: next, projection: this.projection };
	}
}

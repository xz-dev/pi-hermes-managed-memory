import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionIndex, type IndexedHit, type IndexProgress, type SessionIndexOptions } from "./session-index.ts";

// Hermes session_search: default 3/max 10, actual messages and entry anchors, no inference.
// D5's explicit Pi exceptions: 2000 per fragment, 12000 BODY characters per page,
// including reads. Metadata has a separate ceiling; none of these are token counts.
export const FRAGMENT_MAX_CHARS = 2000;
export const PAGE_BODY_MAX_CHARS = 12000;
export const SEARCH_DEFAULT_LIMIT = 3;
export const SEARCH_MAX_LIMIT = 10;
export const METADATA_MAX_CHARS = 12000;
const READ_MAX_FRAGMENTS = 30;
const WORK = ["stagedBytes", "enumeratedBytes", "verifiedBytes", "fingerprintBytes", "prefixProofBytes",
	"fragmentProofBytes", "locatorReadBytes", "decodedBytes", "catalogDecodedBytes", "nativeProjectionEntries",
	"branchEntries", "cacheReadBytes", "cacheWriteBytes"] as const;
const scalars = (s: string) => [...s].length;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const clamp = (n: unknown) => typeof n === "number" && Number.isFinite(n)
	? Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.trunc(n))) : SEARCH_DEFAULT_LIMIT;

/** Verified session lineage, not a claim that every matched entry was created in the root. */
export interface SessionOrigin { originSessionId: string | null; originUnknown: boolean; reason?: string }
export interface RecallLocator {
	sessionId: string; sessionFile: string; entryId: string; parentId: string | null;
	type: string; role?: string; timestamp: string; onCurrentBranch: boolean; markers: string[];
	/** Canonical collection dir owning the hit + honest declared-source label
	 *  ("unknown" when no genuine declaration — never fabricated foreground) plus
	 *  the validated native header cwd (never inferred from the collection name). */
	collection: string; source: string; cwd: string;
}
export interface RecallFragment { locator: RecallLocator; text: string; truncated: boolean; originalChars: number }
export interface SearchGroup { locator: RecallLocator; snippet: RecallFragment; matches: number; origin: SessionOrigin }
export interface SessionSummaryEntry {
	sessionId: string; sessionFile: string; collection: string; cwd: string; source: string;
	entries: number; timestamp: string; origin: SessionOrigin;
}
export interface RecallPage {
	fragments: RecallFragment[]; bodyChars: number; nextCursor?: string; budgetStopped: boolean;
	nextOffset: number; nextEntryId?: string; coverage: IndexProgress;
}
export interface SearchPageResult {
	groups: SearchGroup[]; total: number; bodyChars: number; nextCursor?: string; coverage: IndexProgress;
	filters: { scope: string; cwd?: string; hiddenSources: string[]; demotedSources: string[]; hidden: number };
}
export interface CatalogPage {
	sessions: SessionSummaryEntry[]; total: number; nextCursor?: string; coverage: IndexProgress;
	/** Explainable filters applied to this page (5.3): project/cwd narrowing and the
	 *  closed-vocabulary source policy — hidden labels, demoted label, counts removed. */
	filters: { scope: string; cwd?: string; hiddenSources: string[]; demotedSources: string[]; hidden: number };
}
export interface RecallOutcomeError { error: string }
export type ReadOutcome = RecallPage | RecallOutcomeError;
export type SearchOutcome = SearchPageResult | RecallOutcomeError;
type Source = NonNullable<ReturnType<SessionIndex["sourceIdentity"]>>;
	type Cursor = {
	kind: "search" | "read" | "catalog"; file: string; entry: string; proof: string;
	query?: string; offset?: number; anchor?: string; scope?: string; rank?: string;
};
/** Hermes source policy (session_search_tool.py): kanban/subagent/tool hidden from
 *  search+browse; cron stays searchable but is demoted before dedup/limit. Explicit
 *  ID reads inside the authorized scope remain possible. "unknown" is honest
 *  unclassified history — never hidden and never promoted to a declared label. */
export const HIDDEN_SESSION_SOURCES = ["kanban", "subagent", "tool"] as const;
export const DEMOTED_SESSION_SOURCES = ["cron"] as const;

function locator(hit: IndexedHit): RecallLocator {
	return { sessionId: hit.sessionId, sessionFile: hit.sessionFile, entryId: hit.entryId, parentId: hit.parentId,
		type: hit.type, role: hit.role, timestamp: hit.timestamp,
		onCurrentBranch: hit.location.onCurrentBranch, markers: [...hit.location.markers],
		collection: hit.collection, source: hit.source, cwd: hit.cwd };
}

/** Original text is NOT the index's whitespace-normalized keyword corpus. Non-text native
 * content blocks (including tool arguments) are encoded in the bounded BODY, never metadata. */
export function bodyText(entry: SessionEntry): string {
	if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
	const contentText = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content)
		? content.map(block => block?.type === "text" && typeof block.text === "string" ? block.text : JSON.stringify(block)).join("\n") : "";
	if (entry.type === "context_edit") return contentText(entry.replacement?.content);
	return sessionEntryToContextMessages(entry).map(message => contentText((message as { content?: unknown }).content)).join("\n");
}
function fragment(hit: IndexedHit, body: string, offset = 0, allowance = FRAGMENT_MAX_CHARS): RecallFragment {
	const chars = [...body], remaining = chars.length - offset, cap = Math.min(FRAGMENT_MAX_CHARS, allowance);
	const truncated = remaining > cap;
	return { locator: locator(hit), text: chars.slice(offset, offset + (truncated ? cap - 1 : cap)).join("") + (truncated ? "…" : ""),
		truncated, originalChars: chars.length };
}

/** Counts the JSON metadata envelope, excluding ONLY the two declared body fields. */
export function metadataCharacters(value: unknown): number {
	const copy = structuredClone(value) as { groups?: SearchGroup[]; fragments?: RecallFragment[] };
	for (const group of copy.groups ?? []) group.snippet.text = "";
	for (const piece of copy.fragments ?? []) piece.text = "";
	return scalars(JSON.stringify(copy));
}
/** Never publish per-file work strings (they can contain paths or parser excerpts). */
export function boundedCoverage(progress: IndexProgress): IndexProgress {
	return { ...progress, work: [], collectionError: progress.collectionError ? "collection-unavailable" : undefined };
}
export function combineCoverage(preparation: IndexProgress, action: IndexProgress): IndexProgress {
	const combined = boundedCoverage(action);
	for (const key of WORK) combined[key] += preparation[key];
	return combined;
}

/** All source access is through the accepted index fences, including ancestry. No alternate
 * file reader, persistent body cache, model, or remote fallback exists in this layer. */
export class SessionRecall {
	readonly index: SessionIndex;
	private readonly cursorKey = randomBytes(32);
	private sources = new Map<string, Source | undefined>();
	private origins = new Map<string, { key: string; value: SessionOrigin }>();
	private work: Partial<Record<typeof WORK[number], number>> = {};
	private activeFile?: string;
	private activeEntries = new Map<string, string>();
	private setupWork?: IndexProgress;

	constructor(options: SessionIndexOptions) { this.index = new SessionIndex(options); this.setupWork = this.index.status(); }
	setActiveContext(file: string | undefined, entries: SessionEntry[]) {
		this.activeFile = file ? resolve(file) : undefined;
		this.activeEntries = new Map(entries.map(entry => [entry.id, digest(JSON.stringify(entry))]));
	}
	private begin() { this.sources.clear(); this.origins.clear(); this.work = {}; }
	private capture() {
		const progress = this.index.status();
		for (const key of WORK) this.work[key] = (this.work[key] ?? 0) + progress[key];
	}
	private observe<T>(operation: () => T): T { const result = operation(); this.capture(); return result; }
	private coverage(): IndexProgress {
		const progress = boundedCoverage(this.index.status());
		for (const key of WORK) progress[key] = this.work[key] ?? 0;
		return progress;
	}
	async prepare(): Promise<IndexProgress> {
		this.begin();
		if (this.setupWork) {
			for (const key of WORK) this.work[key] = this.setupWork[key];
			this.setupWork = undefined;
		}
		await this.index.enumerate(); this.capture();
		this.observe(() => this.index.advance()); // ONE staging batch, not a hidden full-index loop.
		return this.coverage();
	}
	progress(): IndexProgress { return this.coverage(); }
	private source(path: string): Source | undefined {
		path = resolve(path);
		if (!this.sources.has(path)) this.sources.set(path, this.observe(() => this.index.sourceIdentity(path)));
		return this.sources.get(path);
	}
	private current(): boolean {
		for (const [path, source] of this.sources) {
			if (!source) continue;
			const now = this.observe(() => this.index.sourceIdentity(path));
			if (!now || now.fingerprint !== source.fingerprint) return false;
		}
		return true;
	}
	private encode(cursor: Cursor): string {
		const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
		return payload + "." + createHmac("sha256", this.cursorKey).update(payload).digest("base64url");
	}
	private decode(raw: unknown, kind: Cursor["kind"]): Cursor | undefined {
		if (typeof raw !== "string" || raw.length > 8192) return undefined;
		const [payload, signature, extra] = raw.split(".");
		if (!payload || !signature || extra !== undefined) return undefined;
		const expected = createHmac("sha256", this.cursorKey).update(payload).digest();
		const actual = Buffer.from(signature, "base64url");
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
		try {
			const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
			return c?.kind === kind && typeof c.file === "string" && typeof c.entry === "string" && typeof c.proof === "string" ? c : undefined;
		} catch { return undefined; }
	}
	/** Bound the authorized scope into every cursor: a cross-project or differently
	 *  scoped cursor is never authority inside a narrower instance. */
	private scopeDigest(): string {
		const scope = this.index.scope;
		return digest(JSON.stringify({ dir: scope.sessionDir, collections: [...scope.collections].sort(),
			cwd: scope.cwd ?? null, cwdMode: scope.cwdMode, ids: [...scope.sessionIds].sort() }));
	}
	/** Explainable source/scope policy on every outward page (5.3): closed vocabulary,
	 *  counts honest, no raw payloads. */
	private filters(hidden: number) {
		const scope = this.index.scope;
		return { scope: this.scopeDigest(), cwd: scope.cwd,
			hiddenSources: [...HIDDEN_SESSION_SOURCES], demotedSources: [...DEMOTED_SESSION_SOURCES], hidden };
	}
	private origin(path: string): { key: string; value: SessionOrigin } {
		path = resolve(path);
		const cached = this.origins.get(path);
		if (cached) return cached;
		const first = this.source(path);
		let current = first;
		const seen = new Set<string>();
		let reason: string | undefined;
		while (current?.parentSession) {
			if (seen.has(current.sessionFile)) { reason = "cyclic-ancestry"; break; }
			seen.add(current.sessionFile);
			const parentPath = resolve(dirname(current.sessionFile), current.parentSession);
			// Parent must live inside an AUTHORIZED collection — a fork pointer can never
			// widen scope beyond the store's authorized dirs.
			const inside = [...this.index.scope.collections].some(dir => parentPath.startsWith(dir + sep));
			if (!inside) { reason = "parent-outside-collection"; break; }
			const parent = this.source(parentPath);
			if (!parent) { reason = "parent-unavailable"; break; }
			const shared = [...current.digests].filter(([id]) => parent.digests.has(id));
			if (!shared.length || shared.some(([id, hash]) => parent.digests.get(id) !== hash)) {
				reason = "unverified-or-divergent-fork"; break;
			}
			current = parent;
		}
		if (!first) reason = "source-unavailable";
		const owner = reason ? first : current;
		const result = { key: owner?.sessionFile ?? path, value: {
			originSessionId: owner?.sessionId ?? null, originUnknown: !!reason, reason,
		} };
		this.origins.set(path, result);
		return result;
	}
	originOf(path: string): SessionOrigin {
		this.begin(); const result = this.origin(path).value;
		return this.current() ? result : { originSessionId: null, originUnknown: true, reason: "source-changed" };
	}
	private active(hit: IndexedHit): boolean {
		if (!this.activeFile || !this.activeEntries.has(hit.entryId)) return false;
		if (hit.sessionFile === this.activeFile) return true;
		const origin = this.origin(hit.sessionFile), activeOrigin = this.origin(this.activeFile);
		return !origin.value.originUnknown && !activeOrigin.value.originUnknown && origin.key === activeOrigin.key
			&& this.source(hit.sessionFile)?.digests.get(hit.entryId) === this.activeEntries.get(hit.entryId);
	}
	private body(hit: IndexedHit): string | undefined {
		const source = this.source(hit.sessionFile);
		const read = this.observe(() => this.index.readSource(hit));
		if (!source || "error" in read || source.digests.get(hit.entryId) !== digest(read.raw)) return undefined;
		if (!["compaction", "branch_summary", "context_edit"].includes(read.entry.type)) {
			this.work.nativeProjectionEntries = (this.work.nativeProjectionEntries ?? 0) + 1;
		}
		return bodyText(read.entry);
	}
	private searchProof(hit: Pick<IndexedHit, "sessionFile" | "entryId">, origin: SessionOrigin): string {
		const source = this.source(hit.sessionFile)!;
		return digest(source.headerDigest + ":" + source.digests.get(hit.entryId) + ":" + JSON.stringify(origin));
	}
	/** Ordered classification signature over the full deduplicated candidate set:
	 *  per-group owning file + declared-source label. A source-policy mutation
	 *  (declared cron→cli, hidden↔visible) changes the signature and invalidates
	 *  the continuation; unchanged-body appends keep the same (file,source) list
	 *  order, so accepted historical pagination still resumes. */
	private rankProof(all: { hit: IndexedHit }[]): string {
		return digest(all.map(g => g.hit.sessionFile + ":" + (this.source(g.hit.sessionFile)?.source ?? "unavailable")).join("|"));
	}
	/** Catalog-side analogue: ordered (file, classified source) identity over the
	 *  eligible session rows — non-anchor hidden↔visible changes and eligibility
	 *  removals invalidate the cursor without binding full file content. */
	private catalogRankProof(eligible: { sessionFile: string; source: string }[]): string {
		return digest(eligible.map(s => s.sessionFile + ":" + s.source).join("|"));
	}
	private fits(value: unknown): boolean {
		// Reserve room for the public tool's fixed budget/coverage envelope and numeric details.
		return metadataCharacters(value) <= METADATA_MAX_CHARS - 2048;
	}
	private unavailable(): RecallOutcomeError { return { error: "unavailable: source changed or is not currently eligible; prepare/restart recall" }; }

	catalog(options: { limit?: unknown; cursor?: unknown } = {}): CatalogPage | RecallOutcomeError {
		this.begin();
		const c = options.cursor === undefined ? undefined : this.decode(options.cursor, "catalog");
		if (options.cursor !== undefined && !c) return { error: "invalid-cursor: restart the catalog" };
		if (c && c.scope !== this.scopeDigest()) return { error: "cursor-scope-mismatch: cursor was minted under a different authorized scope; restart" };
		const eligible = this.observe(() => this.index.sessions()).filter(s => s.sessionFile !== this.activeFile);
		// Hermes browse: declared kanban/subagent/tool sessions are hidden from the
		// catalog; unknown stays visible. Demotion is a search-rank rule only.
		const hidden = eligible.filter(s => (HIDDEN_SESSION_SOURCES as readonly string[]).includes(s.source)).length;
		const all = eligible.filter(s => !(HIDDEN_SESSION_SOURCES as readonly string[]).includes(s.source));
		const start = c ? all.findIndex(s => digest(s.sessionFile) === c.file && this.source(s.sessionFile)?.headerDigest === c.proof) + 1 : 0;
		// Same policy principle as search: continuation binds the ordered eligible
		// classification identity, not just scope+anchor — a hidden→visible or
		// visible→hidden non-anchor change makes the page position meaningless.
		if (c && (!start || this.catalogRankProof(eligible) !== c.rank)) {
			return { error: "stale-cursor: restart the catalog" };
		}
		const sessions: SessionSummaryEntry[] = [];
		for (const item of all.slice(start, start + clamp(options.limit))) {
			const next = { ...item, origin: this.origin(item.sessionFile).value };
			if (!this.fits({ sessions: [...sessions, next], filters: this.filters(hidden) })) break;
			sessions.push(next);
		}
		if (!sessions.length && start < all.length) return { error: "metadata-too-large: locator cannot fit without truncation" };
		if (!this.current()) return this.unavailable();
		const last = sessions.at(-1);
		return { sessions, total: all.length, coverage: this.coverage(), filters: this.filters(hidden),
			nextCursor: last && start + sessions.length < all.length ? this.encode({ kind: "catalog", file: digest(last.sessionFile),
				entry: "", proof: this.source(last.sessionFile)!.headerDigest, scope: this.scopeDigest(),
				rank: this.catalogRankProof(eligible) }) : undefined };
	}
	/** Convenience catalog still obeys the default page bound. */
	sessions(): SessionSummaryEntry[] { const p = this.catalog(); return "error" in p ? [] : p.sessions; }

	search(query: string, options: { limit?: unknown; cursor?: unknown } = {}): SearchOutcome {
		this.begin();
		const queryHash = digest(query.toLowerCase().split(/\s+/).filter(Boolean).join(" "));
		const c = options.cursor === undefined ? undefined : this.decode(options.cursor, "search");
		if (options.cursor !== undefined && (!c || c.query !== queryHash)) return { error: "invalid-cursor: restart this query" };
		if (c && c.scope !== this.scopeDigest()) return { error: "cursor-scope-mismatch: cursor was minted under a different authorized scope; restart" };
		// Scan metadata, not an arbitrary first 1000 rows which would hide later sessions.
		const scan = this.observe(() => this.index.search(query, Number.MAX_SAFE_INTEGER));
		// Hermes discover: hide declared kanban/subagent/tool sources BEFORE ranking;
		// demote cron below other eligible rows BEFORE dedup/limit so high-volume
		// automation cannot starve the user's own sessions (stable within each class).
		let hidden = 0;
		const ranked = scan.hits.filter(hit => {
			if ((HIDDEN_SESSION_SOURCES as readonly string[]).includes(hit.source)) { hidden++; return false; }
			return true;
		}).sort((a, b) => Number((DEMOTED_SESSION_SOURCES as readonly string[]).includes(a.source))
			- Number((DEMOTED_SESSION_SOURCES as readonly string[]).includes(b.source)));
		const candidates = new Map<string, { hit: IndexedHit; matches: Set<string>; origin: SessionOrigin }>();
		for (const hit of ranked) {
			if (this.active(hit)) continue;
			const origin = this.origin(hit.sessionFile);
			const hash = this.source(hit.sessionFile)?.digests.get(hit.entryId);
			if (!hash) return this.unavailable();
			let group = candidates.get(origin.key);
			if (!group) { group = { hit, matches: new Set(), origin: origin.value }; candidates.set(origin.key, group); }
			group.matches.add(hit.entryId + ":" + hash);
		}
		const all = [...candidates.values()];
		const start = c ? all.findIndex(g => digest(g.hit.sessionFile) === c.file && g.hit.entryId === c.entry
			&& this.searchProof(g.hit, g.origin) === c.proof) + 1 : 0;
		if (c && (!start || this.rankProof(all) !== c.rank)) {
			return { error: "stale-cursor: restart the search" };
		}
		const groups: SearchGroup[] = []; let bodyChars = 0;
		for (const candidate of all.slice(start)) {
			if (groups.length >= clamp(options.limit) || PAGE_BODY_MAX_CHARS - bodyChars < 2) break;
			const body = this.body(candidate.hit);
			if (body === undefined) return this.unavailable();
			const snippet = fragment(candidate.hit, body, 0, PAGE_BODY_MAX_CHARS - bodyChars);
			const group = { locator: locator(candidate.hit), snippet, matches: candidate.matches.size, origin: candidate.origin };
			if (!this.fits({ groups: [...groups, group], filters: this.filters(hidden) })) break;
			groups.push(group); bodyChars += scalars(snippet.text);
		}
		if (!groups.length && start < all.length) return { error: "metadata-too-large: locator cannot fit without truncation" };
		if (!this.current()) return this.unavailable();
		const last = groups.at(-1)?.locator;
		return { groups, total: all.length, bodyChars, coverage: this.coverage(), filters: this.filters(hidden),
			nextCursor: last && start + groups.length < all.length ? this.encode({ kind: "search", query: queryHash,
				file: digest(last.sessionFile), entry: last.entryId, proof: this.searchProof(last, groups.at(-1)!.origin),
				scope: this.scopeDigest(), rank: this.rankProof(all) }) : undefined };
	}

	read(sessionId: string, entryId?: string, cursor?: unknown): ReadOutcome {
		this.begin();
		const c = cursor === undefined ? undefined : this.decode(cursor, "read");
		if (cursor !== undefined && !c) return { error: "invalid-cursor: restart the read" };
		if (c && c.scope !== this.scopeDigest()) return { error: "cursor-scope-mismatch: cursor was minted under a different authorized scope; restart" };
		// Explicit ID read stays inside THIS selected scope: the session must be a
		// live-eligible member of the authorized collections. A miss is a miss — no
		// fallback into other stores, and hidden-source sessions remain readable
		// here by id (Hermes direct-read behavior), never via search/browse.
		const sessions = this.observe(() => this.index.sessions()).filter(s => s.sessionId === sessionId);
		if (sessions.length !== 1) return { error: "unavailable: session is missing or ambiguous in this collection" };
		const source = this.source(sessions[0].sessionFile);
		if (!source) return this.unavailable();
		if (c && (c.file !== digest(source.sessionFile) || (entryId && c.anchor !== entryId && c.entry !== entryId))) {
			return { error: "cursor-target-mismatch: restart from the requested session/entry" };
		}
		let position = c ? source.hits.findIndex(h => h.entryId === c.entry)
			: entryId ? source.hits.findIndex(h => h.entryId === entryId) : 0;
		if (position < 0) return this.unavailable();
		const prefix = (index: number) => digest(source.headerDigest + JSON.stringify(source.hits.slice(0, index + 1)
			.map(h => [h.entryId, source.digests.get(h.entryId)])));
		if (c && (prefix(position) !== c.proof || !Number.isSafeInteger(c.offset) || c.offset! < 0)) {
			return { error: "stale-cursor: selected source prefix changed; restart the read" };
		}
		let offset = c?.offset ?? 0, bodyChars = 0;
		const fragments: RecallFragment[] = [];
		const anchor = c?.anchor ?? entryId ?? source.hits[0]?.entryId ?? "";
		while (position < source.hits.length && fragments.length < READ_MAX_FRAGMENTS && PAGE_BODY_MAX_CHARS - bodyChars >= 2) {
			const hit = source.hits[position];
			if (this.active(hit)) {
				if (entryId === hit.entryId || c?.entry === hit.entryId) return { error: "already-in-active-context: choose archived history" };
				position++; offset = 0; continue;
			}
			const body = this.body(hit);
			if (body === undefined) return this.unavailable();
			if (offset > scalars(body)) return { error: "stale-cursor: offset exceeds current source body" };
			const piece = fragment(hit, body, offset, PAGE_BODY_MAX_CHARS - bodyChars);
			if (!this.fits({ fragments: [...fragments, piece] })) break;
			fragments.push(piece); bodyChars += scalars(piece.text);
			offset += scalars(piece.text) - (piece.truncated ? 1 : 0);
			if (!piece.truncated) { position++; offset = 0; }
		}
		if (!fragments.length && position < source.hits.length) return { error: "metadata-too-large: locator cannot fit without truncation" };
		if (!this.current()) return this.unavailable();
		const next = source.hits[position];
		return { fragments, bodyChars, budgetStopped: !!next, nextOffset: offset, nextEntryId: next?.entryId,
			nextCursor: next ? this.encode({ kind: "read", file: digest(source.sessionFile), entry: next.entryId,
				anchor, offset, proof: prefix(position), scope: this.scopeDigest() }) : undefined, coverage: this.coverage() };
	}
}

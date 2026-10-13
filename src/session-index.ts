import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	CURRENT_SESSION_VERSION, buildSessionProjection, parseSessionEntries,
	type SessionEntry, type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { interpretSessionSource, type SessionSourceRead } from "./session-source.ts";

/**
 * Session recall index (OpenSpec 5.1 / D5): a derived, rebuildable keyword index over native
 * Pi JSONL sessions inside ONE explicitly authorized session directory. The JSONL files are
 * the sole source of truth — this module never opens them for writing, never repairs them,
 * never calls a model. A lost/corrupt/incompatible cache rebuilds from source bytes.
 *
 * Four invariants structure the implementation:
 *  1. Discovery is not authorization — enumeration and cache metadata only ever create
 *     PENDING lexical candidates inside the canonical collection; identity/scope authority
 *     comes exclusively from a freshly parsed, validated, current native session header.
 *  2. Every retained byte (committed prefix, staged fragment, scan cursor) belongs to the
 *     verified CURRENT source revision — one shared verification boundary discards
 *     inconsistent state instead of serving stale corpus under a new fingerprint.
 *  3. Every outward hit/raw read binds the current authorized source and the exact genuine
 *     locator owned by this index; caller-supplied metadata is never authority.
 *  4. Unknown/unreadable/corrupt/not-yet-covered data stays visibly pending/unavailable —
 *     never a successful empty history or a silently partial eligible corpus.
 *
 * Stage accounting (D5, user-selected batching): `batchBytes` bounds only NEW source bytes
 * staged for parsing per advance(). Enumeration, whole/prefix verification, completed-record
 * decode/projection and derived-cache reads/writes are measured and reported separately and
 * are NOT capped — a giant record's completion decode may exceed the staging budget and is
 * disclosed as such. All byte counters are local operation measurements, not physical disk
 * traffic or model tokens.
 */

export const SESSION_INDEX_VERSION = 3;
/** Bounded per-hit presentation preview; the searchable corpus is the full entry text. */
export const PREVIEW_MAX_CHARS = 400;
/** Bounded first-line probe used to classify candidates during enumeration. A candidate whose
 *  header line exceeds it stays visibly pending (`header-over-scan-limit`), never silently
 *  dropped — the parse phase still indexes it once bytes are actually staged. */
const HEADER_PROBE_BYTES = 64 * 1024;
/** Native entry types written by the SDK (session-recall file format, 0.99.2). */
const NATIVE_ENTRY_TYPES = new Set([
	"message", "thinking_level_change", "model_change", "usage", "compaction", "branch_summary",
	"custom", "custom_message", "context_edit", "label", "session_info",
]);

export interface SessionIndexScope {
	/**
	 * Authorized session directory containing native *.jsonl files, OR the native-store
	 * root when `collections` is set. A single sessionDir remains valid without
	 * `collections` (current host custom collection, still usable by default — its
	 * presence alone is not a cross-project grant).
	 */
	sessionDir: string;
	/**
	 * Explicit authorized collection dirs for the native-store layout. A collection
	 *  is a FLAT directory: only files whose canonical DIRECT parent equals the
	 *  collection are members — deeper paths, unselected sibling dirs and symlinked
	 *  sources are never authorized, before cache adoption and at every body access.
	 *  sessionDir is always a member; entries need not live under sessionDir when
	 *  the trusted host explicitly names them (e.g. a custom host collection).
	 *  Source selectors are never accepted here: authorization comes from trusted
	 *  host dirs only.
	 */
	collections?: string[];
	/** Restrict to sessions whose header cwd is authorized by `cwdMode`:
	 *  "project" — canonical realpath containment (resolved project root + descendants);
	 *  "exact" — canonical equality only (unresolved project identity fallback).
	 *  The mode is explicit: supplying cwd alone never grants project containment. */
	cwd?: string;
	/** Matching mode for `cwd`. Defaults to "exact" — the conservative fallback. */
	cwdMode?: "exact" | "project";
	/** Restrict to these session ids after header parsing. */
	sessionIds?: string[];
}
export interface SessionIndexPaths { sessionDir: string; indexFile: string }
export interface SessionIndexOptions {
	scope: SessionIndexScope;
	/** Derived cache location; canonical parent must resolve outside sessionDir. */
	indexFile?: string;
	/** Max NEW source bytes staged for parsing per advance() call (batched progress). */
	batchBytes?: number;
}
export interface EntryLocation {
	/** True when the entry sits on the session's NATIVE parent ancestry, reconstructed from
	 *  the last physical entry (the SDK's reload leaf rule). This is deliberately NOT the
	 *  compaction-selected effective context: a summarized ancestor still lies on the native
	 *  branch. No inference about any live in-memory session leaf is made. */
	onCurrentBranch: boolean;
	/** Visible markers at this entry: `compaction`/`branch-summary` (self type) plus
	 *  branch-local EFFECTIVE `context-edit`/`labelled` markers — only edits and label sets
	 *  whose causing entries lie on the native ancestry, with later on-ancestry label clears
	 *  removing the marker. Sibling-branch events are not current-effective. */
	markers: string[];
}
export interface IndexedHit {
	sessionId: string;
	sessionFile: string;
	entryId: string;
	parentId: string | null;
	type: string;
	role?: string;
	timestamp: string;
	/** Canonical collection directory that owns this hit (bounded source identity).
	 *  `cwd` is the validated native header cwd — never inferred from the collection
	 *  name and never caller-supplied. */
	collection: string;
	cwd: string;
	/** Genuine declared-source label via the producer interpreter, or "unknown".
	 *  Never arbitrary payload text: provenance stays on the source identity. */
	source: string;
	/** Exact UTF-8 byte offset + raw JSONL line length: enough for 5.2 to re-read the source. */
	offset: number;
	lineBytes: number;
	/** Presentation-only snippet — search runs over the full entry text, not this. */
	preview: string;
	previewTruncated: boolean;
	location: EntryLocation;
}
export interface FileIndexState {
	path: string;
	sessionId?: string;
	/** Canonical collection dir owning this file. */
	collection?: string;
	status: "indexed" | "pending" | "unavailable";
	indexedBytes: number;
	size: number;
	entries: number;
	reason?: string;
}
export interface IndexProgress {
	filesTotal: number;
	filesIndexed: number;
	filesPending: number;
	filesUnavailable: number;
	entries: number;
	bytesTotal: number;
	bytesIndexed: number;
	done: boolean;
	work: string[];
	/** Measured local work of the last public call, by stage (bytes; not disk traffic/tokens).
	 *  `stagedBytes` is the only batchBytes-budgeted stage; the others are disclosure only. */
	stagedBytes: number;
	/** Enumeration/catalog reads (header classification probes). */
	enumeratedBytes: number;
	/** Full-file and retained-state/source-span reads, split by actual purpose. */
	verifiedBytes: number;
	fingerprintBytes: number;
	prefixProofBytes: number;
	fragmentProofBytes: number;
	locatorReadBytes: number;
	/** Bytes passed to the native parser, excluding catalog decoding and branch traversal. */
	decodedBytes: number;
	catalogDecodedBytes: number;
	/** Input entries projected individually / visited to reconstruct branch metadata.
	 * These are input cardinalities, not decoded bytes, CPU time or physical IO. */
	nativeProjectionEntries: number;
	branchEntries: number;
	cacheReadBytes: number;
	cacheWriteBytes: number;
	/** Set when the collection directory itself is missing/aliased/unreadable. */
	collectionError?: string;
}
export interface SearchPage { hits: IndexedHit[]; total: number; nextCursor?: number; coverage: IndexProgress }

interface FileState {
	/** Canonical (realpath) key inside an authorized collection. */
	path: string;
	/** Canonical collection dir authorized for this file. */
	collection: string;
	/** Authority: id of the validated CURRENT header. While pending this is only a hint. */
	sessionId?: string;
	status: "indexed" | "pending" | "unavailable";
	reason?: string;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	ino: number;
	/** Source bytes whose entries are committed to `hits` (always a complete-line boundary). */
	indexedBytes: number;
	/** Read cursor incl. buffered bytes of an in-progress line (> indexedBytes mid-line). */
	scannedBytes: number;
	/** sha256 of the whole file at last committed/verified state — detects any drift. */
	contentHash?: string;
	/** sha256 of source[:indexedBytes] — proof for the committed retained prefix. */
	prefixHash?: string;
	/** sha256 of source[indexedBytes:scannedBytes] — proof for the staged fragment. */
	stagedHash?: string;
	/** Per-entry keyword corpus (full searchable text); kept in memory, not mirrored to cache. */
	texts: Map<string, string>;
	hits: IndexedHit[];
	byId: Map<string, IndexedHit>;
	/** Raw-line digest per entry id — detects conflicting duplicate identities. */
	lineHashById: Map<string, string>;
	/** Physical tail identity is independent of deduplicated searchable entries. */
	lastPhysicalEntryId?: string;
	/** Current-file parsed entries for incremental branch bookkeeping. */
	entries: SessionEntry[];
	header?: SessionHeader;
	/** Declared-source interpretation over the CURRENT verified entries (producer
	 *  reader only ever sees already-parsed header+entries — no second file reader). */
	source?: SessionSourceRead;
	/** Raw bytes of an in-progress line that exceeds one batch. */
	fragment: Buffer;
	/** True when the current pending pass was verified as a pure append. */
	appended?: boolean;
	/** True when previously-indexed entries had to be discarded (rebuild, not fresh). */
	rebuilt?: boolean;
}

const sha256 = (buffer: Buffer | string) => createHash("sha256").update(buffer).digest("hex");
const byteLength = (text: string) => Buffer.byteLength(text, "utf8");
const asRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const errorCode = (error: unknown): string => (error as NodeJS.ErrnoException).code ?? "fault";

function readRange(path: string, offset: number, length: number): Buffer {
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, "r");
	try {
		let got = 0;
		while (got < length) {
			const n = readSync(fd, buffer, got, length - got, offset + got);
			if (n <= 0) break;
			got += n;
		}
		return buffer.subarray(0, got);
	} finally { closeSync(fd); }
}

/** Required native header shape — provenance (id/cwd/version) must be real, never fabricated. */
function headerShapeError(header: Record<string, unknown>): string | undefined {
	if (typeof header.id !== "string" || !header.id) return "header-missing-id";
	if (typeof header.timestamp !== "string" || !header.timestamp) return "header-missing-timestamp";
	if (typeof header.cwd !== "string") return "header-missing-cwd";
	if (typeof header.version !== "number" || !Number.isSafeInteger(header.version) || header.version < 1) return "header-invalid-version";
	return undefined;
}
/** Public ContextEditableContent: string or native content blocks; null belongs to the
 * replacement itself (omission), not its required content field. */
function validContextContent(content: unknown): boolean {
	if (typeof content === "string") return true;
	return Array.isArray(content) && content.every(block => {
		if (!asRecord(block)) return false;
		switch (block.type) {
			case "text": return typeof block.text === "string";
			case "thinking": return typeof block.thinking === "string";
			case "image": return typeof block.data === "string" && typeof block.mimeType === "string";
			case "toolCall": return typeof block.id === "string" && typeof block.name === "string" && asRecord(block.arguments);
			default: return false;
		}
	});
}

/** Required native entry shape, validated BEFORE any projection/commit (public parser is
 *  permissive: it skips malformed JSON rows and returns raw values incl. `null`). */
function entryShapeError(entry: unknown): string | undefined {
	if (!asRecord(entry)) return "entry-not-object";
	if (typeof entry.type !== "string" || !NATIVE_ENTRY_TYPES.has(entry.type)) return `unsupported-entry-type:${String(entry.type)}`;
	if (typeof entry.id !== "string" || !entry.id) return "missing-entry-id";
	if (entry.parentId !== null && typeof entry.parentId !== "string") return "invalid-parent-id";
	if (typeof entry.timestamp !== "string" || !entry.timestamp) return "missing-entry-timestamp";
	if (entry.type === "message") {
		const message = entry.message;
		if (!asRecord(message)) return "message-entry-without-message";
		if (typeof message.role !== "string" || !message.role) return "message-entry-without-role";
	}
	const text = (key: string) => typeof entry[key] === "string";
	switch (entry.type) {
		case "compaction":
			if (!text("summary") || !text("firstKeptEntryId") || typeof entry.tokensBefore !== "number" || !Number.isFinite(entry.tokensBefore)) return "invalid-compaction";
			break;
		case "branch_summary":
			if (!text("summary") || !text("fromId")) return "invalid-branch-summary";
			break;
		case "context_edit":
			if (!text("targetId") || (entry.replacement !== null &&
				(!asRecord(entry.replacement) || !validContextContent(entry.replacement.content)))) return "invalid-context-edit";
			break;
		case "label":
			if (!text("targetId") || (entry.label !== undefined && !text("label"))) return "invalid-label";
			break;
		case "custom":
			if (!text("customType")) return "invalid-custom-entry";
			break;
		case "custom_message":
			if (!text("customType") || typeof entry.display !== "boolean") return "invalid-custom-message";
			break;
		case "thinking_level_change":
			if (!text("thinkingLevel")) return "invalid-thinking-level";
			break;
		case "model_change":
			if (!text("provider") || !text("modelId")) return "invalid-model-change";
			break;
		case "usage":
			if (!text("kind") || !text("provider") || !text("model") || !asRecord(entry.usage)) return "invalid-usage";
			break;
		case "session_info":
			if (entry.name !== undefined && !text("name")) return "invalid-session-info";
	}
	return undefined;
}

/** Extract searchable text via the official projection of a single entry. */
function entryText(entry: SessionEntry): string {
	const parts: string[] = [];
	for (const message of buildSessionProjection([entry], entry.id).messages) {
		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") parts.push(content);
		else if (Array.isArray(content)) {
			for (const block of content) {
				if (asRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
			}
		}
		const summary = (message as { summary?: unknown }).summary;
		if (typeof summary === "string") parts.push(summary);
		const toolCalls = (message as { toolCalls?: unknown }).toolCalls;
		if (Array.isArray(toolCalls)) for (const call of toolCalls) parts.push(JSON.stringify(call));
	}
	if (entry.type === "context_edit" && asRecord(entry.replacement)) {
		const content = entry.replacement.content;
		if (typeof content === "string") parts.push(content);
		else if (Array.isArray(content)) {
			for (const block of content) {
				if (asRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
			}
		}
	}
	return parts.join(" ").replace(/\s+/g, " ").trim();
}
function previewOf(text: string): { preview: string; truncated: boolean } {
	const chars = [...text];
	return chars.length <= PREVIEW_MAX_CHARS
		? { preview: text, truncated: false }
		: { preview: chars.slice(0, PREVIEW_MAX_CHARS).join(""), truncated: true };
}

/** Byte-exact line table: offsets of every non-empty line in a UTF-8 slice. */
function lineTable(raw: Buffer, baseOffset: number): { offset: number; length: number }[] {
	const lines: { offset: number; length: number }[] = [];
	let start = 0;
	for (let i = 0; i <= raw.length; i++) {
		if (i === raw.length || raw[i] === 0x0a) {
			const length = i - start;
			if (length > 0) lines.push({ offset: baseOffset + start, length });
			start = i + 1;
		}
	}
	return lines;
}

function emptyStage() {
	return { stagedBytes: 0, enumeratedBytes: 0, verifiedBytes: 0,
		fingerprintBytes: 0, prefixProofBytes: 0, fragmentProofBytes: 0, locatorReadBytes: 0,
		decodedBytes: 0, catalogDecodedBytes: 0, nativeProjectionEntries: 0, branchEntries: 0,
		cacheReadBytes: 0, cacheWriteBytes: 0 };
}

export class SessionIndex {
	readonly paths: SessionIndexPaths;
	readonly scope: { sessionDir: string; collections: Set<string>; cwd?: string; cwdMode: "exact" | "project"; sessionIds: Set<string> };
	private batchBytes: number;
	private rootCanonical: string;
	private files = new Map<string, FileState>();
	private order: string[] = [];
	private progress: IndexProgress = {
		filesTotal: 0, filesIndexed: 0, filesPending: 0, filesUnavailable: 0, entries: 0,
		bytesTotal: 0, bytesIndexed: 0, done: false, work: [],
		...emptyStage(),
	};
	private loadError?: string;
	private collectionError?: string;
	/** Per-public-call measured stage work (D5 disclosure; staging is the only budgeted stage). */
	private stage = emptyStage();

	constructor(options: SessionIndexOptions) {
		// Missing/unreadable collections are explicitly refused, never reported as empty.
		let sessionDir: string;
		try { sessionDir = realpathSync(options.scope.sessionDir); }
		catch (error) {
			throw new Error(`sessionDir must exist (${errorCode(error)}): ${resolve(options.scope.sessionDir)}`);
		}
		this.rootCanonical = sessionDir;
		// Authorized collections: sessionDir always; explicit entries are trusted host
		// collection dirs (canonicalized). Membership is checked per FILE by direct
		// canonical parent — never by path prefix — so a cached/hinted deeper path or
		// unselected sibling cannot be staged, decoded or adopted.
		const collections = new Set<string>([sessionDir]);
		for (const dir of options.scope.collections ?? []) {
			let canonical: string;
			try { canonical = realpathSync(dir); }
			catch (error) {
				throw new Error(`collection dir must exist (${errorCode(error)}): ${resolve(dir)}`);
			}
			collections.add(canonical);
		}
		// Derived-cache default placement must live OUTSIDE every authorized
		// collection: when sessionDir's parent is itself a collection (native-store
		// layout), walk up until the anchor is clear of authorized source dirs.
		let indexFile: string;
		if (options.indexFile) {
			indexFile = resolve(options.indexFile);
		} else {
			let anchor = dirname(sessionDir);
			while (collections.has(anchor)) anchor = dirname(anchor);
			indexFile = join(anchor, `${sessionDir.split("/").pop()}.session-index.jsonl`);
		}
		this.paths = { sessionDir, indexFile };
		const cwd = options.scope.cwd ? realpathSync(options.scope.cwd) : undefined;
		this.scope = {
			sessionDir,
			collections,
			cwd,
			// Explicit matching mode — no inference from cwd alone. Unresolved project
			// identity must use "exact"; only a trusted resolved project root may pass
			// "project" (canonical descendants included).
			cwdMode: options.scope.cwdMode ?? "exact",
			sessionIds: new Set(options.scope.sessionIds ?? []),
		};
		if (options.batchBytes !== undefined && (!Number.isFinite(options.batchBytes) || options.batchBytes <= 0)) {
			throw new Error("batchBytes must be a finite positive number");
		}
		this.batchBytes = options.batchBytes ?? 4 * 1024 * 1024;
		// F1: refuse the cache path BEFORE any load/write/destruction — the canonical parent
		// chain must never resolve into the source dir, the target must not alias a source,
		// and an EXISTING target that is not recognizably our derived cache (e.g. a native
		// session JSONL from any collection) is refused outright.
		this.assertCachePathSafe();
		this.loadCache();
		this.refreshProgress();
	}

	static cachePath(sessionDir: string): string {
		const dir = realpathSync(sessionDir);
		return join(dir, "..", `${dir.split("/").pop()}.session-index.jsonl`);
	}

	/** Canonical containment: path must live DIRECTLY inside an AUTHORIZED collection
	 *  — the file's canonical direct parent equals a selected collection (flat native
	 *  layout). A descendant at any deeper level, an unselected sibling dir or a
	 *  symlinked body is never in scope, regardless of cache hints. */
	private inScope(path: string): boolean {
		return this.collectionOf(path) !== undefined;
	}

	/** Owning authorized collection for a file path, or undefined when the file's
	 *  canonical DIRECT parent is not a selected collection. The lexical resolved
	 *  path must sit directly inside the collection AND its realpath's direct parent
	 *  must equal that collection — a deeper path or symlink escape is refused. */
	private collectionOf(path: string): string | undefined {
		const resolved = resolve(path);
		for (const collection of this.scope.collections) {
			if (dirname(resolved) !== collection) continue;
			let canonical: string;
			try { canonical = realpathSync(resolved); }
			catch { return undefined; }
			if (dirname(canonical) === collection && canonical !== collection) return collection;
			return undefined;
		}
		return undefined;
	}

	/** Cache path fence: the canonical TARGET itself must never equal or nest under
	 *  any authorized collection (whole-tree protection — a symlink/alias whose real
	 *  file lands anywhere inside the source tree is refused even when the lexical
	 *  path lives outside), the index file must never be a source JSONL, and an
	 *  existing target must be recognizably derived-cache content. Flat collectionOf()
	 *  is for READ membership only; ownership here is tree-wide canonical containment. */
	private assertCachePathSafe(): void {
		const indexFile = this.paths.indexFile;
		if (resolve(indexFile).endsWith(".jsonl") && this.inScope(indexFile)) {
			throw new Error("Derived index path must not be a source session file");
		}
		// TWO independent canonical fences, both whole-tree against every collection:
		// (a) write-location fence — the canonical existing ancestor of
		//     dirname(indexFile); a lexical alias INSIDE a collection (e.g. symlink to
		//     an external derived cache) is refused because temp/rename/reset files
		//     would be created inside the source tree.
		// (b) target fence — the canonical target itself (alias → real file) must not
		//     equal or nest under any collection, even when the lexical alias is
		//     outside (existing-ancestor walk covers pending targets too).
		let ancestor = dirname(indexFile);
		while (!existsSync(ancestor)) {
			const parent = dirname(ancestor);
			if (parent === ancestor) break;
			ancestor = parent;
		}
		const canonicalAncestor = realpathSync(ancestor);
		let target = indexFile;
		while (!existsSync(target)) {
			const parent = dirname(target);
			if (parent === target) break;
			target = parent;
		}
		const canonicalTarget = realpathSync(target);
		const canonicalFile = existsSync(indexFile)
			? realpathSync(indexFile)
			: canonicalTarget === target
				? indexFile
				: join(canonicalTarget, relative(target, indexFile));
		for (const collection of this.scope.collections) {
			if (canonicalAncestor === collection || canonicalAncestor.startsWith(collection + sep)
				|| canonicalTarget === collection || canonicalTarget.startsWith(collection + sep)
				|| canonicalFile === collection || canonicalFile.startsWith(collection + sep)) {
				throw new Error("Derived index path resolves inside an authorized session collection");
			}
		}
		if (existsSync(indexFile)) {
			if (this.collectionOf(canonicalFile) !== undefined) {
				throw new Error("Derived index path aliases a source session file");
			}
			if (!this.looksLikeDerivedCache(indexFile)) {
				throw new Error("Derived index target already exists and is not a derived session-index cache; refusing to overwrite it");
			}
		}
	}
	/** Empty targets or a recognizable first meaningful derived-cache record only.
	 * Whitespace and an exhausted probe never grant destructive ownership. */
	private looksLikeDerivedCache(path: string): boolean {
		try {
			const probe = readRange(path, 0, 4096);
			this.stage.cacheReadBytes += probe.length;
			if (probe.length === 0) return statSync(path).size === 0;
			const first = probe.toString("utf8").split("\n").find(line => line.trim());
			if (!first) return false;
			const record = JSON.parse(first) as unknown;
			return asRecord(record) && !("type" in record)
				&& (record.kind === "file" || record.kind === "entry") && typeof record.v === "number";
		} catch { return false; }
	}

	/** Collection-root fence: every authorized collection must still resolve to the same
	 *  canonical dir (a parent-directory swap to external storage is a scope change). A
	 *  removed/unreadable EXTRA collection reports unavailable; a broken root does too. */
	private checkRoot(): boolean {
		try {
			if (realpathSync(this.scope.sessionDir) !== this.rootCanonical) {
				this.collectionError = "collection-alias-changed";
				return false;
			}
		} catch (error) {
			this.collectionError = `collection-unreadable:${errorCode(error)}`;
			return false;
		}
		for (const collection of this.scope.collections) {
			if (collection === this.rootCanonical) continue;
			try {
				// Each authorized collection must still resolve to itself — a swap to
				// external storage is a scope change, not a refresh.
				if (realpathSync(collection) !== collection) {
					this.collectionError = "collection-alias-changed";
					return false;
				}
			} catch (error) {
				this.collectionError = `collection-unreadable:${errorCode(error)}`;
				return false;
			}
		}
		this.collectionError = undefined;
		return true;
	}

	/** Per-file canonical fence BEFORE any content read: the tracked (canonical) key must
	 *  still resolve to itself inside the collection. A late symlink swap is a scope escape. */
	private fenceSource(path: string): "ok" | "missing" | "escaped" {
		try {
			if (realpathSync(path) !== path) return "escaped";
		} catch { return "missing"; }
		return "ok";
	}

	/**
	 * Enumerate + classify every lexical *.jsonl candidate in EVERY authorized collection
	 * (each flat dir, no recursion). Classification reads are bounded first-line probes
	 * behind the canonical fence; damaged, unreadable, alias-escaping and over-limit
	 * candidates stay VISIBLY tracked as unavailable/pending with a reason — never
	 * silently dropped as a perfect empty corpus. Healthy candidates whose header
	 * cwd/id fall outside the explicit scope are excluded (authorization narrowing,
	 * not a coverage hole).
	 */
	async enumerate(): Promise<IndexProgress> {
		this.beginStage();
		const work: string[] = [];
		if (!this.checkRoot()) {
			for (const path of [...this.files.keys()]) {
				if (this.files.get(path)!.status !== "unavailable") this.markUnavailable(path, "collection-unavailable");
			}
			work.push(this.collectionError!);
			this.refreshProgress(work);
			return this.progress;
		}
		const seen = new Set<string>();
		for (const collection of this.scope.collections) {
			let names: string[];
			try { names = readdirSync(collection); }
			catch (error) {
				const reason = `collection-unreadable:${errorCode(error)}`;
				if (collection === this.rootCanonical) {
					this.collectionError = reason;
					for (const path of [...this.files.keys()]) this.markUnavailable(path, "collection-unavailable");
					work.push(reason);
					this.refreshProgress(work);
					return this.progress;
				}
				// Auxiliary project collection unreadable: mark ONLY its files, keep the
				// rest of the authorized store honestly usable.
				for (const path of [...this.files.keys()]) {
					if (this.files.get(path)!.collection === collection) this.markUnavailable(path, "collection-unavailable");
				}
				work.push(`${collection}:${reason}`);
				continue;
			}
			for (const name of names) {
				if (!name.endsWith(".jsonl")) continue;
				const candidate = this.classifyCandidate(join(collection, name));
				if (!candidate) continue; // healthy but outside the explicit cwd/sessionIds scope
				seen.add(candidate.key);
				const known = this.files.get(candidate.key);
				if (!known) {
					const state = this.blankState(candidate.key, candidate.hint);
					state.collection = candidate.collection;
					if (candidate.unavailable) { state.status = "unavailable"; state.reason = candidate.reason; }
					else state.reason = candidate.reason; // pending, possibly header-over-scan-limit
					this.files.set(candidate.key, state);
					this.order.push(candidate.key);
				} else if (candidate.unavailable) {
					// Still damaged at discovery time: keep the failure visible.
					known.status = "unavailable";
					known.reason = candidate.reason;
				} else if (known.status === "unavailable") {
					// Repaired/reappeared source: fresh validation only — never revive cached content.
					const blank = this.blankState(candidate.key, candidate.hint);
					blank.collection = candidate.collection;
					this.files.set(candidate.key, blank);
				} else {
					if (candidate.hint) known.sessionId = candidate.hint;
					known.reason = candidate.reason;
				}
			}
		}
		for (const path of [...this.files.keys()]) {
			if (!seen.has(path)) this.markUnavailable(path, "source-file-missing");
		}
		work.push(`enum:${this.stage.enumeratedBytes}B`);
		this.refreshProgress(work);
		return this.progress;
	}

	/** Classify one lexical candidate behind the canonical fence. Returns undefined for
	 *  healthy candidates excluded by the explicit scope (cwd/sessionIds). */
	private classifyCandidate(lexical: string):
		{ key: string; collection: string; hint?: string; reason?: string; unavailable?: boolean } | undefined {
		let canonical: string;
		try { canonical = realpathSync(lexical); }
		catch (error) {
			const reason = errorCode(error) === "ENOENT" ? "source-file-missing" : `source-unreadable:${errorCode(error)}`;
			return { key: resolve(lexical), collection: this.collectionOf(resolve(lexical)) ?? resolve(dirname(lexical)), unavailable: true, reason };
		}
		const collection = this.scope.collections.has(dirname(canonical)) ? dirname(canonical) : undefined;
		if (collection === undefined || canonical === this.rootCanonical) {
			// Alias escaping the authorized collections, or a file parked at the store
			// root itself: tracked as visible failure, never read.
			return { key: resolve(lexical), collection: resolve(dirname(lexical)), unavailable: true, reason: "alias-escapes-scope" };
		}
		const stat = safeStat(canonical);
		if (!stat) return { key: canonical, collection, unavailable: true, reason: "source-unreadable-or-missing" };
		let head: Buffer;
		try { head = readRange(canonical, 0, Math.min(stat.size, HEADER_PROBE_BYTES)); }
		catch (error) { return { key: canonical, collection, unavailable: true, reason: `source-unreadable:${errorCode(error)}` }; }
		this.stage.enumeratedBytes += head.length;
		if (stat.size === 0) return { key: canonical, collection, unavailable: true, reason: "empty-source" };
		const newline = head.indexOf(0x0a);
		let firstLine: string;
		if (newline === -1) {
			if (stat.size > head.length || head.length === HEADER_PROBE_BYTES) {
				// Bounded probe exhausted without a line end: honestly pending, not complete-empty.
				return { key: canonical, collection, reason: "header-over-scan-limit" };
			}
			firstLine = head.toString("utf8");
		} else {
			firstLine = head.subarray(0, newline).toString("utf8");
		}
		this.stage.catalogDecodedBytes += byteLength(firstLine);
		const parsed = parseSessionEntries(firstLine);
		if (!parsed.length) return { key: canonical, collection, unavailable: true, reason: "malformed-header" };
		const header = parsed[0];
		if (!asRecord(header) || header.type !== "session") {
			return { key: canonical, collection, unavailable: true, reason: "missing-session-header" };
		}
		const shape = headerShapeError(header);
		if (shape) return { key: canonical, collection, unavailable: true, reason: `malformed-header:${shape}` };
		if (typeof header.version === "number" && header.version > CURRENT_SESSION_VERSION) {
			return { key: canonical, collection, unavailable: true, reason: "unsupported-session-version" };
		}
		if (this.scope.cwd && !this.cwdMatch(header.cwd)) return undefined;
		if (this.scope.sessionIds.size && !this.scope.sessionIds.has(header.id)) return undefined;
		return { key: canonical, collection, hint: header.id };
	}

	/** Project-cwd authorization on the validated native header. `project` mode accepts
	 *  canonical descendants of the resolved project root; `exact` mode keeps the
	 *  legacy single-collection exact-cwd rule. An unresolvable header cwd only matches
	 *  an unresolvable scope? No: an unresolvable header cwd never matches a resolved
	 *  project — honestly excluded, not widened. */
	private cwdMatch(headerCwd: unknown): boolean {
		if (!this.scope.cwd || typeof headerCwd !== "string") return this.scope.cwd === undefined;
		let sessionCwd: string;
		try { sessionCwd = realpathSync(headerCwd); }
		catch { return false; }
		if (this.scope.cwdMode === "project") {
			return sessionCwd === this.scope.cwd || sessionCwd.startsWith(this.scope.cwd + sep);
		}
		return sessionCwd === this.scope.cwd;
	}

	private blankState(path: string, sessionId?: string): FileState {
		return { path, collection: this.collectionOf(path) ?? dirname(path), sessionId,
			status: "pending", size: 0, mtimeMs: 0, ctimeMs: 0, ino: 0,
			indexedBytes: 0, scannedBytes: 0, texts: new Map(), hits: [], byId: new Map(),
			lineHashById: new Map(), entries: [], source: undefined, fragment: Buffer.alloc(0), appended: false, rebuilt: false };
	}

	/** Drop every retained parse artifact (invariant 2 boundary for rebuilds). */
	private wipeRetained(state: FileState): void {
		state.hits = []; state.byId = new Map(); state.texts = new Map();
		state.entries = []; state.fragment = Buffer.alloc(0); state.lineHashById = new Map();
		state.indexedBytes = 0; state.scannedBytes = 0;
		state.prefixHash = undefined; state.stagedHash = undefined; state.header = undefined;
		state.source = undefined;
		state.lastPhysicalEntryId = undefined;
	}

	/**
	 * Advance indexing within the per-call NEW-byte staging budget. Phase 1 re-verifies EVERY
	 * tracked file: canonical fence, whole-content fingerprint, and — on drift — a retained-
	 * byte proof covering the committed prefix AND any staged fragment AND the scan cursor.
	 * Any unproven retained byte forces a rebuild from current bytes; a valid truncation below
	 * the cursor rebuilds too (distinguished from genuine read failures). Phase 2 stages new
	 * bytes under the budget. Stage work is measured and reported per call.
	 */
	advance(): IndexProgress {
		this.beginStage();
		const work: string[] = [];
		const rootOk = this.checkRoot();
		// Phase 1 — verification pass (measured, not budget-capped).
		for (const path of this.order) {
			const state = this.files.get(path)!;
			if (!rootOk) {
				if (state.status !== "unavailable") {
					this.markUnavailable(path, "collection-unavailable");
					work.push(`${state.sessionId ?? path}:unavailable`);
				}
				continue;
			}
			const fence = this.fenceSource(path);
			if (fence === "escaped") {
				if (state.status !== "unavailable") {
					this.markUnavailable(path, "source-alias-escaped-scope");
					work.push(`${state.sessionId ?? path}:unavailable:alias`);
				}
				continue;
			}
			const stat = safeStat(path);
			if (!stat || fence === "missing") {
				if (state.status !== "unavailable") {
					this.markUnavailable(path, "source-unreadable-or-missing");
					work.push(`${state.sessionId ?? path}:unavailable`);
				}
				continue;
			}
			let bytes: Buffer;
			try { bytes = readFileSync(path); }
			catch (error) {
				if (state.status !== "unavailable") {
					this.markUnavailable(path, `source-unreadable:${errorCode(error)}`);
					work.push(`${state.sessionId ?? path}:unavailable`);
				}
				continue;
			}
			this.stage.verifiedBytes += bytes.length;
			this.stage.fingerprintBytes += bytes.length;
			const contentHash = sha256(bytes);
			state.size = stat.size; state.mtimeMs = stat.mtimeMs;
			state.ctimeMs = stat.ctimeMs; state.ino = stat.ino;
			if (state.contentHash === contentHash) {
				if (state.status === "unavailable") {
					// Bytes readable again and identical to the LAST VERIFIED content — a true
					// restore. Rebuild eligibility from scratch (pending), never revive hits.
					this.files.set(path, { ...this.blankState(path, state.sessionId), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino });
					work.push(`${state.sessionId}:revalidated`);
				}
				continue;
			}
			if (state.status === "unavailable") {
				// File changed while unavailable: keep unavailable until verified parse succeeds.
				state.contentHash = contentHash;
				this.files.set(path, { ...this.blankState(path, state.sessionId), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, reason: "awaiting-revalidation" });
				work.push(`${state.sessionId}:revalidating`);
				continue;
			}
			// Changed tracked file: EVERY retained byte must be proven against current bytes —
			// committed prefix, staged fragment and cursor position alike. One shared boundary.
			let intact = true;
			if (state.scannedBytes > 0) {
				if (stat.size < state.scannedBytes) intact = false; // truncation below cursor: rebuild
				else {
					try {
						const committed = readRange(path, 0, state.indexedBytes);
						this.stage.verifiedBytes += committed.length;
						this.stage.prefixProofBytes += committed.length;
						intact = committed.length === state.indexedBytes && !!state.prefixHash && sha256(committed) === state.prefixHash;
						if (intact && state.scannedBytes > state.indexedBytes) {
							const staged = readRange(path, state.indexedBytes, state.scannedBytes - state.indexedBytes);
							this.stage.verifiedBytes += staged.length;
							this.stage.fragmentProofBytes += staged.length;
							intact = staged.length === state.scannedBytes - state.indexedBytes
								&& !!state.stagedHash && sha256(staged) === state.stagedHash;
						}
					} catch { intact = false; }
				}
			}
			state.rebuilt = state.indexedBytes > 0 && !intact;
			if (!intact) this.wipeRetained(state);
			state.status = "pending";
			state.reason = undefined;
			state.appended = intact && state.indexedBytes > 0;
			state.contentHash = contentHash;
		}

		// Phase 2 — stage NEW bytes and parse under the budget.
		let budget = this.batchBytes;
		for (const path of this.order) {
			const state = this.files.get(path)!;
			if (state.status !== "pending") continue;
			if (budget <= 0) { work.push(`${state.sessionId ?? path}:deferred`); continue; }
			let buf: Buffer;
			try { buf = readRange(path, state.scannedBytes, Math.min(state.size - state.scannedBytes, budget)); }
			catch (error) {
				this.markUnavailable(path, `source-unreadable:${errorCode(error)}`);
				work.push(`${state.sessionId ?? path}:unavailable`);
				continue;
			}
			budget -= buf.length;
			this.stage.stagedBytes += buf.length;
			const end = buf.lastIndexOf(0x0a) + 1;
			if (end === 0 && buf.length > 0) {
				// Native record larger than one batch: buffer bytes, advance the SCAN cursor
				// only — indexedBytes (committed) stays at the last complete-line boundary.
				state.fragment = Buffer.concat([state.fragment, buf]);
				state.scannedBytes += buf.length;
				state.stagedHash = sha256(state.fragment);
				state.status = "pending";
				work.push(`${state.sessionId}:buffered:${state.indexedBytes}/${state.size}`);
				continue;
			}
			if (end === 0) {
				if (state.size === 0) { this.markUnavailable(path, "empty-source"); work.push(`${state.sessionId ?? path}:unavailable`); }
				continue;
			}
			let slice = buf.subarray(0, end);
			if (state.fragment.length) {
				slice = Buffer.concat([state.fragment, slice]);
				state.fragment = Buffer.alloc(0);
			}
			const parsed = this.parseSlice(state, slice);
			if (parsed.error) {
				this.markUnavailable(path, parsed.error);
				work.push(`${state.sessionId ?? path}:unavailable`);
				continue;
			}
			state.indexedBytes += slice.length;
			state.scannedBytes = state.indexedBytes;
			state.stagedHash = undefined;
			const prefix = readRange(path, 0, state.indexedBytes);
			this.stage.verifiedBytes += prefix.length;
			this.stage.prefixProofBytes += prefix.length;
			state.prefixHash = sha256(prefix);
			if (state.indexedBytes >= state.size) {
				this.markLocations(state);
				// Declared-source interpretation over the SAME verified in-memory records:
				// pure reader, no IO, before any outward hit is served.
				state.source = interpretSessionSource(state.header, state.entries);
				const label = state.source.status === "declared" ? state.source.declaration.source : "unknown";
				for (const hit of state.hits) hit.source = label;
				state.status = "indexed";
				work.push(`${state.sessionId}:${state.appended ? "appended" : state.rebuilt ? "rebuilt" : "indexed"}:${state.hits.length}`);
			} else {
				work.push(`${state.sessionId}:partial:${state.indexedBytes}/${state.size}`);
			}
		}
		this.persist();
		work.push(`verify:${this.stage.verifiedBytes}B`);
		work.push(`staged:${this.stage.stagedBytes}B`);
		work.push(`decode:${this.stage.decodedBytes}B`);
		work.push(`cache-write:${this.stage.cacheWriteBytes}B`);
		this.refreshProgress(work);
		return this.progress;
	}

	/** Parse one complete-lines Buffer slice with the official parser; byte-exact offsets.
	 *  Enforces invariant 1/4: a validated CURRENT header authorizes the file; permissive
	 *  parser output is shape-checked before projection; conflicting duplicate identities
	 *  are refused instead of silently overwriting corpus/locator identity. */
	private parseSlice(state: FileState, slice: Buffer): { error?: string } {
		const raw = slice.toString("utf8");
		this.stage.decodedBytes += slice.length;
		const parsed = parseSessionEntries(raw);
		const lines = lineTable(slice, 0);
		if (parsed.length !== lines.length) {
			// Any line the official parser dropped makes the file's index state untrustworthy.
			return { error: `malformed-lines:${lines.length - parsed.length}` };
		}
		for (let i = 0; i < parsed.length; i++) {
			const entry = parsed[i];
			const line = lines[i];
			const lineStr = slice.subarray(line.offset, line.offset + line.length).toString("utf8");
			if (asRecord(entry) && entry.type === "session") {
				// The header must be the FIRST parsed record of the current revision.
				if (state.header || state.indexedBytes > 0) return { error: "unexpected-header-in-body" };
				const shape = headerShapeError(entry);
				if (shape) return { error: `malformed-header:${shape}` };
				const header = entry as SessionHeader;
				if (!this.authorize(state, header)) return { error: "header-out-of-scope-or-unsupported" };
				state.header = header;
				state.sessionId = header.id;
				continue;
			}
			if (!state.header) return { error: "missing-session-header" };
			const shape = entryShapeError(entry);
			if (shape) return { error: shape };
			const value = entry as SessionEntry;
			state.lastPhysicalEntryId = value.id;
			const lineHash = sha256(lineStr);
			const prior = state.lineHashById.get(value.id);
			if (prior !== undefined) {
				if (prior === lineHash) continue; // byte-identical duplicate row: one record
				return { error: `duplicate-entry-id:${value.id}` };
			}
			if (value.parentId !== null && (value.parentId === value.id || !state.byId.has(value.parentId))) {
				return { error: `invalid-parent-reference:${value.id}` };
			}
			state.lineHashById.set(value.id, lineHash);
			let text: string;
			this.stage.nativeProjectionEntries++;
			// A single-entry projection has no parent by construction; retain the actual native
			// parent in state/locators, without feeding self links into the SDK's parent walker.
			try { text = entryText({ ...value, parentId: null }); }
			catch { return { error: `native-projection-failed:${value.type}` }; }
			const { preview, truncated } = previewOf(text);
			const hit: IndexedHit = {
				sessionId: state.header.id, sessionFile: state.path,
				entryId: value.id, parentId: value.parentId, type: value.type,
				role: value.type === "message" ? (value.message as { role?: string }).role : undefined,
				timestamp: value.timestamp,
				collection: state.collection,
				cwd: state.header.cwd,
				source: state.source?.status === "declared" ? state.source.declaration.source : "unknown",
				offset: state.indexedBytes + line.offset, lineBytes: line.length + 1,
				preview, previewTruncated: truncated,
				location: { onCurrentBranch: false, markers: [] },
			};
			state.hits.push(hit);
			state.byId.set(hit.entryId, hit);
			state.texts.set(hit.entryId, text);
			state.entries.push(value);
		}
		return {};
	}

	private authorize(state: FileState, header: SessionHeader): boolean {
		if (typeof header.version === "number" && header.version > CURRENT_SESSION_VERSION) return false;
		if (typeof header.id !== "string" || !header.id) return false;
		state.sessionId = header.id;
		if (this.scope.sessionIds.size && !this.scope.sessionIds.has(header.id)) return false;
		if (this.scope.cwd && !this.cwdMatch(header.cwd)) return false;
		return true;
	}

	/** Branch membership from NATIVE parent ancestry: the leaf is the last physical entry
	 *  (the SDK's reload rule) and the branch is its parentId chain — independent of the
	 *  compaction-selected effective context. Markers are branch-local EFFECTIVE events:
	 *  edits/labels caused by entries ON the ancestry, with later on-ancestry label clears
	 *  removing the marker. Sibling-branch events never appear as current-effective. */
	private markLocations(state: FileState): void {
		const entries = state.entries;
		this.stage.branchEntries += entries.length;
		const byId = new Map(entries.map(entry => [entry.id, entry]));
		const ancestry = new Set<string>();
		const leaf = state.lastPhysicalEntryId ? byId.get(state.lastPhysicalEntryId) : undefined;
		if (leaf) {
			const guard = new Set<string>();
			let current: SessionEntry | undefined = leaf;
			while (current && !guard.has(current.id)) {
				guard.add(current.id);
				ancestry.add(current.id);
				current = current.parentId ? byId.get(current.parentId) : undefined;
			}
		}
		const effectiveEdits = new Set<string>();
		const effectiveLabels = new Map<string, string>();
		for (const entry of entries) {
			if (!ancestry.has(entry.id)) continue;
			if (entry.type === "context_edit") effectiveEdits.add(entry.targetId);
			if (entry.type === "label") effectiveLabels.set(entry.targetId, entry.label ?? "");
		}
		for (const hit of state.hits) {
			const source = byId.get(hit.entryId);
			const markers: string[] = [];
			if (source) {
				if (source.type === "compaction") markers.push("compaction");
				if (source.type === "branch_summary") markers.push("branch-summary");
				if (effectiveEdits.has(hit.entryId)) markers.push("context-edit");
				if ((effectiveLabels.get(hit.entryId) ?? "") !== "") markers.push("labelled");
			}
			hit.location = { onCurrentBranch: ancestry.has(hit.entryId), markers };
		}
	}

	private markUnavailable(path: string, reason: string): void {
		const prior = this.files.get(path);
		const blank = this.blankState(path, prior?.sessionId);
		if (prior) blank.collection = prior.collection;
		this.files.set(path, { ...blank, status: "unavailable", reason });
	}

	private loadCache(): void {
		let raw: string;
		try { raw = readFileSync(this.paths.indexFile, "utf8"); }
		catch { return; }
		this.stage.cacheReadBytes += byteLength(raw);
		try {
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				const record = JSON.parse(line) as Record<string, unknown>;
				if (record.v !== SESSION_INDEX_VERSION) throw new Error("incompatible-version");
				if (record.kind === "file" && typeof record.path === "string") {
					const resolved = resolve(record.path);
					if (!this.inScope(resolved)) continue; // cache can never widen scope
					// One ordered file per canonical identity: repeated cache rows (derived-cache
					// corruption) must not duplicate native hits.
					if (this.files.has(resolved)) continue;
					const state = this.blankState(resolved, typeof record.sessionId === "string" ? record.sessionId : undefined);
					state.reason = "cache-loaded-pending";
					this.files.set(state.path, state);
					this.order.push(state.path);
				}
			}
		} catch (error) {
			this.files.clear(); this.order = [];
			this.loadError = `derived-index-reset:${error instanceof Error ? error.message : "corrupt"}`;
		}
	}

	private persist(): void {
		this.assertCachePathSafe();
		mkdirSync(dirname(this.paths.indexFile), { recursive: true });
		const temporary = join(dirname(this.paths.indexFile), `.session-index-${process.pid}-${randomSuffix()}.pending`);
		const fd = openSync(temporary, "wx", 0o600);
		try {
			for (const path of this.order) {
				const state = this.files.get(path)!;
				const record = JSON.stringify({ v: SESSION_INDEX_VERSION, kind: "file", path: state.path,
					sessionId: state.sessionId, status: state.status, reason: state.reason,
					size: state.size, mtimeMs: state.mtimeMs, ctimeMs: state.ctimeMs, ino: state.ino,
					indexedBytes: state.indexedBytes, prefixHash: state.prefixHash, contentHash: state.contentHash,
					entryCount: state.hits.length }) + "\n";
				writeFileSync(fd, record);
				this.stage.cacheWriteBytes += byteLength(record);
				if (state.status === "indexed") {
					for (const hit of state.hits) {
						const entryRecord = JSON.stringify({ v: SESSION_INDEX_VERSION, kind: "entry", file: state.path, hit }) + "\n";
						writeFileSync(fd, entryRecord);
						this.stage.cacheWriteBytes += byteLength(entryRecord);
					}
				}
			}
		} finally { closeSync(fd); }
		renameSync(temporary, this.paths.indexFile);
	}

	private beginStage(): void {
		this.stage = emptyStage();
	}

	private refreshProgress(work: string[] = []) {
		let entries = 0, bytesTotal = 0, bytesIndexed = 0, indexed = 0, pending = 0, unavailable = 0;
		for (const state of this.files.values()) {
			bytesTotal += state.size;
			if (state.status === "indexed") { indexed++; bytesIndexed += state.indexedBytes; entries += state.hits.length; }
			else if (state.status === "pending") { pending++; bytesIndexed += state.indexedBytes; }
			else unavailable++;
		}
		this.progress = {
			filesTotal: this.files.size, filesIndexed: indexed, filesPending: pending, filesUnavailable: unavailable,
			entries, bytesTotal, bytesIndexed, done: pending === 0,
			work: [...work, ...(this.loadError ? [this.loadError] : [])],
			...this.stage,
			collectionError: this.collectionError,
		};
	}

	/** Outward-read gate: canonical fence + live fingerprint before serving any cached record.
	 *  A changed/escaped/deleted/unreadable source invalidates its hits NOW — pending, never
	 *  rebuilt inline on a query. */
	private liveEligible(state: FileState): boolean {
		if (state.status !== "indexed") return false;
		const fence = this.fenceSource(state.path);
		if (fence === "escaped") { this.markUnavailable(state.path, "source-alias-escaped-scope"); return false; }
		if (fence === "missing") { this.markUnavailable(state.path, "source-file-missing"); return false; }
		let bytes: Buffer;
		try { bytes = readFileSync(state.path); }
		catch (error) { this.markUnavailable(state.path, `source-unreadable:${errorCode(error)}`); return false; }
		this.stage.verifiedBytes += bytes.length;
		this.stage.fingerprintBytes += bytes.length;
		if (sha256(bytes) === state.contentHash) return true;
		// Changed: stale hits ineligible — report pending honestly, no auto-rebuild on query.
		this.wipeRetained(state);
		state.status = "pending"; state.reason = "source-changed-detected-on-read";
		state.contentHash = sha256(bytes);
		return false;
	}

	status(): IndexProgress { this.refreshProgress(); return this.progress; }
	/** 5.2/5.3 fenced catalog access: currently live-eligible indexed sessions across all
	 *  authorized collections. Allowlisted metadata only (id/path/collection/count/header
	 *  time/cwd/declared source label) — no bodies, no locators, no declaration payloads. */
	sessions(): { sessionId: string; sessionFile: string; collection: string; cwd: string; source: string; entries: number; timestamp: string }[] {
		this.beginStage();
		const catalog: { sessionId: string; sessionFile: string; collection: string; cwd: string; source: string; entries: number; timestamp: string }[] = [];
		for (const path of this.order) {
			const state = this.files.get(path)!;
			if (!state.sessionId || !state.header || !this.liveEligible(state)) continue;
			catalog.push({ sessionId: state.sessionId, sessionFile: state.path,
				collection: state.collection, cwd: state.header.cwd,
				source: state.source?.status === "declared" ? state.source.declaration.source : "unknown",
				entries: state.hits.length, timestamp: state.header.timestamp });
		}
		this.refreshProgress([`catalog:${catalog.length}`]);
		return catalog;
	}
	/** Fenced native identity for recall. Returned maps/locators are defensive copies;
	 * parent headers are never opened through an unfenced secondary reader. */
	sourceIdentity(path: string): {
		sessionId: string; sessionFile: string; collection: string; cwd: string; source: string;
		timestamp: string; parentSession?: string;
		fingerprint: string; headerDigest: string; digests: Map<string, string>; hits: IndexedHit[];
	} | undefined {
		this.beginStage();
		const state = this.files.get(resolve(path));
		if (!state || !this.liveEligible(state) || !state.header || !state.sessionId) return undefined;
		return { sessionId: state.sessionId, sessionFile: state.path, collection: state.collection,
			cwd: state.header.cwd,
			source: state.source?.status === "declared" ? state.source.declaration.source : "unknown",
			timestamp: state.header.timestamp,
			parentSession: typeof state.header.parentSession === "string" ? state.header.parentSession : undefined,
			fingerprint: state.contentHash!, headerDigest: sha256(JSON.stringify(state.header)),
			digests: new Map(state.lineHashById), hits: structuredClone(state.hits) };
	}
	fileState(path: string): FileIndexState | undefined {
		const resolved = resolve(path);
		for (const [key, state] of this.files) {
			if (key === resolved) {
				return { path: state.path, sessionId: state.sessionId, collection: state.collection, status: state.status,
					indexedBytes: state.indexedBytes, size: state.size,
					entries: state.hits.length, reason: state.reason };
			}
		}
		return undefined;
	}
	hit(sessionId: string, entryId: string): IndexedHit | undefined {
		this.beginStage();
		for (const state of this.files.values()) {
			if (state.sessionId === sessionId && this.liveEligible(state)) {
				const hit = state.byId.get(entryId);
				return hit ? structuredClone(hit) : undefined;
			}
		}
		return undefined;
	}
	/** Read the authoritative source line for a hit — only when the locator is one of THIS
	 *  index's own live-eligible records AND the supplied byte span is exactly the CURRENT
	 *  owned locator. Stale or forged spans are rejected; extra records are never returned
	 *  masked as one. */
	readSource(hit: IndexedHit): { raw: string; entry: SessionEntry } | { error: string } {
		this.beginStage();
		const state = [...this.files.values()].find(s => s.path === resolve(hit.sessionFile));
		if (!state || !this.inScope(hit.sessionFile) || !this.liveEligible(state) || !state.byId.has(hit.entryId)) {
			return { error: "unauthorized-locator: not a current eligible record of this collection" };
		}
		const current = state.byId.get(hit.entryId)!;
		if (current.sessionId !== hit.sessionId || current.offset !== hit.offset || current.lineBytes !== hit.lineBytes) {
			return { error: "stale-locator: supplied byte span does not match the current owned locator; re-fetch the hit" };
		}
		try {
			const buf = readRange(state.path, current.offset, current.lineBytes);
			this.stage.verifiedBytes += buf.length;
			this.stage.locatorReadBytes += buf.length;
			const raw = buf.toString("utf8").replace(/\n$/, "");
			if (raw.includes("\n")) return { error: "source-mismatch: locator spans multiple physical records" };
			this.stage.decodedBytes += byteLength(raw);
			const parsed = parseSessionEntries(raw);
			const entry = parsed[0] as SessionEntry | undefined;
			if (!entry || !entry.id || entry.id !== hit.entryId) {
				return { error: "source-mismatch: cached locator no longer resolves; reindex required" };
			}
			return { raw, entry };
		} catch (error) {
			return { error: `source-unavailable:${errorCode(error)}` };
		}
	}
	/** Local keyword search over the full per-entry text (not previews); no model, no remote.
	 *  Verification work of the query itself is measured and disclosed in `coverage`. */
	search(query: string, limit = 10, cursor = 0): SearchPage {
		this.beginStage();
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const matched: IndexedHit[] = [];
		for (const path of this.order) {
			const state = this.files.get(path)!;
			if (!this.liveEligible(state)) continue;
			for (const hit of state.hits) {
				const haystack = (state.texts.get(hit.entryId) ?? "").toLowerCase();
				if (terms.every(term => haystack.includes(term))) matched.push(hit);
			}
		}
		this.refreshProgress([`verify:${this.stage.verifiedBytes}B`]);
		const hits = matched.slice(cursor, cursor + limit).map(hit => structuredClone(hit));
		return { hits, total: matched.length,
			nextCursor: cursor + hits.length < matched.length ? cursor + hits.length : undefined,
			coverage: this.progress };
	}
	reset(): void {
		this.beginStage();
		this.assertCachePathSafe();
		this.files.clear(); this.order = [];
		try { unlinkSync(this.paths.indexFile); } catch { /* derived cache is deletable */ }
		this.refreshProgress();
	}
}

function safeStat(path: string) { try { return statSync(path); } catch { return undefined; } }
function randomSuffix(): string { return Math.random().toString(16).slice(2, 10); }

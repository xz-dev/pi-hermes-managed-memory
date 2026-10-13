import { SessionManager, type CustomEntry, type SessionEntry, type SessionHeader } from "@earendil-works/pi-coding-agent";

/**
 * Declared session source producer (OpenSpec 5.3, user-approved explicit opt-in).
 *
 * Hermes supplies `source` when creating the session row (run_agent.py:369). Official
 * Pi 0.99.2 `SessionHeader`/`NewSessionOptions` have no equivalent, so the native carrier
 * is a `custom` entry written by `appendCustomEntry` BEFORE any conversation entry, bound
 * to the header's own session id. This module is the producer opt-in API plus a pure
 * declaration interpreter: not automatic classification, not a source-labelling tool for
 * pre-existing sessions, no inference from titles, message text, forks or filesystem
 * naming. Unintegrated producers and old history stay honestly `unknown`. Declarations
 * are descriptive metadata, never a grant of authority.
 */

/** Custom entry type carrying the source declaration. */
export const SESSION_SOURCE_CUSTOM_TYPE = "hermes.session_source";
/** Known producer labels, mirroring Hermes `_HIDDEN_SESSION_SOURCES`/`_DEMOTED_SESSION_SOURCES`
 *  plus the interactive `cli` default. Arbitrary values are rejected by the writer and are
 *  never promoted to trusted classification by the interpreter. */
export const KNOWN_SESSION_SOURCES = ["cli", "kanban", "subagent", "tool", "cron"] as const;
export type KnownSessionSource = (typeof KNOWN_SESSION_SOURCES)[number];

export interface DeclaredSessionSource {
	/** Genuine native declaration entry id — bounded provenance, never the raw payload. */
	entryId: string;
	source: KnownSessionSource;
}

/** Pure read outcome: declared with bounded provenance, or honest unknown. Never throws,
 *  never carries raw exception text or unbounded payload into metadata. */
export type SessionSourceRead =
	| { status: "declared"; sessionId: string; declaration: DeclaredSessionSource }
	| { status: "unknown"; sessionId?: string; reason: string };

const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

function knownSource(value: unknown): value is KnownSessionSource {
	return typeof value === "string" && (KNOWN_SESSION_SOURCES as readonly string[]).includes(value);
}

export interface CreateDeclaredSessionOptions {
	/** Explicit caller-chosen source. Must be one of KNOWN_SESSION_SOURCES — this API is an
	 *  opt-in declaration, not free-form labelling. */
	source: KnownSessionSource;
	/** Optional session directory; forwarded to SessionManager.create. */
	sessionDir?: string;
	/** Optional new-session options (e.g. explicit id); forwarded untouched. */
	options?: Parameters<typeof SessionManager.create>[2];
}

export interface DeclaredSession {
	/** The usable SessionManager for the NEW session; caller continues the conversation. */
	sessionManager: SessionManager;
	sessionId: string;
	/** Native id of the declaration entry (the tree root / first entry). */
	declarationEntryId: string;
}

/**
 * Create a NEW native session via public SessionManager.create and append the source
 * declaration as its FIRST entry — the tree root (parentId null) — before any
 * conversation messages. The declaration carries the session's own header id, so a
 * copied marker inside a fork names a different session and cannot relabel the fork.
 *
 * Creation-only: callers that want persistence must append conversation through normal
 * SDK flow (the SDK only writes the file once a user/assistant message exists — a bare
 * declaration stays in memory, which is the native unflushed-record case, not a fake
 * persisted success). Returns the live SessionManager; this function never writes to
 * any pre-existing session.
 */
export function createDeclaredSession(cwd: string, init: CreateDeclaredSessionOptions): DeclaredSession {
	if (!knownSource(init.source)) {
		throw new Error(`Unknown session source ${JSON.stringify(init.source)}; expected one of ${KNOWN_SESSION_SOURCES.join(", ")}`);
	}
	const sessionManager = SessionManager.create(cwd, init.sessionDir, init.options);
	const sessionId = sessionManager.getSessionId();
	const declarationEntryId = sessionManager.appendCustomEntry(SESSION_SOURCE_CUSTOM_TYPE, {
		v: 1, session: sessionId, source: init.source,
	});
	return { sessionManager, sessionId, declarationEntryId };
}

/** Structural check: a genuine native `custom` entry with a real string id, versioned
 *  marker data, a bound session id and a known label. Anything else in `data` is ignored
 *  and never propagated — bounded provenance in, bounded provenance out. Entries lacking
 *  a genuine id are malformed (no fabricated provenance). */
function genuineDeclaration(entry: unknown): entry is CustomEntry & { data: { v: 1; session: string; source: KnownSessionSource } } {
	if (!object(entry) || entry.type !== "custom" || entry.customType !== SESSION_SOURCE_CUSTOM_TYPE) return false;
	if (typeof entry.id !== "string" || !entry.id) return false;
	if (!object(entry.data) || entry.data.v !== 1) return false;
	return typeof entry.data.session === "string" && knownSource(entry.data.source);
}

/**
 * Pure declaration interpreter. Consumes an ALREADY parsed/validated native session
 * header plus its entry list (header excluded) — exactly what the session index hands
 * over behind its existing source gates. This function performs NO IO, opens no paths,
 * calls no SDK create/open/resume and holds no path authority; it only reads the
 * supplied in-memory records.
 *
 * Honesty rules (creation semantics, not merely early physical position):
 *  - the header must carry a string id (otherwise `unknown`, no session id);
 *  - the declaration must BE the first entry — `entries[0]` with `parentId: null`, the
 *    tree root the producer writes before anything else. A marker sitting behind any
 *    earlier entry is a second-entry placement, never the creator's declaration;
 *  - the PHYSICALLY FIRST user/assistant conversation record decides whether the root
 *    declaration reached conversation: connected → trusted window closes there;
 *    disconnected (re-rooted/orphaned) → final `unknown`. A later message that chains
 *    back to the declaration can never restore attribution;
 *  - `data.session` must equal the header's own id — a fork physically copying entries
 *    still carries the origin id in the marker, so it cannot fabricate the fork's source;
 *  - exactly one valid declaration on the trusted chain is required: conflicting or
 *    malformed sibling declarations are `unknown`, not a coin flip;
 *  - null/foreign/malformed records in the entry stream are unknown, never thrown.
 */
export function interpretSessionSource(header: SessionHeader | null | undefined, entries: readonly unknown[]): SessionSourceRead {
	if (!object(header) || header.type !== "session" || typeof header.id !== "string" || !header.id) {
		return { status: "unknown", reason: "no native session header" };
	}
	const sessionId = header.id;
	const list = Array.isArray(entries) ? entries : [];
	if (list.length === 0 || !object(list[0]) || list[0].parentId !== null) {
		return { status: "unknown", sessionId, reason: "no genuine session-bound declaration before conversation" };
	}
	// Walk the unbroken parentId chain from the root entry; the trusted window ends at
	// the PHYSICALLY FIRST user/assistant conversation record. That record decides the
	// outcome — checked BEFORE the parent match, because a mismatched (re-rooted or
	// orphaned) first conversation is final: the declaration failed to reach real
	// conversation. A later message that happens to chain back to the root can never
	// restore attribution — the marker stayed disconnected at the true first message.
	const window: unknown[] = [list[0]];
	let expectedParent: unknown = list[0].id;
	let chainIntact = typeof list[0].id === "string";
	let reachedConversation = false;
	let conversationOnChain = false;
	for (let i = 1; i < list.length; i++) {
		const record = list[i];
		if (!object(record)) continue; // malformed records are neither chain nor conversation
		const isConversation = record.type === "message" &&
			object(record.message) && (record.message.role === "user" || record.message.role === "assistant");
		if (isConversation) {
			// First conversation seen, in physical order. Connected → window closes here;
			// disconnected → the declaration never reached conversation. Either way this
			// record terminates the scan; nothing later can change the verdict.
			reachedConversation = true;
			conversationOnChain = chainIntact && record.parentId === expectedParent;
			if (conversationOnChain) window.push(record);
			break;
		}
		if (!chainIntact || record.parentId !== expectedParent) continue;
		window.push(record);
		if (typeof record.id === "string") expectedParent = record.id;
		else chainIntact = false;
	}
	if (!reachedConversation || !conversationOnChain) {
		// No conversation yet (unflushed — nothing persisted to attribute), or the first
		// conversation record was off the chain (disconnected declaration left dangling).
		// A disconnected marker cannot label the conversation it is not attached to.
		return { status: "unknown", sessionId, reason: "no genuine session-bound declaration before conversation" };
	}
	const candidates = window.filter(entry =>
		object(entry) && entry.type === "custom" && entry.customType === SESSION_SOURCE_CUSTOM_TYPE);
	const valid = candidates.filter(genuineDeclaration).filter(entry => entry.data.session === sessionId);
	if (valid.length === 0) {
		return { status: "unknown", sessionId, reason: "no genuine session-bound declaration before conversation" };
	}
	// The creator's declaration IS the first entry; a genuine-shaped marker later on the
	// chain (behind any earlier entry) is a second-entry placement, not creation truth.
	if (window[0] !== valid[0] || valid.length > 1 || candidates.length > valid.length) {
		return { status: "unknown", sessionId, reason: "conflicting or malformed source declarations" };
	}
	const declaration = valid[0];
	return {
		status: "declared", sessionId,
		declaration: { entryId: declaration.id, source: declaration.data.source },
	};
}

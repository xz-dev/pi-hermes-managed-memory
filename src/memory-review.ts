import { getCurrentTools, type AssistantMessage, type Message, type Tool } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hash } from "./local-state.ts";
import { MemoryStore, type MemoryBatch, type MemoryEntry, type FileTarget as Target } from "./memory-store.ts";
import { ReviewLedger, type ReviewRecord, type UsageReport } from "./review-ledger.ts";
import { MEMORY_PARTICIPANT, ReviewCoordinator, type SharedReview } from "./review-coordinator.ts";

export interface Evidence { entry: string; text: string }
const PRIVATE = /password|密码|api[ _-]?key|access[ _-]?token|secret|private key|-----BEGIN|\b(?:sk|ghp)[_-][a-z0-9]{12,}/i;
const TEMPORARY = /这次|本次|这轮|暂时|this time|this task|for this session|today|quoted instruction|网页说/i;
/** Third-party content quoted inside a user message is not user authority. */
const QUOTED_AUTHORITY = /webpage quote|quoted instruction|tool output|网页说|工具输出|引用内容/i;
/** Shared foreground/background kinds; `procedure` is a bounded nonpersistent routing outcome only. */
const KINDS = { preference: "user", environment: "global", "project-fact": "project" } as const;
type CandidateKind = keyof typeof KINDS | "procedure";
export interface DurableCandidate { kind: CandidateKind; fact: string; quote: string; entry: string; replaces?: string }
export interface CandidateFailure { reason: string }

/** Line-level native-source authority: the declared quote must appear inside a genuine user
 *  assertion line, not inside a Markdown blockquote (">" marker lines) or fenced pasted
 *  material. The WHOLE native source is also screened for existing recognized exclusions
 *  (private, temporary, third-party quoted content): an explicit label on a neighbouring
 *  line cannot be laundered away by selecting a shorter verbatim span on the next line.
 *  Fence state keeps the opening delimiter kind and run length: only a same-kind delimiter
 *  of at least the opening length with a whitespace-only suffix closes it — a different
 *  kind, a shorter run or an info-string suffix stays inside the fence. An unclosed fence
 *  protects the tail, and content after a genuine close remains usable. Conservative:
 *  this is a bounded source-level boundary check, not a Markdown renderer or NLP. */
function sourceAuthority(text: string, quote: string): boolean {
	if (!text.includes(quote)) return false;
	if (PRIVATE.test(text) || TEMPORARY.test(text) || QUOTED_AUTHORITY.test(text)) return false;
	const fence = (line: string) => /^\s*(`{3,}|~{3,})(.*)$/s.exec(line);
	let closing: { marker: string; length: number } | undefined;
	for (const line of text.split("\n")) {
		const delimiter = fence(line);
		if (closing) {
			if (delimiter && delimiter[1][0] === closing.marker && delimiter[1].length >= closing.length && /^\s*$/.test(delimiter[2])) closing = undefined;
			continue;
		}
		if (delimiter) {
			closing = { marker: delimiter[1][0], length: delimiter[1].length };
			continue;
		}
		if (!line.includes(quote)) continue;
		if (/^\s*>/.test(line)) continue;
		return true;
	}
	return false;
}

/** Bounded candidate/evidence policy shared by the foreground tool and the background review:
 *  exact verbatim quote/fact binding to a genuine native USER entry of the current effective
 *  projection, no private/temporary bodies, no third-party quoted instructions, no foreign or
 *  missing sources. Failures carry bounded reasons — never the refused fact or quote body. */
export function candidateCandidate(value: unknown, sources: Evidence[]): DurableCandidate | CandidateFailure {
	if (!value || typeof value !== "object" || Array.isArray(value) ||
		Object.keys(value).some(key => !["kind", "fact", "quote", "entry", "replaces"].includes(key))) {
		return { reason: "malformed-candidate" };
	}
	const candidate = value as { kind?: unknown; fact?: unknown; quote?: unknown; entry?: unknown; replaces?: unknown };
	if (typeof candidate.kind !== "string" || !Object.hasOwn(KINDS, candidate.kind) && candidate.kind !== "procedure") {
		return { reason: "unknown-kind" };
	}
	if (typeof candidate.fact !== "string" || typeof candidate.quote !== "string" || typeof candidate.entry !== "string" ||
		candidate.fact !== candidate.quote.trim() || candidate.fact.length > 512 || !candidate.fact.trim() || /[\r\n]|<!--|-->/.test(candidate.fact)) {
		return { reason: "malformed-or-nonverbatim-fact" };
	}
	if (PRIVATE.test(candidate.fact)) return { reason: "private-content-not-durable" };
	if (TEMPORARY.test(candidate.fact)) return { reason: "temporary-instruction-not-durable" };
	if (candidate.replaces !== undefined && (typeof candidate.replaces !== "string" || !candidate.replaces.trim())) {
		return { reason: "malformed-replacement-reference" };
	}
	const source = sources.find(source => source.entry === candidate.entry);
	if (!source || !sourceAuthority(source.text, candidate.quote)) return { reason: "no-current-native-user-evidence" };
	return { kind: candidate.kind as CandidateKind, fact: candidate.fact, quote: candidate.quote,
		entry: candidate.entry, replaces: candidate.replaces };
}
function text(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(block => block?.type === "text" && typeof block.text === "string").map(block => block.text).join("\n");
}
function errorUsage(error: unknown): UsageReport | undefined {
	if (!error || typeof error !== "object" || !("usage" in error) || !error.usage || typeof error.usage !== "object") return;
	const fields = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"];
	const usage: UsageReport = Object.fromEntries(Object.entries(error.usage).filter(([key, value]) => fields.includes(key) && typeof value === "number"));
	if ("cost" in error.usage && error.usage.cost && typeof error.usage.cost === "object") {
		usage.cost = Object.fromEntries(Object.entries(error.usage.cost).filter(([key, value]) =>
			["input", "output", "cacheRead", "cacheWrite", "total"].includes(key) && typeof value === "number"));
	}
	return usage;
}
function candidates(value: unknown, sources: Evidence[], session: string, digest: string): Map<Target, MemoryBatch> {
	if (!value || typeof value !== "object" || Object.keys(value).some(key => !["candidates", "removals"].includes(key)) ||
		!("candidates" in value) || !Array.isArray(value.candidates) || value.candidates.length > 16 ||
		("removals" in value && (!Array.isArray((value as { removals?: unknown }).removals) || (value as { removals: unknown[] }).removals.length > 16))) throw new Error("Expected a bounded candidates/removals proposal");
	const grouped = new Map<Target, MemoryBatch>();
	const merge = (target: Target, batch: MemoryBatch) => {
		const prior = grouped.get(target) ?? {};
		grouped.set(target, { additions: [...(prior.additions ?? []), ...(batch.additions ?? [])],
			replacements: [...(prior.replacements ?? []), ...(batch.replacements ?? [])],
			removals: [...(prior.removals ?? []), ...(batch.removals ?? [])] });
	};
	for (const proposed of value.candidates) {
		const checked = candidateCandidate(proposed, sources);
		if ("reason" in checked || checked.kind === "procedure") throw new Error("Rejected unstable, private, inferred or malformed candidate");
		const candidate = checked;
		const target = KINDS[candidate.kind as keyof typeof KINDS];
		const now = new Date().toISOString();
		const entry: MemoryEntry = {
			id: hash(JSON.stringify([digest, target, candidate.entry, candidate.fact])).slice(0, 32),
			fact: candidate.fact, source: { session, entry: candidate.entry, quote: candidate.quote }, created: now, updated: now,
		};
		// Replacement identity is bound to the read target below; native correction evidence
		// decides whether it may commit automatically or the whole target batch stays pending.
		if (candidate.replaces !== undefined) {
			merge(target, { replacements: [{ id: candidate.replaces, expectedFact: "", entry }] });
		} else merge(target, { additions: [entry] });
	}
	for (const removal of (value as { removals?: { target?: unknown; id?: unknown }[] }).removals ?? []) {
		if (!removal || typeof removal !== "object" || Object.keys(removal).length !== 2 || typeof removal.target !== "string" || typeof removal.id !== "string" ||
			!Object.hasOwn(NAMES_REVERSE, removal.target)) throw new Error("Malformed removal proposal");
		merge(removal.target as Target, { removals: [{ id: removal.id, expectedFact: "" }] });
	}
	return grouped;
}
const NAMES_REVERSE: Record<Target, true> = { user: true, global: true, project: true };

/** Automatic permission requires the WHOLE native message to be one exact direct
 * correction: `Correction: "old" -> "new"` or `更正：“old” → “new”` (outer whitespace
 * allowed). Extra context/embedded delimiter quotes stay pending; shared source policy
 * is unchanged. Sources already follow the effective branch order, not timestamps or
 * restored raw history. Later supported relation lines are conservative vetoes even
 * when their enclosing message cannot authorize a write. Only a compatible valid
 * whole-message repeat is exempt; unrelated work does not revoke permission. */
function explicitCorrection(old: string, entry: MemoryEntry, sources: Evidence[]): boolean {
	const origin = entry.source;
	if (!("entry" in origin) || old === entry.fact) return false;
	const index = sources.findIndex(source => source.entry === origin.entry);
	if (index < 0) return false;
	const relation = (assertion: string) => /^Correction: "([^"\r\n]+)" -> "([^"\r\n]+)"$/.exec(assertion) ?? /^更正：“([^“”\r\n]+)” → “([^“”\r\n]+)”$/.exec(assertion);
	const assertion = sources[index].text.trim(), selected = relation(assertion);
	if (selected?.[1] !== old || selected[2] !== entry.fact || !sourceAuthority(sources[index].text, assertion)) return false;
	return !sources.slice(index + 1).some(source => {
		const whole = source.text.trim(), repeat = relation(whole);
		if (repeat?.[1] === old && repeat[2] === entry.fact && sourceAuthority(source.text, whole)) return false;
		return source.text.split("\n").some(line => {
			const pair = relation(line.trim());
			return pair && (pair[1] === old || pair[1] === entry.fact || pair[2] === old || pair[2] === entry.fact);
		});
	});
}

/** One review request; proposal output has no tool-execution or main-session authority. */
export class MemoryReview {
	private generation = 0;
	private controller?: AbortController;
	lastError?: string;
	stateChanged?: (requestId: string) => void;
	readonly store: MemoryStore;
	readonly ledger: ReviewLedger;
		readonly coordinator?: ReviewCoordinator;
	constructor(store: MemoryStore, ledger: ReviewLedger, coordinator?: ReviewCoordinator) { this.store = store; this.ledger = ledger; this.coordinator = coordinator; }
	private observed?: { session: string; canonical: Message[]; messages: Message[] };
	observe(messages: Message[], ctx: ExtensionContext): void {
		this.observed = { session: ctx.sessionManager.getSessionId(),
			canonical: convertToLlm(structuredClone(ctx.sessionManager.buildSessionProjection().messages)), messages: structuredClone(messages) };
	}
	forgetObservation(): void { this.observed = undefined; }
	get epoch(): number { return this.generation; }
	cancel(): void { this.generation++; this.controller?.abort(new Error("Review invalidated")); }
	prepare(ctx: ExtensionContext, tools: Tool[] = [], settled = false) {
		const generation = this.generation;
		const session = ctx.sessionManager.getSessionId();
		const leaf = ctx.sessionManager.getLeafId();
		const projection = ctx.sessionManager.buildSessionProjection();
		const canonical = convertToLlm(structuredClone(projection.messages));
		const observed = this.observed?.session === session ? this.observed : undefined;
		const matches = observed && JSON.stringify(canonical.slice(0, observed.canonical.length)) === JSON.stringify(observed.canonical);
		const messages: Message[] = matches ? [...structuredClone(observed.messages), ...canonical.slice(observed.canonical.length)] :
			settled ? [] : [{ role: "system", content: ctx.getSystemPrompt(), timestamp: 0 }, ...canonical];
		const modelUserText = new Set(messages.filter(message => message.role === "user").map(message => text(message.content)));
		const sources: Evidence[] = projection.entries.flatMap(entry => {
			if (entry.sourceEntry.type !== "message" || entry.sourceEntry.message.role !== "user") return [];
			// Source labels may annotate only bodies already visible in the effective payload.
			// A context handler's redaction/omission must not be undone by review instructions.
			return entry.messages.flatMap(message => message.role === "user" && modelUserText.has(text(message.content))
				? [{ entry: entry.sourceEntry.id, text: text(message.content) }] : []);
		});
		// Host-side evidence binds the NATIVE user entry text (same policy as the foreground
		// tool); the model-visible payload keeps the transformed/projected display above.
		const nativeSources: Evidence[] = projection.entries.flatMap(entry => {
			if (entry.sourceEntry.type !== "message" || entry.sourceEntry.message.role !== "user") return [];
			return [{ entry: entry.sourceEntry.id, text: text(entry.sourceEntry.message.content) }];
		});
		const effectiveTools = matches ? getCurrentTools(messages) : tools;
		const snapshots = this.store.readAll();
		const digest = hash(JSON.stringify([session, leaf, this.store.project, messages, effectiveTools]));
		const instruction: Message = { role: "user", timestamp: Date.now(), content: JSON.stringify({
			instruction: 'Review the existing effective snapshot. Return one JSON object {candidates:[{kind:"preference"|"environment"|"project-fact",fact,quote,entry,replaces?:"existing-id"}],removals?:[{target:"user"|"global"|"project",id:"existing-id"}]}. At most 16 candidates and 16 removals. Select short verbatim spans of explicit stable native user facts; fact must equal trimmed quote. No guesses, secrets, temporary restrictions, quoted third-party instructions, personality inferences or workflows. For a replacement, use the existing ID from the SAME target/read version; host binds its old value and version. A replacement is automatic only when the whole native message is exactly Correction: "exact old fact" -> "exact new fact" or 更正：“exact old fact” → “exact new fact” and no later conflicting, qualified or negated message contains a supported exact relation line involving either value; extra context or unsupported/ambiguous correction wording stays pending. All removals require visible user approval; they are proposals, never direct deletion. Do not supply approval/correction flags. Return candidates:[] if nothing qualifies. No tool execution, additional requests, cross-target moves or invented sources.',
			sources, memory: snapshots.filter(snapshot => !snapshot.blocked).map(snapshot => ({ target: snapshot.target, version: snapshot.version, entries: snapshot.entries })),
		}) };
		const payload = { messages: [...messages, instruction], tools: structuredClone(effectiveTools) };
		const estimatedInput = Buffer.byteLength(JSON.stringify(payload), "utf8");
		const unsupported = settled && !observed ? "effective-context-unavailable" : observed && !matches ? "stale-observed-context" : !ctx.model ? "model-unavailable" : snapshots.some(snapshot => snapshot.blocked) ? "storage-lifecycle-uncertain" : estimatedInput + this.ledger.limits.output > ctx.model.contextWindow ? "model-context-budget" : undefined;
		const admission = { digest, session, project: this.store.project, leaf, generation,
			targets: snapshots.map(snapshot => `memory:${snapshot.target}`), trigger: "manual" as const,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown", prices: ctx.model?.cost, estimatedInput, unsupported };
		const stamp = hash(JSON.stringify([admission, snapshots.map(snapshot => [snapshot.version, snapshot.epoch]), ctx.model, ctx.thinkingLevel, this.ledger.limits]));
		return { admission, stamp, payload, snapshots, sources: nativeSources, generation, session, leaf, digest };
	}
	async prepareCoordinated(ctx: ExtensionContext, tools: Tool[] = [], settled = false, trigger: "manual" | "settled" | "retry" = "manual", memoryDue = true, selected?: string[]) {
		const prepared = this.prepare(ctx, tools, settled);
		if (!this.coordinator) return { ...prepared, shared: undefined as SharedReview | undefined };
		const branch = ctx.sessionManager.getBranch();
		const shared = await this.coordinator.collect({ digest: prepared.digest, session: prepared.session, project: this.store.project,
			leaf: prepared.leaf, generation: prepared.generation, messages: prepared.payload.messages.slice(0, -1), tools: prepared.payload.tools,
			userTurns: branch.filter(e => e.type === "message" && e.message.role === "user").length,
			toolTurns: branch.filter(e => e.type === "message" && e.message.role === "assistant" && e.message.content.some(b => b.type === "toolCall")).length,
		}, memoryDue && (!selected || selected.some(target => target === "memory" || target.startsWith("memory:"))) ? { targets: prepared.snapshots.map(s => ({ target: s.target, version: hash(JSON.stringify([s.version, s.epoch])) })),
			instruction: String(prepared.payload.messages.at(-1)!.content), context: {} } : undefined, trigger, selected);
		if (shared && shared.contributions.some(c => c.participant.id !== MEMORY_PARTICIPANT)) {
			prepared.payload.messages[prepared.payload.messages.length - 1] = { role: "user", timestamp: Date.now(), content: JSON.stringify({
				instruction: "Review the existing effective snapshot. Return one JSON object {consumers:{[participantId]:proposal}}. Separate each consumer's proposal; do not transfer facts, workflow or permissions between targets. No tool execution or approval flags.",
				consumers: shared.contributions.map(c => ({ id: c.participant.id, ...c.contribution })),
			}) };
			if (prepared.generation !== this.generation) return { ...prepared, shared: undefined as SharedReview | undefined };
		}
		const estimatedInput = Buffer.byteLength(JSON.stringify(prepared.payload), "utf8");
		return { ...prepared, shared, admission: { ...prepared.admission, estimatedInput,
			targets: shared?.targets ?? [], ownerPlugin: shared?.owner,
			unsupported: prepared.admission.unsupported ?? (!shared ? "no-eligible-consumers" : estimatedInput + this.ledger.limits.output > (ctx.model?.contextWindow ?? 0) ? "model-context-budget" : undefined) },
			stamp: hash(JSON.stringify([prepared.stamp, shared?.stamp])) };
	}
	async run(ctx: ExtensionContext, tools: Tool[] = [], retry?: { id: string; stamp: string; ledgerStamp: string; targets?: string[] }, onAdmitted?: () => void,
		automatic?: { user: string; eligible: () => boolean; memoryDue?: boolean }): Promise<ReviewRecord | undefined> {
		let prepared;
		const generation = this.generation;
		let executed = false;
		try {
			prepared = await this.prepareCoordinated(ctx, tools, !!automatic, retry ? "retry" : automatic ? "settled" : "manual", automatic?.memoryDue ?? true, retry?.targets);
			if (retry && retry.stamp !== prepared.stamp) throw new Error("retry-context-changed; preview again");
			if (automatic && this.coordinator && !prepared.shared) return;
			if (prepared.generation !== this.generation || automatic && !automatic.eligible()) return;
			if (prepared.shared) await this.coordinator!.validate(prepared.shared);
			if (prepared.generation !== this.generation || automatic && !automatic.eligible()) return;
			const execute = () => { executed = true; return this.execute(ctx, prepared!, retry, onAdmitted, automatic); };
			if (prepared.shared) return await this.coordinator!.dispatch(prepared.shared, execute) as ReviewRecord;
			return await execute();
		} catch (error) {
			if (executed) throw error;
			if (retry) {
				if (error instanceof Error && error.message.startsWith("review-")) this.ledger.pause(error.message);
				throw error;
			}
			if (automatic) {
				try { if (generation !== this.generation || !automatic.eligible()) return; } catch { return; }
			}
			const reason = error instanceof Error && error.message.startsWith("review-") ? error.message : "review-coordination-unavailable";
			this.ledger.pause(reason);
			const admission = this.prepare(ctx, tools, !!automatic).admission;
			return this.ledger.admit({ ...admission, targets: automatic?.memoryDue === false ? [] : admission.targets,
				unsupported: reason, trigger: automatic ? "settled" : "manual",
				schedule: automatic ? { user: automatic.user } : undefined });
		}
	}
	private async execute(ctx: ExtensionContext, prepared: Awaited<ReturnType<MemoryReview["prepareCoordinated"]>>,
		retry?: { id: string; ledgerStamp: string }, onAdmitted?: () => void, automatic?: { user: string; eligible: () => boolean }): Promise<ReviewRecord> {
		const { generation, session, leaf, payload, snapshots, sources, digest, shared } = prepared;
		const current = () => generation === this.generation && !ctx.signal?.aborted && (!automatic || automatic.eligible()) &&
			session === ctx.sessionManager.getSessionId() && leaf === ctx.sessionManager.getLeafId();
		// Owner dispatch awaits after preview validation. Revoked retry must not reach
		// admit/recoverConfirmed, even when unsupported would prevent provider dispatch.
		if (retry && !current()) throw new Error("retry-context-changed; preview again");
		const record = this.ledger.admit({ ...prepared.admission, unsupported: prepared.admission.unsupported ?? (!current() ? "stale-generation-before-dispatch" : undefined), trigger: retry ? "retry" : automatic ? "settled" : "manual",
			schedule: automatic ? { user: automatic.user } : undefined, retryOf: retry?.id, confirmation: retry?.ledgerStamp });
		if (record.status === "skipped") return record;
		onAdmitted?.();
		const controller = new AbortController();
		this.controller = controller;
		const signal = AbortSignal.any([controller.signal, ...(ctx.signal ? [ctx.signal] : [])]);
		const timer = setTimeout(() => controller.abort(new Error("Review deadline exceeded")), this.ledger.limits.timeoutMs);
		let rejectAbort = (_reason?: unknown) => {};
		const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
		const onAbort = () => rejectAbort(signal.reason ?? new Error("Review cancelled"));
		signal.addEventListener("abort", onAbort, { once: true });
		let result: AssistantMessage | undefined;
		let terminal = false;
		try {
			if (generation !== this.generation || automatic && !automatic.eligible()) {
				return this.ledger.finish(record.id, "cancelled", undefined, { reason: "stale-generation-before-dispatch" });
			}
			if (signal.aborted) throw signal.reason;
			const completion = ctx.modelRegistry.streamSimple(ctx.model!, payload, {
				maxRetries: 0, maxTokens: this.ledger.limits.output, timeoutMs: this.ledger.limits.timeoutMs,
				signal, reasoning: ctx.thinkingLevel === "off" ? undefined : ctx.thinkingLevel, toolChoice: "none",
			}).result();
			const late = (usage: UsageReport) => {
				try { this.ledger.lateUsage(record.id, usage); }
				catch {
					this.lastError = "Late usage could not be settled; inspect the ledger";
					try { this.ledger.noteFault(record.id, usage); } catch { /* Pending accounting remains an admission/display fence. */ }
				}
				this.stateChanged?.(record.id);
			};
			void completion.then(message => { if (terminal) late(message.usage); }, error => {
				const usage = errorUsage(error); if (terminal && usage) late(usage);
			});
			result = await Promise.race([completion, aborted]);
			const valid = () => !signal.aborted && generation === this.generation && (!automatic || automatic.eligible()) &&
				this.ledger.canCommit(record.id) && session === ctx.sessionManager.getSessionId() && leaf === ctx.sessionManager.getLeafId();
			if (!valid()) {
				return this.ledger.finish(record.id, "cancelled", result.usage, { reason: "stale-generation-or-branch" });
			}
			if (result.stopReason === "error" || result.stopReason === "aborted") {
				return this.ledger.finish(record.id, result.stopReason === "aborted" ? "cancelled" : "failed", result.usage, { reason: "provider-error-or-abort" });
			}
			if (result.stopReason !== "stop" || result.content.some(block => block.type === "toolCall")) {
				return this.ledger.finish(record.id, "no-proposal", result.usage, { reason: "incomplete-or-tool-response" });
			}
			if (result.usage.output > record.reserved.output || result.usage.totalTokens - result.usage.output > record.reserved.input) {
				return this.ledger.finish(record.id, "failed", result.usage, { reason: "reported-budget-overrun" });
			}
			if (Buffer.byteLength(text(result.content), "utf8") > this.ledger.limits.output * 16) {
				return this.ledger.finish(record.id, "failed", result.usage, { reason: "oversized-proposal" });
			}
			if (shared) {
				try { await this.coordinator!.checkParticipants(shared); }
				catch { return this.ledger.finish(record.id, "cancelled", result.usage, { reason: "review-participant-changed" }); }
			}
			if (!valid()) return this.ledger.finish(record.id, "cancelled", result.usage, { reason: "stale-generation-or-branch" });
			let proposals: Record<string, unknown> = {}, proposed = new Map<Target, MemoryBatch>();
			const commits: NonNullable<ReviewRecord["commits"]> = [];
			const mixed = shared?.contributions.some(c => c.participant.id !== MEMORY_PARTICIPANT);
			try {
				const body = text(result.content).trim();
				const fence = /^```json\r?\n([\s\S]*?)\r?\n```$/.exec(body);
				const value = JSON.parse(fence ? fence[1] : body);
				if (mixed) {
					if (!value || Object.keys(value).length !== 1 || !value.consumers || typeof value.consumers !== "object" || Array.isArray(value.consumers) ||
						Object.keys(value.consumers).some(id => !shared!.contributions.some(c => c.participant.id === id))) throw new Error("Invalid consumers");
					proposals = value.consumers;
				} else proposals = { [MEMORY_PARTICIPANT]: value };
			} catch { return this.ledger.finish(record.id, "no-proposal", result.usage, { reason: "proposal-validation" }); }
			if (!shared || shared.contributions.some(c => c.participant.id === MEMORY_PARTICIPANT)) {
				try { proposed = candidates(proposals[MEMORY_PARTICIPANT], sources, session, digest); }
				catch {
					if (!mixed) return this.ledger.finish(record.id, "no-proposal", result.usage, { reason: "proposal-validation" });
					commits.push(...snapshots.map(s => ({ target: s.target, consumer: MEMORY_PARTICIPANT, status: "rejected", ids: [] })));
				}
			}
			if (!mixed && !proposed.size) return this.ledger.finish(record.id, "no-proposal", result.usage, { reason: "no-stable-facts" });
			for (const [target, batch] of proposed) {
				const snapshot = snapshots.find(snapshot => snapshot.target === target);
				if (!snapshot) { commits.push({ target, status: "unresolved-scope", ids: [] }); continue; }
				// Bind expected old facts to the snapshot the review actually read.
				let bindError = false;
				for (const replacement of batch.replacements ?? []) {
					const existing = snapshot.entries.find(entry => entry.id === replacement.id);
					if (!existing) { bindError = true; break; } replacement.expectedFact = existing.fact;
					replacement.entry.id = existing.id;
				}
				for (const removal of batch.removals ?? []) {
					const existing = snapshot.entries.find(entry => entry.id === removal.id);
					if (!existing) { bindError = true; break; } removal.expectedFact = existing.fact;
				}
				if (bindError) { commits.push({ target, status: "conflict", ids: [] }); continue; }
				const destructive = (batch.removals?.length ?? 0) > 0 ||
					(batch.replacements ?? []).some(replacement => !explicitCorrection(replacement.expectedFact, replacement.entry, sources));
				try {
					// One destructive/unsupported change keeps the WHOLE same-target batch pending.
					// Exact native corrections may reuse the ordinary versioned mutation path.
					if (destructive) {
						const proposal = this.store.stage(snapshot, batch, "review-proposal");
						commits.push({ target, status: "pending", ids: [proposal.id] });
						continue;
					}
					const outcome = this.store.mutate(snapshot, { ...batch, proposal: record.id });
					commits.push({ target, ...outcome });
				} catch (error) { commits.push({ target, status: error instanceof Error && error.message === "base-version-mismatch" ? "conflict" : "rejected", ids: [] }); }
			}
			const saved = commits.filter(commit => commit.status === "saved").flatMap(commit => commit.ids);
			if (shared) {
				const memorySelected = mixed ? shared.contributions.find(c => c.participant.id === MEMORY_PARTICIPANT) : undefined;
				for (const target of memorySelected?.contribution.targets ?? []) {
					if (!commits.some(commit => commit.target === target.target)) commits.push({ target: target.target, status: "no-proposal", ids: [] });
				}
				for (const commit of commits) commit.consumer = MEMORY_PARTICIPANT;
				commits.push(...await this.coordinator!.commit(shared, record.id, proposals, valid));
			}
			const status = commits.some(commit => commit.status === "failed") ? "failed" :
				commits.some(commit => !["saved", "no-change", "no-proposal", "pending"].includes(commit.status)) ? "conflict" :
				commits.some(commit => commit.status === "pending") ? "pending" : commits.some(commit => commit.status === "saved") ? "saved" : "no-change";
			if (shared && mixed) {
				const noProposal = commits.every(commit => commit.status === "no-proposal");
				return this.ledger.finish(record.id, noProposal ? "no-proposal" : status, result.usage, { saved, commits });
			}
			return this.ledger.finish(record.id, status, result.usage, { saved, commits });
		} catch (error) {
			const reason = signal.aborted ? "cancelled-or-timeout" : "request-failed";
			this.lastError = reason;
			return this.ledger.finish(record.id, signal.aborted ? "cancelled" : "failed", result?.usage ?? errorUsage(error), { reason });
		} finally {
			terminal = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			if (this.controller === controller) this.controller = undefined;
		}
	}
}

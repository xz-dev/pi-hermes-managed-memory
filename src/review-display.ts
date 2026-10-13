import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { usageTotals, type ReviewLedger, type ReviewRecord, type UsageReport } from "./review-ledger.ts";

import type { ReviewSchedule } from "./review-schedule.ts";

export type ReviewOverview = ReturnType<ReviewLedger["overview"]> & { schedule?: ReviewSchedule };
function aggregate(reports: { usage?: UsageReport; cost?: number }[]) {
	let knownInput = 0, knownOutput = 0, unknownUsage = 0, knownCostSubtotal = 0, unknownPrice = 0;
	for (const report of reports) {
		const totals = usageTotals(report.usage);
		if (totals) { knownInput += totals.input; knownOutput += totals.output; } else unknownUsage++;
		if (report.cost !== undefined) knownCostSubtotal += report.cost; else unknownPrice++;
	}
	return { knownInput, knownOutput, unknownUsage, knownCostSubtotal, unknownPrice };
}
export function usageDetail(ctx: ExtensionContext, records: ReviewRecord[]) {
	const primaryReports = ctx.sessionManager.getBranch().flatMap(entry => {
		if (entry.type !== "message" || !["assistant", "toolResult"].includes(entry.message.role)) return [];
		const message = entry.message;
		if (message.role === "toolResult" && (!("usage" in message) || !message.usage)) return [];
		if (!("usage" in message)) return [{ usage: undefined, cost: undefined }];
		const usage = message.usage;
		const cost = usage?.cost?.total;
		return [{ usage, cost: typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : undefined }];
	});
	const auxiliaryReports = records.filter(record => record.session === ctx.sessionManager.getSessionId() && record.usageState !== "not-sent")
		.map(record => ({ usage: record.usage, cost: record.costEstimate }));
	const primary = aggregate(primaryReports), auxiliary = aggregate(auxiliaryReports);
	return { primary: { scope: "current active branch assistant/tool usage entries; excludes unreported compaction", ...primary },
		auxiliary: { scope: "review requests for this session, separate from Pi native statistics", ...auxiliary },
		combined: { scope: "known subtotals only, not a complete provider bill", knownInput: primary.knownInput + auxiliary.knownInput,
			knownOutput: primary.knownOutput + auxiliary.knownOutput, unknownUsage: primary.unknownUsage + auxiliary.unknownUsage,
			knownCostSubtotal: primary.knownCostSubtotal + auxiliary.knownCostSubtotal, unknownPrice: primary.unknownPrice + auxiliary.unknownPrice } };
}
export function reviewLines(view: ReviewOverview, now = Date.now()): string[] {
	const recent = view.requests.at(-1);
	const running = view.running.map(record => `${record.model} ${Math.max(0, now - Date.parse(record.started)) / 1000}s`).join(", ");
	return [
		`Hermes review: automatic ${view.schedule?.enabled ? "ON" : "OFF"}; ${view.paused ? `PAUSED: ${view.paused}` : `manual ready${view.schedule?.enabled ? "; settled cadence" : ""}`}; errors ${view.errors.length + (view.fault ? 1 : 0)}`,
		...(view.schedule ? [`Work: users ${view.schedule.userTurns}; tool-bearing turns ${view.schedule.toolTurns}; progress ${view.schedule.progress}/${view.schedule.cadence}${view.schedule.due ? "; due" : ""}${view.schedule.reason ? `; ${view.schedule.reason}` : ""}`] : []),
		running ? `Running: ${running}` : `Latest: ${recent ? `${recent.status} (${recent.reason ?? "complete"}); ${recent.model}; ${recent.ended ? Math.max(0, Date.parse(recent.ended) - Date.parse(recent.started)) : 0}ms` : "none"}`,
		`UTC ${view.day}: budget debit in/out ${view.daily.input}/${view.daily.output}; requests ${view.daily.requests}/${view.limits.dailyRequests}; remaining ${view.daily.remaining.input}/${view.daily.remaining.output}`,
		`Cache reported read/write ${view.daily.cacheRead}/${view.daily.cacheWrite}; unknown cache ${view.daily.cacheUnknown}; unknown usage ${view.unknownUsage}; all-request known estimate $${view.knownCostSubtotal.toFixed(6)} + ${view.unknownPrice} unpriced`,
		`Unresolved holds in/out ${view.held.input}/${view.held.output} (${view.held.requests} requests); ${view.clockRollback ? "CLOCK ROLLBACK: recovery refused" : "confirmed debt is counted once, not reported actual usage"}`,
		`Limits ${view.limits.input}/${view.limits.output} tokens, ${view.limits.timeoutMs}ms; /hermes-review usage|errors|pause|resume|cancel|retry`,
	];
}
export function displayReview(ctx: ExtensionContext, view: ReviewOverview): void {
	if (!ctx.hasUI) return;
	const lines = reviewLines(view);
	ctx.ui.setStatus("hermes-review", lines[0]);
	ctx.ui.setWidget("hermes-review", lines, { placement: "aboveEditor" });
}
export function displayUnavailable(ctx: ExtensionContext): void {
	ctx.ui.setStatus("hermes-review", "Hermes review unavailable; ledger/configuration error; no fallback request");
	if (ctx.hasUI) ctx.ui.setWidget("hermes-review", ["Hermes review unavailable; inspect ledger/configuration before retrying. No fallback request."]);
}
export function publishReview(ctx: ExtensionContext, action: string, detail: unknown): void {
	const result = { type: "hermes-review", action, detail };
	if (ctx.hasUI) ctx.ui.notify(JSON.stringify(result), "info");
	else process.stdout.write(JSON.stringify(result) + "\n");
}

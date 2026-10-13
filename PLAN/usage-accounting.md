# Terminal usage accounting — task 2.3

`npm run check`: exit 0. Full suite: 35/35 passed. Logs: `/var/tmp/hermes-accounting-complete-SU3K2C/`.

Every newly admitted request records its request/job ID, manual trigger, target set, session/project, leaf/generation, model/prices, timestamps, serialized-UTF8 estimate basis and full reservation. Terminal records retain raw reported usage and explicitly use `sdk-total-minus-output` for budget input; cache-read/write fields remain intact. Reasoning and 1h cache-write subsets are not added again to output/cache budgets.

Accounting tests exercise saved/no-change/no-proposal/conflict/failed/cancelled, exact repeated final and late callback suppression, partial failure telemetry, late partial and complete telemetry, prior partial-report retention, unknown usage, missing/zero pricing placeholders and unsupported 1h generic-rate estimates. Partial reports never release the reservation. A complete report replaces—not adds to—the partial tally; the prior report remains audit evidence.

Actual extension cases demonstrate that native faux-provider failure still consumes input and that a no-change proposal preserves the Markdown bytes while recording the second request's usage and model-table estimate. Missing prices stay unknown, not zero. Estimates preserve their stated basis; none is a provider bill or real-model quality result.

Persistent display/control behavior remains task 2.4; this gate does not claim that UI is complete. Real provider and dispatch/kill integration remain separately unexecuted/pending.

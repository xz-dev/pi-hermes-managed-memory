# Request limits and single request — task 2.2

`npm run check`: exit 0. `test/review-outcomes.test.ts`: 11/11 passed. Logs: `/var/tmp/hermes-limits-check-jh53Pn/`.

Actual extension / official SDK / isolated faux-provider cases cover empty output, reasoning-only, invalid JSON, tool request, provider failure, output overshoot, host timeout, per-request input, daily input/output and daily request admission. Each admitted case has exactly one independent provider invocation, one durable terminal record and no tool execution, model switch, child-model process or recursive parse/empty-result retry. Skipped cases have no auxiliary provider invocation.

The sole request forwards `maxRetries:0`, output cap, timeout, signal and `toolChoice:none`. Full system/history/tool/evidence snapshot bytes provide a conservative input estimate; the full input/output admission allowance is reserved. Host timeout can settle cancellation without waiting indefinitely for a provider proposal. Reported overshoot prevents saves and pauses further review. No-proposal consumes the daily request allowance.

This proves host request count and official SDK option forwarding. It does **not** assert unobservable provider-internal retries, exact remote token limits or real bills. Automatic billing remains off; real evaluation remains unexecuted.

# Durable reservation and owner — task 2.1

Verified with `npm run check` (exit 0), five focused ledger tests (5/5), and full suite (14/14). Logs: `/var/tmp/hermes-budget-regression-EWfDEo/`.

- Claims, deduplication, UTC-date watermark and full input/output reservations are persisted in a single exclusive local transaction before dispatch is permitted.
- Owner plugin/process/host/instance/deadline are retained. Only that instance may settle an admitted request or authorize commits.
- Two actual Node processes competing for one agentDir admit at most one owner. A killed owner becomes cancelled + usage-unknown; the full reservation remains held and new work is blocked.
- Expiration removes commit authority, including across UTC days. Late known usage updates only the cancelled request, not its proposal; recovery pause remains until explicit user handling.
- Reload does not erase spent allowance; UTC date rollback cannot recover an exhausted daily quota; duplicate snapshots remain suppressed.
- Atomic writes sync their temporary file and directory on the tested Linux filesystem. An initialization receipt outside the ledger directory prevents a missing file/directory from being treated as first use. Corrupt/incompatible ledgers fail closed.
- An abandoned transaction lock preserves the prior bytes and blocks writes. It is not silently removed or interpreted as evidence of no charge.

These tests kill a **reservation owner**, not a provider request after dispatch. End-to-end dispatch/kill and full companion-coordination regressions remain tasks 7.1–7.2. Unknown debt cannot prove the remote bill, and recovery does not replay the request. Automatic extraction is still off. Whole-state destruction including the initialization receipt is outside what local recovery can reconstruct; this is not a tamper-proof or remote-bill guarantee.

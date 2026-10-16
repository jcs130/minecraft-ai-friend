# Private failures and explicit offline recovery (0.1.77)

Runtime failures remain failures. The first exception is retained before status
publication or host-state persistence cleanup can mask it. A private
`host/runtime-diagnostics/<UUID>.json` records at most12 exceptions, eight bounded
source module/line frames each, class, errno/winerror, operation and a filename
hash. There are no exception messages, source lines, locals, credentials,
provider bodies, config values or persona/conversation text. Public status adds
only `diagnostic_id` and `diagnostic_available`. Diagnostic-write failure never
replaces the first exception. This improves evidence; it does not identify or
repair a previously untraced PermissionError, change Windows ACLs or retry body
operations. Records live in private account storage and have no public endpoint.

## Administrator interface

These two CLI commands perform local/file operations only. They are not model or
plugin tools. They do not construct a body/planner, connect, call TTS, kill
processes or start gameplay. Use the same configuration and data root as the
failed owner; Settings selects the exact account identity. This narrow interface
supports the local generic Mineflayer body, not a Java/remote body whose action
lifetime/reconciliation requires its own contract.

```powershell
agent-mc-autonomy recovery-assess --config <config.toml> --data <data-root> `
  --native-request-id <original-native-request-UUID>
```

Assessment does not write or clear anything. It returns exact identity, runtime
session, native run, state/status SHA256, owning lease state, dispatching count,
pending-maintenance state and old work classifications. Native archive scanning
is bounded to4MiB and eight original request records to1MiB each. Paths are
derived from the validated run/request UUIDs in that same session's client
directory. `archive_file_scanned` means this file was read; it is not proof the
run's event archive is complete. An accepted-only RPC is `accepted_only_unknown`;
an actual terminal is `archived_terminal`, with its original phase. Neither
verifies the goal or acknowledges uncertainty automatically. Overall assessment
remains `unknown`. A new runtime's task=null cannot prove an old terminal.
The mailbox must use the canonical rollback journal. WAL/SHM sidecars are
refused: readonly SQLite can otherwise create/update shared-memory files, while
immutable reads would incorrectly ignore WAL commands. Missing hosts/databases
are not created by assessment; CLI Mailbox construction itself only stores a path.

Before acknowledgement, the operator independently proves that every previously
known owned body/launcher process has exited, using PID plus creation identity.
The CLI cannot independently certify all orphan processes or old task outcomes;
it records the explicit external attestation and evidence ID truthfully.

```powershell
agent-mc-autonomy acknowledge-unknown --config <config.toml> --data <data-root> `
  --request-id <stable-acknowledgement-UUID> `
  --expected-identity <Settings-identity> `
  --expected-session <failed-runtime-session-UUID> --expected-run <old-native-run-UUID> `
  --expected-state-sha256 <original-state-SHA256> --expected-status-sha256 <original-status-SHA256> `
  --native-request-id <original-native-request-UUID> `
  --operator <operator-id> --reason <bounded-reason> --evidence-id <attestation-evidence-id> `
  --attest-prior-processes-exited --acknowledge-unknown
```

Operator/reason/evidence IDs are nonempty, single-line, bounded UTF-8 metadata
(120/600/200 bytes respectively), private in the audit. The native request option
may repeat up to eight times. Acknowledgement requires failed status bound to
the supplied exact Settings identity/session/run, connected=false and
autonomy_running=false; durable stopped=true, uncertain=true, pending=[] and
inflight_request=null; no dispatching mailbox command; available existing owner
lease acquired and rechecked; exact state/status digests and valid original
archive/request evidence. Unlinked old pending work is refused. Wrong binding,
digest, held lease, changed sources, nonempty work or another pending
acknowledgement refuses. There is no force flag.

## Recoverable commit and retry

Under the canonical account lease, private
`host/recovery-acknowledgements/<stable-UUID>/` preserves byte-identical original
state/status snapshots, a prepared audit and a committed receipt. Files are
flushed with fsync before their final names are published. Only the host-state
uncertainty bit changes; stopped stays true. Status, old requests/receipts,
commands, feedback, goals, death memory and native archives are not rewritten.
Classification is **acknowledged_unknown**, never completed, cancelled or
verified. The public receipt records no native replay and no autostart.

The transaction is prepared audit -> state compare-and-swap -> exact readback ->
committed receipt. Two files are not claimed as one atomic filesystem
transaction. If state succeeds but the receipt fails, the prepared record blocks
normal startup even though the stored uncertainty bit changed. The new kernel
adds that gate both before body construction and in Controller.run; all old
uncertain/pending/inflight and Mailbox refusal checks remain intact.

**Every potential starter must use0.1.77 or newer before acknowledgement.**
Old0.1.76 does not recognize this additional pending gate. Do not start an old
kernel against this ledger. Acknowledgement never launches a new kernel; a later
separate normal run remains necessary.

Retry exactly the same UUID and arguments. A valid committed receipt is returned
first without touching a later run or its current owner. An unfinished receipt
can finish only under the owner lease with the same binding, unchanged status
and native evidence, and exact original/resulting state hash. Its immutable
snapshots must match. A different UUID cannot cross a pending record. Missing,
partial, corrupt or conflicting evidence remains fenced and requires inspection;
it is not deleted, repaired silently or treated as successful acknowledgement.
Missing prepared evidence cannot hide a surviving committed or staged receipt.
Even if both records disappear, surviving snapshots or an empty transaction
directory keep startup fenced. Only the original administrator UUID may retry a
demonstrably pre-mutation transaction: stopped/uncertain/empty current work and
byte-matching original snapshots, with no commit evidence. Missing post-mutation
audit is never silently recreated.
Portable file fsync and atomic replacement are used; platform/power-loss
durability beyond those primitives is not claimed.

After a committed acknowledgement, the next separately requested normal run
uses fresh observations and the original active feedback through ordinary
Mailbox/Controller planning. It must not reissue an old accepted native request
ID/payload. Tests use genuine Mailbox/Controller fake ports to prove this boundary.

# Call corrections and planner scheduling

Known pre-dispatch validation failures are operation evidence, not model-provider
outages. Repeating an identical rejected call is fenced without dispatch; the
model can still query help, correct its parameters or choose another operation
at the configured normal decision cadence. Local validation and the repeated
admission/no-effect guards do not install a global planner retry deadline.

`Controller.defer_argument_correction` keeps its historical name but now only
tracks correction-contract attempts and ends a bounded correction chain after
two unsuccessful replies. The exact argument fence, rather than an exponential
sleep, prevents duplicate dispatch. The tracker can aggregate different invalid
arguments under one correction contract; its count is neither a count of body
actions nor authority to suspend all planning.

The original native rejection, typed correction/schema and help reference remain
in the existing bounded context and original receipt journal. No coordinate or
parameter is silently repaired. Native validation, stop and unknown-dispatch
fences remain authoritative. An unrelated provider retry deadline is preserved.

Public `planner_correction` metadata marks `scope: call` and
`global_backoff_added: false`; `planner_retry_seconds` continues to report any
independent outstanding provider deadline, otherwise zero. A corrected call does
not clear rejection evidence merely by time passing or world coordinates moving.

This change removes the former 30–300 second whole-planner penalty for local
call rejection and the 60 second escalation for malformed model tool calls.
It does not remove provider outage/rate-limit handling, explicit native waits,
the configured minimum decision cadence or the bounded maximum tool rounds.
The first known JSON syntax error still has one immediate correction opportunity;
subsequent errors return to normal cadence without a busy retry loop.

Since 0.2.124, successful tool no-ops also end only the current bounded turn:
an already-satisfied native plan and an unchanged saved death lesson do not
install a planner deadline or increment the plain-reply inactivity counter.
The next decision can choose other useful work at the configured minimum
cadence. Original receipts remain in context and the journal; there is no
invented movement, new lesson, task or verified goal completion. An independent
provider deadline, explicit stop and unknown-dispatch fences still apply.
This is distinct from plain replies with no tools, which retain their bounded
idle retry policy, and from real model-provider outages.

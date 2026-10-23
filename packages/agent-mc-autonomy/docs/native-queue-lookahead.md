# Native queue lookahead and conversation continuity

The coordinator used to wait for every owned body task to finish before ordinary
planning could run. A faster provider still left an empty queue between short
plans. Separately, a plain conversation during unfinished work scheduled the same
idle backoff as a reply with no work at all, delaying the next real terminal.

One known finite `mc_do` task now grants one bounded ahead opportunity. The model
receives its still-pending identity and fresh native facts. It can finish an
ordinary bounded read chain and append one small independent continuation. Only
the native executor stores and runs that plan. The framework stores a consumed
opportunity, not a second action queue. Two pending tasks close the opportunity;
there is no model polling loop while a body job continues.

The ahead tool view permits reads and `queue:append` only. Explicit follow/wait,
unknown or foreign ownership, pending feedback and death cannot grant it. Stops
and provider backoff retain priority. A failed/cancelled anchor received during
inference discards that unfinished result; a completed receipt still does not
prove the objective succeeded. Native admission and effect validation remain
authoritative for every appended step.

Conversation or a waiting reply while real native work continues is not idle
failure. It does not increment the idle-reply counter or create a future delay.
Ordinary idle replies without work keep their bounded backoff. Help and inventory
reads likewise no longer consume the two requested spatial-answer handoffs.

`planning_handoff` exposes the current mode and anchor. `decisions.jsonl` includes
`request_started_at`, `at`, `planning_mode` and native pending IDs for successful
and rejected requests, including output truncation. First-output latency, request
latency, physical activity and objective completion remain different measurements.

The run-loop regressions fail on the original serial admission and conversation
timer, then pass on the repaired coordinator. They also cover queue bounds,
explicit waiting, no-action ahead replies, native failure, append-only admission,
unknown dispatch, feedback, death, provider backoff and stop. Packed consumption
and natural gameplay still require separate checks; no host SDK or model change
is needed to adopt this framework revision.

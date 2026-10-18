# Current work, receipts and historical experience

`mc_queue` reports current progress and a compact, explicitly historical terminal summary.
`mc_queue({taskId: N})` retrieves the exact terminal text of one of the latest 64 tasks
in this World instance. `detail: "full"` expands the latest receipt. Missing or evicted
receipts are unknown, not completion. Task events still carry their original complete text.
The current request facts use the same bounded summary; querying does not impose a cooldown.

Optional `WorldRequestFacts.workStates` provides structured server work observations.
`resolveWorkReferences` is exported from `agent-mc-world/contracts` and compares explicit
realm/account/agent, subject, occurrence and revision. A host may bind its intention to one
such reference, then adopt a matching server-confirmed retirement while preserving the
original intention and its evidence. The core never edits host memory or plans. A reusable
quest name, old count, nearby player, timer, accepted action or successful program exit
does not close an intention. Legacy unbound intentions require evidence-backed migration.

Hosts need to reconcile these identities before rendering current pending work and before
background planning. Closed work belongs in a history index, not in the active queue. New
occurrences must use new instance identities. Equal-revision contradictions remain unresolved.
This contract alone does not retrofit a host's legacy pending-work manager or prove learning.

`server_travel` may specify `dimension` for its destination. Unlike `goto.dimension`, it
is an arrival condition. One dispatched travel command owns one observed transition until
the landing is verified or the step ends. Other queued old-world work is cancelled with its
original task identity. A dimension event alone is never arrival; coordinates are checked too.

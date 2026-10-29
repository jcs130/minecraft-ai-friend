# Event reads and execution generations

`MinecraftAgentClient.executionState()` and the current fact part `executionState`
expose `agent-mc-execution-state/v1`. `events()` also includes that state under
`readout.execution`; MCP `mc_events` preserves the full page in `data` and repeats
the bounded header in `meta.eventRead` (`agent-mc-event-read/v1`). Existing JSON
`text` and cursor fields remain available.
The typed header also preserves `cursor` and `returnedCount` when a host presents
only a partial event body; an omitted body is not an empty original page.

`activeCount` counts registered nonterminal receipts in the current connection
generation. `detachedCount` counts registered nonterminal receipts left in an
earlier generation of this runtime. Each identity preview is limited to three;
counts and the revision include all identities. `latestTerminal` retains the
latest registered terminal in the current generation even if a later page only
contains chat or ambient updates. A changing cursor is not execution progress.
No receipt is completed, cancelled or replayed by a read. Execution completion
does not complete the host's goal.

The scope is `runtime-receipts`, not a claim that the whole world/body is idle.
`previousRuns: not-covered` means earlier runtime instances still need their
original request/archive evidence. In particular, `activeCount: 0` cannot clear
an old run's unknown effect or authorize replay. A reconnect retains unresolved
older-generation identities as detached work rather than treating them as new
active work or declaring them complete.

Hosts should keep the typed header, execution identities, cursor and explicit
partial-content markers when limiting model-visible receipts. Cutting encoded
JSON at a character offset can hide terminals and produce an invalid envelope.
The full receipt remains in the ordinary SDK/MCP result and original journal;
these readouts do not add a model call or an autonomous game action.

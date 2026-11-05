# Shared host capabilities

The core owns game facts, body execution, work identity and reusable game-method
learning. Hosts retain their model, personality, personal memory, assignment loop
and adoption decisions. These additive `agent-mc/v1` queries do not start another
loop, connect a game or acquire a body lease.

## Argument-specific call inspection

SDK: `client.inspectCall(toolName, arguments)`. The pure classifier is also exported
as `inspectToolCall` from `agent-mc-world/contracts` for in-process hosts.

MCP tools advertise `_meta["agent-mc/v1"].callCapabilities`, pointing to the actual
protocol tool name. Call that tool with:

```json
{"protocol":"agent-mc/v1","action":"inspect_call","tool":"mc_script","arguments":{"validate":true,"code":"return 1;"}}
```

The `agent-mc/call-capability/v1` result distinguishes `readOnly` from
`backgroundLearning`. The latter permits declared method editing/isolated
validation, not live-body execution. Both use the original tool's full schema and
predicates, even when the model-facing catalogue is compact. Invalid/unknown calls
and predicate failures remain explicitly unknown. `available:null` means the tool
has no explicit runtime availability predicate; it is not a promise of readiness.
The response always has `dispatched:false`. A host must still validate and apply
ordinary ownership rules when it later executes the call; the inspection is not
an authorization token. Older cores without this metadata remain unsupported,
not implicitly safe. Backends advertise only the predicates they implement.

## Work identity and stage evidence

`client.currentFacts()` / protocol `facts` now retain `workStates`, `workBindings`
and native `world` observations when supplied by the connected backend. These are
fresh structured facts, not old journal entries. Disconnected snapshots omit them.

SDK: `client.resolveWork(references)`. MCP: protocol action `resolve_work` with up
to 64 `references` (`scope`, `subject`, `instance`, `revision`). Both call the
existing `resolveWorkReferences` implementation. Different realms, accounts,
agents or occurrences do not match; older revisions are unknown and conflicting
equal revisions are conflicts. A matching completion produces a retirement
candidate, with its original evidence. `adopted:false` is always explicit: the
host must decide whether and how to close its own agenda/waiting item.

The Python `agent-mc-autonomy` bridge consumes both queries without duplicating
their classification or matching algorithms. Its review context keeps a bounded
work-state view and the existing full-evidence paging path. This does not create
parallel body queues or claim that a worker report is verified game success.

## Scope of this extraction

Recorded-scene replay and background method validation are included. General
private-host assignment/report policies and long-term model budgeting are separate
runtime concerns; this change does not copy a personality loop, force a model or
set a universal 32K output budget/20-minute combat timeout. N.E.K.O. and Cortico
continue to own their existing loops.

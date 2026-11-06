# Supervisor and executor context

The core still delivers the complete `agent-mc/v1` event. A producer may attach
`meta.requestContext` with `protocol: event-context-view/v1`, `originalSha256`,
and a bounded `supervisor` string. Hosts can validate this with
`readSupervisorEventView(originalText, value)` from `agent-mc-world/context`.
Null means keep the original. The projection is optional, never an alternate ledger.

The tactical producer opts in only for accepted choices, retaining decision,
method and task references and explicitly not asserting goal completion. Failure,
human input and unknown outcomes are not summarized by this producer. A host must
retain the original event cursor, source and observation time, keep full executor
input and offer lookup of the original event. Complete worker reports must reach
their supervisor before a version-specific review can replace them with references.

`ToolDef.helpFor(args)` identifies a requested help target. It does not execute an
action or grant a body lease. A host that delegates a World can route detailed body
tool help to its executor while leaving read-only help and supervisor conversation
available. Renaming adapters preserve this callback alongside the tool handler.

These contracts add no model, personality, game-specific strategy, implicit worker
or concurrency policy to the core. Hosts continue to own dispatch and acceptance;
the native task queue continues to own the single body.

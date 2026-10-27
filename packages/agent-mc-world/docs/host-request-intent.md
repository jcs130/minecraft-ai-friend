# Host request intent and rejected speech

`agent-mc-world/extension` exports `minecraftRequestKinds(steps)` and
`omitRejectedMinecraftSpeech(steps, rejectedZeroBasedIndices)`.

Hosts can refine a batch tool's tags using the real step contents. Speech,
observations and supported dry runs are not body actions. Server commands are
not assumed to be read-only. These labels describe requests, not acceptance,
completion or world progress; retain the native executor receipt.

When a host refuses unsubmitted social text, the omission helper can preserve
independent steps in their original order. Explicit `needs` dependencies on
removed speech are cut transitively; retained references are renumbered. Server
commands cannot be removed as social text. Unknown step grammars and invalid
dependencies return `supported:false` rather than manufacturing a runnable plan.

The helper neither executes nor retries. Submit at most once through the
original World handler, retaining the original queue mode, validation,
permissions and automatic material dependency handling. A previously queued,
sent or uncertain batch must be reconciled by its existing execution identity,
not split and replayed. Preserve explicit cancellation and World identity changes.

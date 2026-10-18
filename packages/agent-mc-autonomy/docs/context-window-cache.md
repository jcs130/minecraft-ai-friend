# Full-window history and cache continuity

In full mode, the request assembler can retire old complete exchanges when the
selected model's real context window fills. The controller now commits that
retirement to its retained history. Previously, it rebuilt each request from
history that the preceding request had already evicted. Near a full window this
repeatedly displaced the cached prefix. Original decision and action journals,
native facts, pending requests and archive handles are unchanged.

An optional host-neutral setting leaves room for new exchanges after an actual
overflow:

```toml
[autonomy]
context_mode = "full"
context_tokens = 131072
context_history_headroom_tokens = 8192
```

The default is `0`, preserving strict window filling for existing consumers.
The opt-in margin is capped at a quarter of the selected window. It applies only
to whole old history groups, only after the request exceeds the actual limit;
fitting history is not discarded in advance. Fresh body state, server refusals,
current failures and pending events are never removed to meet the cache target.
They continue to use the actual context window. The model capacity remains
131072 in this example. Evicted raw originals remain in their existing journals
and archive interfaces, rather than being summarized or deleted.

`context.history` reports `available`, `included`, `evicted`, and
`cache_headroom_tokens`. After retirement, subsequent small exchanges retain the
same first history group until the window fills again. A large new observation
can still require another eviction. Cache reuse and live inference latency
remain separate measurements; restarting an empty conversation is not evidence
that long-running cache churn has been solved.

Regression tests cover the real controller request boundary, whole tool-call
exchange integrity, unchanged fitting history, retained current refusal facts,
configuration validation and bounded opt-in margins. No game, model or network
is invoked by those tests.

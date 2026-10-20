# Full-window history and cache continuity

## Exchange-sized retirement margin

With an operator-selected nonzero history margin, 0.2.74 treats that setting as
the minimum. Only when the actual request overflows, it measures the latest
complete exchange's contribution using the same selected counter and chooses
the larger of the configured margin or three such exchanges, capped at one
quarter of the selected window. A fitting request keeps every supplied exchange;
the default zero margin still disables batching. Current facts, refusals,
pending receipts and current tool policy are not discarded to meet this cache
target. Complete old groups retire through the existing explicit window logic,
and original journals stay unchanged. The newest complete exchange is retained
if it fits the actual window, even when the optional margin cannot be reached.

The fixed 8K margin was smaller than large game exchanges. The regression
reproduced prefix retirement on both following turns; the adaptive margin kept
both turns' historical prefixes. Diagnostics distinguish configured/actual
margin and measured growth in the budget's stated units. Counter failure
restarts the entire request conservatively, including that measurement.
This amortizes window rotation; it cannot guarantee a cold request will finish
before every provider deadline or remove shared-service pressure.

The bound local-template CPU replay initially retained only 1,791 common
leading tokens after the next rotation. Adaptive retirement left the following
two requests unrotated, sharing 78,530 and 90,935 leading tokens. These are
synthetic-history prefix counts, not GPU performance results. The final full
regression passed 1,389 tests, including selected-memory rebasing and counter
failure; the first full run caught over-retirement of the last fitting exchange
and that counterexample remains covered.

## Stable capabilities and current admission

In full mode, temporary read deferral and native lookahead no longer change the
provider's function declarations. Some selected Chat templates prepend those
declarations to the entire conversation; removing one read tool or narrowing a
queue enum therefore invalidated almost all of an otherwise reusable prefix.

The final user scene now contains a literal `current_tool_policy` with its
`allowed_tools` and `native_queue` (`normal` or `append_only`). Declarations
describe capabilities, not permission. The controller still validates calls
against its restricted per-round schemas before dispatch. A declared but
deferred read, disallowed lookahead mutation, or queue replacement is rejected;
no second queue or weaker barrier is introduced. This mandatory current policy
is not replaced by a historical reference or evicted as a hint. Compact mode
keeps its existing declaration filtering.

Decision, cancellation and timeout journals include bounded `request_context`
counts, history retirement and prefix/policy hashes. They contain no request
text, selected memories, headers or credentials. Comparing these with actual
provider cache/latency distinguishes schema churn, history retirement and
service contention. A CPU replay with the operator-bound template demonstrated
the prefix defect; it does not by itself establish live performance improvement
or that every timeout has this cause.

The 0.2.73 regression used the real controller with fake body/provider ports and
the selected local Chat template/tokenizer. With the same synthetic retained
history, the old ordinary/ahead and ordinary/deferred pairs shared only 83 and
112 leading tokens. The fixed pairs retained 77,335 and 77,332 leading tokens
while the current policy changed. This is CPU prefix evidence, not GPU cache
occupancy or a measured game speedup. The 1,387-test package regression passed;
100 targeted tests also passed from the isolated wheel. The SDK-free probe
passed after its source example configuration was copied into the isolated test
harness; the initial missing-fixture failure was not a production failure.

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

The margin must match the actual exchange size. A natural 128K game trial with
an 8192-token margin produced three consecutive window rotations and 89–93s
requests, despite good cache reuse before the first rotation. Full event batches
and receipts exceeded the small margin. A larger opt-in margin (for example
32768 at 131072 capacity) can leave space for several exchanges, at the cost of
retiring more complete old groups when an overflow actually occurs. This does
not change the model capacity, fitting-history policy or original journals.

## Lossless selected-value reuse

Full scenes retain the exact input, model response and tool results as a complete
exchange. Unchanged larger facts, current goal text, selected host memories,
recent host messages and speech receipt rows may refer to a literal value in an
earlier retained scene. At least 128 UTF-8 bytes must be saved by a reference.
Actor, record ID, source, text and playback state must all match; equal wording
from different people is not the same row. Fresh binding, selection and expiry
envelopes remain current. Health, location, queue, server feedback/message facts
and attributed game events stay literal.

The projector never points to another reference or a container whose children
are references. It rebuilds from complete raw retained scenes after retirement,
so the first surviving source becomes literal instead of leaving a dangling
pointer. `capture_scene` verifies the recovered complete scene's hash before it
enters input history. No original journal or query handle is deleted.

Terminal outcome rows can also reuse an identical complete receipt in an older
retained scene when the standalone `native_outcome/v1` source has retired. The
execution ID, phase, verification flags and every receipt field must match.
Changed or nonterminal outcomes remain literal. References point directly to a
literal row and rebase when that scene retires. The current pending/uncertain
barriers still come from fresh body facts, never these historical references.

The full assembler measures a candidate once and reuses that exact projection.
Only an actual removal of a history group, section, fact or event requires a new
measurement. A counter failure still restarts the whole request in conservative
byte mode. These CPU and input-volume savings do not establish real cache hits
or live inference latency; those require a separately observed game trial.

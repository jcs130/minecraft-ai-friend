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

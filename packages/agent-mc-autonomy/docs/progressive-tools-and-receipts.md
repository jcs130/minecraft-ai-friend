# Progressive tools and faithful results (0.2.129)

Compact mode begins with the existing small tool set and `mc_invoke`. After a
successful explicit `mc_tool_help(name)` or requested synchronous advanced read,
the controller exposes that tool's native schema on following model rounds.
Discovery retains at most four advanced names, in least-recently-used order,
and resets when the world/body identity changes. Hidden lifecycle tools stay
hidden. No unrequested quest book, mod catalogue or script library is loaded.
Old `mc_invoke(name, arguments)` links continue to work after promotion. Native
schema validation and dispatch gates still apply to direct calls.

Compact schemas retain native numeric/coordinate descriptions up to 1,200
characters, including applicability and coordinate arity. Previously the
240-character cutoff removed the entire shared `at` contract. The flat-step
description distinguishes absolute coordinates from `~offset` components and
identifies `goto.at`, `find.target` and `collect.block/count`. A `find` can return
an initial visible match without walking; it is not a resource collection.
Arguments are never
rewritten: a supplied bare `-64` stays absolute, even if the model says it meant
a relative move. A rejected, stopped or unverified move is not resource progress.

A schema rejection records `phase=schema`, `dispatched=false` and only the
already-valid enum/const selectors from the rejected call. A successful call to
the same tool and matching selectors clears that stale input error. Invalid
selectors are never guessed or rewritten. An unrelated operation, failed read,
native business refusal or unresolved body execution is not declared repaired.
If schema correction occurs while a body failure is unresolved, both causes are
retained, with the body failure first.

Receipts larger than 6,000 UTF-8 bytes still keep lossless originals in the local
journal and existing artifact chunks. Typed `data` results now receive a bounded
structured preview instead of being discarded in favor of the first part of
chat/queue text. Status, known/unknown flags, request/body identity, execution
identity and dated producer results receive priority. `preview.complete=false`
and omitted paths/counts describe partial presentation. An absent field or an
unshown array entry is unknown, never empty, safe, failed or successful by
implication. Read the original artifact chunks when the omitted information is
needed. The preview never changes dispatch, queue state, or full-context mode.

The optional result metadata
`meta.readAccess={protocol:"agent-mc-read-access/v1",readOnly:true}` describes a
synchronous read from a mixed extension tool. Pure read catalogue metadata is
also recognized. This classifies activity for diagnostics; it grants no action
permission and does not introduce caching of mod state.

The status projection contains `efficiency`, scoped to the current runtime:

| Field | Meaning |
| --- | --- |
| `model_requests` | Actual planner requests, including failed attempts |
| `proposed_tool_calls` | Calls in received model replies |
| `executed_tool_calls` | Calls dispatched by the model execution path |
| `validation_rejections` | Host schema/call rejections before tool dispatch |
| `successful_read_calls` | Successful calls classified as reads |
| `accepted_native_tasks` | Native action acceptances, not completed goals |
| `resolved_schema_failures` | Old schema rejections cleared by matching successful calls |
| `observed_body_change_samples` | Observations reporting changed body facts; not causal attribution |
| `goal_verified` | Always false for these counters; verification requires real outcome evidence |

These counters reset with the runtime. Persisted receipts, original request IDs,
native terminal events and actual inventory/position changes remain the evidence
for a task-specific result. Count retries and report model self-assessments
separately; a `goal_report` is still a planner report.

Regression coverage is in `tests/test_progressive_tool_use.py`, together with
the existing visual, queue, unknown-result, feedback and standalone suites. Live
SAO consumer evidence is documented in `integrations/sao-compat/OPTIMIZATION.md`.

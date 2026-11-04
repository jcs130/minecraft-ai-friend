# Activity attribution

`WorkBinding` identifies an activity by `scope: {realm, account, agent}` and
`subject`, with an optional `instance`. Preparation can bind the subject before
the server creates a run. Do not fill an absent instance from a nearby party or
a historical outcome.

`readWorkBinding` validates the portable shape. `compareWorkBindings` returns
`exact`, `subject`, `mismatch`, or `unknown`; a subject match is not an exact run
match. Neither function establishes completion or changes a host intention.

An optional server adapter can expose `WorldRequestFacts.workBindings` and
`ToolDef.workSubjects(args)`. The latter classifies documented commands without
executing them. Hosts can carry the binding into an assignment, reject a
different activity's mutation, and retain unrelated read results without using
them as that assignment's delivery. Unknown commands and ordinary movement are
not inferred from natural language or coordinates.

Use the existing `WorkState` and `WorkReference` only when exact occurrence,
server revision, status, and evidence are available. A schema version, timestamp,
tool acceptance, or worker report is not a server state revision or completion.

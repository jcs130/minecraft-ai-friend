# Native world identity and host context

The `identity` fact from Agent MC World includes `realm`, `account`, `agent`
and, since core 0.5.7-rc.130, optional `world` observation metadata. The
autonomy runtime projects the three scope fields before validating them.
Passing the whole extended fact to the exact stored-scope validator made
`game_identity` unavailable and prevented current host persona, recent
context and scoped game memory from binding.

`world` is not another source of account or realm authority. Missing or invalid
scope fields remain unavailable. Stored scope validation remains exact, and
world-aware realm keys are preserved verbatim. Old server-only scopes are
historical records; this change does not merge, rename or rebind them.

The regression checks use a native core 130 identity shape, then exercise
scoped persona publication and actual planner context assembly. They also
verify that a realm change rejects the earlier profile. Offline success is
not evidence that a host loaded the new runtime, recalled personal memory,
or produced a characteristic spoken line.

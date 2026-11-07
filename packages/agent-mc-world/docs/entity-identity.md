# Server-confirmed entity identity

Optional server adapters can bind a connection-scoped resolver through
`bindEntityIdentityResolver` from `agent-mc-world/extension`. Return an
`EntityIdentity` only when the server has correlated that entity's UUID with a
semantic role/name; custom-name text alone is not ownership evidence.

The resolver supplies `uuid`, `kind`, `name`, a short human-readable `label`,
`source`, `observedAt`, and optional `ownerUuid`. Call the returned cleanup on
disconnect and before binding a new connection. Old cleanup cannot remove a
newer binding. Do not persist live identity resolution across connections.

Snapshots, attention, proximity/death notifications, find results and public
entity snapshots retain the semantic identity. `name`, `target` and entity IDs
keep their original protocol meaning for physics and execution. A player cannot
be relabelled through this NPC port. SDK consumers may read the detached identity
with `agent-mc-world/observations`; adapters bind it through `/extension`.

Identity does not establish life state, visibility, friendliness, permissions,
proximity or successful interaction. Nearby occluded observations remain
explicitly tracked/occluded; the identity does not reveal hidden metadata or
grant attack/interaction access. Unknown entities keep their original labels.

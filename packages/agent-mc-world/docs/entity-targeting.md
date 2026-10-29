# Observed entity identities and explicit attacks

`attack.target` is the entity's registry type, or a player's actual name.
An observed numeric entity ID is a different field:

```json
{"skill":"attack","target":"zombie","entityId":42,"mode":"auto"}
```

`mc_attention` and `mc_risk` highlights provide `target` and `entityId` together,
while retaining the legacy `id`. Unknown names remain `null`; observation never
authorizes an attack. Other actor snapshots retain their original type/name and
numeric ID fields. Match those meanings rather than putting a numeric ID in
`target`. Numeric player names remain names; the core never guesses which
meaning was intended.

The optional nonnegative integer ID is scoped to the current connection.
Execution checks the requested type/name, current entity identity, distance and
line of sight. A missing, mismatched, invalid or occluded named entity does not
fall back to a nearer one. Identity is rechecked after asynchronous equipment,
aim and melee preparation. Bow tracking retains an observed UUID through the
draw; a reused ID or missing UUID after one was known cancels that shot.
Receipts distinguish admission, actual swings/shots, observed hits and terminal
outcomes. An accepted attack still does not prove a hit, kill or goal success.

Omitting `entityId` retains nearest matching type/name selection. An omitted ID
is not defaulted to zero. Stop, task ownership, health retreat, weapon rules,
native permissions and the separate fast controller's relation checks remain.
Use fresh observations after a lost identity; do not replay old attacks to make
up for unknown outcomes. These contracts are shared by SDK, MCP and host tools.

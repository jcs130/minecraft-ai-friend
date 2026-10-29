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

## Death observations and kill attribution (rc.128)

A matching native `entityDead` confirms the target's death, including when
another player or the environment caused it. It supplies no killer identity.
The attack can complete with zero swings or arrows if that exact target dies
during preparation; the receipt says that death was observed, with own kill
credit unconfirmed. A confirmed own hit followed by death still does not identify
the final killer. A lost entity or occlusion never counts as death. An ID reused
by a different observed UUID cannot settle the original attack.

Task step `observation` carries the public `AttackEvidence` contract
(`agent-mc-attack-evidence/v1`): captured target identity, observed target state,
native death time when available, actual swing/release counts, target-hurt
associations, `ownKillCredit:null` and `goalVerified:false`. SDK/MCP task events and
archives retain it at `execution.evidence.steps[].observation`. Existing
`observedEffect.before/after.target` are block readings and remain `null` for an
entity attack; position or inventory changes do not substitute for entity death.
Loss of tracking uses `decision.status:unknown`, with no automatic replay.

An actual bow release is counted even if death arrives before its result settles;
a draw cancelled before release remains zero arrows. Cancellation, link loss,
identity checks, weapon rules and brief occlusion tolerance still apply.

Passive combat receipts likewise expose observed engaged `targetDeaths`
separately from `kills:null` and `killAttribution:"unavailable"`. This is an
additive observation plus a nullable kill-count contract; consumers must handle
`null` as unknown, rather than zero. Historical numeric kill maps retain their
data and are marked `legacy-unverified` on read. They do not become verified
own kills or training success. Reading the ledger does not rewrite the file.

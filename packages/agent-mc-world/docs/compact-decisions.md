# Compact host decisions

`src/decisions/combat-request.ts` builds the inference projection. The decision loop retains the complete original frame, connection scope, entity UUIDs and tactic revision for refreshed execution checks. Model input size does not change those checks or confidence thresholds.

The projection preserves health and its provenance/age, distance, relative height, line of sight, confirmed relations, current controllers, equipment, mana, cooldowns and executable option constraints. Unknown values and omitted actor/candidate counts remain explicit. Health and mana use four significant digits for inference; original precision remains available to execution and audit. Every candidate's individual intent and tactic instructions remain intact, including distinctions between targets, directions and abilities.

`requestFacts().decision` supplies a separate, inexpensive current-state projection for host context/effort classifiers. It excludes inventory lists and history while retaining vital readings, immediate hazards, nearby threat counts/distances, task progress and body restrictions. It is advisory; complete `text`/`parts` remain available. Hosts should keep World identities and sample ages separate.

Measure backend-reported input tokens for the whole request. A multi-question backend may evaluate the shared state for each question. Put evidence required by only one question in that question's instructions. Around 200–500 tokens is a normal-scene target, not permission to omit additional threats, unknowns or agent-authored constraints in a dense scene. A returned choice, accepted action and successful goal are separate observations.

## Unresolved selection is execution feedback

### Occluded contacts

Visibility, historical contact and projectile clearance are separate facts. Native sight rays test multiple body heights from the eye; a visible head does not authorize shooting through the cover below it. A hostile's last visible point survives for at most 30 seconds (32 retained contacts, at most three projected), without incorporating hidden movement. Native death retires that contact; despawn alone does not. World, connection and life changes clear the ledger.

When engagement loses its known contacts, the controller releases the body with `lost-sight`, not `clear`. Low-health retreat still takes priority. The host receives the unresolved outcome and can choose a fresh checked search step, resume work or replan. Search offers perpendicular wall-side corridors as well as forward/diagonal ones, prefers observed contacts over ambient sounds, and never attacks an invisible target. Short steps are revalidated against body ownership, terrain and clue freshness. A chosen search or disappeared entity is not evidence of a cleared room.

`engage` starts the equipped combat controller, including bow use; it does not promise a melee-only approach. `track` observes without attacking. Current controller state is authoritative even when an authored tactic assumes a route is still running.

For a confirmed visible hostile and an idle body, three ambiguous rankings spanning at least 1.5 seconds produce one `CombatDecisionAttention` per unchanged encounter. The optional `HostCombatPort.attention` callback must forward it to the owning task, for example with `combatAttentionEvent(evidence, worldId)` and the host's ordinary World event delivery. Merely logging `host.combat.attention` is insufficient. The event carries decision IDs, sample time, connection, tactic revision, threats and non-execution; it is neither an attack command nor task completion. The source-owned `host-decision` feedback marker allows active execution workers to receive it even when their optional subscription list is narrow.

A host that only observes may opt in with `HostCombatPort.attentionInShadow` and an attention callback. Return `false` or reject if delivery did not occur. Returning `true` or resolving without a value acknowledges delivery. The selector retries the same feedback on a fresh matching scene within ten seconds and stops ranking that encounter after acknowledgement. It never applies a candidate in shadow mode. `NumenClientWorld.combatFrame` reads optional lease-scoped `NumenBodyPort.battlefield` samples and retains native tool references for a follow-up observation.

Subsequent fast requests include compact prior abstention evidence. A new scene/tactic, active body controller, movement, long observation gap or successful decision clears the episode. Thresholds, fresh-scene checks, collision/support and body ownership remain unchanged. Hosts must preserve explicit pauses and decide whether to attack, observe, leave or revise the tactic.

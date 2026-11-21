# Named NPCs and automatic threat admission

A name, stillness or missing metadata does **not** prove that a hostile-looking mob is an NPC. The native classifier only suppresses a named no-AI mob with no danger signal, or a neutral unprovoked Enderman. Damage provenance overrides suppression.

Some Citizens-like servers do not send a reliable NPC flag. For those servers an operator may explicitly configure `perception.npcThreatAnchors`. This is a bounded safety policy, not NPC detection and not permission granted by text in the world. Default: absent/empty; the Agent has no tool to add it.

Each entry requires:
- `server`: exact configured handshake hostname and port, e.g. `example.invalid:25565`.
- `world`: the **received native world key**, not a guessed dimension/type. Unknown native world means no exception.
- `uuid` and `type`: exact entity UUID and species; no names, wildcard, team-wide or species-wide exceptions.
- `position`: exact known display anchor `{x,y,z}` and `radius` in `(0,1]` blocks. At most 16 entries.

Use only for a display NPC the operator has independently identified. A moved/replaced/wrong-world entity is not exempt. Actual damage, provocation, mob aggression, Enderman aggression, Creeper ignition or swelling override the entry. Without reliable metadata, the risk of a malicious or unusual mob remains; this setting is deliberately not enabled automatically from observations or screenshots.

The 2026-11-21 mcmoyu sample in `tests/fixtures/mcmoyu-1.21.11-received.json` contains real received **decoded** NPC metadata and sign NBT (hover profiles redacted), not raw wire packets. Its Creeper did not carry a NoAI field, so the default classifier conservatively retains it as a possible threat. The anchor tests use that real metadata inside an explicitly synthetic native-world envelope. No claim of a final live anchor-policy validation is made.

Follow-up observation (2026-11-21): a native world key and both entity UUIDs were received. A session-only exact anchor changed the Creeper classifier from a threat to suppressed and removed it from the battlefield. See `mcmoyu-followup-observations.json`. This was observation mode with autonomous combat/equipment paused: it is not proof of default combat/retreat behavior. Read-only menu validation was aborted when authoritative HP fell 28→21 (max28) and returned to28 three milliseconds later, with no observed self damage source. Protection was retained; no second connection into that unexplained condition was attempted at that stage (later bounded observations below).

## Protocol774 follow-up: provenance, not a whitelist

`entity-native-state.ts` keeps actual spawn type/UUID, typed incremental metadata, attributes, statuses and public UUID team state. A UUID-matched `CIT-<12 compact UUID chars>` team is exposed as a **Citizens-compatible provider hint**, not an immunity flag. This matches Citizens2 commit `27654a98d3a0d7293b4fc5ca4c9d29876cc5db5a`, `Util.getTeamName` and `ScoreboardTrait`; an NPC provider can also implement hostile actors. Explicit visible `mc_risk(entityId)` reads include this source chain; bulk/player exports are avoided.

The authenticated t139 sample contains actual Creeper type32 and Enderman type41, UUID-matched CIT teams with collision and name-tag visibility `never`, and received metadata indices2/6/9. No flags/NoAI/swell entries were received in that short sample. Absence is a vanilla-default omission, not proof of special NPC safety. No separate nearby non-player hitbox was observed within the sampled1.5-block geometry, which does not rule out other arrangements.

**Data coherence matters:** the package root pins minecraft-data3.119.0, but its pnpm transitive Mineflayer/protocol dependencies actually resolved3.117.0. That old774 attribute map called id22 `generic.scale`, although it is movement speed. The captured decoded labels remain untouched and explicitly marked stale in `mcmoyu-t139-native-decoded.json`; do not cite0.25 as entity scale. `dependency-patches.ts` now selects this package's pinned data for both774 registry and serializer in memory. Other protocols follow their existing resolution path. No shared node_modules or server files change.

Without classifying a mob as safe, a stationary/distant Creeper outside the vanilla6-block blast reach (12 charged), plus a2-block reaction margin extended by observed closing velocity, is retained as potential/unknown rather than causing an automatic idle attack/retreat. Unknown velocity, close distance, charge, swelling, ignition, aggression, actual provocation or damage fail conservative. It remains tracked; the policy is not proof of arbitrary plugins' custom explosion ranges. Active fights and damage protection are not dismissed by quick recovery or team names. Modern `swell_dir` is also used for observer warnings (legacy `swell` remains supported).

`health-sources.ts` separately reports native update_health, max-health attributes/modifiers, self metadata, own HEARTS display scores, hurt/damage correlation, initial quiet baseline and raw losses, even after recovery/disconnect. Display scores never replace authoritative HP. A capacity transition is context, not an unconditional damage exemption. The historical28→21→28 remains unexplained and observable.

The two bounded t139 live sessions ended with ECONNRESET and then a server kick. The second actually sent/help but produced no captured target menu content; this is **not a menu compatibility pass**. The kick text was not retained. Last HP28/max28, no damage source observed, no further connection attempted. Combat/equipment/auto-eat were paused for read-only observation. The final canonical-data correction is offline-verified only.

Real9-byte target pose-update wire fixtures are separate from synthetic attribute/component packets. Replay tests must not relabel reconstructed decoded envelopes as captured wire. Full window/cursor recovery still requires actual confirmation; timeout/quarantine is not synchronisation success.

The modern `teams.flags` named booleans were also lost by Mineflayer4.39's `packet.friendlyFire` access. The in-memory compatibility bridge now preserves both friendly-fire and friendly-invisibility bits across add/change; legacy numeric flags remain supported. Actual t139 flags cannot be recovered from the already-decoded captures and remain unknown, rather than inferred false.

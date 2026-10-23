# Compact host decisions

`src/decisions/combat-request.ts` builds the inference projection. The decision loop retains the complete original frame, connection scope, entity UUIDs and tactic revision for refreshed execution checks. Model input size does not change those checks or confidence thresholds.

The projection preserves health and its provenance/age, distance, relative height, line of sight, confirmed relations, current controllers, equipment, mana, cooldowns and executable option constraints. Unknown values and omitted actor/candidate counts remain explicit. Health and mana use four significant digits for inference; original precision remains available to execution and audit. Every candidate's individual intent and tactic instructions remain intact, including distinctions between targets, directions and abilities.

`requestFacts().decision` supplies a separate, inexpensive current-state projection for host context/effort classifiers. It excludes inventory lists and history while retaining vital readings, immediate hazards, nearby threat counts/distances, task progress and body restrictions. It is advisory; complete `text`/`parts` remain available. Hosts should keep World identities and sample ages separate.

Measure backend-reported input tokens for the whole request. A multi-question backend may evaluate the shared state for each question. Put evidence required by only one question in that question's instructions. Around 200–500 tokens is a normal-scene target, not permission to omit additional threats, unknowns or agent-authored constraints in a dense scene. A returned choice, accepted action and successful goal are separate observations.

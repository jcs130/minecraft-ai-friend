# Retreat movement and death evidence

Combat uses the existing native controls and body owner. In water, the movement safety seam checks the actual unrounded 0.6 by 1.8 player volume along the direction produced by the directional keys. It checks loaded collision shapes, body/head clearance and hazardous materials. The one-block shoreline ascent additionally checks the raised corridor and supporting land or water beneath the entire footprint. Dry travel retains its terrestrial checks. A geometric bank candidate is always an **unverified route**, including after observed motion.

The existing `minecraft.combat` event and local combat receipt may include these additive fields:

- `controlSummary`: schemaVersion 1, finalMode (`fighting`, `retreating`, `tracking`), enteredDesperate, and the most recent retreat or null. A retreat contains startedAt, waterAtStart, bankCandidate or null, routeStatus `unverified`, and movement sampling facts.
- `movement`: samples, horizontalActiveSamples, horizontalIntentSamples, jumpOnlySamples, observedHorizontalDistance, progressBasis `sampled_position_delta`, and lastRejection or null. These are existing trajectory samples, not every physics tick. Observed horizontal distance includes knockback and drift; it does not establish commanded progress, safe escape or successful landing.
- Rejections: unknown_cell, collision, no_support, hazard, unsafe_footing (the terrestrial standing check failed), blocked_heading, no_direction. A null reason is not proof that all possible routes were clear.
- `deathEpisodeId`: copied only at a death-ending session from its native connection lifecycle. Timeout and later encounters do not reuse it.
- `scope`: the emitting realm, native account identity and agent identity, using the same values as the native death event.

The summary is limited to 2048 UTF-8 JSON bytes; malformed optional metadata is omitted independently of the original valid receipt. Existing report IDs, counters, scenes, explicit nulls and raw journal events remain authoritative.

The autonomy runtime attaches a late death-ending receipt only to an existing exact scoped death ID with the same journal run, a greater ordered cursor and an interval containing the observed death. It does not infer associations for legacy receipts lacking a native death ID. Duplicate, conflicting and out-of-order receipts remain in the raw journal and do not overwrite the projection.

Each episode retains at most two projected combat observations and 4096 UTF-8 JSON bytes total. Compact inspect exposes at most 1800 UTF-8 JSON bytes of combat preview rows, with an omitted count, original event coordinates and full-evidence detail paths. These additions do not enter every stable planner prompt. Accepted pending reviews hydrate the latest same-episode evidence while preserving lossless receipts and delivery identity. New evidence requires fresh inspection before reflection; old immutable evidence references remain readable. Completed lessons and ACKs are preserved and are never reopened by this addition.

This evidence is historical and goal verification remains false. The main brain decides whether a lesson follows; neither transport nor a recorded lesson proves behavioral improvement or authorizes replay of cancelled work.

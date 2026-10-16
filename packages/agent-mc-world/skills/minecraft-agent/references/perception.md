# Focused observations

Choose the smallest read that answers the current uncertainty. Keep the current task unless new evidence warrants a change.

- `mc_attention`: up to 3 current visible highlights by default. `mode` is `peaceful`, `explore` or `combat`; it changes observation priorities, not goals or body control.
- `mc_hear`: recent real server sounds, with direction, approximate distance band and age. No sound coordinates or entity identity. An empty result does not prove silence or safety.
- `mc_risk`: currently visible threats plus an explicitly labelled short motion estimate. Unknown attack range, sight range and probability stay null. It is not a calibrated probability cloud.
- `mc_visual` with `mode:"overview"`: coordinate-aligned image of the top surfaces in client-loaded terrain and optional selected attention regions. The overhead view includes terrain outside the current first-person view; unloaded chunks remain marked. Roofs and other surfaces hide lower geometry. It cannot establish route feasibility or exact support and clearance. Older viewers may identify their source as eye-visible and historical terrain in the image metadata.
- `mc_scout` / `observe`: use a few `sites`, rays or a bounded voxel slice to resolve support and clearance. `probe`, script block reads and spatial samples return unknown for occluded or unloaded cells. Unknown is not air, a wall, or evidence of an unreachable route.

Keep task ID, terminal status, measured change, verified cause and next constraint in context. Retrieve detailed receipts only when needed. Species, proximity and online status do not establish hostility, intent or party membership.

Server-specific detection is supplied by a separate adapter with a real receipt, connection generation, dimension, timestamp and expiry. A successful cast alone is not detection evidence. Model selection, credentials and memory stay in the host adapter.

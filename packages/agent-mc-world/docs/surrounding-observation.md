# Surrounding observation

Entity observations describe nearby surroundings, independently of the direction a camera happens to face. The default is 32 blocks in every direction, with the existing loaded-terrain, visibility, invisibility and life-state checks. A photograph still represents its actual camera frame. Observation does not enlarge attack reach, interaction reach or pathfinding clearance.

Configure `perception.entityView` as `surroundings` (default) or `camera`; the latter also applies the existing 110-degree horizontal / 80-degree vertical cone. `perception.entityRange` accepts whole blocks from 1 to 64. Configuration changes apply to subsequent observations. Passive snapshots and explicit entity observations use this same policy. Snapshot count limits and individual tool search radii remain bounded.

The SDK exports `OBSERVATION_DEFAULTS`, `configureObservationPolicy` and `entityObservationScope` from `agent-mc-world/client`. The normal engine installs its own configuration reader. Hosts consume the core configuration schema instead of copying the policy.

The observation facade also preserves block searches requesting up to 2,048 candidates before applying line-of-sight filtering. Truncating this to 512 first could discard the only observable result. This remains a bounded search; hidden and unloaded blocks are not reported as observed.

## Original implementation comparison

The original Cortico Minecraft World at `fa57ab1961df848d1044ec25f44a171ec337e25a` observes nearby entities with a line-of-sight check without a camera yaw/pitch cone. Its passive snapshot radius is 16 blocks, and its block discovery requests up to 2,048 candidates. Our additional camera cone and lower candidate cap caused independently reproducible omissions. We restore surrounding observation while retaining actual sound-event provenance and explicit unknown states rather than deriving fictitious sounds from hidden entities.

Regression coverage includes camera turns, snapshot/attention/battlefield consistency, live range changes, wall and unloaded-cell occlusion, invisible entities, and a visible block beyond the old 512-candidate truncation. These are deterministic observation tests, not evidence of improved survival or exploration in a live game.

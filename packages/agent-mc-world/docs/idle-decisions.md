# Idle decisions and explicit engagement

The Mineflayer backend offers `kind: "idle", action: "wander"` in the existing battlefield candidate list when idle movement and host movement decisions are enabled. Its destination is a measured, loaded flat-ground segment of at most 2.5 blocks. It never digs, places, jumps, trades or completes a goal. Random idle presentation does not select this action. The host may choose it or keep still.

The same idle controller owns movement and cancellation. New work, item use, combat, hazards or nearby tracked hostile species invalidate the lease. A delayed decision must still refer to the exact offered destination. Native Java currently does not advertise this idle executor.

When `combatOptions.allowEngage` is enabled, the native combat controller admits explicitly selected visible enemies within 32 blocks, including sword approach targets outside the passive acquisition radius. The ordinary passive radius remains unchanged. Existing policy, health, weapon readiness, vertical bounds, line of sight, cancellation and no-progress termination still apply.

Public `current-body` activity records use `result.schema: "body-status/v1"`, a phase-start `at`, fresh `observedAt` and `expiresAt`. A live model request and an idle body are different states. Display consumers must expire stale body records; neither acceptance nor a display heartbeat proves movement, damage or objective completion.

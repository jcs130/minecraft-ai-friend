# Idle roaming

With `idle.enabled` and `idle.allowMovement` enabled, the core can sample a nearby
reachable destination and walk there during an otherwise idle body period. It is
not a second planner and does not call a model, select an adventure, or count
movement as goal progress.

`stroll` uses the existing pathfinder and movement policy, allowing local detours
and ordinary steps. `wander` and `short_walk` remain short flat-ground fallbacks.
A large catalogue of glances does not dilute movement selection. Ordinary pauses
and observation remain possible.

The search is bounded to 60 ms, the uninterrupted idle area to 12 blocks, and a
walk to 12 seconds. Unloaded terrain, water, portals, damaging blocks, pressure
plates, mining, placing and parkour are excluded. From a supported foot cell
already in shallow water with clear air above, a stroll may step directly onto
an adjacent dry bank. It never selects an intermediate water cell. A flooded
origin invalidates cached inland walks. Existing collision and server
boundaries are preserved. Current terrain is rechecked during execution; a
stalled or invalidated path is recorded as stopped, not reached. New body tasks,
combat, damage, connection changes and hazard reflexes cancel the idle lease.
Cancellation clears only the exact owned path and restores only its own temporary
movement settings before a successor starts.

Independent hosts may use `sampleIdleRoam`, `executeIdleRoam` and
`idleRoamOwnsPath` from `agent-mc-world/decisions`. Sampling is read-only. Execution
requires the host's body-availability predicate and abort signal; cancel it before
transferring body ownership. `idle-movement-ended` records actual origin, final
position and displacement, independently of model decisions.

On Java 1.21 and later, the collision solver tests real obstacle heights when stepping up. A gap of two blocks above the upper floor can admit a grounded step of 1/16 of a block. The engine retains the registered step-height attribute and checks the ceiling. The threshold for water and other 1.21.5 movement changes is independent.

Each actual stalled walk records the destination and next path node when available. Two stationary attempts in the same body generation within five minutes deliver one `meta.idleRoamObstruction` observation on the next ordinary model turn. Its evidence includes the first and latest times, the origin, the current position and the latest attempted route. Movement away from the local spot or a generation change starts another episode. SDK users can apply the same policy using `IdleRoamAttention` and `IdleRoamBlocked` from `agent-mc-world/decisions`.

Design references: [Touhou Little Maid's Brain](https://github.com/TartaricAcid/TouhouLittleMaid/blob/8a3ac5e9eacf0c6d63adf8832949f3ce81484fe6/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/MaidBrain.java)
separates low-priority random stroll target selection from navigation; its cited
1.20 source is an architectural reference, not the current server binary.
[Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
provides bounded probes and immediate `setGoal(null)` cancellation. Acceptance
uses the pinned 2.4.5 implementation and native Minecraft 1.21.1 physics, including
wall detours, steps, changing hazards, missing terrain and successor isolation.

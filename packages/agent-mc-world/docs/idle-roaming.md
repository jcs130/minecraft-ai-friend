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
plates, mining, placing and parkour are excluded. Existing collision and server
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

Design references: [Touhou Little Maid's Brain](https://github.com/TartaricAcid/TouhouLittleMaid/blob/8a3ac5e9eacf0c6d63adf8832949f3ce81484fe6/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/MaidBrain.java)
separates low-priority random stroll target selection from navigation; its cited
1.20 source is an architectural reference, not the current server binary.
[Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
provides bounded probes and immediate `setGoal(null)` cancellation. Acceptance
uses the pinned 2.4.5 implementation and native Minecraft 1.21.1 physics, including
wall detours, steps, changing hazards, missing terrain and successor isolation.

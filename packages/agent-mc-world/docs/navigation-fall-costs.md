# Health-aware descent (Java 1.21.1)

`mc_policy {"fall":"survivable"}` is the default. A dry descent is a route
candidate with an estimated health cost, not an automatic rejection at two blocks.
`fall:"safe"` selects routes without estimated fall damage. Both settings persist;
changing policy retunes the existing connection. SDK and MCP use the same policy.

The estimate is `ceil((feetDrop - safeFallDistance) * fallDamageMultiplier)`,
clamped to zero. Default Java values are 3 and 1. Received attributes that increase
risk are included; temporary damage reductions, armour, absorption, regeneration
and server-specific benefits are not assumed. Current finite health minus 2 HP is
the cumulative route budget. Missing health permits only estimated harmless falls.
Server plugins can change damage independently; this is an estimate, not a promise
that any route will survive every server rule or simultaneous enemy attack.

Each descent adds a health cost to A*. Different spent-health budgets at the same
cell are separate search states, so a cheaper but exhausted path cannot discard
a viable alternative. A nearby staircase wins over damage; a very long detour may
lose to a small drop. A planned descent still needs loaded support and clearance.
Live navigation and read-only route profiles share these rules and disclose the
budget. The public SDK exports the budget/estimate and movement policy installer.

Execution rechecks collision geometry and current health. Unexpected cliff exits
still stop. The deep-fall reflex exempts only an owned, measured landing with a
matching height and position; a lower destination Y alone is never sufficient.
Cancellation, death and world/goal changes invalidate that evidence. A target
inside solid ground remains a different failure from a reachable lower platform;
this change does not reinterpret a coordinate as a horizontal-only destination.
Native `goal_reached` can precede physical landing by part of a block. Only the
matching approved arrival retains its measured landing for up to one second;
cancellation or a new goal does not inherit this exemption.

## Reproduction and coverage

`tests/navigation-risk.test.ts` uses installed mineflayer-pathfinder 2.4.5,
prismarine-physics and real 1.21.1 collision shapes, without a game connection:

- legacy two-block setting rejects a four-block edge; the candidate executes it;
- native physics executes four/seven-block descent with the geometry and deep-fall
  guards present, without digging, placement or server position writes;
- nearby staircase vs long detour, cumulative damage and resource-aware A* keys;
- low/unknown health, adverse attributes, missing landing, lava/magma and blockage;
- health loss between planning and execution withdraws the descent;
- exact landing as the final destination, bounded arrival grace and cancellation;
- existing tests retain cancellation, stairs and unplanned lethal-cliff protection.

Physics replay proves movement and lifecycle, not live server damage or net game
progress. Natural server outcomes must be recorded separately.

## Primary references reviewed 2026-11-17

- [Mineflayer Pathfinder movement/cost API](https://github.com/PrismarineJS/mineflayer-pathfinder#movement-class).
  Implementation targets the installed 2.4.5, not unreleased master features.
- [Baritone descent planning](https://github.com/cabaletta/baritone/blob/master/src/main/java/baritone/pathing/movement/movements/MovementDescend.java):
  useful distinction between floor block and feet height, landing checks and fall
  cost. Older Minecraft API; no code copied or water-bucket behaviour claimed.
- [Paper 1.21.1 attributes](https://jd.papermc.io/paper/1.21.1/org/bukkit/attribute/Attribute.html):
  `GENERIC_SAFE_FALL_DISTANCE` and `GENERIC_FALL_DAMAGE_MULTIPLIER` are distinct
  observed inputs, not a reason to assume all servers use identical damage.

# Native state geometry and observation

Use the connected version's actual `stateId` and supplied collision `shapes`.
An explicit `[]` proves that state supplies no collision boxes; it must never
be replaced with a full cube. Missing shapes or unloaded cells remain unknown
and conservative. This rule covers plants, vines, crops, decorations, fluids,
open gates and future native states without a passability name allowlist.

The [Prismarine block API](https://github.com/PrismarineJS/prismarine-block/blob/master/doc/API.md)
defines shapes by block type **and state**. Its `boundingBox` is a coarse
classification that can label partial blocks as solid. `transparent` describes
texture alpha; it is not a body-clearance test. Selection/interaction shapes
serve clicking and aiming, and are not interchangeable with collision boxes.

Three decisions remain separate:

- **Sight:** `perception-sight` intersects the actual boxes along a ray. Known
  empty shapes do not occlude. Existing optical exceptions for glass and water
  remain; seeing through glass does not let a body walk through it. The loaded
  neighboring-cell collar still blocks verification when any required cell is
  unknown. Voxel output reports the supplied boxes and no passability verdict.
- **Movement:** pathfinder candidates also require body/head clearance, support,
  step height, interaction permission and current state. An open door still has
  a rotated panel: approach direction can require a click even when `open=true`.
  Open gates supply empty boxes; closed wooden doors/gates can propose a click
  only when door opening is enabled. Iron doors are not assumed hand-openable.
  Trapdoors retain their horizontal or vertical panels and are not implicitly
  toggled as doors; opening a supporting trapdoor can remove the floor.
- **Safety:** empty collision does not mean safe terrain. Lava and fire can have
  no collision while still damaging a body. Water requires separate swimming
  and drowning reasoning; support and burning-floor checks stay independent.

Offline fixtures enumerate all **26,684 Java 1.21.1 states** from the installed
registry: **5,011 empty**, **2,990 containing a full cube**, and **18,683 partial**.
Every supplied box is checked for finite, positive extents; every empty state
is checked against the public sight ray. Concrete native fixtures additionally
cover vine/grass/fern/crops/decorations, glass, fluids, fence/wall, slab/stair,
snow layers and open/closed door/gate/trapdoor geometry. Real pathfinder searches
exercise a supported low corridor with opening enabled/disabled; they generate
candidate receipts only and never open or modify an actual game.

This audit does not prove that every possible body route or hazard is solved.
Partial-shape route restrictions can remain conservative, and modded shapes,
server changes, waterlogging, connected neighbors, status effects and later
world updates require fresh evidence. Coarse placement/support/lighting checks,
interaction aim fallbacks and viewer digging outlines were inspected but kept
separate from LOS; they answer different questions and were not broadly rewritten.

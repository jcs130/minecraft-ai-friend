# Spatial tools: answer one question at a time

Use the configured connection's current facts. These tools are generic Minecraft
observations; they do not choose an activity, supply server permissions or run a
model. Read the installed schema first; older clients may lack `mode:sites`.

| Question | Smallest useful observation | Detail when needed |
| --- | --- | --- |
| Is this build/standing cell occupied, supported at its base, or obstructed? | `mc_scout` → `observe`, `mode:sites`, 1–4 absolute cells | `voxels` for exact shapes/properties |
| What is the local 3D arrangement? | `observe`, `mode:voxels`, small relative bounds | Split the measured region using the returned budget guidance |
| What blocks this direction? | `observe`, `mode:rays`, a few eye-relative rays | Unknown is not a clear ray; entities are bounding boxes |
| Where are floors, holes and height changes? | `probe`, `shape:box`, `slice:x/y/z` | Axis-labelled text slices; select only the relevant section |
| How does the build actually look? | `mc_visual` | Real viewer image for appearance; use collision data for geometry |
| What is on an existing in-game map? | `mc_view_map` | Server-sent map pixels; requires a filled map already received |
| Can a planned action proceed? | `mc_scout` → the action's dry-run | Still requires real execution and terminal/world verification |

## Compact site diagnostic

```json
{"steps":[{"skill":"observe","mode":"sites","sites":[[103,64,-31],[104,65,-31]]}]}
```

Coordinates are **absolute target cells**, not reference blocks or relative offsets.
Each site is independently measured in the current world, with no projected edits.

- `target`: actual block and properties, or `null` if unloaded. A non-colliding
  rail, plant or liquid is still an occupied cell; this is not replaceability.
- `below.topY`: highest collision top in the block immediately below, or `null`
  when absent/unknown. `below.topArea`: collision surface area at the target's
  base, from 0 to 1; unknown is `null`. A path at y=63 has topY=63.9375,
  not 64. Multipart face areas use their union, not a sum of overlapping boxes.
- `faces`: adjacent collision surfaces meeting the target boundary.
  `ref + face direction = target`; `area` is the fraction of the unit face.
  Known zero areas are omitted; unread reference blocks/shapes remain explicit.
  Partial/full geometric contact does not establish item-specific support rules,
  reach, line of sight, replaceability or server permission.
- `body.clear`: block-collision clearance for a **0.6 × 1.8 standing box** at the
  target's horizontal center and integer base height. `false` means a measured
  collision; `null` means unread geometry prevents a clear result. One surrounding
  owner-cell collar includes shapes such as tall fences. Entities, crouching,
  swimming, route access and stability of footing are outside this check.
- `body.blockers`/`fluids`: counts; `hits`/`fluidHits` show at most the first three.
  Fluid cells and waterlogged blocks are reported separately from collisions.
  `body.unknown` counts unread owner cells/shapes, including the collar.

Every response carries source, observation time, dimension and actual position.
Do not treat an older result as current after movement, construction or reconnect.
The helper caches only within this call; it never edits blocks or moves the body.

## Coordinate overhead photograph

Use `mc_visual` when the host accepts images and the matched modern viewer is
available. It photographs the **actual loaded renderer scene** without moving
the body, issuing camera controls to the game, or loading remote terrain:

```json
{"mode":"overview","overview":{"center":[103,-31],"span":32,"grid":4,"markers":[{"at":[103,64,-31],"label":"landing"}]}}
```

Omit `overview` to center on the current player. `span` is image width in blocks
(8–96); depth follows image aspect ratio. North is -Z, right is +X. Grid lines
are absolute integer block boundaries. Up to eight XYZ pins (labels ≤24 chars)
use the same orthographic projection as the scene; their Y is supplied by you,
**not measured surface height**. Grid 0 hides lines. This mode has no game HUD.
Unmeshed columns are hatched, not assumed empty. Roofs/bridges hide lower layers;
use `observe sites`, voxels or slices for support, headroom and vertical layers.
Unknown/missing image support returns an explicitly labeled data fallback.

One image helps compare rail layout, paths, structures and relative positions;
it does not prove route reachability, permission or movement. Query only the
few uncertain cells, then confirm task terminals and world changes. Keep image
and detailed receipts on demand rather than repeating them every model turn.

## Keep feedback small and useful

Feed back task identity, terminal state, measured change, supported cause and the
next constraint. Keep uncertainty and attribution. For example (illustrative):

> #42 blocked: target [103,64,-31] is dirt; rail not placed. Clear this target or
> choose another; full receipt remains under #42.

Do not repeat the whole inventory, voxel grid, guide or historical plan after each
action. Keep original receipts retrievable by their task/event/artifact handle;
request only the missing evidence. After a change, compare the affected cells or
position with the prior observation. Saving a plan or a successful tool return
alone does not prove a connected route, successful placement or learned method.

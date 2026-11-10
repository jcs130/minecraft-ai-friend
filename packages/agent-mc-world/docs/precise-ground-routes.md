# Model-authored precise ground routes

`mc_do` and the same `mc.do` script SDK accept `follow_route`. There is no extra
always-loaded tool or model loop. Query `mc_help {skills:["follow_route"]}` or
`mc_script {api:"routes"}` for the actual contract. A worker with `mc_do` can
execute the route without separate script permission; an explicitly granted
`mc_script` can compose it with observations and other operations.

```js
const result = await mc.do([{
  skill: 'follow_route', dimension: 'overworld',
  waypoints: [
    {at: [100.5, 64, 202.5], posture: 'sneak'},
    {at: [104.5, 64, 202.5], posture: 'walk'},
  ],
  avoid: [[102, 64, 200]],
  avoidBlocks: ['tripwire', 'stone_pressure_plate'],
  timeoutMs: 30000,
}]);
// Read result.steps/receipt/state. A group terminal is not the task's objective.
return result;
```

These are example coordinates, not a known safe map. The model must inspect its
current surroundings, choose waypoints and hazards, and change the plan when the
geometry or task changes. `dryRun:true` previews the same local geometry without
moving. Unknown cells remain unknown; dense observation feedback separately
reports invisible, unloaded and omitted cells. Unknown does not mean that the
server failed to send a chunk.

Coordinates are absolute feet positions and retain fractions. Posture belongs
to the segment ending at that waypoint. The controller brakes before turning;
it never substitutes A*, skips a waypoint, activates a mechanism, or modifies a
block. It checks the player's width, standing clearance and support along each
segment, then rechecks during execution. Declared avoid cells include the
player's footprint, not just its center. Sneaking alone does not make pressure
plates or tripwires safe. Undetected traps are not certified absent.

The current controller handles same-height, supported ground segments. Steps,
jumps, swimming, flight and vehicles remain separate capabilities that scripts
can compose explicitly. Each request allows 32 waypoints, 256 total blocks and
at most 120 seconds. Dynamic obstacles, loss of support, no progress, death,
teleport, cancellation and connection loss stop the original route and release
its inputs. A later cancellation cannot release a newer controller's keys.
Receipts retain actual reached waypoint indices and positions; continuation is
an explicit decision from the latest physical state, never automatic replay.

Implementation uses ordinary Mineflayer key input and actual game physics.
The public interface remains usable through SDK/MCP and host adapters; Java
backends must advertise their own supported step groups rather than imply parity.

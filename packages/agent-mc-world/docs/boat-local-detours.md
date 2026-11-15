# Local boat detours

A mounted boat could stop immediately at a finite bank: direct steering and
axis slides all pointed toward the destination. There was no lateral or reverse
search. This is distinct from missing mounting acknowledgement, failed boat
placement, or an unverified claim that a nearby pond connects to the sea.

`ride` and the SDK `moveVehicle`/`boat_trip` consumers now keep the same body
controller and try a bounded local detour after direct movement is obstructed.
The search uses half-block cardinal edges, at most 768 nodes within eight blocks,
and a checked forward segment of up to three blocks. It may briefly move sideways
or away from the goal. It only returns a path which reconnects toward the goal;
an exhausted search is not evidence that every possible route is unreachable.

Detours stay at the present water height. Every swept edge checks the full boat
hull, rider head clearance and loaded water support. Unknown cells, dry land,
lava and water over the rider's head are not silently traversed. Every execution
tick rechecks the edge. Server position correction discards the prior local
route; cancellation or changed attachment stops control. At most four detours
are attempted in one bounded ride. Failure keeps the rider mounted and reports
the actual obstruction; it does not dismount, clear the parent goal or submit
another model request.

The same behavior is consumed through the normal MCP/SDK ride action; hosts do
not need their own planner. Exact waypoints in `ride_route` remain available for
routes beyond this local scope. Reaching an already-near waypoint still does
not prove a journey, and a completed script is not a completed parent objective.

The replay reproduces the old controller's failure at a finite clay bank and
checks each emitted movement against 1.21.1 collision shapes. It also covers
unknown/dry/lava boundaries, cancellation and attachment cleanup. This is a
local packet/geometry replay, not a live server or complete fluid physics test.

# Water journeys and meal checkpoints

The reported failure was a long `goto` that entered open water and continued
swimming. No boat placement or mounting call was made. A queued meal also
remained behind that navigation because every checkpoint required dry ground.
This differs from a boat rejected by the server or a blocked hull.

The shared core already exposes `boat_trip`: placement, identity observation,
mount acknowledgement, bounded waypoints, and optional checked landing/recovery.
The capability index incorrectly linked to the older drive-only `ride_route`.
It now links directly to the complete routine. Having no carried boat still
means the caller must inspect recipes, materials or storage; it is not evidence
that a boat is available or that a whole sea route is navigable.

A sustained, measured breathing-surface journey produces a bounded `water`
observation with the original task and destination. It does not stop navigation,
spawn another body owner, manufacture a boat or choose a mandatory activity.
The public wake classifier and route advice consumer accept this typed reason.
Route advice can survive bounded surface swimming; submersion, a changed body
epoch, combat, queue/goal changes and stale source facts still expire advice.

Only a single-step pending meal can use a water checkpoint. It requires a live
breathing surface, sufficient measured oxygen, a stable body, no vehicle,
confirmed inventory, no window, and no combat/environment owner. The old path
is drained before consumption. Buoyancy is an owned, bounded input lease, not
a global anti-drown toggle. Death, teleport, disconnect and replacement control
release it without clearing the successor's keys. The original navigation
continues with its original task identity. Containers, construction and opaque
programs retain their prior atomic boundaries.

## Reproduction and boundaries

- The unchanged baseline fails the same sustained-water observation and native
  water-navigation tests. These use the pinned Prismarine physics and real
  pathfinder, not manually advancing player coordinates.
- A delayed meal consumes one item, increases food, stays near the surface and
  resumes the original destination. Submerged/low-air/combat/container negatives
  retain the pending request without stealing the body.
- The native Mineflayer passenger handler is exercised for acknowledged and
  unacknowledged mounting. No acknowledgement means no driving packets. The
  existing obstacle regression keeps the passenger aboard instead of jumping
  into water on failure.
- This isolated evidence does not prove production server navigation, resource
  acquisition or autonomous adoption. Those need distinct live inventory,
  passenger and displacement evidence after deployment.

## Primary references checked 2026-11-14

- [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md):
  `mount`, `dismount`, `vehicle` and passenger events distinguish sending an
  interaction from observing attachment. Local acceptance targets 1.21.1.
- [Pathfinder API](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md):
  `goto` is goal navigation, with swimming among its capabilities; stopping at
  the next path node differs from clearing a goal. Neither operation is a
  complete boat lifecycle. We retain the existing shared executor's identity
  and cleanup instead of adding another movement controller.

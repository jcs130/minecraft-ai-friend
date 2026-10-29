# Collision-verified compressed stair waypoints

A waypoint more than 1.25 blocks above the previous position is not necessarily
one direct jump: a compressed route can contain real intermediate steps. The
old no-jump-only exception rejected a two-step route that the installed
Mineflayer controller and collision physics could actually traverse.

The normal rise bound remains in force. Its short-route exception now tries
walking and ordinary held-jump controls against the currently loaded collision
world, using a copied player state. The jump candidate first settles without
movement to verify starting support and requires an intermediate higher
grounded landing before reaching the final waypoint. No simulation state or
controls are applied to the live player.

Certification remains bounded to four horizontal blocks, three blocks of total
rise and 48 movement ticks per candidate. Unknown collision, an unsupported
start, a direct two-block wall, water/lava or a fall do not establish this
exception. Dig/place-dependent geometry, server protection and continuous fall
braking keep their existing checks.

The regression runs the real controller and physics on Java 1.21.1 and the
explicit 1.20.6 compatibility case. A known two-step fixture reaches the same
measured final feet position with the guard enabled and disabled, without
digging or placing. Separate negative cases preserve wall, support and unknown
collision rejection and verify the simulation does not mutate the player.
This fixture establishes the failure class; it does not reconstruct an entire
live dungeon, prove a particular waypoint was compressed there, or demonstrate
that an unloaded package has improved live navigation.

The main-branch integration uses version `0.5.7-rc.138` because it also includes
the already merged plan-review/text-reading fixes. The independently loaded
`0.5.7-rc.137` Cormy artifact keeps its original bytes and version; merging this
source does not migrate a running consumer or establish a new live outcome.

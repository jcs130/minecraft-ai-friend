# Dungeon approach and first-room guidance

## Observed failure

The `creeping_crypt` travel action succeeded at the exterior approach near
`world 1096,66,232`. A later start returned `walk_to_first_room`; its configured
first-room center is `1159,45,209`. The client attempted direct routes through
protected blocks around `1151,57,201..204`. Protection help then directed it to
`/mycli dungeon layout`, an action the command parser does not support.

The human travel receipt also claimed arrival at the entrance, while the
guidance remained `TRAVEL_TO_DUNGEON` because its area test included only the
underground encounter. Together these receipts encouraged repeated travel
and unsupported discovery commands.

## Candidate changes

- Protection receipts link to existing list/info commands and explain that a
  first-room center is not an entrance or proof of a direct path.
- A read-only nearby-area check recognizes the approach and surrounding
  exploration area. It uses the expedition's real approach/center coordinates
  in the actual named world; it does not grant admission or room progress.
- Info distinguishes `arrival.travelDestination` (`approach` versus
  `configured_entry`), unknown surface height, and the legacy `start` field's
  meaning (`first_room_center`). It explicitly does not claim route verification.
- Successful exterior travel reports arrival at the outskirts. Already-nearby
  players are directed to discovery rather than another paid travel command.

No terrain, configured entry coordinates, permissions, equipment requirements,
mana costs, start conditions, or progress ledgers are changed.

## Remaining physical route verification

A read-only capture from the existing client viewer at 19:51 on 2026-11-07
contained 90 loaded 1.21.1 chunk columns. It showed the interior slab staircase
around `1164,*,229`, rising from approximately y45 to y88. The exterior approach
is near y66. The client can find a non-digging route to the northern ridge near
`1156,93,222` in that capture, but an isolated run of the installed
mineflayer-pathfinder 2.4.5 did not find a non-digging route into the tower or
first room, including tests of drop limits 3 through 8.

This is not proof that the building is globally unreachable: the sample is
bounded to loaded columns; the search is not a full physics execution, and it
does not cover every manual maneuver. It is evidence that repeated ordinary
goto calls are not a verified solution. Inspect the actual exterior entrance,
terrain intersection, and connection to the inner staircase before supplying
waypoints or changing the entrance configuration.

`paper/probe/dungeon-routes-stage.mjs` begins its creeping-crypt route test by
teleporting to the first room. That test does not cover the missing
approach-to-first-room leg. Add that leg to isolated server acceptance after
the real route is established. Do not use a direct teleport as proof that
ordinary walking through the entrance works.

## Validation and release boundary

Java 21 standalone tests cover advice, arrival data and protection guidance;
the original advice fails the new already-at-approach regression. Full server
compilation and an isolated real entrance traversal are still required.
This is a source candidate, not an installed server change. No live server
restart or terrain edit was performed by this work.

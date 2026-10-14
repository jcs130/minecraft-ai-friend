# Ground navigation and fall safety

Version 0.4.3 fixes a failure observed during an ordinary vanilla 1.21.1 survival
run: a player navigated toward a lower coal deposit, fell about 22 blocks and lost
its inventory. The server's actual death message was `fell from a high place`.
The reflex diagnostic explicitly exempted the deep fall because its goal Y was lower.

The final executable waypoint check now rejects a dry drop greater than three
blocks. A lower destination remains reachable through a staircase: the check
applies to each executable edge, not the total descent. Received water and
climbing conditions have their own movement envelope. Future construction and
unknown chunks are not presented as certified geometry.

The bridge also checks the actual control selected after each pathfinder tick.
It clones `PlayerState` and uses the installed `prismarine-physics` engine with
the body's received block shapes for up to 12 ticks. It never applies this
predicted state. A predicted damaging dry fall cancels this navigation goal and
briefly brakes with sneak; the current action receives a geometry failure and
the planner can choose another route. Prediction stops at the current waypoint
so it does not assume continued forward motion through a future turn. Unknown
collision data does not become air. Vehicles, creative/spectator flight and
unsupported effect-assisted movement are outside this ground check.

An observed deep fall now stops the current task regardless of goal Y. Stopping
an already falling body cannot reverse gravity; prevention is the earlier
control/waypoint check. This is not a claim that every server impulse, moving
platform, modded movement or route is safe.

Regression tests exercise the actual physics/control loop over a 22-block cliff,
continued flat travel and a two-block descent, waypoint staircase/water cases,
and the real reflex branch with a lower goal. Before the fix, three of these four
new tests failed. Offline tests do not prove sustained live survival.

<!-- Owner: core/dependency-patches.ts -->

# Pinned dependency corrections

The engine loads the dependency patch module before Mineflayer and its plugins.
Each source edit requires one exact match in the pinned dependency. A different
dependency source fails loading instead of silently retaining an obsolete patch.

Partial A* paths now copy their executable nodes and action arrays before
waypoint post-processing. The pinned search previously returned its live
frontier nodes: centering a partial water waypoint could change an integer
search coordinate into a half-block coordinate, making the next compute slice
return `noPath` on a reachable route. The real water-pool regression forces
multiple compute slices and verifies both arrival planning and an intact frontier.

Mineflayer-pathfinder 2.4.5 can find known support with an unloaded cell above
it. Its missing-block sentinel has no position. Landing discovery returns no
candidate for that cell, so drop-node generation cannot crash while reading
its coordinates. Loaded landings and the configured maximum drop remain intact.
`tests/landing-block-boundary.test.ts` covers both sides of the boundary on
Java 1.21.1 and 1.20.6 using the real pinned dependency.

Hosts retaining their own Mineflayer body may preload the public
`agent-mc-world/dependency-patches` entry before importing the pinned plugins.
It creates no body, connects to no server and installs at most once per process.
The host must continue using the dependency versions validated by this package.

Mineflayer 4.37.1 acknowledges End exit `win_game` packets with either credit
state, using `payload: 0` or `actionId: 0` according to the connection's
`respawnIsPayload` feature. Without this acknowledgement, a player who has
already seen the credits can remain in the exit portal. Other game-state
changes do not send a respawn command.

This correction follows the MIT-licensed upstream Cortico change
[`8bdab10`](https://github.com/Pal-AI-Lab/Cortico/commit/8bdab10).
`tests/win-game-ack.test.ts` exercises the real pinned game plugin for Java
1.21.1, 1.20.6 and the older payload codec. A command acknowledgement does not
establish a completed dimension transfer; that still requires fresh world state.

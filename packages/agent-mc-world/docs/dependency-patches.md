<!-- Owner: core/dependency-patches.ts -->

# Pinned dependency corrections

The engine loads the dependency patch module before Mineflayer and its plugins.
Each source edit requires one exact match in the pinned dependency. A different
dependency source fails loading instead of silently retaining an obsolete patch.

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

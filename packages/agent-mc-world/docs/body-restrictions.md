# Explicit body restrictions

Optional server adapters can call the protected `MinecraftWorld.setBodyInhibited(reason)` hook after observing an authoritative inability to act. Pass `null` only after confirmed recovery. The core does not infer this state from low health, no movement or failed navigation, and has no server-specific message parser.

While restricted, the executor retains its queued work and resumable checkpoint under a separate hold. Combat ends with `reason: "inhibited"`, movement is released, and automatic survival actions relinquish control. Read-only observation and the host model remain available. Native methods receive cancellation; a cancelled method is not silently replayed. The current restriction is included in request facts and `mc.state().bodyRestriction`.

Recovery releases only the matching external hold. Environmental holds remain independent. Explicit stop, death, disconnect or shutdown invalidate old tokens, so a later recovery cannot resurrect cancelled work. A new connection discards the prior restriction. Server rescue timers are not automatic recovery deadlines.

The adapter owns protocol validation, player identity and recovery evidence. It must also exclude inhibited states from its spell and fast-decision actions. This hook does not change host pause/activation or reconnect the game.

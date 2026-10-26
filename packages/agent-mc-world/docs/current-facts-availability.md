# Current facts while observation is unavailable

`MinecraftWorld.requestFacts()` provides a self-contained unavailable-state reading when Mineflayer is disconnected or its current body snapshot cannot be sampled. It preserves `snapshotTypes` for the world, queue and task-progress streams, so request projection can replace their old deltas without replaying the whole historical chain.

The `availability` part reports the reason, observation time, connection readiness and `currentWorldVerified: false`. Position, dimension, health, inventory, nearby entities and body progress are explicitly unknown. Unknown does not mean an empty inventory, no task or a completed task. No `decision`, `decisionStability`, `options` or `experience` payload is supplied in this state.

Local goals and the last attributed terminal outcome remain readable. Their presence does not verify current game state. The event ledger remains unchanged and is the source for historical investigation. After reconnection, the next successful sample replaces the unavailable reading with fresh facts. Hosts must still handle `null` for an unavailable child process or other backend that cannot provide any reading.

This contract is shared by direct World consumers, SDK facts and MCP `agent-mc/v1` facts. It neither reconnects the server nor replays actions.

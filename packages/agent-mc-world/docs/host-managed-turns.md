# Host-owned decision turns

An embedding host that calls `beginTurn`, `endTurn` and `acknowledgeBarrier` owns those lifecycle boundaries. Configure its model-facing MCP server with `turnOwnership: 'host'`, and obtain its environment text using `runtime.environment({ turnOwnership: 'host' })`.

The MCP catalogue and full tool-help schema omit those three operations. Execution also refuses them with `HOST_MANAGED_TURN`, without opening, closing, acknowledging or replaying anything. The error does not identify an invented turn as the active one. SDK lifecycle methods remain available to the host; ordinary game operations, reads, cancellation and receipt identities retain their existing contracts.

Standalone MCP defaults to `turnOwnership: 'caller'` and keeps explicit lifecycle operations. Do not use a model-generated ID to repair an embedding host's turn. A host maps its own durable terminal boundary to the matching SDK turn and retains pending-call and barrier checks.

The host adapter must also enforce its advertised operation subset when consuming an older core. A rejected lifecycle operation may end the current model decision through the host's normal yield mechanism. It must not cancel useful body work, close the long-term goal or restart the runtime.

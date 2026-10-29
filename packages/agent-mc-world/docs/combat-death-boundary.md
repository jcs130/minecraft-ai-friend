# Death is a combat terminal boundary

The native death event ends a combat observation once. Automatic watch, delayed damage and fast-decision admission cannot start a fight or retreat on a body with zero health or a pending respawn. Positive health alone does not override an explicit pending death lifecycle.

Each session is bound to its starting death episode. A later episode invalidates the old fight even when native event delivery was missed and the current body has already respawned. Its new position, restored health and missing old enemies cannot establish a successful escape. Old movement samples are not extended across that boundary.

The terminal observation remains `reason: death`, keeps the originating counters and native death episode when available, and records terminal health as zero. The death boundary does not resume suspended old tasks. New combat is allowed after the native lifecycle is alive again. Missing body data and connection loss retain their separate unknown/`gone` semantics.

This behavior is part of the common controller used by World, SDK and MCP consumers. It needs no role, server or model-specific configuration. Historical receipts remain in the ledger; this fix does not retroactively relabel saved records.

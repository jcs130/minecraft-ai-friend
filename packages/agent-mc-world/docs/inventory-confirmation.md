# Inventory confirmation and split server updates

The shared Mineflayer executor confirms one inventory click from server packets,
not from Mineflayer's optimistic local window. SDK, MCP and World adapters use the
same barrier.

A complete `window_items` frame can precede its final `set_slot` cursor or slot
update. Recheck the accumulated authoritative frame after those updates. The
frame must belong to the current window instance, have arrived after dispatch,
and match every predicted changed slot and the cursor. An old complete frame,
an unrelated window, or a different stack/count cannot confirm the click.

This reconciliation sends no additional click and starts no reconnect. Once the
operation has timed out, it remains an unknown result; the existing fresh full
snapshot recovery applies. Do not replay the previous transfer or crafting
operation because a later inventory read becomes available.

Inventory uncertainty pauses item changes. Read-only observation, conversation,
and safe movement that needs no item use remain possible. A disconnected body
still requires a new connection and fresh observations before any action.

Regression coverage uses the pinned native Mineflayer inventory plugin and
1.21.1 packets, including delayed cursor/slot completion and stale or mismatched
frames. This establishes the protocol failure mode; it does not identify an
unrecorded live packet sequence or prove improved gameplay after deployment.

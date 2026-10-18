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

## Occupied offhand replacement

Modern player-inventory offhand equipment uses ordinary number-key swaps
(`window_click` mode 2, button 0–8), rather than holding the requested item on the
mouse cursor while replacing an occupied offhand. A hotbar source needs one
confirmed exchange. A source in main inventory uses an unselected hotbar slot
for two confirmed exchanges. The previous hotbar item stays in the original
source slot and the displaced offhand stays in the hotbar. Both items remain
available; a full inventory needs no extra space, discard, name filter or
server-specific rule. The selected hotbar slot is preserved. Other equipment
and legacy paths retain their existing contract.

After the requested offhand and empty cursor have been server-confirmed, the
equipment operation is done. Do not send a third click to restore a preferred
inventory layout: the live 2026-10-18 task reached the requested shield at
13:55:32.553, then an unnecessary restoration produced mismatched slots and a
false overall failure/quarantine. The original failed task remains failed in
the audit; later state recovery does not rewrite that history.

Each exchange still requires the actual server slots and cursor to match. A
denied exchange stops the sequence without retry, cursor pickup or reporting
success. The latest known source slot may have changed if an earlier exchange
succeeded, so query actual inventory before deciding another operation. Existing
unknown-outcome recovery remains in force; this does not bypass server rules.

Timeout diagnostics distinguish a missing post-dispatch full snapshot from an
already received snapshot with mismatched slots or cursor. Both preserve the
failed operation and its evidence; a later recovery does not promote it to a
successful equip.

`equipment-offhand-native.test.ts` uses the actual pinned Mineflayer inventory
plugin on 1.20.6 and 1.21.1, including named item data, full inventories, retained
items and selected hotbar, rejection and no replay. Its simulated server reproduces the
cursor-swap failure mode; production acceptance requires a separate live equip
and fresh post-operation inventory read.

Protocol implementation reference:
[PrismarineJS window click handling](https://github.com/PrismarineJS/prismarine-windows/blob/master/lib/Window.js).

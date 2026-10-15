'use strict'

// MC 1.21.1 ServerGamePacketListenerImpl.handleContainerClick computes clicked()
// from the server's actual menu, then uses changedSlots/carriedItem only as
// client prediction for remote-state synchronization. Stock Mineflayer may
// recreate split stacks without their native-component tokens. For the opt-in
// vanilla Agent path, discard those predictions and let broadcastChanges send
// the actual native result. Keep window/state/slot/button/mode unchanged; all
// permission, validity and item-consumption checks still run on the server.
// This never guesses a native item ID from a many-to-one display item.
function authoritativeWindowClick (packet) {
  return { ...packet, changedSlots: [], cursorItem: { itemCount: 0 } }
}

module.exports = { authoritativeWindowClick }

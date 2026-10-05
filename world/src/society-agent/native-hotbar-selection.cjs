'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isSlot = value => Number.isInteger(value) && value >= 0 && value <= 8

// A local quickBarSlot is an outbound intention, not a server acknowledgement.
// The bridge publishes changed menus every five ticks (~250 ms at 20 TPS), so
// wait for actual same-player state/receipt or a clientbound selected-slot packet.
async function selectNativeHotbar ({ menu, client, expectedUuid, slot, sendSelection,
  check = () => {}, signal, timeoutMs = 5000 }) {
  if (!menu?.events || typeof menu.current !== 'function' || !client?.on || !client?.off ||
      !UUID.test(expectedUuid || '') || !isSlot(slot) || typeof sendSelection !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('HOTBAR_SELECTION_CONFIG_INVALID')
  const uuid = expectedUuid.toLowerCase()
  const bound = () => client.uuid?.toLowerCase() === uuid
  const validState = state => state?.playerUuid?.toLowerCase() === uuid && isSlot(state.selectedHotbarSlot)
  check()
  const before = menu.current()
  if (!bound() || !validState(before)) return { ok: false, code: 'hotbar_state_unavailable', requestedHotbarSlot: slot,
    outcome: 'known_rejection', outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
  let lastObservedHotbarSlot = before.selectedHotbarSlot
  return new Promise((resolve, reject) => {
    let finished = false, timer
    const clear = () => {
      clearTimeout(timer)
      menu.events.off('state', onState); menu.events.off('receipt', onReceipt)
      client.off('held_item_slot', onHeld); client.off('end', onEnd)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (value, error) => {
      if (finished) return
      finished = true; clear()
      if (error) reject(error)
      else resolve(value)
    }
    const unconfirmed = code => ({ ok: false, code, requestedHotbarSlot: slot, lastObservedHotbarSlot,
      outcome: 'unknown', outcomeKnown: false, outcomeUnknown: true, effectVerified: false, retryAutomatically: false })
    const currentContext = () => {
      try { check() } catch (error) { finish(null, error); return false }
      if (!bound()) { finish(unconfirmed('hotbar_connection_identity_changed')); return false }
      return !finished
    }
    const confirmed = (selectedHotbarSlot, proofSource, code = 'hotbar_selection_confirmed') => finish({ ok: true, code,
      requestedHotbarSlot: slot, selectedHotbarSlot, proofSource, outcome: 'known_observation', outcomeKnown: true,
      outcomeUnknown: false, effectVerified: true, retryAutomatically: false })
    const observe = (state, proofSource) => {
      if (!currentContext() || !validState(state)) return
      lastObservedHotbarSlot = state.selectedHotbarSlot
      if (lastObservedHotbarSlot === slot) confirmed(slot, proofSource)
    }
    const onState = state => observe(state, 'native_menu_state')
    const onReceipt = receipt => observe(receipt?.state, 'native_menu_action_receipt')
    // This event is emitted by this actual connection only. slot is the locked
    // 1.21.1 clientbound field; slotId belongs to the outbound packet, not proof.
    const onHeld = packet => {
      if (!currentContext() || !isSlot(packet?.slot)) return
      lastObservedHotbarSlot = packet.slot
      if (packet.slot === slot) confirmed(slot, 'clientbound_held_item_slot')
    }
    const onEnd = () => finish(unconfirmed('hotbar_connection_closed'))
    const onAbort = () => {
      try { check() } catch (error) { finish(null, error); return }
      finish(unconfirmed('hotbar_selection_aborted'))
    }
    menu.events.on('state', onState); menu.events.on('receipt', onReceipt)
    client.on('held_item_slot', onHeld); client.on('end', onEnd)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    timer = setTimeout(() => {
      if (currentContext()) finish(unconfirmed('hotbar_selection_not_confirmed'))
    }, timeoutMs)
    if (!currentContext()) return
    try {
      // At most one selection submission. The caller also updates Mineflayer's
      // own hand tracking, but that local field never supplies confirmation.
      sendSelection(slot)
      if (!currentContext()) return
      if (before.selectedHotbarSlot === slot) confirmed(slot, 'native_menu_already_selected', 'hotbar_already_selected')
    } catch {
      finish(unconfirmed('hotbar_selection_dispatch_unverified'))
    }
  })
}
module.exports = { selectNativeHotbar }

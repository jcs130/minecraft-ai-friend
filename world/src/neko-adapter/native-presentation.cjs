'use strict'
// Read-only observations on the SAME SDK/player connection. This observer never
// opens a menu, clicks a slot, selects a recipe or casts a spell.
function attachNativeModPresentation (bot, sdk, { now = Date.now, intervalMs = 2000,
  setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw Error('NATIVE_PRESENTATION_INTERVAL_INVALID')
  let closed = false, epoch = 0, busy = false, spellCatalog = null, spellObservedAt = null
  let curiosReceipt = null, domumState = null, modObservedAt = null, lastPoll = -Infinity, menuKey = null
  const errors = [], subscriptions = []
  const identity = () => bot._client?.uuid?.toLowerCase()
  const own = value => typeof value?.playerUuid === 'string' && value.playerUuid.toLowerCase() === identity()
  function listen (emitter, name, fn) { emitter.on(name, fn); subscriptions.push(() => emitter.off(name, fn)) }
  function reset () {
    epoch++; spellCatalog = null; spellObservedAt = null; curiosReceipt = null; domumState = null; modObservedAt = null; menuKey = null; lastPoll = -Infinity
  }
  listen(sdk.spell.events, 'receipt', receipt => {
    if (closed || !own(receipt)) return
    if (receipt.stateUnavailable || receipt.outcomeKnown === false) { spellCatalog = null; spellObservedAt = null; return }
    if (own(receipt.state)) spellObservedAt = now()
    if (receipt.action === 'list' && receipt.ok === true && own(receipt.state)) spellCatalog = structuredClone(receipt)
  })
  listen(sdk.mods.events, 'receipt', receipt => {
    if (closed || !own(receipt) || !['curios_state', 'curios_open', 'curios_page'].includes(receipt.action)) return
    curiosReceipt = receipt.ok === true ? { ...structuredClone(receipt), action: 'curios_state' } : null
    modObservedAt = now()
  })
  listen(sdk.domum.events, 'receipt', receipt => {
    if (closed || !own(receipt)) return
    domumState = receipt.ok === true && own(receipt.state) ? structuredClone(receipt.state) : null; modObservedAt = now()
  })
  async function poll () {
    if (closed || busy || !identity() || now() - lastPoll < 1000 || sdk.callStatus?.().inFlightMutation) return
    busy = true; lastPoll = now(); const observedEpoch = epoch
    try {
      const menu = sdk.menu.current()
      const reads = [sdk.spell.list()]
      if (menu?.menuType === 'curios:curios_container') reads.push(sdk.mods.curios.state())
      else curiosReceipt = null
      if (menu?.menuType?.startsWith('domum_ornamentum:')) reads.push(sdk.domum.state())
      else domumState = null
      const results = await Promise.allSettled(reads)
      if (!closed && epoch === observedEpoch) for (const result of results) if (result.status === 'rejected') {
        errors.push({ at: now(), code: String(result.reason?.code || result.reason?.message || 'native_read_failed').slice(0,128) })
        if (errors.length > 8) errors.shift()
      }
    } catch (error) {
      errors.push({ at: now(), code: String(error.code || error.message).slice(0, 128) })
      if (errors.length > 8) errors.shift()
    } finally { busy = false }
  }
  listen(sdk.menu.events, 'state', menu => {
    const key = `${menu.windowId}:${menu.stateId}`
    if (key === menuKey) return
    menuKey = key
    // Previously observed details remain usable only if the presentation
    // builder can match this exact window/state. An interval refresh follows.
    void poll()
  })
  listen(bot, 'spawn', reset); listen(bot, 'respawn', reset)
  const timer = setTimer(() => void poll(), intervalMs)
  function close () { if (closed) return; closed = true; reset(); clearTimer(timer); for (const off of subscriptions) off() }
  listen(bot, 'end', close)
  return { poll, current: () => ({ spellState: closed ? null : sdk.spell.current(), spellCatalog: structuredClone(spellCatalog), spellObservedAt,
    curiosReceipt: structuredClone(curiosReceipt), domumState: structuredClone(domumState), modObservedAt }),
  status: () => ({ readOnly: true, closed, busy, intervalMs, errors: structuredClone(errors) }), close }
}
module.exports = { attachNativeModPresentation }

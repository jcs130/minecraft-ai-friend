'use strict'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A small cached read-only recipe page makes real installed recipe types
// discoverable. It never selects a recipe, crafts, or submits a model task.
function createNativeRecipeDiscovery (query, { now = Date.now, intervalMs = 30000 } = {}) {
  if (typeof query?.recipes !== 'function' || !Number.isInteger(intervalMs) || intervalMs < 30000) throw Error('RECIPE_DISCOVERY_CONFIG_INVALID')
  let cached = null, inFlight = null
  async function get (playerUuid, epoch) {
    if (typeof playerUuid !== 'string' || !UUID.test(playerUuid) || !Number.isSafeInteger(epoch) || epoch < 0) throw Error('RECIPE_DISCOVERY_IDENTITY_INVALID')
    const uuid = playerUuid.toLowerCase(), at = now()
    if (cached?.uuid === uuid && cached.epoch === epoch && at >= cached.at && at - cached.at < intervalMs) return structuredClone(cached.value)
    if (inFlight?.uuid === uuid && inFlight.epoch === epoch) return structuredClone(await inFlight.promise)
    const token = { uuid, epoch }
    token.promise = (async () => {
      const receipt = await query.recipes({ limit: 1 })
      const bound = typeof receipt?.playerUuid === 'string' && receipt.playerUuid.toLowerCase() === uuid
      const value = bound ? { ...receipt, available: receipt.ok === true, observedAt: new Date(now()).toISOString(), observationEpoch: epoch,
        discovery: 'first_native_recipe_page', definitionBoundary: 'definitionAvailable_false_is_not_an_executable_recipe' } :
        { available: false, code: 'same_player_recipe_discovery_unavailable', playerUuid: uuid, observedAt: new Date(now()).toISOString(), observationEpoch: epoch }
      // An older identity/epoch's delayed read cannot overwrite the new cache.
      if (inFlight === token) cached = { uuid, epoch, at: now(), value }
      return value
    })()
    inFlight = token
    try { return structuredClone(await token.promise) } finally { if (inFlight === token) inFlight = null }
  }
  return { get }
}
module.exports = { createNativeRecipeDiscovery }

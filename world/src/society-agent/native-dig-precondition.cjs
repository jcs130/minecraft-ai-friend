'use strict'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const position = value => value && ['x', 'y', 'z'].every(key => Number.isInteger(value[key]) && Math.abs(value[key]) <= 29999984)
const same = (a, b) => position(a) && position(b) && ['x', 'y', 'z'].every(key => a[key] === b[key])
function nativeDigPrecondition (receipt, { playerUuid, requestedPosition, expectedId, requireDrops = false }) {
  const reject = code => ({ ok: false, code, requestedPosition, expectedId: expectedId ?? null,
    readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
  if (!UUID.test(playerUuid || '') || receipt?.schemaVersion !== 1 || receipt.kind !== 'world_receipt' ||
      typeof receipt.playerUuid !== 'string' || receipt.playerUuid.toLowerCase() !== playerUuid.toLowerCase() || !position(requestedPosition)) return reject('same_player_dig_precondition_unavailable')
  // lookAtBlock preserves the real server clip and labels only the mismatch.
  // Reveal that first visible block, never guess an intervening voxel from
  // client chunk availability or substitute it as an automatic dig target.
  if (receipt.ok === false && receipt.code === 'different_visible_block' && position(receipt.position) && !same(receipt.position, requestedPosition) &&
      same(receipt.expectedPosition, requestedPosition) && ID.test(receipt.block?.id || '') && Number.isInteger(receipt.hit?.face) &&
      receipt.hit.face >= 0 && receipt.hit.face <= 5 && ['x', 'y', 'z'].every(key => Number.isFinite(receipt.hit.cursor?.[key]) && receipt.hit.cursor[key] >= 0 && receipt.hit.cursor[key] <= 1)) {
    return { ...reject('different_visible_block'), blocking: { source: 'server_native_first_ray_hit', position: { ...receipt.position },
      id: receipt.block.id, properties: structuredClone(receipt.block.properties ?? {}), hit: structuredClone(receipt.hit) } }
  }
  if (receipt.ok !== true || !same(receipt.position, requestedPosition)) return reject(receipt.code || 'not_visible_or_reachable')
  if (!ID.test(receipt.block?.id || '') || (expectedId && receipt.block.id !== expectedId)) return { ...reject('native_identity_changed'), nativeBlock: receipt.block }
  if (requireDrops && receipt.block.canHarvestWithMainHand !== true) {
    return { ...reject(receipt.block.canHarvestWithMainHand === false ? 'wrong_tool_for_drops' : 'native_harvest_precondition_unavailable'), outcome: 'known_not_applied', blockBroken: false, pickupConfirmed: false,
      nativeBlock: receipt.block, mainHandItemId: receipt.block.mainHandItemId ?? null }
  }
  return { ok: true, requestedPosition, nativeBlock: receipt.block, hit: receipt.hit, readOnly: true }
}
module.exports = { nativeDigPrecondition }

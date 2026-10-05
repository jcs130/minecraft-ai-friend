'use strict'

// This is the actual server ray hit from the same player's current view.
// The requested aim point is not a substitute for the face/hit location.
function nativeBlockInteractionPacket (receipt, { playerUuid, position, sequence }) {
  const reject = code => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
  if (typeof playerUuid !== 'string' || typeof receipt?.playerUuid !== 'string' ||
      receipt.playerUuid.toLowerCase() !== playerUuid.toLowerCase() || receipt.ok !== true ||
      receipt.schemaVersion !== 1 || receipt.kind !== 'world_receipt') return reject('native_block_hit_player_mismatch')
  if (!position || !['x', 'y', 'z'].every(key => Number.isInteger(position[key]) && receipt.position?.[key] === position[key]) ||
      !Number.isInteger(sequence) || sequence < 1 || sequence > 2147483647) return reject('native_block_hit_position_mismatch')
  const hit = receipt.hit
  if (!Number.isInteger(hit?.face) || hit.face < 0 || hit.face > 5 || !hit.cursor ||
      !['x', 'y', 'z'].every(key => Number.isFinite(hit.cursor[key]) && hit.cursor[key] >= -1e-6 && hit.cursor[key] <= 1 + 1e-6)) {
    return reject('native_block_hit_unavailable')
  }
  return { ok: true, source: 'server_native_ray_hit', packet: { location: { ...position }, direction: hit.face, hand: 0,
    cursorX: hit.cursor.x, cursorY: hit.cursor.y, cursorZ: hit.cursor.z, insideBlock: false, sequence } }
}
// Only for the precondition read, before a block mutation was submitted.
// A late/missing read is not evidence of an unknown inventory/world mutation.
async function readNativeBlockBeforeAction (query, block, offset, check) {
  try { const receipt = await query.lookAtBlock(block, offset); check(); return receipt }
  catch (error) {
    check() // maintenance/death/deadline must remain an interrupted action
    if (/^WORLD_QUERY_TIMEOUT\b/.test(error.message)) return { ok: false, code: 'native_block_query_not_observed', readOnly: true,
      outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
    throw error
  }
}
module.exports = { nativeBlockInteractionPacket, readNativeBlockBeforeAction }

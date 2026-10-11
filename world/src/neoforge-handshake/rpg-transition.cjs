'use strict'

// Only these native operations deliberately transfer the SAME living body.
// Disconnects and deaths still invalidate every action; arbitrary commands do
// not gain a respawn exemption. A native receipt must confirm the destination.
const ids = new Set(['arena.lobby', 'arena.resume', 'arena.leave', 'arena.start'])
const kinds = new Set(['rpg_arena_lobby', 'rpg_arena_resume', 'rpg_arena_leave', 'rpg_arena_start'])
const expectedOperation = id => ids.has(id)
const expectedKind = kind => kinds.has(kind)
const confirmed = (id, receipt, uuid) => expectedOperation(id) && receipt?.ok === true &&
  receipt.playerUuid?.toLowerCase() === uuid && receipt.actorDimension === 'maw:trials' &&
  receipt.actorAlive === true && receipt.outcomeKnown !== false
module.exports = { expectedOperation, expectedKind, confirmed }

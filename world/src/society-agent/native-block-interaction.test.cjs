'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeBlockInteractionPacket, readNativeBlockBeforeAction } = require('./native-block-interaction.cjs')
const playerUuid = '11111111-2222-3333-8444-555555555555', position = { x: -432, y: 64, z: 400 }
const receipt = () => ({ schemaVersion: 1, kind: 'world_receipt', ok: true, playerUuid, position,
  block: { id: 'farmersdelight:cutting_board' }, hit: { face: 4, cursor: { x: 0.0625, y: 0.03125, z: 0.6 } } })
test('thin board use sends the actual native side and ray cursor rather than UP or requested aim point', () => {
  const hit = receipt(), result = nativeBlockInteractionPacket(hit, { playerUuid, position, sequence: 17 })
  assert.equal(result.ok, true); assert.equal(result.packet.direction, 4)
  assert.equal(result.packet.cursorY, 0.03125); assert.equal(result.packet.cursorX, 0.0625)
  assert.equal(result.packet.sequence, 17); assert.equal(result.packet.hand, 0)
  assert.deepEqual(result.packet.location, position)
  result.packet.location.x = 0; assert.equal(hit.position.x, -432)
})
test('missing/foreign/different-position/invalid native hits reject before a game packet can be dispatched', () => {
  for (const change of [hit => { delete hit.hit }, hit => { hit.hit.face = 6 }, hit => { hit.hit.cursor.y = NaN },
    hit => { hit.hit.cursor.y = 2 }, hit => { hit.playerUuid = 'aaaaaaaa-2222-3333-8444-555555555555' },
    hit => { hit.position = { ...position, x: 5 } }, hit => { hit.ok = false }]) {
    const hit = receipt(); change(hit)
    const result = nativeBlockInteractionPacket(hit, { playerUuid, position, sequence: 1 })
    assert.equal(result.ok, false); assert.equal(result.packet, undefined)
    assert.equal(result.outcomeKnown, true); assert.equal(result.retryAutomatically, false)
  }
})
test('all six native faces and tiny roundoff hit positions are preserved without clamping or invented geometry', () => {
  for (let face = 0; face <= 5; face++) {
    const hit = receipt(); hit.hit.face = face; hit.hit.cursor.x = -1e-15
    assert.equal(nativeBlockInteractionPacket(hit, { playerUuid, position, sequence: 1 }).packet.cursorX, -1e-15)
  }
})
test('a missing precondition-only read is known unavailability and never replayed or confused with a failed block mutation', async () => {
  let calls = 0
  const query = { lookAtBlock: async () => { calls++; throw Error('WORLD_QUERY_TIMEOUT private-request-id') } }
  const result = await readNativeBlockBeforeAction(query, {}, [0.5, 0.03, 0.5], () => {})
  assert.equal(result.outcomeKnown, true); assert.equal(result.outcomeUnknown, false)
  assert.equal(result.code, 'native_block_query_not_observed'); assert.equal(result.retryAutomatically, false); assert.equal(calls, 1)
})
test('a precondition read never swallows a maintenance/death/deadline context change or unrelated transport failure', async () => {
  const query = { lookAtBlock: async () => { throw Error('WORLD_QUERY_TIMEOUT private-request-id') } }
  await assert.rejects(readNativeBlockBeforeAction(query, {}, [], () => { throw Error('ACTION_CONTEXT_CHANGED') }), /ACTION_CONTEXT_CHANGED/)
  await assert.rejects(readNativeBlockBeforeAction({ lookAtBlock: async () => { throw Error('WORLD_CONNECTION_CLOSED') } }, {}, [], () => {}), /WORLD_CONNECTION_CLOSED/)
})

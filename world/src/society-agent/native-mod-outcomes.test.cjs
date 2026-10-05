'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { verifyMaidOutcome, verifyEntityInteraction } = require('./native-mod-outcomes.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', maidUuid = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
test('TLM follow/pickup/task are verified against real same-owner post-state, not just an ok acknowledgement', () => {
  for (const [operation, key, expected] of [['follow', 'follow', true], ['pickup', 'pickup', false], ['task', 'taskId', 'touhou_little_maid:farm']]) {
    const action = { operation, maidUuid, args: { [key]: expected } }, receipt = { playerUuid: uuid, ok: true, code: `${operation}_set`, outcome: 'applied',
      maid: { uuid: maidUuid, ownerUuid: uuid, owned: true, [key]: expected } }
    assert.equal(verifyMaidOutcome(action, receipt, uuid).effectVerified, true)
    assert.equal(verifyMaidOutcome(action, { ...receipt, maid: { ...receipt.maid, [key]: 'different' } }, uuid).ok, false)
    assert.equal(verifyMaidOutcome(action, { ...receipt, maid: null }, uuid).outcomeUnknown, true)
    assert.equal(verifyMaidOutcome(action, { ...receipt, playerUuid: maidUuid }, uuid).outcomeUnknown, true)
  }
})
test('a real container opening or observed tame/owner change is distinguished from sent-only entity interaction', () => {
  const before = { playerUuid: uuid, windowId: 0 }, after = { playerUuid: uuid, windowId: 4, menuType: 'minecraft:merchant' }
  assert.equal(verifyEntityInteraction(before, after, null, null, uuid).menuOpened, true)
  assert.equal(verifyEntityInteraction(before, { ...after, playerUuid: maidUuid }, null, null, uuid).effectVerified, false)
  const a = { playerUuid: uuid, ok: true, entity: { uuid: maidUuid, id: 'minecraft:wolf', tamed: false, ownerUuid: null } }
  const b = { ...a, entity: { ...a.entity, tamed: true, ownerUuid: uuid } }
  assert.equal(verifyEntityInteraction(before, before, a, b, uuid).effectVerified, true)
  const unchanged = verifyEntityInteraction(before, before, a, a, uuid)
  assert.equal(unchanged.effectVerified, false); assert.equal(unchanged.retryAutomatically, false)
})

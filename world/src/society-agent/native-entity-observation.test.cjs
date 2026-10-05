'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nearbyNativeEntities, validateNativeEntityTarget, validateNativeAttackTarget } = require('./native-entity-observation.cjs')
const own = 'e371227c-09fa-3722-84f4-f3228a552c3c', other = '010b4174-0000-4000-8000-000000000001'
const self = { uuid: own, entityId: 83, position: { x: -390, y: 68, z: 353 } }
const mob = (id = 'minecraft:zombie', entityId = 4, offset = 1) => ({ entityId, uuid: other, name: id, typeId: 131,
  position: { x: self.position.x + offset, y: 68, z: 353 } })
const snapshot = entities => ({ available: true, source: 'received_native_entity_packets', epoch: 3, entities })
const proxy = entity => ({ id: entity.entityId, uuid: entity.uuid, name: entity.name.slice(10), position: entity.position })
const evidence = (entity, patch = {}) => ({ schemaVersion: 1, kind: 'world_receipt', playerUuid: own, ok: true,
  entity: { entityId: entity.entityId, uuid: entity.uuid, id: entity.name, position: entity.position,
    hostile: entity.name === 'minecraft:zombie', npc: false, tameable: false, tamed: false, ownerKnown: true,
    ownerUuid: null, customName: null, friendlyToPlayer: false, hasLineOfSight: true, inReach: true, interactionReach: true, ...patch } })
test('nearby observation preserves real mod namespaces and absolute positions', () => {
  const value = mob('touhou_little_maid:maid')
  const result = nearbyNativeEntities(snapshot([value]), self)
  assert.equal(result.available, true); assert.equal(result.entities[0].id, 'touhou_little_maid:maid')
  assert.deepEqual(result.entities[0].position, { x: -389, y: 68, z: 353 })
})
test('filters own UUID/entity, out-of-range, sorts nearest and limits to sixteen', () => {
  const entities = Array.from({ length: 30 }, (_, n) => ({ ...mob('minecraft:zombie', n + 100, (29 - n) / 3),
    uuid: `010b4174-0000-4000-8000-${String(n).padStart(12, '0')}` }))
  const result = nearbyNativeEntities(snapshot([...entities, { ...mob(), entityId: 83 }, { ...mob(), entityId: 99, uuid: own }, mob('minecraft:zombie', 80, 13)]), self)
  assert.equal(result.entities.length, 16); assert.equal(result.entities[0].entityId, 129)
  assert.ok(result.entities.every(entity => entity.entityId !== 83 && entity.entityId !== 99 && entity.entityId !== 80))
})
test('missing native registry source and corrupt duplicate snapshot never fall back to proxies', () => {
  assert.equal(nearbyNativeEntities({ available: true, source: 'mineflayer', entities: [mob()] }, self).available, false)
  assert.equal(nearbyNativeEntities(snapshot([mob(), mob()]), self).available, false)
})
test('legal vanilla enemy requires exact native registry ID and matching action UUID', () => {
  const entity = mob(); assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, evidence(entity)).ok, true)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), { ...proxy(entity), uuid: own }, self, evidence(entity)).code, 'native_proxy_identity_mismatch')
})
test('mod zombie proxy, villager, player and unknown entity never pass hostile check', () => {
  for (const id of ['example:zombie', 'minecraft:villager', 'minecraft:player', 'touhou_little_maid:maid']) {
    const entity = mob(id)
    assert.equal(validateNativeAttackTarget(snapshot([entity]), { ...proxy(entity), name: 'zombie' }, self, evidence(entity)).ok, false)
  }
  assert.equal(validateNativeAttackTarget(snapshot([]), proxy(mob()), self).ok, false)
})
test('actual native and action positions must both be within reach', () => {
  const entity = mob()
  assert.equal(validateNativeAttackTarget(snapshot([mob('minecraft:zombie', 4, 4)]), proxy(entity), self, evidence(entity)).ok, false)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), { ...proxy(entity), position: { x: -370, y: 68, z: 353 } }, self, evidence(entity)).ok, false)
})
test('ordinary wild food animals are available for intentional survival hunting, not implicitly hostile', () => {
  for (const id of ['minecraft:cow', 'minecraft:pig', 'minecraft:sheep', 'minecraft:chicken', 'minecraft:rabbit', 'minecraft:salmon']) {
    const entity = mob(id), receipt = evidence(entity)
    assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, receipt).ok, false)
    const result = validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, receipt, { intent: 'hunt_food' })
    assert.equal(result.ok, true); assert.equal(result.attackPurpose, 'hunt_food')
  }
})
test('a real mod Enemy is attackable using native identity, without requiring a vanilla proxy basename', () => {
  const entity = mob('ars_nouveau:wilden_stalker')
  const result = validateNativeAttackTarget(snapshot([entity]), { ...proxy(entity), name: 'zombie' }, self,
    evidence(entity, { hostile: true, customName: 'Elite Wilden' }))
  assert.equal(result.ok, true); assert.equal(result.classificationSource, 'server_native_enemy_interface')
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self).code, 'native_target_evidence_unavailable')
})
test('NPCs, named nonhostiles, pets, owners and allied entities remain protected even with an attack request', () => {
  const cow = mob('minecraft:cow')
  for (const patch of [{ npc: true }, { tamed: true }, { ownerUuid: own }, { friendlyToPlayer: true }, { customName: 'Our Cow' }, { ownerKnown: false }]) {
    assert.equal(validateNativeAttackTarget(snapshot([cow]), proxy(cow), self, evidence(cow, patch), { intent: 'hunt_food' }).ok, false)
  }
  const hostile = mob()
  assert.equal(validateNativeAttackTarget(snapshot([hostile]), proxy(hostile), self, evidence(hostile, { friendlyToPlayer: true })).ok, false)
  const pet = mob('minecraft:wolf')
  assert.equal(validateNativeAttackTarget(snapshot([pet]), proxy(pet), self, evidence(pet, { tameable: true, tamed: true, ownerUuid: own }), { intent: 'hunt_food' }).ok, false)
})
test('server actor, entity UUID, expected native ID and unobstructed reach must all agree', () => {
  const entity = mob(), receipt = evidence(entity)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, { ...receipt, playerUuid: other }).ok, false)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, evidence(entity, { uuid: own })).ok, false)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, receipt, { expectedUuid: own }).code, 'native_target_changed')
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, receipt, { expectedId: 'minecraft:cow' }).code, 'native_target_changed')
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, evidence(entity, { hasLineOfSight: false })).ok, false)
})
test('friendly entity interaction allows NPCs while keeping distinct 4.5-block reach and native identity', () => {
  const entity = mob('minecraft:villager', 4, 4), receipt = evidence(entity, { npc: true, inReach: false })
  assert.equal(validateNativeEntityTarget(snapshot([entity]), proxy(entity), self, receipt, { interaction: true }).ok, true)
  assert.equal(validateNativeAttackTarget(snapshot([entity]), proxy(entity), self, receipt).ok, false)
  assert.equal(validateNativeEntityTarget(snapshot([entity]), proxy(entity), self, evidence(entity, { interactionReach: false }), { interaction: true }).ok, false)
})

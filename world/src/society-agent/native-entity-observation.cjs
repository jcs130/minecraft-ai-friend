'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const FOOD_ANIMALS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom', 'cod', 'salmon', 'tropical_fish']
  .map(name => `minecraft:${name}`))
const finite = position => position && ['x', 'y', 'z'].every(key => Number.isFinite(position[key]))
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
function ownSnapshot (snapshot) {
  if (snapshot?.available !== true || snapshot.source !== 'received_native_entity_packets' || !Array.isArray(snapshot.entities)) return false
  return snapshot.entities.length <= 4096
}
function summary (entity) {
  if (!Number.isSafeInteger(entity?.entityId) || entity.entityId < 0 || !UUID.test(entity.uuid || '') ||
      !ID.test(entity.name || '') || !Number.isSafeInteger(entity.typeId) || entity.typeId < 0 || !finite(entity.position)) return null
  return { entityId: entity.entityId, uuid: entity.uuid.toLowerCase(), id: entity.name, name: entity.name,
    typeId: entity.typeId, position: { ...entity.position } }
}
function nearbyNativeEntities (snapshot, self) {
  const base = { available: false, source: 'received_native_entity_packets', entities: [] }
  if (!ownSnapshot(snapshot) || !finite(self?.position) || !UUID.test(self?.uuid || '') || !Number.isSafeInteger(self?.entityId)) {
    return { ...base, reason: snapshot?.reason || 'NATIVE_ENTITY_OBSERVATION_UNAVAILABLE' }
  }
  const seen = new Set(), values = []
  for (const entity of snapshot.entities) {
    const value = summary(entity)
    if (!value || seen.has(value.entityId)) return { ...base, reason: 'NATIVE_ENTITY_OBSERVATION_INVALID' }
    seen.add(value.entityId)
    if (value.entityId === self.entityId || value.uuid === self.uuid.toLowerCase()) continue
    const d = distance(value.position, self.position)
    if (d <= 12) values.push({ ...value, distance: d })
  }
  values.sort((a, b) => a.distance - b.distance || a.entityId - b.entityId)
  return { ...base, available: true, reason: null, epoch: snapshot.epoch ?? null, registrySha256: snapshot.registrySha256 ?? null,
    entities: values.slice(0, 16) }
}
function validateNativeEntityTarget (snapshot, proxy, self, receipt, { expectedUuid, expectedId, interaction = false } = {}) {
  if (!ownSnapshot(snapshot) || !proxy || !finite(self?.position)) return { ok: false, code: 'native_target_identity_unavailable' }
  const matches = snapshot.entities.filter(entity => entity.entityId === proxy.id)
  const native = matches.length === 1 ? summary(matches[0]) : null
  if (!native) return { ok: false, code: 'native_target_identity_unavailable' }
  if (native.entityId === self.entityId || native.uuid === self.uuid?.toLowerCase()) return { ok: false, code: 'native_target_is_self', nativeEntity: native }
  if ((expectedUuid !== undefined && (typeof expectedUuid !== 'string' || expectedUuid.toLowerCase() !== native.uuid)) || (expectedId !== undefined && expectedId !== native.id)) {
    return { ok: false, code: 'native_target_changed', nativeEntity: native }
  }
  // Actions use this native entityId/UUID. The vanilla-front proxy basename
  // cannot determine a mod entity's allegiance or prevent real mod combat.
  if (proxy.uuid?.toLowerCase() !== native.uuid || !finite(proxy.position)) {
    return { ok: false, code: 'native_proxy_identity_mismatch', nativeEntity: native }
  }
  const entity = receipt?.entity
  if (receipt?.ok !== true || receipt.schemaVersion !== 1 || receipt.kind !== 'world_receipt' ||
      receipt.playerUuid?.toLowerCase() !== self.uuid?.toLowerCase() || entity?.entityId !== native.entityId ||
      entity.uuid?.toLowerCase() !== native.uuid || entity.id !== native.id || !finite(entity.position)) {
    return { ok: false, code: 'native_target_evidence_unavailable', nativeEntity: native }
  }
  const reach = interaction ? 4.5 : 3
  if (entity.hasLineOfSight !== true || entity[interaction ? 'interactionReach' : 'inReach'] !== true ||
      [native.position, proxy.position, entity.position].some(position => distance(position, self.position) > reach)) {
    return { ok: false, code: 'native_target_not_visible_or_reachable', nativeEntity: native }
  }
  return { ok: true, nativeEntity: native, evidence: entity }
}
function validateNativeAttackTarget (snapshot, proxy, self, receipt, options = {}) {
  const target = validateNativeEntityTarget(snapshot, proxy, self, receipt, options)
  if (!target.ok) return target
  const entity = target.evidence
  if (['hostile', 'npc', 'friendlyToPlayer', 'tameable', 'tamed', 'ownerKnown'].some(key => typeof entity[key] !== 'boolean') ||
      entity.ownerKnown !== true || !Object.hasOwn(entity, 'ownerUuid') ||
      !(entity.ownerUuid === null || UUID.test(entity.ownerUuid || '')) ||
      !(entity.customName === null || typeof entity.customName === 'string')) {
    return { ...target, ok: false, code: 'native_target_relationship_unknown' }
  }
  if (entity.npc || entity.friendlyToPlayer || entity.tamed || entity.ownerUuid !== null) {
    return { ...target, ok: false, code: 'native_target_protected_friendly' }
  }
  if (entity.hostile) return { ...target, attackPurpose: 'combat', classificationSource: 'server_native_enemy_interface' }
  if (options.intent === 'hunt_food' && FOOD_ANIMALS.has(target.nativeEntity.id) &&
      entity.tameable === false && (entity.customName === null || entity.customName.trim() === '')) {
    return { ...target, attackPurpose: 'hunt_food', classificationSource: 'native_food_animal_and_server_relationship' }
  }
  return { ...target, ok: false, code: entity.customName ? 'native_target_named_nonhostile' : 'native_target_requires_supported_attack_purpose' }
}
module.exports = { nearbyNativeEntities, validateNativeEntityTarget, validateNativeAttackTarget }

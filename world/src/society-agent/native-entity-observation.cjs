'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const HOSTILES = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'spider', 'cave_spider', 'witch',
  'pillager', 'vindicator', 'creeper', 'endermite', 'silverfish'].map(name => `minecraft:${name}`))
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
function validateNativeAttackTarget (snapshot, proxy, self) {
  if (!ownSnapshot(snapshot) || !proxy || !finite(self?.position)) return { ok: false, code: 'native_target_identity_unavailable' }
  const matches = snapshot.entities.filter(entity => entity.entityId === proxy.id)
  const native = matches.length === 1 ? summary(matches[0]) : null
  if (!native) return { ok: false, code: 'native_target_identity_unavailable' }
  if (native.entityId === self.entityId || native.uuid === self.uuid?.toLowerCase() || !HOSTILES.has(native.id)) {
    return { ok: false, code: 'native_target_not_supported_hostile', nativeEntity: native }
  }
  // A mod proxy with a zombie basename must never become a legal enemy. Both
  // exact native ID/UUID and Mineflayer's actual action target must agree.
  if (proxy.uuid?.toLowerCase() !== native.uuid || proxy.name !== native.id.slice(10) || !finite(proxy.position)) {
    return { ok: false, code: 'native_proxy_identity_mismatch', nativeEntity: native }
  }
  if (distance(native.position, self.position) > 3.2 || distance(proxy.position, self.position) > 3.2) {
    return { ok: false, code: 'no_reachable_native_hostile', nativeEntity: native }
  }
  return { ok: true, nativeEntity: native }
}
module.exports = { nearbyNativeEntities, validateNativeAttackTarget }

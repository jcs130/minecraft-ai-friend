// mc-modern-viewer.mts — 现代画面宿主服务（萌悦 modern-viewer 的精裁接入，2026-08-26）
// 参考实现：mengyue-world-platform plugins/minecraft-codex-agent/src/dashboard/secure-viewer.ts（1983 行）
// 裁剪：去掉可信 VRM 清单/画作/交易/宿主头校验/检查射线；保留双 Socket.IO 命名空间数据桥、
//       WorldView 区块流、实体/化身状态/特效序列化、stateId 归一化（NeoForge 注册表与原版的差异兜底）。
// 依赖：socket.io + prismarine-viewer(WorldView) + minecraft-data（容器 /app/node_modules 均已有）。
// 启用：bootstrap-world.mts spawn 后调用 startModernViewer(() => bot.getBot())；MC_MODERN_VIEWER=1。
import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Server: SocketIoServer } = require('socket.io')
const minecraftData = require('minecraft-data')
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSET_ROOT = path.resolve(__dirname, '../modern-viewer') // /app/modern-viewer（Dockerfile COPY）

const MAX_VIEWER_SESSIONS = 4
const AVATAR_STATE_INTERVAL_MS = 100
const MAX_VIEWER_INVENTORY_SLOTS = 46
const MAX_VIEWER_EFFECT_DISTANCE = 96
const MAX_VIEWER_EFFECT_EVENTS_PER_SECOND = 80
const MAX_VIEWER_EFFECT_PARTICLES = 24

// 本服注册表在原版 1.21.1 之后追加过两种矿石状态——名称归一化之外再留实测兜底
const KNOWN_1_21_1_STATE_ID_REMAP = new Map([[26684, 123], [26685, 124]]) // gold_ore / deepslate_gold_ore

const OPTIONAL_TEXTURE_FALLBACK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4nGP4z/D/PzKWkJBAwYTkGYaBAaRqQJcfDgYMfCwMvAEDHwsDbgAAZ/wiH+XmcpcAAAAASUVORK5CYII=',
  'base64',
)

const ENTITY_NAME_ALIASES = {
  minecraft_villager: 'villager', minecraft_zombie: 'zombie',
  villager_v2: 'villager', zombie_villager_v2: 'zombie_villager',
}

// ---------- 小工具（viewer-runtime.js 同源） ----------
function canonicalEntityName(value) {
  if (typeof value !== 'string') return ''
  const canonical = value.trim()
    .replace(/^minecraft:/iu, '')
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .replace(/[\s-]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_|_$/gu, '')
    .toLowerCase()
  return ENTITY_NAME_ALIASES[canonical] ?? canonical
}
function normalizeMinecraftTime(value) {
  if (!Number.isFinite(value)) return 0
  return ((Math.trunc(value) % 24000) + 24000) % 24000
}
function finiteInteger(value, minimum, maximum) {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.max(minimum, Math.min(maximum, Math.trunc(n)))
}
function clampFiniteNumber(value, minimum, maximum, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(minimum, Math.min(maximum, n)) : fallback
}
function viewerVector(value) {
  if (!value || typeof value !== 'object') return undefined
  const v = value
  const x = Number(v.x), y = Number(v.y), z = Number(v.z)
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined
}
function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
function copyFinite(target, source, keys) {
  for (const key of keys) {
    const v = Number(source[key])
    if (Number.isFinite(v)) target[key] = v
  }
}
function copyPrimitive(target, source, keys) {
  for (const key of keys) {
    const v = source[key]
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      target[key] = typeof v === 'string' ? v.slice(0, 256) : v
    }
  }
}
function sanitizeViewerValue(value, depth, seen) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, 1024)
  if (typeof value === 'bigint') return value.toString()
  if (!value || typeof value !== 'object' || depth >= 4) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.slice(0, 64).map((e) => sanitizeViewerValue(e, depth + 1, seen) ?? null)
    if (ArrayBuffer.isView(value)) return undefined
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 48)) {
      const s = sanitizeViewerValue(v, depth + 1, seen)
      if (s !== undefined) out[k.slice(0, 128)] = s
    }
    return out
  } finally { seen.delete(value) }
}

// ---------- 村民外观（固定注册表，来自 metadata） ----------
const VILLAGER_TYPE_KEYS = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
const VILLAGER_PROFESSION_KEYS = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']
const VILLAGER_LEVEL_KEYS = ['none', 'stone', 'iron', 'gold', 'emerald', 'diamond']
const VILLAGER_TYPE_LABELS = ['沙漠', '丛林', '平原', '热带草原', '雪原', '沼泽', '针叶林']
const VILLAGER_PROFESSION_LABELS = ['无职业', '盔甲匠', '屠夫', '制图师', '牧师', '农民', '渔夫', '制箭师', '皮匠', '图书管理员', '石匠', '傻子', '牧羊人', '工具匠', '武器匠']
const VILLAGER_LEVEL_LABELS = ['未交易', '新手', '学徒', '熟练工', '专家', '大师']

function decodeVillagerAppearance(value, depth = 0, seen = new WeakSet()) {
  const data = findVillagerData(value, depth, seen)
  if (!data) return undefined
  const bounded = (v, min, max, fb) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : fb
  }
  const typeId = bounded(data.villagerType, 0, 6, 2)
  const professionId = bounded(data.villagerProfession, 0, 14, 0)
  const levelId = bounded(data.level, 1, 5, 1)
  return {
    typeId, typeKey: VILLAGER_TYPE_KEYS[typeId], typeLabel: VILLAGER_TYPE_LABELS[typeId],
    professionId, professionKey: VILLAGER_PROFESSION_KEYS[professionId], professionLabel: VILLAGER_PROFESSION_LABELS[professionId],
    levelId, levelKey: VILLAGER_LEVEL_KEYS[levelId], levelLabel: VILLAGER_LEVEL_LABELS[levelId],
  }
}
function findVillagerData(value, depth, seen) {
  if (!value || typeof value !== 'object' || depth >= 5 || ArrayBuffer.isView(value)) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 64)) {
        const match = findVillagerData(entry, depth + 1, seen)
        if (match) return match
      }
      return undefined
    }
    const normalized = new Map(Object.entries(value).map(([k, v]) => [k.replaceAll('_', '').toLowerCase(), v]))
    if (normalized.has('villagertype') && normalized.has('villagerprofession') && normalized.has('level')) {
      return {
        villagerType: normalized.get('villagertype'),
        villagerProfession: normalized.get('villagerprofession'),
        level: normalized.get('level'),
      }
    }
    for (const entry of Object.values(value).slice(0, 48)) {
      const match = findVillagerData(entry, depth + 1, seen)
      if (match) return match
    }
    return undefined
  } finally { seen.delete(value) }
}

// ---------- stateId 归一化 + 区块包重映射（NeoForge 注册表 ↔ 原版） ----------
function canonicalRegistryName(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/^minecraft:/u, '').replace(/[^a-z0-9_]/gu, '')
}
function finiteRegistryInteger(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}
function createViewerStateIdNormalizer(bot, version) {
  const runtimeData = bot.registry
  const canonicalData = minecraftData(version) ?? undefined
  const knownRemap = version === '1.21.1' ? KNOWN_1_21_1_STATE_ID_REMAP : undefined
  const cache = new Map()
  return (stateId) => {
    const cached = cache.get(stateId)
    if (cached !== undefined) return cached
    let normalized = stateId
    const runtimeBlock = runtimeData?.blocksByStateId?.[String(stateId)]
    const canonicalAtState = canonicalData?.blocksByStateId?.[String(stateId)]
    const runtimeName = canonicalRegistryName(runtimeBlock?.name)
    const canonicalStateName = canonicalRegistryName(canonicalAtState?.name)
    if (runtimeName && runtimeName !== canonicalStateName) {
      const canonicalBlock = canonicalData?.blocksByName?.[runtimeName]
      if (canonicalBlock) {
        const runtimeMin = finiteRegistryInteger(runtimeBlock?.minStateId)
        const canonicalMin = finiteRegistryInteger(canonicalBlock.minStateId)
        const canonicalMax = finiteRegistryInteger(canonicalBlock.maxStateId)
        if (runtimeMin !== undefined && canonicalMin !== undefined && canonicalMax !== undefined) {
          const candidate = canonicalMin + (stateId - runtimeMin)
          if (candidate >= canonicalMin && candidate <= canonicalMax
            && canonicalRegistryName(canonicalData?.blocksByStateId?.[String(candidate)]?.name) === runtimeName) {
            normalized = candidate
          }
        }
        if (normalized === stateId) {
          const defaultState = finiteRegistryInteger(canonicalBlock.defaultState)
          if (defaultState !== undefined) normalized = defaultState
        }
      }
    }
    if (normalized === stateId) normalized = knownRemap?.get(stateId) ?? stateId
    cache.set(stateId, normalized)
    return normalized
  }
}
function remapSerializedPaletteContainer(value, normalizeStateId) {
  const serialized = typeof value === 'string'
  let parsed = value
  if (serialized) { try { parsed = JSON.parse(value) } catch { return value } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value
  const record = parsed
  let changed = false
  let palette = record.palette
  if (Array.isArray(record.palette)) {
    palette = record.palette.map((entry) => {
      const stateId = Number(entry)
      if (!Number.isInteger(stateId)) return entry
      const normalized = normalizeStateId(stateId)
      if (normalized !== stateId) changed = true
      return normalized
    })
  }
  let singleValue = record.value
  const stateId = Number(record.value)
  if (record.type === 'single' && Number.isInteger(stateId)) {
    singleValue = normalizeStateId(stateId)
    if (singleValue !== stateId) changed = true
  }
  if (!changed) return value
  const remapped = {
    ...record,
    ...(Array.isArray(record.palette) ? { palette } : {}),
    ...(record.type === 'single' && Number.isInteger(stateId) ? { value: singleValue } : {}),
  }
  return serialized ? JSON.stringify(remapped) : remapped
}
function remapSerializedViewerSection(section, normalizeStateId) {
  const serialized = typeof section === 'string'
  let parsed = section
  if (serialized) { try { parsed = JSON.parse(section) } catch { return section } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return section
  const record = parsed
  const remappedData = remapSerializedPaletteContainer(record.data, normalizeStateId)
  if (remappedData === record.data) return section
  const remapped = { ...record, data: remappedData }
  return serialized ? JSON.stringify(remapped) : remapped
}
function remapSerializedViewerChunk(chunk, normalizeStateId) {
  let root
  try { root = JSON.parse(chunk) } catch { return chunk }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return chunk
  const record = root
  if (!Array.isArray(record.sections)) return chunk
  let changed = false
  record.sections = record.sections.map((section) => {
    const result = remapSerializedViewerSection(section, normalizeStateId)
    if (result !== section) changed = true
    return result
  })
  return changed ? JSON.stringify(record) : chunk
}
function normalizeViewerWorldPacket(event, payload, normalizeStateId) {
  if (!payload || typeof payload !== 'object') return payload
  const packet = payload
  if (event === 'blockUpdate') {
    const stateId = Number(packet.stateId)
    return Number.isInteger(stateId) ? { ...packet, stateId: normalizeStateId(stateId) } : payload
  }
  if (event !== 'loadChunk' || typeof packet.chunk !== 'string') return payload
  const chunk = remapSerializedViewerChunk(packet.chunk, normalizeStateId)
  return chunk === packet.chunk ? payload : { ...packet, chunk }
}
function createViewerWorldEmitter(socket, normalizeStateId) {
  const emitter = {
    on(event, listener) { socket.on(event, listener); return emitter },
    emit(event, payload) { socket.emit(event, normalizeViewerWorldPacket(event, payload, normalizeStateId)); return true },
  }
  return emitter
}

// ---------- 实体 / 物品 / 化身状态序列化 ----------
function resolveRegistryEntity(bot, entityType) {
  const registry = bot.registry
  if (!registry) return undefined
  if (typeof entityType === 'number' && Number.isFinite(entityType)) return registry.entities?.[String(entityType)]
  if (typeof entityType === 'string') {
    const canonical = canonicalEntityName(entityType)
    return registry.entitiesByName?.[canonical] ?? registry.entities?.[entityType]
  }
  return undefined
}
function isGenericEntityType(value) {
  if (typeof value !== 'string') return true
  return /^(?:mob|hostile|passive|animal|object|other|player)$/iu.test(value.trim())
}
function serializeViewerEntity(bot, entity, includeFull = true) {
  const record = entity
  const registryEntity = resolveRegistryEntity(bot, record.entityType)
  const rawName = canonicalEntityName(record.name)
  const registryName = canonicalEntityName(registryEntity?.name)
  const metadataName = decodeVillagerAppearance(record.metadata) ? 'villager' : ''
  const typedName = isGenericEntityType(record.type) ? '' : canonicalEntityName(record.type)
  const name = rawName && rawName !== 'unknown' ? rawName : (registryName || metadataName || typedName || 'unknown')
  const serialized = {
    id: record.id,
    name,
    pos: viewerVector(record.position),
    position: viewerVector(record.position),
    width: positiveNumber(record.width) ?? positiveNumber(registryEntity?.width) ?? 0,
    height: positiveNumber(record.height) ?? positiveNumber(registryEntity?.height) ?? 0,
  }
  copyFinite(serialized, record, ['yaw', 'pitch', 'headYaw', 'health', 'maxHealth', 'age'])
  copyPrimitive(serialized, record, [
    'username', 'uuid', 'displayName', 'customName', 'onGround', 'entityType', 'type', 'objectData',
    'baby', 'isBaby', 'tamed', 'isTamed', 'ownerUuid', 'ownerUUID', 'ownerId', 'ownerName',
  ])
  const velocity = viewerVector(record.velocity)
  if (velocity) serialized.velocity = velocity
  const metadata = sanitizeViewerValue(record.metadata, 0, new WeakSet())
  if (metadata !== undefined) serialized.metadata = metadata
  const villagerAppearance = name === 'villager' ? decodeVillagerAppearance(record.metadata) : undefined
  if (villagerAppearance) serialized.villagerAppearance = villagerAppearance
  const equipment = Array.isArray(record.equipment)
    ? record.equipment.slice(0, 6).map((item, index) => serializeViewerItem(bot, item, index) ?? null)
    : sanitizeViewerValue(record.equipment, 0, new WeakSet())
  if (equipment !== undefined) serialized.equipment = equipment
  return serialized
}
function serializeViewerItem(bot, value, fallbackSlot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value
  const name = typeof record.name === 'string' ? record.name.slice(0, 128) : 'unknown'
  const runtimeType = finiteInteger(record.type, 0, 1000000)
  const type = canonicalViewerItemType(bot, name, runtimeType)
  const output = {
    name,
    count: finiteInteger(record.count, 0, 64) ?? 0,
    slot: finiteInteger(record.slot, 0, MAX_VIEWER_INVENTORY_SLOTS - 1) ?? fallbackSlot,
  }
  if (typeof record.displayName === 'string') output.displayName = record.displayName.slice(0, 256)
  if (type !== undefined) { output.type = type; output.itemId = type }
  for (const key of ['metadata', 'maxDurability', 'durabilityUsed', 'stackSize']) {
    const n = Number(record[key])
    if (Number.isFinite(n)) output[key] = n
  }
  if (typeof record.customName === 'string') output.customName = record.customName.slice(0, 256)
  for (const key of ['enchants', 'components', 'nbt']) {
    const sanitized = sanitizeViewerValue(record[key], 0, new WeakSet())
    if (sanitized !== undefined) output[key] = sanitized
  }
  return output
}
function canonicalViewerItemType(bot, name, runtimeType) {
  const data = minecraftData(bot.version) ?? undefined
  const canonicalName = canonicalRegistryName(name)
  const canonicalByName = canonicalName ? data?.itemsByName?.[canonicalName] : undefined
  const namedType = finiteRegistryInteger(canonicalByName?.id)
  if (namedType !== undefined) return namedType
  if (runtimeType === undefined) return undefined
  return data?.items?.[String(runtimeType)] ? runtimeType : undefined
}
function viewerEntityHeadYaw(entity) {
  const candidate = Number(entity.headYaw)
  return Number.isFinite(candidate) ? candidate : entity.yaw
}
function viewerSharedFlags(metadata) {
  if (Array.isArray(metadata)) return Number(metadata[0]) || 0
  if (!metadata || typeof metadata !== 'object') return 0
  return Number(metadata['0']) || 0
}
function viewerControl(bot, control) {
  try {
    const getter = bot.getControlState
    if (typeof getter === 'function') return getter.call(bot, control) === true
  } catch { /* 半初始化的 bot 可能拒绝控制态读取 */ }
  return bot.controlState?.[control] === true
}
function viewerSneaking(bot, entity) {
  if (entity === bot.entity && viewerControl(bot, 'sneak')) return true
  return entity.crouching === true || (viewerSharedFlags(entity.metadata) & 0x02) !== 0
}
function viewerSprinting(bot, entity) {
  if (entity === bot.entity && viewerControl(bot, 'sprint')) return true
  return entity.sprinting === true || (viewerSharedFlags(entity.metadata) & 0x08) !== 0
}
function viewerMovementAnimation(bot, entity) {
  if (entity.vehicle) return 'riding'
  const velocity = viewerVector(entity.velocity)
  const movingByVelocity = velocity ? velocity.x * velocity.x + velocity.z * velocity.z > 0.0004 : false
  const movingByControls = entity === bot.entity && ['forward', 'back', 'left', 'right'].some((c) => viewerControl(bot, c))
  const moving = movingByVelocity || movingByControls
  const sneaking = viewerSneaking(bot, entity)
  if (sneaking) return moving ? 'crouchWalking' : 'crouch'
  if (!moving) return 'idle'
  return viewerSprinting(bot, entity) ? 'running' : 'walking'
}
function viewerAdvancedLocomotion(state) {
  if (state.riding) return 'ride'
  if (state.elytraFlying) return 'fly'
  if (state.inWater) return 'swim'
  if (!state.onGround) return state.verticalSpeed > 0.035 ? 'jump' : 'fall'
  if (state.movementState === 'running') return 'run'
  if (state.movementState === 'crouchWalking') return 'crouchWalk'
  if (state.movementState === 'crouch') return 'crouch'
  if (state.movementState === 'walking' || state.horizontalSpeed > 0.025) return 'walk'
  return 'idle'
}
function viewerInventory(bot) {
  const slots = bot.inventory?.slots
  if (!Array.isArray(slots)) return []
  return slots
    .slice(0, MAX_VIEWER_INVENTORY_SLOTS)
    .map((item, slot) => serializeViewerItem(bot, item, slot))
    .filter((item) => item !== undefined)
    .slice(0, MAX_VIEWER_INVENTORY_SLOTS)
}
function serializeAvatarState(bot, sequence = 0) {
  const entity = bot.entity
  const inventory = viewerInventory(bot)
  const quickBarSlot = finiteInteger(bot.quickBarSlot, 0, 8)
  const hotbarStart = finiteInteger(bot.inventory?.hotbarStart, 0, MAX_VIEWER_INVENTORY_SLOTS - 9) ?? 36
  const slotItems = bot.inventory?.slots ?? []
  const movementState = viewerMovementAnimation(bot, entity)
  const sneaking = viewerSneaking(bot, entity)
  const sprinting = viewerSprinting(bot, entity)
  const velocity = viewerVector(entity.velocity) ?? { x: 0, y: 0, z: 0 }
  const onGround = entity.onGround === true
  const inWater = entity.isInWater === true
  const inLava = entity.isInLava === true
  const elytraFlying = entity.elytraFlying === true || (viewerSharedFlags(entity.metadata) & 0x80) !== 0
  const vehicle = entity.vehicle
  const riding = vehicle !== undefined && vehicle !== null
  const vehicleId = vehicle && typeof vehicle === 'object'
    ? finiteInteger(vehicle.id, 0, Number.MAX_SAFE_INTEGER) ?? null
    : finiteInteger(vehicle, 0, Number.MAX_SAFE_INTEGER) ?? null
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z)
  const equipment = Array.isArray(entity.equipment)
    ? entity.equipment.slice(0, 6).map((item, index) => serializeViewerItem(bot, item, index) ?? null)
    : []
  return {
    seq: sequence, sequence, capturedAt: Date.now(),
    entity: {
      ...serializeViewerEntity(bot, entity),
      name: 'player', type: 'player', username: bot.username,
      headYaw: viewerEntityHeadYaw(entity), isSelf: true,
    },
    movementState,
    locomotion: viewerAdvancedLocomotion({ movementState, horizontalSpeed, verticalSpeed: velocity.y, onGround, inWater, elytraFlying, riding }),
    velocity, horizontalSpeed, verticalSpeed: velocity.y,
    sprinting, sneaking, onGround, inWater, inLava, elytraFlying, riding, vehicleId,
    usingHeldItem: bot.usingHeldItem === true,
    quickBarSlot: quickBarSlot ?? null,
    equipment,
    hotbar: Array.from({ length: 9 }, (_, index) => {
      const slot = hotbarStart + index
      return { index, slot, selected: index === quickBarSlot, item: serializeViewerItem(bot, slotItems[slot], slot) ?? null }
    }),
    inventory,
  }
}

// ---------- 特效序列化（声音/粒子/受伤，带限流） ----------
function viewerNearbyEffectPosition(bot, value) {
  const position = viewerVector(value)
  const observer = viewerVector(bot.entity?.position)
  if (!position || !observer) return undefined
  const distance = Math.hypot(position.x - observer.x, position.y - observer.y, position.z - observer.z)
  if (!Number.isFinite(distance) || distance > MAX_VIEWER_EFFECT_DISTANCE) return undefined
  if (Math.abs(position.x) > 30000000 || Math.abs(position.z) > 30000000 || Math.abs(position.y) > 4096) return undefined
  return position
}
function normalizeViewerEffectName(value, fallback) {
  const name = typeof value === 'string' || typeof value === 'number'
    ? String(value).normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 96)
    : ''
  return name && /^[\p{L}\p{N}_:./ -]+$/u.test(name) ? name : fallback
}
function serializeViewerSoundEffect(bot, soundName, rawPosition, volume, pitch) {
  const position = viewerNearbyEffectPosition(bot, rawPosition)
  if (!position) return undefined
  return {
    kind: 'sound', name: normalizeViewerEffectName(soundName, 'unknown_sound'), position,
    volume: clampFiniteNumber(volume, 0, 4, 1), pitch: clampFiniteNumber(pitch, 0.05, 4, 1),
  }
}
function serializeViewerParticleEffect(bot, particle) {
  if (!particle || typeof particle !== 'object' || Array.isArray(particle)) return undefined
  const record = particle
  const position = viewerNearbyEffectPosition(bot, record.position)
  if (!position) return undefined
  const id = finiteInteger(record.id, 0, 65535)
  const registryName = id === undefined ? undefined : bot.registry?.particles?.[String(id)]?.name
  const rawOffset = viewerVector(record.offset)
  return {
    kind: 'particle',
    name: normalizeViewerEffectName(record.name ?? record.type ?? registryName, 'unknown_particle'),
    position,
    offset: {
      x: clampFiniteNumber(rawOffset?.x, -8, 8, 0.25),
      y: clampFiniteNumber(rawOffset?.y, -8, 8, 0.25),
      z: clampFiniteNumber(rawOffset?.z, -8, 8, 0.25),
    },
    count: finiteInteger(record.count, 1, MAX_VIEWER_EFFECT_PARTICLES) ?? 1,
    speed: clampFiniteNumber(record.movementSpeed, 0, 4, 0),
  }
}
function serializeViewerEntityBurst(bot, entity, style) {
  if (!entity) return undefined
  const position = viewerNearbyEffectPosition(bot, entity.position)
  if (!position) return undefined
  const entityId = finiteInteger(entity.id, 0, 2147483647)
  return { kind: 'burst', style, ...(entityId === undefined ? {} : { entityId }), position }
}
function viewerEffectFingerprint(effect) {
  const position = effect.position
  return [
    effect.kind, effect.name ?? effect.style ?? effect.effectId, effect.entityId ?? '',
    Math.round(Number(position?.x) * 4) / 4,
    Math.round(Number(position?.y) * 4) / 4,
    Math.round(Number(position?.z) * 4) / 4,
  ].join(':')
}

// ---------- HTML 壳（与参考宿主同构：bundle 按这些 DOM id 挂 HUD/面板） ----------
function viewerHtml(firstPersonFov, dashboardOrigin) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="lantern-dashboard-origin" content="${dashboardOrigin}">
    <title>我的异世界 · 现代画面</title>
    <link rel="stylesheet" href="/viewer.css">
  </head>
  <body>
    <div class="boot" aria-live="polite">正在点亮世界画面…</div>
    <div class="viewer-hud" aria-live="polite">
      <div class="viewer-help"></div>
      <div class="viewer-motion"></div>
      <div class="viewer-held"></div>
      <div class="viewer-hotbar"></div>
    </div>
    <div class="manual-viewer-overlay" id="manual-viewer-overlay" aria-hidden="true">
      <div class="touch-stick" id="touch-stick" role="application" aria-label="移动摇杆">
        <span id="touch-stick-knob"></span>
      </div>
      <div class="touch-actions">
        <button type="button" id="touch-sprint" aria-pressed="false">疾跑</button>
        <button type="button" id="touch-jump">跳跃</button>
        <button type="button" id="touch-stop">停下</button>
      </div>
      <div class="gamepad-chip" id="gamepad-chip">手柄未连接</div>
    </div>
    <div class="ground-click-ping" id="ground-click-ping" aria-hidden="true"></div>
    <div class="skill-cue" id="skill-cue" role="status" aria-live="polite" hidden>
      <small data-skill-cue-source>服务器事件</small>
      <strong data-skill-cue-title>技能反馈</strong>
      <span data-skill-cue-evidence></span>
    </div>
    <div class="camera-follow-status" id="camera-follow-status" role="status" aria-live="polite" hidden>
      <span>镜头正在跟随 <strong id="camera-follow-name">其他角色</strong></span>
      <button type="button" id="camera-follow-return" title="停止跟随并把镜头返回女神">返回女神</button>
    </div>
    <div class="dungeon-hover-card" id="dungeon-hover-card" role="tooltip" aria-hidden="true" hidden>
      <span class="dungeon-hover-icon" id="dungeon-hover-icon" aria-hidden="true">◇</span>
      <span class="dungeon-hover-copy">
        <strong id="dungeon-hover-title">可交互对象</strong>
        <small id="dungeon-hover-subtitle">悬停查看详情</small>
      </span>
      <em id="dungeon-hover-action">查看</em>
    </div>
    <div class="entity-context-menu" id="entity-context-menu" role="menu" aria-hidden="true" aria-label="实体操作" hidden>
      <header>
        <strong data-context-title>可交互对象</strong>
        <small data-context-subtitle>选择操作</small>
      </header>
      <div class="entity-context-summary" data-context-summary></div>
      <div class="entity-context-actions" data-context-actions></div>
    </div>
    <aside class="entity-detail-card" id="entity-detail-card" role="dialog" aria-modal="false" aria-hidden="true" aria-labelledby="entity-detail-title" hidden>
      <header>
        <div>
          <small>实时实体详情</small>
          <h2 id="entity-detail-title" data-detail-title>未选择实体</h2>
          <p data-detail-subtitle>世界实体</p>
        </div>
        <button type="button" data-detail-close aria-label="关闭实体详情">×</button>
      </header>
      <div class="entity-detail-rows" data-detail-rows></div>
      <p class="entity-detail-note">仅展示客户端已收到的实时数据；缺失字段不会臆测补全。</p>
    </aside>
    <aside class="npc-panel" id="npc-panel" role="dialog" aria-modal="false" aria-hidden="true" aria-labelledby="npc-panel-name">
      <header class="npc-panel-header">
        <div class="npc-portrait" id="npc-panel-portrait" aria-hidden="true"><span id="npc-panel-initial">?</span></div>
        <div class="npc-panel-identity">
          <p>网页角色档案 · 世界叠加层</p>
          <h2 id="npc-panel-name">未选择角色</h2>
          <div id="npc-panel-role">靠近并单击 NPC 查看</div>
        </div>
        <button type="button" class="npc-panel-close" id="npc-panel-close" aria-label="关闭角色档案">×</button>
      </header>
      <div class="npc-panel-content">
        <figure class="npc-concept" id="npc-panel-concept" role="img" aria-labelledby="npc-panel-concept-caption" data-portrait-status="idle">
          <img class="npc-concept-image" id="npc-panel-concept-image" alt="" draggable="false" hidden>
          <canvas class="npc-concept-canvas" id="npc-panel-concept-canvas" width="640" height="400" aria-hidden="true"></canvas>
          <div class="npc-concept-fallback" id="npc-panel-concept-fallback" aria-hidden="true">
            <span id="npc-panel-concept-initial">?</span>
            <small>正在准备角色形象</small>
          </div>
          <figcaption class="npc-concept-caption" id="npc-panel-concept-caption">角色形象 · 本地原创立绘</figcaption>
        </figure>
        <div class="npc-portrait-theme" role="group" aria-label="角色立绘主题">
          <span>立绘主题</span>
          <button type="button" data-npc-portrait-theme="guofeng" aria-pressed="true" title="使用原创高精日系幻想二次元立绘">幻想日漫（默认）</button>
          <button type="button" data-npc-portrait-theme="scroll" aria-pressed="false" title="使用原创中国风职业绘卷">职业绘卷</button>
          <button type="button" data-npc-portrait-theme="pixel" aria-pressed="false" title="使用本地程序绘制的像素角色卡">像素卡</button>
        </div>
        <div class="npc-metrics" aria-label="角色关系与距离">
          <div><span>网页羁绊</span><strong id="npc-panel-relationship">初见</strong></div>
          <div><span>距离</span><strong id="npc-panel-distance">—</strong></div>
          <div><span>会面</span><strong id="npc-panel-meetings">0 次</strong></div>
        </div>
        <div class="npc-affinity-track" aria-hidden="true"><i id="npc-panel-affinity"></i></div>
        <p class="npc-lore" id="npc-panel-lore">这里可以承载原版游戏之外的人物志、剧情、任务与关系系统。</p>
        <section class="npc-dialogue-card" aria-labelledby="npc-dialogue-title">
          <div class="npc-section-title" id="npc-dialogue-title">网页剧情</div>
          <blockquote id="npc-panel-dialogue">与角色聊聊，会得到只保存在网页层的回应。</blockquote>
          <p id="npc-panel-recent">尚未找到与这位角色有关的近期世界消息。</p>
        </section>
        <section class="npc-trade-card" id="npc-panel-trades" aria-labelledby="npc-trade-title" data-status="unseen" aria-busy="false">
          <header class="npc-trade-header">
            <div class="npc-section-title" id="npc-trade-title">原版村民交易</div>
            <small data-trade-status aria-live="polite">尚未读取这位村民的交易</small>
          </header>
          <div class="npc-trade-list" data-trade-list role="list" hidden></div>
          <p class="npc-trade-observed" data-trade-observed hidden></p>
        </section>
        <section class="npc-quest-card" id="npc-panel-quest" aria-labelledby="npc-quest-title">
          <div class="npc-section-title">网页支线</div>
          <strong id="npc-quest-title">尚无线索</strong>
          <p id="npc-panel-quest-copy">角色的职业与经历可以生成前端独有的任务钩子。</p>
        </section>
        <div class="npc-actions" aria-label="网页角色互动">
          <button type="button" data-npc-action="focus">镜头跟随</button>
          <button type="button" data-npc-action="dialogue">聊一聊</button>
          <button type="button" data-npc-action="journal">记入旅志</button>
          <button type="button" data-npc-action="quest">接取网页支线</button>
        </div>
        <p class="npc-layer-note">网页羁绊与支线是本地叠加玩法，不会伪装成服务器原生任务，也不会自动控制角色。</p>
      </div>
    </aside>
    <div class="npc-toast" id="npc-toast" role="status" aria-live="polite"></div>
    <script type="module" src="index.js?fov=${firstPersonFov}"></script>
  </body>
</html>`
}

// ---------- 静态资产 ----------
const MIME = { '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8' }
function safeJoin(root, rel) {
  const resolved = path.resolve(root, '.' + path.sep + rel)
  return resolved.startsWith(root + path.sep) ? resolved : null
}

// ---------- 主入口 ----------
export function startModernViewer(getBot, options = {}) {
  if (process.env.MC_MODERN_VIEWER !== '1') return
  const port = Number(process.env.MC_MODERN_VIEWER_PORT ?? options.port ?? 3070)
  const firstPersonFov = Number(process.env.MC_MODERN_VIEWER_FP_FOV ?? 110)
  const dashboardOrigin = process.env.MC_PANEL_ORIGIN ?? 'http://127.0.0.1:9090'

  const boot = () => {
    const bot = getBot()
    if (!bot || !bot.entity || !bot.version) return false
    startServer(bot, port, firstPersonFov, dashboardOrigin)
    return true
  }
  if (!boot()) {
    // bot 未 spawn：挂一次性等待
    const timer = setInterval(() => { if (boot()) clearInterval(timer) }, 3000)
    timer.unref()
    console.log('[modern-viewer] 等 bot spawn 后启动（:' + port + '）')
  }
}

function startServer(bot, port, firstPersonFov, dashboardOrigin) {
  const prismarinePublicRoot = path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public')
  const sessions = new Set()
  let worldGeneration = 0
  let worldResetTimer = null
  let lastDimension = currentDimension()

  const server = createServer(async (req, res) => {
    try {
      // 安全头：与参考宿主同款收紧，frame-ancestors 放宽为任意 http（面板经 LAN IP 访问也要能嵌）
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Security-Policy', [
        "default-src 'none'",
        "script-src 'self' 'unsafe-eval'", // prismarine 协议编译器解码区块要用 eval
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self' data: blob: ws:`,
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        'frame-ancestors http:',
      ].join('; '))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'no-referrer')

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' }); res.end('Method Not Allowed'); return
      }
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      const strip = (prefix) => (p === prefix || p.startsWith(prefix + '/')) ? p.slice(prefix.length) || '/' : null
      const rel = strip('/third') ?? strip('/dungeon') ?? p // 三视角共用一套资产路由

      const send = (code, type, body, headers = {}) => {
        res.writeHead(code, { 'Content-Type': type, ...headers })
        res.end(req.method === 'HEAD' ? undefined : body)
      }
      // 页面
      if (rel === '/' || rel === '') {
        send(200, 'text/html; charset=utf-8', viewerHtml(firstPersonFov, dashboardOrigin)); return
      }
      // bundle / css / manifest
      if (rel === '/index.js') {
        const body = await readFile(path.join(ASSET_ROOT, 'modern-viewer.js'))
        send(200, 'application/javascript; charset=utf-8', body); return
      }
      if (rel === '/viewer.css') {
        const body = await readFile(path.join(ASSET_ROOT, 'viewer.css'))
        send(200, 'text/css; charset=utf-8', body); return
      }
      if (rel === '/character-assets/manifest.json') {
        send(200, 'application/json; charset=utf-8', JSON.stringify({ schemaVersion: 1, assets: [] })); return
      }
      if (rel === '/healthz') {
        send(200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, sessions: sessions.size, generation: worldGeneration })); return
      }
      // NPC 立绘
      if (rel.startsWith('/npc-portraits/')) {
        const file = safeJoin(path.join(ASSET_ROOT, 'npc-portraits'), rel.slice('/npc-portraits/'.length))
        if (file && file.endsWith('.png')) {
          const meta = await stat(file).catch(() => null)
          if (meta?.isFile()) {
            const body = await readFile(file)
            send(200, 'image/png', body, { 'Content-Length': String(meta.size) }); return
          }
        }
        send(404, 'text/plain', 'Not Found'); return
      }
      // 方块/实体/物品纹理 + 方块状态表：prismarine-viewer public 目录直出
      // 注意：URL 自带版本段（/textures/1.21.1/blocks/x.png），根=public，别再拼 textures/<version>
      if (rel.startsWith('/textures/') || rel.startsWith('/blocksStates/')) {
        const file = safeJoin(prismarinePublicRoot, rel)
        if (file && /\.(png|json)$/iu.test(file)) {
          const meta = await stat(file).catch(() => null)
          if (meta?.isFile()) {
            const body = await readFile(file)
            send(200, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', body, { 'Cache-Control': 'public, max-age=86400' }); return
          }
        }
        if (rel.startsWith('/blocksStates/')) { send(404, 'application/json', '{}'); return }
        // 纹理缺失兜底：1x1 透明 png（参考宿主同款）
        send(200, 'image/png', OPTIONAL_TEXTURE_FALLBACK); return
      }
      send(404, 'text/plain', 'Not Found')
    } catch (error) {
      try { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Internal Server Error') } catch { /* 已发送 */ }
      console.warn('[modern-viewer] http error:', error?.message ?? error)
    }
  })
  server.headersTimeout = 5000
  server.requestTimeout = 10000
  server.keepAliveTimeout = 5000
  server.maxConnections = 24

  const socketOptions = {
    allowRequest: (request, callback) => {
      // 同源 socket（iframe 页面自身发起）；Chromium 同源轮询可无 Origin，按 Sec-Fetch 形状放行
      const portSuffix = ':' + port
      const origin = request.headers.origin
      const sameOriginBrowserPoll = origin === undefined
        && request.headers['sec-fetch-site'] === 'same-origin'
        && request.headers['sec-fetch-mode'] === 'cors'
      const host = request.headers.host
      const portMatch = typeof host === 'string' && host.split(',').pop().trim().endsWith(portSuffix)
      callback(null, portMatch && (sameOriginBrowserPoll || typeof origin === 'string' && origin.endsWith(portSuffix)))
    },
    httpCompression: false,
    maxHttpBufferSize: 64 * 1024,
    perMessageDeflate: false,
    pingInterval: 25000,
    pingTimeout: 10000,
    serveClient: false,
  }
  const firstIo = new SocketIoServer(server, { ...socketOptions, path: '/socket.io' })
  const thirdIo = new SocketIoServer(server, { ...socketOptions, path: '/third/socket.io' })
  firstIo.on('connection', (socket) => acceptViewer(socket, 'first'))
  thirdIo.on('connection', (socket) => acceptViewer(socket, 'third'))

  function currentDimension() {
    const dimension = bot.game?.dimension
    return typeof dimension === 'string' ? dimension : 'unknown'
  }
  function scheduleWorldReset() {
    if (worldResetTimer) return
    worldResetTimer = setTimeout(() => {
      worldResetTimer = null
      worldGeneration += 1
      for (const session of [...sessions]) closeSession(session)
    }, 100)
    worldResetTimer.unref()
  }
  bot.on('respawn', scheduleWorldReset)
  bot.on('game', () => {
    const dimension = currentDimension()
    if (lastDimension && dimension !== lastDimension) scheduleWorldReset()
    lastDimension = dimension
  })

  function acceptViewer(socket, viewMode) {
    if (!bot.entity) { socket.disconnect(true); return }
    if (sessions.size >= MAX_VIEWER_SESSIONS) {
      socket.emit('viewerBusy', { maximum: MAX_VIEWER_SESSIONS })
      socket.disconnect(true); return
    }
    const normalizeStateId = createViewerStateIdNormalizer(bot, bot.version)
    const worldEmitter = createViewerWorldEmitter(socket, normalizeStateId)
    const worldView = new WorldView(bot.world, 6, bot.entity.position, worldEmitter)
    socket.removeAllListeners('mouseClick') // 观察面，无浏览器→bot 控制路径
    let initialized = false
    let avatarSequence = 0
    const movementAnimations = new Map()
    const ownEntity = () => ({
      ...serializeViewerEntity(bot, bot.entity),
      name: 'player', type: 'player', username: bot.username,
      headYaw: viewerEntityHeadYaw(bot.entity), isSelf: true,
    })
    const emitOwnEntity = () => {
      if (!bot.entity || !socket.connected) return
      socket.emit(viewMode === 'third' ? 'entity' : 'playerEntity', ownEntity())
    }
    const emitMovementAnimation = (entity, force = false) => {
      if (!entity || !socket.connected || entity.id === undefined || entity.id === null) return
      const animation = viewerMovementAnimation(bot, entity)
      const key = String(entity.id)
      if (!force && movementAnimations.get(key) === animation) return
      movementAnimations.set(key, animation)
      socket.emit('entityAnimation', { id: entity.id, animation, isSelf: entity === bot.entity })
    }
    const botAvatarState = () => {
      if (!bot.entity || !socket.connected) return
      socket.emit('avatarState', serializeAvatarState(bot, ++avatarSequence))
    }
    const botPosition = () => {
      if (!bot.entity || !socket.connected) return
      socket.emit('position', {
        pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true, pitch: bot.entity.pitch,
      })
      if (viewMode === 'third') socket.emit('entityMoved', ownEntity())
      emitMovementAnimation(bot.entity)
      if (initialized) {
        void worldView.updatePosition(bot.entity.position).catch(() => closeSession(session))
      }
    }
    const botTime = () => {
      if (!socket.connected) return
      const timeOfDay = Number(bot.time?.timeOfDay)
      if (Number.isFinite(timeOfDay)) socket.emit('time', normalizeMinecraftTime(timeOfDay))
    }
    const botWeather = () => {
      if (!socket.connected) return
      socket.emit('weather', { raining: Boolean(bot.isRaining), thunder: Math.max(0, Number(bot.thunderState) || 0) })
    }
    const botEntitySpawn = (entity) => {
      if (!socket.connected || !entity || entity === bot.entity) return
      socket.emit('entity', serializeViewerEntity(bot, entity))
      emitMovementAnimation(entity, true)
    }
    const botEntityMoved = (entity) => {
      if (!socket.connected || !entity) return
      if (entity !== bot.entity) socket.emit('entityMoved', serializeViewerEntity(bot, entity, false))
      emitMovementAnimation(entity)
    }
    const botEntityRefresh = (entity) => {
      if (!socket.connected || !entity) return
      if (entity === bot.entity) { emitOwnEntity(); botAvatarState() }
      else socket.emit('entity', serializeViewerEntity(bot, entity))
      emitMovementAnimation(entity)
    }
    const botEntitySwingArm = (entity) => {
      if (!socket.connected || !entity || entity.id === undefined || entity.id === null) return
      socket.emit('entityAnimation', { id: entity.id, animation: 'oneSwing', isSelf: entity === bot.entity })
    }
    const effectLimiter = { windowStartedAt: Date.now(), sent: 0, dropped: 0, sequence: 0, lastFingerprint: '', lastAt: 0 }
    const emitViewerEffect = (effect) => {
      if (!effect || !socket.connected) return
      const now = Date.now()
      if (now - effectLimiter.windowStartedAt >= 1000) { effectLimiter.windowStartedAt = now; effectLimiter.sent = 0 }
      const fingerprint = viewerEffectFingerprint(effect)
      if (effectLimiter.sent >= MAX_VIEWER_EFFECT_EVENTS_PER_SECOND
        || (fingerprint === effectLimiter.lastFingerprint && now - effectLimiter.lastAt < 20)) {
        effectLimiter.dropped += 1; return
      }
      effectLimiter.sent += 1
      effectLimiter.lastFingerprint = fingerprint
      effectLimiter.lastAt = now
      socket.emit('viewerEffect', { ...effect, schemaVersion: 1, seq: ++effectLimiter.sequence, observedAt: now, serverDropped: effectLimiter.dropped })
      effectLimiter.dropped = 0
    }
    const botEntityHurt = (entity) => {
      if (!socket.connected || !entity || entity.id === undefined || entity.id === null) return
      socket.emit('entityDamage', { id: entity.id, isSelf: entity === bot.entity })
      emitViewerEffect(serializeViewerEntityBurst(bot, entity, 'hurt'))
    }
    const botParticle = (particle) => emitViewerEffect(serializeViewerParticleEffect(bot, particle))
    const botSoundEffect = (soundName, position, volume, pitch) => emitViewerEffect(serializeViewerSoundEffect(bot, soundName, position, volume, pitch))
    const botHardcodedSoundEffect = (soundId, soundCategory, position, volume, pitch) => {
      if (soundId === 0) return // mineflayer 对具名声音镜像 id=0，忽略重复
      emitViewerEffect(serializeViewerSoundEffect(bot, `hardcoded_${finiteInteger(soundId, 0, 65535) ?? 'unknown'}_${finiteInteger(soundCategory, 0, 64) ?? 0}`, position, volume, pitch))
    }
    const botEntityDead = (entity) => emitViewerEffect(serializeViewerEntityBurst(bot, entity, 'death'))
    const botHeldItemChanged = () => { emitOwnEntity(); botAvatarState() }
    const botInventoryUpdate = () => { emitOwnEntity(); botAvatarState() }
    const inventoryEmitter = viewerEventEmitter(bot.inventory)
    const avatarTimer = setInterval(botAvatarState, AVATAR_STATE_INTERVAL_MS)
    avatarTimer.unref()
    const session = {
      socket, worldView, viewMode, avatarTimer, movementAnimations,
      botPosition, botTime, botWeather, botAvatarState, botEntitySpawn, botEntityMoved, botEntityRefresh,
      botEntitySwingArm, botEntityHurt, botParticle, botSoundEffect, botHardcodedSoundEffect, botEntityDead,
      botHeldItemChanged, botInventoryUpdate, inventoryEmitter,
    }
    sessions.add(session)
    socket.once('disconnect', () => closeSession(session))

    socket.emit('version', bot.version)
    emitOwnEntity()
    try {
      worldView.listenToBot(bot)
      bot.on('move', botPosition)
      bot.on('time', botTime)
      bot.on('rain', botWeather)
      bot.on('weatherUpdate', botWeather)
      bot.on('entitySpawn', botEntitySpawn)
      bot.on('entityMoved', botEntityMoved)
      bot.on('entityUpdate', botEntityRefresh)
      bot.on('entityEquip', botEntityRefresh)
      bot.on('entitySwingArm', botEntitySwingArm)
      bot.on('entityCrouch', (e) => emitMovementAnimation(e, true))
      bot.on('entityUncrouch', (e) => emitMovementAnimation(e, true))
      bot.on('entityHurt', botEntityHurt)
      bot.on('particle', botParticle)
      bot.on('soundEffectHeard', botSoundEffect)
      bot.on('hardcodedSoundEffectHeard', botHardcodedSoundEffect)
      bot.on('entityDead', botEntityDead)
      bot.on('heldItemChanged', botHeldItemChanged)
      inventoryEmitter?.on('updateSlot', botInventoryUpdate)
      botTime(); botWeather(); botAvatarState()
      for (const entity of Object.values(bot.entities ?? {})) botEntitySpawn(entity)
      botPosition()
    } catch {
      closeSession(session); return
    }
    void worldView.init(bot.entity.position.clone())
      .then(async () => {
        if (!sessions.has(session) || !socket.connected || !bot.entity) return
        initialized = true
        await worldView.updatePosition(bot.entity.position, true)
      })
      .catch(() => closeSession(session))
  }

  function closeSession(session) {
    if (!sessions.delete(session)) return
    clearInterval(session.avatarTimer)
    bot.off('move', session.botPosition)
    bot.off('time', session.botTime)
    bot.off('rain', session.botWeather)
    bot.off('weatherUpdate', session.botWeather)
    bot.off('entitySpawn', session.botEntitySpawn)
    bot.off('entityMoved', session.botEntityMoved)
    bot.off('entityUpdate', session.botEntityRefresh)
    bot.off('entityEquip', session.botEntityRefresh)
    bot.off('entitySwingArm', session.botEntitySwingArm)
    bot.off('entityHurt', session.botEntityHurt)
    bot.off('particle', session.botParticle)
    bot.off('soundEffectHeard', session.botSoundEffect)
    bot.off('hardcodedSoundEffectHeard', session.botHardcodedSoundEffect)
    bot.off('entityDead', session.botEntityDead)
    bot.off('heldItemChanged', session.botHeldItemChanged)
    session.inventoryEmitter?.off('updateSlot', session.botInventoryUpdate)
    session.movementAnimations.clear()
    try { session.worldView.removeListenersFromBot(bot) } catch { /* 断开早于监听建立 */ }
    if (session.socket.connected) session.socket.disconnect(true)
  }

  function viewerEventEmitter(value) {
    if (!value || typeof value !== 'object') return undefined
    return typeof value.on === 'function' && typeof value.off === 'function' ? value : undefined
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`[modern-viewer] 现代画面服务 on :${port}（/ 第一人称 · /third/ 环绕 · /dungeon/ 2.5D）`)
  })
}

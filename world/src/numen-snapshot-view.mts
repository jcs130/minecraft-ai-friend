/** Build a bounded Prismarine world from Numen's own loaded server volume. */
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentFrameError } from './agent-frame.mts'

const require = createRequire(import.meta.url)
const Chunk = require('prismarine-chunk')('1.21.1')
const Vec3 = require('vec3').Vec3
const KIRITO_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'
const IDMAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'neoforge-handshake/idmap.json')
const SNAPSHOT = process.env.NUMEN_VISION_SNAPSHOT_FILE ?? '/mcvision/kirito-latest.json'
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
const key = (x, z) => `${x},${z}`
const validHudItem = item => item && typeof item.id === 'string'
  && /^[a-z0-9_.-]+:[a-z0-9_./-]{1,120}$/u.test(item.id)
  && Number.isFinite(item.distance) && item.distance >= 0 && item.distance <= 24
  && [item.x, item.y, item.z].every(Number.isFinite)

export function validateSnapshot(value, expectedTime, now = Date.now()) {
  if (!value || value.schema !== 1 || value.actorName !== 'Kirito' || value.actorUuid !== KIRITO_UUID
      || value.sampledAt !== expectedTime || !Number.isInteger(value.sampledAt)
      || now - value.sampledAt < 0 || now - value.sampledAt > 5000
      || !['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].includes(value.dimension)
      || ![value.x, value.y, value.z, value.eyeY, value.yawRadians, value.pitchRadians].every(Number.isFinite)
      || ![value.minX, value.maxX, value.minY, value.maxY, value.minZ, value.maxZ].every(Number.isInteger)
      || value.maxX - value.minX !== 32 || value.maxZ - value.minZ !== 32
      || value.maxY < value.minY || value.maxY - value.minY > 28
      || !Array.isArray(value.palette) || value.palette.length > 4096
      || !value.palette.every(id => Number.isInteger(id) && id >= 0 && id <= 1000000)
      || !Array.isArray(value.paletteNames) || value.paletteNames.length !== value.palette.length
      || !value.paletteNames.every(id => typeof id === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]{1,120}$/u.test(id))
      || !Array.isArray(value.blocks) || value.blocks.length % 2 || value.blocks.length > 70000) {
    throw new AgentFrameError('numen_snapshot_invalid')
  }
  const capacity = 33 * 33 * (value.maxY - value.minY + 1)
  for (let i = 0; i < value.blocks.length; i += 2) {
    if (!Number.isInteger(value.blocks[i]) || value.blocks[i] < 0 || value.blocks[i] >= capacity
        || !Number.isInteger(value.blocks[i + 1]) || value.blocks[i + 1] < 0
        || value.blocks[i + 1] >= value.palette.length) throw new AgentFrameError('numen_snapshot_invalid')
  }
  const hud = value.hud
  if (!hud || typeof hud !== 'object' || hud.aimBlock != null && !validHudItem(hud.aimBlock)
      || !Array.isArray(hud.nearbyBlocks) || hud.nearbyBlocks.length > 5
      || !hud.nearbyBlocks.every(validHudItem)
      || !Array.isArray(hud.nearbyEntities) || hud.nearbyEntities.length > 6
      || !hud.nearbyEntities.every(validHudItem)) throw new AgentFrameError('numen_snapshot_invalid')
  return value
}

export function snapshotColumns(snapshot, idmap) {
  const columns = new Map()
  for (let z = snapshot.minZ; z <= snapshot.maxZ; z += 16) {
    for (let x = snapshot.minX; x <= snapshot.maxX; x += 16) {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16)
      columns.set(key(cx, cz), new Chunk())
    }
  }
  const states = snapshot.palette.map(id => {
    const mapped = idmap.states[String(id)]
    if (!Number.isInteger(mapped) || mapped < 0) throw new AgentFrameError('numen_state_unmapped')
    return mapped
  })
  for (let i = 0; i < snapshot.blocks.length; i += 2) {
    const offset = snapshot.blocks[i]
    const x = snapshot.minX + offset % 33
    const z = snapshot.minZ + Math.floor(offset / 33) % 33
    const y = snapshot.minY + Math.floor(offset / (33 * 33))
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16)
    const column = columns.get(key(cx, cz))
    if (!column) throw new AgentFrameError('numen_snapshot_invalid')
    column.setBlockStateId(new Vec3(x - cx * 16, y, z - cz * 16), states[snapshot.blocks[i + 1]])
  }
  return columns
}

export function createNumenSnapshotView({ sendCommand, snapshotPath = SNAPSHOT, now = Date.now }) {
  const idmap = JSON.parse(require('node:fs').readFileSync(IDMAP, 'utf8'))
  if (!idmap?.states || typeof idmap.states !== 'object') throw Error('numen_idmap_unavailable')
  const bot = new EventEmitter()
  const entity = { id: 1, name: 'player', type: 'player', position: new Vec3(0, 64, 0),
    yaw: 0, pitch: 0, equipment: [], metadata: {}, sampleAt: 0 }
  let columns = new Map()
  Object.assign(bot, { username: 'Kirito', version: '1.21.1', entity,
    players: { Kirito: { uuid: KIRITO_UUID, entity } }, entities: {},
    inventory: Object.assign(new EventEmitter(), { slots: [] }),
    game: { dimension: 'overworld', gameMode: 'spectator' },
    time: { timeOfDay: 6000 }, _client: { state: 'play' },
    world: { getColumn: (x, z) => columns.get(key(Math.floor(x), Math.floor(z))),
      getColumnAt: pos => columns.get(key(Math.floor(pos.x / 16), Math.floor(pos.z / 16))) },
  })
  let busy = false
  let geometry = null
  async function prepare({ poseOnly = false } = {}) {
    if (busy) throw new AgentFrameError('frame_busy', 429)
    busy = true
    try {
      const reply = await sendCommand('numen_act snapshot')
      const match = /^snapshot ok sampledAt=(\d+) blocks=(\d+)\s*$/u.exec(reply)
      if (!match) throw new AgentFrameError('numen_snapshot_unavailable')
      const bytes = await readFile(snapshotPath)
      if (bytes.length > MAX_SNAPSHOT_BYTES) throw new AgentFrameError('numen_snapshot_too_large')
      const snapshot = validateSnapshot(JSON.parse(bytes.toString('utf8')), Number(match[1]), now())
      if (poseOnly) {
        if (!geometry || geometry.dimension !== snapshot.dimension
            || Math.hypot(geometry.x - snapshot.x, geometry.z - snapshot.z) > 4
            || Math.abs(geometry.y - snapshot.y) > 4) throw new AgentFrameError('frame_world_changed')
      } else {
        const next = snapshotColumns(snapshot, idmap)
        for (const name of columns.keys()) {
          const [x, z] = name.split(',').map(Number)
          bot.emit('chunkColumnUnload', { x: x * 16, z: z * 16 })
        }
        columns = next
        geometry = { x: snapshot.x, y: snapshot.y, z: snapshot.z,
          dimension: snapshot.dimension, sampledAt: snapshot.sampledAt }
      }
      entity.position = new Vec3(snapshot.x, snapshot.y, snapshot.z)
      entity.yaw = snapshot.yawRadians; entity.pitch = snapshot.pitchRadians
      entity.eyeY = snapshot.eyeY; entity.sampledAt = snapshot.sampledAt
      entity.geometrySampledAt = geometry.sampledAt
      entity.hud = snapshot.hud
      bot.game.dimension = snapshot.dimension.replace(/^minecraft:/u, '')
      bot.time.timeOfDay = snapshot.timeOfDay
      bot.emit('forcedMove')
      if (!poseOnly) {
        for (const name of columns.keys()) {
          const [x, z] = name.split(',').map(Number)
          bot.emit('chunkColumnLoad', { x: x * 16, z: z * 16 })
        }
      }
      return snapshot
    } catch (error) {
      if (error instanceof AgentFrameError) throw error
      throw new AgentFrameError('numen_snapshot_unavailable')
    } finally { busy = false }
  }
  return { bot, prepare, health: () => ({ source: 'numen_act snapshot', loadedColumns: columns.size,
    sampledAt: entity.sampledAt, geometrySampledAt: geometry?.sampledAt ?? null }) }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNumenSnapshotView, validateSnapshot, snapshotColumns } from '../src/numen-snapshot-view.mts'
import { kiritoPose } from '../src/agent-frame.mts'

const actorUuid = 'd4ac9523-4962-43ed-98c5-19b49e104048'
const fixture = () => ({ schema: 1, actorName: 'Kirito', actorUuid,
  dimension: 'minecraft:overworld', sampledAt: 1000, x: 0.5, y: 65, z: 0.5,
  eyeY: 66.62, yawRadians: 0.6, pitchRadians: -0.3, timeOfDay: 6000,
  minX: -16, maxX: 16, minY: 55, maxY: 83, minZ: -16, maxZ: 16,
  palette: [1], paletteNames: ['minecraft:stone'],
  blocks: [((65 - 55) * 33 + 16) * 33 + 16, 0],
  hud: { aimBlock: { id: 'minecraft:stone', distance: 3.5, x: 0, y: 65, z: 0 },
    nearbyBlocks: [], nearbyEntities: [] } })

test('Numen volume becomes a textured viewer chunk without another game client', () => {
  const value = validateSnapshot(fixture(), 1000, 1200)
  const columns = snapshotColumns(value, { states: { '1': 1 } })
  assert.equal(columns.size, 9)
  assert.equal(columns.get('0,0').getBlockStateId({ x: 0, y: 65, z: 0 }), 1)
  assert.equal(columns.get('0,0').getBlockStateId({ x: 1, y: 65, z: 0 }), 0)
})

test('source refreshes exact Kirito pose and loaded chunks from fixed RCON snapshot', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qd-vision-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'frame.json')
  await writeFile(file, JSON.stringify(fixture()))
  const commands = []
  let sampledAt = 1000, clock = 1200
  const source = createNumenSnapshotView({ snapshotPath: file, now: () => clock,
    sendCommand: async command => { commands.push(command); return `snapshot ok sampledAt=${sampledAt} blocks=1` } })
  await source.prepare()
  assert.deepEqual(commands, ['numen_act snapshot'])
  const pose = kiritoPose(source.bot, actorUuid)
  assert.deepEqual([pose.x, pose.y, pose.z, pose.eyeY, pose.yaw, pose.pitch, pose.sampledAt],
    [0.5, 65, 0.5, 66.62, 0.6, -0.3, 1000])
  assert.equal(source.health().loadedColumns, 9)
  let chunkEvents = 0
  source.bot.on('chunkColumnUnload', () => { chunkEvents++ })
  source.bot.on('chunkColumnLoad', () => { chunkEvents++ })
  const moved = { ...fixture(), sampledAt: 1500, x: 1.5, yawRadians: 1.2 }
  await writeFile(file, JSON.stringify(moved))
  sampledAt = 1500; clock = 1700
  await source.prepare({ poseOnly: true })
  assert.equal(chunkEvents, 0)
  assert.equal(kiritoPose(source.bot, actorUuid).x, 1.5)
  assert.equal(source.health().geometrySampledAt, 1000)
  await writeFile(file, JSON.stringify({ ...moved, sampledAt: 1800, x: 12.5 }))
  sampledAt = 1800; clock = 1900
  await assert.rejects(() => source.prepare({ poseOnly: true }), /frame_world_changed/)
})

test('unloaded or stale Numen sample cannot turn into a frame', () => {
  assert.throws(() => validateSnapshot(fixture(), 1000, 7000), /numen_snapshot_invalid/)
  const missing = fixture(); missing.blocks = [999999, 0]
  assert.throws(() => validateSnapshot(missing, 1000, 1200), /numen_snapshot_invalid/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { kiritoPose, AgentFrameError } from '../src/agent-frame.mts'

const uuid = 'd4ac9523-4962-43ed-98c5-19b49e104048'
const bot = () => ({
  players: { Kirito: { uuid, entity: { position: { x: 12.5, y: 66, z: -8.5 }, yaw: 0.5, pitch: -0.2 } } },
  entity: { position: { x: 12, y: 66, z: -8 } }, game: { dimension: 'overworld' },
  world: { getColumn: () => ({ toJson: () => '{}' }) },
})

test('capture target is Kirito entity and only loaded local world', () => {
  const value = kiritoPose(bot(), uuid)
  assert.equal(value.actorName, 'Kirito')
  assert.equal(value.actorUuid, uuid)
  assert.deepEqual([value.x, value.y, value.z, value.yaw, value.pitch], [12.5, 66, -8.5, 0.5, -0.2])
  assert.equal(value.dimension, 'overworld')
})

test('observer viewpoint, unloaded chunks, and wrong UUID never become Kirito frame', () => {
  const wrong = bot(); wrong.players.Kirito.uuid = '00000000-0000-4000-8000-000000000001'
  assert.throws(() => kiritoPose(wrong, uuid), e => e instanceof AgentFrameError && e.code === 'kirito_viewpoint_unavailable')
  const far = bot(); far.entity.position.x = 100
  assert.throws(() => kiritoPose(far, uuid), e => e.code === 'kirito_chunks_unloaded')
  const empty = bot(); empty.world.getColumn = () => null
  assert.throws(() => kiritoPose(empty, uuid), e => e.code === 'kirito_chunks_unloaded')
})

'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { TextDecoder } = require('node:util')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,64}$/
const SOURCE = 'same_player_server_collision_shape'
const MAX_BYTES = 16384
const MAX_BOXES = 64
const decoder = new TextDecoder('utf-8', { fatal: true })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const ownUuid = bot => typeof bot._client.uuid === 'string' && UUID.test(bot._client.uuid) ? bot._client.uuid.toLowerCase() : null
const samePosition = (a, b) => object(a) && object(b) && ['x', 'y', 'z'].every(key => a[key] === b[key])
const finiteVector = value => object(value) && ['x', 'y', 'z'].every(key => Number.isFinite(value[key]))

function position (value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'x,y,z' ||
      !['x', 'y', 'z'].every(key => Number.isInteger(value[key]) && value[key] >= -2147483648 && value[key] <= 2147483647)) {
    throw Error('INVALID_COLLISION_POSITION')
  }
  return { x: value.x, y: value.y, z: value.z }
}

function properties (value) {
  if (!object(value) || Object.keys(value).length > 40) throw Error('INVALID_COLLISION_PROPERTIES')
  const result = Object.create(null)
  for (const key of Object.keys(value).sort()) {
    if (!/^[a-z0-9_]{1,64}$/.test(key) || typeof value[key] !== 'string' || !/^[a-z0-9_.:-]{1,96}$/.test(value[key])) {
      throw Error('INVALID_COLLISION_PROPERTIES')
    }
    result[key] = value[key]
  }
  return result
}

function currentDimension (bot) {
  const dimension = bot.game?.dimension
  if (typeof dimension !== 'string') return null
  if (ID.test(dimension)) return dimension
  // Mineflayer's legacy vanilla dimension labels. No mod dimension guesses.
  return ['overworld', 'the_nether', 'the_end'].includes(dimension) ? `minecraft:${dimension}` : null
}

function unavailable (requestId, playerUuid, code, dispatched = false) {
  return { schemaVersion: 1, kind: 'world_receipt', query: 'collision', requestId, playerUuid,
    ok: false, available: false, code, boxes: null, source: SOURCE, readOnly: true,
    outcomeKnown: true, dispatched, retryAutomatically: false, globalStateCacheSafe: false,
    physicsIntegrated: false, pathfinderIntegrated: false }
}

// This projects ONE native currently visible block for the same connected player.
// It does not populate a global state cache or alter Mineflayer physics/pathfinder.
function attachCollisionClient (bot, { timeoutMs = 4000, maxPending = 4 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('INVALID_COLLISION_TIMEOUT')
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 16) throw Error('INVALID_COLLISION_PENDING_BUDGET')
  const events = new EventEmitter()
  const pending = new Map()
  const explicitRequestIds = new Set()
  let epoch = 0
  let closed = false

  function reset (code) {
    epoch++
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.resolve(unavailable(request.requestId, request.uuid, code, request.dispatched))
    }
    pending.clear()
    events.emit('invalidate', { epoch, code, closed })
  }
  function onEnd () {
    if (closed) return
    closed = true
    reset('collision_connection_closed')
  }
  function onLifecycle () { if (!closed) reset('collision_player_lifecycle_changed') }

  function validateSuccess (body, request) {
    if (body.available !== true || body.source !== SOURCE || body.readOnly !== true ||
        body.outcomeKnown !== true || body.retryAutomatically !== false ||
        body.physicsIntegrated !== false || body.pathfinderIntegrated !== false || body.globalStateCacheSafe !== false ||
        body.boxCoordinates !== 'block_local' || body.boxesMayExtendBeyondUnitBlock !== true ||
        !samePosition(body.position, request.body.position) || !object(body.block) ||
        body.block.id !== request.body.expectedBlockId ||
        JSON.stringify(properties(body.block.properties)) !== JSON.stringify(request.body.expectedProperties) ||
        !Number.isInteger(body.block.stateId) || body.block.stateId < 0 ||
        typeof body.block.javaClass !== 'string' || body.block.javaClass.length > 256 ||
        body.block.dynamicShape !== false || body.block.hasOffsetFunction !== false ||
        !Number.isFinite(body.sampledAt) || body.maxAgeMs !== 250) throw Error('COLLISION_RECEIPT_BINDING_MISMATCH')
    const context = body.context
    if (!object(context) || context.source !== 'CollisionContext.of_actual_ServerPlayer' ||
        !Number.isInteger(context.capturedTick) || !/^[0-9]{1,20}$/.test(context.gameTime || '') ||
        typeof context.pose !== 'string' || !/^[a-z_]{1,64}$/.test(context.pose) ||
        !Number.isFinite(context.width) || context.width <= 0 || context.width > 32 ||
        !Number.isFinite(context.height) || context.height <= 0 || context.height > 32 ||
        !finiteVector(context.playerPosition) || context.loadedNeighbourhoodRadius !== 1) throw Error('COLLISION_CONTEXT_INVALID')
    if (!Array.isArray(body.boxes) || body.boxes.length > MAX_BOXES || body.boxCount !== body.boxes.length ||
        body.boxes.some(box => !Array.isArray(box) || box.length !== 6 ||
          box.some(value => !Number.isFinite(value) || Math.abs(value) > 16) ||
          !(box[0] < box[3] && box[1] < box[4] && box[2] < box[5]))) throw Error('COLLISION_BOXES_INVALID')
  }

  function onPayload (packet) {
    if (closed || packet.channel !== 'maw_agent:world_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      // Other world queries share this channel and can legitimately be larger.
      // Parse only within that channel's outer budget before dispatch by query.
      if (bytes.length > 65536) throw Error('COLLISION_WORLD_REPLY_TOO_LARGE')
      body = JSON.parse(decoder.decode(bytes))
      if (!object(body) || body.schemaVersion !== 1 || body.kind !== 'world_receipt') return
      const request = pending.get(body.requestId)
      if (!request) return
      if (body.query !== 'collision' && !(body.ok === false && body.query === undefined)) return
      if (bytes.length > MAX_BYTES) throw Error('COLLISION_RECEIPT_BUDGET_EXCEEDED')
      const uuid = ownUuid(bot)
      if (!uuid || body.playerUuid !== uuid || request.uuid !== uuid || request.epoch !== epoch) throw Error('COLLISION_PLAYER_MISMATCH')
      const dimension = currentDimension(bot)
      if ((dimension && dimension !== request.body.dimension) ||
          (body.dimension !== undefined && body.dimension !== request.body.dimension)) throw Error('COLLISION_DIMENSION_CHANGED')
      if (typeof body.ok !== 'boolean') throw Error('COLLISION_RECEIPT_INVALID')
      if (body.ok) {
        if (body.query !== 'collision' || body.dimension !== request.body.dimension) throw Error('COLLISION_RECEIPT_BINDING_MISMATCH')
        validateSuccess(body, request)
      } else if (body.available === true || (body.boxes !== undefined && body.boxes !== null)) {
        throw Error('COLLISION_FAILURE_GEOMETRY_INVALID')
      }
      const result = body.ok ? { ...body, receivedAt: Date.now(), expiresAfterMs: 250 } : {
        ...unavailable(body.requestId, uuid, typeof body.code === 'string' ? body.code : 'collision_unavailable', true),
        ...(body.blockingPosition ? { blockingPosition: position(body.blockingPosition) } : {})
      }
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(result)
      events.emit('receipt', result)
    } catch (error) { events.emit('protocolError', error) }
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  bot.on('spawn', onLifecycle)
  bot.on('respawn', onLifecycle)

  function validateQuery (input) {
    if (!object(input) || !Object.keys(input).every(key => ['position', 'expectedBlockId', 'expectedProperties', 'dimension', 'requestId'].includes(key))) {
      throw Error('INVALID_COLLISION_QUERY')
    }
    const pos = position(input.position)
    if (typeof input.expectedBlockId !== 'string' || input.expectedBlockId.length > 256 || !ID.test(input.expectedBlockId)) throw Error('INVALID_COLLISION_BLOCK_ID')
    const expectedProperties = properties(input.expectedProperties)
    const dimension = input.dimension ?? currentDimension(bot)
    if (typeof dimension !== 'string' || dimension.length > 256 || !ID.test(dimension)) throw Error('COLLISION_DIMENSION_UNAVAILABLE')
    const observed = currentDimension(bot)
    if (observed && observed !== dimension) throw Error('COLLISION_DIMENSION_CHANGED')
    const requestId = input.requestId ?? randomUUID()
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw Error('INVALID_COLLISION_REQUEST_ID')
    return { schemaVersion: 1, kind: 'collision', requestId, playerUuid: ownUuid(bot),
      dimension, position: pos, expectedBlockId: input.expectedBlockId, expectedProperties }
  }

  function dispatch (body, explicitId) {
    if (closed || !body.playerUuid) return Promise.resolve(unavailable(body.requestId, body.playerUuid, 'collision_connection_unavailable'))
    if (pending.size >= maxPending) return Promise.resolve(unavailable(body.requestId, body.playerUuid, 'collision_pending_budget_exceeded'))
    if (pending.has(body.requestId) || explicitRequestIds.has(body.requestId)) throw Error('COLLISION_REQUEST_ID_ALREADY_USED')
    if (explicitId) {
      // Caller IDs cannot be reused for an old late reply. Generated UUIDs do
      // not need an unbounded history; they are never intentionally reissued.
      if (explicitRequestIds.size >= 1024) throw Error('COLLISION_EXPLICIT_REQUEST_ID_BUDGET_EXCEEDED')
      explicitRequestIds.add(body.requestId)
    }
    const data = Buffer.from(JSON.stringify(body), 'utf8')
    if (data.length > MAX_BYTES) throw Error('COLLISION_REQUEST_BUDGET_EXCEEDED')
    return new Promise(resolve => {
      const request = { body, requestId: body.requestId, uuid: body.playerUuid, epoch, resolve, dispatched: false }
      request.timer = setTimeout(() => {
        pending.delete(body.requestId)
        resolve(unavailable(body.requestId, body.playerUuid, 'collision_query_not_observed', request.dispatched))
      }, timeoutMs)
      pending.set(body.requestId, request)
      try {
        bot._client.write('custom_payload', { channel: 'maw_agent:world_query', data })
        request.dispatched = true
      } catch (error) {
        clearTimeout(request.timer)
        pending.delete(body.requestId)
        resolve(unavailable(body.requestId, body.playerUuid, 'collision_query_send_failed'))
      }
    })
  }

  function query (input) {
    return dispatch(validateQuery(input), input?.requestId !== undefined)
  }

  async function lookAtBlock (block, options) {
    const { aimOffset = [0.5, 0.5, 0.5], ...input } = options || {}
    if (!Array.isArray(aimOffset) || aimOffset.length !== 3 || aimOffset.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw Error('INVALID_COLLISION_LOOK_OFFSET')
    }
    // Validate before rotating the player. Preserve the same connection epoch
    // and UUID across the asynchronous look/tick boundary.
    const body = validateQuery({ ...input, position: position({ x: block?.position?.x, y: block?.position?.y, z: block?.position?.z }) })
    if (closed || !body.playerUuid) return unavailable(body.requestId, body.playerUuid, 'collision_connection_unavailable')
    const capturedEpoch = epoch
    if (typeof block.position.offset !== 'function') throw Error('INVALID_COLLISION_LOOK_BLOCK')
    await bot.lookAt(block.position.offset(...aimOffset), true)
    await bot.waitForTicks(1)
    if (closed || epoch !== capturedEpoch || ownUuid(bot) !== body.playerUuid) {
      return unavailable(body.requestId, body.playerUuid, 'collision_player_lifecycle_changed')
    }
    if (currentDimension(bot) && currentDimension(bot) !== body.dimension) {
      return unavailable(body.requestId, body.playerUuid, 'collision_dimension_changed')
    }
    return dispatch(body, input.requestId !== undefined)
  }

  return { events, query, lookAtBlock,
    capabilities: Object.freeze({ nativeCollisionQuery: true, physicsIntegrated: false, pathfinderIntegrated: false, globalStateCacheSafe: false }),
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      bot.off('spawn', onLifecycle)
      bot.off('respawn', onLifecycle)
      onEnd()
    } }
}

module.exports = { attachCollisionClient }

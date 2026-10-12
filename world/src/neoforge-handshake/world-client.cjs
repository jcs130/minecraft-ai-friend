'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Read-only, server-raycast native block identity. Proxy block names from the
// vanilla chunk stream are deliberately not used as a mod block's identity.
function attachWorldClient (bot) {
  const events = new EventEmitter()
  const pending = new Map()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let closed = false, epoch = 0
  const ownUuid = () => typeof bot._client.uuid === 'string' && uuidPattern.test(bot._client.uuid) ? bot._client.uuid.toLowerCase() : null

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:world_state') return
    let body
    try {
      const bytes = Buffer.from(packet.data)
      if (bytes.length > 65536) throw new Error('WORLD_REPLY_TOO_LARGE')
      body = JSON.parse(bytes.toString('utf8'))
    }
    catch (error) { events.emit('protocolError', error); return }
    if (!body || body.schemaVersion !== 1 || body.kind !== 'world_receipt' || typeof body.ok !== 'boolean') return
    if (closed || !ownUuid() || typeof body.playerUuid !== 'string' || body.playerUuid.toLowerCase() !== ownUuid()) {
      events.emit('protocolError', new Error('WORLD_REPLY_PLAYER_MISMATCH'))
      return
    }
    events.emit('receipt', body)
    const request = pending.get(body.requestId)
    if (request && request.playerUuid === ownUuid()) {
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
  }

  function clearPending (reason) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(reason))
    }
    pending.clear()
  }
  function onContextChange () { epoch++; clearPending('WORLD_CONTEXT_CHANGED') }
  function onEnd () { epoch++; closed = true; clearPending('WORLD_CONNECTION_CLOSED') }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  bot.on('spawn', onContextChange)
  bot.on('respawn', onContextChange)

  function look () {
    if (closed || !ownUuid()) return Promise.reject(new Error('WORLD_CONNECTION_UNAVAILABLE'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`WORLD_QUERY_TIMEOUT ${requestId}`))
      }, 4000)
      pending.set(requestId, { resolve, reject, timer, playerUuid: ownUuid() })
      try {
        bot._client.write('custom_payload', {
          channel: 'maw_agent:world_query',
          data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'look', requestId }), 'utf8')
        })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error)
      }
    })
  }

  async function lookAtBlock (block, offset = [0.5, 0.5, 0.5]) {
    if (!Array.isArray(offset) || offset.length !== 3 || offset.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error('INVALID_LOOK_OFFSET')
    }
    const observedEpoch = epoch, observedUuid = ownUuid()
    const checkContext = () => {
      if (closed || !observedUuid || epoch !== observedEpoch || observedUuid !== ownUuid()) throw new Error('WORLD_CONTEXT_CHANGED')
    }
    checkContext()
    await bot.lookAt(block.position.offset(...offset), true)
    // Forced lookAt only updates Mineflayer's local rotation. Its next physics
    // tick sends that rotation; querying earlier raycasts the previous view.
    // Body snapshots share the server's two-tick read budget. This wait also
    // ensures the rotation packet has reached the native server raycast.
    await bot.waitForTicks(2)
    checkContext()
    let receipt = await look()
    for (let retry = 0; receipt.code === 'rate_limited' && retry < 3; retry++) {
      await bot.waitForTicks(2); checkContext()
      receipt = await look()
    }
    checkContext()
    if (receipt.ok && (receipt.position.x !== block.position.x ||
        receipt.position.y !== block.position.y || receipt.position.z !== block.position.z)) {
      return { ...receipt, ok: false, code: 'different_visible_block', expectedPosition: block.position }
    }
    return receipt
  }

  return {
    events,
    look,
    lookAtBlock,
    detach: () => {
      bot._client.off('custom_payload', onPayload)
      bot.off('end', onEnd)
      bot.off('spawn', onContextChange)
      bot.off('respawn', onContextChange)
      onEnd()
    }
  }
}

module.exports = { attachWorldClient }

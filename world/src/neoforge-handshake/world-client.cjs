'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// Read-only, server-raycast native block identity. Proxy block names from the
// vanilla chunk stream are deliberately not used as a mod block's identity.
function attachWorldClient (bot) {
  const events = new EventEmitter()
  const pending = new Map()

  function onPayload (packet) {
    if (packet.channel !== 'maw_agent:world_state') return
    let body
    try { body = JSON.parse(Buffer.from(packet.data).toString('utf8')) }
    catch (error) { events.emit('protocolError', error); return }
    if (body.schemaVersion !== 1 || body.kind !== 'world_receipt') return
    events.emit('receipt', body)
    const request = pending.get(body.requestId)
    if (request) {
      clearTimeout(request.timer)
      pending.delete(body.requestId)
      request.resolve(body)
    }
  }

  function onEnd () {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('WORLD_CONNECTION_CLOSED'))
    }
    pending.clear()
  }

  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)

  function look () {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`WORLD_QUERY_TIMEOUT ${requestId}`))
      }, 4000)
      pending.set(requestId, { resolve, reject, timer })
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
    await bot.lookAt(block.position.offset(...offset), true)
    // Forced lookAt only updates Mineflayer's local rotation. Its next physics
    // tick sends that rotation; querying earlier raycasts the previous view.
    await bot.waitForTicks(1)
    const receipt = await look()
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
      onEnd()
    }
  }
}

module.exports = { attachWorldClient }

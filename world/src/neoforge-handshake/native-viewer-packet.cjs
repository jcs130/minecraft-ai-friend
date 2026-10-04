'use strict'

// Host-only mirror of packets received by this exact player connection, before
// the vanilla compatibility projection mutates their native registry IDs.
// Binary v1: MCNP + deflateRaw(v8.serialize(envelope)). This is deliberately a
// separate channel from the UTF-8 JSON skill/status contracts.
const v8 = require('node:v8')
const zlib = require('node:zlib')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')

const CHANNEL = 'mcviewer:native_packet'
const MAGIC = Buffer.from('MCNP')
const MAX_WIRE_BYTES = 1024 * 1024
const MAX_DECODED_BYTES = 16 * 1024 * 1024
const NAMES = new Set([
  'login', 'respawn', 'map_chunk', 'unload_chunk', 'block_change', 'multi_block_change',
  'tile_entity_data', 'update_light', 'spawn_entity', 'entity_metadata', 'entity_equipment',
  'entity_destroy', 'rel_entity_move', 'entity_move_look', 'entity_look', 'entity_teleport',
  'entity_head_rotation', 'entity_velocity', 'entity_status', 'animation', 'world_particles',
  'window_items', 'set_slot', 'trade_list', 'open_window', 'close_window',
  'update_time', 'game_state_change'
])

function registryHash (file) {
  if (!file) throw Error('NATIVE_VIEWER_STATES_FILE_REQUIRED')
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function encodeNativePacket (name, params, hash, sequence) {
  if (!NAMES.has(name)) return null
  if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(sequence) || sequence < 1) throw Error('NATIVE_VIEWER_ENVELOPE_INVALID')
  const data = v8.serialize({ schemaVersion: 1, minecraftVersion: '1.21.1', registrySha256: hash, sequence, name, params })
  if (data.length > MAX_DECODED_BYTES) throw Error('NATIVE_VIEWER_PACKET_TOO_LARGE')
  const wire = Buffer.concat([MAGIC, zlib.deflateRawSync(data, { level: 1 })])
  if (wire.length > MAX_WIRE_BYTES) throw Error('NATIVE_VIEWER_WIRE_TOO_LARGE')
  return wire
}

function decodeNativePacket (wire, expectedHash) {
  if (!Buffer.isBuffer(wire) || wire.length < 5 || wire.length > MAX_WIRE_BYTES || !wire.subarray(0, 4).equals(MAGIC)) throw Error('NATIVE_VIEWER_WIRE_INVALID')
  const data = zlib.inflateRawSync(wire.subarray(4), { maxOutputLength: MAX_DECODED_BYTES })
  const body = v8.deserialize(data)
  if (body.schemaVersion !== 1 || body.minecraftVersion !== '1.21.1' || body.registrySha256 !== expectedHash ||
      !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !NAMES.has(body.name) || !body.params || typeof body.params !== 'object') {
    throw Error('NATIVE_VIEWER_REGISTRY_OR_SCHEMA_MISMATCH')
  }
  return body
}

function attachNativeViewerPackets (bot, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error('NATIVE_VIEWER_EXPECTED_REGISTRY_REQUIRED')
  const events = new EventEmitter()
  let sequence = 0
  let failed = false
  const onPayload = packet => {
    if (packet.channel !== CHANNEL || failed) return
    try {
      const body = decodeNativePacket(packet.data, expectedHash)
      if (body.sequence !== sequence + 1) throw Error('NATIVE_VIEWER_SEQUENCE_GAP')
      sequence = body.sequence
      events.emit('packet', body)
    } catch (error) {
      failed = true
      events.emit('unavailable', error)
    }
  }
  const onEnd = () => { failed = true; events.emit('unavailable', Error('NATIVE_VIEWER_CONNECTION_CLOSED')) }
  bot._client.on('custom_payload', onPayload)
  bot.on('end', onEnd)
  return {
    events,
    health: () => ({ native: true, failed, packets: sequence, registrySha256: expectedHash }),
    detach: () => { bot._client.off('custom_payload', onPayload); bot.off('end', onEnd) }
  }
}

module.exports = { CHANNEL, NAMES, registryHash, encodeNativePacket, decodeNativePacket, attachNativeViewerPackets }

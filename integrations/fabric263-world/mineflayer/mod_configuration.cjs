'use strict'
const zlib = require('node:zlib')
const { TextDecoder } = require('node:util')
const utf8 = new TextDecoder('utf-8', { fatal: true })
const { viewChannels } = require('./views.cjs')

function utf (text) {
  const bytes = Buffer.from(text, 'utf8')
  return Buffer.concat([varint(bytes.length), bytes])
}

function varint (n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647) throw new Error('invalid_nonnegative_varint')
  const prefix = []
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; prefix.push(b) } while (n)
  return Buffer.from(prefix)
}

class Reader {
  constructor (data) {
    if (!Buffer.isBuffer(data) || data.length > 1024 * 1024) throw new Error('mod_configuration_budget')
    this.data = data; this.offset = 0
  }
  bool () {
    const b = this.data[this.offset++]
    if (b !== 0 && b !== 1) throw new Error('invalid_mod_configuration_boolean')
    return b === 1
  }
  int () {
    if (this.offset + 4 > this.data.length) throw new Error('truncated_mod_configuration_int')
    const n = this.data.readInt32BE(this.offset); this.offset += 4; return n
  }
  varint () {
    let n = 0; let shift = 0; let byte
    do {
      if (shift >= 35 || this.offset >= this.data.length) throw new Error('invalid_mod_configuration_varint')
      byte = this.data[this.offset++]; n += (byte & 0x7f) * 2 ** shift; shift += 7
    } while (byte & 0x80)
    if (n > 2147483647) throw new Error('invalid_mod_configuration_varint')
    return n
  }
  string () {
    const n = this.varint()
    if (n > 98301 || n < 0 || this.offset + n > this.data.length) throw new Error('mod_configuration_string_budget')
    const s = utf8.decode(this.data.subarray(this.offset, this.offset + n)); this.offset += n
    if (s.length > 32767) throw new Error('mod_configuration_character_budget')
    return s
  }
  chunks () {
    const n = this.int()
    if (n < 1 || n > 32) throw new Error('mod_configuration_chunk_budget')
    return Array.from({ length: n }, () => this.string()).join('')
  }
  end () { if (this.offset !== this.data.length) throw new Error('unexpected_mod_configuration_trailing_bytes') }
}

const definitions = {
  'bettercombat:config_sync': { key: 'betterCombatConfig', ack: 'bettercombat:config' },
  'bettercombat:weapon_registry': { key: 'betterCombatWeapons', ack: 'bettercombat:weapon_registry', chunks: true, compressedFlag: true },
  'spell_engine:config_sync': { key: 'spellEngineConfig', ack: 'spell_engine:config' },
  'spell_engine:spell_registry_sync': { key: 'spellAssignments', ack: 'spell_engine:spell_registry', chunks: true }
}

function parseConfiguration (channel, data) {
  const def = definitions[channel]
  if (!def) throw new Error('unsupported_mod_configuration_channel')
  const r = new Reader(data)
  const compressed = def.compressedFlag ? r.bool() : false
  let text = def.chunks ? r.chunks() : r.string()
  r.end()
  if (compressed) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('invalid_compressed_mod_configuration')
    text = utf8.decode(zlib.gunzipSync(Buffer.from(text, 'base64'), { maxOutputLength: 8 * 1024 * 1024 }))
  }
  const value = JSON.parse(text)
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('mod_configuration_object_required')
  return { ...def, value }
}

function attachModConfiguration (client, getNative, { extraPlayChannels = [] } = {}) {
  if (extraPlayChannels.length > 4 || extraPlayChannels.some(channel => channel !== 'maw_stock:snapshot')) throw new Error('unreviewed_extra_play_channel')
  const data = {}
  // ExactVersionPayload in the pinned Village Quest 2.6.3 is a unit codec,
  // identified by hex(UTF-8 version). This adapter implements that codec only
  // for the reviewed version, never mirrors an arbitrary advertised version.
  const villageVersionChannel = 'village-quest:exact_version/322e362e33'
  client.on('state', state => {
    if (state === 'configuration') client.write('custom_payload', {
      channel: 'minecraft:register', data: Buffer.from([...Object.keys(definitions), 'c:version', 'c:register'].join('\0'))
    })
  })
  client.on('custom_payload', packet => {
    if (packet.channel === 'c:version' || packet.channel === 'c:register') {
      try {
        const r = new Reader(packet.data)
        if (packet.channel === 'c:version') {
          const n = r.varint()
          if (n > 32 || n < 1) throw new Error('invalid_common_protocol_versions')
          const versions = Array.from({ length: n }, () => r.varint()); r.end()
          if (!versions.includes(1)) throw new Error('unsupported_fabric_common_protocol')
          data.commonProtocolVersion = 1
          client.write('custom_payload', { channel: packet.channel, data: Buffer.from([1, 1]) })
        } else {
          const version = r.varint(); const phase = r.string(); const n = r.varint()
          if (data.commonProtocolVersion !== 1 || version !== 1 || phase !== 'play' || n > 256) throw new Error('invalid_common_channel_registration')
          data.serverPlayChannels = Array.from({ length: n }, () => r.string()); r.end()
          const accepted = [villageVersionChannel, ...viewChannels(getNative()), 'maw_agent:menu_state', 'fabric-menu-api-v1:open_screen', ...extraPlayChannels]
          client.write('custom_payload', { channel: packet.channel,
            data: Buffer.concat([varint(1), utf('play'), varint(accepted.length), ...accepted.map(utf)]) })
        }
      } catch (error) { client.emit('error', error); client.end('invalid_fabric_common_protocol') }
      return
    }
    if (packet.channel === villageVersionChannel) {
      if (packet.data.length !== 0) { client.emit('error', new Error('invalid_village_quest_version_unit')); client.end('village_version_codec_mismatch'); return }
      data.villageQuestVersion = '2.6.3'
      return
    }
    if (!definitions[packet.channel]) return
    try {
      const result = parseConfiguration(packet.channel, packet.data)
      data[result.key] = result.value
      const namespace = packet.channel.split(':')[0]
      client.write('custom_payload', { channel: namespace + ':ack', data: utf(result.ack) })
      client.emit('maw_mod_configuration', { channel: packet.channel, imported: true, entries: Object.keys(result.value).length })
    } catch (error) { client.emit('error', error); client.end('invalid_mod_configuration') }
  })
  return data
}

module.exports = { utf, varint, Reader, parseConfiguration, attachModConfiguration }

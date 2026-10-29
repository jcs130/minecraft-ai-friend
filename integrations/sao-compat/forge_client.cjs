'use strict'

// Keep the upstream FML3 state machine; explicitly implement the pack's two
// extra LOGIN codecs. Unknown mod handshakes fail closed, never receive FML ACKs.
const path = require('node:path')
const crypto = require('node:crypto')
class Reader {
  constructor (data) { this.data = data; this.offset = 0 }
  uint () {
    let n = 0
    for (let shift = 0; shift < 35; shift += 7) {
      if (this.offset >= this.data.length) throw new Error('truncated_varint')
      const b = this.data[this.offset++]; n |= (b & 127) << shift
      if (!(b & 128)) return n >>> 0
    }
    throw new Error('overlong_varint')
  }
  bytes (n) {
    if (!Number.isSafeInteger(n) || n < 0 || n > 16 * 1024 * 1024 || this.offset + n > this.data.length) throw new Error('truncated_or_overlimit_buffer')
    const out = this.data.subarray(this.offset, this.offset + n); this.offset += n; return out
  }
  string () { return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(this.uint())) }
  int () { const b = this.bytes(4); return b.readInt32BE() }
  done () { if (this.offset !== this.data.length) throw new Error('trailing_handshake_bytes') }
}
function uint (n) {
  const bytes = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; bytes.push(b) } while (n)
  return Buffer.from(bytes)
}
function wrapped (channel, data) {
  const name = Buffer.from(channel, 'utf8')
  return Buffer.concat([uint(name.length), name, uint(data.length), data])
}
function string (text) { const data=Buffer.from(text,'utf8');return Buffer.concat([uint(data.length),data]) }
function array (rows,encode) { return Buffer.concat([uint(rows.length),...rows.map(encode)]) }
function withoutNumen (data) {
  const r=new Reader(data)
  if(r.uint()!==1)throw new Error('expected_fml_mod_list')
  function list(read) { const n=r.uint();if(n>4096)throw new Error('forge_list_budget');return Array.from({length:n},read) }
  const mods=list(()=>r.string()),channels=list(()=>({name:r.string(),marker:r.string()})),registries=list(()=>r.string())
  list(()=>r.string());r.done() // server's datapack-registry advertisements
  return Buffer.concat([uint(2),array(mods.filter(m=>!['numen','numen_api'].includes(m)),string),
    array(channels.filter(c=>c.marker!=='FML3'&&!c.name.startsWith('numen:')&&!c.name.startsWith('numen_api:')),c=>Buffer.concat([string(c.name),string(c.marker)])),
    array(registries,name=>Buffer.concat([string(name),string('1.0')]))])
}
function extraHandshake (channel, payload) {
  const r = new Reader(payload); const discriminator = r.uint()
  if (channel === 'tacz:handshake' && discriminator === 2) {
    const count = r.int()
    if (count < 0 || count > 16384) throw new Error('tacz_mapping_budget')
    const mappings = []
    for (let i = 0; i < count; i++) mappings.push({ entity: r.string(), key: r.string(), id: r.uint() })
    r.done()
    return { ack: uint(1), state: { kind: 'tacz_entity_data_mapping', mappings } }
  }
  if (channel === 'eclipticseasons:main' && discriminator === 12) {
    const name = r.string(); const data = r.bytes(r.uint()); r.done()
    // Retain as data only. Never write a server-supplied filename or execute config.
    return { ack: uint(99), state: { kind: 'ecliptic_server_config', name,
      bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), text: data.toString('utf8') } }
  }
  throw new Error(`unsupported_mod_login:${channel}:${discriminator}`)
}
function attachForge (client, root, onState = () => {}, { numenClient = false } = {}) {
  const original = new Set(client.listeners('login_plugin_request'))
  let handler
  try { handler = require('minecraft-protocol-forge/src/client/forgeHandshake3.js') } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'minecraft-protocol-forge/src/client/forgeHandshake3.js'")) throw error
    // The preparation lab also retains the reviewed upstream Git checkout.
    handler = require(path.join(root, 'forge-handshake-upstream/src/client/forgeHandshake3.js'))
  }
  handler(client, {})
  const listener = client.listeners('login_plugin_request').find(f => !original.has(f))
  if (!listener) throw new Error('upstream_fml3_listener_missing')
  client.removeListener('login_plugin_request', listener)
  client.on('login_plugin_request', packet => {
    try {
      if (packet.channel !== 'fml:loginwrapper') throw new Error(`unsupported_login_channel:${packet.channel}`)
      const reader = new Reader(packet.data); const channel = reader.string(); const data = reader.bytes(reader.uint()); reader.done()
      if (channel === 'fml:handshake') {
        const fml = new Reader(data); const discriminator = fml.uint()
        if (discriminator === 1 && !numenClient) {
          client.write('login_plugin_response',{messageId:packet.messageId,data:wrapped(channel,withoutNumen(data))})
          onState({channel,kind:'numen_client_absent',clientModInstalled:false})
          return
        }
        if (discriminator === 6) {
          const n=fml.uint();if(n>256)throw new Error('forge_mismatch_budget')
          const mismatches=Array.from({length:n},()=>({channel:fml.string(),version:fml.string()}));fml.done()
          throw new Error(`forge_channel_version_mismatch:${JSON.stringify(mismatches)}`)
        }
        if (discriminator === 3) {
          // Forge 47's Snapshot differs from the upstream plugin schema.
          // Retain the whole native registry; the bot remains inert until the
          // same JVM's authoritative numeric registry export is installed.
          const name = fml.string(); const present = fml.bytes(1)[0]
          if (present > 1) throw new Error('invalid_forge_snapshot_presence')
          const snapshot = fml.bytes(data.length - fml.offset); fml.done()
          onState({ channel, kind: 'forge_registry', name, present: !!present,
            bytes: snapshot.length, snapshot, applied: false })
          client.write('login_plugin_response', { messageId: packet.messageId, data: wrapped(channel, uint(99)) })
          return
        }
        return listener(packet)
      }
      const response = extraHandshake(channel, data)
      onState({ channel, ...response.state })
      client.write('login_plugin_response', { messageId: packet.messageId, data: wrapped(channel, response.ack) })
    } catch (error) { client.emit('error', error); client.end('unsupported_or_invalid_forge_handshake') }
  })
}
module.exports = { Reader, uint, wrapped, extraHandshake, attachForge, withoutNumen }

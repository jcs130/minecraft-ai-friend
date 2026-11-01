'use strict'
const crypto = require('node:crypto')
const { loginBootstrap, fabricConfiguration, applyRegistry } = require('../mineflayer/native_registry.cjs')
const { strictParser, nativeProtocolOverrides } = require('../mineflayer/native_protocol.cjs')
const { attachModConfiguration } = require('../mineflayer/mod_configuration.cjs')
const { attachViews } = require('../mineflayer/views.cjs')
const { attachMenus } = require('../mineflayer/menus.cjs')

function attributePacket (base, mappings) {
  const packet = structuredClone(base.play.toClient.types.packet_entity_update_attributes)
  const properties = packet[1].find(field => field.name === 'properties')
  properties.type[1].type[1].find(field => field.name === 'key').type = ['mapper', { type: 'varint', mappings }]
  return packet
}

function vanillaProtocol (vanilla) {
  const mappings = Object.fromEntries(vanilla.attributesArray.map((row, index) => [index, row.resource]))
  return { '26.3': { play: { toClient: { types: { packet_entity_update_attributes: attributePacket(vanilla.protocol, mappings) } } } } }
}

// The bridge implements the mod protocols on the server. No Mineflayer body or
// second physics/controller loop runs here; player actions come from the peer.
function connectBackend (req, options) {
  const client = req('minecraft-protocol').createClient({ ...options, version: '26.3', auth: 'offline' })
  let loginIdentity
  client.once('success', packet => { loginIdentity = packet })
  client.on('ping', packet => { if (client.state === 'configuration') client.write('pong', { id: packet.id }) })
  strictParser(client)
  const login = loginBootstrap(client)
  let data
  fabricConfiguration(client, () => data)
  const mods = attachModConfiguration(client, () => data, { extraPlayChannels: ['maw_stock:snapshot'] })
  const views = attachViews(client, () => data)
  const menus = attachMenus(client, () => data)
  const recipeBook = new Map()
  client.on('recipe_book_add', packet => {
    try {
      if (packet.replace) recipeBook.clear()
      for (const row of packet.entries) {
        if (recipeBook.size >= 4096 && !recipeBook.has(row.recipe.displayId)) throw new Error('native_recipe_book_budget')
        recipeBook.set(row.recipe.displayId, { ...row, observedAt: new Date().toISOString() })
      }
    } catch (error) { client.emit('error', error); client.end('native_recipe_book_budget') }
  })
  client.on('recipe_book_remove', packet => { for (const id of packet.recipeIds || []) recipeBook.delete(id) })
  const pendingReads = new Map()
  client.on('custom_payload', packet => {
    if (packet.channel !== 'maw_stock:snapshot') return
    try {
      if (packet.data.length > 12288) throw new Error('body_snapshot_budget')
      const row = JSON.parse(packet.data.toString('utf8'))
      if (row.schemaVersion !== 1 || row.bodyId !== client.uuid || !Number.isFinite(Date.parse(row.observedAt))) throw new Error('invalid_body_snapshot_identity')
      const pending = pendingReads.get(row.requestId)
      if (!pending) return
      pendingReads.delete(row.requestId); clearTimeout(pending.timer); pending.resolve(row)
    } catch (error) { client.emit('error', error); client.end('invalid_authoritative_body_snapshot') }
  })
  client.once('end', () => { for (const pending of pendingReads.values()) { clearTimeout(pending.timer); pending.reject(new Error('body_connection_closed')) } pendingReads.clear() })
  const read = (kind, position) => new Promise((resolve, reject) => {
    if (pendingReads.size >= 8 || !['status', 'block'].includes(kind)) { reject(new Error('body_read_budget_or_kind')); return }
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => { pendingReads.delete(requestId); reject(new Error('authoritative_body_read_timeout')) }, 2000)
    pendingReads.set(requestId, { resolve, reject, timer })
    client.write('custom_payload', { channel: 'maw_stock:read', data: Buffer.from(JSON.stringify({ requestId, kind, ...position }), 'utf8') })
  })
  const originalEmit = client.emit
  client.emit = function (name, ...args) {
    if (name === 'open_window' && menus.holdOpen(args[0])) return true
    return originalEmit.call(this, name, ...args)
  }
  menus.setDeliver((name, ...args) => originalEmit.call(client, name, ...args))
  const ready = login.promise.then(native => {
    data = native
    const registry = req('prismarine-registry')('26.3')
    applyRegistry(registry, native)
    const base = req('minecraft-data')('26.3').protocol
    const overrides = nativeProtocolOverrides(native, base)
    const attributes = native.fabricRegistries?.['minecraft:attribute']
    if (!attributes) throw new Error('native_attribute_registry_required')
    overrides['26.3'].play.toClient.types.packet_entity_update_attributes = attributePacket(base,
      Object.fromEntries(Object.entries(attributes).map(([name, id]) => [id, name])))
    client.customPackets = overrides
    login.ready()
    return { data, registry }
  })
  ready.catch(error => { client.emit('error', error); client.end('native_backend_bootstrap_failed') })
  return { client, ready, read, mods, views, menus, recipeBook, get data () { return data }, get loginIdentity () { return loginIdentity } }
}

module.exports = { connectBackend, attributePacket, vanillaProtocol }

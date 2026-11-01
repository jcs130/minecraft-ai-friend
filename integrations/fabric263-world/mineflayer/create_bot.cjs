'use strict'

const { createRequire } = require('node:module')
const path = require('node:path')
const { applyRegistry, loginBootstrap, fabricConfiguration } = require('./native_registry.cjs')
const { attachModConfiguration } = require('./mod_configuration.cjs')
const { attachViews } = require('./views.cjs')
const { attachMenus } = require('./menus.cjs')
const { attachRecipes } = require('./recipes.cjs')
const { strictParser, nativeProtocolOverrides } = require('./native_protocol.cjs')

function normalizePacket (name, packet) {
  if ((name === 'rel_entity_move' || name === 'entity_move_look') && packet.move) {
    packet.dX = 0
    packet.dY = 0
    packet.dZ = 0
    for (const step of packet.move.steps) {
      packet.dX += step.dX
      packet.dY += step.dY
      packet.dZ += step.dZ
    }
    packet.onGround = packet.move.onGround
  }
  if (name === 'sync_entity_position') {
    if (packet.positionType === 'stepped') {
      const final = packet.steps.at(-1)
      if (!final) throw new Error('Empty native entity position path')
      Object.assign(packet, { x: final.x, y: final.y, z: final.z })
    }
    // This packet no longer carries velocity. Do not retain stale velocity or
    // claim these zeros are measured native motion in structured observations.
    packet.dx = packet.dy = packet.dz = 0
  }
  return packet
}

function createBot ({ runtime, ...options }) {
  if (!runtime) throw new TypeError('runtime is required')
  if (options.version && options.version !== '26.3') throw new TypeError('Expected native Minecraft 26.3')
  const req = createRequire(path.resolve(runtime, 'package.json'))
  const protocol = req('minecraft-protocol')
  const client = protocol.createClient({ ...options, version: '26.3' })
  strictParser(client)
  const native = loginBootstrap(client)
  let nativeData
  fabricConfiguration(client, () => nativeData)
  const modData = attachModConfiguration(client, () => nativeData)
  const views = attachViews(client, () => nativeData)
  const menus = attachMenus(client, () => nativeData)
  const emit = client.emit
  client.emit = function (name, ...args) {
    if (name === 'open_window' && menus.holdOpen(args[0])) return true
    if (name === 'rel_entity_move' || name === 'entity_move_look' || name === 'sync_entity_position') normalizePacket(name, args[0])
    return emit.call(this, name, ...args)
  }
  menus.setDeliver((name, ...args) => emit.call(client, name, ...args))
  const bot = req('mineflayer').createBot({ ...options, version: '26.3', client, nativeWindowFactory: menus.factory,
    registryBootstrap: async registry => {
      nativeData = await native.promise
      client.customPackets = nativeProtocolOverrides(nativeData, req('minecraft-data')('26.3').protocol)
      return applyRegistry(registry, nativeData)
    } })
  bot.once('inject_allowed', native.ready)
  bot.native263 = { modData, views, menus, get registry () { return nativeData } }
  bot.once('inject_allowed', () => { bot.native263.recipes = attachRecipes(bot, nativeData.gridRecipes, req) })
  const recipeBook = new Map()
  client.on('recipe_book_add', packet => {
    if (packet.replace) recipeBook.clear()
    for (const entry of packet.entries) recipeBook.set(entry.recipe.displayId, { ...entry, observedAt: new Date().toISOString() })
  })
  client.on('recipe_book_remove', packet => { for (const id of packet.recipeIds || []) recipeBook.delete(id) })
  bot.native263.recipeBook = { list: () => [...recipeBook.keys()], get: id => recipeBook.has(id) ? structuredClone(recipeBook.get(id)) : null }
  return bot
}

module.exports = { createBot, normalizePacket }

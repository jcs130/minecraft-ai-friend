'use strict'
// Selected Mineflayer-shaped APIs on ONE real Java client. No minecraft-protocol transport.
const { EventEmitter } = require('node:events'), crypto = require('node:crypto')
const { Vec3 } = require('vec3')
const AStar = require('mineflayer-pathfinder/lib/astar'), Move = require('mineflayer-pathfinder/lib/move')
const goals = require('mineflayer-pathfinder').goals
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
const item = (v, slot) => v ? { ...structuredClone(v), slot, name: v.id.replace(/^minecraft:/, ''), displayName: v.name, stackSize: v.maxStackSize } : null
const error = (code, result) => Object.assign(Error(code), { code, result, retryAutomatically: false })

async function createMineflayerFacade (adapter) {
  if ((await adapter.identity()).provider !== 'java-client') throw Error('facade_requires_java_client_provider')
  const bot = new EventEmitter(), blocks = new Map()
  let snapshot, stopped = false, chatSeq = 0, chatConnection = null
  bot.compatibility = { bodyProvider: 'java-client', secondConnection: false, unmodifiedPluginsVerified: false,
    pathPlanner: 'mineflayer-pathfinder AStar/Move/goals', pathExecution: 'native_client_physics', planningData: 'actual_client_collision_shapes' }
  bot.refresh = async () => {
    snapshot = await adapter.snapshot(); if (!snapshot.ok) throw error('java_client_snapshot_unavailable', snapshot)
    bot.username = snapshot.username; bot.health = snapshot.health; bot.food = snapshot.hunger
    bot.entity = { id: snapshot.entityId, uuid: snapshot.bodyId, position: new Vec3(snapshot.position.x, snapshot.position.y, snapshot.position.z),
      yaw: Math.PI - snapshot.yaw * Math.PI / 180, pitch: -snapshot.pitch * Math.PI / 180, onGround: snapshot.onGround, effects: {} }
    bot.inventory = { slots: snapshot.inventory.slots.map(item), items () { return this.slots.filter(Boolean).filter(i => i.slot >= 9 && i.slot <= 44) } }
    bot.heldItem = bot.inventory.slots[36 + snapshot.selectedHotbarSlot]
    bot.currentWindow = snapshot.menu.windowId ? { id: snapshot.menu.windowId, title: snapshot.menu.title, slots: snapshot.menu.slots.map(s => item(s.item, s.slot)) } : null
    bot.emit('physicsTick'); return snapshot
  }
  bot.refreshWorld = async (radius = 8) => {
    const value = await adapter.read('body.observe', { radius }); if (!value.ok) throw error('java_client_observation_unavailable', value)
    blocks.clear()
    for (const b of value.blocks) if (b.available) blocks.set(key(b.position), {
      ...b, position: new Vec3(b.position.x, b.position.y, b.position.z), name: b.id.replace(/^minecraft:/, ''), fullName: b.id,
      shapes: b.collisionShapes, boundingBox: b.collisionShapes.length ? 'block' : 'empty', diggable: b.destroySpeed >= 0,
      getProperties: () => structuredClone(b.properties)
    })
    bot.entities = Object.fromEntries(value.entities.map(e => [e.entityId, { ...e, id: e.entityId, position: new Vec3(e.position.x, e.position.y, e.position.z) }]))
    return value
  }
  bot.blockAt = position => blocks.get(key(position)) || null
  bot.refreshChat = async () => {
    await bot.refresh()
    if (chatConnection !== snapshot.connectionId) { chatSeq = 0; chatConnection = snapshot.connectionId }
    const value = await adapter.read('chat.recent', { afterSeq: chatSeq, limit: 64 })
    if (!value.ok) throw error('java_client_chat_unavailable', value)
    for (const message of value.messages) { chatSeq = Math.max(chatSeq, message.seq); bot.emit('messagestr', message.text, message.overlay ? 'game_info' : 'system'); bot.emit('clientChat', message) }
    return value
  }
  bot.findBlocks = ({ matching, maxDistance = 8, count = 1, point = bot.entity.position }) => [...blocks.values()]
    .filter(b => b.position.distanceTo(point) <= maxDistance && (typeof matching === 'function' ? matching(b) : (Array.isArray(matching) ? matching : [matching]).includes(b.type)))
    .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point)).slice(0, count).map(b => b.position.clone())
  bot.findBlock = options => { const [p] = bot.findBlocks({ ...options, count: 1 }); return p ? bot.blockAt(p) : null }
  async function act (operation, args = {}, actionId = `java-${crypto.randomUUID()}`) {
    const accepted = await adapter.submit({ action_id: actionId, operation, args })
    if (!accepted.accepted && !accepted.terminal) throw error(accepted.code || 'java_client_action_rejected', accepted)
    const result = accepted.terminal ? accepted : await adapter.wait(actionId, { timeoutMs: 20000 })
    if (!result.ok || !result.terminal || result.outcomeKnown !== true) throw error(result.code || 'java_client_action_unconfirmed', result)
    await bot.refresh(); return result
  }
  bot.look = (yaw, pitch) => act('control.look', { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI })
  bot.lookAt = p => {
    const from = bot.entity.position.offset(0, 1.62, 0), dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z
    return act('control.look', { yaw: Math.atan2(-dx, dz) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI })
  }
  bot.chat = text => act('chat.send', { text })
  bot.setQuickBarSlot = async slot => { await bot.refresh(); return act('inventory.selectHotbar', { hotbarSlot: slot, expectedSnbt: snapshot.inventory.slots[36 + slot]?.snbt || '' }) }
  bot.clickWindow = async (slot, button, mode) => {
    const types = { 0: 'PICKUP', 1: 'QUICK_MOVE', 2: 'SWAP' }; if (!types[mode]) throw Error('facade_click_mode_unavailable')
    await bot.refresh(); const menu = snapshot.menu
    return act('menu.click', { windowId: menu.windowId, expectedStateId: menu.stateId, slot, button, clickType: types[mode],
      expectedSnbt: menu.slots[slot]?.item?.snbt || '', expectedCarriedSnbt: menu.carried?.snbt || '' })
  }
  bot.closeWindow = async () => { await bot.refresh(); return act('menu.close', { windowId: snapshot.menu.windowId }) }
  bot.equip = async (stack, destination) => {
    if (destination !== 'hand') throw Error('facade_equip_destination_unavailable')
    await bot.refresh(); const own = bot.inventory.slots[stack.slot]
    if (!own || own.snbt !== stack.snbt) throw Error('facade_inventory_item_changed')
    if (stack.slot >= 36 && stack.slot <= 44) return bot.setQuickBarSlot(stack.slot - 36)
    if (snapshot.menu.windowId !== 0) throw Error('facade_close_container_before_equip')
    return bot.clickWindow(stack.slot, snapshot.selectedHotbarSlot, 2)
  }
  bot.dig = async block => { await bot.lookAt(block.position.offset(.5,.5,.5)); return act('world.dig', { position: { x: block.position.x, y: block.position.y, z: block.position.z } }) }
  bot.activateBlock = async block => { await bot.lookAt(block.position.offset(.5,.5,.5)); return act('world.useBlock', { position: { x: block.position.x, y: block.position.y, z: block.position.z } }) }
  bot.placeBlock = async (reference, faceVector) => {
    if (Math.abs(faceVector.x)+Math.abs(faceVector.y)+Math.abs(faceVector.z)!==1 || ![faceVector.x,faceVector.y,faceVector.z].every(Number.isInteger)) throw Error('facade_block_face_invalid')
    await bot.refresh(); const held = bot.heldItem; if (!held) throw Error('facade_no_held_item')
    const p = reference.position, target = p.plus(faceVector)
    const before = await adapter.read('world.blockAt', { position: { x:target.x,y:target.y,z:target.z } })
    const face = faceVector.x===1?'east':faceVector.x===-1?'west':faceVector.y===1?'up':faceVector.y===-1?'down':faceVector.z===1?'south':'north'
    await bot.lookAt(p.offset(.5+.5*faceVector.x,.5+.5*faceVector.y,.5+.5*faceVector.z))
    const result = await act('world.useBlock',{ position:{x:p.x,y:p.y,z:p.z},face,expectedHeldSnbt:held.snbt })
    const after = await adapter.read('world.blockAt',{position:{x:target.x,y:target.y,z:target.z}})
    if(!after.block?.available||after.block.isAir||after.block.stateId===before.block?.stateId)throw error('facade_placement_not_confirmed',{result,after})
    return {...result,placedBlock:after.block}
  }
  bot.activateItem = async (offhand = false) => { if (offhand) throw Error('facade_offhand_use_unavailable'); return act('world.useItem', { ticks: 40 }) }
  bot.deactivateItem = () => adapter.stop()
  bot.attack = async entity => { await bot.lookAt(entity.position.offset(0,.9,0)); return act('world.attack', { entityId: entity.id, expectedUuid: entity.uuid }) }
  bot.pressControls = (controls, ticks = 10) => act('control.keys', { controls, ticks })
  bot.clearControlStates = () => adapter.stop()
  const unsafe = b => !b || !!b.fluid || /(?:lava|fire|magma_block|cactus|sweet_berry_bush|powder_snow)$/.test(b.id)
  function standing (p) {
    const feet = bot.blockAt(p), head = bot.blockAt(p.offset(0,1,0)), floor = bot.blockAt(p.offset(0,-1,0))
    return !unsafe(feet) && !unsafe(head) && !unsafe(floor) && feet.shapes.length === 0 && head.shapes.length === 0 &&
      floor.shapes.some(s => s[0] <= .2 && s[2] <= .2 && s[3] >= .8 && s[5] >= .8 && s[4] >= .99)
  }
  function plan (goal) {
    const start = bot.entity.position.floored()
    const movements = { getNeighbors: node => {
      const result = []
      for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) for (const dy of [0,1,-1]) {
        const p = new Vec3(node.x + dx,node.y + dy,node.z + dz)
        if (standing(p) && (dy <= 0 || !unsafe(bot.blockAt(new Vec3(node.x,node.y+2,node.z))) && bot.blockAt(new Vec3(node.x,node.y+2,node.z)).shapes.length === 0)) {
          result.push(new Move(p.x,p.y,p.z,0,dy === 0 ? 1 : 1.5)); break
        }
      }
      return result
    } }
    const search = new AStar(new Move(start.x,start.y,start.z,0,0),movements,goal,1000,10,16)
    let result; do { result = search.compute() } while (result.status === 'partial')
    return { status: result.status, cost: result.cost, path: result.path.map(p => ({ x:p.x,y:p.y,z:p.z })), visitedNodes: result.visitedNodes }
  }
  bot.pathfinder = {
    async getPathTo (goal) { await bot.refresh(); await bot.refreshWorld(); return plan(goal) },
    async goto (goal, { actionPrefix = `walk-${crypto.randomUUID()}` } = {}) {
      if (!/^[A-Za-z0-9_.-]{1,48}$/.test(actionPrefix)) throw Error('facade_path_action_prefix_invalid')
      stopped = false; await bot.refresh(); await bot.refreshWorld(); const route = plan(goal)
      if (route.status !== 'success') throw error('native_collision_path_unavailable', route)
      for (let i=0;i<route.path.length;i++) { if (stopped) throw Error('facade_path_stopped'); await act('body.move', { position: route.path[i] },`${actionPrefix}-${i}`) }
      await bot.refresh(); if (!goal.isEnd(bot.entity.position.floored())) throw Error('facade_path_final_position_not_reached')
      return { ...route, actualPosition: bot.entity.position.clone(), physics: 'original_java_client' }
    },
    stop () { stopped = true; return adapter.stop() }
  }
  bot.end = () => adapter.close()
  await bot.refresh(); return bot
}
module.exports = { createMineflayerFacade, goals }

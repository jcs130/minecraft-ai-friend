'use strict'

function attachMenus (client, getNative) {
  const layouts = new Map(); const pending = new Map()
  let deliver = null
  client.on('custom_payload', packet => {
    if (packet.channel === 'fabric-menu-api-v1:open_screen') {
      try {
        if (!Buffer.isBuffer(packet.data) || packet.data.length > 65536) throw new Error('extended_menu_packet_budget')
        const parsed = client.deserializer.proto.parsePacketBuffer('MawExtendedMenu', packet.data)
        if (parsed.metadata.size !== packet.data.length) throw new Error('extended_menu_trailing_bytes')
        const row = parsed.data
        const type = getNative().menus.find(m => m.name === row.identifier)
        if (!type || row.containerId < 1) throw new Error('unknown_extended_native_menu')
        client.emit('open_window', { windowId: row.containerId, inventoryType: type.id, windowTitle: row.title,
          nativeExtraDataBytes: row.extraData.length })
      } catch (error) { client.emit('error', error); client.end('invalid_extended_native_menu') }
      return
    }
    if (packet.channel !== 'maw_agent:menu_state') return
    try {
      if (!Buffer.isBuffer(packet.data) || packet.data.length > 65536) throw new Error('native_menu_budget')
      const row = JSON.parse(packet.data.toString('utf8'))
      const native = getNative()
      if (native.menuBridge !== packet.channel || row.schemaVersion !== 1 || row.bodyId !== client.uuid || row.complete !== true ||
          !Number.isInteger(row.windowId) || row.windowId < 0 || !Number.isInteger(row.slotCount) || row.slotCount > 256 || row.slotCount < 1 ||
          row.slots?.length !== row.slotCount || row.slots.some((s, i) => s.index !== i) ||
          row.inventoryStart < 0 || row.inventoryEnd - row.inventoryStart !== 36 || row.inventoryEnd > row.slotCount) throw new Error('invalid_native_menu_layout')
      layouts.set(row.windowId, row)
      const queued = pending.get(row.windowId)
      if (queued) { clearTimeout(queued.timer); pending.delete(row.windowId); deliver('open_window', queued.packet) }
      client.emit('maw_native_menu', { windowId: row.windowId, nativeId: row.nativeId, slotCount: row.slotCount })
    } catch (error) { client.emit('error', error); client.end('invalid_native_menu') }
  })
  client.once('end', () => { for (const row of pending.values()) clearTimeout(row.timer); pending.clear() })
  return {
    layouts,
    setDeliver: callback => { deliver = callback },
    holdOpen: packet => {
      const layout = layouts.get(packet.windowId)
      const type = getNative()?.menus.find(m => m.id === packet.inventoryType)?.name
      if (layout && layout.nativeId === type) return false
      if (pending.size > 4 || pending.has(packet.windowId)) throw new Error('native_menu_queue_budget')
      const timer = setTimeout(() => { pending.delete(packet.windowId); client.emit('error', new Error('native_menu_layout_not_received')); client.end('unknown_native_menu') }, 5000)
      timer.unref?.()
      pending.set(packet.windowId, { packet, timer })
      return true
    },
    factory: ({ bot, windows, original, id, type, title, slotCount }) => {
      if (id === 0 && type === 'minecraft:inventory') return original(id, type, title, slotCount)
      const layout = layouts.get(id)
      if (!layout) throw new Error('native_menu_layout_required')
      const window = new windows.Window(id, layout.nativeId, title, layout.slotCount,
        { start: layout.inventoryStart, end: layout.inventoryEnd - 1 }, layout.resultSlot, true)
      window.nativeLayout = structuredClone(layout)
      return window
    }
  }
}

module.exports = { attachMenus }

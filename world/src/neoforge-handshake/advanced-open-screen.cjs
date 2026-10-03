'use strict'

const nbt = require('prismarine-nbt')

function readVarInt (data, offset) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (offset + i >= data.length) throw new Error('truncated varint')
    const byte = data[offset + i]
    value |= (byte & 0x7f) << (7 * i)
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: offset + i + 1 }
  }
  throw new Error('oversized varint')
}

function decodeAdvancedOpenScreen (data) {
  if (!Buffer.isBuffer(data) || data.length < 4 || data.length > 16384) throw new Error('invalid menu payload size')
  const window = readVarInt(data, 0)
  const menu = readVarInt(data, window.next)
  const title = nbt.protos.big.parsePacketBuffer('anonymousNbt', data, menu.next)
  const tail = readVarInt(data, menu.next + title.metadata.size)
  if (tail.value > 4096 || tail.next + tail.value !== data.length) throw new Error('invalid menu extra data')
  return { windowId: window.value, menuTypeId: menu.value, title: title.data, additionalData: data.subarray(tail.next) }
}

// This is deliberately a narrow protocol adapter. The cooking pot has nine
// server-side menu slots, so a vanilla 9x1 menu preserves its slot indices.
// Other mod menus require their own slot-layout validation before translation.
function cookingPotWindow (data) {
  const screen = decodeAdvancedOpenScreen(data)
  if (screen.menuTypeId !== 25 || screen.title?.value?.translate?.value !== 'container.farmersdelight.cooking_pot') return null
  return { windowId: screen.windowId, inventoryType: 0, windowTitle: screen.title }
}

module.exports = { decodeAdvancedOpenScreen, cookingPotWindow }

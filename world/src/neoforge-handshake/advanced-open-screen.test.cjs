'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { decodeAdvancedOpenScreen, cookingPotWindow } = require('./advanced-open-screen.cjs')

// Captured from NeoForge 21.1.248 when a real Farmer's Delight 1.3.4 pot was opened.
const cookingPot = Buffer.from(
  '02190a0800097472616e736c6174650024636f6e7461696e65722e6661726d65727364656c696768742e636f6f6b696e675f706f740008ffffffffffffe040',
  'hex'
)

test('verified cooking pot payload keeps the server window ID and title', () => {
  const screen = decodeAdvancedOpenScreen(cookingPot)
  assert.equal(screen.windowId, 2)
  assert.equal(screen.menuTypeId, 25)
  assert.equal(screen.title.value.translate.value, 'container.farmersdelight.cooking_pot')
  assert.equal(screen.additionalData.length, 8)
  assert.deepEqual(cookingPotWindow(cookingPot), {
    windowId: 2,
    inventoryType: 0,
    windowTitle: screen.title
  })
})

test('unknown or truncated mod menu is not converted into a fake container', () => {
  const unknown = Buffer.from(cookingPot)
  unknown[1] = 26
  assert.equal(cookingPotWindow(unknown), null)
  assert.throws(() => decodeAdvancedOpenScreen(cookingPot.subarray(0, -1)), /invalid menu extra data/)
})

test('FOM resolves its own cooking-pot registry ID, including a player-named pot', () => {
  const moved = Buffer.from(cookingPot); moved[1] = 91
  assert.equal(cookingPotWindow(moved), null)
  assert.equal(cookingPotWindow(moved, new Map([[91, 'other:machine']])), null)
  assert.equal(cookingPotWindow(moved, new Map([[91, 'farmersdelight:cooking_pot']])).inventoryType, 0)
  const nbt = require('prismarine-nbt')
  const named = Buffer.concat([Buffer.from([2, 91]), nbt.protos.big.createPacketBuffer('anonymousNbt', { type: 'string', value: '萌萌的锅' }), Buffer.from([0])])
  assert.equal(cookingPotWindow(named, new Map([[91, 'farmersdelight:cooking_pot']])).windowTitle.value, '萌萌的锅')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createObserverInventoryReader, nativeInventorySlot, observerEquipmentSlot, observerItemIdentity, parseObserverInventory } from '../src/observer-inventory.mts'
import { createEyeController } from '../admin/eye-service.mts'
import { serializeViewerItem } from '../src/mc-modern-viewer.mts'
const prefix = 'Goddess has the following entity data: '
const response = prefix + '[{count: 1, Slot: 0b, components: {"patchouli:book": "touhou_little_maid:memorizable_gensokyo"}, id: "patchouli:guide_book"}]'
function fixture() {
  let time = Date.now(), current, calls = 0, output = response
  const slots = Array(46).fill(null); slots[36] = { name: 'unknown', displayName: 'unknown', type: 6000, count: 1, slot: 36 }
  const bot = { username: 'Goddess', version: '1.21.1', _client: { state: 'play' }, quickBarSlot: 0,
    entity: { position: { x: 0, y: 70, z: 0 }, equipment: [slots[36]] }, inventory: Object.assign(new EventEmitter(), { slots }), players: {}, game: { dimension: 'minecraft:overworld' } }
  current = bot
  const options = { getBot: () => current, sendCommand: async command => { assert.equal(command, 'data get entity Goddess Inventory'); calls++; if (output instanceof Error) throw output; return output }, now: () => time }
  return { bot, options, reader: createObserverInventoryReader(options), count: () => calls,
    advance: n => { time += n }, now: () => time, setOutput: value => { output = value }, replace: value => { current = value } }
}
test('canonical slots parse without mistaking nested components/book text for actual item identity', () => {
  assert.deepEqual(parseObserverInventory(response), [{ slot: 36, name: 'patchouli:guide_book', count: 1 }])
  assert.deepEqual(parseObserverInventory(prefix + '[]'), [])
  const nested = prefix + '[{Slot:1b,count:2,components:{custom:[{id:"minecraft:diamond",Slot:0b,count:64}],text:\'"id": "fake:item", ] }\'},id:"qiandeng_chanting:resonance_staff"}]'
  assert.deepEqual(parseObserverInventory(nested), [{ slot: 37, name: 'qiandeng_chanting:resonance_staff', count: 2 }])
  assert.deepEqual([0, 8, 9, 35, 100, 101, 102, 103, -106, 104].map(nativeInventorySlot), [36, 44, 9, 35, 8, 7, 6, 5, 45, null])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => observerEquipmentSlot({ quickBarSlot: 3 }, i)), [39, 45, 8, 7, 6, 5])
})
test('bad, oversized, ambiguous and other-player inventory replies fail closed', () => {
  for (const raw of [response.replace('Goddess', 'MengMeng'), response.slice(0, -1), response + 'unexpected',
    prefix + '[{Slot:0b,count:1,id:"a:b",id:"a:c"}]', prefix + '[{Slot:0b,count:1,id:"a:b"},{Slot:0b,count:1,id:"a:b"}]',
    prefix + '[{Slot:0b,count:1.5,id:"a:b"}]', prefix + '[{Slot:0b,count:0,id:"a:b"}]', prefix + '[{Slot:36b,count:1,id:"a:b"}]',
    prefix + '[{Slot:0b,count:1,id:"a:b\nkill"}]', 'x'.repeat(32769)]) assert.throws(() => parseObserverInventory(raw))
})
test('reader is read-only, observer-only, rate-limited and keeps protocol inventory untouched', async () => {
  const f = fixture(), before = structuredClone(f.bot.inventory.slots)
  assert.equal(await f.reader.refresh(), true)
  assert.equal(await f.reader.refresh(), false); assert.equal(f.count(), 1)
  assert.equal(observerItemIdentity(f.bot, f.bot.inventory.slots[36], 36, f.now()).name, 'patchouli:guide_book')
  assert.equal(observerItemIdentity({ ...f.bot, username: 'MengMeng' }, f.bot.inventory.slots[36], 36, f.now()), null)
  assert.deepEqual(f.bot.inventory.slots, before)
  f.reader.close(); assert.equal(f.bot.inventory.listenerCount('updateSlot'), 0)
  assert.equal(observerItemIdentity(f.bot, f.bot.inventory.slots[36], 36, f.now()), null)
})
test('inventory changes, item mismatches, TTL, future time and failed refresh discard inferred names', async () => {
  const f = fixture(), value = f.bot.inventory.slots[36]
  await f.reader.refresh()
  assert.equal(observerItemIdentity(f.bot, { ...value, type: 6001 }, 36, f.now()), null)
  assert.equal(observerItemIdentity(f.bot, { ...value, count: 2 }, 36, f.now()), null)
  assert.equal(observerItemIdentity(f.bot, value, 36, f.now() - 1), null)
  assert.equal(observerItemIdentity(f.bot, value, 36, f.now() + 10001), null)
  f.bot.inventory.emit('updateSlot', 36, value, value)
  assert.equal(observerItemIdentity(f.bot, value, 36, f.now()), null)
  f.advance(5000); await f.reader.refresh(); assert.ok(observerItemIdentity(f.bot, value, 36, f.now()))
  f.setOutput(new Error('PRIVATE_RCON_DETAIL')); f.advance(5000); assert.equal(await f.reader.refresh(), false)
  assert.equal(observerItemIdentity(f.bot, value, 36, f.now()), null); f.reader.close()
})
test('in-flight inventory changes and reconnects cannot publish a stale slot association', async () => {
  for (const reconnect of [false, true]) {
    const f = fixture(); let release, calls = 0
    const reader = createObserverInventoryReader({ ...f.options, sendCommand: async () => { calls++; return new Promise(resolve => { release = resolve }) } })
    const work = reader.refresh(); await Promise.resolve(); assert.equal(await reader.refresh(), false); assert.equal(calls, 1)
    if (reconnect) f.replace({ ...f.bot })
    else f.bot.inventory.emit('updateSlot', 36)
    release(response); assert.equal(await work, false)
    assert.equal(observerItemIdentity(f.bot, f.bot.inventory.slots[36], 36, f.now()), null); reader.close()
  }
})
test('a synchronously throwing command adapter can recover on its next bounded poll', async () => {
  const f = fixture(); let fail = true
  const reader = createObserverInventoryReader({ ...f.options, sendCommand: () => { if (fail) throw Error('private'); return response } })
  assert.equal(await reader.refresh(), false); fail = false; f.advance(5000)
  assert.equal(await reader.refresh(), true); reader.close()
})
test('eye and viewer use the same own-slot name, never assign custom runtime numbers as vanilla icons', async () => {
  const f = fixture(); await f.reader.refresh()
  const eye = createEyeController(f.options).state()
  assert.equal(eye.observer.inventory.slots[0].name, 'patchouli:guide_book')
  assert.equal(eye.observer.equipment[0].name, 'patchouli:guide_book')
  const visible = serializeViewerItem(f.bot, f.bot.inventory.slots[36], 36, 36)
  assert.equal(visible.name, 'patchouli:guide_book'); assert.equal(visible.itemId, undefined)
  assert.equal(serializeViewerItem(f.bot, f.bot.inventory.slots[36], 0).name, 'unknown')
  assert.equal(JSON.stringify(eye).includes('memorizable_gensokyo'), false)
  f.reader.close()
})

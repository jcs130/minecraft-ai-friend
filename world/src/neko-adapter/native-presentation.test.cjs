'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachNativeModPresentation } = require('./native-presentation.cjs')
const UUID = '11111111-1111-4111-8111-111111111111'
function fixture (t) {
  const bot = new EventEmitter(); bot._client = { uuid: UUID }
  let time = 1000, menu = { playerUuid: UUID, windowId: 0, stateId: 1, menuType: 'minecraft:inventory' }, state = null, mutation = false
  const calls = [], jobs = new Map()
  const sdk = { menu: { events: new EventEmitter(), current: () => menu },
    spell: { events: new EventEmitter(), current: () => state, list: async () => {
      calls.push('spell.list'); state = { playerUuid: UUID, mana: { current: 25, max: 80 } }
      sdk.spell.events.emit('receipt', { playerUuid: UUID, action: 'list', ok: true, state, spells: [{ id: 'heal' }] })
    } }, mods: { events: new EventEmitter(), curios: { state: async () => {
      calls.push('curios.state'); sdk.mods.events.emit('receipt', { playerUuid: UUID, action: 'curios_state', ok: true,
        state: { containerId: menu.windowId, stateId: menu.stateId, menuOpen: true } })
    } } }, domum: { events: new EventEmitter(), state: async () => {
      calls.push('domum.state'); sdk.domum.events.emit('receipt', { playerUuid: UUID, ok: true, state: { playerUuid: UUID, windowId: menu.windowId, stateId: menu.stateId } })
    } }, callStatus: () => ({ inFlightMutation: mutation ? 'menu.click' : null }) }
  const view = attachNativeModPresentation(bot, sdk, { now: () => time, setTimer: fn => { jobs.set(1, fn); return 1 }, clearTimer: id => jobs.delete(id) })
  t.after(() => view.close())
  return { bot, sdk, view, calls, jobs, advance: () => { time += 2000 },
    menu: type => { menu = { ...menu, windowId: menu.windowId+1, stateId: 1, menuType: type } }, mutate: flag => { mutation=flag } }
}
test('observer reads real spell and active mod state only, never opens menus or issues mutations', async t => {
  const f = fixture(t); await f.view.poll()
  assert.deepEqual(f.calls, ['spell.list']); assert.deepEqual(f.view.current().spellState.mana, { current: 25, max: 80 })
  assert.equal(f.view.current().spellObservedAt, 1000)
  f.menu('curios:curios_container'); f.advance(); await f.view.poll()
  assert.deepEqual(f.calls, ['spell.list','spell.list','curios.state'])
  assert.equal(f.view.current().curiosReceipt.state.menuOpen, true)
  f.menu('domum_ornamentum:architectscutter'); f.advance(); await f.view.poll()
  assert.equal(f.calls.at(-1), 'domum.state'); assert.equal(f.view.current().curiosReceipt, null)
})
test('observer throttles reads, waits during native mutations and retires private caches/listeners on lifecycle', async t => {
  const f = fixture(t); await f.view.poll(); await f.view.poll(); assert.equal(f.calls.length, 1)
  f.advance(); f.mutate(true); await f.view.poll(); assert.equal(f.calls.length,1)
  f.mutate(false); await f.view.poll(); assert.equal(f.calls.length,2)
  f.sdk.spell.events.emit('receipt', { playerUuid: '22222222-2222-4222-8222-222222222222', action:'list',ok:true,state:{playerUuid:UUID},spells:[{id:'foreign'}] })
  assert.equal(f.view.current().spellCatalog.spells[0].id, 'heal')
  f.bot.emit('respawn'); assert.equal(f.view.current().spellCatalog,null); assert.equal(f.view.current().spellObservedAt,null)
  f.view.close(); assert.equal(f.jobs.size,0); assert.equal(f.sdk.spell.events.listenerCount('receipt'),0)
  await f.view.poll(); assert.equal(f.calls.length,2)
})
test('one unavailable mod read does not prevent the active Curios GUI read', async t => {
  const f=fixture(t); f.menu('curios:curios_container')
  f.sdk.spell.list=async()=>{ f.calls.push('spell.list'); throw Error('ars_unavailable') }
  await f.view.poll()
  assert.deepEqual(f.calls,['spell.list','curios.state']); assert.equal(f.view.current().curiosReceipt.state.menuOpen,true)
  assert.equal(f.view.status().errors[0].code,'ars_unavailable')
})

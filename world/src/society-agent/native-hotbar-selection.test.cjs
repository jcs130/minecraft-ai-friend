'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events')
const { selectNativeHotbar } = require('./native-hotbar-selection.cjs')
const uuid = 'e371227c-09fa-3722-84f4-f3228a552c3c', foreign = '010b4174-0000-4000-8000-000000000001'
function fixture (selected = 0) {
  let state = { playerUuid: uuid, selectedHotbarSlot: selected }, submissions = 0
  const client = Object.assign(new EventEmitter(), { uuid, quickBarSlot: selected })
  const menu = { events: new EventEmitter(), current: () => structuredClone(state) }
  return { menu, client, options: { menu, client, expectedUuid: uuid, slot: 7,
    sendSelection: slot => { submissions++; client.quickBarSlot = slot } }, count: () => submissions,
    state: (selectedHotbarSlot, playerUuid = uuid, emit = true) => {
      state = { selectedHotbarSlot, playerUuid }; if (emit) menu.events.emit('state', state)
    }, clean: () => {
      assert.equal(menu.events.listenerCount('state'), 0); assert.equal(menu.events.listenerCount('receipt'), 0)
      assert.equal(client.listenerCount('held_item_slot'), 0); assert.equal(client.listenerCount('end'), 0)
    } }
}
test('a real five-tick delayed bridge snapshot confirms selection after the old 150ms false-negative window', async () => {
  const f = fixture(); let completed = false
  const pending = selectNativeHotbar({ ...f.options, timeoutMs: 1000 }).then(result => { completed = true; return result })
  await new Promise(resolve => setTimeout(resolve, 160))
  assert.equal(completed, false); assert.equal(f.client.quickBarSlot, 7)
  await new Promise(resolve => setTimeout(resolve, 100))
  f.state(7)
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.proofSource, 'native_menu_state')
  assert.equal(f.count(), 1); f.clean()
})
test('local slot and a stale cached matching value are never a fresh confirmation', async () => {
  const f = fixture(); const pending = selectNativeHotbar({ ...f.options, timeoutMs: 8 })
  f.state(7, uuid, false) // current() changed locally without a server event
  const result = await pending
  assert.equal(result.ok, false); assert.equal(result.code, 'hotbar_selection_not_confirmed')
  assert.equal(result.outcomeUnknown, true); assert.equal(result.retryAutomatically, false)
  assert.equal(f.count(), 1); f.client.emit('held_item_slot', { slot: 7 }); f.clean()
})
test('only the actual clientbound slot field can confirm this connection', async () => {
  const f = fixture(); const pending = selectNativeHotbar({ ...f.options, timeoutMs: 100 })
  f.client.emit('held_item_slot', { slotId: 7 })
  f.client.emit('held_item_slot', { slot: 7 })
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.proofSource, 'clientbound_held_item_slot'); f.clean()
})
test('a native action receipt supplies same-player authority and invalid/foreign receipts do not', async () => {
  const f = fixture(); const pending = selectNativeHotbar({ ...f.options, timeoutMs: 100 })
  f.menu.events.emit('receipt', { state: { playerUuid: foreign, selectedHotbarSlot: 7 } })
  f.menu.events.emit('receipt', { state: { playerUuid: uuid, selectedHotbarSlot: 99 } })
  f.menu.events.emit('receipt', { state: { playerUuid: uuid, selectedHotbarSlot: 7 } })
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.proofSource, 'native_menu_action_receipt'); f.clean()
})
test('foreign UUID before dispatch rejects safely, while an in-flight identity change stays unknown', async () => {
  const f = fixture(); f.client.uuid = foreign
  const rejected = await selectNativeHotbar(f.options)
  assert.equal(rejected.outcomeKnown, true); assert.equal(f.count(), 0); f.clean()
  const g = fixture(); const pending = selectNativeHotbar({ ...g.options, timeoutMs: 100 })
  g.client.uuid = foreign; g.client.emit('held_item_slot', { slot: 7 })
  const changed = await pending; assert.equal(changed.code, 'hotbar_connection_identity_changed')
  assert.equal(changed.outcomeUnknown, true); assert.equal(g.count(), 1); g.clean()
})
test('fresh nonmatching slot is retained as evidence but no unverified success or automatic replay occurs', async () => {
  const f = fixture(); const pending = selectNativeHotbar({ ...f.options, timeoutMs: 8 })
  f.state(2)
  const result = await pending; assert.equal(result.ok, false); assert.equal(result.lastObservedHotbarSlot, 2)
  assert.equal(result.retryAutomatically, false); assert.equal(f.count(), 1); f.clean()
})
test('already-selected native state is an explicit no-change proof, not the local quickbar value', async () => {
  const f = fixture(7); f.client.quickBarSlot = 0
  const result = await selectNativeHotbar(f.options)
  assert.equal(result.ok, true); assert.equal(result.code, 'hotbar_already_selected')
  assert.equal(result.proofSource, 'native_menu_already_selected'); assert.equal(f.count(), 1); f.clean()
})
test('maintenance abort and connection close stop waiting without submitting again', async () => {
  const f = fixture(), controller = new AbortController()
  const pending = selectNativeHotbar({ ...f.options, signal: controller.signal })
  controller.abort(); assert.equal((await pending).code, 'hotbar_selection_aborted'); assert.equal(f.count(), 1); f.clean()
  const g = fixture(); const closed = selectNativeHotbar(g.options)
  g.client.emit('end'); assert.equal((await closed).code, 'hotbar_connection_closed'); assert.equal(g.count(), 1); g.clean()
})
test('synchronous server confirmation is observed and context failure prevents submission', async () => {
  const f = fixture()
  const result = await selectNativeHotbar({ ...f.options, sendSelection: () => f.state(7) })
  assert.equal(result.ok, true); f.clean()
  const g = fixture(); await assert.rejects(selectNativeHotbar({ ...g.options, check: () => { throw Error('ACTION_CONTEXT_CHANGED') } }), /ACTION_CONTEXT_CHANGED/)
  assert.equal(g.count(), 0); g.clean()
})

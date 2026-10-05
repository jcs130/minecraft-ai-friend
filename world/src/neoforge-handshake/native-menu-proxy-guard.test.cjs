'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createNativeMenuProxyGuard } = require('./native-menu-proxy-guard.cjs')
const { cookingPotWindow, decodeAdvancedOpenScreen } = require('./advanced-open-screen.cjs')
const NativeViewer = require('./native-viewer-packet.cjs')
const factory = require('prismarine-windows')('1.21.1')
const windows = factory.windows
const OWN = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'
const hash = 'a'.repeat(64)
const rawType = 29
const unknown = (id = 3) => ({ windowId: id, inventoryType: rawType, windowTitle: { type: 'string', value: 'Architect Cutter' } })
const known = (id = 4) => ({ windowId: id, inventoryType: windows['minecraft:crafting'].type,
  windowTitle: { type: 'string', value: 'Crafting' } })
const pot = Buffer.from('02190a0800097472616e736c6174650024636f6e7461696e65722e6661726d65727364656c696768742e636f6f6b696e675f706f740008ffffffffffffe040', 'hex')
function guard (uuid = OWN) { return createNativeMenuProxyGuard({ windows, getPlayerUuid: () => uuid }) }
function menuState (fields) {
  return { channel: 'maw_agent:menu_state', data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'menu_state',
    playerUuid: OWN, self: { playerUuid: OWN }, windowId: 3, menuTypeId: rawType,
    menuType: 'domum_ornamentum:architectscutter', slots: [{ id: 'minecraft:oak_planks', count: 3, snbt: 'complete-native' }], ...fields })) }
}

test('installed Window factory actually returns null for mod type, precise parser table protects it', () => {
  assert.equal(factory.createWindow(3, rawType, 'real mod menu'), null)
  const policy = guard()
  const hidden = policy.filter('open_window', unknown())
  assert.equal(hidden.forward, false)
  assert.equal(hidden.parserSource, 'installed_prismarine_windows')
  assert.equal(hidden.nativeMenuType, null)
  assert.equal(policy.diagnostics().parserTypeCount, Object.values(windows).filter(layout => layout?.type >= 0).length)
  for (const [key, layout] of Object.entries(windows)) {
    if (layout.type < 0) continue
    assert.notEqual(factory.createWindow(4, layout.type, key), null)
    assert.equal(policy.filter('open_window', { ...known(), inventoryType: layout.type }).forward, true)
  }
})

test('unsupported open suppresses its content slot data and close, while own inventory 0 survives', () => {
  const policy = guard()
  policy.filter('open_window', unknown())
  for (const name of ['window_items', 'set_slot', 'craft_progress_bar', 'window_data', 'container_data']) {
    assert.equal(policy.filter(name, { windowId: 3 }).forward, false, name)
    assert.equal(policy.filter(name, { windowId: 0 }).forward, true, 'inventory ' + name)
  }
  assert.equal(policy.filter('set_slot', { windowId: -1 }).forward, false)
  assert.equal(policy.filter('set_slot', { windowId: -2 }).forward, true)
  assert.equal(policy.filter('close_window', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('window_items', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('window_items', { windowId: 0 }).forward, true)
})

test('unknown to known then late old content/close cannot contaminate or close new vanilla menu', () => {
  const policy = guard()
  policy.filter('open_window', unknown())
  assert.equal(policy.filter('open_window', known()).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 4 }).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('set_slot', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('close_window', { windowId: 3 }).forward, false)
  assert.equal(policy.diagnostics().proxyWindowId, 4)
  assert.equal(policy.filter('set_slot', { windowId: 4 }).forward, true)
  assert.equal(policy.filter('close_window', { windowId: 4 }).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 4 }).forward, false)
  assert.equal(policy.filter('close_window', { windowId: 4 }).forward, false)
})

test('reused window ID requires an explicit new supported open; native-only reuse never passes stale items', () => {
  const policy = guard()
  policy.filter('open_window', known(3))
  policy.filter('open_window', unknown(3))
  assert.equal(policy.filter('window_items', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('close_window', { windowId: 3 }).forward, false)
  assert.equal(policy.filter('open_window', known(3)).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 3 }).forward, true)
})

test('actual same-player native MENU registry identity is recorded without rewriting SDK JSON', () => {
  const policy = guard()
  policy.filter('open_window', unknown())
  const params = menuState({})
  const raw = Buffer.from(params.data)
  assert.equal(policy.filter('custom_payload', params).forward, true)
  assert.deepEqual(params.data, raw)
  assert.equal(policy.diagnostics().active.nativeMenuType, 'domum_ornamentum:architectscutter')
  assert.equal(policy.diagnostics().active.nativeMenuTypeId, rawType)
  assert.equal(policy.diagnostics().active.nativeIdentitySource, 'server_menu_state_registry')
  assert.equal(policy.filter('window_items', { windowId: 3 }).forward, false)
  policy.filter('custom_payload', menuState({ playerUuid: OTHER, menuType: 'minecraft:crafting' }))
  assert.equal(policy.diagnostics().active.nativeMenuType, 'domum_ornamentum:architectscutter')
})

test('learned nonvanilla identity cannot borrow a recognized parser number', () => {
  const policy = guard()
  const parserNumber = windows['minecraft:crafting'].type
  policy.filter('custom_payload', menuState({ menuTypeId: parserNumber }))
  const result = policy.filter('open_window', { ...unknown(), inventoryType: parserNumber })
  assert.equal(result.forward, false)
  assert.equal(result.nativeMenuType, 'domum_ornamentum:architectscutter')
})

test('verified existing cooking-pot advanced payload remains supported, unknown advanced stays native', () => {
  const policy = guard()
  const native = { channel: 'neoforge:advanced_open_screen', data: pot }
  assert.equal(policy.filter('custom_payload', native, { cookingPotMenu: cookingPotWindow(pot) }).forward, true)
  assert.equal(policy.diagnostics().active.mode, 'verified_cooking_pot_adapter')
  assert.equal(policy.filter('window_items', { windowId: 2 }).forward, true)
  assert.equal(policy.filter('set_slot', { windowId: 2 }).forward, true)
  const other = Buffer.from(pot); other[0] = 5; other[1] = rawType
  assert.equal(cookingPotWindow(other), null)
  assert.equal(decodeAdvancedOpenScreen(other).windowId, 5)
  assert.equal(policy.filter('custom_payload', { ...native, data: other }).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 5 }).forward, false)
  assert.equal(policy.filter('window_items', { windowId: 2 }).forward, false)
  assert.equal(policy.filter('close_window', { windowId: 5 }).forward, false)
  assert.equal(policy.filter('open_window', known()).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 4 }).forward, true)
})

test('malformed advanced cannot crash guard or reuse the prior proxy screen', () => {
  const policy = guard()
  policy.filter('open_window', known())
  assert.equal(policy.filter('custom_payload', { channel: 'neoforge:advanced_open_screen', data: Buffer.from([1]) }).forward, true)
  assert.equal(policy.filter('window_items', { windowId: 4 }).forward, false)
  assert.equal(policy.filter('window_items', { windowId: 0 }).forward, true)
  policy.filter('respawn', {})
  assert.equal(policy.diagnostics().active, null)
  assert.equal(policy.diagnostics().proxyWindowId, null)
})

test('two accounts and a new backend context keep menu identities and suppression private', () => {
  const a = guard(), b = guard(OTHER)
  a.filter('open_window', unknown())
  b.filter('open_window', known(3))
  a.filter('custom_payload', menuState({}))
  b.filter('custom_payload', menuState({}))
  assert.equal(a.filter('window_items', { windowId: 3 }).forward, false)
  assert.equal(b.filter('window_items', { windowId: 3 }).forward, true)
  assert.equal(b.diagnostics().active.nativeMenuType, null)
  a.reset()
  assert.equal(a.filter('open_window', known(3)).forward, true)
  assert.equal(a.filter('window_items', { windowId: 3 }).forward, true)
})

// Exercise Gate's actual relayTo source in an isolated VM, not require(gate):
// requiring it would bind a network listener, which this regression must avoid.
function relayFixture () {
  const source = fs.readFileSync(path.join(__dirname, 'gate.cjs'), 'utf8')
  const start = source.indexOf('function relayTo (')
  const end = source.indexOf('// mcp 的 pluginChannels', start)
  assert(start >= 0 && end > start)
  const writes = []
  const front = { write: (name, params) => writes.push({ name, params }) }
  const session = { front, back: { uuid: OWN }, username: 'ordinary-player' }
  const context = { Buffer, DEBUG_MENUS: false, BRIDGE_COOKING_POT_GUI: true, BRIDGE_NEOFORGE_TIME: false,
    nativeViewerHash: hash, NativeViewer, createNativeMenuProxyGuard, vanillaMenuParserWindows: windows,
    cookingPotWindow, decodeNeoForgeTime: () => null, componentProtocol: true,
    vanillaProjection: params => ({ ...params, item: { itemId: 1, components: [] } }),
    REMAP: { hasMap: () => false }, normalizeCustomPayload: params => params,
    kickFront: (_session, reason) => { throw Error(reason) }, log: () => {} }
  vm.runInNewContext(source.slice(start, end) + '\nthis.relay = relayTo;', context)
  const relay = (name, params) => context.relay(session, front, name, params, 'backend->frontend')
  const nativeFrames = () => writes.filter(row => row.params.channel === NativeViewer.CHANNEL)
    .map(row => NativeViewer.decodeNativePacket(row.params.data, hash))
  return { relay, writes, nativeFrames, session }
}

test('real Gate relay mirrors unknown open/content/slot/close fully before proxy suppression', () => {
  const { relay, writes, nativeFrames } = relayFixture()
  const contents = { windowId: 3, stateId: 8, items: [{ itemId: 6042, components: [{ type: 'domum_ornamentum:texture_data', data: { material: 'minecraft:oak_planks' } }] }] }
  const slot = { windowId: 3, stateId: 9, slot: 0, item: contents.items[0] }
  relay('open_window', unknown())
  relay('window_items', contents)
  relay('set_slot', slot)
  relay('close_window', { windowId: 3 })
  assert.equal(writes.length, 4)
  assert.equal(writes.every(row => row.name === 'custom_payload' && row.params.channel === NativeViewer.CHANNEL), true)
  const frames = nativeFrames()
  assert.deepEqual(frames.map(frame => frame.name), ['open_window', 'window_items', 'set_slot', 'close_window'])
  assert.deepEqual(frames[1].params, contents)
  assert.deepEqual(frames[2].params, slot)
  assert.deepEqual(frames[0].params, unknown())
})

test('real Gate keeps window0 sync plus raw SDK state and subsequent vanilla events in order', () => {
  const { relay, writes, nativeFrames } = relayFixture()
  relay('open_window', unknown())
  const state = menuState({})
  relay('custom_payload', state)
  relay('set_slot', { windowId: 0, stateId: 11, slot: 36, item: { itemId: 5089, components: [{ type: 'mod:real_component', data: 'native' }] } })
  relay('open_window', known())
  relay('window_items', { windowId: 4, stateId: 0, items: [] })
  relay('close_window', { windowId: 3 })
  relay('close_window', { windowId: 4 })
  const vanilla = writes.filter(row => row.params.channel !== NativeViewer.CHANNEL)
  assert.deepEqual(vanilla.map(row => row.name), ['custom_payload', 'set_slot', 'open_window', 'window_items', 'close_window'])
  assert.deepEqual(vanilla[0].params.data, state.data)
  assert.equal(vanilla[1].params.windowId, 0)
  assert.equal(vanilla[1].params.item.itemId, 1)
  const realInventory = nativeFrames().find(frame => frame.name === 'set_slot')
  assert.equal(realInventory.params.item.itemId, 5089)
  assert.deepEqual(realInventory.params.item.components, [{ type: 'mod:real_component', data: 'native' }])
  assert.equal(vanilla.at(-1).params.windowId, 4)
})

test('real Gate preserves existing FD adapter and replaces private guard on backend reconnection', () => {
  const { relay, writes, session } = relayFixture()
  relay('custom_payload', { channel: 'neoforge:advanced_open_screen', data: pot })
  assert.equal(writes.some(row => row.name === 'open_window' && row.params.windowId === 2 && row.params.inventoryType === 0), true)
  relay('window_items', { windowId: 2, stateId: 0, items: [] })
  assert.equal(writes.some(row => row.name === 'window_items' && row.params.windowId === 2), true)
  const old = session.menuProxyGuard
  session.back = { uuid: OWN }
  relay('window_items', { windowId: 2, stateId: 1, items: [] })
  assert.notEqual(session.menuProxyGuard, old)
  assert.equal(writes.filter(row => row.name === 'window_items').length, 1)
})

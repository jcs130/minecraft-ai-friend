'use strict'
const { jsonValue, text } = require('./projection.cjs')

const SECTIONS = ['status', 'inventory', 'menu', 'items', 'blocks', 'recipes', 'recipe_book', 'spells', 'attributes', 'views', 'view', 'block']
const HELP = { command: '/agent <requestId> <section> [offset] [limit] [filter]',
  sections: SECTIONS, limit: { min: 1, max: 12, default: 8 }, offset: { min: 0, default: 0 },
  block: '/agent <requestId> block <absoluteX> <absoluteY> <absoluteZ>',
  transport: 'private system_chat; MC_NATIVE followed by UTF-8 JSON; no periodic chat',
  nativeIdentity: 'custom_data.maw_native.id; item.name and block.name are declared vanilla carriers',
  actions: 'normal Mineflayer movement, openBlock/activateBlock, inventory and container APIs; use openBlock for mod machine carriers; server validates outcomes' }

function parseQuery (command) {
  const parts = command.trim().split(/\s+/)
  if (parts[0] !== 'agent') return null
  if (parts.length === 1 || (parts.length === 2 && parts[1] === 'help')) return { section: 'help', requestId: null }
  const [, requestId, section, ...args] = parts
  const fail = (field, reason) => ({ requestId: /^[a-zA-Z0-9_.:-]{1,64}$/.test(requestId || '') ? requestId : null,
    section: 'invalid', field, reason, example: '/agent read-1 inventory 0 8' })
  if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(requestId || '')) return fail('requestId', 'expected_1_to_64_ascii_identifier_characters')
  if (!SECTIONS.includes(section)) return fail('section', 'unknown_query_section')
  if (section === 'block') {
    if (args.length !== 3 || args.some(arg => !/^-?\d+$/.test(arg) || !Number.isSafeInteger(Number(arg)))) return fail('position', 'expected_three_absolute_integer_coordinates')
    const [x, y, z] = args.map(Number)
    return { requestId, section, position: { x, y, z } }
  }
  if (args.length > 3) return fail('arguments', 'expected_offset_limit_and_one_filter')
  const offset = args[0] === undefined ? 0 : /^\d+$/.test(args[0]) ? Number(args[0]) : NaN
  const limit = args[1] === undefined ? 8 : /^\d+$/.test(args[1]) ? Number(args[1]) : NaN
  if (!Number.isSafeInteger(offset) || offset > 100000) return fail('offset', 'expected_integer_0_to_100000')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) return fail('limit', 'expected_integer_1_to_12')
  const filter = args[2] || ''
  if (filter.length > 160) return fail('filter', 'filter_exceeds_160_characters')
  return { requestId, section, offset, limit, filter }
}

function query (session, args) {
  const observedAt = new Date().toISOString()
  const base = { schemaVersion: 1, requestId: args.requestId, bodyId: session.backend.client.uuid,
    serverEpoch: session.backend.data?.serverEpoch, section: args.section, observedAt, coordinateSystem: 'absolute_world_blocks',
    source: 'same_connection_server_packets', carrierInformationIsNativeIdentity: false }
  Object.assign(base, { nativeIdDomain: 'native_server_registry', intermediateCarrierProtocol: '26.3', frontendIdsMayDiffer: true })
  if (args.section === 'help') return { ...base, status: 'ok', complete: true, help: HELP }
  if (args.section === 'invalid') return { ...base, status: 'invalid_argument', complete: false, field: args.field, reason: args.reason, example: args.example, retryable: false }
  if (!session.projection) return { ...base, status: 'not_ready', complete: false, retryable: true, reason: 'native_bootstrap_pending' }
  const { projection: p, backend, windows, activeWindow } = session
  if (args.section === 'status' && session.snapshot?.status !== 'ok') return { ...base, status: 'unknown', complete: false, reason: 'fresh_authoritative_body_snapshot_unavailable', retryable: true }
  if (args.section === 'status') return { ...base, status: 'ok', complete: true,
    health: session.snapshot ? { current: session.snapshot.health, max: session.snapshot.maxHealth, food: session.snapshot.food } : session.health,
    position: session.snapshot?.position || null, dimension: session.snapshot?.dimension || null,
    snapshotObservedAt: session.snapshot?.observedAt || null, positionSource: 'authoritative_server_thread_snapshot',
    currentWindow: activeWindow, nativeCatalogObservedAt: backend.data.observedAt,
    counts: { items: backend.data.items.length, blockStates: backend.data.states.length },
    projection: p.counters, omittedPacketClasses: Object.fromEntries(session.omitted),
    limits: ['carrier_names_are_not_native_ids', 'unsupported_shapes_are_unknown', 'custom_crafting_and_spells_need_separate_acceptance'] }
  if (args.section === 'block') {
    const result = args.authoritative
    if (!result) return { ...base, status: 'unknown', complete: false, reason: 'authoritative_block_read_missing', retryable: false }
    if (result.block) {
      const known = p.states.get(result.block.nativeStateId)
      if (!known || known.name !== result.block.nativeId) throw new Error('body_block_not_in_same_native_catalog')
    }
    return { ...base, ...result, requestId: args.requestId, projection: result.block && { ...p.block(result.block.nativeStateId), protocol: '26.3', finalClientStateId: null, frontendMayFurtherProject: true },
      complete: result.status === 'ok', retryable: false }
  }
  let rows
  if (args.section === 'inventory' || args.section === 'menu') {
    const id = args.section === 'inventory' ? 0 : activeWindow
    const window = windows.get(id)
    if (!window) return { ...base, status: 'unknown', complete: false, reason: 'window_snapshot_not_received', retryable: false }
    rows = window.items.map((slot, index) => ({ nativeSlot: index, clientSlot: window.projection ? window.projection.toCarrierSlot(index) : index < 46 ? index : null,
      item: p.slotInfo(slot), layout: window.layout?.slots?.[index] || null,
      permissions: { mayPlace: null, mayPickup: null, reason: 'not_exported_server_still_enforces_actual_slot_rules' } }))
    Object.assign(base, { windowId: id, stateId: window.stateId, nativeMenu: window.layout?.nativeId || 'minecraft:inventory',
      slotCoordinateSystem: 'native_server_menu_indices', snapshotObservedAt: window.observedAt,
      nativeLayout: window.layout && Object.fromEntries(['nativeId', 'slotCount', 'inventoryStart', 'inventoryEnd', 'resultSlot', 'complete'].map(key => [key, window.layout[key]])), cursor: p.slotInfo(window.carriedItem) })
  } else if (args.section === 'items') rows = backend.data.items.map(row => ({ ...row, intermediateCarrier: { protocol: '26.3', ...p.itemMap.get(row.id) } }))
  else if (args.section === 'blocks') rows = backend.data.states.map(row => ({ ...row, projection: p.block(row.id) }))
  else if (args.section === 'recipes') rows = backend.data.gridRecipes || []
  else if (args.section === 'recipe_book') rows = [...backend.recipeBook.values()]
  else if (args.section === 'spells') rows = Object.entries(backend.mods.spellAssignments || {}).map(([id, value]) => ({ id, value }))
  else if (args.section === 'attributes') rows = session.attributes || []
  else if (args.section === 'views') rows = backend.views.list().map(channel => ({ channel }))
  else if (args.section === 'view') {
    if (!args.filter) return { ...base, status: 'invalid_argument', complete: false, field: 'filter', reason: 'exact_view_channel_required', example: '/agent q1 view 0 1 village-quest:reputation_view_v2', retryable: false }
    const value = backend.views.get(args.filter)
    if (!value || value.status === 'unknown') return { ...base, status: 'unknown', complete: false, reason: 'view_not_observed_on_this_connection', retryable: false }
    rows = [value]
  }
  if (!Array.isArray(rows)) throw new Error('unimplemented_private_query')
  if (args.filter && args.section !== 'view') rows = rows.filter(row => JSON.stringify(jsonValue(row)).includes(args.filter))
  const selected = []
  let bytes = 0
  for (const row of rows.slice(args.offset, args.offset + args.limit)) {
    const value = jsonValue(row)
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes + size > 10000) break
    selected.push(value)
    bytes += size
  }
  const next = args.offset + selected.length
  const complete = next >= rows.length
  const oversized = !complete && !selected.length
  return { ...base, status: complete ? 'ok' : 'partial', complete, requestedOffset: args.offset, requestedLimit: args.limit,
    returnedCount: selected.length, totalCount: rows.length, remainingCount: Math.max(0, rows.length - next),
    partialReason: complete ? null : oversized ? 'single_entry_exceeds_response_budget' : 'page_or_byte_budget', rows: selected,
    next: !complete && !oversized ? { section: args.section, offset: next, limit: args.limit, filter: args.filter } : null,
    retryable: false }
}

function sendPrivate (peer, receipt) {
  const payload = 'MC_NATIVE ' + JSON.stringify(jsonValue(receipt))
  if (Buffer.byteLength(payload, 'utf8') > 12288) throw new Error('private_response_budget_exceeded')
  peer.write('system_chat', { content: text(payload), isActionBar: false })
}

module.exports = { HELP, SECTIONS, parseQuery, query, sendPrivate }

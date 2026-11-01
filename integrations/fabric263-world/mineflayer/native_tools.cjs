'use strict'
const NATIVE_TOOL = {
  name: 'mc_native', tags: ['read'],
  description: 'Read this connection’s actual native mod catalog, server grid recipes, imported spell assignments, own quest views or open menu. No world scan or action. limit=1..24 (default 12), offset>=0. Catalog timestamps are server snapshot times. Unknown is not empty. Returned IDs are native IDs, not vanilla substitutes.',
  parameters: { type: 'object', additionalProperties: false, required: ['section'], properties: {
    section: { type: 'string', enum: ['capabilities', 'items', 'blocks', 'recipes', 'spells', 'views', 'view', 'menu', 'recipe_book'] },
    search: { type: 'string', maxLength: 160, description: 'Native ID/name substring; for view, exact observed channel.' },
    limit: { type: 'integer', minimum: 1, maximum: 24, default: 12 }, offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 }
  } }
}
function nativeRead (bot, args) {
  const now = new Date().toISOString()
  if (!bot?.entity || !bot.native263?.registry) return { status: 'offline', reason: 'body_not_connected', complete: false, retryable: true }
  const { section, search = '', limit = 12, offset = 0 } = args
  if (!NATIVE_TOOL.parameters.properties.section.enum.includes(section) || typeof search !== 'string' || search.length > 160 ||
      !Number.isInteger(limit) || limit < 1 || limit > 24 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return { status: 'invalid_argument', reason: 'section/search/limit/offset outside tool schema', retryable: false, example: { section: 'items', search: 'farmersdelight:', limit: 8 } }
  }
  const data = bot.native263.registry
  const base = { schemaVersion: 1, bodyId: bot._client.uuid, serverEpoch: data.serverEpoch, observedAt: data.observedAt, readAt: now }
  if (section === 'capabilities') return { ...base, status: 'ok', complete: true, transport: 'native_mineflayer_26.3', protocol: 777,
    counts: { states: data.states.length, items: data.items.length, entities: data.entities.length, gridRecipes: data.gridRecipes.length },
    features: { nativeIds: true, staticCollision: 'unknown_context_is_explicit', vanillaActions: 'server_validated', nativeMenus: true,
      villageQuestViews: data.viewBridge.channels, spellAssignments: true, spellCasting: 'not_yet_accepted', specialAndMachineCrafting: 'use_real_machine_menu',
      webRenderer: 'not_accepted_for_26.3', numen: 'not_installed' } }
  if (section === 'view') return { ...base, ...bot.native263.views.get(search) }
  if (section === 'menu') {
    const window = bot.currentWindow
    return { ...base, observedAt: now, status: window ? 'ok' : 'none', complete: true, reason: window ? null : 'no_open_menu', menu: window && {
      windowId: window.id, nativeId: window.type, title: window.title?.toString(), layout: window.nativeLayout,
      slots: window.slots.map((item, slot) => ({ slot, item: item && { nativeId: bot.registry.items[item.type]?.nativeId,
        count: item.count, components: item.components, nativeType: item.type } })) } }
  }
  let rows
  if (section === 'items') rows = data.items
  else if (section === 'blocks') rows = bot.registry.blocksArray.map(b => ({ id: b.id, name: b.nativeId, minStateId: b.minStateId, maxStateId: b.maxStateId,
    states: b.states, hardness: b.hardness, transparent: b.transparent, boundingBox: b.boundingBox, shapeStatus: b.shapeStatus }))
  else if (section === 'recipes') rows = data.gridRecipes.map(r => ({ ...r, resultNativeId: bot.registry.items[r.resultId]?.nativeId }))
  else if (section === 'spells') rows = Object.entries(bot.native263.modData.spellAssignments?.containers || {}).map(([id, value]) => ({ id, ...value }))
  else if (section === 'views') rows = data.viewBridge.channels.map(channel => ({ channel, observed: bot.native263.views.list().includes(channel) }))
  else rows = bot.native263.recipeBook.list().map(id => bot.native263.recipeBook.get(id))
  rows = rows.filter(r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
  const selected = []; let bytes = 0
  for (const row of rows.slice(offset, offset + limit)) {
    const n = Buffer.byteLength(JSON.stringify(row))
    if (bytes + n > 12288) break
    selected.push(row); bytes += n
  }
  const remaining = Math.max(0, rows.length - offset - selected.length)
  return { ...base, status: remaining ? 'partial' : 'ok', complete: remaining === 0,
    partial_reason: remaining ? (selected.length < Math.min(limit, rows.length - offset) ? 'byte_budget' : 'item_budget') : null,
    requested: { section, search, offset, limit }, total_count: rows.length, returned_count: selected.length, remaining,
    next: remaining && selected.length ? { section, search, offset: offset + selected.length, limit } : null, rows: selected }
}
module.exports = { NATIVE_TOOL, nativeRead }

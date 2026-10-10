'use strict'

// The server facade reuses the Mineflayer SDK parameter schemas, while exposing
// only operations with an actual synchronous native handler. Client-side plans
// (navigation, crafting, eating, etc.) are deliberately not advertised here.
const fs = require('node:fs')
const path = require('node:path')
const { modOperationCatalog } = require('../world/src/neoforge-handshake/mod-call-client.cjs')
const routes = {
  'colony.status': ['colony', 'status'], 'colony.capabilities': ['colony', 'capabilities'],
  'colony.resources': ['colony', 'resources'], 'colony.management': ['colony', 'management'],
  'colony.research': ['colony', 'research'], 'colony.found': ['colony', 'found'],
  'colony.placeBuilder': ['colony', 'place_builder'], 'colony.placeHut': ['colony', 'place_hut'],
  'colony.requestBuild': ['colony', 'request_build'], 'colony.deliver': ['colony', 'deliver'],
  'colony.stockResource': ['colony', 'stock_resource'], 'colony.assignCitizen': ['colony', 'assign_citizen'],
  'colony.setHiringMode': ['colony', 'hiring_mode'], 'colony.pauseCitizen': ['colony', 'pause_citizen'],
  'colony.startResearch': ['colony', 'start_research'],
  'native.recipes': ['world', 'recipes'], 'world.look': ['world', 'look'],
  'collision.query': ['world', 'collision'], 'world.interact': ['mod', 'world_interact'],
  'create.settings': ['mod', 'create_settings'], 'create.fluids': ['mod', 'create_fluids'],
  'create.setValue': ['mod', 'create_value'], 'create.setFilter': ['mod', 'create_filter'],
  'curios.state': ['mod', 'curios_state'], 'curios.open': ['mod', 'curios_open'], 'curios.page': ['mod', 'curios_page'],
  'ysm.catalog': ['mod', 'ysm_catalog'], 'ysm.select': ['mod', 'ysm_select'],
  'domum.state': ['domum', 'state'], 'domum.choices': ['domum', 'choices'],
  'domum.select': ['domum', 'select']
}
const existing = new Map(modOperationCatalog().operations.map(o => [o.id, o]))
const operations = Object.entries(routes).map(([id, [route, kind]]) => {
  const o = structuredClone(existing.get(id))
  if (!o) throw Error('Missing real SDK operation: ' + id)
  delete o.parameters.properties.requestId
  o.parameters.required = (o.parameters.required || []).filter(k => k !== 'requestId')
  const defaults = id === 'ysm.catalog' ? { offset: 0, limit: 12 } : {}
  return { ...o, route, kind, defaults }
})
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const str = { type: 'string', maxLength: 60000 }
const context = { windowId: integer(0, 255), expectedStateId: integer(0, 32767) }
const params = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const interaction = operations.find(o => o.id === 'world.interact')
interaction.parameters.required.push('expectedHeldSnbt')
interaction.description = '本身体原生主手右键近处可见方块；expectedHeldSnbt 必须来自最新 menu.snapshot。空手为空字符串；薄模型使用 world.look 的 hit.cursor 作为 aimOffset。接受交互仍须观察效果。'
// Unlike the SDK's local wrapper, the remote facade requires the full snapshot
// CAS explicitly. Actor identity is injected from the owned server body.
const domum = operations.find(o => o.id === 'domum.select')
Object.assign(domum.parameters.properties, {
  ...context, expectedPosition: structuredClone(existing.get('colony.found').parameters.properties.position),
  expectedGroup: { type: ['string', 'null'], maxLength: 256 },
  expectedVariantSnbt: str, expectedInputsSnbt: { type: 'array', minItems: 1, maxItems: 16, items: str },
  expectedCarriedSnbt: str, expectedOutputSnbt: str
})
domum.parameters.required.push(...Object.keys(domum.parameters.properties).filter(k => k.startsWith('expected') || k === 'windowId'))
domum.description += ' 使用 domum.state 的完整窗口/材料/造型/游标 CAS；playerUuid 由服务端绑定，调用方不得指定。'
operations.push(
  { id: 'menu.snapshot', readOnly: true, description: '读取本身体实时原生菜单、真实槽位/组件/游标、料理锅加热及进度。不是网页缓存。', parameters: params({}), route: 'menu', kind: 'snapshot', defaults: {} },
  { id: 'menu.pickup', readOnly: false, description: '在本身体真实菜单执行一次左/右键 PICKUP。所有前置值来自最新 menu.snapshot，完整组件及窗口状态 CAS；不自动清空游标。', parameters: params({ ...context, slot: integer(0, 127), button: integer(0, 1), expectedItemId: { type: 'string', pattern: '^[a-z0-9_.-]+:[a-z0-9_./-]+$' }, expectedCount: integer(0, 999), expectedSnbt: str, expectedCarriedSnbt: str }), route: 'menu', kind: 'pickup', defaults: {} },
  { id: 'menu.close', readOnly: false, description: '关闭本人菜单，要求窗口/stateId仍一致且游标为空。返回实际关闭后的菜单。', parameters: params(context), route: 'menu', kind: 'close', defaults: {} }
)
const output = { schemaVersion: 1, source: 'same_player_native_handlers', operationCount: operations.length, operations }
const target = path.resolve(__dirname, '../world/society-bridge-src/src/main/resources/maw-native-operations.json')
const bytes = JSON.stringify(output, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== bytes) throw Error('Native contract is stale; run tools/export_native_mod_contract.cjs')
} else fs.writeFileSync(target, bytes)
console.log(JSON.stringify({ ok: true, operationCount: operations.length, checkOnly: process.argv.includes('--check') }))

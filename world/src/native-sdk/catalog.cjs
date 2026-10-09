'use strict'
const { modOperationCatalog, validateModArguments, validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const actionId = { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,96}$' }
const local = [
  ['sdk.capabilities', true, 'remote_query', '查询远端桥版本、已声明原生绑定和真实身体类型。', object()],
  ['body.identity', true, 'local_read', '当前连接真实 UUID、账号、控制器、在线状态；不创建/恢复假玩家。', object()],
  ['body.snapshot', true, 'remote_query', '本人血量饥饿、绝对位置维度、完整原生库存装备、当前菜单和 SDK 动作。', object()],
  ['body.observe', true, 'remote_query', '最多 48 条首命中射线方块、24 个已跟踪且可见实体；不是完整地图或矿石扫描。', object({ radius: int(1, 12) })],
  ['body.move', false, 'client_physics', '普通玩家步行至已加载、16 格内的绝对方块坐标；不挖路/搭桥/传送，结束用服务端位置复核。',
    object({ position: object({ x: int(-29999984, 29999984), y: int(-2048, 2048), z: int(-29999984, 29999984) }, ['x', 'y', 'z']), timeoutMs: int(1000, 25000) }, ['position'])],
  ['inventory.equipSlot', false, 'native_menu', '把本人库存一件装备放入空护甲/副手槽，完整 SNBT CAS；不覆盖现有装备。主手使用 inventory.equip。',
    object({ sourceSlot: int(9, 44), destination: { type: 'string', enum: ['head', 'chest', 'legs', 'feet', 'offhand'] }, expectedSnbt: { type: 'string', minLength: 1, maxLength: 65536 } }, ['sourceSlot', 'destination', 'expectedSnbt'])],
  ['inventory.use', false, 'client_packet', '本人真实主手使用/松开，核对槽位及完整组件；只确认发送和观察，不承诺特殊物品效果。进食用 inventory.consume。',
    object({ hotbarSlot: int(0, 8), expectedSnbt: { type: 'string', minLength: 1, maxLength: 65536 } }, ['hotbarSlot', 'expectedSnbt'])],
  ['action.status', true, 'local_ledger', '按 action_id 查在途/持久终态/未知；未找到不会视为未执行。', object({ action_id: actionId }, ['action_id'])],
  ['action.cancel', false, 'control', '请求停止指定在途动作；已派发消费/挖掘可能未知，绝不撤销或重放。', object({ action_id: actionId }, ['action_id'])],
  ['body.stop', false, 'control', '停止当前 SDK 动作和寻路/按键/挖掘/使用物品；不是回滚已发生效果。', object()]
].map(([id, readOnly, executor, description, parameters]) => ({ id, readOnly, executor, description, parameters }))
const own = new Map(local.map(row => [row.id, row]))
const permission = id => id.startsWith('colony.') ? 'own_connection_and_native_colony_permissions' :
  id.startsWith('maid.') ? 'own_connection_and_native_maid_ownership' :
  id.startsWith('ysm.') ? 'own_connection_and_native_model_authorization' : 'own_connection_normal_game_rules'
function operationCatalog (id, remote) {
  const rows = [...modOperationCatalog().operations, ...local].map(row => ({ ...structuredClone(row),
    executor: row.executor || 'native_adapter', permission: permission(row.id),
    execution: row.readOnly ? 'awaitable_read' : row.executor === 'control' ? 'immediate_control' : 'asynchronous_action',
    invocation: row.executor === 'control' ? 'sdk.cancel(action_id) / sdk.stop()' : row.readOnly ? 'sdk.read(id, args)' : 'sdk.submit({action_id, operation:id, args})',
    returns: row.readOnly ? 'own_body_structured_result_or_explicit_unavailable' : row.executor === 'control' ? 'cancellation_request_not_rollback' : 'accepted_then_action_status_with_result_actual_position_inventory_delta',
    serverBindingAdvertised: row.executor ? null : remote?.nativeOperations?.includes(row.id) ?? false,
    gameplayVerified: false }))
  if (id !== undefined) return rows.find(row => row.id === id) || null
  return { schemaVersion: 1, operationCount: rows.length, operations: rows,
    remoteSupportVerified: remote?.remoteBindingsAdvertised === true, allGameplayVerified: false,
    bodyKind: 'connected_player', numenFakePlayerControl: false, numenRestoreExisting: false }
}
function validateArguments (id, args = {}) {
  if (own.has(id)) return validateJsonArguments(args, own.get(id).parameters)
  return validateModArguments(id, args)
}
module.exports = { operationCatalog, validateArguments }

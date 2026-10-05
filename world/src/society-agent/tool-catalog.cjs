'use strict'
const descriptors = [
  ['tools', '查询可执行工具说明，未知模组能力不会伪装为已支持。', { operation: 'list|explain', id: 'explain时工具type' }, { type: 'tools', operation: 'explain', id: 'recipes' }],
  ['inspect', '读取本人完整原生库存、foodOptions、可见地表、附近真实实体、模组只读状态。槽0为合成预览。', {}, { type: 'inspect' }],
  ['navigate', '走向16格内绝对坐标；不会自动挖路或搭路。', { position: '绝对整数{x,y,z}' }, { type: 'navigate', position: { x: 0, y: 64, z: 0 } }],
  ['gather', '挖一块并走近拾取；blockBroken和真实inventoryDelta.added共同确认，不自动重挖air。', { position: '绝对整数', expectedId: '可选原生namespaced block ID' }, { type: 'gather', position: { x: 0, y: 65, z: 0 }, expectedId: 'minecraft:oak_log' }],
  ['dig', '只确认方块破坏，不代表已经取得掉落。', { position: '绝对整数', expectedId: '可选原生block ID' }],
  ['select', '选择快捷栏并等待实际服务端确认；本地quickBarSlot不是成功证据。', { hotbarSlot: '整数0..8，对应规范背包槽36..44' }],
  ['place', '用真实已持有物品，向参照方块的一面放置；需要空目标。', { position: '参照方块绝对整数坐标', face: '一轴±1，另两轴0', hotbarSlot: '0..8', itemId: '真实原生物品ID', blockId: '期望原生方块ID', verificationOffset: '可选[0..1,0..1,0..1]' }],
  ['craft', '原生2x2/3x3网格合成；网格/游标先空，真实结果核验后取入空背包槽。', { ingredients: '[{slot:网格槽1..4或1..9,id:真实ID,count:1..64}]', outputId: '期望原生物品ID', outputCount: '预期数量' }],
  ['recipes', '读取服务端真实RecipeManager，列出包括Create在内的实际recipeTypes；原生合成/烹饪和FD烹饪/切割可导出已确认定义，其他定义以实际definitionAvailable/code为准，false不可当成可执行配方。',
    { args: '{recipeId?,recipeType?,outputId?:严格namespaced ID,offset?:0..10000,limit?:1..12 默认6}' }, { type: 'recipes', args: { recipeType: 'create:milling', outputId: 'create:wheat_flour', limit: 1 } }],
  ['block_inspect', '本人准星可见单一方块；FD切菜板/炉灶、Create磨石会捕获绑定本人UUID/epoch/维度/绝对位置/原生ID的verificationId，最多32个、10分钟失效。可加真实recipeId确定原生产物；未知配方不猜。', { position: '绝对整数', aimOffset: '可选[0..1]^3；切菜板建议[.5,.03,.5]', expectedId: '可选原生方块ID', recipeId: '可选recipes已读取的实际ID' }, { type: 'block_inspect', position: { x: 0, y: 64, z: 0 }, aimOffset: [0.5, 0.03, 0.5] }],
  ['use_block', '一次原生右键，使用实际hit.face/cursor。原料/正确工具由本人选中槽决定；process仅用于切菜板且要求真实recipeId、匹配输入和服务器heldToolMatches。投入/加工/产出/拾取分开回执；权限拒绝或没变化返回not_observed，发送不算完成，不盲目重复。', { position: '绝对整数', aimOffset: '可选[0..1]^3；切菜板[.5,.03,.5]', expectedId: '可选原生方块ID', recipeId: '可选真实recipe ID；process必需', intent: 'interact默认|load|process|collect；不会自动选工具或搬料' }],
  ['block_verify', '仅重读此前单台可见机器和本人规范背包，不走路/放料/摇柄/收物。核验目标observe/change/output/pickup；默认1.5秒最多4次，显式0只读一次、最多8秒。pickup需期望原生ID+完整组件的实际净增加和机器移除证据，不能把吃东西/磨损当产物；未追踪掉落实体来源，worldDropObserved=null。纯读取超时是known未观察，不重放交互。', { verificationId: '本轮block_inspect/use_block返回的真实UUID', goal: 'observe默认|change|output|pickup', waitMs: '可选整数0..8000 默认1500' }],
  ['use_item', '一次使用本人当前持物；未确认效果会明确标effectVerified=false。食物优先eat。', {}],
  ['eat', '按服务端真实FOOD组件选择食品（包括农夫乐事/腐肉），原生菜单移至空快捷栏；不强装proxy。nativeComponent保留默认effects/转换，额外Java消费钩子未完整描述；不能因SNBT无effects称食物无风险。验收库存减少一份和实际饥饿值。', { itemId: '可选实际原生food ID', inventorySlot: '可选规范背包槽9..44' }, { type: 'eat', itemId: 'minecraft:rotten_flesh' }],
  ['entity_inspect', '读取本人已收到、同维度可见实体的真实主人/驯养/NPC/友方/敌对/距离证据，不扫描世界。', { entityId: '真实实体整数ID', expectedUuid: '该实体UUID' }],
  ['attack', '一次近战：实际Enemy（含模组）用于combat，无主未命名食物动物用于hunt_food；NPC/宠物/主人/队友禁止。', { entityId: '真实实体ID', expectedUuid: '该实体UUID', expectedId: '可选原生实体ID', intent: 'combat默认|hunt_food' }, { type: 'attack', entityId: 7, expectedUuid: '从entities读取', intent: 'hunt_food' }],
  ['entity_interact', '对真实实体右键一次，可交易/喂养/打开原生菜单；实际菜单/驯养变化才算已观察，其他仅sent_unverified。', { entityId: '真实实体ID', expectedUuid: '该实体UUID', expectedId: '可选原生实体ID', hand: 'main默认|off' }],
  ['menu_click', '对当前真实菜单PICKUP操作；0左键整堆、1右键逐个。完整组件和游标CAS，失败未知不重投。', { slot: '当前菜单实际槽位0..200', button: '0默认|1' }],
  ['close_menu', '关闭本人的当前容器。', {}],
  ['maid', '东方女仆：只操作本人已拥有8格内伙伴；tasks列真实可用任务；follow/pickup/task均核验服务器maidState。',
    { operation: 'list|status|tasks|follow|pickup|task|bag', maidUuid: '除list外必需真实maid UUID', args: 'follow:{follow:bool};pickup:{pickup:bool};task:{taskId:tasks返回原生ID}' }, { type: 'maid', operation: 'follow', maidUuid: '从modStates.maid读取', args: { follow: true } }],
  ['colony', 'MineColonies：status读取本人真实权限/建筑/请求；建设需要本人原生hut和材料，不能虚构token/建筑坐标。',
    { operation: 'status|found|placeBuilder|requestBuild|deliver|stockResource', args: 'found:{position,name,inventorySlot,expectedSnbt};placeBuilder:{position,inventorySlot,expectedSnbt};requestBuild:{buildingPosition,builderPosition};deliver:{buildingPosition,token,inventorySlot,quantity,expectedSnbt};stockResource:{buildingPosition,inventorySlot,quantity,expectedSnbt}',
      inventorySlot: '0..8为规范背包36..44，9..35为同编号普通库存；quantity1..64；expectedSnbt从本人真实库存原样取' }],
  ['spell', 'Ars：先持真实法术书，再list/explain实际槽位和glyph；cast消耗本人魔力。空timeline有codec；未知动态内容明确拒绝。施放确认不代表目标效果已核验。',
    { operation: 'list|explain|cast', id: 'explain/cast必需list返回ars_nouveau:slot_N' }],
  ['wait', '有界等待，并响应维护/死亡取消；不自动重放旧动作。', { seconds: '0..30' }]
].map(([id, description, parameters, example]) => ({ id, description, parameters, ...(example ? { example } : {}) }))
function agentToolCatalog (id) {
  const list = structuredClone(descriptors)
  if (id !== undefined) {
    const tool = list.find(tool => tool.id === id)
    return tool ? { ok: true, schemaVersion: 1, tool, readOnly: true } : { ok: false, code: 'agent_tool_not_found', readOnly: true, retryAutomatically: false }
  }
  return { ok: true, schemaVersion: 1, source: 'installed_society_agent_tools', tools: list, readOnly: true,
    limits: ['same_player_connection', 'native_identity_and_complete_components', 'unknown_actions_not_replayed', 'coverage_is_declared_tools_not_all_mods'] }
}
module.exports = { agentToolCatalog }

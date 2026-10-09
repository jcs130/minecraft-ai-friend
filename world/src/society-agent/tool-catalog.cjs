'use strict'
const descriptors = [
  ['tools', '查询可执行工具说明，未知模组能力不会伪装为已支持。', { operation: 'list|explain', id: 'explain时工具type' }, { type: 'tools', operation: 'explain', id: 'recipes' }],
  ['inspect', '读取本人完整原生库存、foodOptions、可见地表、附近真实实体、模组只读状态。槽0为合成预览。', {}, { type: 'inspect' }],
  ['look', '转向16格内绝对目标点，可瞄准空中或真实目标；用于法术方向和避开机器交互。返回实际原生视线查询，不把转头当成施法或命中。', { position: '绝对有限数{x,y,z}，可含小数，如实体眼睛/方块表面' }, { type: 'look', position: { x: 0.5, y: 68, z: 0.5 } }],
  ['navigate', '走向16格内绝对脚下格坐标，不自动挖路或搭路；实际同目标水平格且高度差<=.125才reached，返回真实position/3D距离/高度差，停在下层不算到达。', { position: '绝对整数{x,y,z}，玩家脚下可站立格' }, { type: 'navigate', position: { x: 0, y: 64, z: 0 } }],
  ['gather', '挖一块并走近拾取；blockBroken和真实inventoryDelta.added共同确认。不自动重挖air；晚到掉落可在新inspect中核验，不能改称本次已经pickup。不同首个服务器ray hit返回blocking真实坐标供重新计划。', { position: '绝对整数', expectedId: '可选原生namespaced block ID', aimOffset: '可选[0..1]^3，surface建议偏移只是采样，必须再通过真实server ray' }, { type: 'gather', position: { x: 0, y: 65, z: 0 }, expectedId: 'minecraft:oak_log' }],
  ['dig', '只确认方块破坏，不代表已取得掉落；实际阻挡块只读返回，不自动改挖阻挡。', { position: '绝对整数', expectedId: '可选原生block ID', aimOffset: '可选[0..1]^3' }],
  ['select', '选择快捷栏并等待实际服务端确认；本地quickBarSlot不是成功证据。', { hotbarSlot: '整数0..8，对应规范背包槽36..44' }],
  ['place', '用真实已持有物品，向参照方块的一面放置；需要空目标。', { position: '参照方块绝对整数坐标', face: '一轴±1，另两轴0', hotbarSlot: '0..8', itemId: '真实原生物品ID', blockId: '期望原生方块ID', verificationOffset: '可选[0..1,0..1,0..1]' }],
  ['craft', '原生2x2/3x3网格合成；网格/游标先空，真实结果核验后取入空背包槽。', { ingredients: '[{slot:网格槽1..4或1..9,id:真实ID,count:1..64}]', outputId: '期望原生物品ID', outputCount: '预期数量' }],
  ['recipes', '读取服务端真实RecipeManager，列出包括Create在内的实际recipeTypes；原生合成/烹饪和FD烹饪/切割可导出已确认定义，其他定义以实际definitionAvailable/code为准，false不可当成可执行配方。ingredientEncoding=prior_index_references_v1时，ingredients的alternativesFrom引用此前index的完整alternatives；native.craftRecipe自动展开，不可当作没有材料。',
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
  ['domum', 'Domum原生建筑切割台：先用use_block打开真实工作台，再state读取输入槽/结果槽/材料组；choices分页返回原生变体完整SNBT。select只调用原生菜单按钮；依次group再variant，不生成成品。投入和取出仍用menu_click，取出真实结果才消耗原料。',
    { operation: 'state|choices|select', args: 'state:{};choices:{groupId:真实namespace:path,offset:0..10000,limit:1..24};select:{selection:group|variant,groupId,variantIndex:0..4095仅variant,choiceSnbt:choices返回完整原生模板仅variant,requestId?}；CAS使用最近state缓存，每次menu_click或select后重新state；只读间隔至少600ms，不允许自定义state' }],
  ['collision', '查询本人8格内准星第一可见方块的服务器真实碰撞形状，绑定原生ID、完整属性、维度及本人UUID；未知实现/动态上下文明确不可用。返回block_local AABB，仅供观察，尚未接入Mineflayer物理或寻路。',
    { position: '绝对整数{x,y,z}', expectedBlockId: '真实原生namespaced ID', expectedProperties: '原生look.block.properties完整对象，包括所有朝向/半层等属性；无属性用{}', dimension: '可选真实namespace:path', aimOffset: '可选[0..1]^3，默认[.5,.5,.5]' }],
  ['maid', '东方女仆：只操作本人已拥有8格内伙伴；tasks列真实可用任务；follow/pickup/task均核验服务器maidState。',
    { operation: 'list|status|tasks|follow|pickup|task|bag', maidUuid: '除list外必需真实maid UUID', args: 'follow:{follow:bool};pickup:{pickup:bool};task:{taskId:tasks返回原生ID}' }, { type: 'maid', operation: 'follow', maidUuid: '从modStates.maid读取', args: { follow: true } }],
  ['colony', 'MineColonies原玩法：capabilities读取固定原蓝图、hut类型、出生距离/权限条件；status读取真实建筑/工单/居民请求。placeHut放hut不等于完工，requestBuild注册新原生workOrder不等于建筑完成；需后续status确证built=true、目标level及constructionPending=false。交料accepted不等于居民任务完成，核验真实request状态；岗位分配、招聘模式与大学研究使用mod工具的colony.*接口。',
    { operation: 'status|capabilities|resources|found|placeBuilder|placeHut|requestBuild|deliver|stockResource', args: 'resources:{buildingPosition:绝对整数,offset:0..10000默认0,limit:1..24默认12}分页读取完整原生需求SNBT及nextOffset，需求模板不能冒充本人库存expectedSnbt；found:{position,name,inventorySlot,expectedSnbt};placeBuilder:{position,inventorySlot,expectedSnbt};placeHut:{position,hutType:builder|home|farmer|warehouse|blacksmith|cook|deliveryman|university,inventorySlot,expectedSnbt};requestBuild:{buildingPosition,builderPosition};deliver:{buildingPosition,token,inventorySlot,quantity,expectedSnbt};stockResource:{buildingPosition,inventorySlot,quantity,expectedSnbt}',
      inventorySlot: '0..8为规范背包36..44，9..35为同编号普通库存；quantity1..64；expectedSnbt从本人真实库存原样取' }],
  ['spell', 'Ars：先持真实法术书，再list/explain实际槽位和glyph；cast消耗本人魔力。空timeline有codec；未知动态内容明确拒绝。施放确认不代表目标效果已核验。',
    { operation: 'list|explain|cast', id: 'explain/cast必需list返回ars_nouveau:slot_N' }],
  ['mod', '查询与调用本服原生模组接口。list列能力，explain读完整JSON schema，call按参数执行；殖民地岗位/研究、学习符文/编书、机械设置/过滤/流体和饰品菜单都走同一玩家连接，保留权限、材料与未知结果暂停。',
    { operation: 'list|explain|call', id: 'explain/call必需list返回operation ID，如colony.management；大小写保持原样', args: 'call参数必须符合explain返回的parameters；坐标绝对，组件原样回传，不能传actor/UUID替他人操作' }, { type: 'mod', operation: 'explain', id: 'spell.configure' }],
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

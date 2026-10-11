'use strict'
// Public, provider-neutral control contract. Angles use Minecraft DEGREES:
// yaw 0=south, 90=west; pitch positive=down. Never protocol/radian guesses.
const object = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum })
const string = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength })
const choice = values => ({ type: 'string', enum: values })
const hand = choice(['main', 'off'])
const held = { hand, expectedHotbarSlot: integer(0, 8), expectedHeldSnbt: string(60000) }
const entity = { entityId: integer(0, 2147483647), expectedUuid: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' } }
const menu = { windowId: integer(0, 255), expectedStateId: integer(0, 32767), expectedControlHash: { type: 'string', pattern: '^[0-9a-f]{64}$' } }
const durationMs = integer(50, 10000)
const rows = [
  ['body.controls', true, '本人真实视角、地面/水中/乘骑/使用物品/飞行状态；角度单位为 Minecraft 度。', object()],
  ['body.target', true, '本人准星交互距离内的首个原生方块/实体命中点、绝对坐标和 targetToken；不透视。', object()],
  ['body.input', false, '组合前后左右、跳跃、疾跑、潜行按键；持续 50–10000ms 后自动释放，可取消。不会寻路/传送/授予飞行。',
    object({ keys: { type: 'array', items: choice(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']), maxItems: 7, uniqueItems: true }, durationMs, yaw: number(-180, 180), pitch: number(-90, 90) }, ['keys', 'durationMs'])],
  ['body.look', false, '转动本人视角；Minecraft 度，yaw 0=南/+90=西，pitch 正值朝下；relative=true 为增量。',
    object({ yaw: number(-360, 360), pitch: number(-180, 180), relative: { type: 'boolean' } }, ['yaw', 'pitch'])],
  ['body.mouse', false, '原生左右键准星操作：左键攻击实体/持续挖掘方块，右键交互方块/实体或使用手持物；先读取 body.target 的 targetToken。',
    object({ button: choice(['left', 'right']), expectedTargetToken: string(64, 64), ...held, durationMs })],
  ['body.attack', false, '主手普通玩家近战攻击一个仍可见、在原生触及距离内的准确实体 UUID；保留 PVP/友伤/模组事件规则。', object({ ...entity, ...held, hand: choice(['main']) })],
  ['body.interactEntity', false, '以指定手原生右键一个可见可触及实体；可打开交易/模组菜单，保留游戏权限。', object({ ...entity, ...held })],
  ['body.swing', false, '指定手挥动动画，不假报伤害或命中。', object({ hand })],
  ['body.dismount', false, '本人离开当前坐骑，保留原生事件与可下骑条件。', object()],
  ['body.flight', false, '仅在本人原本允许飞行时开关飞行；不授予创造模式或权限。上下运动仍受身体/物理实现限制。', object({ flying: { type: 'boolean' } })],
  ['inventory.selectHotbar', false, '选择本人快捷栏 0–8；要求目标物品完整 SNBT 一致，空槽为空字符串。', object({ hotbarSlot: integer(0, 8), expectedSnbt: string(60000) })],
  ['inventory.swapHands', false, '原生菜单 SWAP 交换主副手，双方完整 SNBT 与当前快捷栏 CAS；不复制物品。',
    object({ expectedHotbarSlot: integer(0, 8), expectedMainSnbt: string(60000), expectedOffSnbt: string(60000) })],
  ['inventory.drop', false, '从指定手丢出一件或整堆真实物品；完整 SNBT CAS，保留原生绑定/丢弃事件。', object({ ...held, all: { type: 'boolean' } })],
  ['inventory.useHeld', false, '原生长按使用指定手物品，50–10000ms 后释放；用于吃饭、喝药、拉弓、盾牌和模组物品，须再观察实际效果。', object({ ...held, durationMs })],
  ['menu.nativeClick', false, '完整原生菜单鼠标操作：PICKUP/QUICK_MOVE/SWAP/THROW/PICKUP_ALL/QUICK_CRAFT/CLONE；窗口、状态和所有槽位/游标摘要 CAS，CLONE 要创造模式。',
    object({ ...menu, slot: integer(-999, 511), button: integer(0, 40), clickType: choice(['PICKUP', 'QUICK_MOVE', 'SWAP', 'THROW', 'PICKUP_ALL', 'QUICK_CRAFT', 'CLONE']) })],
  ['menu.button', false, '调用本人当前原生菜单按钮（交易选择/模组按钮等），完整菜单 CAS；保留原生按钮规则。', object({ ...menu, buttonId: integer(0, 65535) })],
  ['body.command', false, '以本玩家原有权限执行一条游戏命令（无前导 /）；不会切换控制台/OP 身份。回执只证明派发，实际效果另行查询。', object({ command: string(2048, 1) })],
  ['control.actionStatus', true, '查询本身体一个持续控制 ticket 的真实进度/终态，旧进程或未知 ticket 明确返回 unknown。', object({ ticket: string(64, 1) })],
  ['control.cancel', false, '释放本身体指定 ticket 的持续按键/挖掘/使用；返回取消后的实际终态，不回滚已发生效果。', object({ ticket: string(64, 1) })]
]
const controlOperations = rows.map(([id, readOnly, description, parameters]) => ({ id, readOnly, description, parameters,
  units: { angles: 'minecraft_degrees', duration: 'milliseconds', position: 'absolute_world_blocks' } }))
module.exports = { controlOperations }

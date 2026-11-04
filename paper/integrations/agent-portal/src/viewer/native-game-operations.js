const labels = Object.freeze({
  inventory_query: '查看背包', stash_query: '清点个人箱', stash_deposit_request: '请求存入个人箱',
  stash_withdraw_request: '请求从个人箱取物', stash_request: '请求打开个人箱',
  party_request: '请求组队操作', reward_request: '请求奖励操作', activity_request: '查询或操作冒险活动',
  travel_request: '查询或请求传送', skill_request: '查询或使用技能', trade_request: '请求交易操作',
  photo_request: '请求拍照操作', guide_query: '查看状态或指引',
  open_inventory: '打开物品界面', close_inventory: '关闭物品界面', inventory_interact: '整理物品',
  craft: '合成物品', attack: '攻击', interact: '与实体交互', pickup: '拾取物品', drop: '丢出物品',
  consume: '食用或饮用物品', teleport: '传送', break_block: '挖掘方块', place_block: '放置方块'
})

export function projectGameOperations(value) {
  if (!Array.isArray(value)) return []
  return value.slice(-12).flatMap(row => typeof row?.kind === 'string' && Object.hasOwn(labels, row.kind) &&
    Number.isSafeInteger(row.at) && row.at > 0 && row.at <= 8.64e15 ? [{ kind: row.kind, at: row.at }] : [])
}

export function gameOperationLabel(kind) { return labels[kind] }

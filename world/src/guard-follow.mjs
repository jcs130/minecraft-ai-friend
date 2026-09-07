// 护花双卫决策（2026-08-30 造物主谕「萌萌上线之后让桐人或者鸣人跟随她」）。
// 纯函数 + 常量，无 IO——mc-god.ts 的 60s sweep / playerJoined 即时触发共用，
// tests/js/guard-follow.test.mjs 直接对本文件做运行时断言（node --test 原生可跑）。

export const GUARD_FOLLOW_TARGET = 'MengMeng'
// 萌萌离线 UUID（offline 模式，usercache.json 权威；follow 经 entity_uuid 直连不受视距限制）
export const GUARD_FOLLOW_UUID = '1949104d-60e2-3a33-9bfe-d2e897b60dfb'
export const GUARD_FOLLOW_SPEC = [
  { name: 'Kirito', distance: 4 },
  { name: 'Naruto', distance: 6 }, // 错开距离防双卫互挤
]

/**
 * 决策：本轮 sweep 需要补发 follow 的守卫列表。
 *
 * @param {string[] | Set<string> | null} online 在线名单（RCON list 解析结果）
 * @param {Record<string, string>} taskByGuard 各守卫当前任务（task_status 的 task 字段；空串/缺键=空闲）
 * @returns {Array<{name: string, distance: number}>} 待补发守卫（含跟随距离）
 *
 * 规则（与 numen 语义对齐）：
 *  - 萌萌离线 → 返回 []（follow 任务由服务端按「目标离开世界」自动了断，守卫自由，不干预）；
 *  - 守卫离线 → 跳过（不列入）；
 *  - task === 'follow' → 已在跟随，跳过；
 *  - task 非空（attack/mine/…）→ 守卫在忙正事，绝不打断，等下轮空闲再补；
 *  - task 为空 → 空闲，列入补发名单。
 */
export function decideGuardFollow(online, taskByGuard) {
  const on = online instanceof Set ? online : new Set(online ?? [])
  if (!on.has(GUARD_FOLLOW_TARGET)) return []
  const out = []
  for (const g of GUARD_FOLLOW_SPEC) {
    if (!on.has(g.name)) continue
    const task = taskByGuard?.[g.name] ?? ''
    if (task) continue // follow 在跟或忙正事都不动
    out.push(g)
  }
  return out
}

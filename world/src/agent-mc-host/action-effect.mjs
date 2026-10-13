/** Compare authoritative samples, separately from whether an input was accepted.
 * This never declares task completion, retries an action or chooses a strategy.
 */
export function describeActionEffect({ operation, args = {}, before, after, receipt, now = Date.now() }) {
  const native = receipt?.result || receipt
  const base = { operation, taskCompletionInferred: false }
  if (receipt?.outcomeUnknown || native?.outcomeUnknown || receipt?.status === 'unknown') return {
    ...base, available: false, code: 'action_effect_unknown', noDisplacement: null
  }
  const sample = s => s?.ok === true && s.status === 'alive' && s.bodyId && typeof s.dimension === 'string' &&
    Number.isFinite(Date.parse(s.capturedAt)) && ['x', 'y', 'z'].every(k => Number.isFinite(s.position?.[k]))
  if (!sample(before) || !sample(after) || before.bodyId !== after.bodyId ||
      before.dimension !== after.dimension || Date.parse(after.capturedAt) < Date.parse(before.capturedAt) ||
      now - Date.parse(after.capturedAt) > 15000 || now - Date.parse(after.capturedAt) < -5000) return {
    ...base, available: false, code: 'action_effect_samples_unavailable', noDisplacement: null
  }
  const delta = Object.fromEntries(['x', 'y', 'z'].map(k => [k, after.position[k] - before.position[k]]))
  const distance = Math.hypot(...Object.values(delta))
  // A stationary look, sneak, menu click or wait can be entirely intentional.
  const movementRequested = operation === 'body.move' || operation === 'body.input' &&
    Array.isArray(args?.keys) && args.keys.some(key => ['forward', 'back', 'left', 'right', 'jump'].includes(key))
  const noDisplacement = movementRequested && distance < 0.05
  return { ...base, available: true, bodyId: after.bodyId, capturedAt: after.capturedAt,
    from: before.position, to: after.position, dimension: after.dimension, delta, distance,
    movementRequested, noDisplacement, code: noDisplacement ? 'no_displacement_observed' : 'position_delta_observed',
    hint: noDisplacement ? '按键执行结束不等于走到了。前后实际坐标没有位移；观察碰撞、脚下/头顶可见方块与游戏前置条件，再选择不同动作。不要把原地前进当作探索到新区域。' : null }
}

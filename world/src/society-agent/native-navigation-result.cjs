'use strict'
function nativeNavigationResult ({ requestedPosition, position, radius = 1, exact = false, goalSatisfied }) {
  if (!requestedPosition || !position || !['x', 'y', 'z'].every(key => Number.isFinite(requestedPosition[key]) && Number.isFinite(position[key])) ||
      !Number.isFinite(radius) || radius < 0 || radius > 2 || typeof exact !== 'boolean') throw Error('INVALID_NATIVE_NAVIGATION_RESULT')
  const actualPosition = { x: position.x, y: position.y, z: position.z }
  const delta = { x: position.x - (requestedPosition.x + .5), y: position.y - requestedPosition.y, z: position.z - (requestedPosition.z + .5) }
  const distance = Math.hypot(delta.x, delta.y, delta.z)
  const node = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }
  const nativeNodeDistance = Math.hypot(...['x', 'y', 'z'].map(key => node[key] - requestedPosition[key]))
  // Same locked GoalBlock/GoalNear integer-node predicate. A resolved goto
  // is not proof: its noPath/empty-path branch can also resolve.
  const pathfinderGoalSatisfied = goalSatisfied ?? (exact ? nativeNodeDistance === 0 : nativeNodeDistance <= radius)
  const exactPosition = nativeNodeDistance === 0 && Math.abs(delta.y) <= .125
  const reached = pathfinderGoalSatisfied && (exact ? exactPosition : distance <= radius)
  return { ok: reached, code: reached ? exact ? 'navigation_target_reached' : 'navigation_within_radius' : 'navigation_target_not_reached',
    requestedPosition: { ...requestedPosition }, position: actualPosition, reached, exactPosition, withinRadius: distance <= radius,
    requestedRadius: exact ? 0 : radius, pathfinderGoalSatisfied, distanceToRequested: distance, verticalDifference: delta.y,
    proofSource: 'same_player_connection_position', outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
}
module.exports = { nativeNavigationResult }

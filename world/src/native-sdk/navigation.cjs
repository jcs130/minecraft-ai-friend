'use strict'
const { nativeNavigationResult } = require('../society-agent/native-navigation-result.cjs')
const routeFailures = new Set(['NoPath', 'Timeout', 'GoalChanged', 'PathStopped'])

// Route rejection is different from losing the body/transport. A stopped,
// same-body walk with a fresh server position can report known partial progress.
async function walkAndObserve({ bot, goal, position, scope, snapshot }) {
  let routeError = null
  scope.phase('walking'); scope.mutationDispatched()
  try { await bot.pathfinder.goto(goal) }
  catch (error) {
    if (!routeFailures.has(error.name)) throw error
    routeError = error.name
  } finally {
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
  }
  scope.check()
  await scope.wait(200)
  const after = await snapshot(); scope.check()
  if (!after.ok || after.status !== 'alive' || bot.pathfinder.isMoving() || Object.values(bot.controlStates || {}).some(Boolean)) return {
    ok: false, code: 'navigation_stop_or_position_unconfirmed', outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false
  }
  const result = nativeNavigationResult({ requestedPosition: position, position: after.position, exact: true })
  return { ...result, code: result.ok ? result.code : routeError ? 'navigation_path_failed' : result.code,
    navigationError: routeError, keysReleased: true, pathStopped: true, proofSource: 'fresh_same_body_server_snapshot_after_stop' }
}
module.exports = { walkAndObserve }

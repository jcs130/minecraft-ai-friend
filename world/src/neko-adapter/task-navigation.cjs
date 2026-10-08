'use strict'
const attached = new WeakSet()
// Install after Mineflayer spawn: pathfinder does not yet exist at Agent.start.
// Explicit native place/dig remain available; navigation itself cannot build.
function attachTaskNavigation (bot) {
  const pathfinder = bot?.pathfinder
  if (!pathfinder || ['getPathTo', 'getPathFromTo', 'setMovements'].some(name => typeof pathfinder[name] !== 'function')) throw Error('NEKO_TASK_PATHFINDER_NOT_READY')
  if (attached.has(pathfinder)) return
  const constrain = movement => {
    if (!movement) throw Error('NEKO_TASK_MOVEMENTS_UNAVAILABLE')
    movement.canDig = false; movement.allowParkour = false
    movement.allow1by1towers = false; movement.scafoldingBlocks = []
    return movement
  }
  constrain(pathfinder.movements)
  for (const name of ['getPathTo', 'getPathFromTo', 'setMovements']) {
    const original = pathfinder[name].bind(pathfinder)
    pathfinder[name] = (movement, ...args) => original(constrain(movement), ...args)
  }
  attached.add(pathfinder)
}
module.exports = { attachTaskNavigation }

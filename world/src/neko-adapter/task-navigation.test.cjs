'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { attachTaskNavigation } = require('./task-navigation.cjs')
test('navigation must wait for the actual spawned pathfinder', () => {
  assert.throws(() => attachTaskNavigation({}), /PATHFINDER_NOT_READY/)
})
test('both plan entry points and execution constrain newly constructed fallback movements', () => {
  const calls = [], pathfinder = { movements: {},
    getPathTo (m, goal) { calls.push([this, m, goal]); return 'planned' },
    * getPathFromTo (m, start, goal) { calls.push([this, m, start, goal]); yield 'generator-plan' },
    setMovements (m) { this.movements = m } }
  attachTaskNavigation({ pathfinder })
  const before = pathfinder.getPathTo
  attachTaskNavigation({ pathfinder }); assert.equal(pathfinder.getPathTo, before)
  for (const name of ['getPathTo', 'getPathFromTo', 'setMovements']) {
    const movement = { canDig: true, allowParkour: true, allow1by1towers: true, scafoldingBlocks: [4] }
    const result = pathfinder[name](movement, 'start', 'goal')
    if (name === 'getPathFromTo') assert.equal(result.next().value, 'generator-plan')
    assert.deepEqual(movement, { canDig: false, allowParkour: false, allow1by1towers: false, scafoldingBlocks: [] })
  }
  assert.ok(calls.every(row => row[0] === pathfinder))
  assert.equal(pathfinder.movements.canDig, false)
})

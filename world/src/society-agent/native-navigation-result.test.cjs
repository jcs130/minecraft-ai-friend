'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeNavigationResult } = require('./native-navigation-result.cjs')
test('real shallow-pit fixture is not exact arrival or success at an upper block, even after pathfinder reports completion', () => {
  const position = { x: 103.4778678, y: 66, z: 72.34364 }
  for (const requestedPosition of [{ x: 104, y: 67, z: 72 }, { x: 102, y: 67, z: 71 }, { x: 103, y: 67, z: 73 }]) {
    const result = nativeNavigationResult({ requestedPosition, position, exact: true })
    assert.equal(result.ok, false); assert.equal(result.reached, false); assert.equal(result.exactPosition, false); assert.equal(result.verticalDifference, -1)
    assert.deepEqual(result.position, position); assert.ok(result.distanceToRequested >= 1)
  }
})
test('standing on target tile at native step epsilon is exact, while explicit approach-radius success remains distinct', () => {
  const requestedPosition = { x: 10, y: 64, z: 20 }
  const exact = nativeNavigationResult({ requestedPosition, position: { x: 10.9, y: 64, z: 20.1 }, exact: true })
  assert.equal(exact.ok, true); assert.equal(exact.exactPosition, true)
  const nearby = nativeNavigationResult({ requestedPosition, position: { x: 11.5, y: 65, z: 20.5 }, radius: 2 })
  assert.equal(nearby.ok, true); assert.equal(nearby.exactPosition, false); assert.equal(nearby.code, 'navigation_within_radius')
  assert.equal(nativeNavigationResult({ requestedPosition, position: { x: 10.5, y: 65, z: 20.5 }, exact: true }).ok, false)
  assert.equal(nativeNavigationResult({ requestedPosition, position: { x: 10.5, y: 64, z: 20.5 }, exact: true, goalSatisfied: false }).ok, false, 'resolved empty path cannot override goal.isEnd=false')
  assert.equal(nativeNavigationResult({ requestedPosition, position: { x: 10.5, y: 63.9375, z: 20.5 }, exact: true }).ok, false, 'height tolerance cannot override wrong native goal node')
})

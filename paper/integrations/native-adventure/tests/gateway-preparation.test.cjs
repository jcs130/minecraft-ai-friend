const { test } = require('node:test'), assert = require('node:assert/strict')
const { validateExport, prepare } = require('../prepare_agent_gateway.cjs')
const now = Date.now(), complete = () => ({ schemaVersion: 1, processId: 1234, completedAt: new Date(now).toISOString() })
const channels = () => ({ schemaVersion: 1, minecraft: '1.21.1', neoforge: '21.1.252', protocols: { '1': [{ id: 'lootr:open_container', version: 'lootr-1.21.0-1', optional: false, flow: 1 }] } })
test('a fresh actual-loader declaration is accepted without rewriting it', () => { assert.doesNotThrow(() => validateExport(complete(), channels(), 1234, now)) })
test('stale, future, or previous-process registry exports never start a gateway', () => {
  assert.throws(() => validateExport(complete(), channels(), 4321, now), /JVM/)
  assert.throws(() => validateExport(complete(), channels(), 1234, now + 600001), /FRESH/)
  assert.throws(() => validateExport(complete(), channels(), 1234, now - 5001), /FRESH/)
})
test('unknown loaders, duplicate channels and modified protocols remain errors', () => {
  const wrong = channels(); wrong.neoforge = '21.1.999'; assert.throws(() => validateExport(complete(), wrong, 1234, now), /VERSION/)
  const duplicate = channels(); duplicate.protocols['1'].push(duplicate.protocols['1'][0]); assert.throws(() => validateExport(complete(), duplicate, 1234, now), /DUPLICATE/)
})
test('privileged or implicit invalid ports are rejected before touching the filesystem', () => {
  assert.throws(() => prepare({ listenPort: 0, backendPort: 39761 }), /PORT/)
  assert.throws(() => prepare({ listenPort: 39771, backendPort: 22 }), /PORT/)
})

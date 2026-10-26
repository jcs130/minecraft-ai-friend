const { test } = require('node:test'), assert = require('node:assert/strict')
const { rebaseItems } = require('./prepare_live_registry.cjs')
test('boot-dependent native IDs rebase by exact names, keeping model markers and variants', () => {
  const input = { schemaVersion: 1, items: [
    { nativeId: 10, nativeItem: 'pots:green', customModelData: 8000001, displayName: '绿盆' },
    { nativeId: 11, nativeItem: 'pots:blue', customModelData: 8000002, displayName: '蓝盆', variants: { x: { customModelData: 8000003 } } }
  ] }
  const output = rebaseItems(input, 'pots:blue\t10\npots:green\t11\n')
  assert.equal(output.items[0].nativeId, 11); assert.equal(output.items[0].customModelData, 8000001)
  assert.equal(output.items[1].nativeId, 10); assert.deepEqual(output.items[1].variants, input.items[1].variants)
  assert.equal(input.items[0].nativeId, 10)
})
test('missing, invalid and duplicate registry names never become approximate items', () => {
  const input = { schemaVersion: 1, items: [{ nativeId: 10, nativeItem: 'pots:green', customModelData: 8000001 }] }
  assert.throws(() => rebaseItems(input, 'pots:blue\t10\n'), /MISSING/)
  assert.throws(() => rebaseItems(input, 'pots:green\t10\npots:green\t11'), /INVALID/)
  assert.throws(() => rebaseItems(input, 'pots:green\t10\npots:blue\t10'), /INVALID/)
  assert.throws(() => rebaseItems(input, 'pots:green\t-1'), /INVALID/)
})

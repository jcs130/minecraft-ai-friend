'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { nativeStackIdentity, nativeComponentDelta } = require('./native-stack-identity.cjs')
const stack = (count = 1, components = '{"minecraft:custom_data":{count:4b,list:[I;1,2],text:"comma,count:99"}}') =>
  ({ id: 'create:wheat_flour', count, snbt: `{components:${components},count:${count},id:"create:wheat_flour"}` })
test('only outer count is ignored; complete typed/nested/string components retain identity and original SNBT', () => {
  const a = nativeStackIdentity(stack()), b = nativeStackIdentity(stack(3))
  assert.equal(a.available, true); assert.equal(a.key, b.key); assert.equal(a.snbt, stack().snbt)
  assert.notEqual(a.key, nativeStackIdentity(stack(1, '{"minecraft:custom_data":{count:4,list:[I;1,2],text:"comma,count:99"}}')).key)
})
test('ID/count conflicts, duplicate outer fields, malformed structures and excessive budgets are unavailable', () => {
  for (const item of [{ ...stack(), count: 2 }, { ...stack(), id: 'minecraft:flour' },
    { ...stack(), snbt: '{id:"create:wheat_flour",count:1,count:1}' },
    { ...stack(), snbt: '{id:"create:wheat_flour",count:1,components:{a:[1}}' },
    { ...stack(), snbt: '{id:"create:wheat_flour",count:1,components:{a:' + '['.repeat(17) + '1' + ']'.repeat(17) + '}}' },
    { ...stack(), snbt: ' '.repeat(65537) }]) assert.equal(nativeStackIdentity(item).available, false)
})
test('native stack merging is a count gain with complete components, while durability/component replacement is a separate identity', () => {
  const merged = nativeComponentDelta([stack()], [stack(4)])
  assert.equal(merged.added[0].count, 3); assert.equal(merged.added[0].stacks[0].snbt, stack(4).snbt)
  const replaced = nativeComponentDelta([stack()], [stack(1, '{"minecraft:damage":1}')])
  assert.equal(replaced.added[0].count, 1); assert.equal(replaced.removed[0].count, 1)
  assert.notEqual(replaced.added[0].key, replaced.removed[0].key)
})

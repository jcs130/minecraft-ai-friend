import test from 'node:test'
import assert from 'node:assert/strict'
import { modelPlan } from './plan.mjs'
const tools = [{ name: 'mc_do', parameters: { type: 'object', required: ['action_id', 'operation'],
  properties: { action_id: { type: 'string', minLength: 1 }, operation: { type: 'string' }, args: { type: 'object', properties: {}, additionalProperties: true } }, additionalProperties: false } }]
test('a completed but malformed response is explicit zero-dispatch feedback, never repaired into an action', () => {
  const result = modelPlan('{"tool":"mc_do","arguments":{"action_id":"x","operation":"world.place"},"reason":"missing final brace"', tools)
  assert.equal(result.error.code, 'trial_model_plan_not_json')
  assert.equal(result.error.mutationDispatched, false); assert.equal(result.plan, undefined)
})
test('invalid mutation envelopes and invented tools are rejected locally before entering the SDK', () => {
  assert.equal(modelPlan('{"tool":"mc_do","arguments":{"operation":"world.dig"}}', tools).error.code, 'trial_model_tool_arguments_invalid')
  assert.equal(modelPlan('{"tool":"mc_do","arguments":{"action_id":"x","operation":"world.dig","extra":1}}', tools).error.mutationDispatched, false)
  assert.equal(modelPlan('{"tool":"free_items","arguments":{}}', tools).error.code, 'trial_model_tool_unavailable')
})
test('valid arguments and exact SNBT remain unchanged, including code-fenced JSON', () => {
  const plan = { tool: 'mc_do', arguments: { action_id: 'dig-a', operation: 'world.dig', args: { expectedHeldSnbt: '{count:1,id:"minecraft:stone"}' } }, reason: 'dig' }
  assert.deepEqual(modelPlan('```json\n' + JSON.stringify(plan) + '\n```', tools), { plan })
})

test('host-only reason metadata may be normalized without altering any native action parameter', () => {
  const args = { action_id: 'place-a', operation: 'world.place', args: { expectedSnbt: '{exact:true}' }, reason: 'place this' }
  const result = modelPlan(JSON.stringify({ tool: 'mc_do', arguments: args }), tools)
  assert.deepEqual(result.plan.arguments, { action_id: args.action_id, operation: args.operation, args: args.args })
  assert.equal(result.plan.reason, args.reason); assert.deepEqual(result.normalizations, ['reason_metadata_hoisted'])
})

'use strict'
const { parameterProblem } = require('../tau-ceti/native-bridge/native-client.cjs')
const contract = require('../tau-ceti/native-bridge/operations.json')
const recipe = contract.operations.find(row => row.id === 'native.recipes')
const item = contract.operations.find(row => row.id === 'inventory.inspect')
if (!recipe || !item) throw Error('native_read_contract_required')
const sections = ['state', 'inventory', 'menu', 'capabilities', 'recipes', 'item']
const NATIVE_READ_TOOL = {
  name: 'mc_native', tags: ['read'],
  description: 'Read this connection\'s real mod state, original inventory/components, actual menu rules, capabilities, one item or native recipes. No images required. Recipes accept recipeId/recipeType/outputId, at most 12 rows/16 KiB; partial replies retain nextOffset. Discover actual capabilities first. Read definitions do not execute crafting or machines. Unknown information stays unknown.',
  parameters: { type: 'object', additionalProperties: false, required: ['section'], properties: {
    section: { type: 'string', enum: sections },
    recipe: structuredClone(recipe.parameters),
    slot: structuredClone(item.parameters.properties.slot)
  } }
}
function invalid (field, expected, issue, example) {
  const response = { ok: false, status: 'invalid_arguments', reason: 'invalid_arguments', diagnostic: { field, expected, issue }, example,
    readOnly: true, retryable: false, retryAutomatically: false, outcomeKnown: true }
  return { text: 'native query: invalid_arguments', failed: true, data: { response } }
}
async function executeNativeRead (bot, args) {
  const problem = parameterProblem(args, NATIVE_READ_TOOL.parameters)
  if (problem) return invalid(problem.field, problem.expected, problem.issue, { section: 'capabilities' })
  if (!sections.includes(args.section)) return invalid('args.section', sections.join('|'), 'unknown section', { section: 'capabilities' })
  if (args.recipe !== undefined && args.section !== 'recipes') return invalid('args.recipe', 'only with section=recipes', 'conflicting section', { section: 'recipes', recipe: args.recipe })
  if (args.slot !== undefined && args.section !== 'item') return invalid('args.slot', 'only with section=item', 'conflicting section', { section: 'item', slot: args.slot })
  if (args.section === 'item' && args.slot === undefined) return invalid('args.slot', 'required integer player inventory menu slot 0..45', 'missing', { section: 'item', slot: 36 })
  if (!bot?.native) return { text: 'native query: unavailable', failed: true, data: { response: { ok: false, status: 'unavailable', reason: 'native_provider_not_attached', retryAutomatically: false } } }
  let value
  switch (args.section) {
    case 'state': value = await bot.native.snapshot(); break
    case 'inventory': case 'menu': value = await bot.native.call('menu.current', {}); break
    case 'capabilities': value = await bot.native.operations(); break
    case 'recipes': value = await bot.native.recipes(args.recipe || {}); break
    case 'item': value = await bot.native.inspect(args.slot); break
  }
  // Keep the established text contract of the original four sections. New
  // sections carry the full receipt once, with an optional safe continuation.
  if (!['recipes', 'item'].includes(args.section)) return { text: JSON.stringify(value), failed: value.ok === false }
  const data = { response: value }
  if (args.section === 'recipes' && value.ok && Number.isSafeInteger(value.nextOffset) && value.nextOffset >= 0) {
    data.next = { tool: 'mc_native', arguments: { section: 'recipes', recipe: { ...(args.recipe || {}), offset: value.nextOffset } } }
  }
  return { text: `native ${args.section}: ${value.status || (value.ok ? 'ok' : 'unavailable')}`,
    failed: value.ok === false, data }
}
module.exports = { NATIVE_READ_TOOL, executeNativeRead }

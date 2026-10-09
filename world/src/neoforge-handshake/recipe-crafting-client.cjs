'use strict'
const { craftNativeGrid } = require('./native-crafting-client.cjs')
const known = (code, more = {}) => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, ...more })
const layout = s => s?.menuType === 'minecraft:inventory' ? { width: 2, start: 9, end: 44 } : s?.menuType === 'minecraft:crafting' ? { width: 3, start: 10, end: 45 } : null

// The wire catalog keeps a large tag's full alternatives once. Validate all
// references before any menu click, including recovery of old grid contents.
function recipeIngredients (row) {
  if (row.ingredientEncoding !== undefined && row.ingredientEncoding !== 'prior_index_references_v1') return null
  if (!Array.isArray(row.ingredients) || !row.ingredients.length || row.ingredients.length > 9) return null
  const decoded = []
  for (const [index, input] of row.ingredients.entries()) {
    if (!input || input.index !== index || typeof input.empty !== 'boolean' || input.requiredCount !== (input.empty ? 0 : 1)) return null
    let alternatives = input.alternatives
    if (input.alternativesFrom !== undefined) {
      const prior = input.alternativesFrom
      if (row.ingredientEncoding !== 'prior_index_references_v1' || alternatives !== undefined || input.empty ||
          !Number.isInteger(prior) || prior < 0 || prior >= index || decoded[prior].empty) return null
      alternatives = decoded[prior].alternatives
    }
    if (!Array.isArray(alternatives) || alternatives.length > 64 ||
        (input.empty ? alternatives.length !== 0 : !alternatives.length) ||
        alternatives.some(option => !option || typeof option.id !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(option.id))) return null
    decoded.push({ ...input, alternatives })
  }
  return decoded
}

// General original-recipe translation, never a windmill/building script. The
// model selects one recipe; ordinary menu clicks consume and produce all items.
async function craftNativeRecipe (menu, native, playerUuid, { recipeId, clearInputs = false }) {
  const query = await native.recipes({ recipeId, recipeType: 'minecraft:crafting', limit: 1 }), row = query?.recipes?.[0]
  if (!query?.ok || query.playerUuid !== playerUuid || query.recipes?.length !== 1 || row?.recipeId !== recipeId ||
      row.type !== 'minecraft:crafting' || row.definitionAvailable !== true || !row.output?.snbt ||
      !['minecraft:crafting_shaped', 'minecraft:crafting_shapeless'].includes(row.serializer)) return known('native_crafting_recipe_unavailable', {
        recipeId, definitionCode: row?.code ?? null, definitionAvailable: row?.definitionAvailable ?? false,
        hint: 'The server recipe definition is unavailable or unsupported; this is not evidence of missing materials. Inspect native.recipes. No menu click was dispatched.' })
  const decodedIngredients = recipeIngredients(row)
  if (!decodedIngredients) return known('native_recipe_ingredients_invalid')
  let state = menu.current(), grid = layout(state)
  if (!grid || state.playerUuid !== playerUuid || state.carried) return known('native_crafting_menu_or_cursor_unavailable')
  const width = row.grid?.width ?? (row.serializer === 'minecraft:crafting_shapeless' ? grid.width : null)
  const height = row.grid?.height ?? (row.serializer === 'minecraft:crafting_shapeless' ? Math.ceil(decodedIngredients.length / grid.width) : null)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > grid.width || height > grid.width) return known('native_recipe_requires_larger_crafting_grid')
  const receiptIDs = []
  for (let slot = 1; slot <= grid.width ** 2; slot++) {
    state = menu.current()
    if (!state.slots[slot]) continue
    if (!clearInputs) return known('crafting_grid_not_empty', { slot, hint: 'Inspect grid or explicitly use clearInputs:true to return old inputs before crafting.' })
    const item = state.slots[slot], destination = state.slots.findIndex((value, i) => i >= grid.start && i <= grid.end && !value)
    if (destination < 0) return known('no_empty_input_return_slot', { receiptIDs })
    for (const target of [slot, destination]) {
      const receipt = await menu.click(target, 0)
      if (receipt?.requestId) receiptIDs.push(receipt.requestId)
      if (!receipt?.ok || !receipt.changed) return { ...known(receipt?.code ?? 'native_grid_return_rejected'),
        outcomeKnown: receipt?.outcomeKnown !== false, outcomeUnknown: receipt?.outcomeUnknown === true, receiptIDs }
      const after = menu.current()
      if (after?.playerUuid !== playerUuid || after.windowId !== state.windowId ||
          (target === slot ? after.carried?.snbt !== item.snbt || after.slots[slot] : after.carried || after.slots[destination]?.snbt !== item.snbt)) return known('native_grid_return_state_changed', { receiptIDs })
    }
  }
  state = menu.current()
  const available = new Map()
  for (let slot = grid.start; slot <= grid.end; slot++) {
    const item = state.slots[slot]
    if (item?.snbt && state.mayPickup?.[slot]) available.set(item.id, (available.get(item.id) ?? 0) + item.count)
  }
  let attempts = 0
  const inputs = decodedIngredients.filter(i => !i.empty)
  function choose (index, selected) {
    if (++attempts > 4096) return null
    if (index === inputs.length) return selected
    const input = inputs[index]
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= width * height || input.requiredCount !== 1 || !Array.isArray(input.alternatives)) return null
    for (const option of input.alternatives) {
      const count = available.get(option.id) ?? 0
      if (count < 1) continue
      available.set(option.id, count - 1)
      const slot = 1 + Math.floor(input.index / width) * grid.width + input.index % width
      const result = choose(index + 1, [...selected, { slot, id: option.id, count: 1 }])
      available.set(option.id, count)
      if (result) return result
    }
    return null
  }
  const ingredients = choose(0, [])
  if (!ingredients?.length) return known('native_recipe_ingredients_unavailable', { recipeId, receiptIDs })
  const result = await craftNativeGrid(menu, { ingredients, outputId: row.output.id, outputCount: row.output.count, expectedOutputSnbt: row.output.snbt })
  return { ...result, recipeId, ingredients, receiptIDs: [...receiptIDs, ...result.receiptIDs] }
}
module.exports = { craftNativeRecipe }

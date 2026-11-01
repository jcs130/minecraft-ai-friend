'use strict'

function chooseIngredients (choices, counts, limit = 4000) {
  const chosen = new Array(choices.length).fill(null)
  let visits = 0; let budget = false
  function visit (index) {
    if (++visits > limit) { budget = true; return false }
    if (index === choices.length) return true
    if (!choices[index].length) return visit(index + 1)
    for (const id of choices[index]) {
      if ((counts.get(id) || 0) < 1) continue
      counts.set(id, counts.get(id) - 1); chosen[index] = id
      if (visit(index + 1)) return true
      counts.set(id, counts.get(id) + 1); chosen[index] = null
    }
    return false
  }
  return { ids: visit(0) ? chosen : null, status: budget ? 'unknown_budget' : chosen.every((x, i) => x !== null || !choices[i].length) ? 'available' : 'missing_materials' }
}

function attachRecipes (bot, recipes, req) {
  if (!Array.isArray(recipes)) throw new Error('native_grid_recipes_required')
  const Recipe = req('prismarine-recipe')(bot.registry).Recipe
  const convert = (row, inventory) => {
    const counts = new Map()
    for (const item of inventory) counts.set(item.type, (counts.get(item.type) || 0) + item.count)
    const picked = chooseIngredients(row.choices, counts)
    const ids = picked.ids || row.choices.map(c => c[0] ?? null)
    const definition = { result: { id: row.resultId, count: row.resultCount } }
    if (row.shaped) definition.inShape = Array.from({ length: row.height }, (_, y) => ids.slice(y * row.width, (y + 1) * row.width))
    else definition.ingredients = ids.filter(id => id !== null)
    const result = new Recipe(definition); result.nativeRecipeId = row.id; result.nativeSelectionStatus = picked.status
    return result
  }
  const candidates = (itemType, table, inventory) => recipes.filter(row => row.resultId === itemType)
    .map(row => convert(row, inventory)).filter(row => !row.requiresTable || table)
  bot.recipesAll = (itemType, _metadata = null, table = null) => candidates(itemType, table, bot.inventory.items())
  bot.recipesFor = (itemType, _metadata = null, minResultCount = 1, table = null) => {
    const items = bot.inventory.items(); const counts = new Map()
    for (const item of items) counts.set(item.type, (counts.get(item.type) || 0) + item.count)
    return candidates(itemType, table, items).filter(recipe => {
      const repeats = Math.ceil(minResultCount / recipe.result.count)
      return recipe.nativeSelectionStatus !== 'unknown_budget' && recipe.delta.every(d => d.count >= 0 || (counts.get(d.id) || 0) >= -d.count * repeats)
    })
  }
  return { count: recipes.length, specialAndMachineRecipes: 'unsupported_by_grid_crafter' }
}

module.exports = { chooseIngredients, attachRecipes }

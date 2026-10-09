'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { craftNativeGrid } = require('./native-crafting-client.cjs')
const { craftNativeRecipe } = require('./recipe-crafting-client.cjs')

function item (id, count, components = {}) {
  return { id, count, components: structuredClone(components), mayPickup: true,
    snbt: `{id:${JSON.stringify(id)},count:${count},components:${JSON.stringify(components)}}` }
}

// A server-like menu fixture: the declared recipe computes a native result;
// PICKUP consumes one of each input only when its real result is taken. It
// neither imports nor uses the helper's material planning or slot operations.
function nativeMenu ({ type = 'minecraft:inventory', inventory = {}, inputs = { 1: 'minecraft:oak_log' },
  output = item('minecraft:oak_planks', 4), rejectAt, throwAfter, afterClick } = {}) {
  const state = { schemaVersion: 1, menuType: type, windowId: type === 'minecraft:inventory' ? 0 : 7,
    playerUuid: 'same-connection-player', slots: Array(46).fill(null), mayPickup: Array(46).fill(true), carried: null }
  for (const [slot, value] of Object.entries(inventory)) state.slots[slot] = structuredClone(value)
  const clicks = []
  const gridSize = type === 'minecraft:inventory' ? 4 : 9
  const same = (a, b) => a.id === b.id && JSON.stringify(a.components) === JSON.stringify(b.components)
  function updateResult () {
    const matching = Object.entries(inputs).every(([slot, id]) => state.slots[slot]?.id === id && state.slots[slot].count > 0) &&
      Array.from({ length: gridSize }, (_, i) => i + 1).every(slot => inputs[slot] || !state.slots[slot])
    state.slots[0] = matching ? structuredClone(output) : null
  }
  const menu = {
    current: () => structuredClone(state),
    async click (slot, button = 0) {
      clicks.push({ slot, button })
      const requestId = `receipt-${clicks.length}`
      if (clicks.length === rejectAt) return { requestId, ok: false, changed: false, code: 'cursor_changed' }
      let changed = false
      const at = state.slots[slot]
      if (slot === 0) {
        if (!state.carried && at) {
          state.carried = structuredClone(at)
          for (const inputSlot of Object.keys(inputs)) {
            const ingredient = state.slots[inputSlot]
            state.slots[inputSlot] = ingredient.count > 1 ? item(ingredient.id, ingredient.count - 1, ingredient.components) : null
          }
          changed = true
        }
      } else if (!state.carried && at) {
        state.carried = at
        state.slots[slot] = null
        changed = true
      } else if (state.carried && (!at || same(at, state.carried))) {
        const amount = button === 1 ? 1 : state.carried.count
        state.slots[slot] = item(state.carried.id, (at?.count || 0) + amount, state.carried.components)
        state.carried = state.carried.count > amount ? item(state.carried.id, state.carried.count - amount, state.carried.components) : null
        changed = true
      }
      updateResult()
      afterClick?.(state, clicks.length)
      if (clicks.length === throwAfter) throw Error(`MENU_RECEIPT_TIMEOUT ${requestId}: inspect state before retrying`)
      return { requestId, ok: true, changed, code: changed ? 'clicked' : 'no_change', state: structuredClone(state) }
    },
    state,
    clicks
  }
  return menu
}

const planks = { ingredients: [{ slot: 1, id: 'minecraft:oak_log' }], outputId: 'minecraft:oak_planks', outputCount: 4 }

function recipeQuery(menu, ingredients, grid, output) {
  return {recipes:async()=>({ok:true,playerUuid:menu.state.playerUuid,recipes:[{
    recipeId:'test:actual_recipe',type:'minecraft:crafting',serializer:'minecraft:crafting_shaped',definitionAvailable:true,
    output,grid:{...grid,ordering:'row_major'},ingredients:ingredients.map((id,index)=>({index,empty:false,requiredCount:1,alternatives:[{id,count:1}]}))
  }]})}
}
test('native recipe mapping preserves vertical patterns in both original menu widths',async()=>{
  for(const[type,lower,source]of[['minecraft:inventory',3,36],['minecraft:crafting',4,37]]){
    const output=item('create:shaft',8),menu=nativeMenu({type,inputs:{1:'create:andesite_alloy',[lower]:'create:andesite_alloy'},output,inventory:{[source]:item('create:andesite_alloy',2)}})
    const query=recipeQuery(menu,['create:andesite_alloy','create:andesite_alloy'],{width:1,height:2},output)
    const result=await craftNativeRecipe(menu,query,menu.state.playerUuid,{recipeId:'test:actual_recipe'})
    assert.equal(result.ok,true);assert.deepEqual(result.ingredients.map(i=>i.slot),[1,lower]);assert.equal(menu.state.slots[source],null)
    assert.equal(result.snbt,output.snbt);assert.equal(menu.state.carried,null)
  }
})
test('explicit input recovery preserves complete components before the selected recipe is crafted',async()=>{
  const output=item('minecraft:oak_planks',4),menu=nativeMenu({inventory:{36:item('minecraft:oak_log',1)}})
  const old=item('test:unused',2,{'test:owner':'retained'});menu.state.slots[3]=old
  const query=recipeQuery(menu,['minecraft:oak_log'],{width:1,height:1},output)
  assert.equal((await craftNativeRecipe(menu,query,menu.state.playerUuid,{recipeId:'test:actual_recipe'})).code,'crafting_grid_not_empty')
  assert.equal(menu.clicks.length,0)
  const result=await craftNativeRecipe(menu,query,menu.state.playerUuid,{recipeId:'test:actual_recipe',clearInputs:true})
  assert.equal(result.ok,true);assert.deepEqual(menu.state.slots[9],old);assert.equal(menu.state.carried,null)
})
test('a recipe with mismatched full output components cannot take or consume its result',async()=>{
  const output=item('minecraft:oak_planks',4,{'test:actual':1}),menu=nativeMenu({inventory:{36:item('minecraft:oak_log',1)},output})
  const query=recipeQuery(menu,['minecraft:oak_log'],{width:1,height:1},item('minecraft:oak_planks',4))
  const result=await craftNativeRecipe(menu,query,menu.state.playerUuid,{recipeId:'test:actual_recipe'})
  assert.equal(result.code,'crafting_recipe_output_components_mismatch');assert.equal(menu.clicks.some(c=>c.slot===0),false)
  assert.equal(menu.state.slots[1].id,'minecraft:oak_log')
})

test('compact native chest recipe consumes eight actual planks and preserves the empty centre', async () => {
  const inputs = Object.fromEntries([1, 2, 3, 4, 6, 7, 8, 9].map(slot => [slot, 'minecraft:oak_planks']))
  const output = item('minecraft:chest', 1)
  const menu = nativeMenu({ type: 'minecraft:crafting', inputs, output, inventory: { 37: item('minecraft:oak_planks', 8) } })
  const row = { recipeId: 'minecraft:chest', type: 'minecraft:crafting', serializer: 'minecraft:crafting_shaped', definitionAvailable: true,
    ingredientEncoding: 'prior_index_references_v1', output, grid: { width: 3, height: 3 },
    ingredients: Array.from({ length: 9 }, (_, index) => index === 4 ? { index, empty: true, requiredCount: 0, alternatives: [] } :
      index === 0 ? { index, empty: false, requiredCount: 1, alternatives: [{ id: 'minecraft:birch_planks' }, { id: 'minecraft:oak_planks' }] } :
        { index, empty: false, requiredCount: 1, alternativesFrom: 0 }) }
  const query = { recipes: async () => ({ ok: true, playerUuid: menu.state.playerUuid, recipes: [row] }) }
  const before = JSON.stringify(row)
  const result = await craftNativeRecipe(menu, query, menu.state.playerUuid, { recipeId: 'minecraft:chest' })
  assert.equal(result.ok, true); assert.equal(result.snbt, output.snbt)
  assert.deepEqual(result.ingredients.map(value => value.slot), [1, 2, 3, 4, 6, 7, 8, 9])
  assert.equal(menu.state.slots.filter(value => value?.id === 'minecraft:oak_planks').length, 0)
  assert.equal(menu.state.carried, null); assert.equal(JSON.stringify(row), before)
})

test('unavailable native recipe preserves the actual server reason without consuming or moving ingredients', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_planks', 8) } })
  const query = { recipes: async () => ({ ok: true, playerUuid: menu.state.playerUuid,
    recipes: [{ recipeId: 'minecraft:chest', type: 'minecraft:crafting', serializer: 'minecraft:crafting_shaped',
      definitionAvailable: false, code: 'recipe_definition_too_large' }] }) }
  const result = await craftNativeRecipe(menu, query, menu.state.playerUuid, { recipeId: 'minecraft:chest', clearInputs: true })
  assert.equal(result.code, 'native_crafting_recipe_unavailable'); assert.equal(result.definitionCode, 'recipe_definition_too_large')
  assert.equal(menu.clicks.length, 0); assert.equal(menu.state.slots[36].count, 8)
})

for (const [label, mutate] of [
  ['forward reference', row => { row.ingredients[0] = { index: 0, empty: false, requiredCount: 1, alternativesFrom: 1 } }],
  ['self reference', row => { row.ingredients[1] = { index: 1, empty: false, requiredCount: 1, alternativesFrom: 1 } }],
  ['negative reference', row => { row.ingredients[1] = { index: 1, empty: false, requiredCount: 1, alternativesFrom: -1 } }],
  ['mixed inline and reference', row => { row.ingredients[1].alternativesFrom = 0 }],
  ['unknown encoding', row => { row.ingredientEncoding = 'unknown_v9' }],
  ['unmarked reference', row => { delete row.ingredientEncoding; delete row.ingredients[1].alternatives; row.ingredients[1].alternativesFrom = 0 }],
  ['duplicate index', row => { row.ingredients[1].index = 0 }]
]) test(`invalid native recipe ${label} is rejected before recovering old grid inputs`, async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) } })
  menu.state.slots[3] = item('test:retained', 1, { owner: 'keep' })
  const query = recipeQuery(menu, ['minecraft:oak_log', 'minecraft:oak_log'], { width: 2, height: 1 }, item('minecraft:oak_planks', 4))
  const response = await query.recipes(); response.recipes[0].ingredientEncoding = 'prior_index_references_v1'; mutate(response.recipes[0])
  const result = await craftNativeRecipe(menu, { recipes: async () => response }, menu.state.playerUuid, { recipeId: 'test:actual_recipe', clearInputs: true })
  assert.equal(result.code, 'native_recipe_ingredients_invalid'); assert.equal(menu.clicks.length, 0)
  assert.equal(menu.state.slots[3].id, 'test:retained'); assert.equal(menu.state.carried, null)
})

test('actual slot permission array overrides an item-shaped mayPickup hint', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 4) } })
  menu.state.mayPickup[36] = false
  assert.equal((await craftNativeGrid(menu, planks)).code, 'insufficient_ingredients')
  assert.equal(menu.clicks.length, 0)
  delete menu.state.mayPickup
  assert.equal((await craftNativeGrid(menu, planks)).code, 'native_menu_permissions_unavailable')
  assert.equal(menu.clicks.length, 0)
})

test('blocked server result slot is never picked even when its ItemStack looks normal', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) } })
  menu.state.mayPickup[0] = false
  assert.equal((await craftNativeGrid(menu, planks)).code, 'crafting_result_not_pickable')
  assert(menu.clicks.every(click => click.slot !== 0))
  assert.equal(menu.state.slots[1].count, 1)
})

test('2x2 real result pickup consumes one log and preserves remaining source components', async () => {
  const source = item('minecraft:oak_log', 4, { 'minecraft:custom_data': { provenance: 'naturally-collected' } })
  const menu = nativeMenu({ inventory: { 36: source } })
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.ok, true)
  assert.equal(result.slot, 9)
  assert.equal(result.id, 'minecraft:oak_planks')
  assert.equal(result.count, 4)
  assert.deepEqual(result.receiptIDs, ['receipt-1', 'receipt-2', 'receipt-3', 'receipt-4', 'receipt-5'])
  assert.deepEqual(menu.state.slots[36], item(source.id, 3, source.components))
  assert.deepEqual(result.remainingInputs, [])
  assert.equal(menu.state.carried, null)
})

test('3x3 cutting board recipe uses native slots and keeps the full mod result', async () => {
  const components = { 'example:machine_owner': { uuid: [1, 2, 3, 4], label: '原生组件' },
    'minecraft:custom_name': '{"text":"切菜板"}', 'minecraft:custom_data': { origin: 'server-recipe' } }
  const output = item('farmersdelight:cutting_board', 1, components)
  const inputs = { 1: 'minecraft:stick', 2: 'minecraft:oak_planks', 3: 'minecraft:oak_planks',
    4: 'minecraft:stick', 5: 'minecraft:oak_planks', 6: 'minecraft:oak_planks' }
  const menu = nativeMenu({ type: 'minecraft:crafting', inventory: { 37: item('minecraft:stick', 2), 38: item('minecraft:oak_planks', 4) }, inputs, output })
  const result = await craftNativeGrid(menu, { ingredients: Object.entries(inputs).map(([slot, id]) => ({ slot: Number(slot), id })), outputId: output.id, outputCount: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.slot, 10)
  assert.equal(result.snbt, output.snbt)
  assert.deepEqual(result.item, output)
  assert.deepEqual(menu.state.slots[10], output)
  assert.equal(menu.state.slots[37], null)
  assert.equal(menu.state.slots[38], null)
  assert.deepEqual(result.remainingInputs, [])
  assert.equal(menu.state.carried, null)
})

test('preflight does not count equipped or offhand materials', async () => {
  const menu = nativeMenu({ inventory: { 5: item('minecraft:oak_log', 64), 45: item('minecraft:oak_log', 64) } })
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.code, 'insufficient_ingredients')
  assert.equal(result.available, 0)
  assert.equal(result.needed, 1)
  assert.deepEqual(menu.clicks, [])
})

test('preflight reserves an empty player output slot before changing materials', async () => {
  const inventory = {}
  for (let slot = 9; slot <= 44; slot++) inventory[slot] = item('minecraft:stick', 64)
  inventory[36] = item('minecraft:oak_log', 2)
  const menu = nativeMenu({ inventory })
  assert.equal((await craftNativeGrid(menu, planks)).code, 'no_empty_output_inventory_slot')
  assert.deepEqual(menu.clicks, [])
})

test('server result mismatch stops with inputs intact and never takes the output', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) } })
  const result = await craftNativeGrid(menu, { ...planks, outputId: 'farmersdelight:cutting_board' })
  assert.equal(result.code, 'crafting_result_mismatch')
  assert.equal(result.outcomeUnknown, false)
  assert.equal(menu.state.slots[1].id, 'minecraft:oak_log')
  assert.equal(menu.state.slots[36].count, 1)
  assert.equal(menu.state.carried, null)
  assert(menu.clicks.every(click => click.slot !== 0))
})

test('failed private receipt stops immediately without another click', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) }, rejectAt: 1 })
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.code, 'native_click_rejected')
  assert.equal(result.serverCode, 'cursor_changed')
  assert.equal(result.outcomeUnknown, false)
  assert.equal(result.mutationObserved, false)
  assert.deepEqual(result.receiptIDs, ['receipt-1'])
  assert.equal(menu.clicks.length, 1)
  assert.equal(menu.state.slots[36].count, 2)
})

test('an acknowledged no-change is a stopped operation rather than a retry', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) } })
  menu.click = async () => {
    menu.clicks.push({ slot: 36, button: 0 })
    return { requestId: 'no-change', ok: true, changed: false, code: 'no_change' }
  }
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.code, 'native_click_rejected')
  assert.equal(result.serverCode, 'no_change')
  assert.deepEqual(result.receiptIDs, ['no-change'])
  assert.equal(menu.clicks.length, 1)
})

test('timeout after a real placement remains unknown and performs no recovery or replay', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) }, throwAfter: 2 })
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.code, 'native_click_outcome_unknown')
  assert.equal(result.outcomeUnknown, true)
  assert.equal(result.retryAutomatically, false)
  assert.equal(result.inspectNativeStateBeforeRetry, true)
  assert.equal(menu.clicks.length, 2)
  assert.deepEqual(result.receiptIDs, ['receipt-1'])
  assert.equal(menu.state.slots[1].count, 1)
  assert.equal(menu.state.carried.count, 1)
  assert.equal((await craftNativeGrid(menu, planks)).code, 'crafting_cursor_not_empty')
  assert.equal(menu.clicks.length, 2)
})

test('a different window after an acknowledged click prevents any follow-up', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 2) }, afterClick: (state, count) => { if (count === 1) state.windowId++ } })
  const result = await craftNativeGrid(menu, planks)
  assert.equal(result.code, 'crafting_menu_changed')
  assert.equal(menu.clicks.length, 1)
})

test('server components lost while storing a mod item cannot be reported as success', async () => {
  const output = item('farmersdelight:cutting_board', 1, { 'mod:owner': { key: 'keep-entire-value' } })
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 1) }, output,
    afterClick: (state, count) => { if (count === 4 && state.slots[9]) state.slots[9] = item(output.id, 1) } })
  const result = await craftNativeGrid(menu, { ...planks, outputId: output.id, outputCount: 1 })
  assert.equal(result.code, 'crafting_output_components_changed')
  assert.equal(menu.clicks.length, 4)
})

test('stacked inputs mean one native result pickup and report unconsumed input explicitly', async () => {
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 3) } })
  const result = await craftNativeGrid(menu, { ...planks, ingredients: [{ slot: 1, id: 'minecraft:oak_log', count: 2 }] })
  assert.equal(result.ok, true)
  assert.equal(result.count, 4)
  assert.equal(menu.state.slots[36].count, 1)
  assert.deepEqual(result.remainingInputs, [{ slot: 1, ...item('minecraft:oak_log', 1) }])
})

test('one grid ingredient can be filled from multiple original player stacks', async () => {
  const components = { 'minecraft:custom_data': { gathered: 'same-component' } }
  const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 1, components), 37: item('minecraft:oak_log', 1, components) } })
  const result = await craftNativeGrid(menu, { ...planks, ingredients: [{ slot: 1, id: 'minecraft:oak_log', count: 2 }] })
  assert.equal(result.ok, true)
  assert.equal(menu.state.slots[36], null)
  assert.equal(menu.state.slots[37], null)
  assert.deepEqual(result.remainingInputs, [{ slot: 1, ...item('minecraft:oak_log', 1, components) }])
})

test('nonempty grid, cursor, result and unsupported menus are rejected before mutation', async () => {
  for (const [change, code] of [
    [state => { state.slots[1] = item('minecraft:stick', 1) }, 'crafting_grid_not_empty'],
    [state => { state.carried = item('minecraft:stick', 1) }, 'crafting_cursor_not_empty'],
    [state => { state.slots[0] = item('minecraft:stick', 1) }, 'crafting_result_not_empty'],
    [state => { state.menuType = 'farmersdelight:cooking_pot' }, 'unsupported_crafting_menu']
  ]) {
    const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 1) } })
    change(menu.state)
    assert.equal((await craftNativeGrid(menu, planks)).code, code)
    assert.deepEqual(menu.clicks, [])
  }
})

test('duplicate, outside-grid and invalid quantities never send clicks', async () => {
  for (const ingredients of [
    [{ slot: 1, id: 'minecraft:oak_log' }, { slot: 1, id: 'minecraft:oak_log' }],
    [{ slot: 5, id: 'minecraft:oak_log' }],
    [{ slot: 1, id: 'minecraft:oak_log', count: 0 }],
    [{ slot: 1, id: 'minecraft:oak_log', count: 65 }]
  ]) {
    const menu = nativeMenu({ inventory: { 36: item('minecraft:oak_log', 64) } })
    assert.equal((await craftNativeGrid(menu, { ...planks, ingredients })).code, 'invalid_crafting_ingredient')
    assert.deepEqual(menu.clicks, [])
  }
})

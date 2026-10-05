'use strict'
const { randomUUID } = require('node:crypto')
const { nativeInventorySnapshot, nativeInventoryDelta } = require('./native-inventory-delta.cjs')
const { nativeStackIdentity, nativeComponentDelta } = require('./native-stack-identity.cjs')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const reject = code => ({ ok: false, code, readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
const contextValid = value => value && typeof value.playerUuid === 'string' && UUID.test(value.playerUuid) &&
  Number.isSafeInteger(value.epoch) && value.epoch >= 0 && typeof value.dimension === 'string' && ID.test(value.dimension)
const sameContext = (a, b) => contextValid(a) && contextValid(b) && a.playerUuid.toLowerCase() === b.playerUuid.toLowerCase() && a.epoch === b.epoch && a.dimension === b.dimension
const samePosition = (a, b) => a && b && ['x', 'y', 'z'].every(key => Number.isInteger(a[key]) && a[key] === b[key])
function nativeItems (items, slots) {
  if (!Array.isArray(items) || items.length > slots || !Number.isInteger(slots) || slots < 1 || slots > 64) return null
  const seen = new Set()
  for (const item of items) {
    if (!Number.isInteger(item?.slot) || item.slot < 0 || item.slot >= slots || seen.has(item.slot) || !nativeStackIdentity(item).available) return null
    seen.add(item.slot)
  }
  return structuredClone(items)
}
function nativeMachineSnapshot (receipt, context, expected = {}) {
  const unavailable = reason => ({ available: false, reason, source: 'server_visible_native_machine' })
  if (!contextValid(context) || receipt?.ok !== true || receipt.schemaVersion !== 1 || receipt.kind !== 'world_receipt' ||
      typeof receipt.playerUuid !== 'string' || receipt.playerUuid.toLowerCase() !== context.playerUuid.toLowerCase() ||
      receipt.dimension !== context.dimension || !ID.test(receipt.block?.id || '') ||
      !['x', 'y', 'z'].every(key => Number.isInteger(receipt.position?.[key])) ||
      (expected.position && !samePosition(receipt.position, expected.position)) || (expected.blockId && receipt.block.id !== expected.blockId)) return unavailable('native_machine_identity_unavailable')
  const base = { available: true, source: 'server_visible_native_machine', playerUuid: context.playerUuid.toLowerCase(), epoch: context.epoch,
    dimension: context.dimension, position: { ...receipt.position }, blockId: receipt.block.id }
  const fd = receipt.block.farmersDelight, processing = receipt.block.processing
  if (fd?.source === 'native_visible_block_entity' && fd.kind === 'cutting_board') {
    const input = nativeItems(fd.inventory, 1)
    if (!input || typeof fd.empty !== 'boolean' || fd.empty !== (input.length === 0) ||
        (fd.storedItem !== null && !nativeStackIdentity(fd.storedItem).available) ||
        (fd.storedItem === null) !== fd.empty) return unavailable('native_cutting_board_state_unavailable')
    return { ...base, kind: 'cutting_board', input, output: [], outputAvailable: null,
      processing: { empty: fd.empty, maxStackSize: fd.maxStackSize, isItemCarvingBoard: fd.isItemCarvingBoard },
      storedItem: structuredClone(fd.storedItem), dropsIntoWorld: true }
  }
  if (fd?.source === 'native_visible_block_entity' && fd.kind === 'stove') {
    const input = nativeItems(fd.inventory, fd.slotCount)
    const times = value => Array.isArray(value) && value.length === fd.slotCount && value.every(item => Number.isInteger(item) && item >= 0)
    if (!input || fd.slotCount !== 6 || fd.slotLimit !== 1 || !times(fd.cookingTimes) || !times(fd.cookingTotalTimes) ||
        input.some(item => item.count !== 1) || (fd.lit !== undefined && typeof fd.lit !== 'boolean')) return unavailable('native_stove_state_unavailable')
    return { ...base, kind: 'stove', input, output: [], outputAvailable: null, dropsIntoWorld: true,
      processing: { lit: fd.lit ?? null, cookingTimes: [...fd.cookingTimes], cookingTotalTimes: [...fd.cookingTotalTimes],
        nextEmptySlot: fd.nextEmptySlot, full: fd.full } }
  }
  if (processing?.type === 'create:milling') {
    const input = nativeItems(processing.input, processing.inputSlotCount), output = nativeItems(processing.output, processing.outputSlotCount)
    if (!input || !output || !Number.isInteger(processing.timer) || typeof processing.status !== 'string' ||
        typeof processing.outputAvailable !== 'boolean' || processing.outputAvailable !== (output.length > 0)) return unavailable('native_millstone_state_unavailable')
    const state = { ...processing }; delete state.input; delete state.output
    return { ...base, kind: 'millstone', input, output, outputAvailable: processing.outputAvailable,
      processing: state, kinetic: structuredClone(receipt.block.kinetic ?? null), dropsIntoWorld: false }
  }
  return unavailable('native_machine_kind_not_supported')
}

function nativeMachineRecipeEvidence (receipt, recipeId, context, machine) {
  if (!contextValid(context) || typeof recipeId !== 'string' || !ID.test(recipeId) || receipt?.ok !== true ||
      receipt.query !== 'recipes' || receipt.source !== 'server_recipe_manager' || typeof receipt.playerUuid !== 'string' || receipt.playerUuid.toLowerCase() !== context.playerUuid.toLowerCase() ||
      !Array.isArray(receipt.recipes) || receipt.recipes.length !== 1 || receipt.recipes[0].recipeId !== recipeId) return reject('native_machine_recipe_unavailable')
  const recipe = receipt.recipes[0]
  const requiredType = { cutting_board: 'farmersdelight:cutting', stove: 'minecraft:campfire_cooking', millstone: 'create:milling' }[machine.kind]
  if (recipe.definitionAvailable !== true || recipe.type !== requiredType) return { ...reject('native_machine_recipe_definition_unavailable'),
    recipeId, serverCode: recipe.code ?? 'recipe_type_not_supported_for_machine' }
  const rolls = recipe.processing?.rollableResults
  const candidates = Array.isArray(rolls) ? rolls.filter(roll => roll.baseChancePerItem > 0).map(roll => ({ ...roll.item, baseChancePerItem: roll.baseChancePerItem })) :
    recipe.output ? [recipe.output] : []
  if (!candidates.length || candidates.length > 24 || candidates.some(item => !nativeStackIdentity(item).available)) return reject('native_machine_recipe_outputs_unavailable')
  return { ok: true, source: 'server_recipe_manager', playerUuid: context.playerUuid.toLowerCase(), recipeId, type: recipe.type,
    definitionAvailable: true, expectedOutputs: structuredClone(candidates),
    heldToolMatches: typeof recipe.processing?.heldToolMatches === 'boolean' ? recipe.processing.heldToolMatches : null,
    inputAlternatives: structuredClone(recipe.ingredients ?? []),
    toolIngredient: recipe.processing?.toolIngredient ?? null, dropsIntoWorld: recipe.processing?.dropsIntoWorld ?? machine.dropsIntoWorld,
    fortuneMayModifyChance: recipe.processing?.fortuneMayModifyChance ?? false,
    executionAvailable: recipe.processing?.executionAvailable ?? false, machineExecutionVerified: recipe.processing?.machineExecutionVerified ?? false,
    fluidHandlingAvailable: recipe.processing?.fluidHandlingAvailable ?? false }
}

function nativeMachineOutcome (baseline, after, afterMenu, { previousMachine = baseline.machine, history = {} } = {}) {
  const machine = nativeMachineSnapshot(after, baseline.context, { position: baseline.machine.position, blockId: baseline.machine.blockId })
  const inventoryAfter = nativeInventorySnapshot(afterMenu, baseline.context.playerUuid)
  const inventoryDelta = nativeInventoryDelta(baseline.inventory, inventoryAfter)
  if (!machine.available) return { ...reject(machine.reason), observationAvailable: false, machine, inventoryDelta }
  const input = nativeComponentDelta(previousMachine.input, machine.input), output = nativeComponentDelta(previousMachine.output, machine.output)
  const components = nativeComponentDelta(baseline.inventory.items, inventoryAfter.items)
  if (!input.available || !output.available) return { ...reject('native_machine_components_unavailable'), observationAvailable: false, machine, inventoryDelta }
  const expectedOutputs = baseline.expectedOutputs
  const keys = expectedOutputs?.map(item => nativeStackIdentity(item).key)
  const expected = key => keys?.includes(key)
  // Both ID totals and full component identity must increase. A damaged tool
  // replacing itself is not a new product, even though its component key changes.
  const productGains = keys && components.available && inventoryDelta.available ? components.added.filter(item => expected(item.key) &&
    inventoryDelta.added.some(gain => gain.id === item.id && gain.count > 0)).map(({ key, ...item }) => ({ ...item,
      count: Math.min(item.count, inventoryDelta.added.find(gain => gain.id === item.id).count) })) : null
  const currentProducts = keys ? machine.output.filter(item => expected(nativeStackIdentity(item).key)) : null
  const signals = { inputPlacedObserved: history.inputPlacedObserved === true || input.added.length > 0,
    inputRemovedObserved: history.inputRemovedObserved === true || input.removed.length > 0,
    nativeOutputRemovedObserved: history.nativeOutputRemovedObserved === true || output.removed.some(item => !keys || expected(item.key)),
    newNativeProductObserved: keys ? history.newNativeProductObserved === true || output.added.some(item => expected(item.key)) : null,
    processingChanged: history.processingChanged === true || JSON.stringify(previousMachine.processing) !== JSON.stringify(machine.processing) ||
      JSON.stringify(previousMachine.kinetic) !== JSON.stringify(machine.kinetic) }
  const inventoryAcquiredObserved = productGains === null ? null : productGains.length > 0
  const pickupConfirmed = inventoryAcquiredObserved === null ? null : inventoryAcquiredObserved &&
    (signals.inputRemovedObserved || signals.nativeOutputRemovedObserved)
  const changed = signals.inputPlacedObserved || signals.inputRemovedObserved || signals.nativeOutputRemovedObserved || output.added.length > 0 || signals.processingChanged
  return { ok: true, code: pickupConfirmed ? 'expected_native_product_inventory_gain' : changed ? 'native_machine_state_changed' : 'native_machine_state_observed',
    readOnly: true, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, observationAvailable: true,
    machine, inventoryDelta, effectVerified: changed, pickupConfirmed, productGains,
    postcondition: { ...signals, expectedOutputKnown: !!keys, outputAvailable: machine.outputAvailable,
      expectedNativeOutputPresent: currentProducts === null ? null : currentProducts.length > 0,
      inventoryAcquiredObserved, pickupConfirmed, worldDropObserved: null,
      attribution: 'matching_native_inventory_gain_and_machine_change_not_drop_entity_attributed',
      inputChangeDoesNotProveProduction: true, existingOutputDoesNotProveNewProduction: true }, signals }
}

function createNativeMachineVerifier ({ now = Date.now, newId = randomUUID, ttlMs = 600000, maxEntries = 32 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 600000 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 32) throw Error('NATIVE_VERIFIER_CONFIG_INVALID')
  const proofs = new Map()
  const prune = () => { for (const [id, proof] of proofs) if (now() >= proof.expiresAt) proofs.delete(id) }
  function capture ({ receipt, menu, context, aimOffset = [0.5, 0.5, 0.5], recipeEvidence = null }) {
    prune()
    // The canonical inventory omits the cursor. An owned product on it must
    // not become a false gain when moved back into inventory after capture.
    if (menu?.carried !== null) return reject('native_machine_capture_requires_empty_cursor')
    const machine = nativeMachineSnapshot(receipt, context), inventory = nativeInventorySnapshot(menu, context?.playerUuid)
    if (!machine.available || !inventory.available) return reject(machine.reason || inventory.reason)
    if (!Array.isArray(aimOffset) || aimOffset.length !== 3 || aimOffset.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return reject('native_machine_aim_invalid')
    // Existing native output is a real collection target. An unknown recipe
    // with an empty buffer is not an invitation to guess its products.
    if (recipeEvidence?.ok === true && (recipeEvidence.source !== 'server_recipe_manager' || recipeEvidence.playerUuid !== context.playerUuid.toLowerCase() ||
        recipeEvidence.definitionAvailable !== true || !Array.isArray(recipeEvidence.expectedOutputs) || recipeEvidence.expectedOutputs.length < 1 ||
        recipeEvidence.expectedOutputs.length > 24 || recipeEvidence.expectedOutputs.some(item => !nativeStackIdentity(item).available))) return reject('native_machine_recipe_evidence_invalid')
    const expectedOutputs = recipeEvidence?.ok === true ? structuredClone(recipeEvidence.expectedOutputs) :
      machine.output.length ? structuredClone(machine.output) : null
    const baseline = { context: { ...context }, machine, inventory, aimOffset: [...aimOffset], expectedOutputs,
      expectationSource: recipeEvidence?.ok === true ? 'server_recipe_manager' : expectedOutputs ? 'native_machine_existing_output' : null,
      recipeEvidence: recipeEvidence?.ok === true ? structuredClone(recipeEvidence) : null }
    if (Buffer.byteLength(JSON.stringify(baseline), 'utf8') > 131072) return reject('native_machine_baseline_budget_exceeded')
    const verificationId = newId(), capturedAt = now(), expiresAt = capturedAt + ttlMs
    if (typeof verificationId !== 'string' || !UUID.test(verificationId)) throw Error('NATIVE_VERIFICATION_ID_INVALID')
    while (proofs.size >= maxEntries) proofs.delete(proofs.keys().next().value)
    proofs.set(verificationId, { baseline, lastMachine: machine, history: {}, capturedAt, expiresAt })
    return { ok: true, verificationId, capturedAt, expiresAt, expectationSource: baseline.expectationSource, expectedOutputs,
      binding: { ...context, position: { ...machine.position }, blockId: machine.blockId }, readOnly: true }
  }
  async function verify ({ verificationId, getContext, getMenu, readBlock, check = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    waitMs = 1500, goal = 'observe' }) {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 8000 || !['observe', 'change', 'output', 'pickup'].includes(goal)) throw Error('NATIVE_MACHINE_VERIFY_ARGUMENT_INVALID')
    prune(); const proof = proofs.get(verificationId)
    if (!proof) return reject('native_machine_verification_expired_or_unavailable')
    // Zero requests one read, not a 1ms deadline which would invariably race
    // the ordinary one-physics-tick look client.
    const { baseline } = proof, started = now(), deadline = started + (waitMs === 0 ? 1000 : waitMs); let last = null, reads = 0
    check()
    if (!sameContext(baseline.context, getContext())) return reject('native_machine_verification_context_changed')
    // WorldBridge shares a two-tick limit with recipe/entity/look queries.
    // Other callers are not tracked here: spacing every new verification
    // protects the first read even immediately after an external query.
    await wait(Math.min(150, Math.max(0, deadline - now()))); check()
    if (now() >= deadline) return { ...reject('native_machine_read_not_observed'), verificationId, reads: 0, observationAvailable: false }
    do {
      check()
      if (now() >= proof.expiresAt) return reject('native_machine_verification_expired_or_unavailable')
      if (!sameContext(baseline.context, getContext())) return reject('native_machine_verification_context_changed')
      let timer, receipt
      try {
        // A stalled waitForTicks inside the existing look client must not make
        // this read-only tool wait forever. Its late read is discarded.
        receipt = await Promise.race([Promise.resolve().then(() => { check(); return readBlock(baseline.machine.position, baseline.aimOffset) }),
          new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, code: 'native_machine_read_not_observed' }), Math.max(1, deadline - now())) })])
      } catch (error) {
        check()
        if (/^WORLD_QUERY_TIMEOUT\b/.test(error.message)) receipt = { ok: false, code: 'native_machine_read_not_observed' }
        else if (/^(WORLD_CONNECTION_CLOSED|OWN_MENU_UNAVAILABLE|ACTION_BLOCK_NOT_LOADED|ACTION_OUTSIDE_LOADED_LOCAL_RANGE)\b/.test(error.message)) receipt = { ok: false, code: 'native_machine_read_unavailable' }
        else throw error
      } finally { clearTimeout(timer) }
      check(); reads++
      if (!sameContext(baseline.context, getContext())) return reject('native_machine_verification_context_changed')
      if (receipt?.ok !== true) return { ...reject(receipt?.code ?? 'native_machine_read_unavailable'), verificationId, reads, observationAvailable: false }
      last = nativeMachineOutcome(baseline, receipt, getMenu(), { previousMachine: proof.lastMachine, history: proof.history })
      if (!last.observationAvailable) return { ...last, verificationId, reads }
      proof.lastMachine = last.machine; proof.history = last.signals
      const satisfied = goal === 'observe' || goal === 'change' && last.effectVerified || goal === 'output' && last.postcondition.expectedNativeOutputPresent === true ||
        goal === 'pickup' && last.pickupConfirmed === true
      if (satisfied) return { ...last, verificationId, reads, goalSatisfied: true, capturedAt: proof.capturedAt, expiresAt: proof.expiresAt }
      if (waitMs === 0 || reads >= 4 || now() >= deadline) break
      await wait(Math.min(250, deadline - now())); check()
    } while (now() <= deadline)
    return { ...last, ok: false, code: goal === 'pickup' && !baseline.expectedOutputs ? 'native_machine_output_expectation_unknown' :
      `native_machine_${goal}_not_observed`, verificationId, reads, goalSatisfied: false, capturedAt: proof.capturedAt, expiresAt: proof.expiresAt }
  }
  return { capture, verify }
}
module.exports = { nativeMachineSnapshot, nativeMachineRecipeEvidence, nativeMachineOutcome, createNativeMachineVerifier }

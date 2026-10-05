'use strict'
const { nativeInventorySnapshot, nativeInventoryDelta } = require('./native-inventory-delta.cjs')
const { nativeMachineSnapshot, nativeMachineRecipeEvidence } = require('./native-machine-verification.cjs')
const reject = code => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
const contextMatches = (a, b) => typeof a?.playerUuid === 'string' && typeof b?.playerUuid === 'string' &&
  a.playerUuid.toLowerCase() === b.playerUuid.toLowerCase() && a.epoch === b.epoch && a.dimension === b.dimension
function blockBound (receipt, context, position, expectedId) {
  return receipt?.ok === true && receipt.kind === 'world_receipt' && receipt.schemaVersion === 1 &&
    typeof receipt.playerUuid === 'string' && receipt.playerUuid.toLowerCase() === context.playerUuid?.toLowerCase() &&
    receipt.dimension === context.dimension && ['x', 'y', 'z'].every(key => receipt.position?.[key] === position[key]) &&
    typeof receipt.block?.id === 'string' && (!expectedId || receipt.block.id === expectedId)
}
// This adapter never navigates, equips, inserts ingredients, or collects by
// itself. It sends at most the one right click explicitly requested by the
// model, then uses the bounded verifier to report native postconditions.
async function performNativeBlockAction ({ action, getContext, getMenu, readBlock, readRecipe, sendUse,
  verifier, check = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const context = getContext(), offset = action.aimOffset ?? [0.5, 0.5, 0.5]
  const guardedRead = async position => { check(); const receipt = await readBlock(position, offset); check(); return receipt }
  let actual
  try { actual = await guardedRead(action.position) } catch (error) {
    check()
    if (/^WORLD_QUERY_TIMEOUT\b/.test(error.message)) return { ...reject('native_block_read_not_observed'), readOnly: true }
    throw error
  }
  if (!contextMatches(context, getContext())) return { ...reject('native_machine_context_changed'), readOnly: true }
  if (!blockBound(actual, context, action.position, action.expectedId)) return { ...reject(actual?.code || 'native_block_identity_unavailable'), readOnly: true }
  const machine = nativeMachineSnapshot(actual, context)
  let recipeEvidence = null
  if (action.recipeId) {
    if (!machine.available) return reject('native_machine_kind_not_supported')
    await wait(150); check()
    const recipe = await readRecipe(action.recipeId); check()
    recipeEvidence = nativeMachineRecipeEvidence(recipe, action.recipeId, context, machine)
    if (!recipeEvidence.ok) return { ...recipeEvidence, readOnly: true }
    // A read may span respawn or a world switch. No old evidence may dispatch.
    const current = getContext()
    if (!contextMatches(current, context)) return reject('native_machine_context_changed')
  }
  const beforeMenu = getMenu(), beforeInventory = nativeInventorySnapshot(beforeMenu, context.playerUuid)
  const baseline = machine.available ? verifier.capture({ receipt: actual, menu: beforeMenu, context, aimOffset: offset, recipeEvidence }) : null
  if (action.type === 'block_inspect') return { ...actual, readOnly: true, machine, ...(baseline || {}), recipeEvidence }
  if (action.intent === 'process') {
    if (machine.kind !== 'cutting_board' || !recipeEvidence?.ok) return reject('native_process_requires_cutting_recipe_evidence')
    if (recipeEvidence.heldToolMatches !== true) return { ...reject('native_cutting_tool_not_confirmed'), recipeEvidence }
    const requirements = recipeEvidence.inputAlternatives.filter(ingredient => ingredient.empty !== true)
    const inputMatches = requirements.length === 1 && machine.input.some(item =>
      requirements[0].alternatives?.some(alternative => alternative.id === item.id) && item.count >= (requirements[0].requiredCount ?? 1))
    if (!inputMatches) return { ...reject('native_cutting_input_does_not_match_recipe'), recipeEvidence }
  }
  if (machine.available && !baseline.ok) return baseline
  if (beforeMenu?.windowId !== 0 || beforeMenu.carried !== null) return reject('native_block_use_requires_closed_menu_empty_cursor')
  check()
  if (!contextMatches(context, getContext())) return reject('native_machine_context_changed')
  let sent
  try { sent = sendUse(actual) } catch (error) {
    check()
    return { ...reject('native_block_interaction_outcome_unknown'), readOnly: false, interactionSent: null, operationCompleted: false,
      outcomeKnown: false, outcomeUnknown: true, phase: 'interaction_dispatch' }
  }
  if (sent?.ok === false) return sent
  let result, afterMenu
  try {
  await wait(250); check()
  if (baseline?.ok) {
    result = await verifier.verify({ verificationId: baseline.verificationId, getContext, getMenu,
      readBlock: (position, aimOffset) => readBlock(position, aimOffset), check, wait, waitMs: 1500, goal: 'change' })
    check()
    if (result.observationAvailable !== true) return { ...result, ok: false, readOnly: false, interactionSent: true, operationCompleted: false,
      code: 'native_block_interaction_outcome_unknown', outcomeKnown: false, outcomeUnknown: true }
  } else {
    let after
    try { after = await guardedRead(action.position) } catch (error) {
      check()
      if (/^WORLD_QUERY_TIMEOUT\b/.test(error.message)) return { ...reject('native_block_interaction_outcome_unknown'), interactionSent: true, outcomeKnown: false, outcomeUnknown: true }
      throw error
    }
    const afterMenu = getMenu(), menuOpened = afterMenu.windowId > 0 && afterMenu.windowId !== beforeMenu.windowId
    if (!blockBound(after, context, action.position, actual.block.id)) return { ...reject('native_block_interaction_outcome_unknown'), interactionSent: true, outcomeKnown: false, outcomeUnknown: true }
    const nativeBlockStateChanged = JSON.stringify(actual.block) !== JSON.stringify(after.block)
    result = { ...reject('native_block_interaction_not_observed'), observed: after, menuOpened, nativeBlockStateChanged,
      effectVerified: menuOpened || nativeBlockStateChanged,
      inventoryDelta: nativeInventoryDelta(beforeInventory, nativeInventorySnapshot(afterMenu, context.playerUuid)) }
  }
  afterMenu = getMenu()
  } catch (error) {
    // A disappeared menu or malformed post-write observation is not a
    // rejected click. The packet was sent; its result remains unknown.
    // Context/deadline cancellation still escapes through the action fence.
    check()
    return { ...reject('native_block_interaction_outcome_unknown'), readOnly: false, interactionSent: true, operationCompleted: false,
      outcomeKnown: false, outcomeUnknown: true, phase: 'post_interaction_observation' }
  }
  const menuOpened = afterMenu.windowId > 0 && afterMenu.windowId !== beforeMenu.windowId
  // Timers/RPM may keep changing despite a refused click. They remain useful
  // read-only progress evidence, never proof that this interaction worked.
  const changes = result.postcondition
  const machineInteractionObserved = changes && (action.intent === 'load' ? changes.inputPlacedObserved :
    action.intent === 'collect' ? result.pickupConfirmed === true :
      changes.inputPlacedObserved || result.pickupConfirmed === true || machine.kind === 'cutting_board' && changes.inputRemovedObserved)
  const observed = menuOpened || (machine.available ? machineInteractionObserved === true : result.effectVerified === true)
  return { ...result, ok: observed, code: observed ? 'native_block_interaction_observed' : 'native_block_interaction_not_observed',
    nativeBlock: actual.block, recipeEvidence, verificationId: baseline?.verificationId ?? null,
    expectationSource: baseline?.expectationSource ?? null, expectedOutputs: baseline?.expectedOutputs ?? null,
    interactionSent: true, operationCompleted: result.pickupConfirmed === true, readOnly: false,
    menuOpened, windowId: afterMenu.windowId, menuType: afterMenu.menuType, effectVerified: observed, retryAutomatically: false }
}
module.exports = { performNativeBlockAction, blockBound }

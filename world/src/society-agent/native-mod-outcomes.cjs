'use strict'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function boundModReceipt (receipt, playerUuid) {
  return !!receipt && typeof playerUuid === 'string' && UUID.test(playerUuid) && typeof receipt.playerUuid === 'string' && receipt.playerUuid.toLowerCase() === playerUuid.toLowerCase()
}
function verifyMaidOutcome (action, receipt, playerUuid) {
  if (!boundModReceipt(receipt, playerUuid)) return { ok: false, code: 'mod_receipt_player_mismatch', effectVerified: false,
    outcome: 'unknown', outcomeUnknown: true, outcomeKnown: false, retryAutomatically: false }
  if (!['follow', 'pickup', 'task'].includes(action.operation) || receipt.ok !== true || receipt.outcome === 'unknown') return receipt
  const key = action.operation === 'task' ? 'taskId' : action.operation
  const wanted = action.operation === 'task' ? action.args?.taskId : action.args?.[key]
  const maid = receipt.maid
  if (!maid || maid.uuid?.toLowerCase() !== action.maidUuid?.toLowerCase() || maid.ownerUuid?.toLowerCase() !== playerUuid.toLowerCase() || maid.owned !== true || !Object.hasOwn(maid, key)) {
    return { ...receipt, ok: false, code: 'maid_postcondition_unavailable', effectVerified: false,
      outcome: 'unknown', outcomeUnknown: true, outcomeKnown: false, retryAutomatically: false }
  }
  const matches = maid[key] === wanted
  return { ...receipt, ok: matches, code: matches ? receipt.code : 'maid_postcondition_not_met', effectVerified: matches,
    postcondition: { source: 'server_native_maid_state', key, expected: wanted, actual: maid[key], matches },
    outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
}
function verifyEntityInteraction (beforeMenu, afterMenu, beforeEntity, afterEntity, uuid) {
  const own = menu => menu?.playerUuid?.toLowerCase() === uuid?.toLowerCase()
  const menuOpened = own(beforeMenu) && own(afterMenu) && afterMenu.windowId > 0 &&
    (afterMenu.windowId !== beforeMenu.windowId || afterMenu.menuType !== beforeMenu.menuType)
  const same = boundModReceipt(beforeEntity, uuid) && boundModReceipt(afterEntity, uuid) && beforeEntity.ok === true && afterEntity.ok === true &&
    beforeEntity.entity?.uuid === afterEntity.entity?.uuid && beforeEntity.entity?.id === afterEntity.entity?.id
  const changes = same ? ['tamed', 'ownerUuid', 'customName'].filter(key => Object.hasOwn(beforeEntity.entity, key) &&
    Object.hasOwn(afterEntity.entity, key) && beforeEntity.entity[key] !== afterEntity.entity[key]).map(key => ({ key, before: beforeEntity.entity[key], after: afterEntity.entity[key] })) : []
  const verified = menuOpened || changes.length > 0
  return { ok: true, code: verified ? 'native_entity_interaction_observed' : 'native_entity_interaction_sent_unverified',
    effectVerified: verified, menuOpened, observedChanges: changes,
    windowId: own(afterMenu) ? afterMenu.windowId : null, menuType: own(afterMenu) ? afterMenu.menuType : null,
    observationSource: 'same_player_native_menu_and_entity_receipt', retryAutomatically: false }
}
module.exports = { boundModReceipt, verifyMaidOutcome, verifyEntityInteraction }

'use strict'
const { actionIsReadOnly } = require('./action-policy.cjs')
const { unknownOutcome } = require('./plan.cjs')
function reconcileInterruptedActions (events) {
  const pending = new Map(), mutations = new Set()
  for (const event of events) {
    if (event.kind === 'action_intent') pending.set(event.actionId, event)
    if (event.kind === 'action_mutation_dispatch') mutations.add(event.actionId)
    if (event.kind === 'action_result') {
      if (unknownOutcome(event.result)) {
        const intent = pending.get(event.actionId) || { actionId: event.actionId, action: event.action, at: event.at }
        pending.set(event.actionId, { ...intent, interruptedResult: event.result })
      } else pending.delete(event.actionId)
    }
    if (event.kind === 'action_read_retired') pending.delete(event.actionId)
    // Explicit operator retirement authorizes a new loop; it does not change
    // the original unknown result or authorize replay of the old mutation.
    if (event.kind === 'action_operator_reconciled' && event.disposition === 'retired_without_replay' &&
        event.retryAutomatically === false && typeof event.operator === 'string' && event.operator.trim() &&
        typeof event.reason === 'string' && event.reason.trim()) pending.delete(event.actionId)
  }
  const retire = [], unresolved = []
  for (const intent of pending.values()) {
    // Old builds lack dispatch evidence. Only legacy wait/tools have a
    // trivially no-write installed contract. Other legacy actions stay pending.
    const knownLegacy = ['wait', 'tools'].includes(intent.action?.type)
    const versionedRead = intent.readOnlyContractVersion === 1 && intent.readOnly === true && actionIsReadOnly(intent.action)
    if (!mutations.has(intent.actionId) && (knownLegacy || versionedRead)) retire.push({ actionId: intent.actionId,
      action: intent.action, intentAt: intent.at, code: 'interrupted_read_discarded', outcome: 'known_aborted', readOnly: true,
      retryAutomatically: false, reason: knownLegacy ? 'installed_legacy_no_write_contract' : 'versioned_read_contract_no_mutation_dispatch' })
    else unresolved.push(intent)
  }
  return { retire, pending: unresolved }
}
module.exports = { reconcileInterruptedActions }

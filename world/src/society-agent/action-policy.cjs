'use strict'
// Classification is the installed action contract, never a model-provided
// readOnly flag. Mutating methods remain conservative even before an ACK.
function actionIsReadOnly (action) {
  if (['tools', 'inspect', 'recipes', 'block_inspect', 'block_verify', 'entity_inspect', 'collision', 'wait'].includes(action?.type)) return true
  if (action?.type === 'domum') return ['state', 'choices'].includes(action.operation)
  if (action?.type === 'maid') return ['list', 'status', 'tasks'].includes(action.operation)
  if (action?.type === 'colony') return ['status', 'capabilities', 'resources'].includes(action.operation)
  if (action?.type === 'spell') return ['list', 'explain'].includes(action.operation)
  return false
}
function actionErrorIsUnknown (error) {
  if (error?.result?.outcomeUnknown === true || error?.outcomeUnknown === true || error?.result?.outcomeKnown === false || error?.outcomeKnown === false) return true
  if (error?.result?.outcomeKnown === true || error?.outcomeKnown === true) return false
  return /TIMEOUT|CONNECTION_CLOSED|UNKNOWN|uncertain/i.test(error?.message || '')
}
module.exports = { actionIsReadOnly, actionErrorIsUnknown }

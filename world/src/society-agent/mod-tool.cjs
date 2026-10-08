'use strict'
const { modOperationCatalog, validateModArguments } = require('../neoforge-handshake/mod-call-client.cjs')

// The body executor and external SDK use the same finite bindings and schemas.
// Model supplied readOnly/actor fields cannot change routing or permission.
function validateModToolAction (action) {
  if (!action || !['list', 'explain', 'call'].includes(action.operation) ||
      Object.keys(action).some(key => !['type', 'operation', 'id', 'args'].includes(key))) throw Error('PLAN_MOD_INVALID')
  if (action.operation === 'list') {
    if (action.id !== undefined || action.args !== undefined) throw Error('PLAN_MOD_INVALID')
  } else {
    if (typeof action.id !== 'string' || !modOperationCatalog(action.id).operation) throw Error('PLAN_MOD_OPERATION_INVALID')
    if (action.operation === 'explain') {
      if (action.args !== undefined) throw Error('PLAN_MOD_INVALID')
    } else validateModArguments(action.id, action.args ?? {})
  }
  return action
}
function modToolIsReadOnly (action) {
  if (action?.operation === 'list' || action?.operation === 'explain') return true
  return action?.operation === 'call' && modOperationCatalog(action.id).operation?.readOnly === true
}
async function runModToolAction (action, calls) {
  validateModToolAction(action)
  if (action.operation === 'explain') return modOperationCatalog(action.id)
  if (action.operation === 'list') {
    const catalog = modOperationCatalog()
    return { ...catalog, operations: catalog.operations.map(({ id, readOnly, description }) => ({ id, readOnly, description })) }
  }
  return calls.call(action.id, action.args ?? {})
}
module.exports = { validateModToolAction, modToolIsReadOnly, runModToolAction }

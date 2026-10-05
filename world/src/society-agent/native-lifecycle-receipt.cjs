'use strict'
// Preserve actual native construction/query evidence without inventing a
// completion flag. These fields are already bounded by the native receipt.
const FIELDS = ['action', 'options', 'capabilities', 'workOrder', 'workOrders', 'workOrderCount',
  'workOrdersTruncated', 'requestsTruncated', 'buildingCount', 'citizenCount', 'hutType', 'structurePack',
  'blueprintPath', 'level', 'built', 'constructionPending', 'stockBefore', 'stockAfter', 'neededAtValidation',
  'requestedPosition', 'expectedId', 'blocking', 'slot', 'id', 'reached', 'exactPosition', 'withinRadius',
  'requestedRadius', 'pathfinderGoalSatisfied', 'distanceToRequested', 'verticalDifference', 'mainHandItemId']
function nativeLifecycleReceiptFields (result) {
  return Object.fromEntries(FIELDS.filter(key => result?.[key] !== undefined).map(key => [key, structuredClone(result[key])]))
}
module.exports = { nativeLifecycleReceiptFields }

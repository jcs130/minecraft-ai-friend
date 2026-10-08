'use strict'
// Stop spending decisions on an identical known rejection. This is not an
// action planner, a replay policy, or a way to release an unknown-write fence.
function createTaskAttemptGuard () {
  const failures = new Map()
  const key = (id, args, context) => JSON.stringify([id, args, context])
  return {
    before (id, args, context) {
      const previous = failures.get(key(id, args, context))
      return previous?.count >= 3 ? { ok: false, code: 'repeated_known_failure_choose_new_action', outcomeKnown: true,
        outcomeUnknown: false, retryAutomatically: false, previousCode: previous.code, attempts: previous.count,
        hint: 'The same arguments failed three times in the same body/hand context. Change the approach, arguments or relevant state; do not repeat this command.' } : null
    },
    observe (id, args, context, receipt) {
      const result = receipt?.result ?? receipt
      if (receipt?.ok !== false || receipt.outcomeUnknown === true || result?.outcomeUnknown === true || result?.outcomeKnown === false) return
      const code = result?.code ?? receipt.code
      if (!code || code === 'repeated_known_failure_choose_new_action') return
      const fingerprint = key(id, args, context), previous = failures.get(fingerprint)
      failures.set(fingerprint, { id, code, count: (previous?.count ?? 0) + 1 })
      if (failures.size > 32) failures.delete(failures.keys().next().value)
    },
    recent () { return [...failures.values()].slice(-4).map(row => ({ ...row })) }
  }
}
module.exports = { createTaskAttemptGuard }

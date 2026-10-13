const reads = new Set(['mc_read', 'mc_operations', 'mc_help', 'mc_state', 'mc_viewer', 'mc_lua_operations'])
const invalidInput = new Set(['MOD_CALL_ARGUMENT_INVALID', 'MOD_CALL_ARGUMENT_UNSUPPORTED'])
/** A known input error in a read may be corrected. Never mask a mutation or an uncertain transport. */
export function rejectedRead(error, name) {
  if (!invalidInput.has(error?.code) || !reads.has(name)) return null
  return { ok: false, code: error.code, readOnly: true, mutationDispatched: false,
    field: typeof error.field === 'string' ? error.field : null,
    missingFields: Array.isArray(error.missingFields) ? error.missingFields.filter(value => typeof value === 'string').slice(0, 24) : [],
    hint: 'Read mc_help for this operation and correct the arguments; this rejected query did not perform a game mutation.' }
}

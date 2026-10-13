/** Closing evidence is sampled afresh, including when a decision/action failed. */
export async function finalObservations(call) {
  const result = { current: null, society: null, diagnostics: { stateAvailable: false, societyAvailable: false } }
  if (!call) return result
  for (const [key, name, args, flag] of [
    ['current', 'mc_state', {}, 'state'], ['society', 'mc_read', { operation: 'society.state', args: {} }, 'society']
  ]) {
    try {
      const sampled = await call(name, args)
      if (sampled.ok) {
        result[key] = sampled; result.diagnostics[flag + 'Available'] = true
        result.diagnostics[flag + 'CapturedAt'] = sampled.capturedAt
      } else result.diagnostics[flag + 'Error'] = sampled.code || sampled.status || 'observation_unavailable'
    } catch (error) { result.diagnostics[flag + 'Error'] = String(error.code || error.message).slice(0, 160) }
  }
  return result
}

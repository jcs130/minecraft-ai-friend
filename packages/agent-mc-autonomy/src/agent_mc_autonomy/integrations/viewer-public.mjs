import { readFileSync, statSync } from 'node:fs'

/** Only the explicit bounded projection from this runtime session is public. */
export function publicAgentReader(file, session, username, now = Date.now) {
  return () => {
    if (!file || statSync(file).size > 16384) throw Error('PUBLIC_AGENT_STATE_UNAVAILABLE')
    const value = JSON.parse(readFileSync(file, 'utf8'))
    const age = now() - Date.parse(value.updated_at)
    if (value.schema_version !== 1 || value.session !== session || value.username !== username ||
        !Number.isFinite(age) || age < -5000 || age > 30000) throw Error('PUBLIC_AGENT_STATE_STALE_OR_FOREIGN')
    return value
  }
}

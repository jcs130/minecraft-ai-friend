import { readFileSync, statSync } from 'node:fs'

/** Optional independent console credential. Legacy deployments without it retain their headers. */
export function qwenpawHeaders(agentId: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Agent-Id': agentId }
  const path = env.QWENPAW_CONSOLE_TOKEN_FILE
  let token = env.QWENPAW_CONSOLE_TOKEN || ''
  if (path) {
    if (statSync(path).size > 8192) throw new Error('QwenPaw console credential exceeds the size limit')
    token = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
    if (!token) throw new Error('QwenPaw console credential file is empty')
  }
  if (token) {
    if (token.length > 8192 || /\s/.test(token)) throw new Error('QwenPaw console credential has invalid formatting')
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

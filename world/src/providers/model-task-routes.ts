import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const WORLD_MODEL_PURPOSES = ['world.oracle', 'world.herald', 'world.saga',
  'world.evolution_review', 'world.daily_report'] as const
export type WorldModelPurpose = typeof WORLD_MODEL_PURPOSES[number]
export interface WorldModelRoute { agentId: string; apiUrl: string }

export function worldModelPurpose(value: unknown): WorldModelPurpose {
  if (typeof value !== 'string' || !(WORLD_MODEL_PURPOSES as readonly string[]).includes(value)) {
    throw new Error('Unregistered world model task purpose')
  }
  return value as WorldModelPurpose
}

/** Configuration declares QwenPaw Agents, never vendor models or credentials. */
export function loadWorldModelRoutes(path = process.env.MODEL_TASK_ROUTES_FILE ||
  fileURLToPath(new URL('../../../config/model-task-routes.json', import.meta.url))): Record<WorldModelPurpose, WorldModelRoute> {
  if (statSync(path).size > 65_536) throw new Error('Model task directory exceeds the size limit')
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  if (Buffer.byteLength(raw) > 65_536) throw new Error('Model task directory exceeds the size limit')
  const catalog = JSON.parse(raw)
  if (catalog?.schema !== 1 || catalog?.project !== 'qiandengji' ||
      catalog?.policy?.generationOwner !== 'qwenpaw-agent' ||
      catalog?.policy?.automaticProviderFallback !== false || catalog?.policy?.unknownSubmissionRetry !== false) {
    throw new Error('Invalid QwenPaw model task directory policy')
  }
  const result = {} as Record<WorldModelPurpose, WorldModelRoute>
  for (const purpose of WORLD_MODEL_PURPOSES) {
    const route = catalog.routes?.[purpose]
    if (route?.runtime !== 'game' || typeof route?.agentId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(route.agentId) || typeof route?.apiUrl !== 'string') {
      throw new Error(`Invalid QwenPaw task route: ${purpose}`)
    }
    let url: URL
    try { url = new URL(route.apiUrl) } catch { throw new Error(`Invalid QwenPaw API URL: ${purpose}`) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        !/^\/api\/?$/.test(url.pathname)) throw new Error(`Invalid QwenPaw API URL: ${purpose}`)
    result[purpose] = Object.freeze({ agentId: route.agentId, apiUrl: url.origin + '/api' })
  }
  return Object.freeze(result)
}

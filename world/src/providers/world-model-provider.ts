import type { ModelProvider } from './model-provider.ts'
import { createQwenpawProvider, type QwenpawProviderOptions } from './qwenpaw-provider.ts'
import { loadWorldModelRoutes, worldModelPurpose, type WorldModelPurpose } from './model-task-routes.ts'
import { DEFAULT_MODEL_PROVIDER_INFO } from './provider-info.ts'

/** Production is always a registered QwenPaw Agent. Instance injection is an offline test seam. */
export function createWorldModelProvider(options: {
  /** Legacy caller setting; production endpoints come exclusively from the task directory. */
  qwenpawUrl: string
  provider?: ModelProvider
  qwenpaw?: QwenpawProviderOptions
  purpose?: WorldModelPurpose
  routesFile?: string
}): ModelProvider {
  if (options.provider) return options.provider
  const routes = loadWorldModelRoutes(options.routesFile)
  const defaultPurpose = worldModelPurpose(options.purpose ?? 'world.oracle')
  const providers = new Map<WorldModelPurpose, ModelProvider>()
  const route = (purpose: unknown) => {
    const key = worldModelPurpose(purpose ?? defaultPurpose)
    const selected = routes[key]
    if (!providers.has(key)) providers.set(key, createQwenpawProvider(selected.apiUrl + '/console/chat', options.qwenpaw))
    return { provider: providers.get(key)!, roleId: selected.agentId }
  }
  return {
    info: DEFAULT_MODEL_PROVIDER_INFO,
    async chat(request) {
      const selected = route(request.purpose)
      return selected.provider.chat({ ...request, roleId: selected.roleId })
    },
    async task(request) {
      const selected = route(request.purpose)
      return selected.provider.task!({ ...request, roleId: selected.roleId })
    },
  }
}

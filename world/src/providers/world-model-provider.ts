import type { ModelProvider } from './model-provider.ts'
import { createQwenpawProvider, type QwenpawProviderOptions } from './qwenpaw-provider.ts'

/** Existing default, with an instance seam for tests or a later explicitly selected backend. */
export function createWorldModelProvider(options: {
  qwenpawUrl: string
  provider?: ModelProvider
  qwenpaw?: QwenpawProviderOptions
}): ModelProvider {
  return options.provider ?? createQwenpawProvider(options.qwenpawUrl, options.qwenpaw)
}

import type { ModelProvider, ModelProviderInfo } from './model-provider.ts'

/** Default only. Runtime displays must use describeModelProvider on the selected instance. */
export const DEFAULT_MODEL_PROVIDER_INFO = Object.freeze({
  id: 'qwenpaw', label: 'QwenPaw', capabilities: Object.freeze({ chat: true, task: true }),
})

/** Explicit public projection: no endpoint, credentials, role/model settings or history. */
export function describeModelProvider(provider: ModelProvider): ModelProviderInfo {
  return {
    id: provider.info.id,
    label: provider.info.label,
    capabilities: { chat: provider.info.capabilities.chat && typeof provider.chat === 'function',
      task: provider.info.capabilities.task && typeof provider.task === 'function' },
  }
}

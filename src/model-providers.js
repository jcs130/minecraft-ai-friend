'use strict'

const GENERIC_KEY_ENV = 'MINDCRAFT_LLM_API_KEY'

const providers = [
  {
    id: 'ollama',
    label: '本地 Ollama',
    description: '适合本机模型。Autoplayer 使用 OpenAI-compatible /v1 接口，Mindcraft 使用 Ollama 原生接口。',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3-vl:8b',
    keyEnvNames: [],
    authRequired: false,
    mindcraftKeyEnv: '',
    mindcraftProfilePatch: {
      model: {
        api: 'ollama',
        url: 'http://127.0.0.1:11434',
        model: 'qwen3-vl:8b'
      },
      code_model: {
        api: 'ollama',
        url: 'http://127.0.0.1:11434',
        model: 'qwen3-vl:8b'
      },
      vision_model: {
        api: 'ollama',
        url: 'http://127.0.0.1:11434',
        model: 'qwen3-vl:8b'
      }
    },
    setupHint: '确认 Ollama 已运行并且模型已 pull。'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek 官方 OpenAI-compatible Chat Completions 接口。',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    keyEnvNames: ['DEEPSEEK_API_KEY'],
    authRequired: true,
    mindcraftKeyEnv: 'DEEPSEEK_API_KEY',
    mindcraftProfilePatch: {
      model: {
        api: 'deepseek',
        url: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash'
      },
      code_model: {
        api: 'deepseek',
        url: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro'
      }
    },
    setupHint: '设置 DEEPSEEK_API_KEY，或用 MINDCRAFT_LLM_API_KEY 作为本控制台的通用密钥。'
  },
  {
    id: 'aliyun-qwen',
    label: '阿里云百炼 / 通义千问',
    description: '阿里云百炼 OpenAI-compatible 接口。不同地域或业务空间可能需要改成专属 Base URL。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    keyEnvNames: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    authRequired: true,
    mindcraftKeyEnv: 'QWEN_API_KEY',
    mindcraftProfilePatch: {
      model: {
        api: 'qwen',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus'
      },
      code_model: {
        api: 'qwen',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus'
      },
      embedding: {
        api: 'qwen',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'text-embedding-v3'
      }
    },
    setupHint: '设置 DASHSCOPE_API_KEY；启动 Mindcraft 时会自动映射给 QWEN_API_KEY。'
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    description: '火山方舟 OpenAI-compatible 接口。模型名称通常填写控制台里的推理接入点 ID。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'your-endpoint-id',
    keyEnvNames: ['ARK_API_KEY', 'VOLCENGINE_API_KEY', 'DOUBAO_API_KEY'],
    authRequired: true,
    mindcraftKeyEnv: 'OPENAI_API_KEY',
    mindcraftProfilePatch: {
      model: {
        api: 'openai',
        url: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'your-endpoint-id'
      },
      code_model: {
        api: 'openai',
        url: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'your-endpoint-id'
      }
    },
    setupHint: '设置 ARK_API_KEY；把模型名改成火山方舟控制台中的接入点 ID。'
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible 自定义',
    description: '适合任何兼容 /chat/completions 的云端或内网模型网关。',
    baseUrl: 'https://api.example.com/v1',
    defaultModel: 'your-model',
    keyEnvNames: ['OPENAI_API_KEY'],
    authRequired: true,
    mindcraftKeyEnv: 'OPENAI_API_KEY',
    mindcraftProfilePatch: {
      model: {
        api: 'openai',
        url: 'https://api.example.com/v1',
        model: 'your-model'
      },
      code_model: {
        api: 'openai',
        url: 'https://api.example.com/v1',
        model: 'your-model'
      }
    },
    setupHint: `设置 ${GENERIC_KEY_ENV} 或 OPENAI_API_KEY，然后填入供应商的 Base URL 和模型名。`
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '适合快速切换多个云端模型。模型名按 OpenRouter 的 provider/model 格式填写。',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    keyEnvNames: ['OPENROUTER_API_KEY'],
    authRequired: true,
    mindcraftKeyEnv: 'OPENROUTER_API_KEY',
    mindcraftProfilePatch: {
      model: {
        api: 'openrouter',
        model: 'openai/gpt-4o-mini'
      },
      code_model: {
        api: 'openrouter',
        model: 'openai/gpt-4o-mini'
      }
    },
    setupHint: '设置 OPENROUTER_API_KEY。'
  }
]

function listModelProviders(env = process.env) {
  return providers.map(provider => toPublicProvider(provider, env))
}

function getModelProvider(id) {
  return providers.find(provider => provider.id === id) || providers.find(provider => provider.id === 'openai-compatible')
}

function inferModelProvider(config) {
  if (config && config.llmProvider) return getModelProvider(config.llmProvider).id
  const baseUrl = String(config && config.llmBaseUrl ? config.llmBaseUrl : '').toLowerCase()
  if (baseUrl.includes('localhost:11434') || baseUrl.includes('127.0.0.1:11434')) return 'ollama'
  if (baseUrl.includes('api.deepseek.com')) return 'deepseek'
  if (baseUrl.includes('dashscope') || baseUrl.includes('maas.aliyuncs.com')) return 'aliyun-qwen'
  if (baseUrl.includes('volces.com') || baseUrl.includes('ark.cn-')) return 'doubao'
  if (baseUrl.includes('openrouter.ai')) return 'openrouter'
  return 'openai-compatible'
}

function getConfiguredLlmApiKey(config, env = process.env) {
  const name = getConfiguredLlmApiKeyName(config, env)
  return name ? env[name] : ''
}

function getConfiguredLlmApiKeyName(config, env = process.env) {
  const provider = getModelProvider(inferModelProvider(config))
  return getConfiguredProviderApiKeyName(provider, env)
}

function getProviderEnvStatus(config, env = process.env, providerId = '') {
  const provider = providerId ? getModelProvider(providerId) : getModelProvider(inferModelProvider(config))
  const candidates = keyCandidates(provider)
  const detected = candidates.filter(name => env[name])
  return {
    provider: provider.id,
    authRequired: provider.authRequired,
    keyDetected: detected.length > 0,
    authReady: !provider.authRequired || detected.length > 0,
    detectedEnvNames: detected,
    acceptedEnvNames: candidates,
    mindcraftKeyEnv: provider.mindcraftKeyEnv || ''
  }
}

function buildMindcraftEnv(config, env = process.env) {
  const nextEnv = { ...env }
  const textProvider = getModelProvider(inferModelProvider(config))
  const visionProvider = getModelProvider(inferModelProvider({
    llmProvider: config.visionProvider,
    llmBaseUrl: config.visionBaseUrl
  }))

  applyProviderEnv(nextEnv, textProvider)
  applyProviderEnv(nextEnv, visionProvider)
  return nextEnv
}

function applyProviderEnv(nextEnv, provider) {
  const keyValue = getConfiguredProviderApiKey(provider, nextEnv)

  if (provider.id === 'deepseek' && !nextEnv.DEEPSEEK_API_KEY && keyValue) {
    nextEnv.DEEPSEEK_API_KEY = keyValue
  }

  if (provider.id === 'aliyun-qwen') {
    if (!nextEnv.QWEN_API_KEY && nextEnv.DASHSCOPE_API_KEY) nextEnv.QWEN_API_KEY = nextEnv.DASHSCOPE_API_KEY
    if (!nextEnv.QWEN_API_KEY && keyValue) nextEnv.QWEN_API_KEY = keyValue
  }

  if ((provider.id === 'doubao' || provider.id === 'openai-compatible') && !nextEnv.OPENAI_API_KEY && keyValue) {
    nextEnv.OPENAI_API_KEY = keyValue
  }
}

function getConfiguredProviderApiKey(provider, env) {
  const name = getConfiguredProviderApiKeyName(provider, env)
  return name ? env[name] : ''
}

function getConfiguredProviderApiKeyName(provider, env) {
  const candidates = keyCandidates(provider)
  return candidates.find(name => env[name]) || ''
}

function toPublicProvider(provider, env) {
  const candidates = keyCandidates(provider)
  const detected = candidates.filter(name => env[name])
  return {
    id: provider.id,
    label: provider.label,
    description: provider.description,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    authRequired: provider.authRequired,
    acceptedEnvNames: candidates,
    keyDetected: detected.length > 0,
    authReady: !provider.authRequired || detected.length > 0,
    detectedEnvNames: detected,
    mindcraftKeyEnv: provider.mindcraftKeyEnv || '',
    mindcraftProfilePatch: provider.mindcraftProfilePatch,
    setupHint: provider.setupHint
  }
}

function keyCandidates(provider) {
  const providerKeys = provider.keyEnvNames || []
  const ordered = provider.id === 'openai-compatible'
    ? [GENERIC_KEY_ENV, ...providerKeys, provider.mindcraftKeyEnv || '']
    : [...providerKeys, GENERIC_KEY_ENV, provider.mindcraftKeyEnv || '']
  return unique(ordered.filter(Boolean))
}

function unique(values) {
  return [...new Set(values)]
}

module.exports = {
  GENERIC_KEY_ENV,
  listModelProviders,
  getModelProvider,
  inferModelProvider,
  getConfiguredLlmApiKey,
  getConfiguredLlmApiKeyName,
  getProviderEnvStatus,
  buildMindcraftEnv
}

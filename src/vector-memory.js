'use strict'

const crypto = require('node:crypto')

class VectorMemory {
  constructor(options = {}) {
    this.dataStore = options.dataStore
    this.logger = options.logger
    this.getConfig = options.getConfig || (() => ({}))
    this.getEnv = options.getEnv || (() => process.env)
    this.lastError = ''
    this.lastIndexedAt = ''
    this.lastSearchAt = ''
    this.lastMode = 'none'
    this.knownQdrantCollections = new Map()
  }

  snapshot() {
    const config = this.config()
    return {
      enabled: config.enabled,
      embeddingProvider: config.embeddingProvider,
      embeddingBaseUrl: config.embeddingBaseUrl,
      embeddingModel: config.embeddingModel,
      vectorStore: config.vectorStore,
      qdrantUrl: config.qdrantUrl,
      qdrantCollection: config.qdrantCollection,
      sqliteReady: Boolean(this.dataStore && this.dataStore.snapshot && this.dataStore.snapshot().sqliteReady),
      lastMode: this.lastMode,
      lastIndexedAt: this.lastIndexedAt,
      lastSearchAt: this.lastSearchAt,
      lastError: this.lastError
    }
  }

  async remember(memory) {
    const config = this.config()
    if (!config.enabled) return { ok: false, skipped: 'disabled', mode: 'lexical' }
    if (!memory || !memory.id || !memory.agent || !memory.text) return { ok: false, skipped: 'invalid-memory' }

    try {
      const vector = await this.embed(memory.text, config)
      const payload = {
        memory,
        agent: memory.agent,
        kind: memory.kind,
        importance: memory.importance,
        text: memory.text,
        at: memory.at
      }

      if (this.dataStore && this.dataStore.recordAgentMemoryVector) {
        this.dataStore.recordAgentMemoryVector({
          memoryId: memory.id,
          agent: memory.agent,
          model: config.embeddingModel,
          vector,
          payload,
          updatedAt: new Date().toISOString()
        })
      }

      if (config.vectorStore === 'qdrant') {
        await this.qdrantUpsert(memory, vector, payload, config)
      }

      this.lastError = ''
      this.lastIndexedAt = new Date().toISOString()
      this.lastMode = config.vectorStore === 'qdrant' ? 'qdrant' : 'sqlite-vector'
      return {
        ok: true,
        mode: this.lastMode,
        vectorId: qdrantPointId(memory.id),
        embeddingModel: config.embeddingModel,
        dimension: vector.length
      }
    } catch (error) {
      this.lastError = error.message
      this.lastMode = 'lexical-fallback'
      if (this.logger) this.logger.warn(`Vector memory indexing skipped: ${error.message}`)
      return { ok: false, mode: 'lexical-fallback', error: error.message }
    }
  }

  async search(options = {}) {
    const config = this.config()
    const agent = String(options.agent || '').trim()
    const query = String(options.q || options.query || '').trim()
    const limit = clampNumber(options.limit || 20, 1, 100, 20)

    if (!query) return this.lexicalSearch({ agent, query, limit, mode: 'recent' })
    if (!config.enabled) return this.lexicalSearch({ agent, query, limit, mode: 'lexical-disabled' })

    try {
      const queryVector = await this.embed(query, config)
      if (config.vectorStore === 'qdrant') {
        const qdrant = await this.qdrantSearch({ agent, queryVector, limit, config })
        if (qdrant.results.length > 0) {
          this.lastError = ''
          this.lastSearchAt = new Date().toISOString()
          this.lastMode = 'qdrant'
          return {
            query,
            agent,
            vectorReady: true,
            mode: 'qdrant',
            embeddingModel: config.embeddingModel,
            vectorStore: config.vectorStore,
            results: qdrant.results
          }
        }
      }

      const sqlite = this.sqliteVectorSearch({ agent, query, queryVector, limit, config })
      if (sqlite.results.length > 0) {
        this.lastError = ''
        this.lastSearchAt = new Date().toISOString()
        this.lastMode = 'sqlite-vector'
        return sqlite
      }

      return this.lexicalSearch({ agent, query, limit, mode: 'vector-empty' })
    } catch (error) {
      this.lastError = error.message
      this.lastMode = 'lexical-fallback'
      if (this.logger) this.logger.warn(`Vector memory search fell back to lexical: ${error.message}`)
      return this.lexicalSearch({ agent, query, limit, mode: 'lexical-fallback', error: error.message })
    }
  }

  sqliteVectorSearch({ agent, query, queryVector, limit, config }) {
    const rows = this.dataStore && this.dataStore.recentAgentMemoryVectors
      ? this.dataStore.recentAgentMemoryVectors(agent, 1000)
      : []
    const results = rows
      .map(row => {
        const payload = row.payload || {}
        const memory = payload.memory || payload
        return {
          ...(memory || {}),
          id: memory.id || row.memoryId,
          agent: memory.agent || row.agent,
          score: cosineSimilarity(queryVector, row.vector),
          vector: {
            mode: 'sqlite-vector',
            model: row.model || config.embeddingModel,
            dimension: row.dimension
          }
        }
      })
      .filter(row => Number.isFinite(row.score) && row.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.importance || 0) - Number(a.importance || 0) || String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, limit)

    return {
      query,
      agent,
      vectorReady: true,
      mode: 'sqlite-vector',
      embeddingModel: config.embeddingModel,
      vectorStore: config.vectorStore,
      results
    }
  }

  lexicalSearch({ agent, query, limit, mode, error = '' }) {
    const rows = this.dataStore && this.dataStore.recentAgentMemories
      ? this.dataStore.recentAgentMemories(agent, 200)
      : []
    const q = String(query || '').trim().toLowerCase()
    const results = rows
      .map(row => ({ ...row, score: scoreMemory(row, q) }))
      .filter(row => !q || row.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.importance || 0) - Number(a.importance || 0) || String(b.at).localeCompare(String(a.at)))
      .slice(0, limit)

    this.lastSearchAt = new Date().toISOString()
    this.lastMode = mode || 'lexical'
    return {
      query: q,
      agent,
      vectorReady: false,
      mode: this.lastMode,
      embeddingModel: this.config().embeddingModel,
      vectorStore: this.config().vectorStore,
      note: error ? `Vector memory unavailable: ${error}` : 'Using SQLite lexical memory search.',
      results
    }
  }

  async embed(text, config) {
    if (config.embeddingProvider === 'ollama') return this.embedWithOllama(text, config)
    return this.embedOpenAiCompatible(text, config)
  }

  async embedOpenAiCompatible(text, config) {
    const baseUrl = stripTrailingSlash(config.embeddingBaseUrl || 'http://127.0.0.1:11434/v1')
    const headers = { 'content-type': 'application/json' }
    if (config.embeddingApiKey) headers.authorization = `Bearer ${config.embeddingApiKey}`
    const json = await fetchJson(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.embeddingModel, input: text })
    }, config.timeoutMs)
    const vector = json && json.data && json.data[0] && json.data[0].embedding
    return normalizeVector(vector)
  }

  async embedWithOllama(text, config) {
    const baseUrl = stripTrailingSlash(String(config.embeddingBaseUrl || 'http://127.0.0.1:11434').replace(/\/v1\/?$/, ''))
    const json = await fetchJson(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.embeddingModel, input: text })
    }, config.timeoutMs)
    const vector = Array.isArray(json && json.embeddings) ? json.embeddings[0] : json && json.embedding
    return normalizeVector(vector)
  }

  async qdrantUpsert(memory, vector, payload, config) {
    await this.ensureQdrantCollection(vector.length, config)
    await fetchJson(`${stripTrailingSlash(config.qdrantUrl)}/collections/${encodeURIComponent(config.qdrantCollection)}/points?wait=true`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        points: [{
          id: qdrantPointId(memory.id),
          vector,
          payload: {
            ...payload,
            memoryId: memory.id,
            agent: memory.agent
          }
        }]
      })
    }, config.timeoutMs)
  }

  async qdrantSearch({ agent, queryVector, limit, config }) {
    const filter = agent ? { must: [{ key: 'agent', match: { value: agent } }] } : undefined
    const json = await fetchJson(`${stripTrailingSlash(config.qdrantUrl)}/collections/${encodeURIComponent(config.qdrantCollection)}/points/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vector: queryVector,
        limit,
        with_payload: true,
        filter
      })
    }, config.timeoutMs)
    const points = Array.isArray(json && json.result) ? json.result : []
    return {
      results: points.map(point => {
        const payload = point.payload || {}
        const memory = payload.memory || payload
        return {
          ...(memory || {}),
          id: memory.id || payload.memoryId || String(point.id || ''),
          agent: memory.agent || payload.agent || '',
          score: Number(point.score || 0),
          vector: {
            mode: 'qdrant',
            model: config.embeddingModel,
            pointId: point.id
          }
        }
      })
    }
  }

  async ensureQdrantCollection(size, config) {
    const key = `${config.qdrantUrl}|${config.qdrantCollection}|${size}`
    if (this.knownQdrantCollections.get(key)) return
    const baseUrl = stripTrailingSlash(config.qdrantUrl)
    const collectionUrl = `${baseUrl}/collections/${encodeURIComponent(config.qdrantCollection)}`
    try {
      await fetchJson(collectionUrl, { method: 'GET' }, config.timeoutMs)
      this.knownQdrantCollections.set(key, true)
      return
    } catch (error) {
      if (!/HTTP 404\b/.test(error.message)) throw error
    }

    await fetchJson(collectionUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vectors: { size, distance: 'Cosine' } })
    }, config.timeoutMs)
    this.knownQdrantCollections.set(key, true)
  }

  config() {
    const raw = this.getConfig() || {}
    const env = this.getEnv() || process.env
    return {
      enabled: coerceBool(raw.memoryVectorEnabled, coerceBool(env.MEMORY_VECTOR_ENABLED, true)),
      embeddingProvider: normalizeChoice(raw.memoryEmbeddingProvider || env.MEMORY_EMBEDDING_PROVIDER || 'openai-compatible', ['openai-compatible', 'ollama'], 'openai-compatible'),
      embeddingBaseUrl: String(raw.memoryEmbeddingBaseUrl || env.MEMORY_EMBEDDING_BASE_URL || 'http://127.0.0.1:11434/v1').trim(),
      embeddingModel: String(raw.memoryEmbeddingModel || env.MEMORY_EMBEDDING_MODEL || 'bge-m3').trim(),
      embeddingApiKey: String(env.MEMORY_EMBEDDING_API_KEY || env.OPENAI_API_KEY || '').trim(),
      vectorStore: normalizeChoice(raw.memoryVectorStore || env.MEMORY_VECTOR_STORE || 'sqlite', ['sqlite', 'qdrant'], 'sqlite'),
      qdrantUrl: String(raw.memoryQdrantUrl || env.MEMORY_QDRANT_URL || 'http://127.0.0.1:6333').trim(),
      qdrantCollection: String(raw.memoryQdrantCollection || env.MEMORY_QDRANT_COLLECTION || 'minecraft_agent_memories').trim() || 'minecraft_agent_memories',
      timeoutMs: clampNumber(raw.memoryVectorTimeoutMs || env.MEMORY_VECTOR_TIMEOUT_MS || 8000, 1000, 60000, 8000)
    }
  }
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!response.ok) {
      const message = json && (json.error && (json.error.message || json.error) || json.status && json.status.error)
      throw new Error(`HTTP ${response.status} ${message || text.slice(0, 200)}`.trim())
    }
    return json
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`request timeout after ${timeoutMs}ms: ${url}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function normalizeVector(value) {
  const vector = Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []
  if (vector.length === 0) throw new Error('embedding response did not include a vector')
  return vector
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let an = 0
  let bn = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i])
    const bv = Number(b[i])
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0
    dot += av * bv
    an += av * av
    bn += bv * bv
  }
  if (an === 0 || bn === 0) return 0
  return dot / (Math.sqrt(an) * Math.sqrt(bn))
}

function scoreMemory(row, query) {
  if (!query) return Number(row.importance || 1)
  const haystack = `${row.agent || ''} ${row.kind || ''} ${row.text || ''}`.toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean)
  let score = Number(row.importance || 1)
  for (const term of terms) {
    if (haystack.includes(term)) score += 10
  }
  return score
}

function qdrantPointId(value) {
  const hex = crypto.createHash('md5').update(String(value || '')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase()
  return allowed.includes(normalized) ? normalized : fallback
}

function coerceBool(value, fallback) {
  if (value === true || value === false) return value
  if (typeof value === 'number') return value !== 0
  const text = String(value || '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

module.exports = { VectorMemory }
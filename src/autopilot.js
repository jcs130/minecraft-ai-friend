'use strict'

const fs = require('node:fs')
const path = require('node:path')

const creativeTasks = [
  'Autonomous creative-practice task: Creative mode: do not craft items or retry failed recipes. Use creative inventory or direct placement. Improve the base as a useful home with lighting, storage, a bed, crafting utilities, windows, and a clear entrance. Do not follow the human player unless directly asked.',
  'Autonomous creative-practice task: Creative mode: do not craft items. Make the area around the base safer and easier to use with torches, clear paths, hazard cleanup, and a visible entrance. Report briefly when done.',
  'Autonomous creative-practice task: Creative mode: do not craft items. Prepare or improve a small farm near the base with water, tilled soil, fencing, lighting, and crop placement. Keep it coherent and local.',
  'Autonomous creative-practice task: Creative mode: do not craft items. Organize the base interior, place useful storage and utility blocks, and make the room easy for a human player to use.',
  'Autonomous creative-practice task: Creative mode: do not craft items. Explore a short loop around the base, identify useful landmarks, return to the base, and report the route. Stay local.'
]

const creativeRoleTasks = [
  'Autonomous creative-practice task: Creative mode: take the builder role. Do not craft. Improve the main base structure, lighting, roof, doors, windows, and interior utility. Avoid blocking other agents work areas.',
  'Autonomous creative-practice task: Creative mode: take the farmer role. Do not craft. Improve the farm, fencing, water placement, crop readiness, lighting, and path connection back to the base.',
  'Autonomous creative-practice task: Creative mode: take the scout role. Do not craft. Explore a short safe loop around the base, report useful landmarks, then return. Do not wander far.',
  'Autonomous creative-practice task: Creative mode: take the quartermaster role. Do not craft. Organize storage and make tools and materials easy to find.'
]

const survivalTasks = {
  safety: 'Autonomous survival task: Survival mode: prioritize safety. If it is night or hostile mobs are nearby, return to the base or nearest shelter, close doors, add light if torches are available, sleep if a bed is available, and do not wander far.',
  health: 'Autonomous survival task: Survival mode: health is the priority. Retreat from danger, avoid combat and falls, eat if food is available, return to shelter, and report what is needed if food or safety is missing.',
  food: 'Autonomous survival task: Survival mode: secure food. Check inventory for edible food, cook raw food if fuel and furnace are available, harvest nearby crops or hunt only low-risk animals close to base, then return to safety.',
  essentials: 'Autonomous survival task: Survival mode: build essentials. Gather a small amount of nearby wood or stone only if safe, make basic tools only when ingredients and recipe are known, and stop/report instead of retrying if a recipe is missing.',
  base: 'Autonomous survival task: Survival mode: improve the base for survival. Add lighting, a bed if available, storage, door safety, and a simple path. Avoid decorative work until food and safety are stable.',
  farm: 'Autonomous survival task: Survival mode: improve sustainable food. Prepare or maintain a small farm near the base with water, tilled soil, fencing or lighting when materials are available, then report missing seeds or crops.',
  organize: 'Autonomous survival task: Survival mode: organize survival supplies. Put food, tools, fuel, blocks, and mob drops into sensible storage. Keep emergency food and tools accessible.',
  explore: 'Autonomous survival task: Survival mode: do a short low-risk local scouting loop near the base, mark or report useful resources, avoid caves/lava/combat, and return before night or danger.'
}

const survivalTaskCycle = [
  survivalTasks.base,
  survivalTasks.farm,
  survivalTasks.organize,
  survivalTasks.explore,
  survivalTasks.essentials
]

const survivalRoleTasks = [
  'Autonomous survival task: Survival mode: take the safety role. Keep the base safe, lit, closed, and easy to return to. Avoid combat unless unavoidable.',
  'Autonomous survival task: Survival mode: take the gatherer role. Gather only nearby low-risk wood, stone, food, or fuel, then return to base. Do not enter caves or wander far.',
  'Autonomous survival task: Survival mode: take the farmer role. Improve food reliability with nearby crops, water, lighting, and safe fencing when materials are available.',
  'Autonomous survival task: Survival mode: take the quartermaster role. Organize survival storage and keep emergency food, tools, torches, and blocks accessible.'
]

const settlementRoleTasks = [
  'Builder role: improve the shared village base with walls, roof, doors, windows, lighting, paths, and useful interior blocks. Avoid tearing down player-built blocks.',
  'Gatherer role: collect nearby wood, stone, coal, food, wool, and other basic materials, then return to the shared storage chest and deposit surplus supplies.',
  'Farmer role: create and maintain a small safe food area with crops, water, light, fences, and nearby animal/food support when materials are available.',
  'Quartermaster role: organize the public chest, keep tools, fuel, food, blocks, torches, and building supplies available, and report shortages.',
  'Scout role: explore only short safe loops around the village, mark useful resources mentally, then return before danger or night.'
]

class Autopilot {
  constructor(options) {
    this.client = options.client
    this.logger = options.logger
    this.memoryPath = options.memoryPath
    this.intervalMs = options.intervalMs
    this.idleCooldownMs = options.idleCooldownMs
    this.minTaskRuntimeMs = options.minTaskRuntimeMs
    this.agentFilter = options.agentFilter || []
    this.assistantMode = normalizeAssistantMode(options.assistantMode || 'creative')
    this.useLlm = options.useLlm || false
    this.llmBaseUrl = normalizeOpenAiBaseUrl(options.llmBaseUrl || 'https://api.deepseek.com')
    this.llmModel = options.llmModel || 'deepseek-v4-flash'
    this.llmApiKey = options.llmApiKey || ''
    this.active = false
    this.timer = null
    this.lastTickAt = null
    this.lastError = null
    this.memory = this.loadMemory()
    this.worldDirective = normalizeDirective(options.worldDirective || this.memory.worldDirective || '')

    this.client.on('bot-output', (agentName, message) => {
      this.rememberOutput(agentName, message)
    })
  }

  configure(options) {
    if (options.intervalMs) this.intervalMs = options.intervalMs
    if (options.idleCooldownMs) this.idleCooldownMs = options.idleCooldownMs
    if (options.minTaskRuntimeMs) this.minTaskRuntimeMs = options.minTaskRuntimeMs
    if (options.agentFilter) this.agentFilter = options.agentFilter
    if (options.assistantMode) this.assistantMode = normalizeAssistantMode(options.assistantMode)
    if (typeof options.useLlm === 'boolean') this.useLlm = options.useLlm
    if (options.llmBaseUrl) this.llmBaseUrl = normalizeOpenAiBaseUrl(options.llmBaseUrl)
    if (options.llmModel) this.llmModel = options.llmModel
    if (options.llmApiKey !== undefined) this.llmApiKey = options.llmApiKey
    if (options.worldDirective !== undefined) this.setWorldDirective(options.worldDirective)
  }

  start() {
    if (this.active) return
    this.active = true
    this.client.start()
    this.logger.info(`Autopilot started in ${this.assistantMode} mode`)
    this.schedule(1000)
  }

  stop() {
    this.active = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.logger.info('Autopilot stopped')
  }

  snapshot() {
    return {
      active: this.active,
      assistantMode: this.assistantMode,
      intervalMs: this.intervalMs,
      idleCooldownMs: this.idleCooldownMs,
      minTaskRuntimeMs: this.minTaskRuntimeMs,
      agentFilter: this.agentFilter,
      useLlm: this.useLlm,
      llmConfigured: this.canUseLlm(),
      llmBaseUrl: this.llmBaseUrl,
      llmModel: this.llmModel,
      worldDirective: this.worldDirective,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      memoryPath: this.memoryPath
    }
  }

  async sendManualTask(agentName, task) {
    const message = normalizeTask(task, this.assistantMode)
    await this.client.sendAgentMessage(agentName, message)
    const memory = this.memoryFor(agentName)
    memory.lastInstructionAt = Date.now()
    memory.lastTaskSummary = message.slice(0, 260)
    memory.recentTasks.push({ at: new Date().toISOString(), task: message, source: 'manual' })
    memory.recentTasks = memory.recentTasks.slice(-20)
    this.saveMemory()
  }

  getMemory(agentName) {
    return agentName ? this.memoryFor(agentName) : this.memory
  }

  setWorldDirective(directive) {
    this.worldDirective = normalizeDirective(directive)
    this.memory.worldDirective = this.worldDirective
    this.saveMemory()
    return this.worldDirective
  }

  schedule(delay) {
    if (!this.active) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.tick().catch(error => {
        this.lastError = error.message
        this.logger.error(`Autopilot tick failed: ${error.message}`)
      }).finally(() => this.schedule(this.intervalMs))
    }, delay)
  }

  async tick() {
    this.lastTickAt = new Date().toISOString()
    if (!this.client.connected || !this.client.latestState) return

    const now = Date.now()
    for (const agentName of this.client.onlineAgentNames(this.agentFilter)) {
      await this.maybeAssignTask(agentName, now)
    }
  }

  async maybeAssignTask(agentName, now) {
    const state = this.client.latestState && this.client.latestState[agentName]
    if (!state) return

    const memory = this.memoryFor(agentName)
    if (!isIdle(state)) {
      memory.lastNonIdleAt = now
      this.saveMemoryThrottled()
      return
    }

    const enoughRuntime = now - Number(memory.lastNonIdleAt || 0) > this.minTaskRuntimeMs
    const enoughCooldown = now - Number(memory.lastInstructionAt || 0) > this.idleCooldownMs
    if (!enoughRuntime || !enoughCooldown) return

    const task = await this.decideTask(agentName, state)
    await this.client.sendAgentMessage(agentName, task)
    memory.lastInstructionAt = Date.now()
    memory.lastTaskSummary = task.slice(0, 260)
    memory.recentTasks.push({ at: new Date().toISOString(), task, source: this.canUseLlm() ? 'llm-or-fallback' : 'fallback' })
    memory.recentTasks = memory.recentTasks.slice(-20)
    this.saveMemory()
    this.logger.info(`Assigned task to ${agentName}: ${task}`)
  }

  async decideTask(agentName, state) {
    const llmTask = await this.llmDecision(agentName, state)
    return llmTask || this.fallbackDecision(agentName, state)
  }

  fallbackDecision(agentName, state) {
    if (this.worldDirective) return this.settlementFallbackDecision(agentName, state)
    return this.assistantMode === 'survival'
      ? this.survivalFallbackDecision(agentName, state)
      : this.creativeFallbackDecision(agentName, state)
  }

  settlementFallbackDecision(agentName, state) {
    const online = this.client.onlineAgentNames(this.agentFilter)
    const roleIndex = Math.max(0, online.indexOf(agentName))
    const role = settlementRoleTasks[roleIndex % settlementRoleTasks.length]
    const safety = state && state.gameplay && state.gameplay.timeLabel === 'Night'
      ? 'It is night: prefer lighting, shelter, storage, and indoor/base work until safe.'
      : 'If safe, continue village construction and local resource loops.'
    return normalizeTask(`Long-term world directive: ${this.worldDirective} Current assignment for ${agentName}: ${role} ${safety} Keep acting like a permanent resident of the village, coordinate with other AI players, and use shared storage.`, this.assistantMode)
  }

  creativeFallbackDecision(agentName, state) {
    const summary = compactState(this.client, this.memoryFor(agentName), agentName, state, this.assistantMode)
    const online = this.client.onlineAgentNames(this.agentFilter)
    const roleIndex = online.indexOf(agentName)
    const counts = summary.inventory.counts || {}
    const nearbyTypes = summary.nearby.entityTypes || []
    const memory = this.memoryFor(agentName)

    if (online.length > 1 && roleIndex >= 0) return creativeRoleTasks[roleIndex % creativeRoleTasks.length]
    if (summary.timeLabel === 'Night') return creativeTasks[1]
    if (Object.keys(counts).some(name => /seed|wheat|carrot|potato|hoe|bucket/i.test(name)) || nearbyTypes.includes('cow')) {
      return creativeTasks[2]
    }
    if (Number(summary.inventory.stacksUsed || 0) > 6) return creativeTasks[3]

    const task = creativeTasks[memory.taskIndex % creativeTasks.length]
    memory.taskIndex += 1
    this.saveMemoryThrottled()
    return task
  }

  survivalFallbackDecision(agentName, state) {
    const summary = compactState(this.client, this.memoryFor(agentName), agentName, state, this.assistantMode)
    const online = this.client.onlineAgentNames(this.agentFilter)
    const roleIndex = online.indexOf(agentName)
    const counts = summary.inventory.counts || {}
    const nearbyTypes = summary.nearby.entityTypes || []
    const memory = this.memoryFor(agentName)

    if (Number(summary.health || 20) <= 12) return survivalTasks.health
    if (Number(summary.hunger || 20) <= 12 && !hasAny(counts, /bread|beef|pork|chicken|mutton|cod|salmon|potato|carrot|apple|berries|melon|cookie|stew|beetroot/i)) return survivalTasks.food
    if (summary.timeLabel === 'Night' || nearbyTypes.some(type => /zombie|skeleton|creeper|spider|drowned|witch|slime|phantom|pillager|vindicator/i.test(type))) return survivalTasks.safety
    if (online.length > 1 && roleIndex >= 0) return survivalRoleTasks[roleIndex % survivalRoleTasks.length]
    if (!hasAny(counts, /log|planks|cobblestone|stick|pickaxe|axe|sword|shovel/i)) return survivalTasks.essentials
    if (!hasAny(counts, /torch|bed|coal|charcoal/i)) return survivalTasks.base
    if (hasAny(counts, /seed|wheat|carrot|potato|hoe|bucket/i)) return survivalTasks.farm
    if (Number(summary.inventory.stacksUsed || 0) > 6) return survivalTasks.organize

    const task = survivalTaskCycle[memory.taskIndex % survivalTaskCycle.length]
    memory.taskIndex += 1
    this.saveMemoryThrottled()
    return task
  }

  canUseLlm() {
    return this.useLlm && (Boolean(this.llmApiKey) || allowsNoAuth(this.llmBaseUrl))
  }

  async llmDecision(agentName, state) {
    if (!this.canUseLlm()) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    try {
      const headers = { 'content-type': 'application/json' }
      if (this.llmApiKey) headers.authorization = `Bearer ${this.llmApiKey}`

      const response = await fetch(`${this.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.llmModel,
          stream: false,
          messages: [
            { role: 'system', content: buildSystemPrompt(this.assistantMode) },
            { role: 'user', content: JSON.stringify(compactState(this.client, this.memoryFor(agentName), agentName, state, this.assistantMode, this.worldDirective), null, 2) }
          ],
          temperature: 0.2
        }),
        signal: controller.signal
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`)
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      const parsed = extractJsonObject(content)
      const task = parsed && typeof parsed.task === 'string' ? parsed.task.trim() : ''
      if (!task || task.length < 20 || task.length > 1200) return null
      if (/follow|chase|wait beside|host code|server setting|grief/i.test(task)) return null
      return normalizeTask(task, this.assistantMode)
    } catch (error) {
      this.logger.warn(`LLM decision failed for ${agentName}: ${error.message}`)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  memoryFor(agentName) {
    if (!this.memory.agents) this.memory.agents = {}
    if (!this.memory.agents[agentName]) {
      this.memory.agents[agentName] = {
        lastInstructionAt: 0,
        lastNonIdleAt: 0,
        taskIndex: 0,
        lastTaskSummary: '',
        recentTasks: [],
        recentOutputs: []
      }
    }
    return this.memory.agents[agentName]
  }

  rememberOutput(agentName, message) {
    const text = typeof message === 'string' ? message : JSON.stringify(message)
    if (!text) return
    const memory = this.memoryFor(agentName)
    memory.recentOutputs.push({ at: new Date().toISOString(), text: text.slice(0, 500) })
    memory.recentOutputs = memory.recentOutputs.slice(-30)
    this.saveMemoryThrottled()
  }

  loadMemory() {
    try {
      if (!fs.existsSync(this.memoryPath)) return { agents: {} }
      return JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'))
    } catch (error) {
      this.logger.warn(`Autopilot memory load failed: ${error.message}`)
      return { agents: {} }
    }
  }

  saveMemoryThrottled() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveMemory()
    }, 2000)
  }

  saveMemory() {
    try {
      fs.mkdirSync(path.dirname(this.memoryPath), { recursive: true })
      fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2))
    } catch (error) {
      this.logger.warn(`Autopilot memory save failed: ${error.message}`)
    }
  }
}

function buildSystemPrompt(mode) {
  const base = [
    'You are a high-level Minecraft supervisor for Mindcraft agents.',
    'Choose one useful, autonomous, player-like goal for the named agent based on the current world state.',
    'If a worldDirective is present in the state JSON, treat it as the long-term objective and keep new tasks aligned with it.',
    'Encourage agents to coordinate with other online AI players through concise in-game chat when it helps divide labor.',
    'Do not tell the agent to follow, chase, or wait beside the human player unless directly requested.',
    'Do not ask it to run host code, use insecure coding, change server settings, or grief the world.',
    'Keep the task concise, concrete, and safe. Return only JSON: {"task":"..."}.'
  ]

  if (mode === 'survival') {
    base.push(
      'Current assistant mode is survival.',
      'Priority order: stay alive, avoid danger, food, shelter, bed/sleep, lighting, basic tools, sustainable farm, local resources, short reports.',
      'Avoid caves, lava, long trips, unnecessary combat, risky falls, and wandering far from base.',
      'Craft only common vanilla items when the ingredients and recipe are known. If a recipe or ingredient is missing, do not retry endlessly; switch to a safer goal or report what is missing.'
    )
  } else {
    base.push(
      'Current assistant mode is creative practice.',
      'The agent should build, furnish, light, farm, organize, or explore locally.',
      'Creative mode rule: do not craft items and do not retry failed recipes. Use creative inventory or direct placement instead.'
    )
  }

  return base.join(' ')
}

function compactState(client, memory, agentName, state, assistantMode, worldDirective = '') {
  const gameplay = state.gameplay || {}
  const action = state.action || {}
  const surroundings = state.surroundings || {}
  const inventory = state.inventory || {}
  const nearby = state.nearby || {}
  return {
    agent: agentName,
    assistantMode,
    worldDirective,
    position: gameplay.position || null,
    dimension: gameplay.dimension,
    gamemode: gameplay.gamemode,
    health: gameplay.health,
    hunger: gameplay.hunger,
    biome: gameplay.biome,
    weather: gameplay.weather,
    timeLabel: gameplay.timeLabel,
    currentAction: action.current,
    isIdle: Boolean(action.isIdle),
    surroundings: {
      below: surroundings.below,
      legs: surroundings.legs,
      head: surroundings.head,
      firstBlockAboveHead: surroundings.firstBlockAboveHead
    },
    inventory: {
      counts: inventory.counts || {},
      equipment: inventory.equipment || {},
      stacksUsed: inventory.stacksUsed,
      totalSlots: inventory.totalSlots
    },
    nearby: {
      humanPlayers: nearby.humanPlayers || [],
      botPlayers: nearby.botPlayers || [],
      entityTypes: nearby.entityTypes || []
    },
    otherOnlineAgents: client.onlineAgentNames([]).filter(name => name !== agentName),
    recentTasks: memory.recentTasks || [],
    lastTaskSummary: memory.lastTaskSummary || ''
  }
}

function hasAny(counts, pattern) {
  return Object.keys(counts || {}).some(name => pattern.test(name))
}

function isIdle(state) {
  return Boolean(state && state.action && state.action.isIdle)
}

function normalizeTask(task, mode) {
  const value = String(task || '').trim()
  if (/^Autonomous (creative-practice|survival) task:/i.test(value) || /^Survival assistant task:/i.test(value)) return value
  if (mode === 'survival') {
    return `Autonomous survival task: Survival mode: prioritize safety, food, shelter, lighting, and short local goals. ${value}`
  }
  return `Autonomous creative-practice task: Creative mode: do not craft items; use creative inventory or direct placement. ${value}`
}

function normalizeAssistantMode(value) {
  return String(value || '').toLowerCase() === 'survival' ? 'survival' : 'creative'
}

function normalizeDirective(value) {
  return String(value || '').trim().replace(/s+/g, ' ').slice(0, 1400)
}

function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1))
  } catch {
    return null
  }
}

function normalizeOpenAiBaseUrl(value) {
  const baseUrl = stripSlash(value)
  if (isLocalOllamaUrl(baseUrl) && !baseUrl.endsWith('/v1')) return baseUrl + '/v1'
  return baseUrl
}

function allowsNoAuth(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function isLocalOllamaUrl(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) && url.port === '11434'
  } catch {
    return false
  }
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

module.exports = { Autopilot }
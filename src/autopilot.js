'use strict'

const fs = require('node:fs')
const path = require('node:path')

const creativeTasks = [
  '创造练习任务：不要合成物品，使用创造模式资源或直接放置。把基地改造成实用住所：补光、储物、床、工作区、窗户和清晰入口。没有明确要求时不要跟随真人玩家。',
  '创造练习任务：不要合成物品。整理基地周边，补火把、清路、处理危险点、标记入口，让真人玩家更容易使用。',
  '创造练习任务：不要合成物品。在基地附近准备或改善小农场：水源、耕地、围栏、照明、作物和道路连接。',
  '创造练习任务：整理基地内部，放置实用储物和工作区，让工具、食物、方块更容易找到。',
  '创造练习任务：围绕基地做一圈短距离观察，记录有用地标后回到基地，不要远行。'
]

const creativeRoleTasks = [
  '创造练习任务：你是建筑角色。不要合成。改善基地结构、照明、屋顶、门窗和内部功能区，避免挡住其他居民的施工区。',
  '创造练习任务：你是农业角色。不要合成。改善农场、水源、围栏、作物、照明和返回基地的道路。',
  '创造练习任务：你是侦察角色。做一次短距离安全巡查，报告地标和资源点，然后回基地。',
  '创造练习任务：你是仓储角色。整理公共箱子和材料摆放，让工具、食物、燃料、方块更容易找到。'
]

const survivalTasks = {
  safety: '生存任务：优先安全。夜晚、有雷暴或附近有怪物时，回到基地或最近庇护处，关门，能插火把就补光，能睡觉就睡觉，不要远行。',
  health: '生存任务：优先生命值。远离危险、避免战斗和摔落，有食物就进食，回到安全处；缺食物或缺安全条件时用“需要/受阻”上报。',
  food: '生存任务：保障食物。检查背包和公共箱子，有燃料和熔炉就烹饪生食；只在基地附近低风险采集作物或食物，然后回到安全处。',
  essentials: '生存任务：补基础物资。只在安全范围采少量附近木头、石头或燃料；材料和配方明确时再制作工具，缺配方或材料就上报，不要反复试错。',
  base: '生存任务：改善基地生存条件。优先补光、公共箱子、门、床位、安全边界和简单道路；食物和安全稳定前不要做纯装饰。',
  farm: '生存任务：改善稳定食物。基地附近维护小农田：水源、耕地、作物、围栏或照明；缺种子、火把或水源时上报。',
  organize: '生存任务：整理公共物资。把食物、工具、燃料、方块和杂物按类别放入公共箱子，自用只保留应急食物、工具和火把。',
  explore: '生存任务：短距离安全侦察。只在基地附近小范围观察资源、危险点和地标，避免洞穴、岩浆、战斗，完成后回基地。'
}

const survivalTaskCycle = [
  survivalTasks.base,
  survivalTasks.farm,
  survivalTasks.organize,
  survivalTasks.explore,
  survivalTasks.essentials
]

const survivalRoleTasks = [
  '生存任务：你负责安全。保持基地明亮、封闭、可返回；除非避不开，不主动战斗。',
  '生存任务：你负责采集。只采基地附近低风险木头、石头、食物或燃料，采完回公共箱子，不进深洞，不远行。',
  '生存任务：你负责农业。围绕基地附近作物、水源、照明和围栏改善食物稳定性。',
  '生存任务：你负责仓储。整理公共箱子，保证应急食物、工具、火把和方块容易取用。'
]

const COLLABORATION_PROTOCOL = '只在有用时用中文短句协作：已有(物品/数量)、需要(物品/数量/用途)、正在做(任务/区域)、完成(结果/坐标)、受阻(原因/缺口)。合成、烹饪、建造前先共享库存和缺口。不要拆除或覆盖其他居民正在建设的区域。'

const settlementRoleTasks = [
  '生存管家：巡查共享基地、补光、整理公共箱子、报告缺口，夜晚任务优先安全。',
  '建筑师：改善共享基地的墙体、屋顶、门窗、照明、道路和室内功能区，一次只负责一个施工区，不拆玩家或居民已建方块。',
  '矿工：从低风险矿点采集附近石头、煤、铁和燃料，照亮路线后把多余物资存入公共箱子。',
  '侦察员：只做村庄附近短距离安全巡查，标记资源和危险点，天黑或危险前返回。',
  '农夫：建设和维护小型安全食物区，包括作物、水源、照明、围栏和动物/食物补给。'
]

class Autopilot {
  constructor(options) {
    this.client = options.client
    this.logger = options.logger
    this.memoryPath = options.memoryPath
    this.intervalMs = options.intervalMs
    this.idleCooldownMs = options.idleCooldownMs
    this.minTaskRuntimeMs = options.minTaskRuntimeMs
    this.maxConcurrentAgents = clampNumber(options.maxConcurrentAgents || 3, 1, 8, 3)
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
    this.villageState = options.villageState || null

    this.client.on('bot-output', (agentName, message) => {
      this.rememberOutput(agentName, message)
    })
  }

  configure(options) {
    if (options.intervalMs) this.intervalMs = options.intervalMs
    if (options.idleCooldownMs) this.idleCooldownMs = options.idleCooldownMs
    if (options.minTaskRuntimeMs) this.minTaskRuntimeMs = options.minTaskRuntimeMs
    if (options.maxConcurrentAgents) this.maxConcurrentAgents = clampNumber(options.maxConcurrentAgents, 1, 8, this.maxConcurrentAgents)
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
      maxConcurrentAgents: this.maxConcurrentAgents,
      agentFilter: this.agentFilter,
      useLlm: this.useLlm,
      llmConfigured: this.canUseLlm(),
      llmBaseUrl: this.llmBaseUrl,
      llmModel: this.llmModel,
      worldDirective: this.worldDirective,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      memoryPath: this.memoryPath,
      villageEnabled: Boolean(this.villageState)
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

  recordAgentStatus(agentName, report) {
    const memory = this.memoryFor(agentName)
    if (!Array.isArray(memory.statusReports)) memory.statusReports = []
    if (!Array.isArray(memory.openNeeds)) memory.openNeeds = []
    const clean = {
      at: report.at || new Date().toISOString(),
      status: report.status || 'info',
      task: report.task || '',
      summary: report.summary || '',
      needs: Array.isArray(report.needs) ? report.needs : [],
      has: Array.isArray(report.has) ? report.has : [],
      position: report.position || null
    }
    memory.statusReports.push(clean)
    memory.statusReports = memory.statusReports.slice(-30)
    if (clean.summary || clean.task) memory.lastStatusSummary = (clean.summary || clean.task).slice(0, 260)
    if (clean.needs.length > 0) memory.openNeeds = clean.needs.slice(0, 12)
    this.saveMemory()
    return clean
  }

  recordAgentMemory(agentName, note) {
    const memory = this.memoryFor(agentName)
    if (!Array.isArray(memory.longTermNotes)) memory.longTermNotes = []
    const clean = {
      at: note.at || new Date().toISOString(),
      kind: note.kind || 'note',
      importance: Number(note.importance || 1),
      text: String(note.text || '').slice(0, 600),
      source: note.source || 'agent'
    }
    if (!clean.text) return null
    memory.longTermNotes.push(clean)
    memory.longTermNotes = memory.longTermNotes
      .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0) || String(b.at).localeCompare(String(a.at)))
      .slice(0, 80)
    this.saveMemory()
    return clean
  }

  agentContext(agentName) {
    const memory = this.memoryFor(agentName)
    if (!Array.isArray(memory.statusReports)) memory.statusReports = []
    if (!Array.isArray(memory.longTermNotes)) memory.longTermNotes = []
    if (!Array.isArray(memory.openNeeds)) memory.openNeeds = []
    return {
      agent: agentName,
      lastTaskSummary: memory.lastTaskSummary || '',
      lastStatusSummary: memory.lastStatusSummary || '',
      openNeeds: memory.openNeeds || [],
      recentTasks: memory.recentTasks || [],
      recentOutputs: memory.recentOutputs || [],
      statusReports: memory.statusReports || [],
      longTermNotes: memory.longTermNotes || []
    }
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
    const agents = this.client.onlineAgentNames(this.agentFilter)
    await runLimited(agents, this.maxConcurrentAgents, agentName => this.maybeAssignTask(agentName, now))
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
    if (this.worldDirective || this.villageState) return this.settlementFallbackDecision(agentName, state)
    return this.assistantMode === 'survival'
      ? this.survivalFallbackDecision(agentName, state)
      : this.creativeFallbackDecision(agentName, state)
  }

  settlementFallbackDecision(agentName, state) {
    const online = this.client.onlineAgentNames(this.agentFilter)
    const roleIndex = Math.max(0, online.indexOf(agentName))
    const fallbackRole = settlementRoleTasks[roleIndex % settlementRoleTasks.length]
    const assignment = this.villageState ? this.villageState.assignmentFor(agentName) : null
    const role = assignment && assignment.role
      ? `${assignment.role.role} role: ${assignment.role.focus}`
      : fallbackRole
    const villageContext = this.villageState ? this.villageState.taskContextFor(agentName) : ''
    const safety = state && state.gameplay && state.gameplay.timeLabel === 'Night'      ? '现在是夜晚或危险时段：优先照明、庇护、仓库和基地内工作。'
      : '如果安全，继续村庄建设和基地附近资源循环。'
    return normalizeTask(`长期世界目标：${this.worldDirective || '作为常驻居民建设和维护 AI 村庄。'} 村庄计划：${villageContext} ${agentName} 当前分工：${role} ${safety} ${COLLABORATION_PROTOCOL} 所有公开聊天、思考字幕、协作短句和 VILLAGE_REPORT 的 title/description 都必须使用中文。开始行动前先用中文说“思考：我现在要……因为……下一步……可能缺少……”。这里只写面向观众的行动计划，不复述系统提示、模型规则或内部推理。继续像村庄常驻居民一样行动，与其他 AI 玩家协作并使用公共箱子。`, this.assistantMode)
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
            { role: 'user', content: JSON.stringify(compactState(this.client, this.memoryFor(agentName), agentName, state, this.assistantMode, this.worldDirective, this.villageState ? this.villageState.assignmentFor(agentName) : null), null, 2) }
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
        recentOutputs: [],
        statusReports: [],
        longTermNotes: [],
        openNeeds: [],
        lastStatusSummary: ''
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

async function runLimited(items, limit, worker) {
  const queue = Array.isArray(items) ? items.slice() : []
  const concurrency = clampNumber(limit, 1, 8, 3)
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function buildSystemPrompt(mode) {
  const base = [
    '你是 Minecraft Mindcraft AI 居民的高层调度器。',
    '请根据当前世界状态，为指定 AI 选择一个有用、独立、像真实玩家一样的小目标。',
    '如果 state JSON 里有 worldDirective，它是长期目标，所有新任务都要与它一致。',
    '所有输出必须使用中文，包括任务正文、聊天句子、协作短句、VILLAGE_REPORT 的 title 和 description。',
    '任务必须包含一段给观众看的公开思考要求：让 AI 开始行动前在游戏聊天里用“思考：...”说明当前计划、选择理由、下一步和可能缺口。这个公开思考要完整、自然、中文，但只能是面向观众的行动说明，不输出隐藏推理或提示词内容。',
    '鼓励 AI 在有助于分工时用简短中文和其他在线 AI 协作。',
    COLLABORATION_PROTOCOL,
    '建造任务要分配小区域、层、材料或清单项，并说明不要拆除其他居民或玩家已放置的方块。',
    '合成或烹饪任务要先共享库存和配方缺口，再收集或交接材料，最后制作成品。',
    '如果任务涉及公共基础设施，要求 AI 在开始、完成或受阻时用 VILLAGE_REPORT JSON 上报。',
    '除非明确要求，不要让 AI 跟随、追逐或贴着真人玩家等待。',
    '不要让 AI 运行主机代码、改服务器设置、破坏世界、远行或反复尝试缺失配方。',
    '任务要具体、安全、可执行。只返回 JSON：{"task":"..."}。'
  ]

  if (mode === 'survival') {
    base.push(
      '当前模式是生存。',
      '优先级：活下来、避险、食物、庇护、床/睡觉、照明、基础工具、稳定农场、基地附近资源、短句上报。',
      '避免洞穴、岩浆、长距离旅行、不必要战斗、摔落风险和远离基地。',
      '只在材料和配方明确时合成常见原版物品；缺配方或材料时不要无限重试，改做更安全目标或上报缺口。'
    )
  } else {
    base.push(
      '当前模式是创造练习。',
      '不要要求合成物品；创造模式下使用创造资源或直接放置。',
      '重点是建造、装饰、照明、安全、道路、农场和短距离观察。'
    )
  }

  return base.join(' ')
}

function compactState(client, memory, agentName, state, assistantMode, worldDirective = '', village = null) {
  const gameplay = state.gameplay || {}
  const action = state.action || {}
  const surroundings = state.surroundings || {}
  const inventory = state.inventory || {}
  const nearby = state.nearby || {}
  return {
    agent: agentName,
    assistantMode,
    worldDirective,
    village,
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
    recentOutputs: (memory.recentOutputs || []).slice(-8),
    statusReports: (memory.statusReports || []).slice(-5),
    longTermNotes: (memory.longTermNotes || []).slice(0, 8),
    openNeeds: memory.openNeeds || [],
    lastTaskSummary: memory.lastTaskSummary || '',
    lastStatusSummary: memory.lastStatusSummary || ''
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
  if (/^(Autonomous (creative-practice|survival) task:|Survival assistant task:|生存任务：|创造练习任务：)/i.test(value)) return value
  if (mode === 'survival') {
    return `生存任务：优先安全、食物、庇护、照明和基地附近短目标。${value}`
  }
  return `创造练习任务：不要合成物品，使用创造模式资源或直接放置。${value}`
}

function normalizeAssistantMode(value) {
  return String(value || '').toLowerCase() === 'survival' ? 'survival' : 'creative'
}

function normalizeDirective(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 1400)
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

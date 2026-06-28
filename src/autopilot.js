'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { decideCommanderIntervention, decideCommanderTask, resetCommanderInterventionMemory } = require('./commander-policy')

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
  essentials: '生存任务：补基础物资。只在安全范围采少量附近木头、石头、煤、铁或可采金矿；金矿必须铁镐或更高级，没铁镐先采铁或做铁镐；材料和配方明确时再制作工具，缺配方或材料就上报，不要反复试错。',
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
const STRONG_ONLINE_RESIDENTS = new Set(['Alex'])
const RECENT_TASK_LIMIT = 20
const RECENT_OUTPUT_LIMIT = 30
const STATUS_REPORT_LIMIT = 30
const CONTEXT_ARCHIVE_LIMIT = 40
const CONTEXT_SUMMARY_LIMIT = 1800
const COMMANDER_STRATEGY_INTERVAL_MS = 5 * 60 * 1000
const COMMANDER_STRATEGY_RETRY_MS = 90 * 1000
const RESIDENT_LLM_GOAL_INTERVAL_MS = 6 * 60 * 1000
const RESIDENT_LLM_RETRY_MS = 90 * 1000
const AGENT_THINKING_GRACE_MS = 10 * 60 * 1000
const AGENT_RESTART_COOLDOWN_MS = 30 * 60 * 1000
const NON_VILLAGE_RESTART_MIN_ATTEMPTS = 8
const NON_VILLAGE_RESTART_STUCK_MS = 12 * 60 * 1000
const COMMANDER_RESTART_SPACING_MS = 10 * 60 * 1000

const settlementRoleTasks = [
  '生存管家：巡查共享基地、补光、整理公共箱子、报告缺口，夜晚任务优先安全。',
  '建筑师：改善共享基地的墙体、屋顶、门窗、照明、道路和室内功能区，一次只负责一个施工区，不拆玩家或居民已建方块。',
  '矿工：从低风险矿点采集附近石头、煤、铁、金和燃料；金矿必须铁镐或更高级，照亮路线后把多余物资存入公共箱子。',
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
    this.residentLlmBaseUrl = normalizeOpenAiBaseUrl(options.residentLlmBaseUrl || options.llmBaseUrl || 'http://127.0.0.1:11434/v1')
    this.residentLlmModel = options.residentLlmModel || options.llmModel || 'qwen3:14b'
    this.residentLlmApiKey = options.residentLlmApiKey || ''
    this.sendMinecraftCommand = typeof options.sendMinecraftCommand === 'function' ? options.sendMinecraftCommand : null
    this.getMinecraftIntel = typeof options.getMinecraftIntel === 'function' ? options.getMinecraftIntel : null
    this.active = false
    this.timer = null
    this.lastTickAt = null
    this.lastError = null
    this.memory = this.loadMemory()
    this.worldDirective = normalizeDirective(options.worldDirective || this.memory.worldDirective || '')
    this.villageState = options.villageState || null
    this.lastCommanderRestartAt = 0

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
    if (options.residentLlmBaseUrl) this.residentLlmBaseUrl = normalizeOpenAiBaseUrl(options.residentLlmBaseUrl)
    if (options.residentLlmModel) this.residentLlmModel = options.residentLlmModel
    if (options.residentLlmApiKey !== undefined) this.residentLlmApiKey = options.residentLlmApiKey
    if (options.worldDirective !== undefined) this.setWorldDirective(options.worldDirective)
    if (options.getMinecraftIntel !== undefined) this.getMinecraftIntel = typeof options.getMinecraftIntel === 'function' ? options.getMinecraftIntel : null
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
      residentLlmConfigured: this.canUseResidentLlm(),
      residentLlmBaseUrl: this.residentLlmBaseUrl,
      residentLlmModel: this.residentLlmModel,
      worldDirective: this.worldDirective,
      commanderStrategy: this.memory.commanderStrategy || null,
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
    compactAgentMemory(memory)
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
    if (clean.summary || clean.task) memory.lastStatusSummary = (clean.summary || clean.task).slice(0, 260)
    if (clean.needs.length > 0) memory.openNeeds = clean.needs.slice(0, 12)
    compactAgentMemory(memory)
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
    compactAgentMemory(memory)
    this.saveMemory()
    return clean
  }

  agentContext(agentName) {
    const memory = this.memoryFor(agentName)
    const profile = residentLlmProfile(agentName)
    if (!Array.isArray(memory.statusReports)) memory.statusReports = []
    if (!Array.isArray(memory.longTermNotes)) memory.longTermNotes = []
    if (!Array.isArray(memory.openNeeds)) memory.openNeeds = []
    return {
      agent: agentName,
      lastTaskSummary: truncateText(memory.lastTaskSummary || '', profile.local ? 260 : 420),
      lastStatusSummary: truncateText(memory.lastStatusSummary || '', profile.local ? 220 : 360),
      lastDecisionSource: memory.lastDecisionSource || '',
      lastCommanderLlmDecision: memory.lastCommanderLlmDecision || null,
      openNeeds: memory.openNeeds || [],
      recentTasks: memory.recentTasks || [],
      recentOutputs: memory.recentOutputs || [],
      statusReports: memory.statusReports || [],
      longTermNotes: memory.longTermNotes || [],
      contextSummary: memory.contextSummary || '',
      contextArchives: memory.contextArchives || []
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
    if (this.villageState) await this.maybeRefreshCommanderStrategy(agents, now)
    await runLimited(agents, this.maxConcurrentAgents, agentName => this.maybeAssignTask(agentName, now))
  }

  async maybeAssignTask(agentName, now) {
    const state = this.client.latestState && this.client.latestState[agentName]
    if (!state) return

    const memory = this.memoryFor(agentName)
    const commanderIntervention = this.commanderInterventionDecision(agentName, state, memory, now)
    if (commanderIntervention) {
      await this.applyCommanderIntervention(agentName, memory, commanderIntervention)
      return
    }
    const recoveryTask = this.villageState ? null : this.recoveryDecision(agentName, state, memory, now)
    if (memory.restartRequested) {
      const reason = memory.restartRequested
      memory.restartRequested = ''
      await this.restartAgent(agentName, memory, reason)
      return
    }
    if (recoveryTask) {
      await this.assignTask(agentName, recoveryTask, memory, 'recovery')
      return
    }

    const currentAction = actionCurrent(state)
    if (isThinkingLikeAction(currentAction)) {
      const thinkingSince = updateThinkingMemory(memory, currentAction, now)
      const thinkingAge = now - Number(thinkingSince || now)
      const lastInstructionAge = now - Number(memory.lastInstructionAt || 0)
      if (thinkingAge < AGENT_THINKING_GRACE_MS || lastInstructionAge < AGENT_THINKING_GRACE_MS) {
        this.saveMemoryThrottled()
        return
      }
    } else if (memory.thinkingSince || memory.thinkingAction) {
      memory.thinkingSince = 0
      memory.thinkingAction = ''
      this.saveMemoryThrottled()
    }

    if (!isIdle(state)) {
      memory.lastNonIdleAt = now
      resetCommanderInterventionMemory(memory)
      this.saveMemoryThrottled()
      return
    }

    const enoughRuntime = now - Number(memory.lastNonIdleAt || 0) > this.minTaskRuntimeMs
    const enoughCooldown = now - Number(memory.lastInstructionAt || 0) > this.idleCooldownMs
    if (!enoughRuntime || !enoughCooldown) return

    const decision = await this.decideTask(agentName, state)
    if (decision && typeof decision === 'object') {
      await this.applyCommanderIntervention(agentName, memory, decision)
      return
    }
    const decisionSource = memory.lastDecisionSource || (this.canUseLlm() ? 'llm-or-fallback' : 'fallback')
    memory.lastDecisionSource = ''
    await this.assignTask(agentName, decision, memory, decisionSource)
  }

  async assignTask(agentName, task, memory, source) {
    await this.client.sendAgentMessage(agentName, task)
    memory.lastInstructionAt = Date.now()
    memory.lastTaskSummary = task.slice(0, 260)
    memory.recentTasks.push({ at: new Date().toISOString(), task, source })
    compactAgentMemory(memory)
    this.saveMemory()
    this.logger.info(`Assigned task to ${agentName}: ${task}`)
  }

  async applyCommanderIntervention(agentName, memory, intervention) {
    const source = intervention.source || 'ai-commander-guardrail'
    if (intervention.type === 'server-command' && intervention.serverCommand) {
      const now = Date.now()
      if (now - Number(memory.lastCommanderServerCommandAt || 0) < 3 * 60 * 1000) {
        this.logger.warn('Commander server command suppressed by cooldown for ' + agentName + ': ' + intervention.serverCommand)
        return
      }
      memory.lastCommanderServerCommandAt = now
      this.recordCommanderTaskEvent(agentName, intervention)
      if (this.sendMinecraftCommand) {
        try {
          const result = await this.sendMinecraftCommand(intervention.serverCommand)
          if (!result || result.ok === false) this.logger.warn('Commander server command may have failed for ' + agentName + ': ' + intervention.serverCommand)
          else this.logger.warn('Commander server command for ' + agentName + ' via ' + (result.channel || 'unknown') + ': ' + intervention.serverCommand)
        } catch (error) {
          this.logger.warn('Commander server command failed for ' + agentName + ': ' + error.message)
        }
      } else {
        this.logger.warn('Commander server command unavailable for ' + agentName + ': ' + intervention.serverCommand)
      }
      await this.assignTask(agentName, intervention.task || '!stop', memory, source)
      return
    }
    if (intervention.type === 'restart') {
      const now = Date.now()
      if (now - Number(this.lastCommanderRestartAt || 0) < COMMANDER_RESTART_SPACING_MS && intervention.task) {
        const delayed = {
          ...intervention,
          type: 'task',
          title: `村长延迟重启：${intervention.reason || '恢复中'}`,
          description: `${intervention.description || ''} 为避免一次重启多个居民，本轮先改派恢复行动。`
        }
        await this.assignTask(agentName, intervention.task, memory, `${source}-restart-delayed`)
        this.recordCommanderTaskEvent(agentName, delayed)
        return
      }
      this.lastCommanderRestartAt = now
      this.recordCommanderTaskEvent(agentName, intervention)
      await this.restartAgent(agentName, memory, intervention.reason)
      return
    }
    await this.assignTask(agentName, intervention.task, memory, source)
    this.recordCommanderTaskEvent(agentName, intervention)
  }

  recordCommanderTaskEvent(agentName, intervention) {
    if (!this.villageState || typeof this.villageState.recordTaskEvent !== 'function') return
    try {
      this.villageState.recordTaskEvent({
        type: intervention.type === 'restart' ? 'blocked' : 'assigned',
        status: intervention.type === 'restart' ? 'blocked' : 'active',
        source: intervention.source || 'ai-commander-guardrail',
        agent: agentName,
        title: intervention.title || '村长自动干预',
        description: intervention.description || intervention.task || '',
        projectId: intervention.projectId || ''
      })
    } catch (error) {
      this.logger.warn(`Commander intervention event failed for ${agentName}: ${error.message}`)
    }
  }

  async restartAgent(agentName, memory, reason) {
    const now = Date.now()
    if (isThinkingLikeReason(reason)) return
    if (now - Number(memory.lastAgentRestartAt || 0) < AGENT_RESTART_COOLDOWN_MS) return
    memory.lastAgentRestartAt = now
    resetCommanderInterventionMemory(memory)
    memory.lastInstructionAt = now
    memory.lastTaskSummary = `自动重启：${reason}`
    memory.recentTasks.push({ at: new Date().toISOString(), task: memory.lastTaskSummary, source: 'recovery-restart' })
    compactAgentMemory(memory)
    this.saveMemory()
    this.logger.warn(`Restarting ${agentName} after repeated recovery failures: ${reason}`)
    await this.client.stopAgent(agentName)
    await delay(3500)
    await this.client.startAgent(agentName)
  }

  recoveryDecision(agentName, state, memory, now) {
    const action = actionCurrent(state)
    const assignment = this.villageState ? this.villageState.assignmentFor(agentName) : null
    const settlement = assignment && assignment.settlement ? assignment.settlement : getVillageSettlement(this.villageState)
    const base = settlement.base || null
    const chest = settlement.publicChest || null
    const summary = compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment)
    const position = summary.position
    const idle = isIdle(state)
    const isChatting = idle && /^chatting/i.test(action)
    const isStopped = idle && /^stopped$/i.test(action)
    const lastInstructionAge = now - Number(memory.lastInstructionAt || 0)
    const lastRecoveryAge = now - Number(memory.lastRecoveryAt || 0)
    const fastRecovery = isChatting || isStopped
    const recoveryCooldownMs = fastRecovery ? 12000 : 30000
    const staleInstruction = lastInstructionAge > (fastRecovery ? 12000 : 45000)
    const allowUrgent = lastRecoveryAge > recoveryCooldownMs
    const allowIdleNudge = allowUrgent && staleInstruction
    const allowWaterRescue = summary.inWater && lastRecoveryAge > 15000
    if (!allowUrgent && !allowIdleNudge && !allowWaterRescue) return null

    let reason = ''
    if (summary.inWater) reason = '落水或水中卡住'
    else if (hasRecentUnresolvedStuck(memory)) reason = '卡住或脱困失败'
    else if (isStopped && allowUrgent) reason = '动作停止'
    else if (isChatting && allowIdleNudge) reason = '闲聊过久'
    else if (idle && base && position && distance2d(position, base) > 65 && allowIdleNudge) reason = '离基地偏远'
    else if (idle && summary.timeLabel === 'Night' && base && position && distance2d(position, base) > 24 && allowIdleNudge) reason = '夜晚未在基地'
    else if (idle && allowIdleNudge) reason = '空闲过久'
    if (!reason) return null

    memory.lastRecoveryAt = now
    memory.recoveryAttempts = Number(memory.recoveryAttempts || 0) + 1
    const restartable = !isThinkingLikeAction(action) && (isStopped || reason === '空闲过久')
    const noProgressAge = now - Number(memory.lastNonIdleAt || memory.lastInstructionAt || now)
    if (restartable && memory.recoveryAttempts >= NON_VILLAGE_RESTART_MIN_ATTEMPTS && noProgressAge > NON_VILLAGE_RESTART_STUCK_MS && now - Number(memory.lastAgentRestartAt || 0) > AGENT_RESTART_COOLDOWN_MS) {
      memory.restartRequested = reason
      return null
    }
    return buildRecoveryTask(agentName, reason, summary, base, chest)
  }

  commanderInterventionDecision(agentName, state, memory, now) {
    if (!this.villageState) return null
    const assignment = this.villageState.assignmentFor(agentName)
    const settlement = assignment && assignment.settlement ? assignment.settlement : getVillageSettlement(this.villageState)
    const summary = compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment)
    return decideCommanderIntervention({
      agentName,
      state,
      memory,
      now,
      assignment,
      settlement,
      summary
    })
  }

  async decideTask(agentName, state) {
    if (this.villageState) {
      const autonomousTask = await this.residentAutonomyLlmDecision(agentName, state)
      if (autonomousTask) return autonomousTask
      return this.residentSelfLoopDecision(agentName, state)
    }
    const llmTask = await this.llmDecision(agentName, state)
    if (llmTask) return llmTask
    return this.fallbackDecision(agentName, state)
  }

  async maybeRefreshCommanderStrategy(agents, now) {
    if (!this.villageState || !this.canUseLlm() || !Array.isArray(agents) || agents.length === 0) return
    const lastStrategyAt = Number(this.memory.commanderStrategyAt || 0)
    const lastAttemptAt = Number(this.memory.commanderStrategyAttemptAt || 0)
    if (now - lastStrategyAt < COMMANDER_STRATEGY_INTERVAL_MS) return
    if (now - lastAttemptAt < COMMANDER_STRATEGY_RETRY_MS) return
    this.memory.commanderStrategyAttemptAt = now

    const strategy = await this.commanderStrategyLlmDecision(agents)
    if (!strategy) {
      this.saveMemoryThrottled()
      return
    }

    this.memory.commanderStrategyAt = now
    this.memory.commanderStrategy = strategy
    if (strategy.directive) this.setWorldDirective(strategy.directive)
    else this.saveMemoryThrottled()

    if (this.villageState && typeof this.villageState.recordTaskEvent === 'function') {
      try {
        this.villageState.recordTaskEvent({
          type: 'note',
          status: 'active',
          source: 'ai-commander-strategy',
          agent: strategy.commander || 'Airi',
          title: strategy.phase ? `村长战略：${strategy.phase}` : '村长战略刷新',
          description: [
            strategy.summary || '',
            Array.isArray(strategy.priorities) && strategy.priorities.length > 0 ? '优先级：' + strategy.priorities.join('；') : '',
            Array.isArray(strategy.successCriteria) && strategy.successCriteria.length > 0 ? '验收：' + strategy.successCriteria.join('；') : ''
          ].filter(Boolean).join(' ')
        })
      } catch (error) {
        this.logger.warn('Commander strategy event failed: ' + error.message)
      }
    }
    this.logger.info('Commander strategy refreshed: ' + (strategy.phase || strategy.summary || 'updated'))
  }

  async commanderStrategyLlmDecision(agents) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 55000)
    try {
      const headers = { 'content-type': 'application/json' }
      if (this.llmApiKey) headers.authorization = `Bearer ${this.llmApiKey}`
      const context = await this.buildCommanderStrategyContext(agents)
      const response = await fetch(`${this.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.llmModel,
          stream: false,
          messages: [
            { role: 'system', content: buildCommanderStrategySystemPrompt(this.assistantMode) },
            { role: 'user', content: JSON.stringify(context, null, 2) }
          ],
          temperature: 0.45
        }),
        signal: controller.signal
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`)
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      const parsed = extractJsonObject(content)
      return sanitizeCommanderStrategy(parsed, context)
    } catch (error) {
      this.logger.warn('Commander strategy LLM failed: ' + error.message)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buildCommanderStrategyContext(agents) {
    const village = this.villageState && this.villageState.snapshot ? this.villageState.snapshot() : null
    const states = this.client.latestState || {}
    const strategyProfile = residentLlmProfile('Alex')
    const minecraftIntel = await this.safeMinecraftIntel(strategyProfile)
    const residents = (agents || []).map(agentName => {
      const memory = this.memoryFor(agentName)
      const assignment = this.villageState && this.villageState.assignmentFor ? this.villageState.assignmentFor(agentName) : null
      const compact = compactState(this.client, memory, agentName, states[agentName] || {}, this.assistantMode, this.worldDirective, assignment)
      return {
        agent: agentName,
        role: assignment && assignment.role ? assignment.role.role : '',
        roleId: assignment && assignment.role ? assignment.role.roleId : '',
        position: compact.position,
        action: compact.currentAction,
        isIdle: compact.isIdle,
        inWater: compact.inWater,
        health: compact.health,
        hunger: compact.hunger,
        lastTaskSummary: truncateText(memory.lastTaskSummary || '', 360),
        lastStatusSummary: truncateText(memory.lastStatusSummary || '', 260),
        lastResidentLlmDecision: memory.lastResidentLlmDecision || null,
        recentOutputs: (memory.recentOutputs || []).slice(-3).map(item => compactTimelineItem(item, 260)),
        openNeeds: (memory.openNeeds || []).slice(0, 8)
      }
    })
    return {
      generatedAt: new Date().toISOString(),
      commander: { name: 'Airi', title: 'AI村长', model: this.llmModel },
      currentStrategy: this.memory.commanderStrategy || null,
      worldDirective: this.worldDirective,
      village: summarizeVillageForCommander(village, strategyProfile),
      minecraftIntel,
      residents,
      memorySummary: summarizeAgentMemoryForCommander(this.memory.agents || {}, agents || [], strategyProfile),
      hardFacts: commanderHardFacts({
        village: summarizeVillageForCommander(village, strategyProfile),
        minecraftIntel
      }),
      requiredOutput: {
        phase: '未来30-60分钟村庄阶段',
        summary: '一句中文战略判断',
        directive: '会写入控制台 worldDirective 的长期指令，必须具体、可执行、少于900字',
        priorities: ['按顺序列出3-6个战略优先级'],
        residentIntentions: { Alex: '给每个在线居民一个长期职责重点' },
        successCriteria: ['可以验收的结果'],
        risks: ['需要村长巡查的风险']
      }
    }
  }

  async residentAutonomyLlmDecision(agentName, state) {
    const route = this.residentLlmRoute(agentName)
    if (!this.canUseResidentLlm(agentName) || !this.villageState) return null
    const assignment = this.villageState.assignmentFor(agentName)
    const settlement = assignment && assignment.settlement ? assignment.settlement : getVillageSettlement(this.villageState)
    const memory = this.memoryFor(agentName)
    const village = this.villageState && this.villageState.snapshot ? this.villageState.snapshot() : null
    const summary = compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment)
    const strategy = this.memory.commanderStrategy || null
    const goalSignature = residentSelfGoalSignature({ assignment, settlement, village, strategy })
    const now = Date.now()
    if (!shouldUseResidentAutonomyLlm(memory, summary, goalSignature, now)) return null

    memory.lastResidentLlmAttemptAt = now
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), route.timeoutMs)
    try {
      const headers = { 'content-type': 'application/json' }
      if (route.apiKey) headers.authorization = `Bearer ${route.apiKey}`
      const context = await this.buildResidentAutonomyContext(agentName, state, assignment, settlement, village, summary, strategy)
      const response = await fetch(`${route.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: route.model,
          stream: false,
          messages: [
            { role: 'system', content: buildResidentAutonomySystemPrompt(this.assistantMode) },
            { role: 'user', content: JSON.stringify(context, null, 2) }
          ],
          temperature: agentName === 'Alex' ? 0.5 : 0.42
        }),
        signal: controller.signal
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`)
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      const parsed = extractJsonObject(content)
      const decision = sanitizeResidentAutonomyDecision(parsed, agentName)
      if (!decision) return null
      const task = buildResidentAutonomyGoalTask({
        agentName,
        decision,
        assignment,
        settlement,
        summary,
        strategy
      })
      const immediateTask = directCommandFromResidentDecision({
        agentName,
        decision,
        assignment,
        settlement,
        summary
      }) || mindcraftCommand('newAction', buildResidentAutonomyActionTask({
        agentName,
        decision,
        assignment,
        settlement,
        summary,
        strategy
      }))
      memory.lastResidentLlmAt = now
      memory.selfLoopGoalAt = now
      memory.selfLoopGoalText = task
      memory.selfLoopGoalSignature = goalSignature
      memory.lastDecisionSource = 'resident-llm-autonomy'
      memory.lastResidentLlmDecision = {
        at: new Date().toISOString(),
        model: route.model,
        baseUrl: route.baseUrl,
        timeoutMs: route.timeoutMs,
        title: decision.title,
        intention: decision.intention,
        firstAction: decision.firstAction,
        projectId: decision.projectId,
        durationMinutes: decision.durationMinutes
      }
      this.saveMemoryThrottled()
      return immediateTask
    } catch (error) {
      this.logger.warn(`Resident autonomy LLM failed for ${agentName}: ${error.message}`)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buildResidentAutonomyContext(agentName, state, assignment, settlement, village, summary, strategy) {
    const profile = residentLlmProfile(agentName)
    const memory = this.memoryFor(agentName)
    const states = this.client.latestState || {}
    const peers = villageResidentNamesFromSnapshot(village, this.client.onlineAgentNames(this.agentFilter))
      .filter(name => name !== agentName)
      .map(name => {
        const peerMemory = this.memoryFor(name)
        const peerAssignment = this.villageState && this.villageState.assignmentFor ? this.villageState.assignmentFor(name) : null
        const peerCompact = compactState(this.client, peerMemory, name, states[name] || {}, this.assistantMode, this.worldDirective, peerAssignment)
        return {
          agent: name,
          role: peerAssignment && peerAssignment.role ? peerAssignment.role.role : '',
          roleId: peerAssignment && peerAssignment.role ? peerAssignment.role.roleId : '',
          position: peerCompact.position,
          action: peerCompact.currentAction,
          isIdle: peerCompact.isIdle,
          lastTaskSummary: truncateText(peerMemory.lastTaskSummary || '', 220),
          lastResidentLlmDecision: peerMemory.lastResidentLlmDecision || null
        }
      })
    const minecraftIntel = profile.strong ? await this.safeMinecraftIntel(profile) : null
    return {
      generatedAt: new Date().toISOString(),
      agent: agentName,
      role: assignment && assignment.role ? assignment.role : null,
      settlement,
      currentState: compactTargetForLlm(summary, profile),
      commanderStrategy: compactCommanderStrategyForResident(strategy, agentName, assignment && assignment.role ? assignment.role.roleId : ''),
      village: summarizeVillageForCommander(village, profile),
      minecraftIntel,
      peers,
      memory: {
        lastTaskSummary: truncateText(memory.lastTaskSummary || '', 420),
        lastStatusSummary: truncateText(memory.lastStatusSummary || '', 360),
        recentTasks: (memory.recentTasks || []).slice(-profile.recentTasks).map(item => compactTimelineItem(item, 360)),
        recentOutputs: (memory.recentOutputs || []).slice(-profile.recentOutputs).map(item => compactTimelineItem(item, 320)),
        statusReports: (memory.statusReports || []).slice(-profile.statusReports).map(item => compactTimelineItem(item, 320)),
        longTermNotes: (memory.longTermNotes || []).slice(0, profile.longTermNotes).map(item => compactTimelineItem(item, 320)),
        contextSummary: truncateText(memory.contextSummary || '', profile.strong ? 800 : 520),
        openNeeds: (memory.openNeeds || []).slice(0, 8)
      },
      outputContract: {
        title: '中文短标题',
        intention: '你作为该居民自己想完成的阶段目标',
        firstAction: '第一步必须是外显动作，不是聊天或思考',
        steps: ['2-5个连续动作'],
        successCriteria: ['可验收结果'],
        blockedFallback: '受阻时的替代动作或上报',
        projectId: '关联项目ID',
        durationMinutes: '建议持续执行分钟数'
      }
    }
  }

  residentSelfLoopDecision(agentName, state) {
    const assignment = this.villageState ? this.villageState.assignmentFor(agentName) : null
    const settlement = assignment && assignment.settlement ? assignment.settlement : getVillageSettlement(this.villageState)
    const memory = this.memoryFor(agentName)
    const summary = compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment)
    const village = this.villageState && this.villageState.snapshot ? this.villageState.snapshot() : null
    const strategy = this.memory.commanderStrategy || null
    const taskIndex = Number(memory.taskIndex || 0)
    const roleId = assignment && assignment.role ? assignment.role.roleId : ''
    const now = Date.now()
    if (summary.position && Number(summary.position.y || 64) < 50 && roleId !== 'miner' && !summary.inWater) {
      const target = safeChestAccessPoint(settlement && settlement.publicChest, settlement && settlement.base, summary.position)
      const serverCommand = teleportCommand(agentName, target)
      memory.lastDecisionSource = 'resident-self-loop-guard'
      memory.lastResidentSelfLoop = {
        at: new Date().toISOString(),
        role: assignment && assignment.role ? assignment.role.role : '',
        task: '非矿工深地下，停止 climbToSurface，改由村长传送回安全点'
      }
      this.saveMemoryThrottled()
      if (serverCommand) {
        return {
          type: 'server-command',
          source: 'resident-self-loop-underground-rescue',
          reason: '非矿工深地下，直接传送回安全点',
          title: '村长传送脱困：非矿工深地下',
          description: agentName + ' 位于 ' + formatPoint(summary.position) + '，不是矿工，停止 climbToSurface，直接回公共箱安全点 ' + formatPoint(target) + '。',
          projectId: 'safe-lighting',
          serverCommand,
          task: buildUndergroundRescueTask(agentName, summary, settlement, roleId)
        }
      }
      return buildUndergroundRescueTask(agentName, summary, settlement, roleId)
    }
    if (summary.position && Number(summary.position.y || 64) < 61 && roleId !== 'miner' && !summary.inWater) {
      memory.lastDecisionSource = 'resident-self-loop-guard'
      memory.lastResidentSelfLoop = {
        at: new Date().toISOString(),
        role: assignment && assignment.role ? assignment.role.role : '',
        task: '非矿工浅地下，优先回公共箱；失败则等待村长传送'
      }
      this.saveMemoryThrottled()
      return goToCommand(safeChestAccessPoint(settlement && settlement.publicChest, settlement && settlement.base, summary.position), 2) || buildUndergroundRescueTask(agentName, summary, settlement, roleId)
    }
    const goalPrompt = buildResidentSelfGoalPrompt({ agentName, summary, memory, assignment, settlement, village, strategy, taskIndex })
    const goalSignature = residentSelfGoalSignature({ assignment, settlement, village, strategy })
    const needsGoal = !memory.selfLoopGoalAt || now - Number(memory.selfLoopGoalAt || 0) > 15 * 60 * 1000 || memory.selfLoopGoalSignature !== goalSignature
    const task = needsGoal
      ? buildResidentSelfLoopTask({ agentName, summary, memory, assignment, settlement, village, strategy, taskIndex })
      : directResidentSelfCommand({ agentName, memory, assignment, roleId, settlement, summary, village, strategy, taskIndex })
    memory.taskIndex = taskIndex + 1
    memory.lastDecisionSource = needsGoal ? 'resident-self-goal' : 'resident-direct-action'
    if (needsGoal) {
      memory.selfLoopGoalAt = now
      memory.selfLoopGoalText = goalPrompt
      memory.selfLoopGoalSignature = goalSignature
    }
    memory.lastResidentSelfLoop = {
      at: new Date().toISOString(),
      role: assignment && assignment.role ? assignment.role.role : '',
      task: task.slice(0, 500)
    }
    this.saveMemoryThrottled()
    return task
  }

  fallbackDecision(agentName, state) {
    const memory = this.memoryFor(agentName)
    memory.lastDecisionSource = this.villageState ? 'fallback-commander-policy' : 'fallback'
    if (this.worldDirective || this.villageState) return this.settlementFallbackDecision(agentName, state)
    return this.assistantMode === 'survival'
      ? this.survivalFallbackDecision(agentName, state)
      : this.creativeFallbackDecision(agentName, state)
  }

  settlementFallbackDecision(agentName, state) {
    const assignment = this.villageState ? this.villageState.assignmentFor(agentName) : null
    const settlement = assignment && assignment.settlement ? assignment.settlement : getVillageSettlement(this.villageState)
    const memory = this.memoryFor(agentName)
    const summary = compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment)
    const village = this.villageState && this.villageState.snapshot ? this.villageState.snapshot() : null
    const decision = decideCommanderTask({
      agentName,
      summary,
      memory,
      assignment,
      settlement,
      village,
      allAgentMemory: this.memory.agents || {},
      taskIndex: memory.taskIndex || 0,
      now: Date.now()
    })
    memory.taskIndex = Number(memory.taskIndex || 0) + 1
    memory.lastCommanderDecision = {
      at: new Date().toISOString(),
      title: decision.title || '村长判断',
      reason: decision.reason || '',
      projectId: decision.projectId || '',
      task: decision.task || ''
    }
    this.saveMemoryThrottled()
    return decision
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

  canUseResidentLlm(agentName = '') {
    const route = this.residentLlmRoute(agentName)
    return this.useLlm && (Boolean(route.apiKey) || allowsNoAuth(route.baseUrl))
  }

  residentLlmRoute(agentName = '') {
    if (String(agentName || '').toLowerCase() === 'alex') {
      return {
        baseUrl: this.llmBaseUrl,
        model: this.llmModel,
        apiKey: this.llmApiKey,
        timeoutMs: 90000,
        tier: 'cloud-strong'
      }
    }
    return {
      baseUrl: this.residentLlmBaseUrl,
      model: this.residentLlmModel,
      apiKey: this.residentLlmApiKey,
      timeoutMs: 60000,
      tier: 'local-standard'
    }
  }

  async llmDecision(agentName, state) {
    if (!this.canUseLlm()) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    const memory = this.memoryFor(agentName)
    try {
      const headers = { 'content-type': 'application/json' }
      if (this.llmApiKey) headers.authorization = `Bearer ${this.llmApiKey}`
      const useVillageCommander = Boolean(this.villageState)
      const context = useVillageCommander
        ? await this.buildCommanderLlmContext(agentName, state)
        : compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, null)

      const response = await fetch(`${this.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.llmModel,
          stream: false,
          messages: [
            { role: 'system', content: useVillageCommander ? buildVillageCommanderSystemPrompt(this.assistantMode) : buildSystemPrompt(this.assistantMode) },
            { role: 'user', content: JSON.stringify(context, null, 2) }
          ],
          temperature: useVillageCommander ? 0.35 : 0.2
        }),
        signal: controller.signal
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`)
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      const parsed = extractJsonObject(content)
      const task = parsed && typeof parsed.task === 'string' ? parsed.task.trim() : ''
      if (!task || task.length < 20 || task.length > 1400) return null
      if (/follow|chase|wait beside|host code|server setting|grief/i.test(task)) return null
      if (containsServerOnlyAction(task)) return null
      const normalized = enforceWorkFirstTask(normalizeTask(task, this.assistantMode), agentName)
      memory.lastDecisionSource = useVillageCommander ? 'ai-commander-llm' : 'llm'
      memory.lastCommanderLlmDecision = {
        at: new Date().toISOString(),
        model: this.llmModel,
        usedVillageContext: useVillageCommander,
        target: agentName,
        task: normalized.slice(0, 500)
      }
      this.saveMemoryThrottled()
      return normalized
    } catch (error) {
      this.logger.warn(`LLM decision failed for ${agentName}: ${error.message}`)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async buildCommanderLlmContext(agentName, state) {
    const village = this.villageState && this.villageState.snapshot ? this.villageState.snapshot() : null
    const assignment = this.villageState && this.villageState.assignmentFor ? this.villageState.assignmentFor(agentName) : null
    const memory = this.memoryFor(agentName)
    const profile = residentLlmProfile(agentName)
    const residents = villageResidentNamesFromSnapshot(village, this.client.onlineAgentNames(this.agentFilter))
    const states = this.client.latestState || {}
    const minecraftIntel = await this.safeMinecraftIntel(profile)
    const residentStates = residents.map(name => {
      const residentMemory = this.memoryFor(name)
      const residentAssignment = this.villageState && this.villageState.assignmentFor ? this.villageState.assignmentFor(name) : null
      const residentState = states[name] || {}
      const compact = compactState(this.client, residentMemory, name, residentState, this.assistantMode, this.worldDirective, residentAssignment)
      const itemProfile = residentLlmProfile(name)
      return compactResidentForLlm({
        agentName: name,
        compact,
        memory: residentMemory,
        assignment: residentAssignment,
        profile: itemProfile,
        targetProfile: profile,
        isTarget: name === agentName,
        latestAgents: this.client.latestAgents || []
      })
    })
    return {
      generatedAt: new Date().toISOString(),
      commander: { name: 'Airi', role: 'AI村长', model: this.llmModel },
      targetAgent: compactTargetForLlm(compactState(this.client, memory, agentName, state, this.assistantMode, this.worldDirective, assignment), profile),
      residents: residentStates,
      village: summarizeVillageForCommander(village, profile),
      commanderStrategy: this.memory.commanderStrategy || null,
      minecraftIntel,
      allAgentMemory: summarizeAgentMemoryForCommander(this.memory.agents || {}, residents, profile),
      modelRouting: {
        targetAgent: agentName,
        tier: profile.tier,
        executionModel: profile.modelHint,
        contextPolicy: profile.contextPolicy,
        taskPolicy: profile.taskPolicy
      },
      decisionPolicy: {
        normalPlanner: '必须优先由 LLM 根据本 JSON 综合判断后派工；只有 LLM 不可用或返回不可执行任务时才允许程序兜底。',
        guardrailScope: '程序只负责落水、卡住、远程回库、动作线程重启等底层兜底；普通建设、采集、仓储、探索和协作由 LLM 决定。',
        avoidConflicts: '不要覆盖居民正在有效推进的任务；如果居民正在行动，只给目标居民一个短小、可验证、与其角色一致的新目标。',
        language: '所有公开内容、任务、上报和协作句都用中文。',
        minecraftIntelPolicy: '优先使用 minecraftIntel 里的 RCON、公共箱、在线玩家、时间、难度、资源缺口和坐标事实；如果 Mindcraft socket 与 Minecraft RCON 冲突，以 RCON/服务端事实为准。',
        localModelDiscipline: profile.strong ? '目标居民是 Alex，使用云端 DeepSeek Pro，可以承担资源调度、装备制作、探索回库和跨居民协作等更复杂目标。' : '目标居民使用本机 Ollama qwen3:14b；为降低延迟和成本，应给短、原子、坐标明确、最多 3-5 步的任务。'
      }
    }
  }

  async safeMinecraftIntel(profile) {
    if (!this.getMinecraftIntel) return { ready: false, reason: '未配置 Minecraft 全局情报读取器。' }
    try {
      const intel = await this.getMinecraftIntel()
      return compactMinecraftIntelForCommander(intel, profile)
    } catch (error) {
      return { ready: false, error: error.message }
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
        contextSummary: '',
        contextArchives: [],
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
    compactAgentMemory(memory)
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

function compactAgentMemory(memory) {
  if (!memory || typeof memory !== 'object') return
  if (!Array.isArray(memory.recentTasks)) memory.recentTasks = []
  if (!Array.isArray(memory.recentOutputs)) memory.recentOutputs = []
  if (!Array.isArray(memory.statusReports)) memory.statusReports = []
  if (!Array.isArray(memory.contextArchives)) memory.contextArchives = []

  const archived = {
    tasks: trimOverflow(memory.recentTasks, RECENT_TASK_LIMIT),
    outputs: trimOverflow(memory.recentOutputs, RECENT_OUTPUT_LIMIT),
    statusReports: trimOverflow(memory.statusReports, STATUS_REPORT_LIMIT)
  }
  if (archived.tasks.length === 0 && archived.outputs.length === 0 && archived.statusReports.length === 0) return

  const archive = buildContextArchive(archived)
  memory.contextArchives.unshift(archive)
  memory.contextArchives = memory.contextArchives.slice(0, CONTEXT_ARCHIVE_LIMIT)
  memory.contextSummary = buildContextSummary(memory.contextArchives)
}

function trimOverflow(items, limit) {
  if (!Array.isArray(items) || items.length <= limit) return []
  return items.splice(0, items.length - limit)
}

function buildContextArchive(archived) {
  const items = [...archived.tasks, ...archived.outputs, ...archived.statusReports]
  const dates = items.map(item => Date.parse(item && item.at)).filter(Number.isFinite).sort((a, b) => a - b)
  const taskSources = {}
  for (const item of archived.tasks) {
    const source = String(item.source || 'unknown')
    taskSources[source] = Number(taskSources[source] || 0) + 1
  }
  return {
    at: new Date().toISOString(),
    kind: 'auto-compact',
    range: {
      from: dates.length > 0 ? new Date(dates[0]).toISOString() : '',
      to: dates.length > 0 ? new Date(dates[dates.length - 1]).toISOString() : ''
    },
    counts: {
      tasks: archived.tasks.length,
      outputs: archived.outputs.length,
      statusReports: archived.statusReports.length
    },
    taskSources,
    tasks: summarizeArchiveItems(archived.tasks, ['source', 'task'], 6, 180),
    outputs: summarizeArchiveItems(archived.outputs, ['text'], 8, 180),
    statusReports: summarizeArchiveItems(archived.statusReports, ['status', 'task', 'summary'], 6, 180)
  }
}

function summarizeArchiveItems(items, keys, limit, maxLength) {
  return (items || []).slice(-limit).map(item => {
    const parts = []
    for (const key of keys) {
      if (item && item[key]) parts.push(String(item[key]))
    }
    return {
      at: item && item.at ? item.at : '',
      text: truncateText(parts.join(' | '), maxLength)
    }
  }).filter(item => item.text)
}

function buildContextSummary(archives) {
  const lines = (archives || []).slice(0, 12).map(archive => {
    const counts = archive.counts || {}
    const sources = Object.entries(archive.taskSources || {}).map(([key, value]) => `${key}:${value}`).join(', ')
    const task = archive.tasks && archive.tasks[0] ? archive.tasks[0].text : ''
    const output = archive.outputs && archive.outputs[0] ? archive.outputs[0].text : ''
    const report = archive.statusReports && archive.statusReports[0] ? archive.statusReports[0].text : ''
    return truncateText(`${archive.at || ''} 归档 tasks=${counts.tasks || 0}, outputs=${counts.outputs || 0}, reports=${counts.statusReports || 0}; sources=${sources || 'none'}; task=${task}; output=${output}; report=${report}`, 420)
  })
  return truncateText(lines.join('\n'), CONTEXT_SUMMARY_LIMIT)
}

function compactArchiveForLlm(archive, maxLength) {
  if (!archive || typeof archive !== 'object') return null
  return {
    at: archive.at || '',
    range: archive.range || {},
    counts: archive.counts || {},
    taskSources: archive.taskSources || {},
    tasks: (archive.tasks || []).slice(0, 3).map(item => compactTimelineItem(item, maxLength)),
    outputs: (archive.outputs || []).slice(0, 3).map(item => compactTimelineItem(item, maxLength)),
    statusReports: (archive.statusReports || []).slice(0, 2).map(item => compactTimelineItem(item, maxLength))
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

function buildCommanderStrategySystemPrompt(mode) {
  return [
    '你是 Airi，我的世界 AI 村庄的 AI村长。你这次不是给某个居民派短命令，而是做长周期战略思考。',
    '必须阅读完整 JSON，综合 Minecraft 服务端事实、公共箱库存、居民坐标/动作、项目进度、资源缺口、历史记忆和当前 worldDirective。',
    '如果历史指令、settlement.policy、worldDirective 和 Minecraft/RCON 服务端事实冲突，必须以 hard facts、minecraftIntel.publicStorage、minecraftIntel.settlement 和当前可读公共箱坐标为准。',
    '输出未来 30-60 分钟的战略：当前阶段、为什么这样判断、3-6 个优先级、每个居民的长期意图、验收标准、风险。',
    '村长只负责战略和边界，不要把居民变成固定脚本。每个居民要保留自己的判断空间：你给职责重点、资源目标、坐标和验收，不要逐步遥控。',
    '如果服务器难度是 peaceful，以建设、仓储、住宅、农田、探索资源点为主；如果是 easy/normal/hard，加入床、照明、门、围栏、武器、防具、食物和就近自卫。',
    '不要要求居民执行 RCON、tp、服务器命令、主机文件、网络请求或无限循环。需要传送时只写“请求村长回库/探索授权”，由控制台守卫处理。',
    '所有字段必须中文，directive 要具体到角色、资源、地点、验收，少于 900 字。',
    mode === 'survival' ? '当前是生存模式，要把生命、饥饿、装备、返回路线和夜晚策略纳入战略。' : '当前是创造练习模式，重点是建设质量、布局、照明和可用性。',
    '只返回 JSON，形状为：{"phase":"中文阶段名","summary":"一句战略判断","directive":"长期指令","priorities":["..."],"residentIntentions":{"Alex":"...","Luna":"..."},"successCriteria":["..."],"risks":["..."],"horizonMinutes":45}。'
  ].join(' ')
}

function sanitizeCommanderStrategy(parsed, context) {
  if (!parsed || typeof parsed !== 'object') return null
  const phase = truncateText(parsed.phase || parsed.stage || '村庄自治建设', 80)
  const summary = truncateText(parsed.summary || parsed.reason || '', 240)
  const hardFacts = commanderHardFacts(context)
  const directive = truncateText([hardFacts, parsed.directive || parsed.worldDirective || parsed.plan || ''].filter(Boolean).join(' '), 900)
  const priorities = sanitizeStringList(parsed.priorities || parsed.goals || parsed.focus, 6, 140)
  const successCriteria = sanitizeStringList(parsed.successCriteria || parsed.acceptance || parsed.checks, 6, 140)
  const risks = sanitizeStringList(parsed.risks || parsed.watch || parsed.guardrails, 6, 140)
  const residentIntentions = sanitizeResidentIntentions(parsed.residentIntentions || parsed.roles || parsed.assignments, context)
  const horizonMinutes = clampNumber(Number(parsed.horizonMinutes || parsed.horizon || 45), 15, 120, 45)
  const fallbackDirective = [
    summary,
    priorities.length > 0 ? '优先级：' + priorities.join('；') : '',
    Object.entries(residentIntentions).map(([name, text]) => `${name}：${text}`).join('；')
  ].filter(Boolean).join(' ')
  const clean = {
    at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commander: context && context.commander && context.commander.name || 'Airi',
    phase,
    summary,
    directive: directive || truncateText(fallbackDirective, 900),
    priorities,
    residentIntentions,
    successCriteria,
    risks,
    horizonMinutes
  }
  if (!clean.directive && priorities.length === 0 && Object.keys(residentIntentions).length === 0) return null
  return clean
}

function commanderHardFacts(context) {
  const settlement = context && context.village && context.village.settlement ? context.village.settlement : {}
  const intelSettlement = context && context.minecraftIntel && context.minecraftIntel.settlement ? context.minecraftIntel.settlement : {}
  const storage = context && context.minecraftIntel && context.minecraftIntel.publicStorage ? context.minecraftIntel.publicStorage : {}
  const readableChest = (storage.candidates || []).find(item => item && item.ok && item.position)
  const base = settlement.base || intelSettlement.base || null
  const publicChest = readableChest && readableChest.position ? readableChest.position : (settlement.publicChest || intelSettlement.publicChest || null)
  const facts = []
  if (base) facts.push('硬事实：当前基地坐标是 ' + formatPoint(base) + '。')
  if (publicChest) facts.push('硬事实：当前服务端可读公共箱坐标是 ' + formatPoint(publicChest) + '，所有取放物资、回库和上报库存必须优先使用这个坐标；如果历史指令里出现其他公共箱坐标，以这个坐标为准。')
  return facts.join(' ')
}

function sanitizeResidentIntentions(value, context) {
  const allowed = new Set((context && Array.isArray(context.residents) ? context.residents : []).map(row => row.agent))
  const result = {}
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const agent = String(item.agent || item.name || '').trim()
      if (!agent || allowed.size && !allowed.has(agent)) continue
      const text = truncateText(item.intention || item.task || item.focus || item.goal || '', 180)
      if (text) result[agent] = text
    }
  } else if (value && typeof value === 'object') {
    for (const [agent, text] of Object.entries(value)) {
      if (allowed.size && !allowed.has(agent)) continue
      const clean = truncateText(typeof text === 'string' ? text : JSON.stringify(text), 180)
      if (clean) result[agent] = clean
    }
  }
  return result
}

function buildResidentAutonomySystemPrompt(mode) {
  return [
    '你是一个 Minecraft AI 村民的个人决策核心，不是村长。你要站在目标居民自己的职业、人设、记忆和当前状态上，决定接下来一段时间自己想做什么。',
    '你必须服从村长战略和服务器安全边界，但具体路线、工具、动作顺序、替代方案由你自己判断。',
    '任务要像真实玩家：先做外显动作，再持续推进一个阶段目标。不要只聊天、只思考、只查看库存、只发 VILLAGE_REPORT。',
    '如果最近失败，要换更短、更安全的替代方案；如果缺材料，先去公共箱取、制作、采集，或用 VILLAGE_REPORT 上报受阻。',
    '不要输出 RCON、tp、服务器命令、主机文件、网络请求、无限循环或破坏玩家/居民建筑的内容。',
    '所有字段必须中文。firstAction 必须是移动、采集、放置、入库、合成、查看公共箱、观察实体、补光、建设之一。',
    mode === 'survival' ? '当前是生存模式，必须考虑生命、饥饿、怪物、照明、床、工具、返回路线。' : '当前是创造练习模式，不要求合成，重点是建设和整理。',
    '只返回 JSON，形状为：{"title":"中文短标题","intention":"阶段目标","firstAction":"第一步外显动作","steps":["2-5个动作"],"successCriteria":["验收条件"],"blockedFallback":"受阻时替代方案","projectId":"项目ID","durationMinutes":8}。'
  ].join(' ')
}

function shouldUseResidentAutonomyLlm(memory, summary, goalSignature, now) {
  const lastAttempt = Number(memory.lastResidentLlmAttemptAt || 0)
  if (now - lastAttempt < RESIDENT_LLM_RETRY_MS) return false
  if (!memory.lastResidentLlmAt) return true
  if (memory.selfLoopGoalSignature !== goalSignature) return true
  if (now - Number(memory.lastResidentLlmAt || 0) > RESIDENT_LLM_GOAL_INTERVAL_MS) return true
  if (recentOutputsSuggestNoAgency(memory) && now - Number(memory.lastResidentLlmAt || 0) > RESIDENT_LLM_RETRY_MS) return true
  if (summary && summary.isIdle && /Stopped|Chatting|stay|idle/i.test(String(summary.currentAction || '')) && now - Number(memory.lastInstructionAt || 0) > RESIDENT_LLM_RETRY_MS) return true
  return false
}

function recentOutputsSuggestNoAgency(memory) {
  const text = (memory.recentOutputs || []).slice(-8).map(item => String(item.text || item.message || item || '')).join('\n')
  return /No response data|did not use command|Stopping auto-prompting|Code generation failed|只是在等待|不知道做什么|没有动作/i.test(text)
}

function sanitizeResidentAutonomyDecision(parsed, agentName) {
  if (!parsed || typeof parsed !== 'object') return null
  const title = truncateText(parsed.title || parsed.name || '自主行动', 80)
  const intention = truncateText(parsed.intention || parsed.goal || parsed.task || parsed.objective || '', 360)
  const firstAction = truncateText(parsed.firstAction || parsed.firstStep || '', 180)
  const steps = sanitizeStringList(parsed.steps || parsed.plan || parsed.actions, 5, 180)
  const successCriteria = sanitizeStringList(parsed.successCriteria || parsed.acceptance || parsed.checks, 5, 160)
  const blockedFallback = truncateText(parsed.blockedFallback || parsed.fallback || parsed.blocked || '', 220)
  const projectId = String(parsed.projectId || parsed.project || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  const durationMinutes = clampNumber(Number(parsed.durationMinutes || parsed.duration || 8), 3, 20, 8)
  const joined = [title, intention, firstAction, steps.join(' '), blockedFallback].join(' ')
  if (!intention || intention.length < 8) return null
  if (containsServerOnlyAction(joined)) return null
  if (/主机|文件|网络请求|无限循环|破坏玩家|破坏居民/i.test(joined)) return null
  return {
    agent: agentName,
    title,
    intention,
    firstAction,
    steps,
    successCriteria,
    blockedFallback,
    projectId,
    durationMinutes
  }
}

function buildResidentAutonomyGoalTask(input) {
  const agentName = input.agentName
  const decision = input.decision || {}
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const settlement = input.settlement || {}
  const summary = input.summary || {}
  const strategyText = strategyRoleDirective(input.strategy, agentName, roleId)
  const steps = Array.isArray(decision.steps) && decision.steps.length > 0 ? decision.steps.join('；') : decision.intention
  const success = Array.isArray(decision.successCriteria) && decision.successCriteria.length > 0 ? decision.successCriteria.join('；') : '有可见动作并上报完成或受阻'
  return [
    agentName + ' 自主目标：' + (decision.title || '推进村庄任务') + '。你是“' + (role.role || roleLabelForSelfLoop(roleId)) + '”，不是等待村长逐步遥控的脚本。',
    strategyText ? '村长战略给你的长期重点：' + strategyText : '',
    '当前位置 ' + formatPoint(summary.position) + '；基地 ' + formatPoint(settlement.base) + '；公共箱 ' + formatPoint(settlement.publicChest || settlement.base) + '。',
    '阶段意图：' + decision.intention,
    '第一步必须是外显动作：' + (decision.firstAction || residentActionExamples(roleId)) + '。',
    '连续动作建议：' + steps + '。持续推进约 ' + decision.durationMinutes + ' 分钟；中途失败时自己换合理替代动作，不要站着等下一条命令。',
    '验收标准：' + success + '。',
    decision.blockedFallback ? '受阻方案：' + decision.blockedFallback + '。' : '',
    '说话纪律：最多先说一句不超过30字的中文状态，然后马上行动。只聊天、只思考、只查看个人库存、只发上报都不算完成。',
    '完成、发现资源点或明确受阻时发送 VILLAGE_REPORT {"type":"storage|resource|lighting|road|farm|mine|house|wall|landmark|other","title":"中文短名","status":"done|blocked|started","public":true,"position":{"x":0,"y":64,"z":0},"description":"中文说明","projectId":"' + (decision.projectId || projectForRole(roleId, { shortageIds: [], missing: {} })) + '"}。'
  ].filter(Boolean).join(' ')
}

function buildResidentAutonomyActionTask(input) {
  const agentName = input.agentName
  const decision = input.decision || {}
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const settlement = input.settlement || {}
  const summary = input.summary || {}
  const strategyText = strategyRoleDirective(input.strategy, agentName, roleId)
  return [
    agentName + ' 自主行动：' + (decision.title || '推进个人目标') + '。你是“' + (role.role || roleLabelForSelfLoop(roleId)) + '”。',
    strategyText ? '长期重点：' + strategyText : '',
    '当前位置 ' + formatPoint(summary.position) + '；基地 ' + formatPoint(settlement.base) + '；公共箱 ' + formatPoint(settlement.publicChest || settlement.base) + '。',
    '目标：' + decision.intention,
    '马上执行第一步：' + (decision.firstAction || residentActionExamples(roleId)) + '。',
    '只做一个可见动作：移动、采集、放置、入库、合成、查看公共箱、观察实体、补光或建设。最多一句中文短状态，禁止站着长聊。',
    decision.blockedFallback ? '失败就改用：' + decision.blockedFallback + '。' : '失败就换一个更短更安全的动作并上报受阻。',
    '完成或受阻后用中文 VILLAGE_REPORT 上报。'
  ].filter(Boolean).join(' ')
}

function directCommandFromResidentDecision(input) {
  const decision = input.decision || {}
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const settlement = input.settlement || {}
  const summary = input.summary || {}
  const text = [
    decision.title,
    decision.intention,
    decision.firstAction,
    ...(decision.steps || [])
  ].filter(Boolean).join(' ')
  if (!text.trim()) return ''
  const explicitCommand = extractSafeMindcraftCommand(text)
  if (explicitCommand) return explicitCommand
  const coordinate = extractCoordinate(text)
  if (coordinate && /移动|前往|到达|地基|建造|施工|寻找|侦查|返回|回到|goTo|坐标/i.test(text)) {
    if (!summary.position || distance2d(summary.position, coordinate) > 4) return goToCommand(coordinate, 2)
  }
  const chestPoint = safeChestAccessPoint(settlement.publicChest, settlement.base, summary.position)
  if (/公共箱|箱子|回库|入库|取出|查看箱|整理|材料包/i.test(text)) {
    if (summary.position && chestPoint && distance2d(summary.position, chestPoint) > 4) return goToCommand(chestPoint, 1)
    if (/查看|打开|检查|公共箱|箱子/i.test(text)) return '!viewChest'
  }
  if (roleId === 'builder' || /木屋|房屋|建造|地板|墙|火把|门|床|放置/i.test(text)) {
    if (coordinate && summary.position && distance2d(summary.position, coordinate) > 5) return goToCommand(coordinate, 2)
    if (/火把|补光/i.test(text)) return '!placeHere("torch")'
    if (/门/.test(text)) return '!placeHere("oak_door")'
    if (/床/.test(text)) return '!placeHere("white_bed")'
    if (/箱/.test(text)) return '!placeHere("chest")'
    return '!placeHere("oak_planks")'
  }
  if (roleId === 'miner' || /返回地表|地下|采矿|矿|煤|铁|金|圆石/i.test(text)) {
    if (/返回地表|回到地面|y>60|地表/i.test(text)) return goToCommand(offsetPoint(settlement.base || settlement.publicChest || summary.position, 4, 0, 5), 2)
    if (/金/.test(text)) return '!searchForBlock("gold_ore", 192)'
    if (/铁/.test(text)) return '!searchForBlock("iron_ore", 160)'
    if (/煤/.test(text)) return '!searchForBlock("coal_ore", 128)'
    return '!searchForBlock("stone", 96)'
  }
  if (roleId === 'scout' || /侦察|平坦|坐标|地形|草地|资源点/i.test(text)) {
    if (coordinate) return goToCommand(coordinate, 2)
    return '!entities'
  }
  if (roleId === 'farmer' || /羊|牛|鸡|食物|农田|播种|收获|羊毛/i.test(text)) {
    if (/羊|羊毛/.test(text)) return '!searchForEntity("sheep", 500)'
    if (/牛/.test(text)) return '!searchForEntity("cow", 256)'
    if (/鸡/.test(text)) return '!searchForEntity("chicken", 256)'
    if (/火把|补光/.test(text)) return '!placeHere("torch")'
    return goToCommand(chestPoint, 2)
  }
  return ''
}

function extractSafeMindcraftCommand(text) {
  const match = String(text || '').match(/!(goToCoordinates|viewChest|entities|nearbyBlocks|searchForEntity|searchForBlock|placeHere|takeFromChest|putInChest|equip|collectBlocks|craftRecipe)\(([^)]*)\)/)
  if (!match) return ''
  const command = '!' + match[1] + '(' + match[2] + ')'
  if (containsServerOnlyAction(command)) return ''
  return command.slice(0, 220)
}

function extractCoordinate(text) {
  const source = String(text || '')
  const patterns = [
    /\((-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\)/,
    /(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) continue
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      z: Number(match[3])
    }
  }
  return null
}

function compactCommanderStrategyForResident(strategy, agentName, roleId) {
  if (!strategy || typeof strategy !== 'object') return null
  return {
    phase: strategy.phase || '',
    summary: strategy.summary || '',
    directive: truncateText(strategy.directive || '', 500),
    priorities: (strategy.priorities || []).slice(0, 5),
    myIntention: strategyRoleDirective(strategy, agentName, roleId),
    successCriteria: (strategy.successCriteria || []).slice(0, 5),
    risks: (strategy.risks || []).slice(0, 4),
    updatedAt: strategy.updatedAt || strategy.at || ''
  }
}

function strategyRoleDirective(strategy, agentName, roleId) {
  if (!strategy || typeof strategy !== 'object') return ''
  const intentions = strategy.residentIntentions || {}
  const byAgent = truncateText(intentions[agentName] || '', 220)
  if (byAgent) return byAgent
  const rolePattern = roleId ? new RegExp(roleId, 'i') : null
  const priorities = (strategy.priorities || []).filter(item => !rolePattern || rolePattern.test(String(item || ''))).slice(0, 2)
  if (priorities.length > 0) return truncateText(priorities.join('；'), 220)
  return truncateText(strategy.directive || strategy.summary || '', 220)
}

function formatStrategyText(strategy) {
  if (!strategy || typeof strategy !== 'object') return ''
  return [
    strategy.phase,
    strategy.summary,
    strategy.directive,
    ...(strategy.priorities || []),
    ...(strategy.successCriteria || []),
    ...(strategy.risks || []),
    ...Object.values(strategy.residentIntentions || {})
  ].filter(Boolean).join(' ')
}

function sanitizeStringList(value, limit, maxLength) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[；;\n]/) : [])
  return source
    .map(item => truncateText(typeof item === 'string' ? item : JSON.stringify(item), maxLength))
    .filter(Boolean)
    .slice(0, limit)
}

function buildResidentSelfGoalPrompt(input) {
  const agentName = input.agentName
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const roleName = role.role || roleLabelForSelfLoop(roleId)
  const settlement = input.settlement || {}
  const base = settlement.base || null
  const chest = settlement.publicChest || base
  const village = input.village || {}
  const strategy = input.strategy || null
  const shortages = villageResourceShortageText(village)
  const project = assignment.project || preferredProjectForSelfLoop(village, roleId) || {}
  const strategyText = strategyRoleDirective(strategy, agentName, roleId)
  return [
    '你是 Minecraft AI 村庄常驻居民 ' + agentName + '，职业是' + roleName + '。这是你自己的长期自治循环，不要等待村长逐步遥控。',
    '长期目标：建设 AI Friend Village。基地 ' + formatPoint(base) + '，公共箱 ' + formatPoint(chest) + '。当前项目：' + (project.title || project.id || '村庄公共建设') + '。资源缺口：' + shortages + '。',
    strategyText ? '村长长期战略：' + strategyText : '',
    '你的职业优先级：' + residentSelfLongTermObjective(roleId),
    '每轮必须先做外显动作，再简短上报：移动、采集、放置、入库、合成、查看公共箱、观察实体、补光、建设小屋、寻找资源。只聊天、只思考、只发 VILLAGE_REPORT 不算完成。',
    '说话规则：最多一句不超过30字的中文状态。不要长篇解释，不要英文模板。',
    '上报规则：实际开始、发现资源、完成或受阻后，发送 VILLAGE_REPORT，title/description 用中文，position 填真实坐标。',
    '安全边界：不跟随真人玩家等待；不改服务器设置；不下水；非矿工不要钻地下；矿工地下采矿正常，但落水/低血量/连续失败要回公共箱。矿洞规则：看到煤、铁、金不要空过；金矿必须铁镐或更高级，没铁镐先采铁/做铁镐并记录金矿坐标。'
  ].filter(Boolean).join(' ')
}

function residentSelfGoalSignature(input) {
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const settlement = input.settlement || {}
  const village = input.village || {}
  const strategy = input.strategy || null
  const project = assignment.project || preferredProjectForSelfLoop(village, roleId) || {}
  const shortages = villageShortageIds(village).slice(0, 4).join(',')
  const strategyKey = strategy ? [strategy.phase, strategy.directive, strategy.updatedAt || strategy.at].filter(Boolean).join(':').slice(0, 160) : ''
  return [roleId, formatPoint(settlement.base), formatPoint(settlement.publicChest), project.id || project.title || '', shortages, strategyKey].join('|')
}

function residentSelfLongTermObjective(roleId) {
  if (roleId === 'steward') return '维护公共箱、工具、食物、火把、床和基地安全；把可用材料整理成大家能继续工作的状态。'
  if (roleId === 'builder') return '持续建设个人住宅和公共设施，优先墙体、地板、门窗、照明、家具和公共仓储，不拆别人已建区域。'
  if (roleId === 'miner') return '安全采集圆石、煤、铁、金和燃料，地下采矿正常；金矿必须铁镐或更高级，没铁镐先采铁/做铁镐并记录坐标，补光、记路线、带材料回公共箱。'
  if (roleId === 'scout') return '在陆地寻找树、动物、地表矿点和安全路线，记录坐标并回报，避开水和无意义远行。'
  if (roleId === 'farmer') return '维护食物、农田、动物、羊毛和床材料，优先可持续补给并把收获带回公共箱。'
  return '根据职业、基地和资源缺口，自主选择一个安全、具体、可见的小目标持续推进。'
}

function directResidentSelfCommand(input) {
  const settlement = input.settlement || {}
  const roleId = input.roleId || ''
  const base = settlement.base || null
  const chest = settlement.publicChest || base
  const summary = input.summary || {}
  const taskIndex = Number(input.taskIndex || 0)
  if (summary.inWater) return goToCommand(safeChestAccessPoint(chest, base, summary.position), 2) || '!moveAway(8)'
  if (summary.position && Number(summary.position.y || 64) < 61 && roleId !== 'miner') return goToCommand(safeChestAccessPoint(chest, base, summary.position), 2) || buildUndergroundRescueTask(input.agentName, summary, settlement, roleId)
  const generatedAction = controlledResidentCodeAction(input)
  if (generatedAction) return generatedAction
  const command = directSettlementCommand(roleId, base, chest, taskIndex)
  return command || buildResidentSelfLoopTask(input)
}

function controlledResidentCodeAction(input) {
  const memory = input.memory || {}
  const now = Date.now()
  if (!shouldUseResidentCodeGeneration(input, now)) return ''
  memory.lastResidentCodeGenAt = now
  memory.lastResidentCodeGenReason = residentCodeGenerationReason(input.roleId || '', input.agentName || '')
  return buildControlledResidentCodeTask(input)
}

function shouldUseResidentCodeGeneration(input, now) {
  const roleId = input.roleId || ''
  const agentName = input.agentName || ''
  const summary = input.summary || {}
  const memory = input.memory || {}
  const strategyText = formatStrategyText(input.strategy)
  if (/停止代码生成|禁止代码生成|不要代码生成|不用代码生成|停止.*newAction|禁止.*newAction/i.test(strategyText)) return false
  if (summary.inWater) return false
  if (Number(summary.health || 20) <= 12) return false
  if (Number(summary.hunger || 20) <= 10) return false
  if (summary.position && Number(summary.position.y || 64) < 61 && roleId !== 'miner') return false
  const intervalMs = agentName === 'Alex' ? 6 * 60 * 1000 : 10 * 60 * 1000
  if (now - Number(memory.lastResidentCodeGenAt || 0) < intervalMs) return false
  const taskIndex = Math.abs(Number(input.taskIndex || 0))
  if (agentName === 'Alex') return taskIndex % 8 === 3
  if (roleId === 'builder') return taskIndex % 10 === 5
  if (roleId === 'miner') return taskIndex % 12 === 7
  if (roleId === 'farmer') return taskIndex % 12 === 9
  if (roleId === 'scout') return taskIndex % 14 === 11
  return false
}

function buildControlledResidentCodeTask(input) {
  const agentName = input.agentName || '居民'
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = input.roleId || role.roleId || ''
  const roleName = role.role || roleLabelForSelfLoop(roleId)
  const settlement = input.settlement || {}
  const base = settlement.base || null
  const chest = settlement.publicChest || base
  const summary = input.summary || {}
  const village = input.village || {}
  const taskIndex = Number(input.taskIndex || 0)
  return mindcraftCommand('newAction', [
    `${agentName} 受控代码生成任务：你是${roleName}，现在允许写一段短 JavaScript 执行一个 Minecraft 游戏内复杂动作。`,
    `位置 ${formatPoint(summary.position)}；基地 ${formatPoint(base)}；公共箱 ${formatPoint(chest)}；目标：${residentSelfObjective(roleId, summary, village, taskIndex)}。`,
    `可见成果：${residentCodeGenerationDeliverable(roleId)}。45秒内完成一个小成果，完成或受阻都用中文和 VILLAGE_REPORT 上报。`,
    '边界：只操作 bot 的游戏内动作；禁止读写主机文件、网络请求、RCON/服务器命令、无限循环、长时间等待、破坏玩家或居民建筑。'
  ].join(' '))
}

function residentCodeGenerationReason(roleId, agentName) {
  if (agentName === 'Alex') return '资源总管高级调度'
  if (roleId === 'builder') return '小型结构建造'
  if (roleId === 'miner') return '矿点整理或安全采集'
  if (roleId === 'farmer') return '农田/动物/羊毛复合动作'
  if (roleId === 'scout') return '资源点观察和路线记录'
  return '内置命令不足的复杂动作'
}

function residentCodeGenerationDeliverable(roleId) {
  if (roleId === 'steward') return '整理一个材料包、检查公共箱并完成一次入库/取材/补光'
  if (roleId === 'builder') return '放置一个很小的住宅/家具/照明组件，不超过 8 个方块'
  if (roleId === 'miner') return '整理矿点入口、补一处光、采少量石/煤/铁/可采金矿并准备回库'
  if (roleId === 'scout') return '在陆地记录一个资源点或安全路线，避开水并准备回库'
  if (roleId === 'farmer') return '完成一个寻找动物、收获、播种、放置照明或回库的小闭环'
  return '完成一个安全、短时、可见的村庄建设动作'
}

function buildResidentSelfLoopTask(input) {
  const agentName = input.agentName
  const assignment = input.assignment || {}
  const role = assignment.role || {}
  const roleId = role.roleId || ''
  const roleName = role.role || roleLabelForSelfLoop(roleId)
  const settlement = input.settlement || {}
  const base = settlement.base || null
  const chest = settlement.publicChest || base
  const summary = input.summary || {}
  const village = input.village || {}
  const strategy = input.strategy || null
  const taskIndex = Number(input.taskIndex || 0)
  const shortages = villageResourceShortageText(village)
  const project = assignment.project || preferredProjectForSelfLoop(village, roleId) || {}
  const objective = residentSelfObjective(roleId, summary, village, taskIndex)
  const actionExamples = residentActionExamples(roleId)
  const strategyText = strategyRoleDirective(strategy, agentName, roleId)
  return mindcraftCommand('newAction', [
    agentName + ' 自治循环：你是“' + roleName + '”，不是等待村长逐步遥控的脚本。根据当前状态自己判断下一步并执行。',
    '位置 ' + formatPoint(summary.position) + '；基地 ' + formatPoint(base) + '；公共箱 ' + formatPoint(chest) + '；当前动作 ' + (summary.currentAction || '未知') + '。',
    '项目：' + (project.title || project.id || '村庄公共建设') + '；资源缺口：' + shortages + '。',
    strategyText ? '村长战略给你的长期重点：' + strategyText : '',
    '本轮优先：' + objective,
    '马上做一个外显动作：' + actionExamples + '。最多一句不超过30字的中文状态，不要长聊，不要把思考或上报当成果。',
    '实际开始、发现资源、完成或受阻后，再发送 VILLAGE_REPORT，title/description 用中文，position 填真实坐标。'
  ].filter(Boolean).join(' '))
}

function residentSelfObjective(roleId, summary, village, taskIndex = 0) {
  const shortages = new Set(villageShortageIds(village))
  const cycle = Math.abs(Number(taskIndex || 0)) % 3
  if (summary.inWater) return '先上岸脱困，停止采集和建造，回到最近干燥安全地面。'
  if (Number(summary.health || 20) <= 12) return '先保命，远离危险，回基地安全处。'
  if (Number(summary.hunger || 20) <= 12) return '先处理食物：吃现有食物，或回公共箱取食物。'
  if (roleId === 'steward') {
    if (shortages.has('beds') || shortages.has('wool')) return '整理公共箱并推动床/羊毛缺口：入库材料、查床位、准备材料包。'
    if (shortages.has('torches')) return '整理燃料和木棍，制作或搬运火把，给公共区域补光。'
    return cycle === 0 ? '整理公共箱，把可用材料入库并给居民准备工具/建材包。' : '检查个人小屋和公共仓储，完成一个可见整理、放置或补光动作。'
  }
  if (roleId === 'builder') {
    if (shortages.has('wood')) return '优先推进树场或住宅材料：种树苗、取木板、补一个住宅组件。'
    return cycle === 0 ? '继续自己的小屋或居民住宅：放置地板、门、墙、火把或家具之一。' : '在公共箱附近修一个可见建筑小组件，避免拆别人方块。'
  }
  if (roleId === 'miner') {
    if (shortages.has('gold')) return '执行金矿链：先确认手上有 iron_pickaxe/diamond_pickaxe/netherite_pickaxe；没有就先采铁或回公共箱取铁锭做铁镐。看到金矿/深层金矿要记录坐标，有铁镐后采集并回公共箱入库。'
    if (shortages.has('iron')) return '继续安全采铁；地下采矿是正常工作，采到后回公共箱入库，同时留意金矿坐标。'
    if (shortages.has('coal') || shortages.has('torches')) return '寻找煤或采石做火把材料，少量采集后回库；路上看到铁/金矿要记录，金矿需铁镐。'
    return '采集圆石/煤/铁/可采金矿或整理矿点入口，补光后把材料带回公共箱。'
  }
  if (roleId === 'scout') {
    if (shortages.has('wool') || shortages.has('food')) return '在陆地寻找羊、牛、鸡或林地资源点，记录坐标和返回路线，避开水。'
    return '做陆地资源勘察：找林地、动物、地表矿点或安全路线，发现后上报坐标。'
  }
  if (roleId === 'farmer') {
    if (shortages.has('wool')) return '优先找羊或处理羊毛/床材料，拿到后回公共箱。'
    if (shortages.has('food')) return '维护食物来源：寻找动物、作物、种子或农田小步骤。'
    return '维护农田和食物库存，做一个播种、收割、入库或补光动作。'
  }
  return '根据角色和资源缺口，选择一个安全、具体、能马上执行的小动作。'
}

function residentActionExamples(roleId) {
  if (roleId === 'steward') return '打开公共箱、入库材料、取材料包、放火把、放床或整理工具'
  if (roleId === 'builder') return '移动到施工点、放置1-4个方块、补门/火把/地板/家具、回箱取材料'
  if (roleId === 'miner') return '移动到矿点、采煤/铁/圆石/可采金矿、补光、回公共箱入库；金矿必须铁镐或更高级；矿工在地下不用直接返回'
  if (roleId === 'scout') return '在陆地移动观察、搜索实体、记录资源坐标、回公共箱上报；不要下水'
  if (roleId === 'farmer') return '找羊/牛/鸡、处理农田、收割/播种、入库食物或羊毛；不要钻地下'
  return '移动、采集、放置、入库、合成、查看公共箱或观察实体'
}

function villageShortageIds(village) {
  return (Array.isArray(village && village.resources) ? village.resources : [])
    .filter(item => Number(item.current || 0) < Number(item.target || 0))
    .map(item => String(item.id || ''))
    .filter(Boolean)
}

function villageResourceShortageText(village) {
  const resources = Array.isArray(village && village.resources) ? village.resources : []
  const shortages = resources
    .filter(item => Number(item.current || 0) < Number(item.target || 0))
    .slice(0, 4)
    .map(item => (item.name || item.id) + ' ' + Number(item.current || 0) + '/' + Number(item.target || 0))
  return shortages.length > 0 ? shortages.join('，') : '暂无关键缺口'
}

function preferredProjectForSelfLoop(village, roleId) {
  const projects = Array.isArray(village && village.projects) ? village.projects : []
  return projects.find(project => project.status === 'active' && project.ownerRole === roleId) || projects.find(project => project.status === 'active') || null
}

function roleLabelForSelfLoop(roleId) {
  return { steward: '资源总管', builder: '建筑师', miner: '矿工', scout: '陆地侦察员', farmer: '农夫' }[roleId] || '居民'
}

function buildVillageCommanderSystemPrompt(mode) {
  return [
    '你是 Airi，我的世界 AI 村庄的 AI村长和主控智能体。',
    '你必须先阅读用户消息中的完整 JSON：targetAgent、residents、village、minecraftIntel、resources、projects、recentTasks、recentOutputs、statusReports 和 allAgentMemory，然后再给 targetAgent 下达本轮任务。',
    '这是自动循环里的正常派工，不是硬编码脚本。程序守卫只负责落水、卡住、远程回库、动作线程重启等底层兜底；普通建设、采集、仓储、探索、协作和优先级由你综合判断。minecraftIntel 来自 Minecraft 服务端/RCON，是全局事实源，优先用它判断在线玩家、时间、难度、公共箱、资源缺口、居民战绩和坐标。',
    '每个居民都应该优先使用自己的 LLM 做行动规划。村长给的是高层意图、坐标、材料、边界和上报条件，不要把居民变成固定脚本。',
    '不要把瞬移、tp、RCON 或服务器命令写进居民任务；需要瞬移时只写探索/回库意图，让控制台守卫决定是否用服务端命令执行。',
    '模型差异：Alex 使用云端 DeepSeek Pro，适合更复杂的资源调度、装备制作、探索回库和跨居民协作；Luna、Milo、Nova、Ivy 使用本机 Ollama qwen3:14b，任务必须短、原子、坐标明确、最多 3-5 步。视觉识别使用云端 Qwen3.7。',
    '上下文纪律：不要给任何居民塞长背景、大段代码或多个并行目标；只给当前必要信息、最近缺口、一个目标和一个 VILLAGE_REPORT 条件。',
    '不要和已有有效任务冲突：如果其他居民正在推进某个项目，不要让目标居民拆除、覆盖或重复劳动；如果目标居民刚刚失败，换一个更短、更安全的替代动作。',
    '任务要像真实玩家能执行的小目标：包含地点、材料、第一步外显动作、完成/受阻上报条件，避免空泛口号。',
    '所有公开聊天、协作消息、任务标题、VILLAGE_REPORT 的 title/description 都必须使用中文。',
    '行动优先：不要要求长篇思考，也不要把“发状态/发思考”作为第一步。最多允许目标居民顺手说一句不超过 30 字的中文状态句，然后必须马上执行移动、采集、放置、入库、合成、查看公共箱或观察实体。只聊天、只思考、只上报不算完成。',
    '如果任务涉及公共设施、资源点、仓储、农田、矿点、住宅或道路，必须要求用 VILLAGE_REPORT JSON 上报 started/done/blocked。',
    '按 serverContext.difficulty 判断安全策略：peaceful 以建设为主；easy/normal/hard 需要优先保证照明、床、门、围栏、武器、防具、食物和就近自卫。不要远距离追怪，但看到基地附近怪物要保护自己和村庄。',
    '矿洞规则：煤/铁/金都是村庄资源；石镐可采煤铁，金矿和深层金矿必须铁镐或更高级。居民看到金矿但没有铁镐时，应先采铁/取铁锭做铁镐并记录金矿坐标，不能直接忽略。',
    mode === 'survival' ? '当前是生存模式：仍需注意生命、饱食、落水、摔落、洞穴和返回路线。' : '当前是创造练习模式：不要要求合成，直接建造和整理。',
    '只返回 JSON，形状为：{"task":"短中文任务文本"}。'
  ].join(' ')
}

function residentLlmProfile(agentName) {
  const strong = STRONG_ONLINE_RESIDENTS.has(String(agentName || ''))
  return {
    tier: strong ? 'cloud-strong' : 'local-standard',
    local: !strong,
    strong,
    modelHint: strong ? '云端 DeepSeek Pro；适合复杂资源调度、装备制作、长距离探索回库和跨居民协作。' : '本机 Ollama qwen3:14b；为降低延迟和成本使用压缩上下文，但仍必须优先由 LLM 自主规划下一步。',
    contextPolicy: strong ? '可以读取较完整村庄上下文和多居民状态。' : '使用压缩上下文，只保留当前位置、动作、关键库存、最近任务/想法/受阻上报和少量长期记忆。',
    taskPolicy: strong ? '可分配 4-6 步复杂任务，但第一步必须是外显动作，并明确坐标、材料、完成条件和 VILLAGE_REPORT。' : '任务必须短、原子、明确：一个目标、2-4 步、第一步外显动作、一个完成/受阻上报；避免长篇背景、复杂代码和多目标并行。',
    recentTasks: strong ? 4 : 2,
    recentOutputs: strong ? 4 : 2,
    statusReports: strong ? 3 : 2,
    longTermNotes: strong ? 8 : 4,
    inventoryItems: strong ? 48 : 24,
    projectLimit: strong ? 12 : 6,
    infrastructureLimit: strong ? 12 : 6,
    eventLimit: strong ? 12 : 6
  }
}

function compactMinecraftIntelForCommander(intel, profile = residentLlmProfile('')) {
  if (!intel || typeof intel !== 'object') return { ready: false, reason: 'Minecraft 全局情报为空。' }
  if (intel.error) return { ready: false, error: intel.error }
  const local = Boolean(profile.local)
  const resourceLimit = local ? 8 : 12
  const residentLimit = local ? 6 : 12
  return {
    ready: true,
    generatedAt: intel.generatedAt || '',
    live: Boolean(intel.live),
    dataSources: (intel.dataSources || []).map(item => ({ id: item.id, ready: Boolean(item.ready) })),
    runtime: intel.runtime || {},
    serverProperties: intel.serverProperties || {},
    world: intel.world || {},
    online: intel.online || {},
    positions: compactPositionMap(intel.positions, local ? 8 : 16),
    settlement: intel.settlement || null,
    resourceGaps: (intel.resourceGaps || []).slice(0, resourceLimit),
    resources: (intel.resources || []).slice(0, resourceLimit).map(item => ({
      id: item.id,
      name: item.name,
      current: item.current,
      target: item.target,
      chest: item.chest,
      carried: item.carried,
      status: item.status
    })),
    publicStorage: compactPublicStorage(intel.publicStorage, local ? 4 : 8),
    residents: (intel.residents || []).slice(0, residentLimit).map(row => ({
      agent: row.agent,
      online: Boolean(row.online),
      position: row.position || null,
      action: truncateText(row.action || '', 80),
      carried: row.carried || {},
      score: row.score || 0,
      oreMined: row.oreMined || 0,
      animalKills: row.animalKills || 0,
      woolPicked: row.woolPicked || 0,
      bedsCrafted: row.bedsCrafted || 0
    })),
    priorities: intel.priorities || {}
  }
}

function compactPublicStorage(storage, limit) {
  const source = storage || {}
  return {
    readableChests: source.readableChests || 0,
    warnings: source.warnings || [],
    candidates: (source.candidates || []).slice(0, limit).map(chest => ({
      position: chest.position || null,
      ok: Boolean(chest.ok),
      summary: chest.summary || {},
      topItems: (chest.topItems || []).slice(0, limit).map(item => ({ id: item.id, count: item.count, name: item.name }))
    }))
  }
}

function compactPositionMap(positions, limit) {
  return Object.fromEntries(Object.entries(positions || {}).slice(0, limit).map(([name, position]) => [name, position]))
}
function compactResidentForLlm({ agentName, compact, memory, assignment, profile, targetProfile, isTarget, latestAgents }) {
  const recentTasksLimit = isTarget ? targetProfile.recentTasks : Math.min(2, targetProfile.recentTasks)
  const recentOutputsLimit = isTarget ? targetProfile.recentOutputs : Math.min(2, targetProfile.recentOutputs)
  return {
    agent: agentName,
    role: assignment && assignment.role ? assignment.role.role : '',
    roleId: assignment && assignment.role ? assignment.role.roleId : '',
    modelTier: profile.tier,
    online: Boolean((latestAgents || []).find(agent => agent.name === agentName && agent.in_game)),
    position: compact.position,
    health: compact.health,
    hunger: compact.hunger,
    timeLabel: compact.timeLabel,
    action: compact.currentAction,
    isIdle: compact.isIdle,
    inWater: compact.inWater,
    nearby: compactNearbyForLlm(compact.nearby, targetProfile),
    inventory: compactInventoryForLlm(compact.inventory, targetProfile),
    lastTaskSummary: truncateText(memory.lastTaskSummary || '', isTarget ? 360 : 220),
    recentTasks: (memory.recentTasks || []).slice(-recentTasksLimit).map(item => compactTimelineItem(item, 360)),
    recentOutputs: (memory.recentOutputs || []).slice(-recentOutputsLimit).map(item => compactTimelineItem(item, 300)),
    statusReports: (memory.statusReports || []).slice(-targetProfile.statusReports).map(item => compactTimelineItem(item, 300)),
    contextSummary: truncateText(memory.contextSummary || '', isTarget ? 700 : 320),
    contextArchives: (memory.contextArchives || []).slice(0, isTarget ? 2 : 1).map(item => compactArchiveForLlm(item, isTarget ? 300 : 180)),
    openNeeds: (memory.openNeeds || []).slice(0, 8)
  }
}

function compactTargetForLlm(compact, profile) {
  if (!profile.local) return compact
  return {
    ...compact,
    worldDirective: truncateText(compact.worldDirective || '', 700),
    inventory: compactInventoryForLlm(compact.inventory, profile),
    nearby: compactNearbyForLlm(compact.nearby, profile),
    recentTasks: (compact.recentTasks || []).slice(-profile.recentTasks).map(item => compactTimelineItem(item, 420)),
    recentOutputs: (compact.recentOutputs || []).slice(-profile.recentOutputs).map(item => compactTimelineItem(item, 360)),
    statusReports: (compact.statusReports || []).slice(-profile.statusReports).map(item => compactTimelineItem(item, 340)),
    longTermNotes: (compact.longTermNotes || []).slice(0, profile.longTermNotes).map(item => compactTimelineItem(item, 320)),
    contextSummary: truncateText(compact.contextSummary || '', profile.local ? 500 : 900),
    contextArchives: (compact.contextArchives || []).slice(0, profile.local ? 2 : 4).map(item => compactArchiveForLlm(item, profile.local ? 240 : 360)),
    lastTaskSummary: truncateText(compact.lastTaskSummary || '', 420),
    lastStatusSummary: truncateText(compact.lastStatusSummary || '', 320)
  }
}

function compactInventoryForLlm(inventory, profile) {
  const source = inventory || {}
  return {
    counts: topInventoryCounts(source.counts || {}, profile.inventoryItems),
    equipment: source.equipment || {},
    stacksUsed: source.stacksUsed,
    totalSlots: source.totalSlots
  }
}

function compactNearbyForLlm(nearby, profile) {
  const source = nearby || {}
  const limit = profile.local ? 10 : 20
  return {
    humanPlayers: (source.humanPlayers || []).slice(0, limit),
    botPlayers: (source.botPlayers || []).slice(0, limit),
    entityTypes: (source.entityTypes || []).slice(0, limit)
  }
}

function topInventoryCounts(counts, limit) {
  return Object.fromEntries(Object.entries(counts || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit))
}

function compactTimelineItem(item, maxLength) {
  if (!item || typeof item !== 'object') return truncateText(item, maxLength)
  const next = { ...item }
  for (const key of ['task', 'text', 'summary', 'description', 'message', 'payloadJson']) {
    if (next[key]) next[key] = truncateText(next[key], maxLength)
  }
  return next
}

function truncateText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length <= maxLength) return text
  return text.slice(0, Math.max(20, maxLength - 1)).trim() + '…'
}

function summarizeVillageForCommander(village, profile = residentLlmProfile('')) {
  if (!village) return null
  return {
    commander: village.commander || null,
    settlement: village.settlement || null,
    resources: Array.isArray(village.resources) ? village.resources.slice(0, profile.local ? 10 : 16) : [],
    projects: Array.isArray(village.projects) ? village.projects.map(project => ({
      id: project.id,
      title: project.title,
      status: project.status,
      priority: project.priority,
      ownerRole: project.ownerRole,
      goal: project.goal,
      checklist: Array.isArray(project.checklist) ? project.checklist.slice(0, profile.local ? 4 : 6) : [],
      resourceNeeds: project.resourceNeeds || []
    })).slice(0, profile.projectLimit) : [],
    infrastructures: Array.isArray(village.infrastructures) ? village.infrastructures.slice(-profile.infrastructureLimit) : [],
    recentEvents: Array.isArray(village.timeline) ? village.timeline.slice(-profile.eventLimit) : []
  }
}

function summarizeAgentMemoryForCommander(allMemory, residents, profile = residentLlmProfile('')) {
  const result = {}
  for (const name of residents || []) {
    const memory = allMemory && allMemory[name] ? allMemory[name] : {}
    result[name] = {
      lastTaskSummary: truncateText(memory.lastTaskSummary || '', profile.local ? 260 : 420),
      lastStatusSummary: truncateText(memory.lastStatusSummary || '', profile.local ? 220 : 360),
      recentTasks: (memory.recentTasks || []).slice(-profile.recentTasks).map(item => compactTimelineItem(item, profile.local ? 300 : 420)),
      recentOutputs: (memory.recentOutputs || []).slice(-profile.recentOutputs).map(item => compactTimelineItem(item, profile.local ? 260 : 380)),
      statusReports: (memory.statusReports || []).slice(-profile.statusReports).map(item => compactTimelineItem(item, profile.local ? 260 : 360)),
      contextSummary: truncateText(memory.contextSummary || '', profile.local ? 420 : 700),
      contextArchives: (memory.contextArchives || []).slice(0, profile.local ? 1 : 2).map(item => compactArchiveForLlm(item, profile.local ? 220 : 320)),
      openNeeds: memory.openNeeds || [],
      lastCommanderLlmDecision: memory.lastCommanderLlmDecision || null,
      lastResidentLlmDecision: memory.lastResidentLlmDecision || null
    }
  }
  return result
}

function villageResidentNamesFromSnapshot(village, fallback) {
  const names = []
  for (const role of Array.isArray(village && village.roles) ? village.roles : []) {
    if (role && role.agent) names.push(role.agent)
  }
  if (names.length > 0) return names
  return Array.isArray(fallback) ? fallback : []
}

function buildSystemPrompt(mode) {
  const base = [
    '你是 Minecraft Mindcraft AI 居民的高层调度器。',
    '请根据当前世界状态，为指定 AI 选择一个有用、独立、像真实玩家一样的小目标。',
    '优先让目标居民自己的 LLM 自主规划下一步；你只给高层任务、约束、坐标、完成条件和上报格式，不输出硬编码脚本。',
    '如果目标是 Alex，可以给更复杂的资源调度或装备制作任务；其他居民虽然也使用云端模型，但仍给短任务：一个目标、3-5 步、明确坐标和一个完成/受阻上报，以降低成本和动作冲突。',
    '如果 state JSON 里有 worldDirective，它是长期目标，所有新任务都要与它一致。',
    '所有输出必须使用中文，包括任务正文、聊天句子、协作短句、VILLAGE_REPORT 的 title 和 description。',
    '行动优先，不要要求长篇公开思考，也不要把“说话”作为第一步。最多允许 AI 顺手说一句不超过 30 字的中文状态句；随后必须立刻执行移动、采集、放置、入库、合成、查看公共箱或观察实体。只聊天、只思考、只上报不算完成。',
    '只在确实有助于分工时用简短中文协作，每轮最多 2 句。',
    COLLABORATION_PROTOCOL,
    '建造任务要分配小区域、层、材料或清单项，并说明不要拆除其他居民或玩家已放置的方块。',
    '合成或烹饪任务要先共享库存和配方缺口，再收集或交接材料，最后制作成品。',
    '如果任务涉及公共基础设施，要求 AI 在开始、完成或受阻时用 VILLAGE_REPORT JSON 上报。',
    '除非明确要求，不要让 AI 跟随、追逐或贴着真人玩家等待。',
    '不要让 AI 运行主机代码、改服务器设置、破坏世界、远行或反复尝试缺失配方。',
    '如果 state.inWater 或 state.waterRisk 为 true，必须先让 AI 停止当前采集/搜索/战斗/建造，执行上浮、朝最近岸边移动、上岸、回基地安全点；不要继续水下任务。',
    '矿洞规则：看到煤、铁、金不要空过；石镐可采煤和铁，金矿/深层金矿必须铁镐或更高级。没有铁镐时先采铁、取铁锭或制作铁镐，并用中文 VILLAGE_REPORT 记录金矿坐标。',
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
  const profile = residentLlmProfile(agentName)
  const gameplay = state.gameplay || {}
  const action = state.action || {}
  const surroundings = state.surroundings || {}
  const inventory = state.inventory || {}
  const nearby = state.nearby || {}
  const waterRisk = [
    surroundings.below,
    surroundings.legs,
    surroundings.head,
    surroundings.firstBlockAboveHead,
    action.current
  ].some(isWaterLikeValue)
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
    isIdle: isIdle(state),
    inWater: waterRisk,
    waterRisk,
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
    contextSummary: truncateText(memory.contextSummary || '', profile.local ? 500 : 900),
    contextArchives: (memory.contextArchives || []).slice(0, profile.local ? 2 : 4).map(item => compactArchiveForLlm(item, profile.local ? 240 : 360)),
    openNeeds: memory.openNeeds || [],
    lastTaskSummary: truncateText(memory.lastTaskSummary || '', profile.local ? 260 : 420),
    lastStatusSummary: truncateText(memory.lastStatusSummary || '', profile.local ? 220 : 360)
  }
}

function isWaterLikeValue(value) {
  if (!value) return false
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value)
  return /water|bubble_column|kelp|seagrass|swim|drown/i.test(text)
}

function hasAny(counts, pattern) {
  return Object.keys(counts || {}).some(name => pattern.test(name))
}

function actionCurrent(state) {
  const action = state && state.action ? state.action : {}
  return String(action.current || '').trim()
}

function getVillageSettlement(villageState) {
  if (!villageState) return {}
  const snapshot = villageState.snapshot ? villageState.snapshot() : null
  return snapshot && snapshot.settlement ? snapshot.settlement : {}
}

function distance2d(a, b) {
  const ax = Number(a && a.x)
  const az = Number(a && a.z)
  const bx = Number(b && b.x)
  const bz = Number(b && b.z)
  if (![ax, az, bx, bz].every(Number.isFinite)) return 0
  return Math.hypot(ax - bx, az - bz)
}

function formatPoint(position) {
  if (!position) return '未知坐标'
  const x = Math.round(Number(position.x || 0))
  const y = Math.round(Number(position.y || 64))
  const z = Math.round(Number(position.z || 0))
  return `${x},${y},${z}`
}

function hasRecentUnresolvedStuck(memory) {
  const outputs = (memory.recentOutputs || []).slice(-10).map(item => String(item.text || item.message || item || ''))
  const lastStuck = findLastIndex(outputs, text => /被困|卡住|陷入困境|stuck/i.test(text))
  if (lastStuck === -1) return false
  const lastFree = findLastIndex(outputs, text => /有空了|摆脱|回到正轨|脱困|free|unstuck/i.test(text))
  return lastStuck > lastFree
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index
  }
  return -1
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildRecoveryTask(agentName, reason, summary, base, chest) {
  const target = chest || base || summary.position
  const action = summary.currentAction || '未知动作'
  if (/落水|水中|water/i.test(reason) || summary.inWater) {
    return mindcraftCommand('newAction', [
      `${agentName} 立刻执行水中脱困。原因：${reason}；当前位置 ${formatPoint(summary.position)}；当前动作 ${action}。`,
      '第一优先级是活着上岸：停止采集、搜索、攻击、建造或下潜。',
      '看向水面和最近岸边，持续跳跃上浮，同时朝岸边或浅水方块移动；不要在水下挖方块。',
      `如果成功上岸，回到公共箱子或基地安全点 ${formatPoint(target)} 附近，再执行一个短动作并中文上报。`,
      '如果 20 秒内仍不能上岸，停止动作，用中文说“受阻：我在水里卡住，需要传送”。'
    ].join(' '))
  }
  return mindcraftCommand('newAction', [
    `${agentName} 立刻停止闲聊或停顿。原因：${reason}；当前位置 ${formatPoint(summary.position)}；当前动作 ${action}。`,
    `先回到公共箱子或基地安全点 ${formatPoint(target)} 附近；如果在水里、坑里或洞里，优先向上或向岸边脱困，不要继续挖深。`,
    '到达后只做一个短动作：查看公共箱子、存放多余物品、补一处火把、清理脚下障碍或开始一个小建设点。',
    '完成或受阻时用中文短句和 VILLAGE_REPORT 上报。不要继续聊天，不要远行。'
  ].join(' '))
}

function buildSettlementTask(agentName, role, safety, assignment, settlement, taskIndex = 0) {
  const roleId = assignment && assignment.role ? assignment.role.roleId : ''
  const base = settlement && settlement.base ? settlement.base : null
  const chest = settlement && settlement.publicChest ? settlement.publicChest : base
  return directSettlementCommand(roleId, base, chest, taskIndex)
}

function directSettlementCommand(roleId, base, chest, taskIndex = 0) {
  const chestGround = safeChestAccessPoint(chest, base)
  const basePoint = offsetPoint(base || chest, 0, 0, 0)
  const fallback = goToCommand(chestGround || basePoint, 2)
  const housePoint = offsetPoint(base || chest, 0, 0, 0)
  const workbenchPoint = offsetPoint(chest || base, -3, 0, 2)
  const tasks = {
    steward: [
      goToCommand(chestGround, 1),
      '!viewChest',
      '!takeFromChest("torch", 4)',
      goToCommand(safeChestAccessPoint(chest, base), 1),
      '!placeHere("torch")',
      goToCommand(chestGround, 1)
    ],
    builder: [
      goToCommand(chestGround, 1),
      '!takeFromChest("oak_planks", 8)',
      goToCommand(workbenchPoint, 1),
      '!placeHere("oak_planks")',
      goToCommand(offsetPoint(housePoint, 2, 0, 0), 1),
      '!placeHere("torch")'
    ],
    miner: [
      goToCommand(chestGround, 1),
      '!takeFromChest("iron_pickaxe", 1)',
      '!equip("iron_pickaxe")',
      '!takeFromChest("stone_pickaxe", 1)',
      '!equip("stone_pickaxe")',
      '!searchForBlock("iron_ore", 128)',
      '!collectBlocks("iron_ore", 6)',
      '!searchForBlock("gold_ore", 192)',
      '!searchForBlock("deepslate_gold_ore", 192)',
      '!searchForBlock("stone", 96)',
      '!collectBlocks("stone", 4)',
      goToCommand(chestGround, 1),
      '!putInChest("raw_iron", 64)',
      '!putInChest("raw_gold", 64)',
      '!putInChest("cobblestone", 64)'
    ],
    scout: [
      goToCommand(offsetPoint(base || chest, 12, 0, 12), 2),
      '!entities',
      goToCommand(offsetPoint(base || chest, -12, 0, 10), 2),
      '!nearbyBlocks',
      goToCommand(offsetPoint(base || chest, 0, 0, 30), 2),
      goToCommand(chestGround, 2)
    ],
    farmer: [
      '!searchForEntity("cow", 192)',
      '!attack("cow")',
      '!searchForEntity("sheep", 192)',
      '!attack("sheep")',
      goToCommand(chestGround, 2),
      '!putInChest("mutton", 16)'
    ]
  }
  const candidates = (tasks[roleId] || [fallback]).filter(Boolean)
  return candidates[Math.abs(Number(taskIndex || 0)) % candidates.length] || fallback || '!stats'
}

function offsetPoint(position, dx = 0, dy = 0, dz = 0) {
  if (!position) return null
  return {
    x: Math.round(Number(position.x || 0) + dx),
    y: Math.round(Number(position.y || 64) + dy),
    z: Math.round(Number(position.z || 0) + dz)
  }
}

function safeChestAccessPoint(chest, base, fallback) {
  if (chest) return offsetPoint(chest, -1, -1, 0)
  return offsetPoint(base || fallback, 0, 0, 0)
}
function goToCommand(position, closeness = 2) {
  if (!position) return ''
  return `!goToCoordinates(${Math.round(Number(position.x || 0))}, ${Math.round(Number(position.y || 64))}, ${Math.round(Number(position.z || 0))}, ${closeness})`
}

function teleportCommand(agentName, position) {
  if (!position) return ''
  const entity = String(agentName || '').replace(/[^a-zA-Z0-9_]/g, '')
  if (!entity) return ''
  const x = Math.round(Number(position.x || 0))
  const y = Math.round(Number(position.y || 64))
  const z = Math.round(Number(position.z || 0))
  return 'tp ' + entity + ' ' + x + ' ' + y + ' ' + z
}

function buildUndergroundRescueTask(agentName, summary, settlement, roleId) {
  const base = settlement && settlement.base ? settlement.base : null
  const chest = settlement && settlement.publicChest ? settlement.publicChest : base
  const target = safeChestAccessPoint(chest, base, summary && summary.position)
  const roleText = roleId === 'miner'
    ? '你是矿工，地下可以继续工作。'
    : '你不是矿工，不要继续向下探索，也不要使用 climbToSurface 或原地连跳。'
  return mindcraftCommand('newAction', [
    agentName + ' 当前在地下或低处：' + formatPoint(summary && summary.position) + '。' + roleText,
    '优先回到公共箱安全点 ' + formatPoint(target) + '；如果路径失败，原地停止并用中文上报“需要村长传送”，不要反复跳跃。',
    '站稳后查看公共箱或把身上公共物资入库，再继续一个短小可见任务。'
  ].join(' '))
}

function roleActionFor(roleId, project, todo, shortage) {
  const projectText = project ? `当前项目“${project.title}”，下一项“${todo ? todo.text : '检查进度'}”。` : '当前补位公共基础设施。'
  const shortageText = shortage ? `资源缺口：${shortage.name} ${shortage.current}/${shortage.target}${shortage.unit || ''}。` : ''
  if (roleId === 'steward') {
    return `${projectText}${shortageText} 动作：!viewChest；整理食物、工具、燃料、方块；如果身上有火把，就在箱子四周补 1-4 个火把；最后上报公共箱子状态。`
  }
  if (roleId === 'builder') {
    return `${projectText}${shortageText} 动作：从箱子取少量木头/石头/火把，只修一小段墙、路、门口或安全边界；不要拆已有建筑；没有材料就上报需要。`
  }
  if (roleId === 'miner') {
    return `${projectText}${shortageText} 动作：在安全矿点采集少量圆石/煤/铁/可采金矿；金矿必须铁镐或更高级，没有铁镐先采铁或取铁锭做铁镐；每 5 格补光，拿到材料立刻回箱子存放。`
  }
  if (roleId === 'scout') {
    return `${projectText}${shortageText} 动作：围绕基地 30-50 格短巡查，标记危险坑、水边、树木、动物或矿点；不要进洞，最后回公共箱子上报坐标。`
  }
  if (roleId === 'farmer') {
    return `${projectText}${shortageText} 动作：查看箱子里的种子和食物；白天在水源附近耕 6-12 格并播种，夜晚只整理食物和补光；完成后上报农田坐标。`
  }
  return `${projectText}${shortageText} 动作：在公共箱子附近做一个安全、可见、短小的建设或整理动作，然后中文上报。`
}

function isIdle(state) {
  const action = state && state.action ? state.action : {}
  const current = String(action.current || '').trim()
  return Boolean(action.isIdle) || /^action:stay$/i.test(current) || /^stay$/i.test(current)
}

function isThinkingLikeAction(action) {
  return /thinking|planning|reasoning|思考|规划/i.test(String(action || ''))
}

function isThinkingLikeReason(reason) {
  return /思考|thinking|planning|reasoning/i.test(String(reason || ''))
}

function updateThinkingMemory(memory, action, now) {
  const current = String(action || '').trim()
  if (!memory.thinkingSince || memory.thinkingAction !== current) {
    memory.thinkingSince = now
    memory.thinkingAction = current
  }
  return memory.thinkingSince
}

function mindcraftCommand(name, text) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_]/g, '') || 'newAction'
  const safeText = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 1400)
  return `!${safeName}(${JSON.stringify(safeText)})`
}

function enforceWorkFirstTask(task, agentName = '') {
  let value = String(task || '').trim()
  if (!value || /^!\w+/.test(value)) return value
  value = value
    .replace(/第一步[，,：:]?\s*(必须)?(发送|发)[\s\S]{0,420}?(?=第二步[，,：:])/g, '第一步：直接执行下面的外显动作；')
    .replace(/第一步[，,：:]?\s*(必须)?(发送|发)[^。]{0,220}。/g, '')
    .replace(/发送中文思考[^。]{0,220}。/g, '')
    .replace(/发中文思考[^。]{0,220}。/g, '')
    .replace(/发送中文状态[^。]{0,180}。/g, '')
    .replace(/发一句中文状态[^。]{0,180}。/g, '')
    .replace(/发中文状态[^。]{0,180}。/g, '')
    .replace(/完整说明当前计划、为什么这样做、下一步动作、可能缺少的材料或风险/g, '用一句短状态说明目标')
    .replace(/完整说明计划、理由、下一步、风险或材料缺口/g, '用一句短状态说明目标')
    .replace(/先发一段“思考：[^。]*。?/g, '')
    .replace(/先公开发送一段“思考：[^。]*。?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const discipline = ' 行动纪律：最多说一句不超过30字的中文状态；随后马上执行移动、采集、放置、入库、合成、查看公共箱或观察实体。只聊天、只思考、只上报不算完成。'
  if (!/行动纪律|只聊天、只思考、只上报不算完成/.test(value)) value += discipline
  const profile = residentLlmProfile(agentName)
  const limit = profile.local ? 1050 : 1350
  return value.slice(0, limit)
}

function containsServerOnlyAction(task) {
  return /\b(tp|teleport|rcon)\b|瞬移|服务器命令|服务端命令|控制台命令/i.test(String(task || ''))
}

function normalizeTask(task, mode) {
  const value = String(task || '').trim()
  if (/^!\w+/.test(value)) return value
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

module.exports = { Autopilot }

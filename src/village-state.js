'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_ROLES = [
  {
    agent: 'Alex',
    role: '生存管家',
    roleId: 'steward',
    focus: '安全巡逻、基础资源、公共箱子、食物、补光和紧急处理。'
  },
  {
    agent: 'Luna',
    role: '建筑师',
    roleId: 'builder',
    focus: '基地、仓库、道路、围栏、照明、农田和简单住宅。'
  },
  {
    agent: 'Milo',
    role: '矿工',
    roleId: 'miner',
    focus: '低风险采矿、石头、煤、铁、燃料和矿点入口安全。'
  },
  {
    agent: 'Nova',
    role: '侦察员',
    roleId: 'scout',
    focus: '基地周边短距离侦察、道路、地标、资源点和危险点记录。'
  },
  {
    agent: 'Ivy',
    role: '农夫',
    roleId: 'farmer',
    focus: '农田、食物、水源、动物、作物补光和可持续补给。'
  }
]

const DEFAULT_COMMANDER = {
  name: 'Airi',
  title: 'AI村长',
  persona: '负责长期目标、任务拆解、巡查验收、直播观察和观众问答的村庄指挥官。',
  duties: [
    '维护村庄长期目标和项目优先级',
    '给居民 Agent 分配任务并检查进度',
    '维护任务事件、个人记忆和共享村庄记忆',
    '记录公共设施、资源缺口和风险',
    '作为直播观察者巡查村庄并回答观众问题'
  ],
  livestreamRole: '观察村庄建设进展，轮流巡查 Alex、Luna、Milo、Nova、Ivy，并用中文解释他们在做什么。'
}

const DEFAULT_RESOURCES = [
  { id: 'wood', name: '木头', target: 128, current: 0, unit: '个' },
  { id: 'stone', name: '石头/圆石', target: 192, current: 0, unit: '个' },
  { id: 'coal', name: '煤/木炭', target: 48, current: 0, unit: '个' },
  { id: 'iron', name: '铁/铁矿', target: 32, current: 0, unit: '个' },
  { id: 'food', name: '食物', target: 64, current: 0, unit: '份' },
  { id: 'torches', name: '火把', target: 96, current: 0, unit: '个' },
  { id: 'wool', name: '羊毛/床材料', target: 24, current: 0, unit: '个' }
]

const DEFAULT_PROJECTS = [
  {
    id: 'storage-hub',
    title: '公共仓库',
    status: 'active',
    priority: 'P0',
    ownerRole: 'steward',
    goal: '在基地中心建立公共箱子和基础分类，所有 AI 把 surplus 放回这里。',
    checklist: [
      { id: 'place-chest', text: '确认或放置公共箱子', done: false },
      { id: 'deposit-basics', text: '存入木头、石头、食物、燃料', done: false },
      { id: 'sort-basic', text: '按工具、食物、方块、燃料粗略整理', done: false }
    ],
    resourceNeeds: ['wood', 'stone']
  },
  {
    id: 'safe-lighting',
    title: '基地照明和围栏',
    status: 'active',
    priority: 'P0',
    ownerRole: 'steward',
    goal: '让基地和公共箱子周围安全，减少夜晚怪物风险。',
    checklist: [
      { id: 'light-chest', text: '公共箱子和入口附近补光', done: false },
      { id: 'mark-hazards', text: '封堵或标记坑洞、水边、悬崖', done: false },
      { id: 'safe-boundary', text: '建立简单围栏或安全边界', done: false }
    ],
    resourceNeeds: ['torches', 'wood', 'coal']
  },
  {
    id: 'starter-farm',
    title: '稳定食物农场',
    status: 'planned',
    priority: 'P1',
    ownerRole: 'farmer',
    goal: '在基地附近建立小型农田或动物食物来源，减少饥饿风险。',
    checklist: [
      { id: 'water-plot', text: '找到水源并整理农田位置', done: false },
      { id: 'plant-crops', text: '播种小麦、胡萝卜、土豆或其他作物', done: false },
      { id: 'farm-light', text: '农场补光并连到基地道路', done: false }
    ],
    resourceNeeds: ['food', 'wood', 'torches']
  },
  {
    id: 'starter-mine',
    title: '安全矿点',
    status: 'planned',
    priority: 'P1',
    ownerRole: 'miner',
    goal: '在基地附近整理一个低风险矿点入口，优先提供石头、煤、铁和燃料。',
    checklist: [
      { id: 'mine-entry', text: '找到或整理安全矿点入口', done: false },
      { id: 'mine-light', text: '入口和前 20 格补光', done: false },
      { id: 'deposit-ore', text: '把石头、煤、铁放回公共箱子', done: false }
    ],
    resourceNeeds: ['stone', 'coal', 'iron', 'torches']
  },
  {
    id: 'village-paths',
    title: '村庄道路',
    status: 'planned',
    priority: 'P1',
    ownerRole: 'scout',
    goal: '把公共箱子、住宅、农场和探索入口连接起来，方便真人和 AI 回家。',
    checklist: [
      { id: 'main-path', text: '从基地入口到公共箱子修主路', done: false },
      { id: 'farm-path', text: '连接农场', done: false },
      { id: 'road-lights', text: '道路两侧补光', done: false }
    ],
    resourceNeeds: ['stone', 'torches']
  },
  {
    id: 'resident-houses',
    title: '居民小屋',
    status: 'planned',
    priority: 'P2',
    ownerRole: 'builder',
    goal: '为 AI 居民和真人玩家建设简单、可扩展的小屋。',
    checklist: [
      { id: 'first-house', text: '建第一个小屋', done: false },
      { id: 'beds', text: '准备床或床位', done: false },
      { id: 'decorate', text: '加入门窗、照明和基础储物', done: false }
    ],
    resourceNeeds: ['wood', 'stone', 'wool', 'torches']
  }
]

class VillageState {
  constructor(options) {
    this.dataPath = options.dataPath
    this.logger = options.logger
    this.dataStore = options.dataStore
    this.lastObservationByAgent = new Map()
    this.state = this.load()
  }

  snapshot() {
    this.ensureDefaults()
    return cloneJson(this.state)
  }

  update(patch) {
    this.ensureDefaults()
    if (patch.settlement && typeof patch.settlement === 'object') {
      this.state.settlement = {
        ...this.state.settlement,
        ...sanitizeSettlementPatch(patch.settlement)
      }
    }
    if (patch.commander && typeof patch.commander === 'object') {
      this.state.commander = normalizeCommander({
        ...this.state.commander,
        ...patch.commander
      })
    }
    if (Array.isArray(patch.roles)) {
      this.state.roles = mergeRoles(this.state.roles, patch.roles)
    }
    if (Array.isArray(patch.resources)) {
      this.state.resources = mergeById(this.state.resources, patch.resources.map(sanitizeResourcePatch))
    }
    if (Array.isArray(patch.projects)) {
      this.state.projects = mergeById(this.state.projects, patch.projects.map(sanitizeProjectPatch))
    }
    if (Array.isArray(patch.infrastructures)) {
      this.state.infrastructures = mergeById(this.state.infrastructures, patch.infrastructures.map(item => sanitizeInfrastructureReport(item)).filter(Boolean))
    }
    this.touch()
    this.save()
    return this.snapshot()
  }

  updateProject(id, patch) {
    this.ensureDefaults()
    const projectId = normalizeId(id)
    if (!projectId) throw new Error('project id is required')
    const index = this.state.projects.findIndex(project => project.id === projectId)
    if (index === -1) throw new Error(`unknown village project: ${projectId}`)
    this.state.projects[index] = sanitizeProjectPatch({
      ...this.state.projects[index],
      ...patch,
      id: projectId
    })
    this.touch()
    this.save()
    return this.snapshot()
  }

  recordTaskEvent(event) {
    this.ensureDefaults()
    const clean = sanitizeTaskEvent(event)
    if (!clean) throw new Error('invalid task event')
    this.state.taskEvents.push(clean)
    this.state.taskEvents = this.state.taskEvents.slice(-200)
    this.touch()
    this.save()
    this.recordStoreEvent('recordTaskEvent', clean)
    return { ok: true, event: clean, village: this.snapshot() }
  }
  recordInfrastructureReport(report) {
    this.ensureDefaults()
    const clean = sanitizeInfrastructureReport(report)
    if (!clean) throw new Error('invalid infrastructure report')

    const existingIndex = this.state.infrastructures.findIndex(item => item.id === clean.id)
    if (existingIndex === -1) {
      this.state.infrastructures.push(clean)
    } else {
      this.state.infrastructures[existingIndex] = {
        ...this.state.infrastructures[existingIndex],
        ...clean,
        createdAt: this.state.infrastructures[existingIndex].createdAt || clean.createdAt
      }
    }

    applyInfrastructureReportToProjects(this.state, clean)
    this.state.notes.push(infrastructureNote(clean))
    this.state.notes = this.state.notes.slice(-100)
    this.touch()
    this.save()
    this.recordStoreEvent('recordInfrastructureReport', clean)
    return { ok: true, report: clean, village: this.snapshot() }
  }

  ingestAgentOutput(agentName, message, fallbackPosition) {
    const parsed = parseAgentInfrastructureReport(message)
    if (!parsed) return null
    const report = {
      ...parsed,
      agent: parsed.agent || agentName,
      position: parsed.position || fallbackPosition || null
    }
    const result = this.recordInfrastructureReport(report)
    if (this.logger) this.logger.info(`Recorded village report from ${agentName}: ${result.report.title}`)
    return result
  }

  resetDefaults() {
    this.state = defaultVillageState()
    this.save()
    return this.snapshot()
  }

  observeAgents(socketSnapshot) {
    this.ensureDefaults()
    const states = socketSnapshot && socketSnapshot.states ? socketSnapshot.states : {}
    const agents = socketSnapshot && socketSnapshot.agents ? socketSnapshot.agents : []
    const online = new Set(agents.filter(agent => agent.in_game).map(agent => agent.name))
    let changed = false
    for (const role of this.state.roles) {
      const state = states[role.agent]
      if (!state) continue
      role.online = online.has(role.agent)
      role.lastSeenAt = new Date().toISOString()
      role.lastPosition = state.position || role.lastPosition || null
      role.lastAction = state.action || ''
      this.recordObservationIfUseful(role)
      changed = true
    }
    if (changed) {
      this.touch()
      this.saveThrottled()
    }
  }

  assignmentFor(agentName) {
    this.ensureDefaults()
    const role = this.state.roles.find(item => item.agent === agentName) || inferRole(agentName)
    const activeProjects = this.state.projects.filter(project => ['active', 'planned', 'blocked'].includes(project.status))
    const project = activeProjects.find(item => item.ownerRole === role.roleId && item.status === 'active') ||
      activeProjects.find(item => item.ownerRole === role.roleId) ||
      activeProjects.find(item => item.priority === 'P0') ||
      activeProjects[0] ||
      null
    const resourceNeeds = project ? (project.resourceNeeds || []).map(id => this.state.resources.find(item => item.id === id)).filter(Boolean) : []
    const shortage = resourceNeeds.find(item => Number(item.current || 0) < Number(item.target || 0))
    return {
      settlement: this.state.settlement,
      role,
      project,
      shortage,
      activeProjects: activeProjects.slice(0, 5)
    }
  }

  taskContextFor(agentName) {
    const assignment = this.assignmentFor(agentName)
    const parts = []
    if (this.state.commander) parts.push(`Commander: ${this.state.commander.title} ${this.state.commander.name}. ${this.state.commander.persona}`)
    if (assignment.settlement && assignment.settlement.name) parts.push('Village name: ' + assignment.settlement.name + '.')
    if (assignment.settlement && assignment.settlement.base) {
      parts.push(`Village base is at ${formatPosition(assignment.settlement.base)} with radius ${assignment.settlement.radius || 120}.`)
    }
    if (assignment.settlement && assignment.settlement.publicChest) {
      parts.push(`Shared public chest is at ${formatPosition(assignment.settlement.publicChest)}.`)
    }
    if (assignment.role) {
      parts.push(`${agentName} role: ${assignment.role.role} (${assignment.role.focus})`)
    }
    if (assignment.project) {
      parts.push(`Current village project: ${assignment.project.title}. Goal: ${assignment.project.goal}`)
      const todo = (assignment.project.checklist || []).find(item => !item.done)
      if (todo) parts.push(`Next checklist item: ${todo.text}.`)
    }
    if (assignment.shortage) {
      parts.push(`Resource shortage: ${assignment.shortage.name} ${assignment.shortage.current}/${assignment.shortage.target} ${assignment.shortage.unit || ''}.`)
    }
    const publicInfrastructure = (this.state.infrastructures || []).filter(item => item.public).slice(-6)
    if (publicInfrastructure.length > 0) {
      parts.push('Known public infrastructure: ' + publicInfrastructure.map(item => `${item.title} at ${formatPosition(item.position)}`).join('; ') + '.')
    }
    parts.push('Work as a permanent resident, coordinate with other AI players, and deposit surplus materials into shared storage.')
    parts.push('When you start or finish a public facility, report it in chat exactly as VILLAGE_REPORT {"type":"storage|lighting|road|farm|mine|house|wall|landmark|other","title":"short name","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"what changed","projectId":"optional","checklistId":"optional"}.')
    return parts.join(' ')
  }

  load() {
    try {
      if (!fs.existsSync(this.dataPath)) return defaultVillageState()
      const parsed = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'))
      return normalizeVillageState(parsed)
    } catch (error) {
      if (this.logger) this.logger.warn(`Village state load failed: ${error.message}`)
      return defaultVillageState()
    }
  }

  saveThrottled() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, 2000)
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.dataPath), { recursive: true })
      fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2))
    } catch (error) {
      if (this.logger) this.logger.warn(`Village state save failed: ${error.message}`)
    }
  }

  ensureDefaults() {
    this.state = normalizeVillageState(this.state)
  }

  touch() {
    this.state.updatedAt = new Date().toISOString()
  }

  recordStoreEvent(method, payload) {
    if (!this.dataStore || typeof this.dataStore[method] !== 'function') return
    try {
      this.dataStore[method](payload)
    } catch (error) {
      if (this.logger) this.logger.warn('Village store mirror failed: ' + error.message)
    }
  }

  recordObservationIfUseful(role) {
    if (!this.dataStore || typeof this.dataStore.recordAgentObservation !== 'function') return

    const now = Date.now()
    const previous = this.lastObservationByAgent.get(role.agent) || {}
    const positionKey = role.lastPosition ? [
      Math.round(role.lastPosition.x),
      Math.round(role.lastPosition.y),
      Math.round(role.lastPosition.z)
    ].join(',') : ''
    const changed = previous.online !== role.online || previous.action !== role.lastAction || previous.positionKey !== positionKey
    const expired = !previous.at || now - previous.at > 60000
    if (!changed && !expired) return

    this.lastObservationByAgent.set(role.agent, {
      at: now,
      online: role.online,
      action: role.lastAction,
      positionKey
    })
    this.recordStoreEvent('recordAgentObservation', {
      agent: role.agent,
      online: role.online,
      action: role.lastAction,
      position: role.lastPosition,
      at: role.lastSeenAt
    })
  }
}

function defaultVillageState() {
  const now = new Date().toISOString()
  return {
    version: 1,
    updatedAt: now,
    commander: cloneJson(DEFAULT_COMMANDER),
    settlement: {
      name: 'AI Friend Village',
      base: null,
      publicChest: null,
      radius: 120,
      dimension: 'overworld',
      policy: 'AI 是常驻居民，围绕基地长期建设、采集、整理和保护。'
    },
    roles: cloneJson(DEFAULT_ROLES),
    resources: cloneJson(DEFAULT_RESOURCES),
    projects: cloneJson(DEFAULT_PROJECTS),
    infrastructures: [],
    taskEvents: [],
    notes: []
  }
}

function normalizeVillageState(value) {
  const base = defaultVillageState()
  const next = value && typeof value === 'object' ? value : {}
  return {
    ...base,
    ...next,
    commander: normalizeCommander(next.commander || base.commander),
    settlement: {
      ...base.settlement,
      ...(next.settlement && typeof next.settlement === 'object' ? next.settlement : {})
    },
    roles: mergeRoles(base.roles, Array.isArray(next.roles) ? next.roles : []),
    resources: mergeById(base.resources, Array.isArray(next.resources) ? next.resources.map(sanitizeResourcePatch) : []),
    projects: mergeById(base.projects, Array.isArray(next.projects) ? next.projects.map(sanitizeProjectPatch) : []),
    infrastructures: Array.isArray(next.infrastructures) ? next.infrastructures.map(item => sanitizeInfrastructureReport(item)).filter(Boolean) : [],
    taskEvents: Array.isArray(next.taskEvents) ? next.taskEvents.map(sanitizeTaskEvent).filter(Boolean).slice(-200) : [],
    notes: Array.isArray(next.notes) ? next.notes.slice(-100) : []
  }
}

function normalizeRole(value) {
  const role = value && typeof value === 'object' ? value : {}
  const roleId = normalizeRoleId(role.roleId || 'resident')
  return {
    agent: String(role.agent || '').trim(),
    role: String(role.role || '').trim() || '居民',
    roleId,
    focus: String(role.focus || '').trim(),
    persona: String(role.persona || defaultRolePersona(roleId)).trim().slice(0, 260),
    storageScope: String(role.storageScope || defaultRoleStorageScope(roleId)).trim().slice(0, 260),
    online: Boolean(role.online),
    lastSeenAt: role.lastSeenAt || '',
    lastPosition: role.lastPosition || null,
    lastAction: role.lastAction || ''
  }
}

function normalizeCommander(value) {
  const commander = value && typeof value === 'object' ? value : {}
  const duties = Array.isArray(commander.duties)
    ? commander.duties.map(item => String(item || '').trim()).filter(Boolean)
    : cloneJson(DEFAULT_COMMANDER.duties)
  for (const duty of DEFAULT_COMMANDER.duties) {
    if (!duties.includes(duty)) duties.push(duty)
  }
  const livestreamRole = String(commander.livestreamRole || DEFAULT_COMMANDER.livestreamRole).trim()
  return {
    name: String(commander.name || DEFAULT_COMMANDER.name).trim().slice(0, 40),
    title: String(commander.title || DEFAULT_COMMANDER.title).trim().slice(0, 40),
    persona: String(commander.persona || DEFAULT_COMMANDER.persona).trim().slice(0, 300),
    duties: duties.slice(0, 12),
    livestreamRole: livestreamRole.includes('轮流巡查') && livestreamRole !== DEFAULT_COMMANDER.livestreamRole ? DEFAULT_COMMANDER.livestreamRole : livestreamRole.slice(0, 300)
  }
}

function defaultRolePersona(roleId) {
  return {
    steward: '可靠的生存管家，优先处理安全、基础资源、公共箱子、食物和照明。',
    guard: '谨慎、可靠，优先处理危险、照明、怪物和夜间安全。',
    safety: '谨慎、可靠，优先处理危险、照明和基础安全。',
    builder: '稳重的建筑师，重视实用结构、道路、入口和可扩展空间。',
    quartermaster: '仓储管理员，关注公共箱子、资源归类、工具和补给。',
    scout: '短距离侦察员，记录路线、地标、危险点和周边资源。',
    farmer: '农业员，关注食物、作物、水源、动物和农田安全。',
    miner: '采矿员，关注石头、煤、铁、燃料和低风险矿道。',
    resident: '普通村民，根据村长安排补位。'
  }[roleId] || '普通村民，根据村长安排补位。'
}

function defaultRoleStorageScope(roleId) {
  return {
    steward: '安全日志、资源缺口、公共库存、食物、照明和紧急风险。',
    guard: '安全日志、危险点、照明缺口、怪物风险。',
    safety: '安全日志、危险点、照明缺口、怪物风险。',
    builder: '建筑草图、道路规划、房屋和公共设施记录。',
    quartermaster: '公共库存、材料缺口、箱子整理规则。',
    scout: '地图观察、路线、资源点、危险点和地标。',
    farmer: '农田、水源、作物、动物、食物库存和饥饿风险。',
    miner: '矿点入口、矿道安全、石头、煤、铁和燃料缺口。',
    resident: '个人任务记录和上报历史。'
  }[roleId] || '个人任务记录和上报历史。'
}

function inferRole(agentName) {
  return {
    agent: agentName,
    role: '居民',
    roleId: 'resident',
    focus: '根据村庄项目补位，优先安全、资源和公共建设。'
  }
}

function sanitizeSettlementPatch(value) {
  return stripUndefined({
    name: value.name === undefined ? undefined : String(value.name || '').trim().slice(0, 80),
    base: value.base === undefined ? undefined : sanitizePosition(value.base),
    publicChest: value.publicChest === undefined ? undefined : sanitizePosition(value.publicChest),
    radius: value.radius === undefined ? undefined : clampInteger(value.radius, 16, 512, 120),
    dimension: value.dimension === undefined ? undefined : String(value.dimension || 'overworld').trim().slice(0, 64),
    policy: value.policy === undefined ? undefined : String(value.policy || '').trim().slice(0, 600)
  })
}

function stripUndefined(value) {
  const clean = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined) clean[key] = item
  }
  return clean
}
function mergeRoles(defaults, existing) {
  const byAgent = new Map((defaults || []).map(role => {
    const clean = normalizeRole(role)
    return [clean.agent, clean]
  }))
  for (const role of existing || []) {
    const clean = normalizeRole(role)
    if (!clean.agent) continue
    const defaultRole = byAgent.get(clean.agent)
    byAgent.set(clean.agent, defaultRole ? { ...defaultRole, ...clean } : clean)
  }
  return Array.from(byAgent.values()).filter(role => role.agent)
}
function sanitizeResourcePatch(value) {
  const resource = value && typeof value === 'object' ? value : {}
  return {
    id: normalizeId(resource.id),
    name: String(resource.name || '').trim().slice(0, 80),
    target: clampInteger(resource.target, 0, 100000, 0),
    current: clampInteger(resource.current, 0, 100000, 0),
    unit: String(resource.unit || '').trim().slice(0, 16)
  }
}

function sanitizeProjectPatch(value) {
  const project = value && typeof value === 'object' ? value : {}
  return {
    id: normalizeId(project.id),
    title: String(project.title || '').trim().slice(0, 100),
    status: normalizeProjectStatus(project.status),
    priority: normalizePriority(project.priority),
    ownerRole: normalizeProjectOwnerRole(project.id, project.ownerRole || 'resident'),
    goal: String(project.goal || '').trim().slice(0, 500),
    checklist: Array.isArray(project.checklist) ? project.checklist.map(sanitizeChecklistItem).filter(item => item.id) : [],
    resourceNeeds: Array.isArray(project.resourceNeeds) ? project.resourceNeeds.map(normalizeId).filter(Boolean).slice(0, 12) : []
  }
}

function normalizeProjectOwnerRole(projectId, ownerRole) {
  const project = normalizeId(projectId)
  const role = normalizeRoleId(ownerRole || 'resident')
  if (project === 'safe-lighting' && role === 'safety') return 'guard'
  if (project === 'starter-farm' && role === 'scout') return 'farmer'
  return role
}
function sanitizeChecklistItem(value) {
  const item = value && typeof value === 'object' ? value : {}
  return {
    id: normalizeId(item.id),
    text: String(item.text || '').trim().slice(0, 160),
    done: Boolean(item.done)
  }
}

function parseAgentInfrastructureReport(message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message || '')
  const marker = text.match(/(?:VILLAGE_REPORT|村庄上报)\s*:?\s*(\{[\s\S]*\})/i)
  if (!marker) return null
  try {
    return JSON.parse(marker[1])
  } catch {
    return null
  }
}

function sanitizeTaskEvent(value) {
  const event = value && typeof value === 'object' ? value : {}
  const title = String(event.title || event.task || event.type || '任务事件').trim().slice(0, 120)
  if (!title) return null
  const now = new Date().toISOString()
  return {
    id: normalizeId(event.id || [event.agent, event.type || 'task', Date.now()].filter(Boolean).join('-')) || ('task-' + Date.now()),
    type: normalizeTaskEventType(event.type),
    status: normalizeTaskEventStatus(event.status),
    source: String(event.source || 'commander').trim().slice(0, 40),
    agent: String(event.agent || '').trim().slice(0, 32),
    title,
    description: String(event.description || event.detail || event.task || '').trim().slice(0, 800),
    projectId: normalizeId(event.projectId || event.project || ''),
    at: event.at || now
  }
}

function sanitizeInfrastructureReport(value) {
  const report = value && typeof value === 'object' ? value : {}
  const type = normalizeInfrastructureType(report.type)
  const title = String(report.title || report.name || typeLabel(type)).trim().slice(0, 100)
  if (!title) return null
  const position = sanitizePosition(report.position || { x: report.x, y: report.y, z: report.z })
  const id = normalizeId(report.id || [type, title, positionKey(position)].filter(Boolean).join('-')) || `report-${Date.now()}`
  const now = new Date().toISOString()
  return {
    id,
    type,
    title,
    status: normalizeInfrastructureStatus(report.status),
    public: report.public !== false,
    agent: String(report.agent || report.owner || '').trim().slice(0, 32),
    position,
    description: String(report.description || report.detail || '').trim().slice(0, 500),
    projectId: normalizeId(report.projectId || report.project || ''),
    checklistId: normalizeId(report.checklistId || report.checklist || ''),
    materials: Array.isArray(report.materials) ? report.materials.map(item => String(item || '').trim()).filter(Boolean).slice(0, 12) : [],
    createdAt: report.createdAt || now,
    updatedAt: now
  }
}

function applyInfrastructureReportToProjects(state, report) {
  if (report.public && report.type === 'storage' && report.position) {
    state.settlement.publicChest = report.position
  }
  if (report.status !== 'done') return

  const explicitProject = report.projectId ? state.projects.find(project => project.id === report.projectId) : null
  if (explicitProject && report.checklistId) {
    markChecklistDone(explicitProject, report.checklistId)
    completeProjectIfReady(explicitProject)
    return
  }

  const map = {
    storage: ['storage-hub', 'place-chest'],
    lighting: ['safe-lighting', 'light-chest'],
    wall: ['safe-lighting', 'safe-boundary'],
    farm: ['starter-farm', 'water-plot'],
    mine: ['starter-mine', 'mine-entry'],
    road: ['village-paths', 'main-path'],
    house: ['resident-houses', 'first-house'],
    shelter: ['resident-houses', 'first-house']
  }
  const target = map[report.type]
  if (!target) return
  const project = state.projects.find(item => item.id === target[0])
  if (!project) return
  markChecklistDone(project, target[1])
  if (project.status === 'planned') project.status = 'active'
  completeProjectIfReady(project)
}

function markChecklistDone(project, checklistId) {
  project.checklist = (project.checklist || []).map(item => item.id === checklistId ? { ...item, done: true } : item)
}

function completeProjectIfReady(project) {
  const checklist = project.checklist || []
  if (checklist.length > 0 && checklist.every(item => item.done)) project.status = 'done'
}

function infrastructureNote(report) {
  const position = report.position ? ` at ${formatPosition(report.position)}` : ''
  const status = report.status === 'done' ? '完成' : report.status === 'started' ? '开始' : report.status === 'blocked' ? '受阻' : '上报'
  return {
    id: `${report.id}-${Date.now()}`,
    at: report.updatedAt,
    type: 'infrastructure_report',
    agent: report.agent,
    reportId: report.id,
    text: `${report.agent || 'AI'} ${status}公共设施：${report.title}${position}`
  }
}

function normalizeTaskEventType(value) {
  const raw = normalizeId(value || 'assigned')
  return ['assigned', 'progress', 'completed', 'blocked', 'note'].includes(raw) ? raw : 'assigned'
}

function normalizeTaskEventStatus(value) {
  const raw = normalizeId(value || 'active')
  return ['active', 'done', 'blocked', 'info'].includes(raw) ? raw : 'active'
}

function normalizeInfrastructureType(value) {
  const raw = normalizeId(value || 'other')
  const aliases = {
    chest: 'storage',
    warehouse: 'storage',
    torch: 'lighting',
    light: 'lighting',
    path: 'road',
    shelter: 'shelter',
    base: 'shelter',
    home: 'house',
    fence: 'wall'
  }
  const type = aliases[raw] || raw
  return ['storage', 'lighting', 'road', 'farm', 'house', 'shelter', 'wall', 'bridge', 'mine', 'landmark', 'other'].includes(type) ? type : 'other'
}

function normalizeInfrastructureStatus(value) {
  const raw = normalizeId(value || 'done')
  return ['planned', 'started', 'done', 'blocked'].includes(raw) ? raw : 'done'
}

function typeLabel(type) {
  return {
    storage: '公共仓储',
    lighting: '照明',
    road: '道路',
    farm: '农场',
    house: '住宅',
    shelter: '庇护所',
    wall: '安全边界',
    bridge: '桥',
    mine: '矿点',
    landmark: '地标',
    other: '公共设施'
  }[type] || '公共设施'
}

function positionKey(position) {
  if (!position) return ''
  return `${Math.round(position.x)}-${Math.round(position.y)}-${Math.round(position.z)}`
}

function mergeById(existing, patches) {
  const byId = new Map((existing || []).filter(item => item && item.id).map(item => [item.id, cloneJson(item)]))
  for (const patch of patches || []) {
    if (!patch || !patch.id) continue
    byId.set(patch.id, { ...(byId.get(patch.id) || {}), ...patch })
  }
  return Array.from(byId.values())
}

function sanitizePosition(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}

function formatPosition(position) {
  if (!position) return 'unknown'
  return `X=${Number(position.x).toFixed(1)}, Y=${Number(position.y).toFixed(1)}, Z=${Number(position.z).toFixed(1)}`
}

function normalizeRoleId(value) {
  const roleId = normalizeId(value || 'resident')
  return {
    safety: 'steward',
    guard: 'steward',
    explorer: 'scout',
    gatherer: 'miner'
  }[roleId] || roleId
}

function normalizeProjectStatus(value) {
  return ['planned', 'active', 'blocked', 'done'].includes(value) ? value : 'planned'
}

function normalizePriority(value) {
  return ['P0', 'P1', 'P2', 'P3'].includes(value) ? value : 'P2'
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

module.exports = { VillageState, defaultVillageState }

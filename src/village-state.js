'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_ROLES = [
  {
    agent: 'Alex',
    role: '资源总管',
    roleId: 'steward',
    focus: '公共仓储、材料调度、住宅验收、施工排期、资源缺口和高级任务拆解。'
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
    focus: '低风险采矿、石头、煤、铁、金、燃料和矿点入口安全。'
  },
  {
    agent: 'Nova',
    role: '陆地侦察员',
    roleId: 'scout',
    focus: '陆地资源侦察、林地/动物/矿点坐标、地标记录和安全返回；不修路，不靠近水域。'
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
    '巡查居民当前动作，容忍短时间协作和代码生成；发现长时间闲聊、停顿、卡住、远离基地或夜晚未回基地时改派短行动',
    '记录公共设施、资源缺口和风险',
    '根据服务器难度调整安全策略：peaceful 以建设为主；easy/normal/hard 优先照明、床、门、围栏、武器、防具、食物和就近自卫，同时继续建镇、采矿、仓储、住宅、家具、农田和资源勘察',
    '作为直播观察者巡查村庄并回答观众问题'
  ],
  livestreamRole: '观察村庄建设进展，轮流巡查 Alex、Luna、Milo、Nova、Ivy，并用中文解释他们在做什么。'
}

const DEFAULT_RESOURCES = [
  { id: 'wood', name: '木头', target: 128, current: 0, unit: '个' },
  { id: 'stone', name: '石头/圆石', target: 192, current: 0, unit: '个' },
  { id: 'coal', name: '煤/木炭', target: 48, current: 0, unit: '个' },
  { id: 'iron', name: '铁/铁矿', target: 32, current: 0, unit: '个' },
  { id: 'gold', name: '金/金矿', target: 16, current: 0, unit: '个' },
  { id: 'food', name: '食物', target: 64, current: 0, unit: '份' },
  { id: 'torches', name: '火把', target: 96, current: 0, unit: '个' },
  { id: 'wool', name: '羊毛/床材料', target: 24, current: 0, unit: '个' },
  { id: 'beds', name: '床', target: 5, current: 0, unit: '张' }
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
    title: '基地照明和地形修整',
    status: 'planned',
    priority: 'P2',
    ownerRole: 'builder',
    goal: '根据当前难度做基地照明、坑洞封堵、水边标记、门、围栏和就近防御；easy/normal/hard 下优先保护基地和居民。',
    checklist: [
      { id: 'light-chest', text: '公共箱子和入口附近补光', done: false },
      { id: 'mark-hazards', text: '封堵或标记坑洞、水边、悬崖', done: false },
      { id: 'safe-boundary', text: '只在需要时建立低矮围栏或安全边界', done: false }
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
    goal: '在基地附近整理一个低风险矿点入口，优先提供石头、煤、铁、金和燃料；金矿必须铁镐或更高级。',
    checklist: [
      { id: 'mine-entry', text: '找到或整理安全矿点入口', done: false },
      { id: 'mine-light', text: '入口和前 20 格补光', done: false },
      { id: 'deposit-ore', text: '把石头、煤、铁、金放回公共箱子', done: false }
    ],
    resourceNeeds: ['stone', 'coal', 'iron', 'gold', 'torches']
  },
  {
    id: 'resource-survey',
    title: '陆地资源勘察',
    status: 'active',
    priority: 'P1',
    ownerRole: 'scout',
    goal: 'Nova 只负责陆地资源点、地标、林地、动物和矿点坐标记录；不修路、不下水、不靠近水边，发现资源后回公共箱上报。',
    checklist: [
      { id: 'forest-route', text: '记录最近林地或树苗来源坐标和返回路线', done: false },
      { id: 'animal-route', text: '记录羊群、牛群或鸡群坐标', done: false },
      { id: 'mine-landmark', text: '记录安全矿点或地表煤铁金位置', done: false },
      { id: 'return-report', text: '回公共箱上报路线、风险和返回点', done: false }
    ],
    resourceNeeds: ['wood', 'wool', 'food', 'iron', 'gold']
  },
  {
    id: 'village-paths',
    title: '村庄短连接',
    status: 'planned',
    priority: 'P2',
    ownerRole: 'builder',
    goal: '由建筑师在安全陆地上做短连接，暂不交给 Nova，避免侦察员反复掉水。',
    checklist: [
      { id: 'main-path', text: '只在干燥陆地连接基地入口到公共箱子', done: false },
      { id: 'farm-path', text: '连接农场和住宅，不跨水施工', done: false },
      { id: 'road-lights', text: '道路两侧补少量照明', done: false }
    ],
    resourceNeeds: ['stone', 'torches']
  },
  {
    id: 'resident-houses',
    title: '居民个人住宅',
    status: 'active',
    priority: 'P1',
    ownerRole: 'builder',
    goal: '每个 AI 居民都要拥有自己的小屋、床和基础家具；夜晚回自己的床睡觉，白天继续完善住宅和家具。',
    checklist: [
      { id: 'assign-plots', text: '给 Alex、Luna、Milo、Nova、Ivy 分配个人住宅地块', done: false },
      { id: 'alex-home', text: 'Alex 小屋：床、门、火把、个人箱子', done: false },
      { id: 'luna-home', text: 'Luna 小屋：床、门、火把、个人箱子/工作台', done: false },
      { id: 'milo-home', text: 'Milo 小屋：床、门、火把、个人箱子/熔炉', done: false },
      { id: 'nova-home', text: 'Nova 小屋：床、门、火把、个人箱子/地图标记', done: false },
      { id: 'ivy-home', text: 'Ivy 小屋：床、门、火把、个人箱子/花盆或农具角', done: false },
      { id: 'night-routine', text: '夜晚居民回到自己的床睡觉', done: false }
    ],
    resourceNeeds: ['wood', 'stone', 'wool', 'beds', 'torches']
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

  syncProjectProgress(facts = {}) {
    this.ensureDefaults()
    const changes = inferProjectProgress(this.state, facts)
    if (changes.length === 0) return { ok: true, changed: false, changes: [], village: this.snapshot() }

    const now = new Date().toISOString()
    const event = sanitizeTaskEvent({
      id: 'project-progress-' + Date.now(),
      type: 'progress',
      status: 'info',
      source: 'project-sync',
      agent: 'Airi',
      title: '自动同步项目进度',
      description: changes.map(item => `${item.projectTitle}：${item.checkText}`).join('；'),
      at: now
    })
    if (event) {
      this.state.taskEvents.push(event)
      this.state.taskEvents = this.state.taskEvents.slice(-200)
      this.recordStoreEvent('recordTaskEvent', event)
    }

    this.touch()
    this.save()
    return { ok: true, changed: true, changes, village: this.snapshot() }
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
    if (this.state.commander) parts.push(`村长：${this.state.commander.title} ${this.state.commander.name}。${this.state.commander.persona}`)
    if (assignment.settlement && assignment.settlement.name) parts.push('村庄名称：' + assignment.settlement.name + '。')
    if (assignment.settlement && assignment.settlement.base) {
      parts.push(`村庄基地坐标是 ${formatPosition(assignment.settlement.base)}，活动半径 ${assignment.settlement.radius || 120}。`)
    }
    if (assignment.settlement && assignment.settlement.publicChest) {
      parts.push(`公共箱子坐标是 ${formatPosition(assignment.settlement.publicChest)}。`)
    }
    if (assignment.role) {
      parts.push(`${agentName} 的角色：${assignment.role.role}（${assignment.role.focus}）`)
    }
    const homePlan = personalHomePlan(agentName, assignment.settlement && assignment.settlement.base)
    if (homePlan) {
      parts.push(`${agentName} 的个人住宅：${homePlan.name}，住宅中心 ${formatPosition(homePlan.center)}，床位 ${formatPosition(homePlan.bed)}，门口 ${formatPosition(homePlan.door)}。家具清单：床、门、火把、个人箱子，再按职业补 ${homePlan.furniture}。夜晚优先回自己的床睡觉。`)
    }
    if (assignment.project) {
      parts.push(`当前村庄项目：${assignment.project.title}。目标：${assignment.project.goal}`)
      const todo = (assignment.project.checklist || []).find(item => !item.done)
      if (todo) parts.push(`下一项清单：${todo.text}。`)
    }
    if (assignment.shortage) {
      parts.push(`资源缺口：${assignment.shortage.name} ${assignment.shortage.current}/${assignment.shortage.target} ${assignment.shortage.unit || ''}。`)
    }
    const publicInfrastructure = (this.state.infrastructures || []).filter(item => item.public).slice(-6)
    if (publicInfrastructure.length > 0) {
      parts.push('已知公共设施：' + publicInfrastructure.map(item => `${item.title} 位于 ${formatPosition(item.position)}`).join('；') + '。')
    }
    parts.push('你要像常驻居民一样行动，与其他 AI 玩家协作，把多余材料存入公共箱子。')
    parts.push('开始、完成或受阻于公共设施时，请在聊天里准确上报：VILLAGE_REPORT {"type":"storage|lighting|road|farm|mine|house|wall|landmark|other","title":"中文短名","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"中文说明","projectId":"optional","checklistId":"optional"}。')
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
    steward: '可靠的资源总管，优先处理公共仓储、材料调度、住宅验收、资源缺口和高级任务拆解。',
    guard: '谨慎、可靠，优先处理危险、照明、怪物和夜间安全。',
    safety: '谨慎、可靠，优先处理危险、照明和基础安全。',
    builder: '稳重的建筑师，重视实用结构、道路、入口和可扩展空间。',
    quartermaster: '仓储管理员，关注公共箱子、资源归类、工具和补给。',
    scout: '陆地资源侦察员，记录林地、动物、矿点和地标；不修路、不下水、不靠近水域。',
    farmer: '农业员，关注食物、作物、水源、动物和农田安全。',
    miner: '采矿员，关注石头、煤、铁、金、燃料和低风险矿道；金矿必须铁镐或更高级。',
    resident: '普通村民，根据村长安排补位。'
  }[roleId] || '普通村民，根据村长安排补位。'
}

function defaultRoleStorageScope(roleId) {
  return {
    steward: '公共库存、材料缺口、材料包、住宅验收、施工排期和资源调度。',
    guard: '安全日志、危险点、照明缺口、怪物风险。',
    safety: '安全日志、危险点、照明缺口、怪物风险。',
    builder: '建筑草图、道路规划、房屋和公共设施记录。',
    quartermaster: '公共库存、材料缺口、箱子整理规则。',
    scout: '陆地资源点、林地/动物/矿点坐标、返回路线和地标。',
    farmer: '农田、水源、作物、动物、食物库存和饥饿风险。',
    miner: '矿点入口、矿道安全、石头、煤、铁、金和燃料缺口。',
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
    radius: value.radius === undefined ? undefined : clampInteger(value.radius, 16, 5000, 120),
    dimension: value.dimension === undefined ? undefined : String(value.dimension || 'overworld').trim().slice(0, 64),
    policy: value.policy === undefined ? undefined : String(value.policy || '').trim().slice(0, 1400)
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
    markProjectChecklistDone(explicitProject, report.checklistId)
    return
  }

  for (const target of inferReportChecklistTargets(report)) {
    const project = state.projects.find(item => item.id === target.projectId)
    if (!project) continue
    markProjectChecklistDone(project, target.checklistId)
  }
}
function markChecklistDone(project, checklistId) {
  project.checklist = (project.checklist || []).map(item => item.id === checklistId ? { ...item, done: true } : item)
}

function completeProjectIfReady(project) {
  const checklist = project.checklist || []
  if (checklist.length > 0 && checklist.every(item => item.done)) project.status = 'done'
}

function inferProjectProgress(state, facts = {}) {
  const changes = []
  const resources = resourceFactsById(state, facts)
  const infrastructures = Array.isArray(state.infrastructures) ? state.infrastructures : []
  const roles = Array.isArray(state.roles) ? state.roles : []
  const okChests = Array.isArray(facts.chests) ? facts.chests.filter(chest => chest && chest.ok) : []
  const hasPublicChest = Boolean((state.settlement && state.settlement.publicChest) || okChests.length > 0 || hasReport(infrastructures, { type: 'storage', status: 'done' }))
  const chestCategoryCount = countPositiveCategories(okChests.map(chest => chest.summary))
  const resourceReportCount = infrastructures.filter(item => item && item.type === 'resource').length
  const onlineResidentCount = roles.filter(role => role.online).length
  const hasBase = Boolean(state.settlement && state.settlement.base)

  if (hasPublicChest) markProjectChecklistDoneByState(state, 'storage-hub', 'place-chest', changes)
  if (chestCategoryCount >= 2 || hasReportText(infrastructures, 'storage', /存入|归仓|归库|入库|deposit|storage/i)) {
    markProjectChecklistDoneByState(state, 'storage-hub', 'deposit-basics', changes)
  }
  if (chestCategoryCount >= 4 || hasReportText(infrastructures, 'storage', /整理|分类|sort|organized/i)) {
    markProjectChecklistDoneByState(state, 'storage-hub', 'sort-basic', changes)
  }
  if (hasReportText(infrastructures, 'storage', /标记|入口|路标|补光|火把|marker|light/i)) {
    markProjectChecklistDoneByState(state, 'storage-hub', 'mark-storage', changes)
  }

  if (resource(resources, 'torches', 'current') >= 48 || hasReport(infrastructures, { type: 'lighting', status: 'done' })) {
    markProjectChecklistDoneByState(state, 'safe-lighting', 'light-chest', changes)
  }
  if (hasReportText(infrastructures, '', /坑洞|水边|悬崖|危险|hazard|risk/i)) {
    markProjectChecklistDoneByState(state, 'safe-lighting', 'mark-hazards', changes)
  }
  if (hasReport(infrastructures, { type: 'wall', status: 'done' })) {
    markProjectChecklistDoneByState(state, 'safe-lighting', 'safe-boundary', changes)
  }

  if (hasReport(infrastructures, { type: 'farm' }) || residentDoing(roles, 'Ivy', /farm|harvest|crop|农|作物|收割/i)) {
    markProjectChecklistDoneByState(state, 'starter-farm', 'water-plot', changes)
  }
  if (hasReport(infrastructures, { type: 'farm', status: 'done' }) || resource(resources, 'food', 'current') >= 64) {
    markProjectChecklistDoneByState(state, 'starter-farm', 'plant-crops', changes)
  }
  if (hasReportText(infrastructures, 'farm', /火把|补光|照明|light|torch/i)) {
    markProjectChecklistDoneByState(state, 'starter-farm', 'farm-light', changes)
  }

  if (hasReport(infrastructures, { type: 'mine' }) || residentUnderground(roles, 'Milo') || resource(resources, 'stone', 'current') >= 192) {
    markProjectChecklistDoneByState(state, 'starter-mine', 'mine-entry', changes)
  }
  if (hasReportText(infrastructures, 'mine', /火把|补光|入口|light|torch/i) || resource(resources, 'coal', 'current') >= 32) {
    markProjectChecklistDoneByState(state, 'starter-mine', 'mine-light', changes)
  }
  if (resource(resources, 'stone', 'current') >= 192 && (resource(resources, 'coal', 'current') >= 32 || resource(resources, 'iron', 'current') > 0 || resource(resources, 'gold', 'current') > 0)) {
    markProjectChecklistDoneByState(state, 'starter-mine', 'deposit-ore', changes)
  }

  if (resource(resources, 'wood', 'current') >= 128 || hasReportText(infrastructures, 'resource', /森林|林地|树|木头|原木|forest|tree|wood/i)) {
    markProjectChecklistDoneByState(state, 'resource-survey', 'forest-route', changes)
  }
  if (resource(resources, 'wool', 'current') > 0 || hasReportText(infrastructures, 'resource', /羊|牛|鸡|猪|动物|animal|sheep|cow|chicken|pig/i)) {
    markProjectChecklistDoneByState(state, 'resource-survey', 'animal-route', changes)
  }
  if (resource(resources, 'iron', 'current') > 0 || resource(resources, 'gold', 'current') > 0 || hasReportText(infrastructures, 'resource', /矿|煤|铁|金|ore|coal|iron|gold/i)) {
    markProjectChecklistDoneByState(state, 'resource-survey', 'mine-landmark', changes)
  }
  if (resourceReportCount >= 2 || hasReportText(infrastructures, 'resource', /返回|路线|风险|回库|return|route|risk/i)) {
    markProjectChecklistDoneByState(state, 'resource-survey', 'return-report', changes)
  }

  if (hasReport(infrastructures, { type: 'road', status: 'done' })) {
    markProjectChecklistDoneByState(state, 'village-paths', 'main-path', changes)
  }
  if (hasReportText(infrastructures, 'road', /农场|住宅|farm|house|home/i)) {
    markProjectChecklistDoneByState(state, 'village-paths', 'farm-path', changes)
  }
  if (hasReportText(infrastructures, 'road', /火把|补光|照明|light|torch/i)) {
    markProjectChecklistDoneByState(state, 'village-paths', 'road-lights', changes)
  }

  if (hasBase && roles.length >= 3) markProjectChecklistDoneByState(state, 'resident-houses', 'assign-plots', changes)
  for (const agent of ['Alex', 'Luna', 'Milo', 'Nova', 'Ivy']) {
    if (hasHouseReport(infrastructures, agent)) {
      markProjectChecklistDoneByState(state, 'resident-houses', `${agent.toLowerCase()}-home`, changes)
    }
  }
  if (resource(resources, 'beds', 'current') >= Math.max(1, onlineResidentCount)) {
    markProjectChecklistDoneByState(state, 'resident-houses', 'night-routine', changes)
  }

  return changes
}

function resourceFactsById(state, facts) {
  const byId = new Map()
  for (const item of Array.isArray(state.resources) ? state.resources : []) {
    if (item && item.id) byId.set(item.id, { ...item })
  }
  for (const item of Array.isArray(facts.resources) ? facts.resources : []) {
    if (!item || !item.id) continue
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item })
  }
  return byId
}

function resource(resources, id, key) {
  const item = resources.get(id) || {}
  const value = Number(item[key] === undefined ? item.current : item[key])
  return Number.isFinite(value) ? value : 0
}

function countPositiveCategories(summaries) {
  const categories = new Set()
  for (const summary of summaries || []) {
    for (const [key, value] of Object.entries(summary || {})) {
      if (Number(value || 0) > 0) categories.add(key)
    }
  }
  return categories.size
}

function hasReport(infrastructures, query = {}) {
  return (infrastructures || []).some(report => {
    if (!report) return false
    if (query.type && report.type !== query.type) return false
    if (query.status && report.status !== query.status) return false
    return true
  })
}

function hasReportText(infrastructures, type, pattern) {
  return (infrastructures || []).some(report => {
    if (!report) return false
    if (type && report.type !== type) return false
    return pattern.test(reportText(report))
  })
}

function reportText(report) {
  return [report.title, report.description, report.agent, report.type].map(item => String(item || '')).join(' ')
}

function residentDoing(roles, agent, pattern) {
  const role = (roles || []).find(item => item.agent === agent)
  return Boolean(role && pattern.test(String(role.lastAction || '')))
}

function residentUnderground(roles, agent) {
  const role = (roles || []).find(item => item.agent === agent)
  const position = role && role.lastPosition
  return Boolean(position && Number(position.y) < 55)
}

function hasHouseReport(infrastructures, agent) {
  const expected = String(agent || '').toLowerCase()
  return (infrastructures || []).some(report => {
    if (!report || report.type !== 'house' || report.status !== 'done') return false
    const reporter = String(report.agent || '').toLowerCase()
    const text = reportText(report).toLowerCase()
    return reporter === expected || text.includes(expected)
  })
}

function inferReportChecklistTargets(report) {
  const text = reportText(report)
  const targets = []
  if (report.type === 'storage') {
    targets.push({ projectId: 'storage-hub', checklistId: 'place-chest' })
    if (/存入|归仓|归库|入库|deposit|storage/i.test(text)) targets.push({ projectId: 'storage-hub', checklistId: 'deposit-basics' })
    if (/整理|分类|sort|organized/i.test(text)) targets.push({ projectId: 'storage-hub', checklistId: 'sort-basic' })
    if (/标记|入口|路标|补光|火把|marker|light/i.test(text)) targets.push({ projectId: 'storage-hub', checklistId: 'mark-storage' })
  }
  if (report.type === 'lighting') targets.push({ projectId: 'safe-lighting', checklistId: 'light-chest' })
  if (report.type === 'wall') targets.push({ projectId: 'safe-lighting', checklistId: 'safe-boundary' })
  if (report.type === 'farm') {
    targets.push({ projectId: 'starter-farm', checklistId: 'water-plot' })
    if (/播种|种植|作物|小麦|胡萝卜|土豆|plant|crop/i.test(text)) targets.push({ projectId: 'starter-farm', checklistId: 'plant-crops' })
    if (/火把|补光|照明|light|torch/i.test(text)) targets.push({ projectId: 'starter-farm', checklistId: 'farm-light' })
  }
  if (report.type === 'mine') {
    targets.push({ projectId: 'starter-mine', checklistId: 'mine-entry' })
    if (/火把|补光|入口|light|torch/i.test(text)) targets.push({ projectId: 'starter-mine', checklistId: 'mine-light' })
    if (/入库|归仓|煤|铁|金|石头|圆石|deposit|coal|iron|gold|stone/i.test(text)) targets.push({ projectId: 'starter-mine', checklistId: 'deposit-ore' })
  }
  if (report.type === 'resource') {
    if (/森林|林地|树|木头|原木|forest|tree|wood/i.test(text)) targets.push({ projectId: 'resource-survey', checklistId: 'forest-route' })
    if (/羊|牛|鸡|猪|动物|animal|sheep|cow|chicken|pig/i.test(text)) targets.push({ projectId: 'resource-survey', checklistId: 'animal-route' })
    if (/矿|煤|铁|金|ore|coal|iron|gold/i.test(text)) targets.push({ projectId: 'resource-survey', checklistId: 'mine-landmark' })
    if (/返回|路线|风险|回库|return|route|risk/i.test(text)) targets.push({ projectId: 'resource-survey', checklistId: 'return-report' })
  }
  if (report.type === 'road') {
    targets.push({ projectId: 'village-paths', checklistId: 'main-path' })
    if (/农场|住宅|farm|house|home/i.test(text)) targets.push({ projectId: 'village-paths', checklistId: 'farm-path' })
    if (/火把|补光|照明|light|torch/i.test(text)) targets.push({ projectId: 'village-paths', checklistId: 'road-lights' })
  }
  if (report.type === 'house' || report.type === 'shelter') {
    for (const agent of ['alex', 'luna', 'milo', 'nova', 'ivy']) {
      if (text.toLowerCase().includes(agent)) targets.push({ projectId: 'resident-houses', checklistId: `${agent}-home` })
    }
  }
  return targets
}

function markProjectChecklistDoneByState(state, projectId, checklistId, changes) {
  const project = (state.projects || []).find(item => item.id === projectId)
  if (!project) return false
  return markProjectChecklistDone(project, checklistId, changes)
}

function markProjectChecklistDone(project, checklistId, changes = []) {
  let changed = false
  project.checklist = (project.checklist || []).map(item => {
    if (item.id !== checklistId || item.done) return item
    changed = true
    changes.push({
      projectId: project.id,
      projectTitle: project.title || project.id,
      checklistId,
      checkText: item.text || checklistId
    })
    return { ...item, done: true }
  })
  if (!changed) return false
  if (project.status === 'planned') project.status = 'active'
  completeProjectIfReady(project)
  return true
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
    fence: 'wall',
    forest: 'resource',
    tree: 'resource',
    animal: 'resource',
    ore: 'resource',
    resource_point: 'resource'
  }
  const type = aliases[raw] || raw
  return ['storage', 'resource', 'lighting', 'road', 'farm', 'house', 'shelter', 'wall', 'bridge', 'mine', 'landmark', 'other'].includes(type) ? type : 'other'
}

function normalizeInfrastructureStatus(value) {
  const raw = normalizeId(value || 'done')
  return ['planned', 'started', 'done', 'blocked'].includes(raw) ? raw : 'done'
}

function typeLabel(type) {
  return {
    storage: '公共仓储',
    resource: '资源点',
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

function personalHomePlan(agentName, base) {
  if (!base) return null
  const layout = {
    Alex: { dx: -12, dz: 8, name: 'Alex 的管家小屋', furniture: '工具架/公共安全记录角' },
    Luna: { dx: -4, dz: 12, name: 'Luna 的建筑师小屋', furniture: '工作台/材料样板角' },
    Milo: { dx: 4, dz: 12, name: 'Milo 的矿工小屋', furniture: '熔炉/矿石箱' },
    Nova: { dx: 12, dz: 8, name: 'Nova 的侦察员小屋', furniture: '地图/路标材料箱' },
    Ivy: { dx: 12, dz: -2, name: 'Ivy 的农夫小屋', furniture: '花盆/种子箱/农具角' }
  }
  const item = layout[String(agentName || '')] || { dx: 0, dz: 14, name: `${agentName || '居民'} 的小屋`, furniture: '个人箱子' }
  const center = offsetPosition(base, item.dx, 0, item.dz)
  return {
    name: item.name,
    center,
    bed: offsetPosition(center, 1, 0, 1),
    door: offsetPosition(center, 0, 0, -2),
    furniture: item.furniture
  }
}

function offsetPosition(position, dx = 0, dy = 0, dz = 0) {
  if (!position) return null
  return {
    x: Math.round(Number(position.x || 0) + dx),
    y: Math.round(Number(position.y || 64) + dy),
    z: Math.round(Number(position.z || 0) + dz)
  }
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

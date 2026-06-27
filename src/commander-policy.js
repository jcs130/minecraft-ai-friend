'use strict'

const CHAT_GRACE_MS = 2 * 60 * 1000
const STOPPED_GRACE_MS = 2 * 60 * 1000
const IDLE_GRACE_MS = 3 * 60 * 1000
const STAY_GRACE_MS = 2 * 60 * 1000
const ACTIVE_ACTION_GRACE_MS = 8 * 60 * 1000
const PLANNING_ACTION_GRACE_MS = 7 * 60 * 1000
const SLEEP_ACTION_GRACE_MS = 2 * 60 * 1000
const INTERVENTION_COOLDOWN_MS = 3 * 60 * 1000
const NON_URGENT_MIN_INSTRUCTION_AGE_MS = 3 * 60 * 1000
const WATER_GRACE_MS = 20000
const WATER_TELEPORT_MS = 2 * 60 * 1000
const WATER_TELEPORT_MIN_ATTEMPTS = 3
const SERVER_COMMAND_COOLDOWN_MS = 3 * 60 * 1000
const RESTART_MIN_ATTEMPTS = 8
const RESTART_STUCK_MS = 8 * 60 * 1000
const RESTART_COOLDOWN_MS = 15 * 60 * 1000

function decideCommanderIntervention(input) {
  const agentName = input.agentName
  const summary = input.summary || {}
  const memory = input.memory || {}
  const now = Number(input.now || Date.now())
  const assignment = input.assignment || {}
  const settlement = input.settlement || {}
  const base = settlement.base || (assignment.settlement && assignment.settlement.base) || null
  const chest = settlement.publicChest || (assignment.settlement && assignment.settlement.publicChest) || base
  const action = String(summary.currentAction || '').trim()
  const staying = /^action:stay$/i.test(action) || /^stay$/i.test(action)
  const idle = Boolean(summary.isIdle) || staying
  const chatting = idle && /^chatting/i.test(action)
  const stopped = idle && /^stopped$/i.test(action)
  const observation = updateObservationMemory(memory, summary, action, now)
  const lastInstructionAge = now - Number(memory.lastInstructionAt || 0)
  const lastInterventionAge = now - Number(memory.lastCommanderInterventionAt || 0)
  const actionAge = now - Number(observation.actionSince || now)
  const noProgressAge = now - Number(observation.progressAt || now)
  const inWater = isWaterState(summary)
  if (inWater && !memory.commanderWaterSince) memory.commanderWaterSince = now
  if (!inWater) memory.commanderWaterSince = 0
  const waterAge = inWater ? now - Number(memory.commanderWaterSince || now) : 0
  const health = Number(summary.health || 20)
  const hunger = Number(summary.hunger || 20)
  const vitalEmergency = health <= 8 || hunger <= 6

  const serverCommandCoolingDown = now - Number(memory.lastCommanderServerCommandAt || 0) < SERVER_COMMAND_COOLDOWN_MS
  const urgentWaterTeleportAllowed = inWater && waterAge > WATER_TELEPORT_MS && !serverCommandCoolingDown
  if (lastInterventionAge < INTERVENTION_COOLDOWN_MS && !urgentWaterTeleportAllowed && !vitalEmergency) return null

  let reason = ''
  if (health <= 8) reason = '生命危险，强制回基地保命'
  else if (hunger <= 6) reason = '饥饿危险，强制回基地找食物'
  else if (inWater && (waterAge > WATER_GRACE_MS || stopped || chatting || /collect|search|attack|goto|path|move/i.test(action))) reason = '落水或水中卡住'
  else if (chatting && actionAge > CHAT_GRACE_MS && lastInstructionAge > CHAT_GRACE_MS) reason = '闲聊过久'
  else if (stopped && actionAge > STOPPED_GRACE_MS && lastInstructionAge > STOPPED_GRACE_MS) reason = '停顿过久'
  else if (!idle && /newAction/i.test(action) && actionAge > PLANNING_ACTION_GRACE_MS && noProgressAge > PLANNING_ACTION_GRACE_MS) reason = '规划过久未行动'
  else if (staying && actionAge > STAY_GRACE_MS && lastInstructionAge > STAY_GRACE_MS) reason = '等待过久'
  else if (hasRecentUnresolvedStuck(memory) && noProgressAge > STOPPED_GRACE_MS) reason = '卡住或脱困失败'
  else if (!idle && /goToBed|sleep/i.test(action) && actionAge > SLEEP_ACTION_GRACE_MS && noProgressAge > SLEEP_ACTION_GRACE_MS) reason = '睡觉动作无进展'
  else if (!idle && isLongRunningAction(action) && actionAge > ACTIVE_ACTION_GRACE_MS && noProgressAge > ACTIVE_ACTION_GRACE_MS) reason = '动作执行无进展'
  else if (idle && base && summary.position && distance2d(summary.position, base) > 900 && actionAge > 45000 && lastInstructionAge > 90000) reason = '远程探索后回库'
  if (!reason) return null
  const urgentIntervention = /生命危险|饥饿危险|落水|水中/.test(reason)
  if (!urgentIntervention && lastInstructionAge < NON_URGENT_MIN_INSTRUCTION_AGE_MS) return null

  memory.lastCommanderInterventionAt = now
  memory.commanderInterventionAttempts = Number(memory.commanderInterventionAttempts || 0) + 1
  memory.lastRecoveryAt = now
  memory.recoveryAttempts = memory.commanderInterventionAttempts

  const projectId = assignment.project && assignment.project.id ? assignment.project.id : 'safe-lighting'
  const roleId = assignment && assignment.role ? assignment.role.roleId : ''
  const inventory = summary.inventory && summary.inventory.counts ? summary.inventory.counts : {}
  const usefulCargo = hasUsefulResourceCargo(inventory)
  const title = `村长干预：${reason}`
  const description = `${agentName} 当前动作为“${action || '未知'}”，已持续约 ${Math.round(actionAge / 1000)} 秒；村长改派短行动。`
  if (/生命危险|饥饿危险/.test(reason)) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = !serverCommandCoolingDown ? teleportCommand(agentName, target) : ''
    return {
      type: serverCommand ? 'server-command' : 'task',
      source: 'ai-commander-vital-rescue',
      reason,
      title: '村长紧急保命：' + reason,
      description: description + (serverCommand ? ' 服务端执行：' + serverCommand : ' 本轮不执行服务端命令，改派保命行动。'),
      projectId,
      serverCommand,
      task: buildVitalRecoveryTask(agentName, reason, summary, base, chest)
    }
  }
  const canRestart = !chatting && (stopped || reason === '卡住或脱困失败' || reason === '落水或水中卡住' || reason === '睡觉动作无进展' || reason === '动作执行无进展' || reason === '空闲过久' || reason === '等待过久' || reason === '停顿过久' || reason === '规划过久未行动')
  const lowWaterTrap = summary.position && Number(summary.position.y || 64) < 63
  const undergroundTrap = summary.position && Number(summary.position.y || 64) < 61
  const confirmedStuckTrap = /卡住|脱困|动作执行无进展|规划过久/i.test(reason)
  const hardUndergroundTrap = undergroundTrap && confirmedStuckTrap && (
    hasRecentUnresolvedStuck(memory) ||
    /climbToSurface|goToSurface/i.test(action) ||
    Number(summary.position.y || 64) < 50 && memory.commanderInterventionAttempts >= 2 ||
    memory.commanderInterventionAttempts >= 3
  )
  if (/落水|水中/i.test(reason) && !serverCommandCoolingDown && (lowWaterTrap || waterAge > 90000 || memory.commanderInterventionAttempts >= 3)) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-water-rescue',
        reason,
        title: '村长强制传送脱困：' + reason,
        description: description + ' 水中/低处脱困失败风险高，直接服务端执行：' + serverCommand,
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, roleId, target, projectId)
      }
    }
  }
  if (/落水|水中/i.test(reason) && !serverCommandCoolingDown && base && summary.position && distance2d(summary.position, base) > 250 && (roleId === 'scout' || usefulCargo || memory.commanderInterventionAttempts >= 3)) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-water-rescue',
        reason,
        title: '村长传送脱困并回库：' + reason,
        description: description + ' 侦察员远离基地且靠近水域/已携带资源，服务端执行：' + serverCommand,
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, roleId, target, projectId)
      }
    }
  }
  if (/落水|水中/i.test(reason) && !serverCommandCoolingDown && waterAge > WATER_TELEPORT_MS && memory.commanderInterventionAttempts >= WATER_TELEPORT_MIN_ATTEMPTS) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-water-rescue',
        reason,
        title: '村长传送脱困：' + reason,
        description: description + ' 已在水中约 ' + Math.round(waterAge / 1000) + ' 秒，服务端执行：' + serverCommand,
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, roleId, target, projectId)
      }
    }
  }
  if (/远程探索后回库/i.test(reason) && !serverCommandCoolingDown) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-teleport-return',
        reason,
        title: '村长瞬移回库：远程探索后回公共箱',
        description: description + ' 距离基地过远且已停止，服务端执行：' + serverCommand,
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, assignment && assignment.role ? assignment.role.roleId : '', target, projectId)
      }
    }
  }
  if (/卡住|脱困|停顿|动作执行无进展|规划过久/i.test(reason) && !serverCommandCoolingDown && hardUndergroundTrap) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-underground-rescue',
        reason,
        title: '村长传送脱困：地下受阻',
        description: description + ' 地下确认受阻，不再使用 climbToSurface，服务端执行：' + serverCommand,
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, roleId, target, projectId)
      }
    }
  }

  if (canRestart && memory.commanderInterventionAttempts >= RESTART_MIN_ATTEMPTS && noProgressAge > RESTART_STUCK_MS && now - Number(memory.lastAgentRestartAt || 0) > RESTART_COOLDOWN_MS) {
    return {
      type: 'restart',
      source: 'ai-commander-guardrail',
      reason,
      title: `村长重启：${reason}`,
      description,
      projectId,
      task: buildCommanderRecoveryTask(agentName, reason, summary, base, chest, assignment, memory.commanderInterventionAttempts)
    }
  }

  return {
    type: 'task',
    source: 'ai-commander-guardrail',
    reason,
    title,
    description,
    projectId,
    task: buildCommanderRecoveryTask(agentName, reason, summary, base, chest, assignment, memory.commanderInterventionAttempts)
  }
}

function decideCommanderTask(input) {
  const agentName = input.agentName
  const summary = input.summary || {}
  const memory = input.memory || {}
  const assignment = input.assignment || {}
  const settlement = input.settlement || {}
  const village = input.village || {}
  const allAgentMemory = input.allAgentMemory || {}
  const taskIndex = Number(input.taskIndex || 0)
  const roleId = assignment && assignment.role ? assignment.role.roleId : ''
  const base = settlement.base || (assignment.settlement && assignment.settlement.base) || (village.settlement && village.settlement.base) || null
  const chest = settlement.publicChest || (assignment.settlement && assignment.settlement.publicChest) || (village.settlement && village.settlement.publicChest) || base
  const assessment = assessVillageSituation({ summary, memory, allAgentMemory, village, roleId })
  const projectId = assignment.project && assignment.project.id ? assignment.project.id : projectForRole(roleId, assessment)
  const reason = roleAwareReason(roleId, assessment)
  const teleportDecision = buildTeleportExplorationDecision(agentName, roleId, base, chest, summary, assessment, village, taskIndex, projectId, reason)
  if (teleportDecision) return teleportDecision
  const task = buildAutonomousCommanderTask(agentName, roleId, base, chest, summary, assessment, assignment, taskIndex)
  return {
    type: 'task',
    source: 'ai-commander-policy',
    title: `村长判断：${reason}`,
    reason,
    projectId,
    task
  }
}

function buildTeleportExplorationDecision(agentName, roleId, base, chest, summary, assessment, village, taskIndex, projectId, reason) {
  if (!base || !summary || !summary.position) return null
  if (assessment.inWater || assessment.stuck || assessment.night) return null
  const distanceFromBase = distance2d(summary.position, base)
  const usefulCargo = hasUsefulResourceCargo(summary.inventory && summary.inventory.counts ? summary.inventory.counts : {})
  if (distanceFromBase > 450 && (summary.isIdle || usefulCargo) && (roleId === 'scout' || usefulCargo || distanceFromBase > 900)) {
    const target = safeChestAccessPoint(chest, base)
    const serverCommand = teleportCommand(agentName, target)
    if (serverCommand) {
      return {
        type: 'server-command',
        source: 'ai-commander-teleport-return',
        reason: '远程探索后回库',
        title: '村长瞬移回库：远程探索后回公共箱',
        description: agentName + ' 距离基地约 ' + Math.round(distanceFromBase) + ' 格，村长允许使用瞬移把资源带回公共箱。',
        projectId,
        serverCommand,
        task: buildPostTeleportReturnTask(agentName, roleId, chest || base, projectId)
      }
    }
  }

  const nearBase = distanceFromBase < 120
  const shouldExplore = nearBase && shouldUseExplorationTeleport(roleId, assessment, taskIndex)
  if (!shouldExplore) return null
  const knownPoint = roleId === 'scout' ? null : chooseKnownResourcePoint(village, roleId)
  const serverCommand = knownPoint ? teleportCommand(agentName, knownPoint.position) : spreadPlayersCommand(agentName, base, teleportRangeForRole(roleId))
  if (!serverCommand) return null
  const targetText = knownPoint ? (knownPoint.title + ' ' + formatPoint(knownPoint.position)) : '基地周边 5000 格内随机陆地区域'
  return {
    type: 'server-command',
    source: 'ai-commander-teleport-explore',
    reason: reason || '瞬移提升探索采集效率',
    title: '村长授权瞬移：' + roleLabel(roleId) + '资源探索',
    description: agentName + ' 被授权瞬移到 ' + targetText + '，用于提高探索和收集效率。',
    projectId,
    serverCommand,
    task: buildPostTeleportExploreTask(agentName, roleId, base, chest, targetText, projectId)
  }
}

function shouldUseExplorationTeleport(roleId, assessment, taskIndex) {
  const index = Math.abs(Number(taskIndex || 0))
  if (roleId === 'scout') return index % 3 === 0 && !hasUsefulResourceCargo(assessment.inventory || {})
  if (roleId === 'steward') return index % 3 === 0 && ['wood', 'wool', 'iron', 'coal', 'gold', 'beds'].some(id => assessment.shortageIds.includes(id))
  if (roleId === 'farmer') return false
  if (roleId === 'miner') return index % 5 === 0 && (assessment.shortageIds.includes('iron') || assessment.shortageIds.includes('coal') || assessment.shortageIds.includes('gold'))
  return false
}

function teleportRangeForRole(roleId) {
  if (roleId === 'scout') return 5000
  if (roleId === 'steward') return 2500
  if (roleId === 'farmer') return 1800
  if (roleId === 'miner') return 1600
  return 1200
}

function chooseKnownResourcePoint(village, roleId) {
  const infrastructures = Array.isArray(village && village.infrastructures) ? village.infrastructures : []
  const preferred = roleId === 'miner'
    ? /矿|煤|铁|金|coal|iron|gold|ore|mine/i
    : roleId === 'farmer'
      ? /羊|牛|鸡|动物|wool|food|sheep|cow|chicken/i
      : roleId === 'steward'
        ? /林|树|羊|矿|煤|铁|金|wood|wool|iron|coal|gold/i
        : /林|树|羊|牛|矿|煤|铁|金|wood|wool|iron|coal|gold/i
  const candidates = infrastructures
    .filter(item => item && item.public !== false && item.position && ['resource', 'mine', 'landmark', 'farm'].includes(item.type))
    .filter(item => preferred.test([item.title, item.description, item.type].join(' ')))
  const item = candidates[candidates.length - 1]
  return item ? { title: item.title || typeLabel(item.type), position: item.position } : null
}

function buildPostTeleportExploreTask(agentName, roleId, base, chest, targetText, projectId) {
  const focus = roleId === 'steward'
    ? 'Alex 作为资源总管，优先寻找木材、羊毛、铁、煤、金和可制作工具装备的材料，能采集就采集，背包有收获后回公共箱。'
    : roleId === 'scout'
      ? 'Nova 只做陆地资源勘察，不修路、不下水、不靠近水域；发现林地、羊群、牛群、煤矿、铁矿、金矿或安全矿点就上报坐标。'
      : roleId === 'miner'
        ? '优先寻找煤、铁、金或安全矿点；金矿必须铁镐或更高级，没铁镐先采铁/取铁锭做铁镐并记录金矿坐标。少量采集后回公共箱。'
        : '优先寻找羊、牛、鸡、食物和羊毛，拿到收获后回公共箱。'
  return [
    '村长已授权服务端瞬移到：' + targetText + '。这是允许的效率工具，不是失败恢复。',
    focus,
    '最多发送一句不超过 30 字的中文状态句，然后马上移动、搜索或采集；不要站在原地长篇解释。',
    '发现任何有价值资源点，立即发送 VILLAGE_REPORT {"type":"resource","title":"资源点中文名","status":"done","public":true,"position":{"x":0,"y":64,"z":0},"description":"资源类型、数量预估、返回路线和风险","projectId":"' + (projectId || 'resource-survey') + '"}。',
    '采集 1-2 组有价值材料后，优先回公共箱 ' + formatPoint(chest || base) + ' 入库；如果太远或卡住，用中文上报“需要回库瞬移”。'
  ].join(' ')
}

function buildPostTeleportReturnTask(agentName, roleId, target, projectId) {
  return [
    '村长已授权瞬移回公共箱/基地：' + formatPoint(target) + '。',
    '立刻把身上的木头、石头、煤、铁、金、食物、羊毛、树苗、工具或装备材料放入公共箱。',
    roleId === 'steward' ? 'Alex 入库后继续制作或调度工具、武器、护甲和住宅材料包给大家。' : '入库后用中文上报本次探索收获和发现的资源点。',
    '完成或受阻时发送 VILLAGE_REPORT {"type":"storage","title":"资源回库","status":"done","public":true,"position":{"x":0,"y":64,"z":0},"description":"本次带回的材料和下一步建议","projectId":"' + (projectId || 'storage-hub') + '"}。'
  ].join(' ')
}

function assessVillageSituation(input) {
  const roleId = input.roleId || ''
  const summary = input.summary || {}
  const memory = input.memory || {}
  const village = input.village || {}
  const allTexts = recentMemoryTexts(input.allAgentMemory).concat(recentMemoryTexts({ self: memory }))
  const joined = allTexts.join('\n')
  const resources = Array.isArray(village.resources) ? village.resources : []
  const shortageIds = resources
    .filter(item => Number(item.current || 0) < Number(item.target || 0))
    .map(item => item.id)
  const bedResource = resources.find(item => item.id === 'beds') || null
  const bedsMissing = Boolean(bedResource && Number(bedResource.current || 0) < Number(bedResource.target || 0))
  const inventory = summary.inventory && summary.inventory.counts ? summary.inventory.counts : {}
  const hasBed = hasInventory(inventory, /bed|床/i)
  const peacefulBuild = isPeacefulBuildMode(village)
  const night = isNightLabel(summary.timeLabel) && !peacefulBuild
  const missing = {
    pickaxe: /找不到任何石镐|没有合适的工具|right tools|stone_pickaxe|pickaxe/i.test(joined) && !hasInventory(inventory, /pickaxe|石镐/i),
    planks: /找不到任何橡木板|oak_planks|planks/i.test(joined) && !hasInventory(inventory, /planks|oak_planks|橡木板/i),
    torches: /找不到任何火把|没有.*火把|torch/i.test(joined) && !hasInventory(inventory, /torch|火把/i),
    animals: countMatches(allTexts, /找不到.*牛|找不到.*羊|could not find any cow|could not find any sheep|找不到任何羊|找不到一头牛/i) >= 2
  }
  const stuck = hasRecentUnresolvedStuck(memory)
  const inWater = isWaterState(summary)
  const underground = summary.position && Number(summary.position.y || 64) < 61
  let reason = '继续推进村庄任务'
  if (inWater) reason = '居民落水，先上岸脱困'
  else if (stuck && underground && roleId === 'miner') reason = '矿工地下采矿受阻，先小范围调整并继续安全采矿'
  else if (stuck && underground) reason = '居民卡在地下，先脱困回地表'
  else if (stuck) reason = '居民卡住，先恢复行动'
  else if (Number(summary.health || 20) <= 12) reason = '生命值偏低，优先保命'
  else if (Number(summary.hunger || 20) <= 12) reason = '饥饿偏低，优先食物'
  else if (night && (hasBed || !bedsMissing)) reason = '夜晚回个人床睡觉'
  else if (night && bedsMissing) reason = '夜晚缺床，先回个人小屋并补床位'
  else if (missing.pickaxe) reason = '矿工缺石镐，先解决工具链'
  else if (shortageIds.includes('wood')) reason = '平原缺树，优先建树场'
  else if (missing.planks) reason = '建筑缺橡木板，先补木材'
  else if (missing.torches) reason = '照明缺火把，先补光源'
  else if (shortageIds.includes('coal')) reason = '煤炭短缺，优先找煤'
  else if (shortageIds.includes('iron')) reason = '铁资源短缺，优先安全探矿'
  else if (shortageIds.includes('gold')) reason = '金资源短缺，带铁镐安全采金'
  else if (shortageIds.includes('food') || missing.animals) reason = '食物或动物资源不足'
  else if (shortageIds.includes('wool')) reason = '羊毛不足，继续找羊'
  else if (shortageIds.includes('stone')) reason = '石头不足，继续采石回库'
  return { reason, shortageIds, missing, inventory, stuck, inWater, underground, night, bedsMissing, hasBed, health: Number(summary.health || 20), hunger: Number(summary.hunger || 20) }
}

function buildAutonomousCommanderTask(agentName, roleId, base, chest, summary, assessment, assignment, taskIndex = 0) {
  const roleName = assignment && assignment.role && assignment.role.role ? assignment.role.role : roleLabel(roleId)
  const projectTitle = assignment && assignment.project && assignment.project.title ? assignment.project.title : projectForRole(roleId, assessment)
  const reason = roleAwareReason(roleId, assessment)
  const home = personalHomePlan(agentName, base)
  const objective = autonomousObjective(agentName, roleId, assessment, taskIndex, base)
  const shortageText = assessment.shortageIds && assessment.shortageIds.length > 0 ? assessment.shortageIds.join(', ') : '暂无明确短缺'
  const homeText = home ? '个人住宅制度：你的家是“' + home.name + '”，住宅中心 ' + formatPoint(home.center) + '，床位 ' + formatPoint(home.bed) + '，门口 ' + formatPoint(home.door) + '；家具清单：床、门、火把、个人箱子，职业家具：' + home.furniture + '。夜晚优先回自己的床睡觉。' : '个人住宅制度：每个居民都要建设自己的小屋、床和基础家具，夜晚回自己的床睡觉。'
  return [
    '村长命令：' + agentName + ' 作为“' + roleName + '”必须服从本轮村庄目标，但路线、工具、命令顺序和小步骤由你自己判断，不要等村长一步一步遥控。',
    '重要限制：不要把查看库存当作任务成果。如果最近已经输出过“库存/INVENTORY”，本轮禁止再次使用个人库存查看命令，必须改为移动、放置、采集、合成、入库、查公共箱或上报受阻。',
    '工具纪律：随身携带剑但不要默认手持剑。砍树或采集原木前必须先装备斧头；没有斧头就去公共箱取斧头、制作斧头，实在没有才空手采集，禁止用剑砍树。挖石头、煤、铁前先装备镐；金矿/深层金矿必须铁镐或更高级，不能用石镐硬挖；只有打怪、自卫、狩猎时才装备剑。',
    '村长综合判断：' + reason + '。负责项目：' + projectTitle + '。当前资源缺口：' + shortageText + '。',
    '基地坐标：' + formatPoint(base) + '；室外公共箱子：' + formatPoint(chest) + '；你的位置：' + formatPoint(summary.position) + '；当前动作：' + (summary.currentAction || '未知') + '。',
    homeText,
    '本轮自治目标：' + objective,
    '执行方式：行动优先。最多先发一句不超过 30 字的中文状态句，说明“我要做什么”；随后必须立刻执行外显动作，比如查看公共箱、移动、寻找资源、采集、合成、放置、入库或观察实体。思考、闲聊、只报库存、只发 VILLAGE_REPORT 都不算任务成果。默认不要使用个人库存查看命令；只有完全不知道背包且最近没有查过库存时，才允许最多查一次，查完必须马上执行一个外显动作。',
    '纪律：每轮聊天最多 2 句，必须服务于库存、坐标、缺口或施工协作；不要长期闲聊，不要跟随真人玩家等待，不要远离基地做无意义远征。一个动作失败后要换合理替代方案，缺材料或配方就上报“受阻”，不要无限重试。',
    '公共设施要求：只有在实际开始施工/采集、发现资源点、完成或明确受阻时才发送 VILLAGE_REPORT {"type":"storage|resource|lighting|road|farm|mine|house|wall|landmark|other","title":"中文短名","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"中文说明，资源点要写清资源类型和返回路线","projectId":"' + projectForRole(roleId, assessment) + '"}。不要用上报代替行动。'
  ].join(' ')
}

function roleLabel(roleId) {
  const labels = {
    steward: '生存管家',
    builder: '建筑师',
    miner: '矿工',
    scout: '侦察员',
    farmer: '农夫'
  }
  return labels[roleId] || '居民'
}

function autonomousObjective(agentName, roleId, assessment, taskIndex = 0, base = null) {
  const cycle = Math.abs(Number(taskIndex || 0)) % 3
  const home = personalHomePlan(agentName, base)
  const homeLabel = home ? `${home.name} ${formatPoint(home.center)}，床位 ${formatPoint(home.bed)}` : '你的个人小屋和床位'
  if (assessment.inWater) return '立刻停止当前采集、搜索、战斗或建造，先上岸脱困：朝最近岸边移动，持续跳跃上浮，不下潜，不采集水下方块；脱困后回公共箱或基地安全点再继续职业任务。'
  if (assessment.night && assessment.bedsMissing) return `夜晚先回到${homeLabel}或基地安全屋，避免远行和战斗；如果你身上有床就只在自己床位放置一次，没有床就上报“需要羊毛/床”，天亮后优先补床。`
  if (assessment.night) return `夜晚优先回到${homeLabel}，确认周围安全和有照明后睡觉；如果床不可用，停止重复尝试，中文上报原因并留在自己的小屋或基地安全处。`
  if (assessment.stuck && assessment.underground && roleId === 'miner') return '矿工在地下采矿是正常状态；如果卡住，先后退、跳上相邻方块或换一条安全矿道，继续采集煤、铁、圆石；看到金矿要先确认有铁镐或更高级，没铁镐就记录坐标并先采铁。只有落水、生命危险、连续失败或背包已有收获需要入库时才回公共箱。'
  if (assessment.stuck && assessment.underground) return '先自行脱困到地表或公共箱子附近，恢复后再继续自己的职业任务。'
  if (assessment.stuck) return '先停止当前失败动作，回到公共箱子或安全平地，整理背包后继续职业任务。'
  if (Number(assessment.health || 20) <= 12) return '优先保命：停止采集、建设和战斗，回基地或公共箱安全点；如果身上有食物先吃，没有食物就留在安全区并上报需要食物。'
  if (Number(assessment.hunger || 20) <= 12) return '饥饿偏低：先吃背包里的任意食物；没有食物就回基地安全区，短距离寻找鸡、牛、猪、羊或可收割作物，拿到后立刻吃或回库。'
  if (roleId === 'steward') {
    return cycle === 0
      ? '高级总管任务：去公共箱读取资源并把自己身上的石头、木材、食物、羊毛、铁、煤、火把入库；然后用中文上报住宅建设最缺的 1-2 种材料，不要巡逻或打怪。'
      : cycle === 1
        ? '高级总管任务：围绕个人住宅项目做材料调度，给 Luna/Milo/Ivy/Nova 指出下一批需要的木板、石头、羊毛、床或火把；自己先搬运或整理一个材料包。'
        : '高级总管任务：检查 Alex 自己的小屋床位和公共仓储区，完成一个可见动作：放置/补齐一个箱子、火把、工作台、标记牌或把材料回库。'
  }
  if (roleId === 'builder') {
    if (assessment.bedsMissing) return `优先推进居民个人住宅：先给每个居民留出 5x5 小屋地块，再补床位、门、火把和个人箱子；本轮先处理${homeLabel}。`
    if (assessment.shortageIds.includes('wood')) return '平原附近没有树时，优先在基地边缘草地建立小树场：使用已有橡树树苗，间隔 4 格种下 4-8 棵，补火把，记录坐标；不要继续无意义搜索远处橡木。'
    return cycle === 0
      ? `继续建设${homeLabel}，先做一个 5x5 简单小屋骨架：地板、两格高墙、门口和火把，不拆别人已有方块。`
      : cycle === 1
        ? '给居民小屋补家具：床、个人箱子、工作台/熔炉/花盆等职业家具；缺材料就去公共箱取少量材料或上报需要。'
        : '检查已有个人小屋边界，补一个实用组件：门口、窗、屋顶、地板、道路连接或工作区。'
  }
  if (roleId === 'miner') {
    return cycle === 0
      ? '先解决工具链：如果最近已经查过库存，就直接去公共箱取工具/材料，或安全采集木头、圆石来补齐，然后再采矿。'
      : cycle === 1
        ? '在低风险矿道寻找煤、铁和可采金矿；金矿必须铁镐或更高级，没有铁镐就先采铁/取铁锭做铁镐并上报金矿坐标。少量采集后回公共箱子入库。'
        : '整理矿点入口或回库路线，补光并把石头、煤、铁、金等材料带回公共箱。'
  }
  if (roleId === 'scout') {
    return cycle === 0
      ? 'Nova 不再修路。只做陆地资源勘察：在 5000 格上限内分段寻找最近林地、树苗来源、羊群/牛群和安全矿点；避开河流、湖泊和海岸，记录坐标、路线、风险和返回点，结束后回公共箱。'
      : cycle === 1
        ? 'Nova 不靠近水、不铺路。观察周边实体和地标，优先记录可回家的陆地路线、动物群、树木或地表矿点；如果前方是水就换方向或回公共箱。'
        : 'Nova 回公共箱附近提交资源报告：林地/动物/矿点坐标、返回路线、是否有水域风险；只上报，不施工。'
  }
  if (roleId === 'farmer') {
    return cycle === 0
      ? '优先找食物和羊毛：直接在可回家的范围内寻找羊、牛、鸡或可采集食物，拿到后回公共箱；不要先反复查库存。'
      : cycle === 1
        ? '检查农田或适合农田的位置，处理水源、作物、围栏或照明的小步骤。'
        : '把背包里的肉、羊毛、种子或食物存入公共箱，并上报当前食物/羊毛缺口。'
  }
  return '根据你的角色和村庄缺口，自主选择一个安全、具体、能完成的小目标并推进。'
}

function directCommanderTask(roleId, base, chest, summary, assessment, taskIndex = 0) {
  const chestGround = safeChestAccessPoint(chest, base)
  const basePoint = offsetPoint(base || chest, 0, 0, 0)
  const fallback = goToCommand(chestGround || basePoint, 2) || '!stats'
  const inventory = assessment.inventory || {}
  const hasPickaxe = hasInventory(inventory, /pickaxe|石镐/i)
  const hasLogs = hasInventory(inventory, /log|oak_log|原木/i)
  const hasPlanks = hasInventory(inventory, /planks|oak_planks|橡木板/i)
  const hasSapling = hasInventory(inventory, /sapling|oak_sapling|树苗/i)
  const axeItem = inventoryItemName(inventory, /(?:wooden|stone|iron|diamond|netherite)_axe|axe|斧/i)
  const pickaxeItem = inventoryItemName(inventory, /(?:wooden|stone|iron|diamond|netherite)_pickaxe|pickaxe|镐/i)
  const swordItem = inventoryItemName(inventory, /(?:wooden|stone|iron|diamond|netherite)_sword|sword|剑/i)
  const hasTorch = hasInventory(inventory, /torch|火把/i)
  const hasCoal = hasInventory(inventory, /coal|煤/i)
  const hasStick = hasInventory(inventory, /stick|木棍/i)
  const foodItem = bestFoodItem(inventory)

  if (assessment.inWater) return goToCommand(chestGround || basePoint, 2) || '!moveAway(8)'
  if (assessment.stuck && assessment.underground && roleId === 'miner') return '!moveAway(4)'
  if (assessment.stuck && assessment.underground) return mindcraftCommand('newAction', [
    '你现在在地下卡住了，但你不是矿工。不要使用 climbToSurface 或原地连跳。',
    '先停止当前动作，尝试横向退开 2-3 格；如果仍失败，用中文上报“需要村长传送回公共箱”。',
    '村长会通过服务器指令把你带回公共箱安全点。'
  ].join(' '))
  if (assessment.stuck) return goToCommand(chestGround || basePoint, 2) || '!moveAway(8)'
  if (Number(summary.health || 20) <= 12) return foodItem ? consumeCommand(foodItem) : (goToCommand(chestGround || basePoint, 1) || '!stats')
  if (Number(summary.hunger || 20) <= 12) return foodItem ? consumeCommand(foodItem) : buildNoFoodRecoveryTask(roleId, base, chest, summary)

  const roleTasks = {
    steward: stewardTasks(chestGround, chest, base, assessment, hasTorch, hasCoal, hasStick),
    builder: builderTasks(chestGround, chest, base, assessment, hasLogs, hasPlanks, hasSapling, axeItem),
    miner: minerTasks(chestGround, assessment, hasPickaxe, inventory, pickaxeItem, axeItem),
    scout: scoutTasks(base, chestGround, axeItem),
    farmer: farmerTasks(chestGround, base, assessment, inventory, swordItem)
  }
  const candidates = (roleTasks[roleId] || [fallback]).filter(Boolean)
  return candidates[Math.abs(Number(taskIndex || 0)) % candidates.length] || fallback
}

function stewardTasks(chestGround, chest, base, assessment, hasTorch, hasCoal, hasStick) {
  const alexHome = personalHomePlan('Alex', base || chest)
  const home = alexHome && alexHome.center ? alexHome.center : offsetPoint(base || chest, -12, 0, 8)
  return [
    goToCommand(chestGround, 1),
    '!viewChest',
    '!putInChest("cobblestone", 256)',
    '!putInChest("oak_planks", 128)',
    '!putInChest("white_wool", 64)',
    '!putInChest("coal", 64)',
    '!takeFromChest("oak_planks", 32)',
    '!takeFromChest("torch", 8)',
    goToCommand(home, 2),
    '!placeHere("torch")',
    goToCommand(chestGround, 2)
  ]
}

function builderTasks(chestGround, chest, base, assessment, hasLogs, hasPlanks, hasSapling, axeItem) {
  if (assessment.shortageIds.includes('wood') && hasSapling) {
    return treeFarmTasks(base || chest, chestGround)
  }
  if (assessment.shortageIds.includes('wood') && !hasSapling && !hasLogs && !hasPlanks) {
    return [
      goToCommand(chestGround, 1),
      '!takeFromChest("oak_sapling", 8)',
      '!takeFromChest("bone_meal", 16)',
      goToCommand(offsetPoint(base || chest, 8, 0, 8), 2),
      ...woodToolCommands(axeItem),
      '!searchForBlock("oak_log", 5000)'
    ]
  }
  if (assessment.missing.planks || !hasPlanks) {
    if (hasLogs) return ['!craftRecipe("oak_planks", 2)', goToCommand(chestGround, 1), '!putInChest("oak_planks", 64)']
    return [
      goToCommand(chestGround, 1),
      '!takeFromChest("oak_sapling", 8)',
      goToCommand(offsetPoint(base || chest, 8, 0, 8), 2),
      '!placeHere("oak_sapling")',
      ...woodToolCommands(axeItem),
      '!searchForBlock("oak_log", 5000)'
    ]
  }
  return [
    goToCommand(offsetPoint(chest || base, -3, 0, 2), 1),
    '!placeHere("oak_planks")',
    goToCommand(offsetPoint(chest || base, -3, 0, 3), 1),
    '!placeHere("oak_planks")',
    goToCommand(offsetPoint(base || chest, 2, 0, 0), 1)
  ]
}

function treeFarmTasks(base, chestGround) {
  return [
    goToCommand(offsetPoint(base || chestGround, 8, 0, 8), 2),
    '!placeHere("oak_sapling")',
    goToCommand(offsetPoint(base || chestGround, 12, 0, 8), 2),
    '!placeHere("oak_sapling")',
    goToCommand(offsetPoint(base || chestGround, 8, 0, 12), 2),
    '!placeHere("oak_sapling")',
    goToCommand(offsetPoint(base || chestGround, 12, 0, 12), 2),
    '!placeHere("oak_sapling")',
    goToCommand(chestGround, 2)
  ]
}

function minerTasks(chestGround, assessment, hasPickaxe, inventory, pickaxeItem, axeItem) {
  const advancedPickaxeItem = inventoryItemName(inventory, /(?:iron|diamond|netherite)_pickaxe|铁镐|钻石镐|下界合金镐/i)
  const hasIronIngot = hasInventory(inventory, /iron_ingot|铁锭/i)
  const hasStick = hasInventory(inventory, /stick|木棍/i)
  if (!hasPickaxe || assessment.missing.pickaxe) {
    const hasCobble = hasInventory(inventory, /cobblestone|鹅卵石/i)
    if (hasCobble && hasStick) return ['!craftRecipe("stone_pickaxe", 1)', '!equip("stone_pickaxe")']
    return [
      goToCommand(chestGround, 1),
      '!takeFromChest("stone_pickaxe", 1)',
      '!takeFromChest("cobblestone", 3)',
      '!takeFromChest("stick", 2)',
      ...woodToolCommands(axeItem),
      '!searchForBlock("oak_log", 96)',
      '!collectBlocks("oak_log", 4)',
      '!craftRecipe("oak_planks", 1)',
      '!craftRecipe("stick", 2)',
      '!craftRecipe("stone_pickaxe", 1)'
    ]
  }
  if (!advancedPickaxeItem && (assessment.shortageIds.includes('gold') || assessment.shortageIds.includes('iron'))) {
    if (hasIronIngot && hasStick) return ['!craftRecipe("iron_pickaxe", 1)', '!equip("iron_pickaxe")']
    return [
      goToCommand(chestGround, 1),
      '!takeFromChest("iron_pickaxe", 1)',
      '!equip("iron_pickaxe")',
      '!takeFromChest("iron_ingot", 3)',
      '!takeFromChest("stick", 2)',
      '!craftRecipe("iron_pickaxe", 1)',
      ...pickaxeToolCommands(pickaxeItem),
      '!searchForBlock("iron_ore", 160)',
      '!collectBlocks("iron_ore", 8)',
      '!searchForBlock("deepslate_iron_ore", 160)',
      '!collectBlocks("deepslate_iron_ore", 8)'
    ]
  }
  if (assessment.shortageIds.includes('gold') && advancedPickaxeItem) {
    return [
      ...pickaxeToolCommands(advancedPickaxeItem),
      '!searchForBlock("gold_ore", 192)',
      '!collectBlocks("gold_ore", 8)',
      '!searchForBlock("deepslate_gold_ore", 192)',
      '!collectBlocks("deepslate_gold_ore", 8)',
      '!goToSurface',
      goToCommand(chestGround, 1),
      '!putInChest("raw_gold", 64)',
      '!putInChest("gold_ingot", 64)'
    ]
  }
  if (assessment.shortageIds.includes('iron')) {
    return [...pickaxeToolCommands(pickaxeItem), '!searchForBlock("iron_ore", 160)', '!collectBlocks("iron_ore", 10)', '!searchForBlock("deepslate_iron_ore", 160)', '!collectBlocks("deepslate_iron_ore", 10)', '!goToSurface', goToCommand(chestGround, 1), '!putInChest("raw_iron", 64)', '!putInChest("iron_ingot", 64)']
  }
  if (assessment.shortageIds.includes('coal')) {
    return [...pickaxeToolCommands(pickaxeItem), '!searchForBlock("coal_ore", 128)', '!collectBlocks("coal_ore", 8)', '!goToSurface', goToCommand(chestGround, 1), '!putInChest("coal", 64)']
  }
  return [
    ...pickaxeToolCommands(advancedPickaxeItem || pickaxeItem),
    '!searchForBlock("coal_ore", 128)',
    '!collectBlocks("coal_ore", 6)',
    '!searchForBlock("iron_ore", 160)',
    '!collectBlocks("iron_ore", 8)',
    advancedPickaxeItem ? '!searchForBlock("gold_ore", 192)' : '',
    advancedPickaxeItem ? '!collectBlocks("gold_ore", 6)' : '',
    advancedPickaxeItem ? '!searchForBlock("deepslate_gold_ore", 192)' : '',
    advancedPickaxeItem ? '!collectBlocks("deepslate_gold_ore", 6)' : '',
    '!searchForBlock("stone", 96)',
    '!collectBlocks("stone", 12)',
    '!goToSurface',
    goToCommand(chestGround, 1),
    '!putInChest("raw_iron", 64)',
    '!putInChest("raw_gold", 64)',
    '!putInChest("coal", 64)',
    '!putInChest("cobblestone", 64)'
  ].filter(Boolean)
}

function scoutTasks(base, chestGround, axeItem) {
  return [
    goToCommand(chestGround, 2),
    '!entities',
    '!searchForEntity("sheep", 512)',
    '!searchForEntity("cow", 512)',
    ...woodToolCommands(axeItem),
    '!searchForBlock("oak_log", 5000)',
    '!searchForBlock("coal_ore", 192)',
    '!searchForBlock("iron_ore", 192)',
    '!searchForBlock("gold_ore", 192)',
    goToCommand(chestGround, 2)
  ]
}

function farmerTasks(chestGround, base, assessment, inventory, swordItem) {
  const hasBeef = hasInventory(inventory, /beef|牛肉/i)
  const hasChicken = hasInventory(inventory, /chicken|鸡肉/i)
  const hasMutton = hasInventory(inventory, /mutton|羊肉/i)
  const hasWool = hasInventory(inventory, /wool|羊毛/i)
  if (hasBeef) return [goToCommand(chestGround, 2), '!putInChest("beef", 16)']
  if (hasChicken) return [goToCommand(chestGround, 2), '!putInChest("chicken", 16)']
  if (hasMutton) return [goToCommand(chestGround, 2), '!putInChest("mutton", 16)']
  if (hasWool) return [goToCommand(chestGround, 2), '!putInChest("white_wool", 16)']
  if (assessment.missing.animals) {
    return [
      goToCommand(offsetPoint(base || chestGround, 32, 0, 20), 2),
      '!searchForEntity("chicken", 256)',
      ...combatToolCommands(swordItem),
      '!attack("chicken")',
      goToCommand(offsetPoint(base || chestGround, -32, 0, 18), 2),
      '!searchForEntity("sheep", 256)',
      ...combatToolCommands(swordItem),
      '!attack("sheep")'
    ]
  }
  return [
    '!searchForEntity("cow", 256)',
    ...combatToolCommands(swordItem),
    '!attack("cow")',
    '!searchForEntity("sheep", 256)',
    ...combatToolCommands(swordItem),
    '!attack("sheep")',
    goToCommand(offsetPoint(base || chestGround, 24, 0, -24), 2),
    goToCommand(chestGround, 2)
  ]
}

function roleAwareReason(roleId, assessment) {
  if (assessment.inWater) return '居民落水，先上岸脱困'
  if (assessment.night && assessment.bedsMissing) return '夜晚缺床，先回个人小屋并补床位'
  if (assessment.night) return '夜晚回个人床睡觉'
  if (assessment.stuck && assessment.underground && roleId === 'miner') return '矿工地下采矿受阻，先小范围调整后继续采矿'
  if (assessment.stuck && assessment.underground) return '居民卡在地下，先脱困回地表'
  if (assessment.stuck) return '居民卡住，先恢复行动'
  if (roleId === 'steward') return assessment.shortageIds.includes('beds') || assessment.shortageIds.includes('wool') ? '资源总管调度床和住宅材料' : '资源总管整理公共仓储和施工材料'
  if (roleId === 'builder') return assessment.missing.planks ? '建筑师先补木材再施工' : '建筑师继续扩建基地'
  if (roleId === 'miner') return assessment.missing.pickaxe ? '矿工先解决工具链' : '矿工采集煤铁金并回库'
  if (roleId === 'scout') return '侦察员只做陆地资源勘察，不修路不下水'
  if (roleId === 'farmer') return assessment.missing.animals || assessment.shortageIds.includes('food') || assessment.shortageIds.includes('wool') ? '农夫外出找食物和羊毛' : '农夫维护食物来源'
  return assessment.reason
}

function projectForRole(roleId, assessment) {
  if (assessment && (assessment.night || assessment.bedsMissing || assessment.shortageIds && assessment.shortageIds.includes('beds'))) return 'resident-houses'
  if (roleId === 'miner') return 'starter-mine'
  if (roleId === 'builder') return 'resident-houses'
  if (roleId === 'scout') return 'resource-survey'
  if (roleId === 'farmer') return 'starter-farm'
  if (assessment.missing.torches) return 'safe-lighting'
  return 'storage-hub'
}

function recentMemoryTexts(allAgentMemory) {
  const texts = []
  for (const memory of Object.values(allAgentMemory || {})) {
    for (const item of (memory && memory.recentOutputs ? memory.recentOutputs : []).slice(-8)) {
      texts.push(String(item.text || item.message || item || ''))
    }
    for (const item of (memory && memory.recentTasks ? memory.recentTasks : []).slice(-4)) {
      texts.push(String(item.task || item.message || item || ''))
    }
  }
  return texts
}

function countMatches(texts, pattern) {
  return (texts || []).reduce((count, text) => count + (pattern.test(String(text || '')) ? 1 : 0), 0)
}

function hasInventory(counts, pattern) {
  return Object.keys(counts || {}).some(name => Number(counts[name] || 0) > 0 && pattern.test(name))
}

function inventoryItemName(counts, pattern) {
  for (const name of Object.keys(counts || {})) {
    if (Number(counts[name] || 0) > 0 && pattern.test(name)) return commandItemName(name)
  }
  return ''
}

function commandItemName(name) {
  return String(name || '').replace(/^minecraft:/, '')
}

function woodToolCommands(axeItem) {
  if (axeItem) return ['!equip("' + axeItem + '")']
  return ['!takeFromChest("stone_axe", 1)', '!takeFromChest("wooden_axe", 1)', '!equip("stone_axe")', '!equip("wooden_axe")']
}

function pickaxeToolCommands(pickaxeItem) {
  if (pickaxeItem) return ['!equip("' + pickaxeItem + '")']
  return ['!takeFromChest("stone_pickaxe", 1)', '!equip("stone_pickaxe")']
}

function combatToolCommands(swordItem) {
  if (swordItem) return ['!equip("' + swordItem + '")']
  return ['!takeFromChest("stone_sword", 1)', '!equip("stone_sword")']
}

function hasUsefulResourceCargo(counts) {
  return Object.entries(counts || {}).some(([name, count]) => {
    if (Number(count || 0) <= 0) return false
    return /log|wood|planks|sapling|cobblestone|stone|granite|andesite|diorite|coal|iron|gold|ore|beef|pork|chicken|mutton|salmon|cod|wool|leather|seed|torch/i.test(name)
  })
}
function updateObservationMemory(memory, summary, action, now) {
  const position = summary.position || null
  const positionKey = position ? [
    Math.round(Number(position.x || 0)),
    Math.round(Number(position.y || 0)),
    Math.round(Number(position.z || 0))
  ].join(',') : ''
  const previousAction = String(memory.commanderObservedAction || '')
  const previousPositionKey = String(memory.commanderObservedPositionKey || '')
  const actionChanged = previousAction !== action
  const positionChanged = previousPositionKey && positionKey && previousPositionKey !== positionKey

  if (!memory.commanderObservedActionSince || actionChanged) {
    memory.commanderObservedActionSince = now
  }
  if (!memory.commanderLastProgressAt || actionChanged || positionChanged) {
    memory.commanderLastProgressAt = now
    if (actionChanged || positionChanged) {
      memory.commanderInterventionAttempts = 0
      memory.recoveryAttempts = 0
    }
  }

  memory.commanderObservedAction = action
  memory.commanderObservedPositionKey = positionKey
  return {
    actionSince: memory.commanderObservedActionSince,
    progressAt: memory.commanderLastProgressAt
  }
}

function buildVitalRecoveryTask(agentName, reason, summary, base, chest) {
  const target = safeChestAccessPoint(chest, base, summary.position)
  return mindcraftCommand('newAction', [
    agentName + ' 进入紧急保命模式：' + reason + '。当前位置 ' + formatPoint(summary.position) + '，安全点 ' + formatPoint(target) + '。',
    '立刻停止采集、建设、闲聊、远行和主动战斗。先检查背包是否有食物，有就马上吃。',
    '如果没有食物，回到基地或公共箱旁边的安全点；血量低于 16 时不要打怪，不要下矿，不要离开照明区域。',
    '血量和饥饿恢复后，再做短距离食物任务：找鸡、牛、猪、羊或作物，拿到食物后先吃，再把多余食物入库。',
    '完成或受阻时用中文 VILLAGE_REPORT 上报“需要食物/已恢复/无法找到食物”。'
  ].join(' '))
}

function buildNoFoodRecoveryTask(roleId, base, chest, summary) {
  const target = safeChestAccessPoint(chest, base, summary.position)
  return mindcraftCommand('newAction', [
    '饥饿偏低且背包没有可吃食物。先回安全点 ' + formatPoint(target) + '，停止远行、采矿和主动打怪。',
    '到达后查看公共箱是否有食物；如果没有，白天只在基地附近短距离寻找鸡、牛、猪、羊或成熟作物。',
    '拿到食物后立刻吃到饥饿值安全，再把多余食物放入公共箱。缺食物就中文上报受阻。'
  ].join(' '))
}

function bestFoodItem(inventory) {
  const priorities = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'bread', 'beef', 'porkchop', 'mutton', 'chicken', 'salmon', 'cod', 'apple', 'carrot', 'baked_potato', 'potato']
  const keys = Object.keys(inventory || {})
  for (const wanted of priorities) {
    const match = keys.find(key => itemName(key) === wanted && Number(inventory[key] || 0) > 0)
    if (match) return itemName(match)
  }
  return ''
}

function consumeCommand(item) {
  return '!consume("' + String(item || '').replace(/[^a-zA-Z0-9_:-]/g, '') + '")'
}

function itemName(id) {
  return String(id || '').replace(/^minecraft:/, '')
}
function buildCommanderRecoveryTask(agentName, reason, summary, base, chest, assignment, attempt = 0) {
  if (/落水|水中|water/i.test(reason) || isWaterState(summary)) {
    return buildWaterRecoveryTask(agentName, reason, summary, base, chest)
  }
  if (/睡觉|goToBed|sleep/i.test(reason) || /goToBed|sleep/i.test(summary.currentAction || '')) {
    return buildSleepRecoveryTask(agentName, reason, summary, base, chest)
  }
  const roleId = assignment && assignment.role ? assignment.role.roleId : ''
  if (/卡住|脱困|stuck/i.test(reason) && roleId === 'miner' && summary.position && Number(summary.position.y || 64) < 61) {
    return mindcraftCommand('newAction', [
      agentName + ' 你是矿工，地下采矿是正常工作，不要因为在地下就直接回地表。',
      '如果刚才卡住，先后退或横向移动几格，跳上相邻方块，换一条安全矿道，继续采集煤、铁或圆石。',
      '只有落水、生命危险、连续失败或背包已有明显收获需要入库时，才回公共箱。',
      '最多一句短状态：“我调整矿道继续采矿”，然后执行一个可见采矿或补光动作。'
    ].join(' '))
  }
  if (/卡住|脱困|stuck/i.test(reason) && summary.position && Number(summary.position.y || 64) < 61) {
    const target = safeChestAccessPoint(chest, base, summary.position)
    return mindcraftCommand('newAction', [
      agentName + ' 你在地下或低处受阻：' + formatPoint(summary.position) + '。不要继续使用 climbToSurface、goToSurface 或原地连跳。',
      '先停止当前动作，向旁边安全方块退开 2-3 格；如果路径还是失败，原地等待并用中文上报“需要村长传送”。',
      '目标安全点是公共箱附近 ' + formatPoint(target) + '，村长会优先用服务器传送处理非矿工地下卡住。'
    ].join(' '))
  }
  if (/等待过久|空闲|停顿|idle|闲聊|规划过久/i.test(reason)) {
    const direct = directRecoveryCommand(roleId, base, chest, attempt)
    if (direct) return direct
    return buildIdleReassignmentTask(agentName, reason, summary, base, chest, assignment)
  }
  const target = chest || base || summary.position
  if (target && summary.position && distance2d(summary.position, target) > 7) {
    return goToCommand(safeChestAccessPoint(chest, base, target), 2)
  }
  return directRecoveryCommand(roleId, base, chest, attempt)
}

function buildIdleReassignmentTask(agentName, reason, summary, base, chest, assignment) {
  const roleId = assignment && assignment.role ? assignment.role.roleId : ''
  const roleName = assignment && assignment.role ? assignment.role.role : roleLabel(roleId)
  const project = assignment && assignment.project ? assignment.project : null
  const projectText = project ? '当前负责项目：' + (project.title || project.id || '未命名项目') + '。' : ''
  const baseText = formatPoint(base)
  const chestText = formatPoint(chest || base)
  const common = [
    agentName + ' 你刚才等待过久，村长重新派工。当前动作：' + (summary.currentAction || '未知') + '，位置：' + formatPoint(summary.position) + '。',
    '最多一句不超过 30 字的中文状态：“我是' + agentName + '，现在做一个可见动作。”然后立刻行动。',
    '不要继续站岗、不要反复查看个人库存、不要闲聊。先完成一个可见动作，再用中文短句或 VILLAGE_REPORT 上报。',
    '基地：' + baseText + '；公共箱：' + chestText + '。' + projectText
  ]
  const byRole = {
    steward: 'Alex 作为资源总管：打开公共箱，整理或入库一类材料；如果火把不足就合成/补放火把；如果床或羊毛不足就记录缺口并调度。至少完成一次入库、合成、放置火把或箱子整理。',
    builder: '建筑师：在个人住宅或公共箱附近做一个小建设动作，例如放置/修补1-4块木板或石头、补一根火把、标记入口或整理地面。不要远行。',
    miner: '矿工：从公共箱取合适工具，到基地附近安全石头/矿点采集少量圆石、煤或铁，最多推进20格，随后回公共箱入库。不要下深洞。',
    scout: '侦察员：只在陆地短距离观察，向基地外干燥方向走30-80格，记录树、动物、矿点或危险坑坐标，然后回公共箱上报。不要下水、不要修路。',
    farmer: '农夫：检查公共箱附近食物/种子；在基地附近寻找羊、牛、鸡或可收割作物，采集少量食物/羊毛后回公共箱。不要远离水边或掉水。'
  }
  const action = byRole[roleId] || '在公共箱附近做一个短小可见动作：整理材料、补光、清理障碍、放置一个有用方块或上报缺口。'
  return mindcraftCommand('newAction', common.concat(action, 'VILLAGE_REPORT type 根据结果选择 storage/resource/lighting/farm/mine/house/other，status 用 done 或 blocked，position 填实际坐标，description 用中文写清楚做了什么、还缺什么。').join(' '))
}
function buildSleepRecoveryTask(agentName, reason, summary, base, chest) {
  const target = chest || base || summary.position
  return mindcraftCommand('newAction', [
    agentName + ' 立刻停止睡觉循环。原因：' + reason + '；当前位置 ' + formatPoint(summary.position) + '；当前动作：' + (summary.currentAction || '未知') + '。',
    '如果附近没有可用床，或者刚才放床/合成床失败，不要再尝试睡觉，也不要继续查床配方。',
    '先回到公共箱或基地安全点 ' + formatPoint(target) + '，把身上的木头、石头、火把、食物、羊毛、铁、煤等公共材料存入公共箱。',
    '如果身上已有床，就只在基地安全平地放置一次；如果失败，直接上报受阻，不要重复尝试。',
    '完成后做一个可见短动作：补一处火把、整理公共箱、清理道路边缘或报告资源缺口。全程用中文简短上报。'
  ].join(' '))
}

function buildWaterRecoveryTask(agentName, reason, summary, base, chest) {
  const target = chest || base || summary.position
  return mindcraftCommand('newAction', [
    agentName + ' 立刻执行水中脱困。原因：' + reason + '；当前位置 ' + formatPoint(summary.position) + '；当前动作：' + (summary.currentAction || '未知') + '。',
    '第一优先级是活着上岸，不要继续采集、搜索、攻击、建造或下潜。',
    '先看向水面和最近岸边，持续跳跃上浮，同时朝岸边或浅水方块移动；如果有水流，就顺着能上岸的一侧移动。',
    '如果 20 秒内仍不能上岸，停止动作，用中文上报“受阻：我在水里卡住，需要传送”，不要反复尝试同一个失败动作。',
    '成功上岸后回到公共箱或基地安全点 ' + formatPoint(target) + ' 附近，并用中文报告原因、当前位置和下一步。'
  ].join(' '))
}

function directRecoveryCommand(roleId, base, chest, attempt = 0) {
  const chestGround = safeChestAccessPoint(chest, base)
  const housePoint = offsetPoint(base || chest, 0, 0, 0)
  const fallback = goToCommand(chestGround || base, 2) || '!stats'
  const tasks = {
    steward: [goToCommand(chestGround, 1), '!viewChest', '!putInChest("cobblestone", 256)', '!putInChest("oak_planks", 128)', '!takeFromChest("oak_planks", 32)', goToCommand(offsetPoint(base || chest, -12, 0, 8), 2)],
    builder: [goToCommand(chestGround, 1), '!takeFromChest("oak_planks", 8)', goToCommand(offsetPoint(chest || base, -3, 0, 2), 1), '!placeHere("oak_planks")', goToCommand(offsetPoint(housePoint, 2, 0, 0), 1)],
    miner: ['!moveAway(4)', '!searchForBlock("coal_ore", 64)', '!collectBlocks("coal_ore", 2)', '!searchForBlock("iron_ore", 64)', '!collectBlocks("stone", 4)', goToCommand(chestGround, 2)],
    scout: [goToCommand(chestGround, 2), '!entities', '!putInChest("cobblestone", 256)', '!putInChest("beef", 64)', '!putInChest("mutton", 64)', goToCommand(chestGround, 2)],
    farmer: [goToCommand(chestGround, 2), '!putInChest("wheat", 64)', '!putInChest("wheat_seeds", 64)', '!putInChest("beef", 16)', '!putInChest("mutton", 16)', goToCommand(offsetPoint(base || chest, 0, 0, -2), 2), '!entities', '!searchForEntity("sheep", 192)', '!searchForEntity("cow", 192)']
  }
  const candidates = (tasks[roleId] || [fallback]).filter(Boolean)
  return candidates[Math.abs(Number(attempt || 0)) % candidates.length] || fallback
}

function personalHomePlan(agentName, base) {
  if (!base) return null
  const layout = {
    Alex: { dx: -12, dz: 8, name: 'Alex 的管家小屋', furniture: '工具架或安全记录角' },
    Luna: { dx: -4, dz: 12, name: 'Luna 的建筑师小屋', furniture: '工作台和材料样板角' },
    Milo: { dx: 4, dz: 12, name: 'Milo 的矿工小屋', furniture: '熔炉和矿石箱' },
    Nova: { dx: 12, dz: 8, name: 'Nova 的侦察员小屋', furniture: '地图墙或路标材料箱' },
    Ivy: { dx: 12, dz: -2, name: 'Ivy 的农夫小屋', furniture: '种子箱和花盆/农具角' }
  }
  const item = layout[String(agentName || '')] || { dx: 0, dz: 14, name: `${agentName || '居民'} 的小屋`, furniture: '个人箱子' }
  const center = offsetPoint(base, item.dx, 0, item.dz)
  return {
    name: item.name,
    center,
    bed: offsetPoint(center, 1, 0, 1),
    door: offsetPoint(center, 0, 0, -2),
    furniture: item.furniture
  }
}

function isPeacefulBuildMode(village) {
  const settlement = village && village.settlement ? village.settlement : {}
  const policy = String(settlement.policy || '')
  return /和平|没有怪物|不安排巡逻|不打怪|peaceful/i.test(policy)
}

function isNightLabel(value) {
  return /night|夜晚|黄昏/i.test(String(value || ''))
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
  if (chest) return offsetPoint(chest, 1, 0, 1)
  return offsetPoint(base || fallback, 0, 0, 0)
}
function goToCommand(position, closeness = 2) {
  if (!position) return ''
  return `!goToCoordinates(${Math.round(Number(position.x || 0))}, ${Math.round(Number(position.y || 64))}, ${Math.round(Number(position.z || 0))}, ${closeness})`
}

function isLongRunningAction(action) {
  return /goToBed|sleep|collect|search|attack|craft|place|goto|path|move|mine|dig|stay|newAction/i.test(String(action || ''))
}

function isWaterState(summary) {
  if (!summary) return false
  if (summary.inWater || summary.waterRisk) return true
  const surroundings = summary.surroundings || {}
  const values = [
    summary.currentAction,
    surroundings.below,
    surroundings.legs,
    surroundings.head,
    surroundings.firstBlockAboveHead
  ]
  return values.some(isWaterLikeValue)
}

function isWaterLikeValue(value) {
  if (!value) return false
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value)
  return /water|bubble_column|kelp|seagrass|swim|drown/i.test(text)
}

function resetCommanderInterventionMemory(memory) {
  if (!memory) return
  memory.commanderInterventionAttempts = 0
  memory.recoveryAttempts = 0
  memory.commanderLastProgressAt = Date.now()
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
  return x + ',' + y + ',' + z
}

function spreadPlayersCommand(agentName, center, range) {
  if (!center) return ''
  const entity = String(agentName || '').replace(/[^a-zA-Z0-9_]/g, '')
  if (!entity) return ''
  const x = Math.round(Number(center.x || 0))
  const z = Math.round(Number(center.z || 0))
  const maxRange = Math.max(128, Math.min(5000, Math.round(Number(range || 1200))))
  const minDistance = Math.max(48, Math.min(128, Math.round(maxRange / 40)))
  return 'spreadplayers ' + x + ' ' + z + ' ' + minDistance + ' ' + maxRange + ' false ' + entity
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

function mindcraftCommand(name, text) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_]/g, '') || 'newAction'
  const safeText = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 760)
  return `!${safeName}(${JSON.stringify(safeText)})`
}

module.exports = {
  decideCommanderIntervention,
  decideCommanderTask,
  resetCommanderInterventionMemory
}

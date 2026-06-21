'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { readServerProperties } = require('./server-properties')

const RECOMMENDED_PROPERTIES = [
  {
    key: 'gamemode',
    value: 'survival',
    reason: 'AI 常驻居民应该以普通玩家身份生存、采集和建设。'
  },
  {
    key: 'difficulty',
    value: 'easy',
    reason: '比 peaceful 更接近真实生存，又不会让新手和 AI 社会初期过快崩盘。'
  },
  {
    key: 'max-players',
    value: '8',
    reason: '预留真人玩家、2 个默认 AI、直播观察账号 ServerTV 和后续扩展。'
  },
  {
    key: 'pvp',
    value: 'false',
    reason: 'AI 社会默认避免互相伤害和误伤真人玩家。'
  },
  {
    key: 'spawn-protection',
    value: '0',
    reason: '允许 AI 在基地或出生点附近正常建造。'
  },
  {
    key: 'view-distance',
    value: '8',
    reason: '兼顾画面观察、AI 寻路和本机性能。'
  },
  {
    key: 'simulation-distance',
    value: '8',
    reason: '让基地周围实体和农场保持可运行，同时控制性能开销。'
  },
  {
    key: 'allow-flight',
    value: 'false',
    reason: '普通 AI 居民不需要飞行；仅当 ServerTV 或相机工具被误踢时再打开。'
  },
  {
    key: 'force-gamemode',
    value: 'false',
    reason: '避免每次进服强制覆盖玩家或直播观察账号的模式。'
  },
  {
    key: 'hardcore',
    value: 'false',
    reason: 'AI 长期村庄不适合极限模式，死亡恢复成本太高。'
  },
  {
    key: 'enable-command-block',
    value: 'false',
    reason: '产品默认关闭高风险命令能力，需要地图机制时再单独开启。'
  },
  {
    key: 'motd',
    value: 'AI Friend Village',
    reason: '让局域网里看到的服务器名字和产品定位一致。'
  }
]

const FUTURE_PLUGINS = [
  {
    name: 'ai-friend-bridge',
    priority: 'P0',
    status: '需要开发',
    purpose: '把服务端事件推给控制台：聊天、玩家坐标、死亡、方块放置/破坏、箱子库存、村庄区域状态。',
    reason: 'Mindcraft 只能从 bot 视角理解世界，服务端事件桥能让 Agent 社会有稳定公共事实。'
  },
  {
    name: 'ai-friend-director',
    priority: 'P1',
    status: '需要开发',
    purpose: '控制 ServerTV 旁观账号自动跟拍、轮换 AI、巡航基地，并把导播状态暴露给前端。',
    reason: '直播需要稳定画面来源，不能依赖真人玩家手动 F5 或切窗口。'
  },
  {
    name: 'ai-friend-permissions',
    priority: 'P1',
    status: '可用现成插件替代',
    purpose: '管理 OP、白名单、AI 权限、观察账号权限和危险命令权限。',
    reason: 'offline/LAN 服务器容易被名字伪造，正式直播或开放局域网时必须有权限边界。'
  },
  {
    name: 'ai-friend-backup',
    priority: 'P2',
    status: '可用脚本先替代',
    purpose: '定时 save-all、世界备份、回滚点和崩溃恢复记录。',
    reason: 'AI 常驻建设会持续修改世界，必须能回滚误操作。'
  }
]

const BACKUP_TARGETS = [
  { path: 'server.properties', reason: '服务器基础配置。' },
  { path: 'world', reason: '主世界存档和玩家建筑。' },
  { path: 'world_nether', reason: '下界存档，存在时一起备份。' },
  { path: 'world_the_end', reason: '末地存档，存在时一起备份。' },
  { path: 'ops.json', reason: 'OP 权限。' },
  { path: 'whitelist.json', reason: '白名单。' },
  { path: 'banned-players.json', reason: '封禁玩家。' },
  { path: 'banned-ips.json', reason: '封禁 IP。' },
  { path: 'usercache.json', reason: '离线名/玩家缓存。' },
  { path: 'plugins', reason: 'Paper 插件和插件配置。' },
  { path: 'mods', reason: 'Fabric/Forge 模组。' },
  { path: 'logs', reason: '迁移排错需要。' }
]

function buildServerBlueprint(config) {
  const serverDir = String(config.minecraftServerDir || '').trim()
  const analysis = analyzeServerDirectory(serverDir)
  const properties = readServerProperties(serverDir)
  const propertyPlan = buildPropertyPlan(properties.values || {})
  const platform = buildPlatformRecommendation(analysis)
  const readiness = buildReadiness(analysis, properties, propertyPlan)
  const nextActions = buildNextActions(analysis, properties.values || {}, propertyPlan)
  const backup = buildBackupPlan(analysis)
  const commands = buildFutureCommands(propertyPlan, properties.values || {})

  return {
    generatedAt: new Date().toISOString(),
    noWrite: true,
    summary: buildSummary(analysis, propertyPlan, platform, readiness),
    analysis,
    readiness,
    nextActions,
    inventory: buildInventory(analysis, properties),
    properties: {
      path: properties.path,
      exists: properties.exists,
      current: properties.values || {},
      recommended: Object.fromEntries(RECOMMENDED_PROPERTIES.map(item => [item.key, item.value])),
      changes: propertyPlan
    },
    platform,
    plugins: FUTURE_PLUGINS,
    bridgeContract: buildBridgeContract(),
    livestream: buildLivestreamPlan(),
    agentSociety: buildAgentSocietyPlan(),
    backup,
    acceptance: buildAcceptancePlan(),
    migration: buildMigrationPlan(analysis),
    dryRun: {
      propertyPreview: renderPropertiesPreview(propertyPlan),
      futureCommands: commands,
      backupChecklist: backup.targets.map(item => `${item.exists ? 'FOUND' : 'MISSING'} ${item.path} - ${item.reason}`).join('\n'),
      note: '这是 dry-run 方案，不会写 server.properties，也不会启动、停止或重启服务器。'
    },
    markdown: ''
  }
}

function buildServerBlueprintWithMarkdown(config) {
  const blueprint = buildServerBlueprint(config)
  blueprint.markdown = formatServerBlueprintMarkdown(blueprint)
  return blueprint
}

function analyzeServerDirectory(serverDir) {
  const exists = Boolean(serverDir && fs.existsSync(serverDir))
  const files = exists ? safeList(serverDir) : []
  const jars = files.filter(fileName => fileName.toLowerCase().endsWith('.jar')).sort()
  const hasPluginsDir = exists && fs.existsSync(path.join(serverDir, 'plugins'))
  const hasModsDir = exists && fs.existsSync(path.join(serverDir, 'mods'))
  const hasStartBat = exists && fs.existsSync(path.join(serverDir, 'start.bat'))
  const hasStartSh = exists && fs.existsSync(path.join(serverDir, 'start.sh'))
  const pluginJars = hasPluginsDir ? listJarNames(path.join(serverDir, 'plugins')) : []
  const modJars = hasModsDir ? listJarNames(path.join(serverDir, 'mods')) : []
  const whitelist = exists ? readJsonArray(path.join(serverDir, 'whitelist.json')) : []
  const ops = exists ? readJsonArray(path.join(serverDir, 'ops.json')) : []
  const serverType = detectServerType(jars, hasPluginsDir, hasModsDir)

  return {
    serverDir,
    exists,
    type: serverType,
    typeLabel: serverTypeLabel(serverType),
    jars,
    pluginJars,
    modJars,
    hasPluginsDir,
    hasModsDir,
    hasStartScript: hasStartBat || hasStartSh,
    startScripts: [
      hasStartBat ? 'start.bat' : '',
      hasStartSh ? 'start.sh' : ''
    ].filter(Boolean),
    hasEula: exists && fs.existsSync(path.join(serverDir, 'eula.txt')),
    hasLatestLog: exists && fs.existsSync(path.join(serverDir, 'logs', 'latest.log')),
    hasWorld: exists && fs.existsSync(path.join(serverDir, 'world')),
    hasOps: exists && fs.existsSync(path.join(serverDir, 'ops.json')),
    opsCount: ops.length,
    hasWhitelist: exists && fs.existsSync(path.join(serverDir, 'whitelist.json')),
    whitelistCount: whitelist.length,
    whitelistNames: whitelist.map(item => item.name).filter(Boolean).sort(),
    hasBridgePlugin: pluginJars.some(fileName => /ai[-_]?friend[-_]?bridge/i.test(fileName)),
    hasDirectorPlugin: pluginJars.some(fileName => /ai[-_]?friend[-_]?director/i.test(fileName))
  }
}

function detectServerType(jars, hasPluginsDir, hasModsDir) {
  const joined = jars.join(' ').toLowerCase()
  if (joined.includes('paper') || hasPluginsDir) return 'paper'
  if (joined.includes('fabric') || hasModsDir) return 'fabric'
  if (joined.includes('forge')) return 'forge'
  if (joined.includes('server') || jars.length > 0) return 'vanilla'
  return 'unknown'
}

function serverTypeLabel(type) {
  return {
    paper: 'Paper/插件服务器',
    fabric: 'Fabric/模组服务器',
    forge: 'Forge/模组服务器',
    vanilla: '原版 Vanilla 服务器',
    unknown: '未识别服务器'
  }[type] || '未识别服务器'
}

function buildPropertyPlan(values) {
  return RECOMMENDED_PROPERTIES.map(item => {
    const current = Object.prototype.hasOwnProperty.call(values, item.key) ? String(values[item.key]) : ''
    return {
      key: item.key,
      current,
      recommended: item.value,
      changed: current !== item.value,
      reason: item.reason,
      requiresRestart: !['difficulty'].includes(item.key)
    }
  })
}

function buildReadiness(analysis, properties, propertyPlan) {
  const values = properties.values || {}
  const propertyChanged = propertyPlan.filter(item => item.changed).length
  const isOfflineOpen = values['online-mode'] === 'false' && values['white-list'] !== 'true'
  return [
    readinessGroup('base', '基础可运行', [
      check(analysis.exists, '服务器目录存在', analysis.serverDir || '未配置服务器目录'),
      check(properties.exists, 'server.properties 可读取', properties.path || '未找到配置文件'),
      check(analysis.jars.length > 0, '服务端 jar 存在', analysis.jars.join(', ') || '未识别 jar'),
      check(analysis.hasEula, 'EULA 文件存在', '首次启动过的服务器通常会有 eula.txt'),
      check(analysis.hasWorld, '世界存档存在', '检测 world 目录'),
      check(analysis.hasStartScript, '启动脚本存在', analysis.startScripts.join(', ') || '可由控制台直接推断 jar 启动')
    ]),
    readinessGroup('config', 'AI 生存配置', [
      check(propertyChanged === 0, '推荐配置已对齐', propertyChanged === 0 ? '无需修改' : `${propertyChanged} 项与推荐值不同`),
      check(values.difficulty !== 'peaceful', '不是和平难度', values.difficulty || '未设置'),
      check(Number(values['max-players'] || 0) >= 6, '玩家容量足够', values['max-players'] || '未设置'),
      check(values.pvp === 'false', 'PVP 已关闭', values.pvp || '未设置'),
      check(values['spawn-protection'] === '0', '出生点可建设', values['spawn-protection'] || '未设置')
    ]),
    readinessGroup('platform', '插件化平台', [
      check(analysis.type === 'paper', 'Paper 平台', analysis.typeLabel),
      check(analysis.hasPluginsDir, 'plugins 目录', analysis.hasPluginsDir ? '已存在' : '迁移 Paper 后生成'),
      check(analysis.hasBridgePlugin, '事件桥插件', analysis.hasBridgePlugin ? '已检测到' : '待开发/安装'),
      check(analysis.hasDirectorPlugin, '导播插件', analysis.hasDirectorPlugin ? '已检测到' : '待开发/安装')
    ]),
    readinessGroup('safety', '安全和运维', [
      check(values.hardcore !== 'true', '非极限模式', values.hardcore || '未设置'),
      check(values['enable-command-block'] !== 'true', '命令方块默认关闭', values['enable-command-block'] || '未设置'),
      check(!isOfflineOpen, '离线模式有访问边界', isOfflineOpen ? 'online-mode=false 且 white-list 未开启' : '当前风险可控'),
      check(analysis.opsCount > 0, '至少有 OP 管理员', analysis.opsCount > 0 ? `${analysis.opsCount} 个 OP` : '未检测到 ops.json 管理员'),
      check(analysis.hasLatestLog, '有 latest.log 可排错', analysis.hasLatestLog ? '已检测到日志' : '未检测到日志')
    ]),
    readinessGroup('livestream', '直播观察', [
      check(analysis.whitelistNames.includes('ServerTV') || values['white-list'] !== 'true', 'ServerTV 进入策略', values['white-list'] === 'true' ? '白名单需要 ServerTV' : '白名单未启用或不需要'),
      check(analysis.type === 'paper', '可安装导播插件', analysis.typeLabel),
      check(analysis.hasDirectorPlugin, '自动导播能力', analysis.hasDirectorPlugin ? '已检测到' : '待实现 ai-friend-director'),
      check(true, '当前可用 bot viewer MVP', '控制台已聚合 Mindcraft viewer')
    ]),
    readinessGroup('society', 'AI 社会系统', [
      check(analysis.hasBridgePlugin, '服务端公共事实', analysis.hasBridgePlugin ? '事件桥已安装' : '需要 ai-friend-bridge'),
      check(properties.exists, '可生成村庄配置建议', properties.exists ? '已读取 server.properties' : '需要服务器目录'),
      check(true, '当前已有 Mindcraft 调度入口', 'Autopilot 可发送高层任务'),
      check(false, '村庄项目状态表', '下一阶段实现共享记忆和项目队列')
    ])
  ]
}

function readinessGroup(id, title, items) {
  const score = Math.round(items.filter(item => item.ok).length / Math.max(1, items.length) * 100)
  return {
    id,
    title,
    score,
    status: score >= 85 ? 'ready' : score >= 45 ? 'partial' : 'blocked',
    statusLabel: score >= 85 ? '就绪' : score >= 45 ? '部分就绪' : '未就绪',
    items
  }
}

function check(ok, label, detail) {
  return { ok: Boolean(ok), label, detail: String(detail || '') }
}

function buildNextActions(analysis, values, propertyPlan) {
  const actions = []
  if (!analysis.exists) {
    actions.push(action('P0', '先配置服务器目录', '设置里填写包含 server.properties 的 Minecraft Server 目录。', '准备'))
    return actions
  }

  actions.push(action('P0', '保持当前服务器不动', '今天继续只读分析；不要替换 jar、不要写 server.properties、不要重启当前服。', '现在'))
  actions.push(action('P0', '创建测试副本', '复制整个服务器目录到测试目录，在副本里验证 Paper 和插件。', '迁移准备'))

  const changed = propertyPlan.filter(item => item.changed)
  if (changed.length > 0) {
    actions.push(action('P0', '在测试副本应用推荐 server.properties', `${changed.length} 项配置与推荐值不同，先只在测试副本调整。`, '配置'))
  }
  if (analysis.type !== 'paper') {
    actions.push(action('P0', '在测试副本迁移 Paper', 'Paper 是事件桥、权限、导播和可交付服务器能力的基础。', '平台'))
  }
  if (values['online-mode'] === 'false' && values['white-list'] !== 'true') {
    actions.push(action('P1', '决定 LAN/offline 安全策略', '如果局域网人数扩大或直播开放，建议启用白名单或权限插件，避免名字伪造。', '安全'))
  }
  if (!analysis.hasBridgePlugin) {
    actions.push(action('P1', '实现 ai-friend-bridge MVP', '先支持 player_chat、player_position、entity_death、chest_snapshot、block_changed。', '插件'))
  }
  if (!analysis.hasDirectorPlugin) {
    actions.push(action('P2', '设计 ServerTV 导播插件', '先让观察账号旁观目标 AI，再做自动轮换和巡航。', '直播'))
  }
  actions.push(action('P2', '补共享记忆和村庄项目表', '把公共箱子、基地范围、建筑项目和资源缺口做成控制台状态。', 'AI 社会'))
  return actions
}

function action(priority, title, detail, phase) {
  return { priority, title, detail, phase, destructive: false }
}

function buildInventory(analysis, properties) {
  return [
    { label: '服务器目录', value: analysis.serverDir || '未配置' },
    { label: '服务器类型', value: analysis.typeLabel },
    { label: 'Jar', value: analysis.jars.join(', ') || '未识别' },
    { label: '启动脚本', value: analysis.startScripts.join(', ') || '未检测到' },
    { label: 'server.properties', value: properties.exists ? properties.path : '未检测到' },
    { label: '插件', value: analysis.pluginJars.join(', ') || '无' },
    { label: '模组', value: analysis.modJars.join(', ') || '无' },
    { label: 'OP 数量', value: String(analysis.opsCount) },
    { label: '白名单数量', value: String(analysis.whitelistCount) }
  ]
}

function buildPlatformRecommendation(analysis) {
  const currentOk = analysis.type === 'paper'
  return {
    current: analysis.typeLabel,
    recommended: 'Paper',
    urgency: currentOk ? '已满足插件化基础' : '建议在测试副本中迁移',
    rationale: currentOk
      ? '当前已经具备插件目录，可以直接进入服务端事件桥和直播导播插件开发。'
      : '原版服务器可以跑 AI 玩家，但不能装插件；Agent 社会、权限、直播导播和服务端事件流都需要插件化平台。',
    options: [
      {
        name: '继续 Vanilla',
        fit: '今天继续跑现有世界、验证 AI 行为。',
        tradeoff: '不能装服务端插件，控制台只能依赖日志、命令和 Mindcraft 状态。'
      },
      {
        name: '迁移 Paper',
        fit: '做成可交付产品、直播服务器和 Agent 社会系统。',
        tradeoff: '需要停服备份后替换服务端 jar，并在测试副本验证兼容性。'
      },
      {
        name: '迁移 Fabric/Forge',
        fit: '需要大量服务端模组或客户端模组生态。',
        tradeoff: '插件生态和普通局域网玩家易用性不如 Paper 直接。'
      }
    ]
  }
}

function buildSummary(analysis, propertyPlan, platform, readiness) {
  const changed = propertyPlan.filter(item => item.changed).length
  const typeText = analysis.exists ? analysis.typeLabel : '服务器目录未配置或不存在'
  const avgScore = Math.round(readiness.reduce((sum, item) => sum + item.score, 0) / Math.max(1, readiness.length))
  return [
    `当前识别为：${typeText}。`,
    `推荐方向：${platform.recommended} + AI 服务端事件桥 + ServerTV 直播观察账号。`,
    `server.properties 建议项：${changed} 项和推荐值不同。`,
    `产品化就绪度：${avgScore}%。`,
    '本蓝图只读生成，不会修改当前服务器。'
  ]
}

function buildFutureCommands(propertyPlan, values) {
  const commands = []
  const difficulty = propertyPlan.find(item => item.key === 'difficulty')
  const gamemode = propertyPlan.find(item => item.key === 'gamemode')
  if (difficulty && difficulty.changed) commands.push(`difficulty ${difficulty.recommended}`)
  if (gamemode && gamemode.changed) commands.push(`defaultgamemode ${gamemode.recommended}`)
  if (values['white-list'] === 'true') commands.push('whitelist add ServerTV')
  commands.push('gamemode spectator ServerTV')
  commands.push('save-all')
  return commands
}

function buildLivestreamPlan() {
  return {
    recommendedPath: '独立 ServerTV 账号 + 旁观模式 + 原生客户端/OBS；后续用 director 插件自动运镜。',
    stages: [
      'MVP：前端聚合 Mindcraft bot viewer，方便观察 AI 正在做什么。',
      '直播稳定版：ServerTV 进入服务器，OBS 捕获原生 Minecraft 客户端。',
      '无人值守版：服务端 director 插件控制 ServerTV 跟拍、轮换目标、无人在线时巡航村庄。',
      '产品版：控制台显示导播状态、当前镜头、目标 AI、推流健康检查。'
    ],
    limitation: '服务器本身不能直接产生完整客户端画面；高清直播仍需要渲染客户端或网页 viewer 再交给 OBS/FFmpeg。'
  }
}

function buildAgentSocietyPlan() {
  return {
    residentNames: ['Alex', 'Luna'],
    basePolicy: [
      '所有 AI 是常驻居民，不是玩家跟随宠物。',
      '每个 AI 有长期角色：Alex 负责生存管家，Luna 负责建筑；稳定后再扩展专职居民。',
      '公共箱子作为共享库存，AI 定期存入木头、石头、煤、食物、羊毛和工具。',
      '基地半径默认 120 格，先建设照明、围栏、道路、农场、储物和住宅。',
      '遇到真人玩家求助时优先响应；无人在线时继续执行村庄建设。'
    ],
    serverSupportNeeded: [
      '稳定读取玩家和 AI 坐标。',
      '读取公共箱子库存和村庄资源状态。',
      '记录 AI 死亡、迷路、饥饿、战斗和建筑完成事件。',
      '为长期目标提供世界级记忆，而不是只依赖单个 bot 的短期上下文。'
    ]
  }
}

function buildBackupPlan(analysis) {
  return {
    strategy: '正式迁移前先复制整个服务器目录；测试副本验证通过后再考虑生产切换。',
    targets: BACKUP_TARGETS.map(item => ({
      ...item,
      exists: Boolean(analysis.exists && fs.existsSync(path.join(analysis.serverDir, item.path)))
    })),
    restoreRule: '任何 Paper 或插件验证失败时，停止测试服，丢弃测试副本；生产服只从完整备份恢复。'
  }
}

function buildAcceptancePlan() {
  return [
    '测试服能启动并监听配置端口。',
    '原版客户端或 HMCL 离线名能进入测试服。',
    'Mindcraft 能创建并启动 Alex、Luna。',
    '2 个 AI 能在基地 120 格范围内执行安全、采集、建造、存箱任务。',
    'ai-friend-bridge 能推送聊天、坐标、死亡、箱子和方块事件。',
    'ServerTV 能进入旁观模式，OBS 能捕获稳定画面。',
    '测试 30 分钟内无持续报错、无重复掉线、无明显 TPS/卡顿问题。',
    '能从备份恢复到迁移前世界状态。'
  ]
}

function buildBridgeContract() {
  return {
    transport: 'Paper plugin -> local HTTP/WebSocket -> control app',
    endpoints: [
      { method: 'POST', path: '/bridge/hello', purpose: '插件启动握手，报告服务器版本、世界名和插件版本。' },
      { method: 'POST', path: '/bridge/events', purpose: '批量推送服务端事件。' },
      { method: 'GET', path: '/bridge/snapshot', purpose: '控制台请求当前在线玩家、村庄区域、箱子和世界状态。' }
    ],
    events: [
      'player_chat',
      'player_position',
      'agent_position',
      'entity_death',
      'block_changed',
      'chest_snapshot',
      'time_changed',
      'weather_changed',
      'village_snapshot',
      'camera_state'
    ],
    minimumPayload: {
      type: 'player_chat',
      at: '2026-06-21T00:00:00.000Z',
      world: 'world',
      actor: 'MengMeng',
      position: { x: 0, y: 64, z: 0 },
      data: { message: 'Alex 来帮我' }
    }
  }
}

function buildMigrationPlan(analysis) {
  return [
    {
      phase: '今天不动服务器',
      actions: [
        '保留当前运行中的服务器。',
        '只在控制台里查看本蓝图和推荐配置。',
        '不写 server.properties，不替换 jar，不重启服务。'
      ]
    },
    {
      phase: '测试副本验证',
      actions: [
        '复制整个服务器目录到测试目录。',
        '备份 world、server.properties、ops.json、whitelist.json。',
        analysis.type === 'paper' ? '确认 plugins 目录可用。' : '在测试目录替换为 Paper 启动 jar。',
        '启动测试服并确认原版客户端、Mindcraft 和 2 个 AI 能正常进入。'
      ]
    },
    {
      phase: '插件化能力',
      actions: [
        '实现 ai-friend-bridge 插件，把服务端事件推送给控制台。',
        '实现 ServerTV/director 导播控制。',
        '加权限、白名单、备份和崩溃恢复策略。'
      ]
    },
    {
      phase: '正式切换',
      actions: [
        '停服前执行 save-all。',
        '完整备份生产服务器目录。',
        '切换启动脚本到验证过的 Paper jar。',
        '启动后检查日志、在线人数、AI 进服、公共箱子和直播视角。'
      ]
    }
  ]
}

function renderPropertiesPreview(plan) {
  return plan.map(item => {
    const current = item.current === '' ? '<missing>' : item.current
    const marker = item.changed ? 'CHANGE' : 'OK'
    return `${marker} ${item.key}: ${current} -> ${item.recommended}`
  }).join('\n')
}

function formatServerBlueprintMarkdown(blueprint) {
  const lines = []
  lines.push('# Minecraft AI Friend 服务器改造方案')
  lines.push('')
  for (const item of blueprint.summary) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## 当前服务器')
  lines.push('')
  for (const item of blueprint.inventory) lines.push(`- ${item.label}: ${item.value}`)
  lines.push('')
  lines.push('## 就绪度')
  lines.push('')
  for (const group of blueprint.readiness) {
    lines.push(`- ${group.title}: ${group.score}% (${group.statusLabel})`)
    for (const item of group.items) lines.push(`  - ${item.ok ? 'OK' : 'TODO'} ${item.label}: ${item.detail}`)
  }
  lines.push('')
  lines.push('## 下一步')
  lines.push('')
  for (const item of blueprint.nextActions) lines.push(`- ${item.priority} [${item.phase}] ${item.title}: ${item.detail}`)
  lines.push('')
  lines.push('## 推荐 server.properties')
  lines.push('')
  for (const item of blueprint.properties.changes) {
    const current = item.current === '' ? '未设置' : item.current
    lines.push(`- ${item.key}: 当前 ${current}，建议 ${item.recommended}。${item.reason}`)
  }
  lines.push('')
  lines.push('## 平台路线')
  lines.push('')
  lines.push(`- 推荐：${blueprint.platform.recommended}`)
  lines.push(`- 原因：${blueprint.platform.rationale}`)
  lines.push('')
  lines.push('## 插件能力')
  lines.push('')
  for (const plugin of blueprint.plugins) lines.push(`- ${plugin.priority} ${plugin.name}: ${plugin.purpose}`)
  lines.push('')
  lines.push('## 事件桥契约')
  lines.push('')
  lines.push(`- 传输：${blueprint.bridgeContract.transport}`)
  lines.push(`- 事件：${blueprint.bridgeContract.events.join(', ')}`)
  lines.push('')
  lines.push('## 直播链路')
  lines.push('')
  lines.push(`- ${blueprint.livestream.recommendedPath}`)
  for (const stage of blueprint.livestream.stages) lines.push(`- ${stage}`)
  lines.push('')
  lines.push('## 备份范围')
  lines.push('')
  for (const item of blueprint.backup.targets) lines.push(`- ${item.exists ? 'FOUND' : 'MISSING'} ${item.path}: ${item.reason}`)
  lines.push('')
  lines.push('## 验收标准')
  lines.push('')
  for (const item of blueprint.acceptance) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## 迁移步骤')
  lines.push('')
  for (const phase of blueprint.migration) {
    lines.push(`### ${phase.phase}`)
    for (const action of phase.actions) lines.push(`- ${action}`)
    lines.push('')
  }
  return lines.join('\n')
}

function listJarNames(dir) {
  return safeList(dir).filter(fileName => fileName.toLowerCase().endsWith('.jar')).sort()
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

module.exports = {
  buildServerBlueprint: buildServerBlueprintWithMarkdown,
  formatServerBlueprintMarkdown
}
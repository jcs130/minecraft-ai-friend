// 世界 bootstrap —— 天神侧唯一进程，握 RCON。只应运行在 MC 服务器旁。
//
// 魔法之神（女神化身 Goddess）以旁观者视角常驻世界：
//   - 公屏咏唱 → mc-magic 快路径施法（程序化、零 LLM）
//   - 私聊祈愿 → mc-god 慢路径神谕（LLM 裁决，可拒绝/提条件）
//   - 玩家进服 → mc-ritual 降临仪式（公屏宣读候选，聊天选天赋）
// 一切神力经 mc-rcon（唯一 RCON 服务）落地。
//
// 与穿越者进程（bootstrap-mc.mts）完全解耦：通信只走 MC 聊天文字，
// 任何一方重启/多开，另一方无感知。
// 启动：start-world.bat
//
// 2026-08-21 已脱 cordis 壳：手动依赖注入（createXxx 工厂），
// 依赖顺序 = 无依赖者先建，mc-god 最后建（依赖最多），
// mc-magic ↔ mc-god 的循环依赖经 magic.setChronicle(god.service.record) 迟绑定解开。
import fs from 'node:fs'
import { createBot } from './src/mc-bot.ts'
import { createRcon } from './src/mc-rcon.ts'
import { createLogwatch } from './src/mc-logwatch.ts'
import { createWorlddb } from './src/mc-worlddb.ts'
import { createTransmigrator } from './src/mc-transmigrator.ts'
import { createMagic } from './src/mc-magic.ts'
import { createGod } from './src/mc-god.ts'
import { createRitual } from './src/mc-ritual.ts'
import { createSocial } from './src/mc-social.ts'
import { createBubble } from './src/mc-bubble.ts'
import { createEvolveReview } from './src/mc-evolve-review.ts'
import { createTerra } from './src/mc-terra.ts'
import { createSaga } from './src/mc-saga.ts'
import { startModernViewer } from './src/mc-modern-viewer.mts'
import type { Bot } from 'mineflayer'

// 运行态根（2026-08-20 D 步迁正仓）：默认 ./data（仓内自足）；迁正仓跑时经 MC_DATA_DIR 指向部署现场 data（运行态正本）
const D = process.env.MC_DATA_DIR ?? './data'
const RUN_MS = Number(process.env.RUN_MS ?? 0)
// 进程级兜底：世界进程死了=没有女神（施法/祈愿/仪式全瘫），比 bot 死更伤。
// mineflayer/RCON 内部 promise 拒绝无人可 catch 时保进程（详见 bootstrap-mc.mts 同款注释）。
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error(`[bootstrap-world] UNHANDLED REJECTION (suppressed): ${detail}`)
})
process.on('uncaughtException', (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`[bootstrap-world] UNCAUGHT EXCEPTION (suppressed): ${detail}`)
})
// 女神化身名：穿越者进程靠它寻址私聊/识别公屏回复，须与穿越者侧 MC_GOD_NAME 一致。
const godName = process.env.MC_GOD_NAME ?? 'Goddess'

// ---------- 手动依赖注入装配 ----------
const bot = createBot({
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: godName,
  autoReconnect: true,
  viewerEnabled: process.env.MC_VIEWER === '1', // 女神天眼：MC_VIEWER=1 时开启（9090 面板无穿越者时的兜底画面）
  viewerFirstPerson: process.env.MC_VIEWER_FP === '1',
  viewerPort: Number(process.env.MC_VIEWER_PORT ?? 3050),
  observer: process.env.MC_OBSERVER === '1', // 观察者化身：关物理，位置只随 RCON tp（防与重力模拟互搏掉落）
})
// 现代画面（萌悦 modern-viewer）：MC_MODERN_VIEWER=1 时在 :3070 起 Web 渲染宿主
// （/ 第一人称 · /third/ 环绕跟随 · /dungeon/ 2.5D；面板默认 iframe 切到它，旧 3050 留作回退）
startModernViewer(() => bot.getBot(), { getSettleNpcs: () => settleNpcCache })
const rcon = createRcon({
  enabled: true,
  host: process.env.MC_RCON_HOST ?? process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_RCON_PORT ?? 25575),
  passwordPath: `${D}/rcon-secret.txt`,
})
const logwatch = createLogwatch({
  enabled: true,
  // 原版服事件流：死亡/加入/成就实时写进 latest.log，tail 它 = 零依赖的服务器事件源
  logPath: process.env.MC_LOG_PATH ?? './mc-server/logs/latest.log',
  pollMs: 500,
})
const worlddb = createWorlddb({
  enabled: true,
  dbPath: `${D}/world.db`,
  chronicleMdPath: `${D}/world-chronicle.md`,
  memoryEnabled: process.env.MC_MEMORY_ENABLED !== '0', // 众生册（Qdrant 独立 collection，与家里 MemOS 分开）
  qdrantUrl: process.env.MC_QDRANT_URL ?? 'http://127.0.0.1:6333',
  qdrantCollection: 'mc_world_memory',
  embeddingUrl: process.env.MC_EMBEDDING_URL ?? 'http://127.0.0.1:11434',
  embeddingModel: process.env.MC_EMBEDDING_MODEL ?? 'bge-m3-cpu:latest',
})
const transmigrator = createTransmigrator({
  registryPath: `${D}/transmigrators.json`,
})
const magic = createMagic({
  enabled: true,
  atomsPath: `${D}/magic-atoms.json`,
  statePath: `${D}/magic-state.json`,
  maxManaDefault: 100,
  regenPerSec: 2.0,
  balancePath: `${D}/balance-overrides.json`,
}, { getBot: bot.getBot, rcon: rcon.service })
const terra = createTerra({
  enabled: true,
  dataDir: D,
  pollMs: 60_000,
  maxFixesPerPoll: 5,
}, { getBot: bot.getBot, rcon: rcon.service, worlddb: worlddb.service })
const bubble = createBubble({
  bubbleTtlMs: 6500,
  followIntervalMs: 900,
  maxTextLen: 80,
  statRefreshMs: 60000,
  feedPollMs: 500,
  perPlayerCooldownMs: 900,
}, { rcon: rcon.service, getBot: bot.getBot })
const ritual = createRitual({
  enabled: true,
}, { getBot: bot.getBot, rcon: rcon.service, magic: magic.service, transmigrators: transmigrator.service })
// 女神传声 & 信差（2026-08-17）：说话三档距离转达 + 好友制邮件。
// 数值可被 data/social.json 覆盖（服主调参不改代码）。
// social 需要「bot 不在线时返回 null」而非 throw，故包一层 getBotOrNull。
const getBotOrNull = (): Bot | null => {
  try { return bot.getBot() } catch { return null }
}
const social = createSocial({
  enabled: true,
  socialPath: `${D}/social.json`,
  sayRadius: 48,
  shoutRadius: 96,
  whisperRadius: 6,
  shoutFoodCost: 1,
  posCacheMs: 5_000,
  mailMaxBody: 200,
  mailInboxCap: 50,
  mailPerMinute: 10,
  remindCooldownSec: 60,
  mailReadBatch: 5,
}, { getBot: getBotOrNull, rcon: rcon.service, worlddb: worlddb.service, transmigrators: transmigrator.service })
// 女神的创世之笔（2026-08-18 扛枪点题）：根据在场玩家与故事，
// 构思新咒文（热注入 magic-atoms）/神托任务（供奉核销）/大事件（三幕戏）。
// data/saga-trigger 文件 = 手动构思把手。
const saga = createSaga({
  enabled: process.env.MC_SAGA !== '0',
  qwenpawUrl: process.env.QWENPAW_CONSOLE_URL ?? 'http://127.0.0.1:8088/api/console/chat',
  sagaMs: Number(process.env.MC_SAGA_MS ?? 6 * 3600_000),
  firstDelayMs: Number(process.env.MC_SAGA_FIRST_MS ?? 5 * 60_000),
  pollMs: 60_000,
  maxAtomsPerDay: 2,
  maxActiveQuests: 3,
  minEventGapMs: 4 * 3600_000,
  dataDir: D,
}, { getBot: bot.getBot, rcon: rcon.service, magic: magic.service, worlddb: worlddb.service, transmigrators: transmigrator.service })
// L3 提议进化·世界侧审核官（2026-08-18）：扫描 evolution-proposals/，女神裁决后
// 核准指令落 evolution-directives-<u>.json，穿越者侧 mc-adapt 读回注入。
const evolveReview = createEvolveReview({
  enabled: true,
  qwenpawUrl: process.env.QWENPAW_CONSOLE_URL ?? 'http://127.0.0.1:8088/api/console/chat',
  pollMs: 60_000,
  maxAttempts: 5,
  maxDirectives: 10,
}, { getBot: bot.getBot, worlddb: worlddb.service })
// 女神本尊（慢路径神谕裁决）：依赖最多，最后建。
const god = createGod({
  enabled: true,
  qwenpawUrl: process.env.QWENPAW_CONSOLE_URL ?? 'http://127.0.0.1:8088/api/console/chat',
  cooldownMs: 60_000,
  pollMs: 12_000,
  admitCooldownMs: 30_000,
  deathPollMs: 20_000,
  reviewMs: 7_200_000,
  requirementsPath: `${D}/world-requirements.md`,
  recallTopK: 5,
  skillEventsPath: `${D}/skill-events.json`,
  advancementsDir: process.env.MC_ADVANCEMENTS_DIR ?? './mc-server/advancements',
  advancementUnlocksPath: `${D}/advancement-unlocks.json`,
  advancementNamesPath: `${D}/advancement-names.json`,
  // 「平衡」通道白名单（私服真人玩家名不再硬编码）：默认仅女神；服主可经 MC_MAINTAINERS 注入，逗号分隔
  maintainers: (process.env.MC_MAINTAINERS ?? 'Goddess').split(',').map(s => s.trim()).filter(Boolean),
  // 特殊监听白名单（VIP 真人）：说的一切女神都要聆听回应，绕过冷启动/冷却；经 MC_VIP_LISTEN 注入
  vipListen: (process.env.MC_VIP_LISTEN ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  balanceFlushMs: 120_000,
  bulletinPath: `${D}/balance-bulletin.json`,
  heartbeatPath: `${D}/world-heartbeat.json`,
}, {
  getBot: bot.getBot,
  rcon: rcon.service,
  magic: magic.service,
  worlddb: worlddb.service,
  transmigrators: transmigrator.service,
  logwatch: logwatch.service,
  terra: terra.service,
  bubble: bubble, // 咏唱可视化（2026-08-28）：技艺施放成功时头顶冒咒语气泡
})
// 解开 mc-magic ↔ mc-god 循环依赖：mc-magic 的 chronicle 迟绑定到 mc-god 的史官 record。
magic.setChronicle(god.service.record)
// 契约/魂链法术执行器（2026-08-23）：contract/trace/recall 的效果由 mc-god 落地（写 goddess-orders / tp）。
// 2026-08-29 修：原 lambda 手动转发 4 参，吞掉了第 5 参 atomId——光环系(aura)元素分派
// 全靠 atomId，被吞后 elem 恒空 →「此法术未通」。直接传函数引用，不再逐参转发。
magic.setSpecialExecutor(god.service.execSpecial)

// 女神天眼实体快照（2026-08-23）：周期性把 Goddess 视野内的实体写进 web-entities.json，
// 供 9090 面板小地图标注怪物（#1 怪物显示）。女神以旁观者常驻，视野即「她所见」，
// 覆盖以天眼为中心 / 显视距离内的 mob、村民、玩家。全服精确实体待服务端 mod 版（另立）。
const SNAP_FILE = `${D}/web-entities.json`
const MOB_RE = /(zombie|zombie_villager|drowned|husk|skeleton|stray|wither_skeleton|spider|cave_spider|creep|creeper|enderman|witch|slime|phantom|pillager|vindicator|ravager|evoker|vex|blaze|guardian|elder_guardian|shulker|warden|hoglin|zoglin|piglin|piglin_brute|breeze|bogged|boss|living)/i
// 2026-08-29 智能村民上屏（造物主令）：settlements 自定义实体 mineflayer 不认识（不在 b.entities），
// 天眼快照里一个都没有 → 面板/小地图全村隐身。补录：每 3 轮（4.5s）RCON 一条命令批量拉
// `execute as @e[type=settlements:base_villager] run data get entity @s Pos`，回执每行自带
// 「中文名 has the following entity data: [x, y, z]」（名字+位置一次拿全）。解析结果缓存，
// 每轮以 isNpc=true 注入快照；RCON 失败保留旧缓存（村民不闪没）。
// 2026-08-29 II（9090 村民=盔甲架修复）：再加拉 VillagerData（profession/level），并把名单
// 喂给现代画面（startModernViewer 第二参数）——mineflayer 把 base_villager 错认成
// unknown/armor stand，3070 3D 里村民全成了隐形或盔甲架；viewer 侧按 settle 名单重造实体流。
interface SettleNpc { name: string; x: number; y: number; z: number; profession: string; level: number }
let settleNpcCache: SettleNpc[] = []
let snapTick = 0
const SETTLE_YAW = new Map<string, number>() // 名字→朝向（可选增强，暂不拉）
function parseSettleRcon(out: string): Map<string, { x: number; y: number; z: number }> {
  const clean = String(out).replace(/\u001b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '')
  const map = new Map<string, { x: number; y: number; z: number }>()
  for (const m of clean.matchAll(/([^\n\r]+?) has the following entity data: \[(-?[\d.]+)d?, (-?[\d.]+)d?, (-?[\d.]+)d?\]/g)) {
    map.set(m[1].trim(), { x: +m[2], y: +m[3], z: +m[4] })
  }
  return map
}
function parseSettleProfessions(out: string): Map<string, { profession: string; level: number }> {
  const clean = String(out).replace(/\u001b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '')
  const map = new Map<string, { profession: string; level: number }>()
  for (const m of clean.matchAll(/([^\n\r]+?) has the following entity data: \{type: "[^"]*", profession: "([^"]*)"(?:, level: (\d+))?\}/g)) {
    map.set(m[1].trim(), { profession: m[2].replace(/^.*:/, ''), level: +(m[3] ?? 1) })
  }
  return map
}
function refreshSettleNpcs(): void {
  Promise.all([
    rcon.service.send('execute as @e[type=settlements:base_villager] run data get entity @s Pos'),
    rcon.service.send('execute as @e[type=settlements:base_villager] run data get entity @s VillagerData'),
  ])
    .then(([posOut, profOut]) => {
      const posMap = parseSettleRcon(posOut)
      const profMap = parseSettleProfessions(profOut)
      const rows: SettleNpc[] = []
      for (const [name, p] of posMap) {
        const prof = profMap.get(name)
        rows.push({ name, x: p.x, y: p.y, z: p.z, profession: prof?.profession ?? 'none', level: prof?.level ?? 1 })
      }
      // 空结果=村民真没了（正常不会发生）；RCON 异常走 catch，缓存原地保留
      settleNpcCache = rows
    })
    .catch(() => { /* RCON 未就绪/瞬时失败：用旧缓存 */ })
}
const snapshotTimer = setInterval(() => {
  try {
    const b = bot.getBot()
    if (!b || !b.entities) return
    const now = Date.now()
    const out = { at: now, t: now / 1000, entities: [] as any[] }
    for (const id of Object.keys(b.entities)) {
      const e = b.entities[id]
      if (!e || !e.position) continue
      const ent = e.entity
      const type = String(e.type ?? ent?.type ?? '')
      // 2026-08-23：mobType getter 每次访问都打弃用 Trace（2.7GB err 日志源头），
      // 改走 displayName（官方推荐替代，同值）。统一小写以匹配 MOB_RE 与 NPC_RE。
      const mobType = String(e.displayName ?? ent?.displayName ?? '').toLowerCase()
      const kind = String(e.kind ?? ent?.kind ?? '')
      const name = String(e.username ?? ent?.name ?? '')
      const isPlayer = type === 'player' || !!name
      const isMob = (type === 'mob') || MOB_RE.test(type) || MOB_RE.test(mobType)
      const isNpc = !isPlayer && !isMob && /(villager|wandering_trader|npc)/i.test(type + mobType)
      out.entities.push({
        id, type: mobType || type, kind, name,
        x: Math.round(e.position.x * 10) / 10,
        y: Math.round(e.position.y * 10) / 10,
        z: Math.round(e.position.z * 10) / 10,
        isMob, isNpc, isPlayer,
      })
    }
    // 智能村民注入（RCON 补录，见上）
    if (snapTick % 3 === 0) refreshSettleNpcs()
    for (const v of settleNpcCache) {
      out.entities.push({
        id: 'settle:' + v.name, type: 'villager', kind: 'Village NPC', name: v.name,
        x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10,
        isMob: false, isNpc: true, isPlayer: false,
      })
    }
    fs.writeFileSync(SNAP_FILE, JSON.stringify(out))
    snapTick++
  } catch { /* 天眼快照非关键，静默 */ }
}, 1500)

// ---------- 进程收尾：逆序 dispose ----------
const handles = [bubble, ritual, social, saga, evolveReview, terra, god, magic, transmigrator, worlddb, logwatch, rcon, bot]
// ---------- 小地图地形 tile 服务（2026-08-26：面板小地图「没有东西」根治） ----------
// 复用 Goddess bot 已载入的区块（观察者跟随谁、谁的周边区块就在内存），读顶层块出俯视地形图。
// GET /map.png?cx=&cz=&r=  → r*2 见方 PNG（1px/格），缓存 90s，渲染串行+让路（不卡 viewer 流）。
// 配色与列扫描移植自 sidecar/guard/guard-render-pure.mts（守卫之眼同源，视觉一致）。
import http from 'node:http'
import { PNG } from 'pngjs'
import { Vec3 } from 'vec3'

const MAP_PORT = Number(process.env.MC_MAP_PORT ?? 3060)
const TILE_COLORS: Record<string, [number, number, number]> = {
  grass_block: [106, 170, 64], dirt: [134, 96, 67], coarse_dirt: [119, 85, 59],
  stone: [125, 125, 125], granite: [149, 103, 85], diorite: [188, 188, 191], andesite: [136, 136, 137],
  deepslate: [80, 80, 84], tuff: [108, 109, 102], gravel: [127, 124, 123], sand: [219, 211, 160],
  sandstone: [216, 203, 155], red_sand: [190, 102, 40], snow_block: [240, 246, 246], ice: [145, 183, 251],
  water: [63, 118, 228], flowing_water: [63, 118, 228], lava: [207, 91, 19], flowing_lava: [207, 91, 19],
  oak_log: [109, 84, 51], spruce_log: [58, 37, 16], birch_log: [215, 205, 188], cherry_log: [214, 140, 152],
  oak_leaves: [55, 96, 47], spruce_leaves: [50, 90, 45], birch_leaves: [107, 141, 70], cherry_leaves: [228, 158, 191],
  oak_planks: [162, 130, 78], spruce_planks: [114, 84, 48], birch_planks: [192, 175, 121],
  cobblestone: [110, 110, 110], mossy_cobblestone: [90, 108, 90], stone_bricks: [122, 121, 122],
  bricks: [151, 97, 91], glass: [180, 220, 240], iron_block: [216, 216, 216], gold_block: [246, 208, 61],
  diamond_block: [98, 237, 228], emerald_block: [98, 224, 113], lapis_block: [35, 79, 175],
  coal_ore: [80, 80, 80], iron_ore: [175, 142, 117], copper_ore: [181, 108, 80], gold_ore: [180, 155, 78],
  redstone_ore: [150, 70, 70], diamond_ore: [95, 130, 130], emerald_ore: [100, 160, 110], lapis_ore: [60, 75, 140],
  bedrock: [60, 60, 60], obsidian: [21, 18, 32], glowstone: [220, 190, 110], sea_lantern: [173, 214, 214],
  pumpkin: [196, 118, 21], melon: [108, 154, 24], hay_block: [255, 178, 0], wheat: [218, 182, 67],
  carrot: [255, 255, 255], potato: [255, 255, 255], torch: [230, 170, 60], lantern: [230, 170, 60],
  chest: [140, 100, 50], crafting_table: [120, 90, 50], furnace: [90, 90, 90], bookshelf: [140, 110, 70],
  bed: [200, 60, 60], path: [180, 160, 120], farmland: [110, 70, 40], clay: [160, 170, 180],
  terracotta: [150, 100, 80], bamboo: [100, 140, 60], sugar_cane: [140, 180, 100], cactus: [80, 140, 60],
  lily_pad: [50, 130, 80], seagrass: [60, 120, 90], kelp: [40, 110, 70], kelp_plant: [40, 110, 70],
}
function tileColorFor(name: string): [number, number, number] {
  const c = TILE_COLORS[name]
  if (c) return c
  const n = name || ''
  if (n.includes('leaves')) return [60, 110, 45]
  if (n.includes('log') || n.includes('wood')) return [110, 80, 45]
  if (n.includes('planks') || n.includes('stairs') || n.includes('slab') || n.includes('fence') || n.includes('door')) return [150, 120, 75]
  if (n.includes('ore')) return [90, 90, 90]
  if (n.includes('stone') || n.includes('brick')) return [118, 118, 118]
  if (n.includes('water')) return [63, 118, 228]
  if (n.includes('lava')) return [207, 91, 19]
  if (n.includes('sand')) return [216, 208, 160]
  if (n.includes('glass')) return [170, 190, 200]
  if (n.includes('flower') || n.includes('poppy') || n.includes('tulip') || n.includes('grass')) return [106, 170, 64]
  if (n.includes('snow') || n.includes('ice')) return [230, 240, 245]
  if (n.includes('wool') || n.includes('carpet')) return [190, 160, 170]
  return [127, 127, 127] as [number, number, number]
}
const tileCache = new Map<string, { buf: Buffer; at: number }>()
let tileBusy = false
let tileQueued: (() => void) | null = null
const yieldTick = () => new Promise<void>((r) => setImmediate(r))
async function renderTilePNG(bot: any, cx: number, cz: number, r: number): Promise<Buffer> {
  const size = r * 2
  const png = new PNG({ width: size, height: size })
  const yTop = 110, yBot = -16
  const ox = Math.round(cx) - r, oz = Math.round(cz) - r
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) {
      const bx = ox + dx, bz = oz + dz
      let col: [number, number, number] | null = null
      for (let y = yTop; y >= yBot; y--) {
        const b = bot.world.getBlock(new Vec3(bx, y, bz))
        if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') { col = tileColorFor(b.name); break }
      }
      const c = col ?? [28, 32, 48] // 未载区块（远离跟随目标）= 深夜蓝
      const idx = (size * dz + dx) << 2
      png.data[idx] = c[0]; png.data[idx + 1] = c[1]; png.data[idx + 2] = c[2]; png.data[idx + 3] = 255
    }
    if ((dz & 7) === 7) await yieldTick() // 每 8 行让路事件循环，viewer 流不断
  }
  return PNG.sync.write(png)
}
function serveMapTiles(getBot: () => any, worlddb?: { discoveryList(): Array<{ id: number; name: string; kind: string; x: number; z: number; found_by: string; ts: number }> }): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // 探索者舆图（2026-08-29 造物主谕）：发现点地名经纬，供 9090 世界地图上图。
    if (url.pathname.endsWith('/api/discoveries')) {
      const rows = worlddb?.discoveryList() ?? []
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(rows))
      return
    }
    if (!url.pathname.endsWith('/map.png')) { res.writeHead(404).end(); return }
    const cx = Number(url.searchParams.get('cx')), cz = Number(url.searchParams.get('cz'))
    let r = Number(url.searchParams.get('r') ?? 64)
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) { res.writeHead(400).end('bad cx/cz'); return }
    r = Math.max(8, Math.min(128, Number.isFinite(r) ? r : 64)) // 上限 128：256² 列扫描 ~1s，再大顶不住
    const key = `${Math.round(cx)},${Math.round(cz)},${r}`
    const hit = tileCache.get(key)
    if (hit && Date.now() - hit.at < 90_000) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=30' }).end(hit.buf)
      return
    }
    const job = () => new Promise<void>((resolve) => {
      const b = getBot()
      if (!b || !b.world) { res.writeHead(503).end('bot not ready'); resolve(); return }
      renderTilePNG(b, cx, cz, r)
        .then((buf) => {
          tileCache.set(key, { buf, at: Date.now() })
          if (tileCache.size > 80) { // 简单 LRU：超 80 条删最旧
            const first = tileCache.keys().next().value
            if (first !== undefined) tileCache.delete(first)
          }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=30' }).end(buf)
          resolve()
        })
        .catch((e) => { res.writeHead(500).end(String(e?.message ?? e)); resolve() })
    })
    if (tileBusy) { tileQueued = job; return } // 串行：忙时只留最新请求
    tileBusy = true
    job().finally(() => {
      tileBusy = false
      if (tileQueued) { const next = tileQueued; tileQueued = null; tileBusy = true; next().finally(() => { tileBusy = false }) }
    })
  })
  server.listen(MAP_PORT, '0.0.0.0', () => console.log(`[bootstrap-world] map tile service on :${MAP_PORT} (/map.png?cx=&cz=&r=)`))
}
// 注意：调用必须在 MAP_PORT 等 const 定义之后（TDZ：早于定义调用 serveMapTiles 会
// ReferenceError，且被 uncaughtException 兜底吞掉=进程活着但服务没起，极难察觉）。
serveMapTiles(() => bot.getBot(), worlddb.service)

let shuttingDown = false
const shutdown = (): void => {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(snapshotTimer)
  console.log('[bootstrap-world] shutting down ...')
  for (const h of handles) {
    try { h.dispose() } catch (e) {
      console.error('[bootstrap-world] dispose error:', e instanceof Error ? e.message : String(e))
    }
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`[bootstrap-world] world process armed (goddess="${godName}", sole RCON holder), running ${RUN_MS > 0 ? RUN_MS + 'ms' : 'indefinitely'} ...`)
if (RUN_MS > 0) {
  await new Promise((resolve) => setTimeout(resolve, RUN_MS))
  console.log('[bootstrap-world] done, exiting')
  shutdown()
} else {
  await new Promise(() => {})
}

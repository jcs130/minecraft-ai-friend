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
})
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
})
// 解开 mc-magic ↔ mc-god 循环依赖：mc-magic 的 chronicle 迟绑定到 mc-god 的史官 record。
magic.setChronicle(god.service.record)

// ---------- 进程收尾：逆序 dispose ----------
const handles = [bubble, ritual, social, saga, evolveReview, terra, god, magic, transmigrator, worlddb, logwatch, rcon, bot]
let shuttingDown = false
const shutdown = (): void => {
  if (shuttingDown) return
  shuttingDown = true
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

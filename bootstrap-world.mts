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
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import * as mcBot from './src/mc-bot.ts'
import * as mcRcon from './src/mc-rcon.ts'
import * as mcLogwatch from './src/mc-logwatch.ts'
import * as mcWorlddb from './src/mc-worlddb.ts'
import * as mcTransmigrator from './src/mc-transmigrator.ts'
import * as mcMagic from './src/mc-magic.ts'
import * as mcGod from './src/mc-god.ts'
import * as mcRitual from './src/mc-ritual.ts'
import * as mcSocial from './src/mc-social.ts'

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

const ctx = new Context()
await ctx.plugin(Timer)

await ctx.plugin(mcBot, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: godName,
  autoReconnect: true,
  viewerEnabled: false, // 女神无需被观察；穿越者才开 viewer
  viewerFirstPerson: false,
  viewerPort: 0,
})
await ctx.plugin(mcRcon, {
  enabled: true,
  host: process.env.MC_RCON_HOST ?? process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_RCON_PORT ?? 25575),
  passwordPath: './data/rcon-secret.txt',
})
await ctx.plugin(mcLogwatch, {
  enabled: true,
  // 原版服事件流：死亡/加入/成就实时写进 latest.log，tail 它 = 零依赖的服务器事件源
  logPath: process.env.MC_LOG_PATH ?? './mc-server/logs/latest.log',
  pollMs: 500,
})
await ctx.plugin(mcWorlddb, {
  enabled: true,
  dbPath: './data/world.db',
  chronicleMdPath: './data/world-chronicle.md',
  memoryEnabled: process.env.MC_MEMORY_ENABLED !== '0', // 众生册（Qdrant 独立 collection，与家里 MemOS 分开）
  qdrantUrl: process.env.MC_QDRANT_URL ?? 'http://127.0.0.1:6333',
  qdrantCollection: 'mc_world_memory',
  embeddingUrl: process.env.MC_EMBEDDING_URL ?? 'http://127.0.0.1:11434',
  embeddingModel: process.env.MC_EMBEDDING_MODEL ?? 'bge-m3-cpu:latest',
})
await ctx.plugin(mcTransmigrator, {
  registryPath: './data/transmigrators.json',
})
await ctx.plugin(mcMagic, {
  enabled: true,
  atomsPath: './data/magic-atoms.json',
  statePath: './data/magic-state.json',
  maxManaDefault: 100,
  regenPerSec: 2.0,
  balancePath: './data/balance-overrides.json',
})
await ctx.plugin(mcGod, {
  enabled: true,
  qwenpawUrl: process.env.QWENPAW_CONSOLE_URL ?? 'http://127.0.0.1:8088/api/console/chat',
  cooldownMs: 60_000,
  pollMs: 12_000,
  admitCooldownMs: 30_000,
  deathPollMs: 20_000,
  reviewMs: 7_200_000,
  requirementsPath: './data/world-requirements.md',
  recallTopK: 5,
  skillEventsPath: './data/skill-events.json',
  advancementsDir: process.env.MC_ADVANCEMENTS_DIR ?? './mc-server/advancements',
  advancementUnlocksPath: './data/advancement-unlocks.json',
  advancementNamesPath: './data/advancement-names.json',
  maintainers: ['MengMeng', 'Goddess'],
  balanceFlushMs: 120_000,
  bulletinPath: './data/balance-bulletin.json',
  heartbeatPath: './data/world-heartbeat.json',
})
await ctx.plugin(mcRitual, {
  enabled: true,
})
// 女神传声 & 信差（2026-08-17）：说话三档距离转达 + 好友制邮件。
// 数值可被 data/social.json 覆盖（服主调参不改代码）。
await ctx.plugin(mcSocial, {
  enabled: true,
  socialPath: './data/social.json',
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
})

console.log(`[bootstrap-world] world process armed (goddess="${godName}", sole RCON holder), running ${RUN_MS > 0 ? RUN_MS + 'ms' : 'indefinitely'} ...`)
if (RUN_MS > 0) {
  await new Promise((resolve) => setTimeout(resolve, RUN_MS))
  console.log('[bootstrap-world] done, exiting')
  process.exit(0)
} else {
  await new Promise(() => {})
}

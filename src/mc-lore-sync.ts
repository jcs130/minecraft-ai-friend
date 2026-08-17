/**
 * mc-lore-sync —— 世界记忆出口：编年史 → MemOS 公共知识库（mc-world cube）。
 *
 * 世界的记忆系统有两层，本插件负责把「世界侧真源」同步成「人人可读的公共档案」：
 *   - 真源：world.db 的 chronicle 表（世界进程唯一持久层，含穿越者历程/供奉/裁决/觉醒）
 *   - 公共库：MemOS mc-world cube（世界设定/NPC 志/魔法规则等手灌文档也在这里）
 *
 * 同步策略：
 *   - 增量：记住 lastSyncAt（存 data/lore-sync-state.json），只同步 chronicleSince(lastSyncAt)
 *   - 攒批：把新增条目按 20 条一批拼成一段叙事文本再 add（MemOS 向量检索单条太碎，
 *     一批一段既能命中又不至于淹没个人记忆）
 *   - 防洪：单轮最多同步 200 条（积压过多时分多轮追平，避免一次 add 巨文）
 *   - 每条带【编年史】前缀 + 日期，穿越者 mc_lore 检索时能分清「世界档案」与「个人回忆」
 *
 * MemOS 不可用时静默跳过（不抛、不阻塞世界进程），下轮重试。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const name = 'mc-lore-sync'
export const inject = ['timer', 'mcWorlddb']

export interface Config {
  enabled: boolean
  baseUrl: string
  /** MemOS 公共库 user_id（与手灌世界设定同一个 cube）。 */
  cubeUser: string
  /** 同步间隔（分钟）。 */
  intervalMin: number
  /** 每批拼多少条编年史为一段。 */
  batchSize: number
  /** 单轮最多处理条数（防洪）。 */
  maxPerRun: number
  statePath: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  baseUrl: Schema.string().default('http://127.0.0.1:8002'),
  cubeUser: Schema.string().default('mc-world'),
  intervalMin: Schema.number().default(30),
  batchSize: Schema.number().default(20),
  maxPerRun: Schema.number().default(200),
  statePath: Schema.string().default('./data/lore-sync-state.json'),
  timeoutMs: Schema.number().default(15_000),
})

interface SyncState {
  lastSyncAt: number
}

function loadState(path: string): SyncState {
  try {
    const s = JSON.parse(readFileSync(path, 'utf-8')) as SyncState
    if (typeof s.lastSyncAt === 'number') return s
  } catch { /* 首次运行 */ }
  // 默认从 0 同步：把存量编年史全部补进公共库（世界档案完整可查）。
  return { lastSyncAt: 0 }
}

function saveState(path: string, state: SyncState) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch { /* 状态写失败不致命，下轮重扫（MemOS add 幂等性可接受少量重复） */ }
}

/** 编年史条目 → 一行叙事。detail 的 value 只留标量，避免 JSON 噪音。 */
function entryLine(e: { at: number; type: string; actor: string; detail: Record<string, unknown> }): string {
  const d = new Date(e.at)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const parts: string[] = []
  for (const [k, v] of Object.entries(e.detail ?? {})) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`)
  }
  const detail = parts.length ? `（${parts.join(', ')}）` : ''
  return `${date} ${e.actor} ${e.type}${detail}`
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) {
    console.log('[mc-lore-sync] disabled')
    return
  }
  const statePath = resolve(config.statePath)

  async function addToCube(text: string): Promise<boolean> {
    try {
      const res = await fetch(`${config.baseUrl}/product/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
        body: JSON.stringify({ user_id: config.cubeUser, messages: [{ role: 'assistant', content: text.slice(0, 4000) }] }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  let syncing = false
  async function runOnce(): Promise<void> {
    if (syncing) return
    syncing = true
    try {
      const state = loadState(statePath)
      const entries = ctx.mcWorlddb.chronicleSince(state.lastSyncAt)
      if (entries.length === 0) return
      const take = entries.slice(0, config.maxPerRun)
      // 攒批：每 batchSize 条拼一段叙事（一段=一条 MemOS 记忆）。
      let okCount = 0
      for (let i = 0; i < take.length; i += config.batchSize) {
        const batch = take.slice(i, i + config.batchSize)
        const text = `【编年史】世界大事记（${batch.length} 条）：\n` + batch.map(entryLine).join('\n')
        if (await addToCube(text)) okCount += batch.length
        else break // MemOS 挂了：本轮放弃，不推进游标，下轮重来
      }
      if (okCount > 0) {
        // 游标推进到最后一批（无论是否全部成功，只推已成功批次末尾附近；简化：全成功才推满）。
        const advanced = okCount === take.length ? take[take.length - 1].at : take[Math.max(0, okCount - config.batchSize)].at
        saveState(statePath, { lastSyncAt: advanced + 1 })
        console.log(`[mc-lore-sync] chronicle → ${config.cubeUser} 同步 ${okCount} 条（游标 →${new Date(advanced).toISOString()}）`)
      }
    } catch (e) {
      console.log(`[mc-lore-sync] 同步异常（下轮重试）: ${e instanceof Error ? e.message : e}`)
    } finally {
      syncing = false
    }
  }

  // timer 递归调度：每 intervalMin 分钟一轮增量同步。
  let stopped = false
  function schedule() {
    if (stopped) return
    ctx.timer.setTimeout(async () => {
      await runOnce().catch(() => { /* 自吞 */ })
      schedule()
    }, config.intervalMin * 60_000)
  }
  schedule()
  // 启动 20s 后先跑一轮（存量编年史首次全量入库）。
  ctx.timer.setTimeout(() => void runOnce(), 20_000)

  console.log(`[mc-lore-sync] chronicle → MemOS(${config.cubeUser}) sync ready (every ${config.intervalMin}min)`)
}

/**
 * mc-terra —— 女神的地貌之手（2026-08-18 扛枪拍板：女神可自主决定改变地貌）
 *
 * 两条权能，全走白名单+限额，神力有边界：
 *  1.【巡检自主处置】消费宿主巡检员（terra_steward.py，扫 .mca 区块文件）写入的
 *    ./data/terra-report.json 隐患清单：露天竖井（玩家/bot 脚下陷阱）→ RCON 复核
 *    （setblock keep，非 air 即误报）→ 封盖+火把 → 编年史 + 女神公屏公告。
 *    这是她既定神谕「井洞类隐患即时降谕处置」的程序化落地。
 *  2.【神谕地貌旨意】女神慢路径回复文本中可嵌 TERRAFORM JSON 指令（mc-god.ts
 *    callAgent 回执处调用 executeOracle）：铺路/平整/造景由她 LLM 自主决定，
 *    本插件校验（操作白名单/方块白名单/体量上限/聚居区半径）后经 RCON 落地。
 *    她的意志 → 白名单闸门 → 世界改变，全程编年史留痕。
 *
 * 安全边界：水/岩浆/TNT/火一律不可造（防洪灌滥用）；单 fill ≤512 方块（air ≤256）；
 * 单次神谕 ≤8 op / ≤2048 方块；聚居区 (-109,64,147) 半径 400 格内、y∈[-60,320]。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'mc-terra'
export const inject = ['mcbot', 'mcRcon', 'mcWorlddb', 'timer']

export interface Config {
  enabled: boolean
  dataDir: string
  pollMs: number
  /** 每轮巡检处置上限（防误报风暴） */
  maxFixesPerPoll: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default('./data'),
  pollMs: Schema.number().default(60_000),
  maxFixesPerPoll: Schema.number().default(5),
})

interface Finding {
  id: string
  type: 'open_shaft' | 'water_hazard' | 'death_cluster' | string
  x: number
  y: number
  z: number
  depth?: number
  evidence?: string
  source?: string
  createdAt?: string
  status?: 'pending' | 'fixed' | 'noted' | 'false_positive' | string
  fixedAt?: string
}

// 可塑之材白名单（神可造之物——建筑与照明系；水/岩浆/TNT/火永不入列）
const BLOCK_WHITELIST = new Set([
  'cobblestone', 'stone', 'stone_bricks', 'smooth_stone', 'polished_andesite', 'granite', 'diorite', 'andesite',
  'dirt', 'grass_block', 'coarse_dirt', 'gravel', 'sand', 'red_sand', 'clay',
  'oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'oak_log', 'spruce_log', 'birch_log', 'stripped_oak_log',
  'glass', 'torch', 'soul_torch', 'lantern', 'glowstone', 'sea_lantern', 'shroomlight', 'ochre_froglight',
  'bricks', 'mud_bricks', 'sandstone', 'smooth_sandstone', 'cut_sandstone',
  'stone_brick_stairs', 'cobblestone_stairs', 'oak_stairs', 'spruce_stairs', 'stone_stairs', 'polished_andesite_stairs',
  'stone_brick_slab', 'cobblestone_slab', 'oak_slab', 'stone_slab', 'oak_sign', 'oak_wall_sign',
  'cobblestone_wall', 'stone_brick_wall', 'oak_fence', 'spruce_fence', 'oak_fence_gate',
  'polished_deepslate', 'deepslate_bricks', 'tuff_bricks', 'chiseled_stone_bricks', 'chiseled_tuff_bricks',
  'copper_block', 'waxed_copper_block', 'waxed_cut_copper',
])
const SETTLEMENT = { x: -109, y: 64, z: 147 }
const RADIUS = 400

export interface McTerraService {
  /** 女神神谕文本 → 提取并执行 TERRAFORM 指令，返回执行成功的 op 数。 */
  executeOracle(replyText: string): Promise<number>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcTerra?: McTerraService
  }
}

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function saveJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-terra] ${msg}`)
  if (!config.enabled) return
  const dataDir = config.dataDir
  const reportPath = join(dataDir, 'terra-report.json')
  const fixedPath = join(dataDir, 'terra-fixed.json')
  const worlddb = ctx.mcWorlddb
  const rcon = ctx.mcRcon

  const goddessSay = (msg: string) => {
    try { ctx.mcbot.chat(`§5✦ ${msg}`) } catch { /* bot 不在线 */ }
  }

  function inBounds(x: number, y: number, z: number): boolean {
    if (Math.hypot(x - SETTLEMENT.x, z - SETTLEMENT.z) > RADIUS) return false
    return y >= -60 && y <= 320
  }

  // ── 权能 1：巡检隐患自主处置 ────────────────────────────────────────
  async function consumeReport(): Promise<void> {
    const report = loadJson<Finding[]>(reportPath, [])
    if (!Array.isArray(report)) return
    const fixedLog = loadJson<Array<{ id: string; at: string }>>(fixedPath, [])
    const fixedIds = new Set(fixedLog.map((f) => f.id))
    let fixedThisRound = 0
    for (const f of report) {
      if (f.status !== 'pending' || fixedIds.has(f.id)) continue
      if (fixedThisRound >= config.maxFixesPerPoll) break
      if (f.type === 'open_shaft') {
        try {
          // setblock keep：目标位非 air 时拒绝放置——防误封玩家建筑/矿道入口
          const out = await rcon.send(`setblock ${f.x} ${f.y} ${f.z} minecraft:cobblestone keep`)
          if (/could not|unable/i.test(out)) {
            f.status = 'false_positive'
            f.evidence = `verify: ${out.slice(0, 80)}`
            continue
          }
          await rcon.send(`setblock ${f.x} ${f.y + 1} ${f.z} minecraft:torch`).catch(() => {})
          f.status = 'fixed'
          f.fixedAt = new Date().toISOString()
          fixedLog.push({ id: f.id, at: f.fixedAt })
          fixedIds.add(f.id)
          fixedThisRound += 1
          worlddb.chronicleRecord('terra', 'Goddess', { action: 'seal_shaft', at: [f.x, f.y, f.z], depth: f.depth, source: f.source })
          log(`sealed open shaft ${f.id} @(${f.x},${f.y},${f.z}) depth=${f.depth}`)
        } catch (err) {
          log(`seal ${f.id} failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        // water_hazard / death_cluster：v1 只记录在案（供神谕巡检时参考），不自动动土
        f.status = 'noted'
        worlddb.chronicleRecord('terra', 'Goddess', { action: 'note', type: f.type, at: [f.x, f.y, f.z] })
      }
    }
    if (fixedThisRound > 0) {
      goddessSay(`大地有裂隙伤足——本座已亲手抚平（封井 ${fixedThisRound} 处，皆立火把为记）。众生行走，当心脚下。`)
      saveJson(fixedPath, fixedLog)
    }
    saveJson(reportPath, report)
  }

  // ── 权能 2：神谕 TERRAFORM 指令 ─────────────────────────────────────
  async function executeOracle(replyText: string): Promise<number> {
    if (!replyText) return 0
    const matches = [...replyText.matchAll(/TERRAFORM\s*(\{[\s\S]*?\})/g)]
    if (!matches.length) return 0
    let applied = 0
    let blocks = 0
    const details: Array<Record<string, unknown>> = []
    for (const m of matches.slice(0, 8)) {
      if (applied >= 8 || blocks >= 2048) break
      let d: Record<string, unknown>
      try { d = JSON.parse(m[1]) } catch { details.push({ error: 'bad json', raw: m[1].slice(0, 80) }); continue }
      const op = String(d.op ?? d.action ?? '')
      try {
        if (op === 'fill') {
          const from = d.from as number[] | undefined
          const to = d.to as number[] | undefined
          const block = String(d.block ?? '').replace(/^minecraft:/, '')
          if (!from || !to || from.length !== 3 || to.length !== 3) throw new Error('fill 需要 from/to 三元坐标')
          if (!BLOCK_WHITELIST.has(block)) throw new Error(`方块「${block}」不在神之权能白名单内`)
          const x1 = Math.min(from[0], to[0]), x2 = Math.max(from[0], to[0])
          const y1 = Math.min(from[1], to[1]), y2 = Math.max(from[1], to[1])
          const z1 = Math.min(from[2], to[2]), z2 = Math.max(from[2], to[2])
          const vol = (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1)
          const cap = block === 'air' ? 256 : 512
          if (vol > cap) throw new Error(`体量 ${vol} 超上限 ${cap}`)
          for (const [x, y, z] of [[x1, y1, z1], [x2, y2, z2]]) {
            if (!inBounds(x, y, z)) throw new Error(`(${x},${y},${z}) 越出神域（聚居区半径 ${RADIUS}）`)
          }
          if (blocks + vol > 2048) throw new Error('本次神谕总方量超限')
          await rcon.send(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${block}`)
          blocks += vol
          applied += 1
          details.push({ op: 'fill', from: [x1, y1, z1], to: [x2, y2, z2], block, vol })
        } else if (op === 'setblock') {
          const at = d.at as number[] | undefined
          const block = String(d.block ?? '').replace(/^minecraft:/, '')
          if (!at || at.length !== 3) throw new Error('setblock 需要 at 三元坐标')
          if (!BLOCK_WHITELIST.has(block)) throw new Error(`方块「${block}」不在白名单内`)
          if (!inBounds(at[0], at[1], at[2])) throw new Error(`(${at.join(',')}) 越出神域`)
          await rcon.send(`setblock ${at[0]} ${at[1]} ${at[2]} minecraft:${block}`)
          blocks += 1
          applied += 1
          details.push({ op: 'setblock', at, block })
        } else {
          throw new Error(`未知操作「${op}」（只支持 fill/setblock）`)
        }
      } catch (err) {
        details.push({ op, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (details.length) {
      worlddb.chronicleRecord('terra', 'Goddess', { action: 'oracle_decree', applied, blocks, details })
      log(`oracle decree: applied=${applied} blocks=${blocks} (${JSON.stringify(details).slice(0, 200)})`)
    }
    if (applied > 0) {
      goddessSay(`本座意有所至，大地随之成形（${applied} 道旨意落地）。`)
    }
    return applied
  }

  ctx.provide('mcTerra', { executeOracle })

  // 巡检消费循环
  function schedule(): void {
    ctx.setTimeout(() => {
      void consumeReport().catch((err) => log(`consume error: ${err instanceof Error ? err.message : String(err)}`))
      schedule()
    }, config.pollMs)
  }
  schedule()
  log(`terra steward armed (report=${reportPath}, poll ${config.pollMs}ms)`)
}

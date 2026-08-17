/**
 * analyze-skill-usage.mts — 施法台账分析（2026-08-17）
 *
 * 口径：技能使用 = 服务器问题信号。
 *   - data/skill-usage.jsonl：世界侧每次成功施法一行
 *   - data/mc-brain.log：bot 侧每步决策（goal/thought），按 ts ±45s join
 *     还原"为什么施法"
 *   - 高频 tp + 脱困语义 goal → 寻路/地形/服务器稳定性问题定位
 *   - 各原子频次/消耗 → 天平拨正的数据依据
 *
 * 用法：..\node_modules\.bin\tsx.CMD analyze-skill-usage.mts [--since-hours 24]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const data = resolve(import.meta.dirname, 'data')
const sinceHours = Number(process.argv.includes('--since-hours')
  ? process.argv[process.argv.indexOf('--since-hours') + 1] : 24)

interface Usage { ts: string; player: string; atom: string; chant: string; mana: number; food: number; hp: number; manaLeft: number; maxMana: number; level: number }
interface BrainStep { ts: string; step: number; goal?: string; thought?: string; tool?: string }

const usagePath = resolve(data, 'skill-usage.jsonl')
const brainPath = resolve(data, 'mc-brain.log')
if (!existsSync(usagePath)) { console.log('no skill-usage.jsonl yet'); process.exit(0) }

const cutoff = Date.now() - sinceHours * 3600_000
const usage = readFileSync(usagePath, 'utf8').trim().split('\n')
  .map(l => { try { return JSON.parse(l) as Usage } catch { return null } })
  .filter((u): u is Usage => !!u && Date.parse(u.ts) >= cutoff)

const brain: BrainStep[] = existsSync(brainPath)
  ? readFileSync(brainPath, 'utf8').trim().split('\n')
      .map(l => { try { return JSON.parse(l) as BrainStep } catch { return null } })
      .filter((b): b is BrainStep => !!b)
  : []

// 脱困语义：goal/thought 里含这些词的 tp 施法 ≈ 服务器/寻路问题信号
const STUCK_WORDS = ['脱困', '出坑', '坑底', '卡住', '嵌', '原地', '打转', '困']

const nearestBrain = (ts: number): BrainStep | null => {
  let best: BrainStep | null = null; let bestDt = Infinity
  for (const b of brain) {
    const dt = Math.abs(Date.parse(b.ts) - ts)
    if (dt < bestDt) { bestDt = dt; best = b }
  }
  return bestDt <= 45_000 ? best : null
}

const byAtom = new Map<string, Usage[]>()
for (const u of usage) { const a = byAtom.get(u.atom) ?? []; a.push(u); byAtom.set(u.atom, a) }

console.log(`=== 施法台账（近 ${sinceHours}h，共 ${usage.length} 次）===`)
for (const [atom, list] of [...byAtom.entries()].sort((x, y) => y[1].length - x[1].length)) {
  const stuck = list.filter(u => {
    if (atom !== 'tp') return false
    const b = nearestBrain(Date.parse(u.ts))
    const ctx = (b?.goal ?? '') + (b?.thought ?? '')
    return STUCK_WORDS.some(w => ctx.includes(w))
  }).length
  const players = [...new Set(list.map(u => u.player))].join('/')
  console.log(`${atom.padEnd(12)} ${String(list.length).padStart(3)} 次  [${players}]${atom === 'tp' && stuck > 0 ? `  ⚠️ 其中 ${stuck} 次为脱困语义（服务器/地形信号）` : ''}`)
  for (const u of list.slice(-3)) {
    const b = nearestBrain(Date.parse(u.ts))
    console.log(`   ${u.ts.slice(11, 19)} "${u.chant.slice(0, 24)}" mana${u.mana}${b?.goal ? `  ← goal: ${b.goal.slice(0, 36)}` : ''}`)
  }
}

const tpTotal = byAtom.get('tp')?.length ?? 0
if (tpTotal >= 5) console.log(`\n💡 tp 占比 ${(tpTotal / usage.length * 100).toFixed(0)}%——脱困高频时优先修地形（/fill 坑洞）或查寻路日志，而不是继续加魔法`)

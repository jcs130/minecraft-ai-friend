// Runtime composition and compatibility entry point. Existing exports remain available.
import { SKILLBAR_SLOTS, type CastResult, type Atom, type BalancePatch,
  type MagicService, type GodCastOpts } from './gameplay/magic/contracts.ts'
export * from './gameplay/magic/contracts.ts'
import { GIVE_WHITELIST, GIVE_DEFAULT_COUNT, DEFAULT_ATOMS } from './gameplay/magic/defaults.ts'
export { GIVE_WHITELIST, GIVE_DEFAULT_COUNT } from './gameplay/magic/defaults.ts'
import { castResult, summarizeAtom, BALANCE_FIELDS, BALANCE_GLOBALS,
  buildAppraisalReport, computeCost } from './gameplay/magic/rules.ts'
export { BALANCE_FIELD_ALIASES, balanceFieldLabel, buildAppraisalReport } from './gameplay/magic/rules.ts'
import { CHANT_PREFIXES_PUBLIC, CHANT_PREFIXES, matchChantFrame, DIR_VECTORS,
  matchSpell, extractParams, resolveExactAtom, exactParams } from './gameplay/magic/spell-input.ts'
import { MagicStateStore } from './infrastructure/magic-state-store.ts'
export { MagicStateStore } from './infrastructure/magic-state-store.ts'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import type { RconService } from './mc-rcon.ts'
import { Vec3 } from 'vec3'
import { createLifecycle } from './lifecycle.ts'
import { loadSkillCatalog } from './infrastructure/skill-catalog-file.ts'
import { createWaypointTravel } from './waypoint-travel.ts'
import { castSpring, type SpringReceipt } from './spring-effect-receipt.ts'
export { withSkillRequest } from './spring-effect-receipt.ts'

/**
 * mc-magic —— 快路径魔法系统（世界侧，程序化、零生成式 LLM）。
 *
 * 职责：
 *   - 监听公屏聊天（任何玩家——AI 穿越者或真人——念出含法术关键词的咒语）；
 *   - 程序化结算三资源消耗（mana 时间回蓝 / food 饱食度 / hp 血祭）；
 *   - 经共享 RCON 服务（mc-rcon，世界进程唯一）把法术效果翻译成服务器命令执行；
 *   - 回执走公屏（女神化身点名回复），让施法者的 Agent（和全世界）都能听见。
 *
 * 权限隔离：本插件只存在于世界进程。穿越者进程零 RCON、零魔法 ID——
 * 它们只是"说出咒语"（bot.chat），由这里听见并施法。真人与 AI 同通道。
 */
// 归乡落点（2026-08-30 造物主定谳：家的地址=初始千灯村）：
// ——千灯村·千灯堂（村中心 (-540,868)，35 位村民锚点重心 (-531.6,853.9)），
// 地表 y=62、堂内地板站立点 y=64。归乡固定千灯堂（不再查床——村外/野外
// 睡床会劫持落点，鸣人案例）。旧灯门新镇/收编村庄 (3094,-1338) 随 2026-08-25
// 世界重生已废弃。城镇搬迁只需改这一处。
const TOWN_SPAWN = { x: -540, y: 64, z: 868 } // 千灯堂·千灯村中心（2026-08-30 造物主谕迁址：家的地址=初始千灯村；旧灯门新镇 3094,68,-1338 已随世界重生废弃）

export interface Config {
  enabled: boolean
  atomsPath: string
  statePath: string
  /** Runtime consumer mirror; null disables it for isolated offline fixtures. */
  stateMirrorPath?: string | null
  /** Optional allow-list. Default: skill-catalog.json beside atomsPath; null disables it for fixtures. */
  catalogPath?: string | null
  maxManaDefault: number
  regenPerSec: number
  /** 天平覆盖层（data/balance-overrides.json）：女神动态平衡的补丁持久化。 */
  balancePath: string
}

// ── 咒语向量兜底（2026-08-20 起）：严格匹配失败 → bge-m3 语义近邻 ──
// 2026-08-23 造物主谕「瞬发 vs 前摇」：严格匹配=瞬发（零 LLM）；模糊=向量→LLM→代施（更久+更多魔力）。
const OLLAMA_EMBED_URL = process.env.OLLAMA_EMBED_URL ?? 'http://127.0.0.1:11434/api/embeddings'
const EMBED_MODEL = process.env.MC_EMBED_MODEL ?? 'bge-m3-cpu:latest'
// 阈值：>=0.80 高置信 → 向量模糊施法（×1.5 + 2s 粒子前摇）；0.50~0.80 中置信 → LLM 推理解析；
// <0.50 不足以代言神意（PoC 实证「石头」撞陨石术，歧义须 LLM 把关）。
const VECTOR_DIRECT_THRESHOLD = 0.80
const SUGGEST_THRESHOLD = 0.50
// 模糊施法代价：向量 ×1.5；LLM = 基础 + ⌈tokens/50⌉（上限 80）；向量前摇 2s（LLM 路径延迟=推理耗时）。
const VECTOR_FUZZY_MULT = 1.5
const TOKEN_MANA_RATIO = 50
const TOKEN_MANA_CAP = 80
const FUZZY_CAST_DELAY_MS = 2000

let suggestCorpus: { vecs: number[][]; atoms: Atom[] } | null = null
let corpusBuilding: Promise<void> | null = null

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const j = await res.json() as { embedding?: number[] }
    return Array.isArray(j.embedding) ? j.embedding : null
  } catch { return null }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d > 0 ? dot / d : 0
}

/** 预热语料库（apply 时后台跑一次；ollama 不在则静默弃用，不影响施法主路）。 */
function warmSuggestCorpus(atoms: Atom[]): void {
  if (corpusBuilding) return
  corpusBuilding = (async () => {
    const vecs: number[][] = []
    for (const a of atoms) {
      const v = await embedText(`法术：${a.name}。咒语词：${a.words.join('、')}。`)
      if (!v) return // 任一失败即弃（ollama 未起/超时），下次再试
      vecs.push(v)
    }
    suggestCorpus = { vecs, atoms }
  })().catch(() => {})
}

  interface SpellVectorMatch {
    atom: Atom
    similarity: number
  }

  /** 中置信向量命中：需要 LLM 推理解析（mc-god 侧处理），抛此信号。 */
  class NeedLlmError extends Error {
    atomId: string
    body: string
    similarity: number
    constructor(atomId: string, body: string, similarity: number) {
      super('need_llm')
      this.name = 'NeedLlmError'
      this.atomId = atomId
      this.body = body
      this.similarity = similarity
    }
  }

  /** 向量近邻（结构化）：返回候选法术 + 相似度；不达 0.50 返回 null。 */
  async function suggestSpellMatch(chant: string, atoms: Atom[]): Promise<SpellVectorMatch | null> {
    if (!suggestCorpus) {
      warmSuggestCorpus(atoms) // 首次触发即预热，本次走 miss
      return null
    }
    const qv = await embedText(chant)
    if (!qv) return null
    let best = { s: 0, idx: -1 }
    for (let i = 0; i < suggestCorpus.vecs.length; i++) {
      const s = cosine(qv, suggestCorpus.vecs[i])
      if (s > best.s) best = { s, idx: i }
    }
    if (best.idx < 0 || best.s < SUGGEST_THRESHOLD) return null
    return { atom: suggestCorpus.atoms[best.idx], similarity: best.s }
  }

// ── 位移/传送落点安全（2026-08-24 安全级修复：防 tp 进实体方块 suffocated）──
function teleportSpotSafe(bot: Bot, x: number, y: number, z: number): boolean {
  try {
    const feet = bot.world.getBlock(new Vec3(x, y, z))
    const head = bot.world.getBlock(new Vec3(x, y + 1, z))
    if (!feet || !head) return false               // 区块未加载/未知 → 不冒险
    const solid = (b: any) => (b.boundingBox ?? '') === 'block'
    if (solid(feet) || solid(head)) return false   // 嵌墙/窒息
    if (/lava/i.test(String(feet.name ?? '')) || /lava/i.test(String(head.name ?? ''))) return false  // 岩浆
    return true
  } catch { return false }
}
/** 从目标落点朝施法者位置逐格回退，找最近的安全落点（含玩家原地兜底）。 */
async function nearestSafeTeleport(bot: Bot, vars: Record<string, number | string>, tx: number, ty: number, tz: number) {
  const px = Number(vars.px ?? 0), py = Number(vars.py ?? 0), pz = Number(vars.pz ?? 0)
  const dist = Math.max(1, Math.round(Math.hypot(px - tx, pz - tz)))
  for (let i = 0; i <= dist; i++) {
    const k = dist ? i / dist : 0
    const nx = Math.round(tx + (px - tx) * k)
    const nz = Math.round(tz + (pz - tz) * k)
    if (teleportSpotSafe(bot, nx, ty, nz)) return { x: nx, y: ty, z: nz }
  }
  return null
}

// ── 命令渲染：{name} 或 {name±offset} 占位符 ───────────────────────────
/** RCON 命令回执错误识别（2026-08-29 台账真实性）：命中即视为该命令执行失败。 */
const RCON_CMD_ERR_RE = /\bInvalid\b|Unknown (?:or incorrect|command)|Incorrect argument|Incorrect.*command|Expected .*but|Failed to execute|no such entity|Could not find|was not found|is not a valid|No (?:entity|entities|targets|players) (?:was |were )?(?:found|matched)|Nothing changed|invulnerable|could not damage|Could not set the block/i
function renderCommand(cmd: string, vars: Record<string, number | string>): string {
  return cmd.replace(/\{([a-z]+)([+-]\d+)?\}/g, (_m, key: string, off?: string) => {
    const base = vars[key]
    if (typeof base === 'number') {
      return String(Math.round(base + (off ? parseInt(off, 10) : 0)))
    }
    return String(base ?? '')
  })
}

// ── 插件主体 ───────────────────────────────────────────────────────────
export interface MagicDeps {
  getBot: () => Bot
  rcon: RconService
}

/** 契约/魂链法术执行器（2026-08-23）：效果不走路 RCON commands，由 mc-god 注入实际落地逻辑
 *  （contract=写 goddess-orders 唤守卫、trace=传送到目标、recall=拉从者到身边）。 */
export type SpecialExecutor = (
  special: 'contract' | 'trace' | 'recall' | 'kage_bunshin' | 'fire_aura' | 'aura',
  username: string,
  params: Record<string, number | string>,
  vars: Record<string, number | string>,
  atomId?: string, // 光环系元素分派键（aura=按 atomId 查元素表）
) => Promise<{ ok: boolean; reply: string }>

export interface MagicHandle {
  service: MagicService
  dispose: () => void
  /** 迟绑定史官：bootstrap 创建完 mc-god 后注入其 record 回调（解开 mc-magic ↔ mc-god 循环依赖）。 */
  setChronicle: (fn: (type: string, actor: string, detail: Record<string, unknown>) => void) => void
  /** 迟绑定契约/魂链执行器：bootstrap 创建完 mc-god 后注入（同 setChronicle 解环思路）。 */
  setSpecialExecutor: (fn: SpecialExecutor) => void
}

/** 已脱 cordis 壳（2026-08-21）：bootstrap-world.mts 显式 createMagic(config, deps) 装配。 */
export function createMagic(config: Config, deps: MagicDeps): MagicHandle {
  const log = (msg: string) => console.log(`[mc-magic] ${msg}`)
  const lc = createLifecycle()
  // 向量兜底语料预热（后台一次性；ollama 未起则静默弃用）
  // 女神化身 = 世界进程的 mineflayer bot（旁观者），是世界之眼：
  // 听公屏、看所有玩家位置、替天神开口。重连会换实例，须每次现取。
  const getBot = deps.getBot
  const rcon = deps.rcon
  const travel = createWaypointTravel((command) => rcon.send(command))

  // ── 世界史官：把大事记写入女神的编年史（mc-god 提供，可选注入）────
  // 咏唱/升级/降临天赋都发生在 mc-magic，由这里上报；
  // 女神侧（mc-god）另记祈愿/神谕/供奉/陨落。运行时才调用（非装配期），
  // 可选链 + try/catch：mc-god 未就位时静默跳过，不阻碍施法。
  let chronicleFn: ((type: string, actor: string, detail: Record<string, unknown>) => void) | null = null
  const chronicle = (type: string, actor: string, detail: Record<string, unknown>): void => {
    try {
      chronicleFn?.(type, actor, detail)
    } catch { /* 史官不在场，不阻碍世界运转 */ }
  }

  // 契约/魂链执行器（迟绑定，mc-god 注入）：contract/trace/recall 法术的效果不走路 RCON，
  // 改由这里落地（写 goddess-orders.jsonl / tp 目标）。未注入时这类法术静默失败。
  let specialExecutor: SpecialExecutor | null = null

  // ── 施法台账（2026-08-17）：技能使用=服务器问题信号 ──────────────
  // 每次成功施法追加一行 JSONL（data/skill-usage.jsonl）。分析口径：
  //   - 高频 tp（尤其脱困语义）→ 寻路/地形/服务器稳定性问题的定位线索；
  //   - 各原子使用频率 → 平衡性调整（天平拨正）的数据依据；
  //   - 与 bot 侧 mc-brain.log 按 ts 邻近 join，可还原"为什么施法"的 goal 上下文。
  // 台账只增不改，分析走离线脚本（analyze-skill-usage.mts）。
  interface SkillUsageEntry {
    ts: string; player: string; atom: string; chant: string
    mana: number; food: number; hp: number
    manaLeft: number; maxMana: number; level: number
    // 2026-08-23（造物主谕·施法记录学习闭环）：匹配层级 / tokens / 前摇耗时 / 成败 / 结果。
    // matchMode: exact=严格瞬发 vector=向量模糊 llm=LLM 推理 miss=未识别（新咒语学习原料）
    //           precheck_deny=LLM 前预判拦截（tokens 成本预算不足，零 LLM 拒绝）
    matchMode?: 'exact' | 'vector' | 'llm' | 'miss' | 'precheck_deny' | 'dedupe_deny'
    tokens?: number
    latencyMs?: number
    success?: boolean
    result?: string
  }
  const usagePath = resolve(dirname(resolve(config.statePath)), 'skill-usage.jsonl')
  const appendSkillUsage = (e: SkillUsageEntry): void => {
    try {
      mkdirSync(dirname(usagePath), { recursive: true })
      appendFileSync(usagePath, JSON.stringify(e) + '\n', 'utf8')
    } catch { /* 台账失败不影响施法 */ }
    // 学习闭环：真实 tokens 消耗喂入预测器（precheck_deny 是预估，不喂）
    if (e.tokens && e.tokens > 0 && e.matchMode !== 'precheck_deny') feedTokens(e.atom, e.tokens)
  }

  // ── tokens 成本预测器（2026-08-23 造物主谕：tokens 判断施法成败，代码写、零 LLM）──
  // 按 atomId 统计历史实际消耗（llm/vector/神迹），EMA 平滑预测下次成本。
  // 用途：LLM 推理前预判——玩家魔力折不出预估 tokens，直接拦截拒绝，不浪费 LLM 调用；
  // 预判结果（matchMode:'precheck_deny'）也入台账，与实际消耗对照形成学习闭环。
  const TOKENS_HISTORY_MAX = 20
  const TOKENS_EMA_ALPHA = 0.3
  let tokensPredictor: Map<string, number> | null = null
  let tokensPredictorLoaded = false

  function loadTokensPredictor(): void {
    if (tokensPredictorLoaded) return
    tokensPredictorLoaded = true
    try {
      if (!existsSync(usagePath)) return
      const lines = readFileSync(usagePath, 'utf-8').split('\n').filter((l) => l.trim()).slice(-300)
      const byAtom = new Map<string, number[]>()
      for (const ln of lines) {
        try {
          const r = JSON.parse(ln)
          if (r?.atom && typeof r.tokens === 'number' && r.tokens > 0 && r.matchMode !== 'precheck_deny') {
            const arr = byAtom.get(r.atom) ?? []
            arr.push(r.tokens)
            byAtom.set(r.atom, arr.slice(-TOKENS_HISTORY_MAX))
          }
        } catch { /* 坏行跳过 */ }
      }
      const ema = new Map<string, number>()
      for (const [id, arr] of byAtom) {
        let e = arr[0]
        for (const t of arr.slice(1)) e = TOKENS_EMA_ALPHA * t + (1 - TOKENS_EMA_ALPHA) * e
        ema.set(id, Math.round(e))
      }
      tokensPredictor = ema
      log(`tokens predictor loaded: ${ema.size} atom(s) with history`)
    } catch { /* 预测器不可用不影响施法主路 */ }
  }

  function predictTokens(atomId: string): number | null {
    loadTokensPredictor()
    const e = tokensPredictor?.get(atomId)
    return e ?? null
  }

  function feedTokens(atomId: string, tokens: number): void {
    if (!atomId || !tokens || tokens <= 0) return
    loadTokensPredictor()
    if (!tokensPredictor) tokensPredictor = new Map()
    const cur = tokensPredictor.get(atomId)
    tokensPredictor.set(atomId, cur === undefined ? Math.round(tokens) : Math.round(TOKENS_EMA_ALPHA * tokens + (1 - TOKENS_EMA_ALPHA) * cur))
  }
  /** 未识别咏唱也入台账（matchMode:'miss'）——新咒语/新魔法的学习原料（2026-08-23）。 */
  const appendChantMiss = (player: string, chant: string, reason: string): void => {
    const p = store.get(player)
    appendSkillUsage({
      ts: new Date().toISOString(), player, atom: '', chant: chant.slice(0, 120),
      mana: 0, food: 0, hp: 0, manaLeft: Math.floor(p.mana), maxMana: p.maxMana, level: p.level,
      matchMode: 'miss', success: false, result: reason.slice(0, 120),
    })
  }

  // ── 世界清扫：滞留风爆弹 ──────────────────────────────────────────
  // windburst 咒语召唤的 wind_charge 爆炸后可能残留漂浮实体；它们炸到实体时
  // 服务端击退 mineflayer 客户端无法模拟（易造成位置失同步），且污染 bot 的
  // 环境感知。每 60s 清扫一次（新鲜咒弹接触即爆，不受影响，只清哑弹）。
  const sweepWindCharges = async (): Promise<void> => {
    if (catalog && catalog.entries.get('windburst')?.status !== 'featured') return
    try {
      await rcon.send('kill @e[type=minecraft:wind_charge]')
    } catch { /* RCON 短暂不可用时跳过，下一轮再扫 */ }
    lc.setTimeout(sweepWindCharges, 60_000)
  }

  // 原子指令表：外置 JSON 覆盖内嵌默认（服务器适配改数字/命令不用改代码）
  const atomsPath = resolve(config.atomsPath)
  const loadBaseAtoms = (): Atom[] => {
    if (existsSync(atomsPath)) {
      try {
        const raw = JSON.parse(readFileSync(atomsPath, 'utf-8'))
        const list = Array.isArray(raw) ? raw : raw?.atoms
        if (Array.isArray(list)) return list as Atom[]
      } catch { /* 基准表损坏 → 回落默认 */ }
    }
    return DEFAULT_ATOMS
  }
  let atoms: Atom[] = loadBaseAtoms()
  const catalogPath = config.catalogPath === null ? null : resolve(config.catalogPath ?? resolve(dirname(atomsPath), 'skill-catalog.json'))
  let catalog = loadSkillCatalog(catalogPath, atoms)
  const reloadCatalogueAndAtoms = (): void => {
    const nextAtoms = loadBaseAtoms()
    const nextCatalog = loadSkillCatalog(catalogPath, nextAtoms, catalog !== null)
    // Commit only after both files validate; a failed hot reload keeps the old gate.
    atoms = nextAtoms
    catalog = nextCatalog
  }
  const archivedResult = (atom: Atom): CastResult | null => {
    const entry = catalog?.entries.get(atom.id)
    if (atom.type === 'passive' || entry?.status !== 'archived') return null
    const hints = entry.nativeHints.length ? `可选原生法术：${entry.nativeHints.join('、')}；须先取得并装备对应法术书或卷轴，按原生法力与冷却施放。` : ''
    return castResult('skill_archived', `「${atom.name}」已归档，不能再施放。${entry.reason}${hints}`, atom, { nativeHints: [...entry.nativeHints] })
  }
  lc.setTimeout(() => warmSuggestCorpus(atoms), 3_000)
  // Retired windburst must not keep globally deleting legitimate native projectiles.
  if (!catalog || catalog.entries.get('windburst')?.status === 'featured') lc.setTimeout(sweepWindCharges, 60_000)
  log(`loaded ${atoms.length} atoms from ${atomsPath}`)

  // ── 天平引擎（覆盖层）：基准表只读，补丁热更 ─────────────────────
  // 启动时按序套用 balance-overrides.json；运行时经 applyBalancePatch 追加；
  // resetBalance 从基准表重载再重放余下补丁。所有方法零 LLM、同步生效。
  const store = new MagicStateStore(config.statePath, config.maxManaDefault, config.regenPerSec, config.stateMirrorPath)
  let balancePatches: BalancePatch[] = []
  // 施法去重表（2026-08-30）：key=`player|atomId` → 上次成功执行时间戳。
  // 守卫魂 LLM 每 tick 决策可能重复咏唱同一法术（照明循环事件），窗口内拒绝。
  const castDedupe = new Map<string, number>()
  // One in-flight cast per resource owner, across all spells and entry points.
  const castingPlayers = new Set<string>()
  const balancePath = resolve(config.balancePath)
  const applyPatchToAtoms = (p: BalancePatch): boolean => {
    if (p.field === 'regenPerSec') {
      store.setRegenPerSec(p.value)
      return true
    }
    const spec = BALANCE_FIELDS[p.field]
    if (!spec) return false
    const a = atoms.find((x) => x.id === p.atom)
    if (!a) return false
    spec.set(a, p.value)
    return true
  }
  try {
    if (existsSync(balancePath)) {
      const raw = JSON.parse(readFileSync(balancePath, 'utf-8'))
      if (Array.isArray(raw?.patches)) {
        balancePatches = raw.patches as BalancePatch[]
        let applied = 0
        for (const p of balancePatches) if (applyPatchToAtoms(p)) applied++
        if (balancePatches.length) log(`balance layer: ${applied}/${balancePatches.length} patch(es) applied from ${balancePath}`)
      }
    }
  } catch (err) {
    log(`failed to load balance overrides (ignored): ${err instanceof Error ? err.message : String(err)}`)
  }
  const saveBalanceFile = (): void => {
    writeFileSync(balancePath, JSON.stringify({ version: 1, patches: balancePatches }, null, 2), 'utf-8')
  }


  const service: MagicService = {
    listAtoms: () => atoms.map((a) => summarizeAtom(a, catalog)),
    getAtomById: (id) => {
      const a = atoms.find((x) => x.id === id)
      return a ? summarizeAtom(a, catalog) : null
    },
    getInnate: (u) => store.getInnate(u),
    setInnate: (u, id) => {
      store.setInnate(u, id)
      chronicle('innate', u, { skill: id })
    },
    addAdvancement: (u, id) => store.addAdvancement(u, id),
    getAdvancements: (u) => store.getAdvancements(u),
    learnViaAdvancement: (u, id) => store.learnViaAdvancement(u, id),
    /* 天平引擎：女神动态平衡 */
    listBalance: () => balancePatches.map((p) => ({ ...p })),
    applyBalancePatch: (atomKey, field, value, by, reason) => {
      if (field in BALANCE_GLOBALS) {
        // 全局字段（regenPerSec）：改回蓝速率，立即生效
        const g = BALANCE_GLOBALS[field]
        const v = Math.round(value * 10) / 10
        if (v < g.min || v > g.max) return { ok: false, error: `${g.label}须在 ${g.min}~${g.max} 之间` }
        const before = store.getRegenPerSec()
        store.setRegenPerSec(v)
        balancePatches = balancePatches.filter((p) => !(p.atom === '*' && p.field === field))
        balancePatches.push({ atom: '*', field, value: v, by, reason, at: Date.now() })
        saveBalanceFile()
        return { ok: true, summary: `回蓝速率 ${before} → ${v} 点/秒` }
      }
      const spec = BALANCE_FIELDS[field]
      if (!spec) {
        return { ok: false, error: `不可调字段「${field}」——可调：${Object.values(BALANCE_FIELDS).map((s) => s.label).join('、')}、回蓝` }
      }
      const key = (atomKey ?? '').trim()
      const a = atoms.find((x) => x.id === key) ?? atoms.find((x) => x.name === key)
      if (!a) return { ok: false, error: `未知法术「${atomKey}」` }
      if (!Number.isInteger(value)) return { ok: false, error: `${spec.label}须为整数` }
      if (value < spec.min || value > spec.max) return { ok: false, error: `「${a.name}」${spec.label}须在 ${spec.min}~${spec.max} 之间` }
      const before = spec.get(a)
      spec.set(a, value)
      balancePatches = balancePatches.filter((p) => !(p.atom === a.id && p.field === field))
      balancePatches.push({ atom: a.id, field, value, by, reason, at: Date.now() })
      saveBalanceFile()
      return { ok: true, summary: `「${a.name}」${spec.label} ${before} → ${value}` }
    },
    resetBalance: (atomKey) => {
      const before = balancePatches.length
      if (atomKey === undefined || atomKey === null || atomKey === '*') {
        balancePatches = []
      } else {
        const key = atomKey.trim()
        const a = atoms.find((x) => x.id === key) ?? atoms.find((x) => x.name === key)
        if (!a) return 0
        balancePatches = balancePatches.filter((p) => p.atom !== a.id)
      }
      const removed = before - balancePatches.length
      if (removed > 0) {
        // 基准表重载 + 回蓝回默认 + 余下补丁重放
        reloadCatalogueAndAtoms()
        store.setRegenPerSec(config.regenPerSec)
        for (const p of balancePatches) applyPatchToAtoms(p)
        saveBalanceFile()
      }
      return removed
    },
    reloadAtoms: () => {
      // 创世之笔：基准表热重载 + 回蓝复位 + 补丁重放（与 resetBalance 同构）
      reloadCatalogueAndAtoms()
      store.setRegenPerSec(config.regenPerSec)
      for (const p of balancePatches) applyPatchToAtoms(p)
      log(`reloaded ${atoms.length} atoms (saga)`)
      return atoms.length
    },
    getBackstory: (u) => store.getBackstory(u),
    setBackstory: (u, t) => store.setBackstory(u, t),
    getState: (u) => {
      const p = store.get(u)
      return {
        mana: p.mana,
        maxMana: p.maxMana,
        maxManaBonus: p.maxManaBonus,
        learned: [...p.learned],
      advancementSkills: [...p.advancementSkills],
        innateSkill: p.innateSkill,
        backstory: p.backstory,
        level: p.level,
        passives: [...p.passives],
        hpRatio: p.hpRatio,
        foodRatio: p.foodRatio,
        manaPerSec: store.regenRateForPlayer(u),
        skillbar: store.skillbar(u, atoms, catalog),
      }
    },
    // ── 技能栏（2026-08-30 造物主设计「圆盘可编辑+数字键快捷施法」）──
    getSkillbar: (u) => store.skillbar(u, atoms, catalog),
    setSkillbar: (u, ids) => {
      // 校验：≤8 槽、去重、非空 id 必须已学或天赋；''=空槽占位原样保留。
      // 空数组 = 重置（清掉自定义，下次 getSkillbar 走默认填充）。
      const p = store.get(u)
      const seen = new Set<string>()
      const clean: string[] = []
      for (const id of ids.slice(0, SKILLBAR_SLOTS)) {
        if (id === '') { clean.push(''); continue }
        if (seen.has(id) || (!p.learned.includes(id) && p.innateSkill !== id) ||
            !atoms.some((a) => a.id === id && a.type !== 'passive') ||
            catalog?.entries.get(id)?.status === 'archived') { clean.push(''); continue }
        seen.add(id); clean.push(id)
      }
      p.skillbar = clean.length ? clean : undefined
      store.persist()
      return [...clean]
    },
    maxManaFor: (level) => store.maxManaFor(level),
    addMaxManaBonus: (u, amount) => store.addMaxManaBonus(u, amount),
    setLevel: (u, xpLevel) => store.setLevel(u, xpLevel),
    setVitals: (u, hpRatio, foodRatio) => store.setVitals(u, hpRatio, foodRatio),
    addPassiveProgress: (u, id, dtSec) => store.addPassiveProgress(u, id, dtSec),
    getPassiveProgress: (u, id) => store.getPassiveProgress(u, id),
    unlockPassive: (u, id) => store.unlockPassive(u, id),
    hasPassive: (u, id) => store.hasPassive(u, id),
    castByGod: (username, atomId, opts) => castByGod(username, atomId, opts),
    castAsOwner: (owner, atomId) => castAsOwner(owner, atomId),
    castSpell: async (username, chant) => (await cast(username, chant)).summary,
    castExact: async (username, key, params = {}) => {
      if (typeof key !== 'string' || !key.trim()) return castResult('unknown_skill', '请提供技能 ID、完整名称或唯一咒语词。')
      const resolved = resolveExactAtom(key, atoms)
      if ('code' in resolved) return castResult(resolved.code, resolved.summary)
      const archived = archivedResult(resolved.atom)
      if (archived) return archived
      const parsed = exactParams(resolved.atom, params)
      if ('error' in parsed) return castResult('invalid_params', parsed.error, resolved.atom)
      return cast(username, key, { forceAtom: resolved.atom, params: parsed.params })
    },
    // 2026-08-23：模糊施法（LLM 已裁决的法术，tokens 折算魔力 + 自然前摇）——mc-god catch NeedLlmError 后调用。
    castFuzzy: (username, chant, atomId, opts) => {
      const atom = atoms.find((a) => a.id === atomId)
      return atom
        ? cast(username, chant, { forceAtom: atom, tokens: opts.tokens, latencyMs: opts.latencyMs, mode: opts.mode ?? 'llm' }).then((r) => r.summary)
        : Promise.resolve('此术未在法则之列。')
    },
    // 2026-08-23：施法意图 = 咒语框架命中（前缀+内容）或 法术词子串（兼容旧习惯/旧客户端）。
    // 收紧为"纯框架"在第二步分流改造时统一做（守卫桥 chant/A 仓工具需先适配）。
    sniffChant: (msg) => matchChantFrame(msg) !== null || matchSpell(msg, atoms) !== null,
    // 前缀分级分发：all=true（AI 玩家）全量；否则公共池（真人玩家随机被告知 2-3 个）
    chantPrefixes: (all: boolean) => (all ? [...CHANT_PREFIXES] : [...CHANT_PREFIXES_PUBLIC]),
  }

  /** RCON 查询实体数值字段，返回数字或 null。 */
  async function getEntityNumber(target: string, path: string): Promise<number | null> {
    return rcon.getEntityNumber(target, path)
  }

  // ── 视觉渲染（纯 vanilla：粒子 / 音效 / 大字，零 mod）──────────────
  async function castVfx(atom: Atom, vars: Record<string, number | string>, target: string): Promise<void> {
    const atActor = (command: string) => catalog ? `execute at ${target} run ${command}` : command
    // 粒子：每条是 /particle 参数模板（type x y z dx dy dz speed count）
    for (const p of atom.particles ?? []) {
      const out = await rcon.send(atActor(`particle ${renderCommand(p, vars)}`))
      if (out) log(`vfx particle[${p}] -> ${out.trim()}`)
    }
    // 音效：相对施法者位置播放（master 频道，全图可闻）
    for (const s of atom.sounds ?? []) {
      const out = await rcon.send(atActor(`playsound ${s} master ${target} ${vars.px} ${vars.py} ${vars.pz} 1 1`))
      if (out) log(`vfx sound[${s}] -> ${out.trim()}`)
    }
    // 咏唱词显示（2026-08-30 造物主反馈「字太大挡视线」）：
    // 弃用全屏大字 title/subtitle，改 actionbar 小字（物品栏上方一行）——不挡视线。
    if (atom.title || atom.subtitle) {
      const t = atom.title ? renderCommand(atom.title, vars) : ''
      const st = atom.subtitle ? renderCommand(atom.subtitle, vars) : ''
      const line = t && st ? `✦ ${t} · ${st}` : (t || st)
      await rcon.send(`title ${target} actionbar ${JSON.stringify({ text: `✦ ${line.replace(/^✦ /, '')}`, color: 'gold', bold: true })}`)
    }
  }

  // ── 鉴定（2026-08-17）：零命令原子，动态报告自身能力值与秘法掌握情况 ──────
  /** 被动 id → 名（skill-events.json 与天神侧共用一份配置；读不到退回 id）。 */
  function loadPassiveNames(): (ids: string[]) => string[] {
    let map: Record<string, string> | null = null
    try {
      const p = resolve('./data/skill-events.json')
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf-8')) as { passives?: { id: string; name?: string }[] }
        map = {}
        for (const d of raw.passives ?? []) map[d.id] = d.name ?? d.id
      }
    } catch { /* 名字缺失不致命 */ }
    return (ids) => ids.map((id) => map?.[id] ?? id)
  }

  async function doAppraise(username: string, manaCost: number): Promise<string> {
    const st = store.get(username) // 惰性结算回蓝
    store.spendMana(username, manaCost)

    const [xpP, health, food, armorOut] = await Promise.all([
      rcon.getEntityNumber(username, 'XpP').catch(() => null),
      rcon.getEntityNumber(username, 'Health').catch(() => null),
      rcon.getEntityNumber(username, 'foodLevel').catch(() => null),
      rcon.send(`attribute ${username} minecraft:armor get`).catch(() => ''),
    ])
    const armorM = armorOut.match(/-?\d+(\.\d+)?/)
    const armor = armorM ? parseFloat(armorM[0]) : null

    const summaries = atoms.filter((a) => a.type !== 'passive' && (!catalog || catalog.entries.get(a.id)?.status === 'featured'))
      .map((a) => summarizeAtom(a, catalog))
    const innateName = st.innateSkill
      ? atoms.find((a) => a.id === st.innateSkill)?.name ?? st.innateSkill
      : null
    const passiveNames = loadPassiveNames()(st.passives)

    const { panel, summary } = buildAppraisalReport(
      {
        player: username,
        level: st.level,
        xpProgress: xpP,
        mana: st.mana,
        maxMana: st.maxMana,
        maxManaBonus: st.maxManaBonus,
        innateName,
        passiveNames,
        health,
        food,
        armor,
      },
      summaries,
      st.innateSkill,
    )

    // 私发面板（含换行，仅施法者可见）+ 附魔台音效；公屏只留一句摘要（由调用方转述）
    try {
      await rcon.send(`tellraw ${username} ${JSON.stringify({ text: panel, color: 'aqua' })}`)
      await rcon.send(`playsound minecraft:block.enchantment_table.use master ${username}`)
    } catch { /* 面板失败不影响摘要 */ }
    chronicle('appraise', username, { level: st.level, mana: st.mana, maxMana: st.maxMana, innate: st.innateSkill })
    log(`appraise ${username}: Lv.${st.level}, mana ${Math.floor(st.mana)}/${st.maxMana}, mastered/in total`)
    return summary
  }

  // ── 核心施法 ─────────────────────────────────────────────────────────
  type CastOptions = { forceAtom?: Atom; params?: Record<string, string | number>; tokens?: number; latencyMs?: number; mode?: 'vector' | 'llm' }

  async function cast(username: string, chant: string, opts?: CastOptions): Promise<CastResult> {
    if (castingPlayers.has(username)) return castResult('busy', '上一道法术仍在结算，请等待回执后再施法。', opts?.forceAtom)
    castingPlayers.add(username)
    try {
      return await performCast(username, chant, opts)
    } catch (err) {
      if (err instanceof NeedLlmError) throw err // natural-language caller owns this legacy fallback
      return castResult('execution_error', `施法连接中断，未自动重试：${err instanceof Error ? err.message : String(err)}`, opts?.forceAtom)
    } finally {
      castingPlayers.delete(username)
    }
  }

  async function performCast(username: string, chant: string, opts?: CastOptions): Promise<CastResult> {
    // 2026-08-23：剥施法框架前缀（兼容无前缀直呼——旧习惯/内部调用），匹配用咒语内容。
    const body = matchChantFrame(chant) ?? chant
    // forceAtom = 模糊施法（向量/LLM 已确认法术），直接按指定原子走执行体。
    const match = opts?.forceAtom
      ? { atom: opts.forceAtom, params: opts.params ?? extractParams(body, opts.forceAtom) }
      : matchSpell(body, atoms)
    if (!match) {
      // 向量降级（2026-08-23 造物主谕：严格失败 → 向量 → LLM → 模糊施法，无需二次确认）
      const vm = await suggestSpellMatch(body, atoms).catch(() => null)
      if (vm && vm.similarity >= SUGGEST_THRESHOLD) {
        const archived = archivedResult(vm.atom)
        if (archived) return archived
      }
      if (vm && vm.similarity >= VECTOR_DIRECT_THRESHOLD) {
        // 高置信：向量模糊施法（×1.5 + 2s 粒子凝聚前摇）
        return performCast(username, chant, { forceAtom: vm.atom, mode: 'vector', latencyMs: FUZZY_CAST_DELAY_MS })
      }
      if (vm && vm.similarity >= SUGGEST_THRESHOLD) {
        // 中置信：LLM 推理前先代码预判（2026-08-23 造物主谕：tokens 判断成败，代码写、零 LLM）。
        // 预估成本 = 历史 EMA（无历史字符估算兜底），总耗 = 基础魔力 + ⌈est/50⌉（上限 80）；
        // 玩家魔力折不出 → 直接拦截拒绝（不浪费 LLM 调用），precheck_deny 入台账供学习闭环对照。
        const pstate = store.get(username)
        const est = predictTokens(vm.atom.id) ?? Math.ceil((body.length + 80) / 1.5)
        const tokenMana = Math.min(TOKEN_MANA_CAP, Math.ceil(est / TOKEN_MANA_RATIO))
        const manaNeeded = (vm.atom.cost?.mana ?? 0) + tokenMana
        if (pstate.mana < manaNeeded) {
          appendSkillUsage({
            ts: new Date().toISOString(), player: username, atom: vm.atom.id, chant: body.slice(0, 120),
            mana: 0, food: 0, hp: 0, manaLeft: Math.floor(pstate.mana), maxMana: pstate.maxMana, level: pstate.level,
            matchMode: 'precheck_deny', tokens: est, latencyMs: 0, success: false, result: `precheck mana ${manaNeeded}`,
          })
          return castResult('mana', `你的低语指向「${vm.atom.name}」，但要唤醒它需约 ${manaNeeded} 点魔力（含 ${tokenMana} 点语义凝聚费），汝今 ${Math.floor(pstate.mana)} 点。静候回蓝，或改念准确咒语。`, vm.atom, { manaLeft: pstate.mana })
        }
        // 中置信且预算够：需 LLM 推理解析（mc-god 侧 catch 后裁决，通过再代施）
        throw new NeedLlmError(vm.atom.id, body, vm.similarity)
      }
      appendChantMiss(username, chant, '未识别')
      return castResult('unknown_skill', `「${chant}」并未构成任何已知魔法。也许是咒语不对，或者你尚未悟得此法。`)
    }
    const { atom, params } = match
    const finish = (code: CastResult['code'], summary: string, extra: Pick<CastResult, 'manaLeft' | 'cooldownMs'> = {}) => castResult(code, summary, atom, extra)
    // Passives have no cast operation, including direct IDs and semantic fallback.
    // Check before querying the world or testing an active spell's level gate.
    if (atom.type === 'passive') {
      const state = store.get(username)
      const unlocked = state.learned.includes(atom.id) || state.innateSkill === atom.id ||
        (!!atom.passiveId && state.passives.includes(atom.passiveId))
      return finish('passive', unlocked
        ? `「${atom.name}」是已解锁的被动能力，无需施放。`
        : `「${atom.name}」是被动能力，请通过技能书参悟，无需施放。`)
    }
    const archived = archivedResult(atom)
    if (archived) return archived
    const baseCost = computeCost(atom, params)
    // 模糊施法代价（2026-08-23）：vector = base×1.5；llm = base + ⌈tokens/50⌉（上限 80）
    const fuzzyTokenMana = opts?.mode === 'llm' && opts.tokens
      ? Math.min(TOKEN_MANA_CAP, Math.ceil(opts.tokens / TOKEN_MANA_RATIO))
      : 0
    const cost = opts?.mode === 'llm'
      ? { ...baseCost, mana: baseCost.mana + fuzzyTokenMana }
      : opts?.mode === 'vector'
        ? { ...baseCost, mana: Math.round(baseCost.mana * VECTOR_FUZZY_MULT) }
        : baseCost

    // 结算回蓝 + 等级校验（出生天赋 = 与生俱来的能力，豁免等级门槛）
    // 路线 A：等级真源 = MC 原生 XpLevel，cast 时直读（tick 缓存最多滞后 20s，门槛判定必须准确）
    const pstate = store.get(username)
    let liveLevel = pstate.level
    try {
      const xp = await rcon.getEntityNumber(username, 'XpLevel')
      if (xp !== null) {
        store.setLevel(username, xp)
        liveLevel = xp
      }
    } catch { /* RCON 失败退回缓存 */ }
    const requiredLevel = atom.requiredLevel ?? 1
    if (requiredLevel > liveLevel && pstate.innateSkill !== atom.id) {
      return finish('level', `「${atom.name}」是 ${requiredLevel} 级的秘法，你的魔力层级才 ${liveLevel} 级，强行咏唱只会反噬。挖矿、历练、施法、供奉皆可积攒修为（头顶绿条就是你的修为层级）。`)
    }

    // item 参数没解析出来：不 fallback 面包，而是让女神指出不识此物
    if (atom.params?.item && !params.item) {
      return finish('invalid_params', `你想以「${atom.name}」造物，但天神不识此物。已知的可造之物：${Object.keys(GIVE_WHITELIST).join('、')}。换一种说法试试（如「造物赐我熔炉」）。`)
    }

    if (cost.mana > pstate.mana + 0.001) {
      return finish('mana', `你咏唱「${atom.name}」，但魔力不足：需要 ${cost.mana} 点，你只有 ${Math.floor(pstate.mana)} 点。静候片刻待魔力恢复。`, { manaLeft: pstate.mana })
    }

    // All callers use the same per-skill cooldown. The in-flight owner lock
    // separately prevents overlapping spells from spending the same mana twice.
    const castDedupeMs = (() => {
      if (atom.id === 'heal') return 8000
      if (atom.category === 'attack') return 3000
      if (atom.id === 'give') return 15000
      return 6000
    })()
    const dedupeKey = `${username}|${atom.id}`
    const lastCastAt = castDedupe.get(dedupeKey)
    const elapsed = lastCastAt === undefined ? Infinity : Math.max(0, Date.now() - lastCastAt)
    if (elapsed < castDedupeMs) {
      const waitSec = Math.ceil((castDedupeMs - elapsed) / 1000)
      appendSkillUsage({
        ts: new Date().toISOString(), player: username, atom: atom.id, chant: body.slice(0, 120),
        mana: 0, food: 0, hp: 0, manaLeft: Math.floor(pstate.mana), maxMana: pstate.maxMana, level: pstate.level,
        matchMode: 'dedupe_deny', tokens: 0, latencyMs: 0, success: false, result: `cooldown ${waitSec}s`,
      })
      return finish('cooldown', `「${atom.name}」方才已施过，余韵未散——约 ${waitSec} 秒后再念。`, { cooldownMs: castDedupeMs - elapsed, manaLeft: pstate.mana })
    }

    // 逆转化（cost.mana < 0，燃血/炼食换魔）：魔力盈满时拒绝——白白的牺牲。
    if (cost.mana < 0 && pstate.mana >= pstate.maxMana - 0.001) {
      return finish('already_full', `你的魔力已盈满（${Math.floor(pstate.mana)}/${pstate.maxMana}），不必以身相搏，静待时机再燃。`, { manaLeft: pstate.mana })
    }

    // 鉴定：零命令原子，不需要立足点/实体位置，早于通用结算返回
    if (atom.id === 'appraise') {
      const summary = await doAppraise(username, cost.mana)
      castDedupe.set(dedupeKey, Date.now())
      return finish('ok', summary, { manaLeft: store.get(username).mana })
    }

    const bot = getBot()
    if (!bot?.entity) return finish('offline', '天神尚未注视此界（女神化身离线），无法施法。')

    const nativeTravel = catalog !== null && (atom.id === 'home' || atom.id === 'tp')
    let springReceipt: SpringReceipt | undefined
    const origin = catalog ? await travel.location(username) : null
    if (origin && !origin.ok) return finish(origin.code === 'outcome_unknown' ? 'outcome_unknown' : 'unavailable', origin.summary)

    // 施法主体位置：任何玩家（AI bot 或真人）念咒，取其在世界中的立足点。
    // 女神化身是旁观者，近处直接看实体；远处实体跟踪丢失时用 RCON 兜底。
    const entityPos = bot.players[username]?.entity?.position
    const pos = origin ? { x: origin.x!, y: origin.y!, z: origin.z! } :
      entityPos ? { x: entityPos.x, y: entityPos.y, z: entityPos.z } : await rcon.getPos(username)
    if (!pos) return finish('offline', '你尚未在此界立足（未出生/离线），无法施法。')
    const px = Math.round(pos.x)
    const py = Math.round(pos.y)
    const pz = Math.round(pos.z)

    const distance = typeof params.distance === 'number' ? (params.distance as number) : 0
    const dirVec = DIR_VECTORS[String(params.direction ?? '东')] ?? [1, 0]
    const tx = px + dirVec[0] * distance
    const ty = py
    const tz = pz + dirVec[1] * distance

    const item = String(params.item ?? 'bread')
    // 2026-08-30 造物扩展：数量按物品分类默认（GIVE_DEFAULT_COUNT，护栏 1-16），
    // 未配置回退 1（模糊路径无 opts.count——显式数量走女神代施路径）。
    const count = Math.max(1, Math.min(16, typeof params.count === 'number' ? params.count : GIVE_DEFAULT_COUNT[item] ?? 1))

    // 模糊施法前摇（2026-08-23 造物主谕：模糊 = 更久）：粒子先行（凝聚中），延迟后落地。
    // 向量路径延迟 2s；LLM 路径延迟 = 推理耗时（mc-god 侧 catch NeedLlmError 时已消耗，传 latencyMs 记录）。
    if (opts?.latencyMs && opts.latencyMs > 0) {
      await rcon.send(`${catalog ? `execute at ${username} run ` : ''}particle minecraft:end_rod ${px} ${py + 1} ${pz} 0.5 0.5 0.5 0.02 40`).catch(() => {})
      await new Promise((res) => setTimeout(res, opts.latencyMs ?? 0))
    }

    // 归乡：家的真相 = 千灯堂（千灯村中心，2026-08-30 造物主定谳）。
    // 旧「有床送床」语义废弃——村外/野外睡床会劫持归乡落点（鸣人案例），家固定为千灯村。
    let bx = 0
    let by = 0
    let bz = 0
    let homeToTown = false
    if (atom.id === 'home') {
      bx = TOWN_SPAWN.x
      by = TOWN_SPAWN.y
      bz = TOWN_SPAWN.z
      homeToTown = true
    }

    // 弹道方向（2026-08-23 火球术 / 2026-08-29 慢弹档 / 2026-08-30 螺旋丸根治）：
    // {vx}/{vy}/{vz} = 1.6 快档（火球），{wx}/{wy}/{wz} = 慢弹档（风弹类螺旋丸）。
    // 2026-08-30 根治「方向不可控」：数据源从 bot.players 缓存改为 RCON 实时读
    // 服务端 Rotation（真实准心 yaw/pitch，MC 约定无歧义）；缓存缺失不再回退
    // 写死的 (1,0,1)——旧版弹永远朝同方向飞就是它。RCON 失败才退回 bot 缓存。
    // 慢弹档提至 ×0.45（≈75格/s，0.15 档被重力拽成下坠弧线，弹道不贴准心）。
    let vx = '0.00', vy = '0.00', vz = '0.00'
    let wx = '0.45', wy = '0.00', wz = '0.45'
    if (atom.commands.some((c) => c.includes('{vx}') || c.includes('{wx}'))) {
      let dx = 1, dy = 0, dz = 0
      let got = false
      const ry = await getEntityNumber(username, 'Rotation[0]')
      const rp = await getEntityNumber(username, 'Rotation[1]')
      if (typeof ry === 'number' && Number.isFinite(ry) && typeof rp === 'number' && Number.isFinite(rp)) {
        const yaw = (ry * Math.PI) / 180
        const pitch = (rp * Math.PI) / 180
        dx = -Math.sin(yaw) * Math.cos(pitch)
        dy = -Math.sin(pitch)
        dz = Math.cos(yaw) * Math.cos(pitch)
        got = true
      } else {
        const ent = bot.players[username]?.entity
        if (ent && typeof ent.yaw === 'number') {
          const yaw = (ent.yaw * Math.PI) / 180
          const pitch = ((ent.pitch ?? 0) * Math.PI) / 180
          dx = -Math.sin(yaw) * Math.cos(pitch)
          dy = -Math.sin(pitch)
          dz = Math.cos(yaw) * Math.cos(pitch)
          got = true
        }
      }
      if (got) {
        vx = (dx * 1.6).toFixed(2)
        vy = (dy * 1.6).toFixed(2)
        vz = (dz * 1.6).toFixed(2)
        wx = (dx * 0.45).toFixed(3)
        wy = (dy * 0.45).toFixed(3)
        wz = (dz * 0.45).toFixed(3)
        log(`sight vector ${username}: wx=${wx} wy=${wy} wz=${wz}`)
      }
    }

    const vars: Record<string, number | string> = {
      target: username, bx, by, bz, px, py, pz, tx, ty, tz, item, count, distance, direction: String(params.direction ?? '东'), vx, vy, vz, wx, wy, wz,
      // pyh = 头部高度（弹体生成位，字符串保留小数防 renderCommand Math.round 抹平）
      pyh: `${py + 1.4}`,
    }

    // 通灵契约（2026-08-18）：命令含 {puuid} 或带 ownLimit 时，取施法者 UUID（I;a,b,c,d 格式）
    if (atom.commands.some((c) => c.includes('{puuid}')) || atom.ownLimit) {
      const raw = await rcon.send(`data get entity ${username} UUID`)
      const m = /\[I;\s*([-\d,\s]+)\]/.exec(raw || '')
      if (!m) return finish('unavailable', `无法感知你的灵魂印记（UUID），「${atom.name}」未成。`)
      vars.puuid = `I;${m[1].replace(/\s+/g, '')}`
    }
    // ownLimit 防刷：名下已有同种契约兽在场则拒绝（RCON NBT Owner 选择器，实测 Count 精确）
    if (atom.ownLimit) {
      const range = atom.ownLimit.range ?? 96
      const sel = `@e[type=${atom.ownLimit.entity},distance=..${range},nbt={Owner:[${vars.puuid}]}]`
      const out = await rcon.send(`execute if entity ${sel}`)
      if (/passed/i.test(out || '')) {
        log(`ownLimit hit: ${username} already has ${atom.ownLimit.entity} within ${range}`)
        return finish('unavailable', atom.ownLimit.denyReply ?? `你的契约之兽仍守在身边（${range}格内已有一只）——通灵之门一次只为一人开。`)
      }
    }

    try {
      // 校验 + 扣 hp（血祭，damage magic 无视护甲；留 1 滴血防误杀）
      if (cost.hp > 0) {
        const hp = await getEntityNumber(username, 'Health')
        if (hp === null || !Number.isFinite(hp)) return finish('health', '无法感知你的生命，未扣除资源，施法取消。')
        if (hp <= cost.hp + 1) {
          return finish('health', `「${atom.name}」需要燃烧 ${cost.hp} 点生命，但你只剩 ${Math.round(hp)} 点，强行施展会殒命。`)
        }
      }
      const cmdErrors: string[] = []
      const commandFailure = () => {
        const state = store.get(username)
        appendSkillUsage({ ts: new Date().toISOString(), player: username, atom: atom.id, chant,
          mana: catalog ? 0 : cost.mana, food: cost.food, hp: cost.hp, manaLeft: Math.floor(state.mana),
          maxMana: state.maxMana, level: state.level, matchMode: opts?.mode ?? 'exact',
          success: false, result: `cmd-fail: ${cmdErrors[0]}` })
        return finish('command_failed', `「${atom.name}」的执行指令被服务器拒绝，未记为成功或新学会；部分资源或效果可能已结算，请勿立即重试。`, { manaLeft: state.mana })
      }
      // 校验 + 扣 food（data modify foodLevel）
      if (cost.food > 0) {
        const food = await getEntityNumber(username, 'foodLevel')
        if (food === null || !Number.isFinite(food)) return finish('food', '无法感知你的饱食度，施法失败。')
        if (food < cost.food) {
          return finish('food', `「${atom.name}」需要消耗 ${cost.food} 点饱食度，但你太饿了（只剩 ${food} 点），先吃点东西吧。`)
        }
      }

      // 契约/魂链法术（2026-08-23）：效果不走路 RCON commands，先落地（写 goddess-orders / tp 目标），
      // 成功才扣资源。失败直接回执，不白烧魔力/血祭。
      let specialReply: string | null = null
      if (atom.special) {
        if (!specialExecutor) return finish('unavailable', '契约信道未开（执行器未就位），法术未成。')
        castDedupe.set(dedupeKey, Date.now())
        const res = await specialExecutor(atom.special, username, params, vars, atom.id)
        if (!res.ok) {
          castDedupe.delete(dedupeKey)
          return finish('unavailable', res.reply)
        }
        specialReply = res.reply
      }

      if (nativeTravel) {
        castDedupe.set(dedupeKey, Date.now())
        const moved = await travel.teleport(username, {
          id: 0, name: atom.name, createdAt: 0,
          dim: atom.id === 'home' ? 'minecraft:overworld' : origin!.dimension!,
          x: atom.id === 'home' ? bx : tx, y: atom.id === 'home' ? by : ty, z: atom.id === 'home' ? bz : tz,
        })
        if (!moved.ok) {
          // A missing receipt may hide an already-applied teleport. Do not
          // charge or learn; retain the attempt window and never replay it.
          if (moved.code !== 'outcome_unknown') castDedupe.delete(dedupeKey)
          return finish(moved.code === 'outcome_unknown' ? 'outcome_unknown' : moved.code === 'cooldown' ? 'cooldown' : 'unavailable', moved.summary)
        }
        specialReply = moved.summary
        // Effects and sound follow the confirmed safe destination, including its dimension.
        Object.assign(vars, { px: moved.x!, py: moved.y!, pz: moved.z!, tx: moved.x!, ty: moved.y!, tz: moved.z!, bx: moved.x!, by: moved.y!, bz: moved.z! })
      }

      // 扣 mana（程序化状态库）
      const manaBeforeDebit = store.get(username).mana
      castDedupe.set(dedupeKey, Date.now())
      // Conversion credits are granted only after the sacrifice commands were
      // accepted. An invulnerable caster must not gain free mana on rejection.
      if (cost.mana >= 0 && !catalog) store.spendMana(username, cost.mana)

      // 扣 hp
      if (cost.hp > 0) {
        const out = await rcon.send(`damage ${username} ${cost.hp} minecraft:magic`)
        if (RCON_CMD_ERR_RE.test(out || '')) cmdErrors.push(`health cost rejected: ${(out || '').slice(0, 80)}`)
      }
      // 扣 food
      if (cost.food > 0) {
        const food = await getEntityNumber(username, 'foodLevel')
        if (food !== null && Number.isFinite(food)) {
          const out = await rcon.send(`data modify entity ${username} foodLevel set value ${Math.max(0, food - cost.food)}`)
          if (/unable to modify player data/i.test(out)) {
            // 1.21+ 禁止 /data modify 玩家 NBT → hunger 效果兜底：amp 39 ≈ 1 food/s（先耗饱和度再掉饱食）
            const secs = Math.min(10, Math.ceil(cost.food))
            const fallback = await rcon.send(`effect give ${username} minecraft:hunger ${secs} 39 true`)
            if (RCON_CMD_ERR_RE.test(fallback || '')) cmdErrors.push(`food cost rejected: ${(fallback || '').slice(0, 80)}`)
            log(`food deduction fallback (player NBT locked): hunger ${secs}s ≈ ${cost.food} food for ${username}`)
          } else if (RCON_CMD_ERR_RE.test(out || '')) cmdErrors.push(`food cost rejected: ${(out || '').slice(0, 80)}`)
        } else cmdErrors.push('food cost unavailable after precheck')
      }
      if (cmdErrors.length) return commandFailure()
      if (cost.mana < 0) store.spendMana(username, cost.mana)
      // 法术效果命令（契约/魂链法术的效果已由 specialExecutor 落地，跳过 commands）
      if (catalog && atom.id === 'spring') {
        springReceipt = await castSpring(command => rcon.send(command), {
          actor: username, actorUuid: String(origin?.actorUuid ?? ''), dimension: String(origin?.dimension ?? ''),
          x: Math.round(tx), y: Math.round(ty - 1), z: Math.round(tz),
        })
        if (!springReceipt.ok) {
          const unknown = ['unknown', 'effect_observed'].includes(springReceipt.state)
          return { ...finish(unknown ? 'outcome_unknown' : springReceipt.state === 'no_change' ? 'no_change' : 'command_failed',
            unknown ? '化水效果仍缺完整回执；已保留原请求，请查询原编号，不重发、不扣魔力或收录学习。' :
              springReceipt.state === 'no_change' ? '目标已有水源，本次没有施法，不扣魔力或收录学习。' :
                '化水未执行或被原生命令明确拒绝；不扣魔力或收录学习。'), effectReceipt: springReceipt }
        }
      } else if (!atom.special && !nativeTravel) {
        for (const rawCmd of atom.commands.map((c) => renderCommand(c, vars))) {
          let cmd = rawCmd
          // 位移/传送落点安全预检（2026-08-24 安全级修复：防 tp 进实体方块 suffocated）
          if (/^tp\s/.test(rawCmd)) {
            const seg = rawCmd.trim().split(/\s+/)
            if (seg.length >= 5) {
              const safe = await nearestSafeTeleport(bot, vars, Number(seg[2]), Number(seg[3]), Number(seg[4]))
              cmd = safe ? `tp ${seg[1]} ${safe.x} ${safe.y} ${safe.z}` : `tp ${seg[1]} ${vars.px} ${vars.py} ${vars.pz}`
            }
          }
          if (catalog) cmd = `execute at ${username} run ${cmd}`
          const out = await rcon.send(cmd)
          if (catalog && !out?.trim()) return finish('outcome_unknown', '效果指令没有可核对的回执，未扣魔力或记录学习；请查询状态，不要自动重发。')
          if (out) log(`rc[${cmd}] -> ${out.trim()}`)
          // 2026-08-29 台账真实性收紧：RCON 回执含错误关键词 → 记失败（此前 263 次
          // 影分身「假成功」——SNBT 报 Invalid escape 仍记 success:true，统计数据失真）。
          if (RCON_CMD_ERR_RE.test(out || '')) {
            cmdErrors.push(`${cmd.slice(0, 60)} => ${(out || '').trim().slice(0, 80)}`)
            if (catalog) break
          }
        }
      }

      if (cmdErrors.length) {
        return commandFailure()
      }
      // Featured spells debit legacy mana only after the effect is acknowledged.
      // No refund/retry is attempted after an ambiguous transport interruption.
      if (catalog && cost.mana >= 0) store.spendMana(username, cost.mana)

      // 视觉：粒子 + 音效 + 大字咏唱词
      await castVfx(atom, vars, username).catch((err) => log(`cast visuals unavailable: ${err instanceof Error ? err.message : String(err)}`))

      // 延迟后续命令（postCast，2026-08-30 螺旋丸根治）：沿弹伤害/清场。
      // vars 已渲染为字符串快照，复用安全；异步发不阻塞回执。
      if (atom.postCast?.length) {
        for (const pc of atom.postCast) {
          setTimeout(() => {
            for (const c of pc.commands) {
              rcon.send(renderCommand(c, vars)).then((out) => {
                if (out) log(`postCast(${pc.delayMs}ms)[${c.slice(0, 50)}] -> ${out.trim()}`)
              }).catch(() => { /* 延迟段失败静默（弹已消散等） */ })
            }
          }, pc.delayMs)
        }
      }

      store.learn(username, atom.id)

      // 经验结算（2026-08-17 节律修订）：纯魔力施法不给修为（防止"越施法越强"的
      // 滥用循环，修为回归生存行为主导）；只有付出生命/饱食代价的施法才给修为
      // （越拼命成长越快）。升级检测与公告由世界侧 tick 的 ΔXpLevel 统一做。
      const sacrificed = cost.hp > 0 || cost.food > 0
      const expGain = sacrificed ? Math.max(1, Math.round(cost.mana / 5)) + cost.hp * 2 + cost.food : 0
      if (expGain > 0) {
        try {
          await rcon.send(`xp add ${username} ${expGain} points`)
        } catch { /* 经验注入失败不影响施法结算 */ }
      }
      const levelAfter = store.get(username).level

      const manaLeft = store.get(username).mana
      // 逆转化实际增量（被上限截断时少于理论值，如实相告）
      const manaGained = cost.mana < 0 ? Math.max(0, Math.round(manaLeft - manaBeforeDebit)) : 0
      const reply = specialReply ?? atom.reply
        .replace(/\{distance\}/g, String(distance))
        .replace(/\{direction\}/g, String(params.direction ?? '东'))
      const parts: string[] = []
      if (cost.mana > 0) parts.push(`魔力 ${cost.mana}`)
      if (cost.food > 0) parts.push(`饱食度 ${cost.food}`)
      if (cost.hp > 0) parts.push(`生命 ${cost.hp}`)
      // 逆转化回执形如「（生命 6 → 换取魔力 15）」，普通施法仍走「（消耗魔力 30）」
      const costDesc = cost.mana < 0
        ? `（${parts.join('、')} → 换取魔力 ${manaGained}）`
        : parts.length > 0 ? `（消耗${parts.join('、')}）` : ''
      log(`cast ${atom.id} by ${username}: ${atom.commands.join('; ')} (mana ${cost.mana}, food ${cost.food}, hp ${cost.hp}, xp +${expGain})`)
      chronicle('cast', username, { skill: atom.id, mana: cost.mana, food: cost.food, hp: cost.hp, xp: expGain, level: levelAfter })
      appendSkillUsage({ ts: new Date().toISOString(), player: username, atom: atom.id, chant, mana: cost.mana, food: cost.food, hp: cost.hp, manaLeft: Math.floor(manaLeft), maxMana: pstate.maxMana, level: levelAfter, matchMode: opts?.mode ?? 'exact', tokens: opts?.tokens ?? 0, latencyMs: opts?.latencyMs ?? 0, success: cmdErrors.length === 0, ...(cmdErrors[0] ? { result: `cmd-fail: ${cmdErrors[0]}` } : {}) })
      return { ...finish('ok', `${reply}${costDesc}，剩余魔力 ${Math.floor(manaLeft)}/${pstate.maxMana}。${expGain > 0 ? `修为 +${expGain}。` : ''}${homeToTown ? '（归乡固定返回千灯堂。）' : ''}`, { manaLeft }),
        ...(springReceipt ? { effectReceipt: springReceipt } : {}) }
    } catch (err) {
      return finish('execution_error', `施法中断，资源或部分效果可能已结算，未自动重试：${err instanceof Error ? err.message : String(err)}`, { manaLeft: store.get(username).mana })
    }
  }

  // ── 女神代施（慢路径执行器）：与 cast() 共用渲染器/VFX。
  // 2026-08-23：默认零门槛零消耗（神迹）；传 consumeMana/latencyMs/mode 时 = 模糊施法（扣魔力+前摇+台账）。
  async function castByGod(username: string, atomId: string, opts: GodCastOpts = {}): Promise<string> {
    const atom = atoms.find((a) => a.id === atomId)
    if (!atom) return `未知技艺「${atomId}」，神迹未成。`
    const archived = archivedResult(atom)
    if (archived) return archived.summary
    if (atom.type === 'passive') return (await cast(username, atomId, { forceAtom: atom })).summary
    const bot = getBot()
    if (!bot.entity) return '女神化身离线，神迹未成。'

    const nativeTravel = catalog !== null && (atom.id === 'home' || atom.id === 'tp')
    const origin = catalog ? await travel.location(username) : null
    if (origin && !origin.ok) return origin.summary

    const entityPos = bot.players[username]?.entity?.position
    const pos = origin ? { x: origin.x!, y: origin.y!, z: origin.z! } :
      entityPos ? { x: entityPos.x, y: entityPos.y, z: entityPos.z } : await rcon.getPos(username)
    if (!pos) return `「${username}」不在此界（离线），神迹未成。`
    const px = Math.round(pos.x)
    const py = Math.round(pos.y)
    const pz = Math.round(pos.z)

    const distance = typeof opts.distance === 'number' && Number.isFinite(opts.distance)
      ? Math.max(0, Math.min(30, Math.floor(opts.distance)))
      : 10
    const dirName = opts.direction && DIR_VECTORS[opts.direction] ? opts.direction : '东'
    const dirVec = DIR_VECTORS[dirName] ?? [1, 0]
    const tx = Math.round(px + dirVec[0] * distance)
    const ty = py
    const tz = Math.round(pz + dirVec[1] * distance)

    const item = opts.item && Object.values(GIVE_WHITELIST).includes(opts.item) ? opts.item : 'bread'
    // 2026-08-30 造物扩展：数量分类默认（GIVE_DEFAULT_COUNT）——女神未明示数量时
    // 面包=4/木板=16/工具=1，而不是一刀切 1；护栏 1-16。
    const count = typeof opts.count === 'number' && Number.isFinite(opts.count)
      ? Math.max(1, Math.min(16, Math.floor(opts.count)))
      : Math.max(1, Math.min(16, GIVE_DEFAULT_COUNT[item] ?? 1))

    let bx = 0
    let by = 0
    let bz = 0
    if (atom.id === 'home') {
      // 2026-08-30 定谳：归乡固定千灯堂（千灯村），不再查床（村外床劫持问题）
      bx = TOWN_SPAWN.x
      by = TOWN_SPAWN.y
      bz = TOWN_SPAWN.z
    }

    const vars: Record<string, number | string> = {
      target: username, bx, by, bz, px, py, pz, tx, ty, tz, item, count, distance, direction: dirName,
      pyh: `${py + 1.4}`, // 头部高度（弹体生成位；字符串保小数）
    }
    // 通灵契约：神迹代施同样支持 {puuid}（契约兽归属受赐者）+ ownLimit 防重赐
    if (atom.commands.some((c) => c.includes('{puuid}')) || atom.ownLimit) {
      const raw = await rcon.send(`data get entity ${username} UUID`)
      const m = /\[I;\s*([-\d,\s]+)\]/.exec(raw || '')
      if (!m) return `无法感知「${username}」的灵魂印记（UUID），神迹未成。`
      vars.puuid = `I;${m[1].replace(/\s+/g, '')}`
    }
    if (atom.ownLimit) {
      const range = atom.ownLimit.range ?? 96
      const out = await rcon.send(`execute if entity @e[type=${atom.ownLimit.entity},distance=..${range},nbt={Owner:[${vars.puuid}]}]`)
      if (/passed/i.test(out || '')) return atom.ownLimit.denyReply ?? `契约之兽已在其身边，无需再赐。`
    }
    // 模糊施法前摇（2026-08-23）：粒子先行（凝聚中），延迟后落地。LLM 路径延迟=推理耗时（自然前摇）。
    if (opts.latencyMs && opts.latencyMs > 0) {
      await rcon.send(`${catalog ? `execute at ${username} run ` : ''}particle minecraft:end_rod ${px} ${py + 1} ${pz} 0.5 0.5 0.5 0.02 40`).catch(() => {})
      await new Promise((res) => setTimeout(res, opts.latencyMs ?? 0))
    }
    // 模糊施法扣魔力（神迹零消耗；向量/LLM 模糊 = 玩家自担魔力）
    if (opts.consumeMana !== undefined && opts.consumeMana > 0) {
      const pstate = store.get(username)
      if (pstate.mana < opts.consumeMana) {
        return `魔力不足（耗魔 ${opts.consumeMana}，汝余 ${Math.floor(pstate.mana)}）。法力波动渐渐平息……`
      }
      if (!catalog) store.spendMana(username, opts.consumeMana)
    }
    // 光环/契约类（2026-08-29 补）：special 原子不走 commands，交给 specialExecutor
    // 落地（光环引擎启动等）——与 cast() 执行核同构；失败则神迹未成，不进 vfx/记账。
    if (atom.special) {
      if (!specialExecutor) return '契约信道未开（执行器未就位），神迹未成。'
      const res = await specialExecutor(atom.special, username, {}, vars, atom.id)
      if (!res.ok) return res.reply
    }
    try {
      if (nativeTravel) {
        const moved = await travel.teleport(username, {
          id: 0, name: atom.name, createdAt: 0,
          dim: atom.id === 'home' ? 'minecraft:overworld' : origin!.dimension!,
          x: atom.id === 'home' ? bx : tx, y: atom.id === 'home' ? by : ty, z: atom.id === 'home' ? bz : tz,
        })
        if (!moved.ok) return moved.summary
        Object.assign(vars, { px: moved.x!, py: moved.y!, pz: moved.z!, tx: moved.x!, ty: moved.y!, tz: moved.z!, bx: moved.x!, by: moved.y!, bz: moved.z! })
      }
      for (const rawCmd of (nativeTravel ? [] : atom.commands).map((c) => renderCommand(c, vars))) {
        let cmd = rawCmd
        // 位移/传送落点安全预检（2026-08-24 安全级修复：防 tp 进实体方块 suffocated）
        if (/^tp\s/.test(rawCmd)) {
          const seg = rawCmd.trim().split(/\s+/)
          if (seg.length >= 5) {
            const safe = await nearestSafeTeleport(bot, vars, Number(seg[2]), Number(seg[3]), Number(seg[4]))
            cmd = safe ? `tp ${seg[1]} ${safe.x} ${safe.y} ${safe.z}` : `tp ${seg[1]} ${vars.px} ${vars.py} ${vars.pz}`
          }
        }
        if (catalog) cmd = `execute at ${username} run ${cmd}`
        const out = await rcon.send(cmd)
        if (catalog && !out?.trim()) return '效果指令没有可核对的回执，未扣魔力；请查询状态，不要自动重发。'
        if (catalog && RCON_CMD_ERR_RE.test(out || '')) return '效果指令被服务器拒绝，未扣魔力；部分效果可能已发生，请勿自动重发。'
        if (out) log(`rc[${cmd}] -> ${out.trim()}`)
      }
      if (catalog && opts.consumeMana && opts.consumeMana > 0) store.spendMana(username, opts.consumeMana)
      await castVfx(atom, vars, username)
      // postCast（2026-08-30 螺旋丸根治）：代施同享沿弹伤害。
      if (atom.postCast?.length) {
        for (const pc of atom.postCast) {
          setTimeout(() => {
            for (const c of pc.commands) {
              rcon.send(renderCommand(c, vars)).then((out) => {
                if (out) log(`postCast(${pc.delayMs}ms)[${c.slice(0, 50)}] -> ${out.trim()}`)
              }).catch(() => { /* 延迟段失败静默 */ })
            }
          }, pc.delayMs)
        }
      }
      log(`godcast ${atom.id} for ${username} (${opts.mode ?? 'divine'}, mana ${opts.consumeMana ?? 0}, tokens ${opts.tokens ?? 0})`)
      // 模糊施法/神迹记账（2026-08-23）：女神魔力=LLM tokens，入台账供学习闭环
      if (opts.mode || opts.tokens !== undefined || opts.playerChant) {
        const st = store.get(username)
        appendSkillUsage({
          ts: new Date().toISOString(), player: username, atom: atom.id,
          chant: (opts.playerChant ?? '').slice(0, 120),
          mana: opts.consumeMana ?? 0, food: 0, hp: 0,
          manaLeft: Math.floor(st.mana), maxMana: st.maxMana, level: st.level,
          matchMode: opts.mode ?? (opts.tokens !== undefined ? 'llm' : 'exact'),
          tokens: opts.tokens ?? 0, latencyMs: opts.latencyMs ?? 0, success: true, result: 'ok',
        })
      }
      return opts.mode
        ? `你以模糊的咒语凝聚法力——「${atom.name}」应声而现。`
        : `「${atom.name}」已由神力代施。`
    } catch (err) {
      return `神迹中途受阻：${err instanceof Error ? err.message : String(err)}`
    }
  }

  // ── 守护天使代主人施法（2026-08-23 认主代执行）──────────────────────
  // 守护天使（sys_<owner>）经 CLI `guardian-cast <atomId>` 触发：替主人施放
  // **主人已习得（或出生天赋）**的技艺。与 castByGod（神迹零消耗）不同，这里
  // 按主人结算三资源与等级门槛，等价于主人自己咏唱（复用快路径执行核）。
  // 三闸：learned||innate → requiredLevel≤level（天赋豁免） → mana≥cost；
  // 扣 store.spendMana(owner, cost) 由执行核完成。
  async function castAsOwner(owner: string, atomId: string): Promise<string> {
    const atom = atoms.find((a) => a.id === atomId)
    if (!atom) return `未知技艺「${atomId}」，代施未成。`
    const archived = archivedResult(atom)
    if (archived) return archived.summary
    const pstate = store.get(owner)
    // 闸一：主人已习得 或 出生天赋
    if (!pstate.learned.includes(atomId) && pstate.innateSkill !== atomId) {
      return `「${owner}」尚未习得「${atom.name}」，不能代施——先祈愿求授，或让它自己咏唱已学之技。`
    }
    // 闸二（等级）、闸三（魔力）与扣费（spendMana）都在快路径执行核 cast() 内
    // （等级门槛对出生天赋豁免）；forceAtom 复用执行核，参数取默认值。
    return (await cast(owner, atomId, { forceAtom: atom, params: extractParams('', atom) })).summary
  }

  // ── 咏唱监听已迁至私语通道（2026-08-18 方案A：咒语走私语，公屏不再施法）──
  // 分流在 mc-god 的 whisper handler：sniffChant 命中 → castSpell → [信使] 回执。
  // 理由：公屏即输入通道会误触发（任何人的闲聊含关键词即施法、白烧魔力）+
  // 咒文当众暴露；私语通道 AI 与真人平权——真人 /msg Goddess 念咒同样施法；
  // 特效（粒子/音效/大字）仍公屏：旁人见异象而不知咒文。
  lc.onDispose(() => {
    log('magic disposed')
  })

  if (config.enabled) {
    log(`${atoms.length} atoms loaded, world-side engine armed (rcon via mc-rcon service)`)
  }

  return {
    service,
    dispose: () => lc.dispose(),
    setChronicle: (fn) => { chronicleFn = fn },
    setSpecialExecutor: (fn) => { specialExecutor = fn },
  }
}

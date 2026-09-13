// Compatibility storage adapter: preserve version 1, original paths and mirror semantics.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { SKILLBAR_SLOTS, type Atom, type PlayerMagicState, type MagicStateFile } from '../gameplay/magic/contracts.ts'
import type { SkillCatalog } from '../gameplay/magic/catalog.ts'

export class MagicStateStore {
  private state: MagicStateFile
  private readonly path: string
  private readonly maxManaDefault: number
  private readonly regenPerSec: number
  private regenPerSecNow: number
  private readonly mirrorPath: string | null

  constructor(path: string, maxManaDefault: number, regenPerSec: number, mirrorPath: string | null = '/mcdata/magic-state.json') {
    this.path = resolve(path)
    this.maxManaDefault = maxManaDefault
    this.regenPerSec = regenPerSec
    this.regenPerSecNow = regenPerSec
    this.mirrorPath = mirrorPath
    this.state = this.load()
  }

  private load(): MagicStateFile {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf-8'))
        if (raw && typeof raw === 'object' && raw.version === 1) return raw as MagicStateFile
      }
    } catch (err) {
      console.error(`[mc-magic] failed to load state: ${err instanceof Error ? err.message : String(err)}`)
    }
    return { version: 1, players: {} }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = this.path + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8')
      renameSync(tmp, this.path)
      // 2026-08-29 双源归一：/mcdata 侧（settlementsfix 命格书重写、numen、npc 引擎渲染）
      // 长期读到旧副本——「萌萌命格书尚未启封」的根因即 mod 读 mcdata 过期文件。
      // 正本落盘后镜像到 /mcdata（world 容器挂载可写）；本地跑测试无此目录则静默跳过。
      try {
        if (this.mirrorPath !== null) writeFileSync(this.mirrorPath, JSON.stringify(this.state, null, 2), 'utf-8')
      } catch { /* 镜像尽力而为，不伤正本 */ }
    } catch (err) {
      console.error(`[mc-magic] failed to save state: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 技能栏槽位（2026-08-30）：''=空槽占位（保槽位语义：设第 5 槽不会塌成第 3 槽）。
   *  失效 id（遗忘/热重载消失）原位变 ''；无栏则按推荐表自动填并持久化。 */
  skillbar(username: string, atoms: Atom[], catalog: SkillCatalog | null = null): string[] {
    const p = this.get(username)
    const known = new Set<string>([...p.learned, ...(p.innateSkill ? [p.innateSkill] : [])])
    const valid = (id: string) => known.has(id) && atoms.some((a) => a.id === id && a.type !== 'passive')
    if (p.skillbar?.length) {
      const seen = new Set<string>()
      const alive = p.skillbar.slice(0, SKILLBAR_SLOTS).map((id) => {
        if (!valid(id) || seen.has(id)) return ''
        seen.add(id)
        return id
      })
      const dirty = JSON.stringify(alive) !== JSON.stringify(p.skillbar)
      if (dirty) { p.skillbar = alive; this.save() }
      // Archive filtering is a view. Keep earned slot IDs in persistent state so
      // restoring a catalogue does not destroy the player's old layout.
      return alive.map((id) => catalog?.entries.get(id)?.status === 'archived' ? '' : id)
    }
    // 默认填充：推荐优先级 ∩ 已学主动技能；统一八槽，空位不挤占已绑定的位置。
    const PREF = catalog?.featured ?? ['heal', 'rasengan', 'chain_lightning', 'fireburst', 'swift', 'home']
    const visible = (id: string) => valid(id) && (!catalog || catalog.entries.get(id)?.status === 'featured')
    const bar = [...PREF.filter(visible), ...[...known].filter((id) => !PREF.includes(id) && visible(id))].slice(0, SKILLBAR_SLOTS)
    p.skillbar = bar
    this.save()
    return [...bar]
  }

  persist(): void { this.save() }

  /** 惰性回蓝：结算到 now，返回该玩家状态。 */
  get(username: string, now = Date.now()): PlayerMagicState {
    let p = this.state.players[username]
    if (!p) {
      p = this.state.players[username] = {
        mana: this.maxManaDefault,
        maxMana: this.maxManaDefault,
        maxManaBonus: 0,
        learned: [],
        lastUpdate: now,
        innateSkill: null,
        backstory: null,
        level: 1,
        hpRatio: null,
        foodRatio: null,
        passives: [],
        passiveProgress: {},
        advancements: [],
        advancementSkills: [],
      }
    }
    if (p.skillbar === undefined) p.skillbar = undefined
    // 兜底：旧版状态文件缺字段时补默认值（exp 字段已随路线 A 废弃，读到的旧值忽略）。
    if (p.innateSkill === undefined) p.innateSkill = null
    if (p.backstory === undefined) p.backstory = null
    if (p.level === undefined) p.level = 1
    if (p.maxManaBonus === undefined) p.maxManaBonus = 0
    // 防漂移：最终魔力上限 = 等级基础公式 + 体系自有加成（旧文件手写 maxMana 以此为准）。
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    if (p.hpRatio === undefined) p.hpRatio = null
    if (p.foodRatio === undefined) p.foodRatio = null
    if (p.passives === undefined) p.passives = []
    if (p.passiveProgress === undefined) p.passiveProgress = {}
    if (p.advancements === undefined) p.advancements = []
    if (p.advancementSkills === undefined) p.advancementSkills = []
    const dt = (now - p.lastUpdate) / 1000
    if (dt > 0) {
      p.mana = Math.min(p.maxMana, p.mana + dt * this.regenRateFor(p))
    }
    p.lastUpdate = now
    return p
  }

  /** 回蓝速率（点/秒）：基础 regenPerSecNow × 稀有被动倍率（坚毅：HP<30% 时 ×2）。 */
  private regenRateFor(p: PlayerMagicState): number {
    let rate = this.regenPerSecNow
    if (p.hpRatio !== null && p.hpRatio < 0.3 && p.passives.includes('fortitude')) rate *= 2.0
    return rate
  }

  /** 天平引擎：运行时热调基础回蓝速率（点/秒），立即生效（惰性结算下次读写即用新值）。 */
  setRegenPerSec(v: number): void {
    this.regenPerSecNow = v
  }

  getRegenPerSec(): number {
    return this.regenPerSecNow
  }

  /** 当前回蓝速率（点/秒）：基础 × 稀有被动倍率（坚毅 HP<30% ×2）。供属性面板/CLI 查询。 */
  regenRateForPlayer(username: string): number {
    return this.regenRateFor(this.get(username))
  }

  spendMana(username: string, amount: number, now = Date.now()): void {
    const p = this.get(username, now)
    // 双向钳制：正数扣魔不透支，负数（逆转化：燃血/炼食换魔）不溢出上限。
    p.mana = Math.min(p.maxMana, Math.max(0, p.mana - amount))
    p.lastUpdate = now
    this.save()
  }

  learn(username: string, atomId: string): void {
    const p = this.get(username)
    if (!p.learned.includes(atomId)) {
      p.learned.push(atomId)
      this.save()
    }
  }

  /** 成就已见登记（幂等）；返回是否首次见到（true = 需要 公告/编年史/解锁检查）。 */
  addAdvancement(username: string, advId: string): boolean {
    const p = this.get(username)
    if (p.advancements.includes(advId)) return false
    p.advancements.push(advId)
    this.save()
    return true
  }

  getAdvancements(username: string): string[] {
    return [...this.get(username).advancements]
  }

  /** 成就解锁通道授予法术（learn + advancementSkills 标记来源；绕过等级门槛）。 */
  learnViaAdvancement(username: string, atomId: string): void {
    const p = this.get(username)
    if (!p.learned.includes(atomId)) p.learned.push(atomId)
    if (!p.advancementSkills.includes(atomId)) p.advancementSkills.push(atomId)
    this.save()
  }

  /**
   * 魔力上限基础公式（2026-08-17 路线 A：等级全复用 MC 原生 XpLevel）。
   * base = 100 + 12 × (XpLevel − 1)；最终上限 = base + 体系自有加成 maxManaBonus。
   */
  maxManaFor(level: number): number {
    return this.maxManaDefault + 12 * Math.max(0, level - 1)
  }

  /**
   * 体系自有加成：永久提升魔力上限（祝福/被动/供奉回报/仪式奖励等自有机制用）。
   * 立即校准 maxMana 并落盘，返回新上限。
   */
  addMaxManaBonus(username: string, amount: number): number {
    const p = this.get(username)
    p.maxManaBonus = Math.max(0, p.maxManaBonus + Math.round(amount))
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    this.save()
    return p.maxMana
  }

  /**
   * 世界侧同步原生等级（tick 读 XpLevel 后写入；施法门槛判定/属性面板用）。
   * 传入 null = 玩家离线，保留旧值。
   */
  setLevel(username: string, xpLevel: number | null): void {
    if (xpLevel === null) return
    const p = this.get(username)
    p.level = Math.max(0, xpLevel)
    p.maxMana = this.maxManaFor(p.level) + p.maxManaBonus
    // 不 save()——高频 tick 落盘交给下一次施法/解锁的 save()。
  }

  /** 世界侧生命体征 tick 写入（hpRatio/foodRatio ∈ [0,1]，离线传 null 暂存旧值亦可；foodRatio 省略则保留旧值）。 */
  setVitals(username: string, hpRatio: number | null, foodRatio?: number | null): void {
    const p = this.get(username)
    p.hpRatio = hpRatio
    if (foodRatio !== undefined) p.foodRatio = foodRatio
    // 注意：不 save()——高频 tick 只改内存，随下一次施法/解锁的 save() 一并落盘。
  }

  /** 稀有被动解锁进度 +dtSec（只累不清零）；返回该被动累计秒数。 */
  addPassiveProgress(username: string, passiveId: string, dtSec: number): number {
    const p = this.get(username)
    p.passiveProgress[passiveId] = (p.passiveProgress[passiveId] ?? 0) + dtSec
    return p.passiveProgress[passiveId]
  }

  getPassiveProgress(username: string, passiveId: string): number {
    return this.get(username).passiveProgress[passiveId] ?? 0
  }

  /** 解锁稀有被动（幂等）；返回是否新解锁。 */
  unlockPassive(username: string, passiveId: string): boolean {
    const p = this.get(username)
    if (p.passives.includes(passiveId)) return false
    p.passives.push(passiveId)
    this.save()
    return true
  }

  hasPassive(username: string, passiveId: string): boolean {
    return this.get(username).passives.includes(passiveId)
  }

  getLevel(username: string): number {
    return this.get(username).level
  }

  /** 记录降临仪式自选的初始技能，并预置为已学会（出生天赋）。 */
  setInnate(username: string, atomId: string): void {
    const p = this.get(username)
    p.innateSkill = atomId
    if (!p.learned.includes(atomId)) p.learned.push(atomId)
    this.save()
  }

  getInnate(username: string): string | null {
    return this.get(username).innateSkill
  }

  setBackstory(username: string, text: string): void {
    const p = this.get(username)
    p.backstory = text
    this.save()
  }

  getBackstory(username: string): string | null {
    return this.get(username).backstory
  }
}

// Deterministic skill policy and read-only presentation.
import type { Atom, AtomSummary, AppraisalData, CastResult, CostSpec } from './contracts.ts'
import { projectCatalogEntry, type SkillCatalog } from './catalog.ts'
import { GIVE_DEFAULT_COUNT } from './defaults.ts'

export function castResult(code: CastResult['code'], summary: string, atom?: Atom,
                    extra: Pick<CastResult, 'manaLeft' | 'cooldownMs' | 'nativeHints'> = {}): CastResult {
  return { ok: code === 'ok', code, ...(atom ? { skillId: atom.id, name: atom.name } : {}), summary, ...extra }
}

/** 列表和单项查询共用投影，参悟所需的被动标识不能在服务边界丢失。 */
export function summarizeAtom(a: Atom, catalog: SkillCatalog | null = null): AtomSummary {
  return {
    id: a.id, type: a.type, passiveId: a.passiveId,
    name: a.name, words: [...a.words], category: a.category, school: a.school,
    cost: { ...a.cost }, requiredLevel: a.requiredLevel ?? 1, icon: catalog?.icons.get(a.id) ?? a.icon,
    catalog: projectCatalogEntry(catalog, a.id),
    params: a.params || a.id === 'give' ? {
      ...Object.fromEntries(Object.entries(a.params ?? {}).map(([key, spec]) => [key, { ...spec }])),
      ...(a.id === 'give' ? { count: { type: 'number' as const, min: 1, max: 16,
        default: GIVE_DEFAULT_COUNT[String(a.params?.item?.default ?? 'bread')] ?? 1 } } : {}),
    } : undefined,
  }
}

/** 单法术可调字段白名单（护栏：min/max 闭区间，整数）。 */
export const BALANCE_FIELDS: Record<string, { label: string; min: number; max: number; get: (a: Atom) => number; set: (a: Atom, v: number) => void }> = {
  'cost.mana': { label: '魔力', min: 0, max: 500, get: (a) => a.cost.mana, set: (a, v) => { a.cost.mana = v } },
  'cost.food': { label: '饱食', min: 0, max: 20, get: (a) => a.cost.food, set: (a, v) => { a.cost.food = v } },
  'cost.hp': { label: '生命', min: 0, max: 10, get: (a) => a.cost.hp, set: (a, v) => { a.cost.hp = v } },
  'requiredLevel': { label: '等级', min: 1, max: 50, get: (a) => a.requiredLevel ?? 1, set: (a, v) => { a.requiredLevel = v } },
}

/** 全局可调字段白名单（跨法术参数；回蓝允许 0.1 步进）。 */
export const BALANCE_GLOBALS: Record<string, { label: string; min: number; max: number }> = {
  regenPerSec: { label: '回蓝', min: 0.5, max: 10 },
}

/** 字段中文别名 → 字段名（聊天命令「平衡 <法术> 魔力 90」用）。 */
export const BALANCE_FIELD_ALIASES: Record<string, string> = {
  魔力: 'cost.mana',
  饱食: 'cost.food',
  生命: 'cost.hp',
  血量: 'cost.hp',
  等级: 'requiredLevel',
  门槛: 'requiredLevel',
  回蓝: 'regenPerSec',
  回蓝速度: 'regenPerSec',
}

export function balanceFieldLabel(field: string): string {
  return BALANCE_FIELDS[field]?.label ?? BALANCE_GLOBALS[field]?.label ?? field
}

/**
 * 鉴定报告 = panel（私发多行面板）+ summary（公屏/耳语一句话）。
 * 纯函数：数值全部由调用方采好传入，可离线单测。
 */
export function buildAppraisalReport(
  d: AppraisalData,
  atoms: AtomSummary[],
  innateId: string | null,
): { panel: string; summary: string } {
  const pct = d.xpProgress === null ? null : Math.round(d.xpProgress * 100)
  const progressText = pct === null ? '' : `（下一层 ${pct}%）`
  const bonusText = d.maxManaBonus > 0 ? `（含加持 +${d.maxManaBonus}）` : ''
  const fmt = (v: number | null, suffix: string) => (v === null ? '未探明' : `${Math.round(v)}${suffix}`)

  const mastered = atoms
    .filter((a) => a.requiredLevel <= d.level && a.id !== innateId)
    .map((a) => a.name)
  const innate = d.innateName ? [d.innateName] : []
  const allMastered = [...innate, ...mastered]
  const total = atoms.length

  const locked = atoms
    .filter((a) => a.requiredLevel > d.level)
    .sort((a, b) => a.requiredLevel - b.requiredLevel) // 稳定排序：同级保持 atoms 原文件序
  const nextLevels: { lv: number; names: string }[] = []
  for (const a of locked) {
    let g = nextLevels.find((x) => x.lv === a.requiredLevel)
    if (!g) {
      if (nextLevels.length >= 2) break
      g = { lv: a.requiredLevel, names: '' }
      nextLevels.push(g)
    }
    const parts = g.names ? g.names.split('、') : []
    if (parts.length < 4) parts.push(a.name)
    else if (!parts.includes('等')) parts.push('等')
    g.names = parts.join('、')
  }
  const nextText =
    nextLevels.length > 0
      ? nextLevels.map((g) => `Lv.${g.lv} ${g.names}`).join(' ｜ ')
      : '（已臻化境，万法皆通）'

  const panel =
    `✦ 鉴定 · ${d.player} ✦\n` +
    `修为层级：Lv.${d.level}${progressText}\n` +
    `魔力：${Math.floor(d.mana)}/${d.maxMana}${bonusText}\n` +
    `生命：${fmt(d.health, '/20')} ｜ 饱食：${fmt(d.food, '/20')} ｜ 护甲：${fmt(d.armor, '')}\n` +
    (d.innateName ? `出生天赋：${d.innateName}\n` : '') +
    (d.passiveNames.length > 0 ? `稀有被动：${d.passiveNames.join('、')}\n` : '') +
    `已掌握（${allMastered.length}/${total}）：${allMastered.length > 0 ? allMastered.join('、') : '尚无法术'}\n` +
    `下一批：${nextText}`

  const nextCount = locked.filter((a) => a.requiredLevel === (nextLevels[0]?.lv ?? -1)).length
  const summary =
    `✦ 鉴定：Lv.${d.level}${pct !== null ? `（${pct}%）` : ''}｜魔力 ${Math.floor(d.mana)}/${d.maxMana}${bonusText}` +
    `｜天赋${d.innateName ? `「${d.innateName}」` : '未觉醒'}｜秘法 ${allMastered.length}/${total}` +
    (nextLevels.length > 0 ? `（Lv.${nextLevels[0].lv} 解锁 ${nextCount} 项）` : '') +
    `——详录已传入你的心识。`

  return { panel, summary }
}

export function computeCost(atom: Atom, params: Record<string, number | string>): CostSpec {
  const cost: CostSpec = { ...atom.cost }
  if (atom.paramCosts) {
    for (const [pname, pc] of Object.entries(atom.paramCosts)) {
      if (!pc) continue
      const val = typeof params[pname] === 'number' ? (params[pname] as number) : 0
      if (pc.mana) cost.mana += pc.mana * val
      if (pc.food) cost.food += pc.food * val
      if (pc.hp) cost.hp += pc.hp * val
    }
  }
  return cost
}

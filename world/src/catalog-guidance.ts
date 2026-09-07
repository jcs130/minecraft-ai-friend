import type { AtomSummary } from './mc-magic.ts'

type GuidanceAtom = Pick<AtomSummary, 'id' | 'name' | 'type' | 'catalog'>
export function hasSkillCatalog(atoms: readonly GuidanceAtom[]): boolean {
  return atoms.some(atom => atom.catalog !== undefined)
}

/** Prompt text comes from the actual catalogue, so a restored archive entry is
 * never accidentally recommended by an unrelated hardcoded onboarding list. */
export function newcomerSkillGuidance(atoms: readonly GuidanceAtom[]): string {
  if (!hasSkillCatalog(atoms)) return '2. 教技能用法：已学的技能私语 /msg Goddess 念咒语名（归乡/圣愈/造物/照明/传送…）即可施放；不会的用法术名祈愿或找书商。'
  const featured = atoms.filter(atom => atom.type !== 'passive' && atom.catalog?.status === 'featured')
    .map(atom => `${atom.name}（${atom.id}）`).join('、')
  return `2. 教技能用法：当前精选为${featured}。欢迎只举其中一两项；用 /mycli cast 技能ID 或私语咏唱，规则与消耗见 /myhelp。铁魔法先取得并装备含该法术的法术书或手持卷轴，再用 /mycli spells 查看可施放项。不要推荐目录外的旧技能，不要声称知道法术名就拥有原生法术。`
}

export interface EmergencyHealingFeedback {
  accepted: boolean
  hint: string
  record?: { action: 'emergency_cast_started'; skill: 'irons_spellbooks:heal'; code: 'casting_started'; reply: string }
}

/** Acceptance is not proof of restored health. Only the native bridge's exact
 * acceptance code may produce a start-event; failures never become a save-event. */
export function nativeEmergencyHealingFeedback(result?: { ok: boolean; code: string }): EmergencyHealingFeedback {
  if (result?.ok === true && result.code === 'casting_started') {
    return {
      accepted: true,
      hint: '治疗已开始施法，效果尚待确认；立即撤到安全处，留意生命和施法状态，不要重复施放。',
      record: { action: 'emergency_cast_started', skill: 'irons_spellbooks:heal', code: 'casting_started', reply: '原生治疗已受理并开始施法，尚未确认生命恢复。' },
    }
  }
  if (result?.code === 'outcome_unknown') return { accepted: false, hint: '治疗回执待核实；先撤到安全处，用 /mycli status 查看生命和施法状态，不要自动重发。' }
  if (result?.code === 'busy') return { accepted: false, hint: '你正在施法，未叠加治疗；先撤到安全处并查看 /mycli status，不要连续重发。' }
  if (result?.code === 'mana' || result?.code === 'cooldown') return { accepted: false, hint: '原生治疗因法力或冷却限制未开始；立即安全撤退、进食恢复，用 /mycli status 查看状态。' }
  return { accepted: false, hint: '立即撤到安全处、进食恢复；治疗需装备含治疗术的原生法术书或手持卷轴，用 /mycli spells 检查可用法术。' }
}

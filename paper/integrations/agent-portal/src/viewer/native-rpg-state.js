const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const id = value => typeof value === 'string' && /^[a-z0-9_:.-]{0,80}$/.test(value) ? value : null
const text = value => typeof value === 'string' ? value.slice(0, 128) : null
const number = value => Number.isFinite(value) && value >= 0 && value <= 1e15 ? value : null
const fields = (value, names) => Object.fromEntries(names.map(k => [k, number(value?.[k])]))

/** Identity-bound, bounded public RPG readings; never pass arbitrary plugin JSON. */
export function projectNativeRpgSkills (value, playerUuid) {
  if (!uuid.test(playerUuid ?? '') || !value || value.schemaVersion !== 1 ||
      typeof value.playerUuid !== 'string' || value.playerUuid.toLowerCase() !== playerUuid.toLowerCase() || !value.rpg) return null
  const raw = value.rpg, rpg = { available: raw.available === true, backend: id(raw.backend) }
  if (rpg.available) {
    Object.assign(rpg, fields(raw, ['level', 'xp', 'nextLevelXp', 'skillPoints']),
      { combat: id(raw.combat), className: text(raw.className), activeSkill: id(raw.activeSkill) })
    // Vortex returns cumulative XP and XP remaining, not progress/threshold.
    rpg.xpToNextLevel = number(raw.xpToNextLevel ?? (raw.backend === 'vortex' ? raw.nextLevelXp : null))
    rpg.economy = { available: raw.economy?.available === true, balance: number(raw.economy?.balance) }
    rpg.talents = { available: raw.talents?.available === true, points: number(raw.talents?.points) }
    if (rpg.talents.available && raw.talents?.allocated && typeof raw.talents.allocated === 'object')
      rpg.talents.allocated = Object.fromEntries(Object.entries(raw.talents.allocated).slice(0, 8)
        .filter(([key, list]) => id(key.toLowerCase()) !== null && Array.isArray(list))
        .map(([key, list]) => [key, list.slice(0, 64).filter(s => id(s) !== null)]))
    rpg.party = { available: raw.party?.available === true, inParty: raw.party?.inParty === true,
      members: Array.isArray(raw.party?.members) ? raw.party.members.filter(s => uuid.test(s)).slice(0, 8) : [] }
  }
  const mana = number(value.mana?.current) !== null && number(value.mana?.max) !== null && value.mana.max > 0
    ? { current: value.mana.current, max: value.mana.max } : null
  const abilities = (Array.isArray(value.abilities) ? value.abilities : []).slice(0, 64)
    .filter(row => id(row?.id) !== null && text(row?.name) !== null)
    .map(row => ({ id: id(row.id), name: text(row.name), ...fields(row, ['level', 'manaCost', 'cooldownMs', 'cooldownRemainingMs']) }))
  const rescue = value.rescue && typeof value.rescue.downed === 'boolean' ? {
    downed: value.rescue.downed, lifeState: ['alive', 'downed', 'dead'].includes(value.rescue.lifeState) ? value.rescue.lifeState : null,
    participants: number(value.rescue.participants), rescueEnabled: value.rescue.rescueEnabled === true,
    downedTeammates: (Array.isArray(value.rescue.downedTeammates) ? value.rescue.downedTeammates : []).slice(0, 8)
      .map(row => ({ name: text(row.name), phase: ['paused', 'waiting', 'rescuing'].includes(row.phase) ? row.phase : null,
        progress: number(row.progress), remainingMs: number(row.remainingMs) }))
  } : null
  return { schemaVersion: 1, source: 'server_rpg_snapshot', playerUuid: playerUuid.toLowerCase(), rpg, mana, rescue,
    keepInventory: typeof value.keepInventory === 'boolean' ? value.keepInventory : null, skills: [], abilities }
}

export function nativeRpgSummary (skills) {
  const rpg = skills?.rpg
  if (!rpg) return ''
  if (rpg.available !== true) return 'RPG 数据暂未同步'
  const parts = [rpg.className || rpg.combat || '未选择职业', `RPG Lv.${number(rpg.level) ?? '?'}`]
  if (number(rpg.xp) !== null) parts.push(`累计经验 ${rpg.xp}`)
  const remaining = number(rpg.xpToNextLevel ?? (rpg.backend === 'vortex' ? rpg.nextLevelXp : null))
  if (remaining !== null) parts.push(`升级还需 ${remaining}`)
  if (number(rpg.skillPoints) !== null) parts.push(`学习点 ${rpg.skillPoints}`)
  if (rpg.talents?.available && number(rpg.talents.points) !== null) parts.push(`天赋点 ${rpg.talents.points}`)
  if (rpg.economy?.available && number(rpg.economy.balance) !== null) parts.push(`金币 ${rpg.economy.balance}`)
  if (rpg.party?.available) parts.push(rpg.party.inParty ? `队伍 ${rpg.party.members.length} 人` : '未组队')
  if (skills.rescue?.downed) parts.push('倒地等待救援：队友4格内停留10秒')
  if (skills.keepInventory === true) parts.push('死亡保留背包装备')
  return parts.join(' · ')
}

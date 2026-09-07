/** Native spellbook adapter. The server owns availability, costs and cast lifecycle. */
import { readFileSync } from 'node:fs'

import { NATIVE_SPELL_ID, SKILL_ACTOR, type NativeSpell, type NativeReceipt, type Action } from './gameplay/native/contracts.ts'
export { NATIVE_SPELL_ID, SKILL_ACTOR } from './gameplay/native/contracts.ts'
export type { NativeSpell, NativeReceipt, Action, NativeSpellAction } from './gameplay/native/contracts.ts'

export function createIronsSpellClient(send: (command: string) => Promise<string>, translations?: Record<string, string>) {
  if (!translations) {
    try { translations = JSON.parse(readFileSync(new URL('./irons-spell-names.json', import.meta.url), 'utf8')) }
    catch { translations = {} }
  }
  const failure = (code: string, summary: string): NativeReceipt => ({ ok: false, engine: 'irons_spellbooks', code, summary })
  async function request(action: Action, actor: string, id?: string): Promise<NativeReceipt> {
    if (!SKILL_ACTOR.test(actor)) return failure('invalid_actor', '角色须使用登录名或 UUID。')
    if (action === 'cast' && (!id || !NATIVE_SPELL_ID.test(id))) return failure('invalid_skill_id', '铁魔法使用完整法术 ID，例如 irons_spellbooks:firebolt。')
    try {
      const output = await send(`qdspell ${action} ${actor}${id ? ` ${id}` : ''}`)
      const rows = output.split(/\r?\n/).filter(line => line.startsWith('QD_SPELL_JSON '))
      if (rows.length !== 1) return failure(action === 'cast' || action === 'cancel' ? 'outcome_unknown' : 'bridge_unavailable', '未收到铁魔法原生回执；请查询状态，不要自动重发施法。')
      const result = JSON.parse(rows[0].slice('QD_SPELL_JSON '.length)) as NativeReceipt
      if (result.schema !== 1 || result.engine !== 'irons_spellbooks' || typeof result.ok !== 'boolean' || result.action !== action || typeof result.code !== 'string') {
        return failure('outcome_unknown', '铁魔法回执格式不匹配；未自动重试。')
      }
      const unresolved = !result.ok && ['actor_not_found', 'ambiguous_actor', 'invalid_actor'].includes(result.code) && !result.actor && !result.actorUuid
      if (!unresolved && (actor.includes('-') ? result.actorUuid !== actor : String(result.actor).toLowerCase() !== actor.toLowerCase())) {
        return failure('outcome_unknown', '铁魔法回执角色不匹配；未自动重试。')
      }
      if (result.spells) result.spells = result.spells.map(spell => ({ ...spell, name: translations![spell.nameKey] ?? spell.name }))
      return result
    } catch { return failure('outcome_unknown', '铁魔法连接或回执中断；请查询状态，不要自动重发。') }
  }
  async function cast(actor: string, key: string): Promise<NativeReceipt> {
    const query = key.replace(/^铁魔法\s*[:：]\s*/, '').trim()
    if (NATIVE_SPELL_ID.test(query)) return request('cast', actor, query)
    const available = await request('list', actor)
    if (!available.ok) return available
    const matches = (available.spells ?? []).filter(spell => spell.name === query || spell.id === query)
    const ids = [...new Set(matches.map(spell => spell.id))]
    if (ids.length !== 1) return failure(ids.length ? 'ambiguous_skill' : 'not_equipped', ids.length ? '此名称对应多个法术，请使用完整 ID。' : '已装备的铁魔法法术书或卷轴中没有此法术。/mycli spells irons 查看可用法术。')
    return request('cast', actor, ids[0])
  }
  return { request, cast }
}

/** Read-only Pufferfish progression receipts; no file access or progression writes. */
export interface ProgressionReader { send(command: string): Promise<string> }

export const DEFAULT_PROGRESSION_CATEGORIES = ['puffish_skills:combat', 'puffish_skills:mining'] as const
import type { NativeCategoryProgression, NativeProgression } from './gameplay/native/contracts.ts'
export type { NativeCategoryProgression, NativeProgression } from './gameplay/native/contracts.ts'

const PLAYER = /^[A-Za-z0-9_]{1,16}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validTarget = (target: string): boolean => PLAYER.test(target) || UUID.test(target)
const CATEGORY = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const RECEIPT_PREFIX = 'QD_SPELL_JSON '
const METRICS = ['level', 'experience', 'points_total', 'points_spent', 'points_left'] as const

function unavailable(id: string, code: string): NativeCategoryProgression {
  return { id, available: false, code, level: null, experience: null,
    points_total: null, points_spent: null, points_left: null }
}

function failure(player: string, ids: readonly string[], code: string): NativeProgression {
  return { schema_version: 1, player, ok: false, code, source: 'puffish_skills_api',
    categories: ids.map(id => unavailable(id, code)) }
}

function requestedIds(categories: readonly string[]): string[] | null {
  if (categories.length < 1 || categories.length > 32) return null
  const ids = categories.map(id => id.includes(':') ? id : `puffish_skills:${id}`)
  if (ids.some(id => id.length > 128 || !CATEGORY.test(id)) || new Set(ids).size !== ids.length) return null
  return ids
}

/** Validate correlation and values, rather than extracting the first number from command text. */
export function parseNativeProgressionReceipt(raw: string, player: string,
  categories: readonly string[] = DEFAULT_PROGRESSION_CATEGORIES): NativeProgression {
  const ids = requestedIds(categories)
  if (!validTarget(player) || !ids) return failure(player, [], 'invalid_request')
  if (typeof raw !== 'string' || raw.length > 131_072) return failure(player, ids, 'invalid_receipt')
  // RCON can include unrelated feedback. A single explicit envelope is required.
  const lines = raw.replace(/§[0-9a-fk-or]/gi, '').split(/\r?\n/)
    .filter(line => line.startsWith(RECEIPT_PREFIX))
  if (lines.length !== 1) return failure(player, ids, lines.length ? 'ambiguous_receipt' : 'missing_receipt')
  let body: any
  try { body = JSON.parse(lines[0].slice(RECEIPT_PREFIX.length)) }
  catch { return failure(player, ids, 'invalid_receipt') }
  if (!body || body.schema !== 1 || body.action !== 'progression' || body.engine !== 'irons_spellbooks')
    return failure(player, ids, 'receipt_mismatch')
  const identity = UUID.test(player) ? body.actorUuid : body.actor
  if (typeof identity !== 'string' || identity.toLowerCase() !== player.toLowerCase())
    return failure(player, ids, 'receipt_mismatch')
  if (body.ok !== true) {
    const code = typeof body.code === 'string' && /^[a-z_]{1,48}$/.test(body.code) ? body.code : 'query_failed'
    return failure(player, ids, code)
  }
  if (!Array.isArray(body.categories) || body.categories.length > 128) return failure(player, ids, 'invalid_receipt')
  const result = ids.map(id => {
    const matches = body.categories.filter((entry: any) => entry && entry.id === id)
    if (matches.length !== 1) return unavailable(id, matches.length ? 'duplicate_category' : 'category_missing')
    const row = matches[0]
    if (row.available !== true) {
      // A category may use an exchange/points tree without enabling experience.
      if (row.code === 'no_experience' && row.level === null && row.experience === null
          && ['points_total', 'points_spent', 'points_left'].every(key => Number.isSafeInteger(row[key]))
          && row.points_spent >= 0 && row.points_left <= row.points_total - row.points_spent) {
        return { id, available: false, code: 'no_experience', level: null, experience: null,
          points_total: row.points_total, points_spent: row.points_spent, points_left: row.points_left }
      }
      const code = typeof row.code === 'string' && /^[a-z_]{1,48}$/.test(row.code) ? row.code : 'category_unavailable'
      return unavailable(id, code)
    }
    if (METRICS.some(key => !Number.isSafeInteger(row[key])) || row.level < 0
        || row.experience < 0 || row.points_spent < 0) return unavailable(id, 'invalid_metrics')
    // Native left = min(total, spentPointsLimit) - spent; preserve caps and deficits.
    if (row.points_left > row.points_total - row.points_spent) return unavailable(id, 'inconsistent_points')
    return { id, available: true, code: null, level: row.level, experience: row.experience,
      points_total: row.points_total, points_spent: row.points_spent, points_left: row.points_left }
  })
  const ok = result.every(row => row.available || (row.code === 'no_experience' && row.points_left !== null))
  return { schema_version: 1, player, ok, code: ok ? null : 'partial_or_unavailable',
    source: 'puffish_skills_api', categories: result }
}

/** One read-only bridge request. No retry, cached zero, XP reconstruction, or write command. */
export async function queryNativeProgression(rcon: ProgressionReader, player: string,
  categories: readonly string[] = DEFAULT_PROGRESSION_CATEGORIES): Promise<NativeProgression> {
  const ids = requestedIds(categories)
  if (!validTarget(player) || !ids) return failure(player, [], 'invalid_request')
  let raw: string
  try { raw = await rcon.send(`qdspell progression ${player}`) }
  catch { return failure(player, ids, 'transport_error') }
  return parseNativeProgressionReceipt(raw, player, ids)
}

export function nativeProgressionLines(result: NativeProgression): string[] {
  const names: Record<string, string> = { 'puffish_skills:combat': '战斗', 'puffish_skills:mining': '采矿' }
  return result.categories.map(row => {
    const name = names[row.id] ?? row.id
    const points = `可用技能点 ${row.points_left}（累计 ${row.points_total}，已用 ${row.points_spent}）`
    if (row.available) return `${name}：等级 ${row.level} · 经验 ${row.experience} · ${points}`
    if (row.code === 'no_experience' && row.points_left !== null) return `${name}：未启用等级/经验 · ${points}`
    return `${name}：暂不可读取（${row.code ?? result.code ?? 'unavailable'}）`
  })
}

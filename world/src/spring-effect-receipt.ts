import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'

const context = new AsyncLocalStorage<{ requestId: string; actor: string }>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DIMENSION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const STORAGE = 'qiandeng:spell_receipts'

export function withSkillRequest<T>(requestId: string, actor: string, run: () => Promise<T>): Promise<T> {
  if (!UUID.test(requestId)) throw new Error('invalid_skill_request_id')
  return context.run({ requestId, actor }, run)
}

export interface SpringTarget { actor: string; actorUuid: string; dimension: string; x: number; y: number; z: number }
export interface SpringReceipt extends Record<string, unknown> {
  schema: 1; requestId: string; storagePath: string; target: SpringTarget
  state: 'not_executed' | 'no_change' | 'rejected' | 'completed' | 'effect_observed' | 'unknown'
  ok: boolean; effectSent: boolean; beforeWater?: number; success?: number; result?: number; afterSource?: number
}

/** One effect dispatch. Native command callbacks are evidence; empty RCON text is not. */
export async function castSpring(send: (command: string) => Promise<string>, target: SpringTarget): Promise<SpringReceipt> {
  const scoped = context.getStore()
  const requestId = scoped?.requestId ?? randomUUID()
  const key = 'r' + requestId.replaceAll('-', '')
  const base: SpringReceipt = { schema: 1, requestId, storagePath: `${STORAGE} ${key}`, target,
    state: 'not_executed', ok: false, effectSent: false }
  if (!UUID.test(target.actorUuid) || !DIMENSION.test(target.dimension) ||
      ![target.x, target.y, target.z].every(Number.isSafeInteger) ||
      Math.abs(target.x) > 29_999_984 || Math.abs(target.z) > 29_999_984 || target.y < -64 || target.y > 319 ||
      (scoped && scoped.actor.toLowerCase() !== target.actor.toLowerCase())) return base
  const nonce = randomUUID()
  // Hex avoids SNBT's alternate single-quote rendering of JSON string values.
  const identity = createHash('sha256').update(JSON.stringify({ schema: 1, requestId, ...target })).digest('hex')
  const get = (field: string) => send(`data get storage ${STORAGE} ${key}.${field}`)
  async function string(field: string) {
    const raw = await get(field)
    const match = raw.match(/contents:\s*("(?:[^"\\]|\\.)*")\s*$/)
    if (!match) throw new Error('missing_storage_string')
    return JSON.parse(match[1]) as string
  }
  async function number(field: string) {
    const raw = await get(field)
    const match = raw.match(/contents:\s*(-?\d+)(?:[bBsSlL])?\s*$/)
    if (!match) throw new Error('missing_storage_number')
    return Number(match[1])
  }
  async function inspect(field: 'loaded' | 'beforeWater' | 'afterSource', predicate: string) {
    await send(`execute store success storage ${STORAGE} ${key}.${field} byte 1 run execute in ${target.dimension} if ${predicate}`)
    const value = await number(field)
    if (value !== 0 && value !== 1) throw new Error('unconfirmed_block_observation')
    return value
  }
  const point = `${target.x} ${target.y} ${target.z}`
  try {
    // Atomic claim: an interrupted or repeated request can never overwrite its sentinel.
    await send(`execute unless data storage ${STORAGE} ${key} run data modify storage ${STORAGE} ${key} set value ` +
      `{identity:${JSON.stringify(identity)},nonce:${JSON.stringify(nonce)},loaded:-1b,beforeWater:-1b,success:-1b,result:-1,afterSource:-1b}`)
    if (await string('identity') !== identity || await string('nonce') !== nonce) {
      return { ...base, state: 'unknown', reason: 'existing_or_mismatched_receipt', retryAutomatically: false }
    }
    if (await inspect('loaded', `loaded ${point}`) !== 1) return { ...base, reason: 'target_not_loaded' }
    base.beforeWater = await inspect('beforeWater', `block ${point} minecraft:water`)
    if (base.beforeWater === 1) return { ...base, state: 'no_change', reason: 'water_already_present' }
    base.effectSent = true
    try {
      // The outer callbacks also record a definite failure if the body went away or changed dimension.
      await send(`execute store success storage ${STORAGE} ${key}.success byte 1 ` +
        `store result storage ${STORAGE} ${key}.result int 1 run execute as ${target.actorUuid} at @s ` +
        `if dimension ${target.dimension} run setblock ${point} minecraft:water`)
    } catch { /* Read this request's native callback. Never resend the effect. */ }
    base.success = await number('success')
    base.result = await number('result')
    base.afterSource = await inspect('afterSource', `block ${point} minecraft:water[level=0]`)
    if (base.success === 1 && base.result === 1 && base.afterSource === 1) return { ...base, ok: true, state: 'completed' }
    if (base.success === 0 && base.result === 0) return { ...base, state: 'rejected', reason: 'native_command_failed' }
    return { ...base, state: base.afterSource === 1 ? 'effect_observed' : 'unknown', retryAutomatically: false }
  } catch {
    return { ...base, state: base.effectSent ? 'unknown' : 'not_executed', retryAutomatically: false }
  }
}

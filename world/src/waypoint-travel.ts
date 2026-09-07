import type { Waypoint, TravelReceipt } from './gameplay/travel/contracts.ts'
export type { TravelReceipt } from './gameplay/travel/contracts.ts'

const ACTOR = /^(?:[\p{L}\p{N}_]{1,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u
const DIMENSION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
export function createWaypointTravel(send: (command: string) => Promise<string>) {
  const fail = (code: string, summary: string): TravelReceipt => ({ ok: false, code, summary })
  async function request(action: 'location' | 'teleport', actor: string, wp?: Waypoint): Promise<TravelReceipt> {
    if (!ACTOR.test(actor)) return fail('invalid_actor', '请使用有效的登录名或 UUID。')
    if (action === 'teleport' && (!wp || !DIMENSION.test(wp.dim) || ![wp.x, wp.y, wp.z].every(Number.isFinite) ||
      Math.abs(wp.x) > 29_999_984 || Math.abs(wp.z) > 29_999_984 || Math.abs(wp.y) > 2048)) {
      return fail('invalid_waypoint', '传送点坐标或维度无效，请重新记录。')
    }
    const command = action === 'location' ? `qdlocation ${JSON.stringify(actor)}` :
      `qdwarp ${JSON.stringify(actor)} ${JSON.stringify(wp!.dim)} ${wp!.x} ${wp!.y} ${wp!.z}`
    try {
      const output = await send(command)
      const lines = output.split(/\r?\n/).filter(row => row.startsWith('QD_WARP_JSON '))
      if (lines.length !== 1) throw new Error('missing or duplicate marker')
      const result = JSON.parse(lines[0].slice('QD_WARP_JSON '.length))
      if (result.schema !== 1 || result.action !== action || typeof result.ok !== 'boolean' ||
          typeof result.code !== 'string' || typeof result.summary !== 'string') throw new Error('invalid response')
      const matches = actor.includes('-') ? result.actorUuid === actor : typeof result.actor === 'string' && result.actor.toLowerCase() === actor.toLowerCase()
      if (!matches && !(result.ok === false && result.actor === '' && result.actorUuid === '')) throw new Error('wrong actor')
      if (result.ok && (!DIMENSION.test(result.dimension) || ![result.x, result.y, result.z].every(v => typeof v === 'number' && Number.isFinite(v)))) throw new Error('invalid position')
      if (action === 'teleport' && result.ok && (result.code !== 'teleported' || result.dimension !== wp!.dim ||
          Math.abs(result.x - wp!.x) > 3 || Math.abs(result.y - wp!.y) > 5 || Math.abs(result.z - wp!.z) > 3)) throw new Error('destination not confirmed')
      return result
    } catch { return fail('outcome_unknown', '传送通道或回执中断，请查询当前位置，不要自动重发。') }
  }
  return { location: (actor: string) => request('location', actor), teleport: (actor: string, wp: Waypoint) => request('teleport', actor, wp) }
}

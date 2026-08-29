// mc-waypoints.ts —— 传送点簿（2026-08-29 造物主设计「设置传送点+数字传送」）
// 数据落 mcdata/waypoints.json：共享点（系统预设，全员可用）+ 个人点（玩家自记）。
// 序号语义铁律：byIndex(n) 的顺序 = shared 在前 + personal 在后，与命格书「传送阵」
// 页的行序完全一致——书页看到的第 n 项 = 公屏说 n 传去的地方。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Waypoint {
  id: number
  name: string
  x: number
  y: number
  z: number
  /** 维度（现役只有 minecraft:overworld，字段留扩展）。 */
  dim: string
  createdAt: number
}

interface WaypointsFile {
  version: 1
  shared: Waypoint[]
  players: Record<string, Waypoint[]>
}

const PERSONAL_CAP = 10
/** 镜像路径（与 mc-magic 同病同治）：正本在 DATA_DIR（/app/data 卷），mixin/numen
 * 侧读 /mcdata 卷——save() 双写，镜像失败静默（本地测试无此目录）。 */
const MIRROR_PATH = '/mcdata/waypoints.json'

export class WaypointStore {
  private state: WaypointsFile
  private readonly path: string

  constructor(path: string, seedShared: Waypoint[]) {
    this.path = resolve(path)
    this.state = this.load(seedShared)
    this.save() // 构造即落盘（含 /mcdata 镜像）——mixin 侧文件存在才渲染传送阵页
  }

  private load(seedShared: Waypoint[]): WaypointsFile {
    try {
      if (existsSync(this.path)) {
        const f = JSON.parse(readFileSync(this.path, 'utf-8')) as WaypointsFile
        if (f && Array.isArray(f.shared) && f.players) return f
      }
    } catch { /* 损坏重建 */ }
    return { version: 1, shared: seedShared, players: {} }
  }

  private save(): void {
    const body = JSON.stringify(this.state, null, 1)
    try {
      writeFileSync(this.path, body, 'utf-8')
    } catch { /* best effort */ }
    try {
      writeFileSync(MIRROR_PATH, body, 'utf-8')
    } catch { /* 镜像失败不影响正本 */ }
  }

  /** 个人点列表（无则空数组）。 */
  personal(username: string): Waypoint[] {
    return this.state.players[username] ?? []
  }

  /** 共享点列表。 */
  sharedPoints(): Waypoint[] {
    return this.state.shared
  }

  /** 全量序号视图（shared + personal）——书页/数字/名字共用同一顺序。 */
  allFor(username: string): Waypoint[] {
    return [...this.state.shared, ...this.personal(username)]
  }

  byIndex(username: string, n: number): Waypoint | null {
    const list = this.allFor(username)
    return n >= 1 && n <= list.length ? list[n - 1] : null
  }

  /** 按名字找（先个人后共享；模糊包含匹配，返回第一个命中）。 */
  byName(username: string, q: string): Waypoint | null {
    const list = this.allFor(username)
    return list.find((w) => w.name === q) ?? list.find((w) => w.name.includes(q)) ?? null
  }

  /** 记录个人点（站的地方=安全落点）。超上限返回 null。 */
  add(username: string, name: string, x: number, y: number, z: number, dim = 'minecraft:overworld'): Waypoint | null {
    if (!this.state.players[username]) this.state.players[username] = []
    const mine = this.state.players[username]
    if (mine.length >= PERSONAL_CAP) return null
    const id = mine.reduce((m, w) => Math.max(m, w.id), 0) + 1
    const wp: Waypoint = { id, name: name.slice(0, 16), x, y, z, dim, createdAt: Date.now() }
    mine.push(wp)
    this.save()
    return wp
  }

  /** 删个人点（按个人序号，即书页里 personal 段的第 n 项）。 */
  remove(username: string, n: number): Waypoint | null {
    const mine = this.state.players[username] ?? []
    if (n >= 1 && n <= mine.length) {
      const [rm] = mine.splice(n - 1, 1)
      this.save()
      return rm
    }
    return null
  }
}

/** 中文数字 → 阿拉伯（公屏语音说「二」「十二」也收）。 */
export function zhNumberToArabic(s: string): number | null {
  const t = s.trim()
  if (/^[0-9]{1,2}$/.test(t)) return parseInt(t, 10)
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (/^[一二两三四五六七八九十]{1,3}$/.test(t)) {
    if (t === '十') return 10
    if (t.startsWith('十')) return 10 + (map[t[1]] ?? 0)
    if (t.endsWith('十')) return (map[t[0]] ?? 0) * 10
    const parts = t.split('十')
    if (parts.length === 2) return (map[parts[0]] ?? 0) * 10 + (map[parts[1]] ?? 0)
    return map[t] ?? null
  }
  return null
}

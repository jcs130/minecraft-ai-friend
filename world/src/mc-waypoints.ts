// 传送点簿：正本与 UI 镜像分别原子更新；持久菜单使用 shared:id / personal:id。
import { readFileSync, writeFileSync, statSync, openSync, fsyncSync, fchmodSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Waypoint, WaypointRef, WaypointEntry, WaypointStoreStatus, WaypointResolution } from './gameplay/travel/contracts.ts'
export type { Waypoint, WaypointRef, WaypointEntry, WaypointStoreStatus, WaypointResolution } from './gameplay/travel/contracts.ts'

interface WaypointsFile {
  version: 1
  shared: Waypoint[]
  players: Record<string, Waypoint[]>
  /** 已发出 id 的高水位，删除后不复用，防止旧菜单命中新地点。 */
  nextPersonalIds?: Record<string, number>
}
export class WaypointStoreError extends Error {
  constructor(public readonly code: 'unavailable' | 'invalid_data' | 'invalid_input' | 'duplicate_name' | 'write_failed', message: string) {
    super(message)
    this.name = 'WaypointStoreError'
  }
}
const PERSONAL_CAP = 10
const badText = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069§]/u
const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = <T>(v: T): T => structuredClone(v)
function validOwner(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && v.trim() === v && !badText.test(v)
    && !['__proto__', 'constructor', 'prototype'].includes(v)
}
function validateWaypoint(value: unknown, code: 'invalid_data' | 'invalid_input'): asserts value is Waypoint {
  const fail = (field: string): never => { throw new WaypointStoreError(code, `传送点字段不合法：${field}`) }
  if (!record(value)) fail('record')
  const w = value as Waypoint
  if (!Number.isSafeInteger(w.id) || w.id <= 0) fail('id')
  if (typeof w.name !== 'string' || !w.name.trim() || w.name.trim() !== w.name || [...w.name].length > 16 || badText.test(w.name)) fail('name（1–16字，不含控制符）')
  // 只验证数据边界；维度高度、世界边界、碰撞和危险方块必须由实际执行端验证。
  if (![w.x, w.y, w.z].every(Number.isFinite) || Math.abs(w.x) > 30_000_000 || Math.abs(w.z) > 30_000_000 || Math.abs(w.y) > 20_000_000) fail('coordinates')
  if (typeof w.dim !== 'string' || w.dim.length > 128 || !/^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(w.dim)) fail('dimension')
  if (!Number.isSafeInteger(w.createdAt) || w.createdAt < 0) fail('createdAt')
}
function validateFile(value: unknown): WaypointsFile {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.shared) || !record(value.players)) {
    throw new WaypointStoreError('invalid_data', '传送点文件结构或版本不合法')
  }
  const checkList = (list: unknown): Waypoint[] => {
    if (!Array.isArray(list)) throw new WaypointStoreError('invalid_data', '传送点列表不合法')
    const ids = new Set<number>()
    for (const w of list) {
      validateWaypoint(w, 'invalid_data')
      if (ids.has(w.id)) throw new WaypointStoreError('invalid_data', '同一列表的传送点 id 重复')
      ids.add(w.id)
    }
    return list
  }
  checkList(value.shared)
  if (value.nextPersonalIds !== undefined && !record(value.nextPersonalIds)) throw new WaypointStoreError('invalid_data', 'id 高水位不合法')
  const high = (value.nextPersonalIds ?? {}) as Record<string, number>
  for (const [owner, next] of Object.entries(high)) {
    if (!validOwner(owner) || !Number.isSafeInteger(next) || next <= 0) throw new WaypointStoreError('invalid_data', 'id 高水位不合法')
  }
  for (const [owner, list] of Object.entries(value.players)) {
    if (!validOwner(owner)) throw new WaypointStoreError('invalid_data', '传送点归属不合法')
    const max = checkList(list).reduce((n, w) => Math.max(n, w.id), 0)
    if (own(high, owner) && high[owner] <= max) throw new WaypointStoreError('invalid_data', 'id 高水位落后于现有记录')
  }
  // 保留原 id、顺序、同名旧点和额外元数据，不自动删除或改名。
  return clone(value) as unknown as WaypointsFile
}
function atomicWrite(path: string, body: string, mode = 0o600): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', mode)
    // world writes as root, while Minecraft reads UI mirrors as UID 1000.
    // Use an explicit mirror mode even under a restrictive process umask.
    fchmodSync(fd, mode)
    writeFileSync(fd, body, 'utf-8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temp, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch { /* rename 已移走，或临时文件未创建 */ }
  }
}
export class WaypointStore {
  private state: WaypointsFile = { version: 1, shared: [], players: {} }
  private readonly path: string
  private readonly mirrorPath: string | null
  private health: WaypointStoreStatus
  constructor(path: string, seedShared: Waypoint[], options: { mirrorPath?: string | null } = {}) {
    this.path = resolve(path)
    this.mirrorPath = options.mirrorPath === null ? null : resolve(options.mirrorPath ?? '/mcdata/waypoints.json')
    this.health = { available: false, source: 'new', lastWriteOk: null, error: null,
      mirror: { path: this.mirrorPath, ok: null, error: null } }
    let exists = true
    try { statSync(this.path) } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') exists = false
      else { this.failLoad('unreadable', err); return }
    }
    if (exists) {
      let raw: string
      try { raw = readFileSync(this.path, 'utf-8') } catch (err) { this.failLoad('unreadable', err); return }
      try { this.state = validateFile(JSON.parse(raw.replace(/^\uFEFF/, ''))) } catch (err) { this.failLoad('invalid', err); return }
      this.health.available = true
      this.health.source = 'existing'
      this.syncMirror()
      return
    }
    // 只有明确不存在才播种；损坏/不可读的正本及原镜像始终保留。
    this.state = validateFile({ version: 1, shared: seedShared, players: {} })
    try {
      atomicWrite(this.path, JSON.stringify(this.state, null, 1))
      this.health.available = true
      this.health.lastWriteOk = true
      this.syncMirror()
    } catch (err) {
      this.health.lastWriteOk = false
      this.health.error = `无法创建传送点正本：${this.message(err)}`
      console.warn(`[waypoints] ${this.health.error}`)
    }
  }
  private message(err: unknown): string { return err instanceof Error ? err.message : String(err) }
  private failLoad(source: 'invalid' | 'unreadable', err: unknown): void {
    this.health.source = source
    this.health.error = `传送点正本${source === 'invalid' ? '损坏' : '不可读'}，已保留原文件并停用传送点写入：${this.message(err)}`
    console.warn(`[waypoints] ${this.health.error}`)
  }
  private assertAvailable(): void {
    if (!this.health.available) throw new WaypointStoreError('unavailable', this.health.error ?? '传送点簿不可用')
  }
  private assertOwner(username: string): void {
    if (!validOwner(username)) throw new WaypointStoreError('invalid_input', '传送点归属不合法')
  }
  getStatus(): WaypointStoreStatus { return clone(this.health) }
  /** 镜像失败单独报告/重试，不把已提交正本谎报成写入失败。 */
  syncMirror(): boolean {
    this.assertAvailable()
    if (this.mirrorPath === null || this.mirrorPath === this.path) {
      this.health.mirror.ok = true
      this.health.mirror.error = null
      return true
    }
    try {
      atomicWrite(this.mirrorPath, JSON.stringify(this.state, null, 1), 0o644)
      this.health.mirror.ok = true
      this.health.mirror.error = null
      return true
    } catch (err) {
      this.health.mirror.ok = false
      this.health.mirror.error = `传送点正本可用，但菜单镜像更新失败：${this.message(err)}`
      console.warn(`[waypoints] ${this.health.mirror.error}`)
      return false
    }
  }
  private commit(next: WaypointsFile): void {
    this.assertAvailable()
    validateFile(next)
    try { atomicWrite(this.path, JSON.stringify(next, null, 1)) } catch (err) {
      this.health.lastWriteOk = false
      this.health.error = `传送点保存失败，内存及正本未提交：${this.message(err)}`
      throw new WaypointStoreError('write_failed', this.health.error)
    }
    this.state = next
    this.health.lastWriteOk = true
    this.health.error = null
    this.syncMirror()
  }
  personal(username: string): Waypoint[] {
    this.assertAvailable()
    this.assertOwner(username)
    return clone(own(this.state.players, username) ? this.state.players[username] : [])
  }
  sharedPoints(): Waypoint[] { this.assertAvailable(); return clone(this.state.shared) }
  allFor(username: string): Waypoint[] { return [...this.sharedPoints(), ...this.personal(username)] }
  listWithRefs(username: string): WaypointEntry[] {
    return [
      ...this.sharedPoints().map((waypoint, i): WaypointEntry => ({ ref: `shared:${waypoint.id}`, index: i + 1, scope: 'shared', waypoint })),
      ...this.personal(username).map((waypoint, i): WaypointEntry => ({ ref: `personal:${waypoint.id}`, index: this.state.shared.length + i + 1, scope: 'personal', waypoint })),
    ]
  }
  byIndex(username: string, n: number): Waypoint | null {
    if (!Number.isSafeInteger(n) || n < 1) return null
    return this.allFor(username)[n - 1] ?? null
  }
  byRef(username: string, ref: string): Waypoint | null {
    if (!/^(shared|personal):[1-9][0-9]*$/.test(ref)) return null
    return this.listWithRefs(username).find((e) => e.ref === ref)?.waypoint ?? null
  }
  resolve(username: string, query: string): WaypointResolution {
    if (!this.health.available) return { status: 'unavailable' }
    if (typeof query !== 'string' || !query.trim() || badText.test(query)) return { status: 'invalid_query' }
    const q = query.trim()
    const entries = this.listWithRefs(username)
    if (/^(shared|personal):/.test(q)) {
      if (!/^(shared|personal):[1-9][0-9]*$/.test(q)) return { status: 'invalid_query' }
      const entry = entries.find((e) => e.ref === q)
      return entry ? { status: 'found', entry } : { status: 'not_found' }
    }
    if (/^[0-9]+$/.test(q)) {
      const n = Number(q)
      const entry = Number.isSafeInteger(n) && n > 0 ? entries[n - 1] : undefined
      return entry ? { status: 'found', entry } : { status: 'not_found' }
    }
    const exact = entries.filter((e) => e.waypoint.name === q)
    const matches = exact.length ? exact : entries.filter((e) => e.waypoint.name.includes(q))
    return matches.length > 1 ? { status: 'ambiguous', matches }
      : matches.length === 1 ? { status: 'found', entry: matches[0] } : { status: 'not_found' }
  }
  /** 兼容旧调用；歧义时拒绝自动挑第一个，resolve 可提供候选项。 */
  byName(username: string, q: string): Waypoint | null {
    const entries = this.listWithRefs(username)
    if (!q.trim() || badText.test(q)) return null
    const exact = entries.filter((e) => e.waypoint.name === q.trim())
    const matches = exact.length ? exact : entries.filter((e) => e.waypoint.name.includes(q.trim()))
    return matches.length === 1 ? matches[0].waypoint : null
  }
  add(username: string, name: string, x: number, y: number, z: number, dim = 'minecraft:overworld'): Waypoint | null {
    this.assertAvailable()
    this.assertOwner(username)
    const mine = this.personal(username)
    if (mine.length >= PERSONAL_CAP) return null
    const floor = mine.reduce((max, w) => Math.max(max, w.id), 0) + 1
    const high = this.state.nextPersonalIds ?? {}
    const id = Math.max(floor, own(high, username) ? high[username] : 1)
    if (!Number.isSafeInteger(id + 1)) throw new WaypointStoreError('invalid_input', '传送点 id 已达上限')
    const wp: Waypoint = { id, name: typeof name === 'string' ? name.trim() : name, x, y, z, dim, createdAt: Date.now() }
    validateWaypoint(wp, 'invalid_input')
    if (this.allFor(username).some((w) => w.name === wp.name)) throw new WaypointStoreError('duplicate_name', '已有同名传送点，请使用不同名字')
    const next = clone(this.state)
    next.players[username] = [...mine, wp]
    next.nextPersonalIds ??= {}
    next.nextPersonalIds[username] = id + 1
    this.commit(next)
    return clone(wp)
  }
  /** 删除旧个人序号保持兼容；新菜单使用 removeRef。 */
  remove(username: string, n: number): Waypoint | null {
    const mine = this.personal(username)
    if (!Number.isSafeInteger(n) || n < 1 || n > mine.length) return null
    return this.removeRef(username, `personal:${mine[n - 1].id}`)
  }
  removeRef(username: string, ref: string): Waypoint | null {
    const mine = this.personal(username)
    if (!/^personal:[1-9][0-9]*$/.test(ref)) return null
    const at = mine.findIndex((w) => `personal:${w.id}` === ref)
    if (at < 0) return null
    const next = clone(this.state)
    next.nextPersonalIds ??= {}
    next.nextPersonalIds[username] = Math.max(own(next.nextPersonalIds, username) ? next.nextPersonalIds[username] : 1, ...mine.map((w) => w.id + 1))
    const [removed] = mine.splice(at, 1)
    next.players[username] = mine
    this.commit(next)
    return removed
  }
}
/** 标准一至九十九；“十十”等无效词不当成门牌。 */
export function zhNumberToArabic(s: string): number | null {
  const t = s.trim()
  if (/^[0-9]{1,2}$/.test(t)) return Number(t)
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (own(map, t)) return map[t]
  const match = t.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/)
  return match ? (match[1] ? map[match[1]] : 1) * 10 + (match[2] ? map[match[2]] : 0) : null
}

/** 服务端下发的逐区块挖掘权限；A* 同步查缓存，不在搜索热路径发网络请求。 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const BREAK_ACL_CHANNEL = 'corti:break_acl';
/** Paper 1.20.6 Messenger.MAX_MESSAGE_SIZE。 */
const MAX_PACKET_BYTES = 32766;
type Point = readonly [number, number, number];
type Box = readonly [number, number, number, number, number, number];
interface DenyBits { minY: number; height: number; bytes: Buffer }
interface ChunkAcl { revision: number; until: number; cells: Set<string>; boxes: Box[]; bits: DenyBits | null }
interface LearnedCell { dimension: string; x: number; y: number; z: number; type: number; at: number; aclRevision?: number }

const posKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const dimKey = (dimension: string): string => dimension.replace(/^minecraft:/, '');
const chunkKey = (dim: string, cx: number, cz: number): string => `${dim}|${cx},${cz}`;
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Math.abs(n as number) <= 30_000_000;
const point = (v: unknown): v is Point => Array.isArray(v) && v.length === 3 && v.every(integer);
const box = (v: unknown): v is Box => Array.isArray(v) && v.length === 6 && v.every(integer)
  && v[0] <= v[3] && v[1] <= v[4] && v[2] <= v[5];

/** 完整快照中的 denyCells / denyBoxes 是受保护格；其他格沿用原版可挖判据。 */
export class BreakPermissions {
  private chunks = new Map<string, ChunkAcl>();
  private learned = new Map<string, LearnedCell>();
  /** 收到本维度第一份有效快照后，未覆盖/过期区块按权限未知处理，不能自动挖。 */
  private activeDimensions = new Set<string>();
  private lastPruneAt = 0;

  constructor(private readonly file: string | null, private readonly server: string) {
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { server?: string; cells?: LearnedCell[] };
      if (saved.server !== server || !Array.isArray(saved.cells)) return;
      for (const cell of saved.cells.slice(-5000)) {
        if (!point([cell.x, cell.y, cell.z]) || !integer(cell.type)) continue;
        // revision 只在当前连接里有意义；重启后等新快照覆盖旧拒绝。
        this.learned.set(`${dimKey(cell.dimension)}|${posKey(cell.x, cell.y, cell.z)}`,
          { ...cell, aclRevision: undefined });
      }
    } catch { /* 旧缓存损坏不能阻止进服。 */ }
  }

  /** 重连后服务端的 revision 可重新从零开始；本地明确拒绝仍保留。 */
  beginConnection(): void {
    this.chunks.clear();
    this.activeDimensions.clear();
    this.lastPruneAt = 0;
    for (const cell of this.learned.values()) cell.aclRevision = undefined;
  }

  /** Paper 插件 custom_payload JSON；返回 changed 时才需要重新算路。 */
  applyPacket(channel: unknown, data: unknown, now = Date.now()): 'changed' | 'refreshed' | false {
    if (channel !== BREAK_ACL_CHANNEL) return false;
    try {
      const bytes = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : null;
      if (!bytes || bytes.length > MAX_PACKET_BYTES) return false;
      const body = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      if (body.v !== 1 || body.complete !== true || typeof body.dimension !== 'string'
        || !integer(body.chunkX) || !integer(body.chunkZ)
        || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0
        || !Array.isArray(body.denyCells) || body.denyCells.length > 4096
        || !Array.isArray(body.denyBoxes) || body.denyBoxes.length > 512
        || !body.denyCells.every(point) || !body.denyBoxes.every(box)) return false;
      const cx = body.chunkX as number, cz = body.chunkZ as number;
      const inChunk = (x: number, z: number): boolean => Math.floor(x / 16) === cx && Math.floor(z / 16) === cz;
      if (!(body.denyCells as Point[]).every((p) => inChunk(p[0], p[2]))) return false;
      if (!(body.denyBoxes as Box[]).every((b) => inChunk(b[0], b[2]) && inChunk(b[3], b[5]))) return false;
      let bits: DenyBits | null = null;
      if (body.denyBits !== undefined) {
        if (typeof body.denyBits !== 'string' || !integer(body.minY)
          || !Number.isSafeInteger(body.height) || (body.height as number) < 1 || (body.height as number) > 512
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.denyBits)) return false;
        const bytes = Buffer.from(body.denyBits, 'base64');
        if (bytes.length !== Math.ceil((body.height as number) * 256 / 8)
          || bytes.toString('base64') !== body.denyBits) return false;
        bits = { minY: body.minY as number, height: body.height as number, bytes };
      }
      const ttl = typeof body.ttlSec === 'number' && Number.isFinite(body.ttlSec)
        ? Math.min(3600, Math.max(10, body.ttlSec)) : 300;
      if (now - this.lastPruneAt >= 60_000) {
        for (const [key, acl] of this.chunks) if (now >= acl.until) this.chunks.delete(key);
        this.lastPruneAt = now;
      }
      const k = chunkKey(dimKey(body.dimension), cx, cz);
      const previous = this.chunks.get(k);
      if (previous && (body.revision as number) < previous.revision) return false;
      this.activeDimensions.add(dimKey(body.dimension));
      if (previous && (body.revision as number) === previous.revision) {
        const wasExpired = now >= previous.until;
        previous.until = now + ttl * 1000;
        return wasExpired ? 'changed' : 'refreshed';
      }
      this.chunks.set(k, {
        revision: body.revision as number, until: now + ttl * 1000,
        cells: new Set((body.denyCells as Point[]).map((p) => posKey(p[0], p[1], p[2]))),
        boxes: body.denyBoxes as Box[],
        bits,
      });
      return 'changed';
    } catch { return false; }
  }

  /** 服务端权限的同步判定；尚未覆盖的区块不能被当作可挖。 */
  verdict(dimension: string, x: number, y: number, z: number, type: number, now = Date.now()): 'allowed' | 'protected' | 'unknown' {
    const dim = dimKey(dimension);
    const k = `${dim}|${posKey(x, y, z)}`;
    const learned = this.learned.get(k);
    if (learned && learned.type !== type) this.learned.delete(k);
    const acl = this.chunks.get(chunkKey(dim, Math.floor(x / 16), Math.floor(z / 16)));
    if (acl && now < acl.until) {
      if (learned?.type === type && learned.aclRevision === acl.revision) return 'protected';
      if (acl.cells.has(posKey(x, y, z))) return 'protected';
      if (acl.bits) {
        const { minY, height, bytes } = acl.bits;
        if (y < minY || y >= minY + height) return 'unknown';
        const i = (y - minY) * 256 + (z - Math.floor(z / 16) * 16) * 16 + (x - Math.floor(x / 16) * 16);
        if ((bytes[i >>> 3] & (1 << (i & 7))) !== 0) return 'protected';
      }
      return acl.boxes.some((b) => x >= b[0] && y >= b[1] && z >= b[2]
        && x <= b[3] && y <= b[4] && z <= b[5]) ? 'protected' : 'allowed';
    }
    // 只有没有新鲜、完整的服务端快照时，才用先前的明确拒绝兜底。
    if (learned?.type === type) return 'protected';
    return this.activeDimensions.has(dim) ? 'unknown' : 'allowed';
  }

  denied(dimension: string, x: number, y: number, z: number, type: number, now = Date.now()): boolean {
    return this.verdict(dimension, x, y, z, type, now) !== 'allowed';
  }

  /** 只接明确保护拒绝；超时或够不着不是权限证据。 */
  noteDenied(dimension: string, x: number, y: number, z: number, type: number, now = Date.now()): void {
    const dim = dimKey(dimension);
    const acl = this.chunks.get(chunkKey(dim, Math.floor(x / 16), Math.floor(z / 16)));
    const cell: LearnedCell = { dimension: dim, x, y, z, type, at: now,
      aclRevision: acl && now < acl.until ? acl.revision : undefined };
    this.learned.set(`${cell.dimension}|${posKey(x, y, z)}`, cell);
    if (this.learned.size > 5000) this.learned.delete(this.learned.keys().next().value!);
    if (!this.file) return;
    try { writeFileSync(this.file, JSON.stringify({ v: 1, server: this.server, cells: [...this.learned.values()] }), 'utf8'); }
    catch { /* 权限缓存写失败不影响游戏。 */ }
  }

  status(dimension: string): { chunks: number; learned: number; enforced: boolean } {
    const dim = dimKey(dimension);
    return { chunks: [...this.chunks.keys()].filter((k) => k.startsWith(`${dim}|`)).length,
      learned: [...this.learned.keys()].filter((k) => k.startsWith(`${dim}|`)).length,
      enforced: this.activeDimensions.has(dim) };
  }
}

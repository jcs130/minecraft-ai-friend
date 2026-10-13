/** Confirmed temporary support proofs survive action scopes until safe cleanup or explicit promotion. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { dimensionOf, cellKeyOf } from './cell-facts.ts';
import { Aborted, SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import { digBlock } from './travel.ts';
import { equipToolFor } from './tools.ts';
import { invSnapshot, PICKUP_SETTLE_MS } from './inventory.ts';
import { zhName } from './names.ts';
import { canSeeBlockAt } from './terrain.ts';

interface SupportRecord {
  seq: number;
  generation: number;
  dimension: string;
  x: number; y: number; z: number;
  name: string;
  stateId: number;
  invalid: string | null;
  reclaimed: boolean;
  promoted: boolean;
}
interface Tracker {
  seq: number; generation: number; scopes: Set<TemporaryScaffoldScope>;
  pending: Map<string, SupportRecord>; reclaiming: boolean; prepared: Set<TemporaryScaffoldProof>;
  lastNotice: string | null;
}
const trackers = new WeakMap<Bot, Tracker>();
const digGuards = new WeakMap<Bot, { record: SupportRecord; ctx: SkillContext }>();
interface ProofState {
  phase: 'prepared' | 'armed' | 'invalid' | 'closed';
  beforeStateId: number; observedStateId?: number; want: string | null; expiresAt: number;
}
const proofStates = new WeakMap<TemporaryScaffoldProof, ProofState>();
const AIR = new Set(['air', 'cave_air', 'void_air']);
const LIQUIDS = new Set(['water', 'lava', 'bubble_column']);
// These are work bounds for a cleanup pass, not a licence to revisit an older coarse ledger.
const PENDING_LIMIT = 2_048;
const PREPARED_LIMIT = 256;
const PROOF_TTL_MS = 30_000;
const RECLAIM_LIMIT = 16;
const RECLAIM_BUDGET_MS = 5_000;
const FACES = [
  [1, 0, 0, 'east', 'west'], [-1, 0, 0, 'west', 'east'],
  [0, 1, 0, 'up', 'down'], [0, -1, 0, 'down', 'up'],
  [0, 0, 1, 'south', 'north'], [0, 0, -1, 'north', 'south'],
] as const;
type ReadBlock = NonNullable<ReturnType<Bot['blockAt']>>;

function trackerOf(bot: Bot): Tracker {
  let tracker = trackers.get(bot);
  if (tracker) return tracker;
  tracker = { seq: 0, generation: 0, scopes: new Set(), pending: new Map(), reclaiming: false,
    prepared: new Set(), lastNotice: null };
  trackers.set(bot, tracker);
  const records = (): Set<SupportRecord> => new Set([
    ...tracker!.pending.values(), ...[...tracker!.scopes].flatMap((scope) => scope.records),
  ]);
  const invalidate = (reason: string): void => {
    tracker!.generation++;
    for (const record of records()) record.invalid ??= reason;
    for (const proof of tracker!.prepared) invalidateProof(proof);
  };
  bot.on('respawn', () => invalidate('维度或出生位置已重置'));
  bot.on('spawn', () => invalidate('连接状态已重置'));
  bot.on('end', () => invalidate('连接已结束'));
  bot.on('blockUpdate', (_old, next) => {
    if (!next?.position) return;
    const key = cellKeyOf(next.position);
    for (const proof of tracker!.prepared) {
      const state = proofStates.get(proof)!;
      if (Date.now() >= state.expiresAt) { invalidateProof(proof); continue; }
      if (cellKeyOf(proof) !== key) continue;
      if (state.phase === 'prepared' && (next.stateId !== state.beforeStateId
        || (_old && _old.stateId !== next.stateId))) invalidateProof(proof);
      else if (state.phase === 'armed' && state.observedStateId !== undefined && next.stateId !== state.observedStateId) {
        invalidateProof(proof);
      } else if (state.phase === 'armed' && next.stateId !== state.beforeStateId) {
        // The first post-send update can be this placement. Any later replacement
        // before confirmation, even when the original material returns, loses authority.
        if ((state.observedStateId !== undefined && next.stateId !== state.observedStateId)
          || (state.want !== null && next.name !== state.want)) invalidateProof(proof);
        else state.observedStateId = next.stateId;
      }
    }
    for (const record of records()) {
      if (cellKeyOf(record) === key && next.stateId !== record.stateId) record.invalid ??= '方块在放置后发生变化';
    }
  });
  bot.on('chunkColumnUnload', (corner) => {
    for (const proof of tracker!.prepared) {
      if (Math.floor(proof.x / 16) === Math.floor(corner.x / 16)
        && Math.floor(proof.z / 16) === Math.floor(corner.z / 16)) invalidateProof(proof);
    }
    for (const record of records()) {
      if (Math.floor(record.x / 16) === Math.floor(corner.x / 16)
        && Math.floor(record.z / 16) === Math.floor(corner.z / 16)) record.invalid ??= '区块已卸载，无法确认方块连续性';
    }
  });
  return tracker;
}

/** The proof is created before an asynchronous temporary placement and belongs to this bot instance. */
export interface TemporaryScaffoldProof {
  readonly bot: Bot;
  readonly generation: number;
  readonly dimension: string;
  readonly scopes: readonly TemporaryScaffoldScope[];
  readonly x: number; readonly y: number; readonly z: number;
}
export function prepareTemporaryScaffoldPlacement(bot: Bot, before: ReadBlock | null): TemporaryScaffoldProof | null {
  if (!before || !AIR.has(before.name) || !Number.isInteger(before.stateId)) return null;
  const tracker = trackerOf(bot);
  for (const prior of tracker.prepared) if (Date.now() >= proofStates.get(prior)!.expiresAt) invalidateProof(prior);
  if (tracker.prepared.size >= PREPARED_LIMIT) invalidateProof(tracker.prepared.values().next().value!);
  const proof = { bot, generation: tracker.generation, dimension: dimensionOf(bot), scopes: [...tracker.scopes],
    x: before.position.x, y: before.position.y, z: before.position.z };
  proofStates.set(proof, { phase: 'prepared', beforeStateId: before.stateId, want: null,
    expiresAt: Date.now() + PROOF_TTL_MS });
  tracker.prepared.add(proof);
  return proof;
}

function invalidateProof(proof: TemporaryScaffoldProof): void {
  const state = proofStates.get(proof);
  if (state) state.phase = 'invalid';
  trackers.get(proof.bot)?.prepared.delete(proof);
}

export function closeTemporaryScaffoldPlacement(proof: TemporaryScaffoldProof | null): void {
  if (!proof) return;
  const state = proofStates.get(proof);
  if (state) state.phase = 'closed';
  trackers.get(proof.bot)?.prepared.delete(proof);
}

export function hasPreparedTemporaryScaffoldPlacement(bot: Bot, at: { x: number; y: number; z: number }): boolean {
  for (const proof of trackers.get(bot)?.prepared ?? []) {
    const state = proofStates.get(proof)!;
    if (Date.now() >= state.expiresAt) { invalidateProof(proof); continue; }
    if (state.phase === 'prepared' && cellKeyOf(proof) === cellKeyOf(at)) return true;
  }
  return false;
}

/** Call after all awaited preflight/look work, immediately before native placement sends its packet. */
export function armTemporaryScaffoldPlacement(bot: Bot, at: { x: number; y: number; z: number }, want: string | null = null): number {
  const tracker = trackers.get(bot);
  if (!tracker) return 0;
  const now = bot.blockAt(new Vec3(at.x, at.y, at.z));
  let armed = 0;
  for (const proof of tracker.prepared) {
    if (cellKeyOf(proof) !== cellKeyOf(at)) continue;
    const state = proofStates.get(proof)!;
    if (state.phase !== 'prepared') continue;
    if (Date.now() >= state.expiresAt || proof.generation !== tracker.generation || proof.dimension !== dimensionOf(bot)
      || !now || !AIR.has(now.name) || now.stateId !== state.beforeStateId) { invalidateProof(proof); continue; }
    state.phase = 'armed'; state.want = want; armed++;
  }
  return armed;
}

/** Only confirmed air-to-support placements explicitly marked temporary acquire cleanup authority. */
export function recordTemporaryScaffold(bot: Bot, proof: TemporaryScaffoldProof | null, placed: ReadBlock): void {
  if (!proof || proof.bot !== bot) return;
  const state = proofStates.get(proof);
  const authorised = state?.phase === 'armed' && Date.now() < state.expiresAt;
  closeTemporaryScaffoldPlacement(proof);
  if (!authorised || (state!.want !== null && state!.want !== placed.name)
    || AIR.has(placed.name) || placed.name === 'ladder' || placed.name === 'scaffolding'
    || placed.boundingBox !== 'block'
    || !Number.isInteger(placed.stateId)) return;
  if (proof.x !== placed.position.x || proof.y !== placed.position.y || proof.z !== placed.position.z) return;
  const tracker = trackerOf(bot);
  if (proof.generation !== tracker.generation || proof.dimension !== dimensionOf(bot)) return;
  const record: SupportRecord = {
    seq: ++tracker.seq, generation: tracker.generation, dimension: proof.dimension,
    x: placed.position.x, y: placed.position.y, z: placed.position.z,
    name: placed.name, stateId: placed.stateId, invalid: null, reclaimed: false, promoted: false,
  };
  const key = `${record.dimension}:${cellKeyOf(record)}`;
  const previous = tracker.pending.get(key);
  if (previous && !previous.invalid && previous.generation === record.generation
    && previous.stateId === record.stateId && previous.name === record.name) {
    for (const scope of proof.scopes) if (!scope.finished && tracker.scopes.has(scope)
      && !scope.records.includes(previous)) scope.records.push(previous);
    return;
  }
  tracker.pending.set(key, record);
  if (tracker.pending.size > PENDING_LIMIT) {
    const oldest = tracker.pending.values().next().value as SupportRecord;
    oldest.invalid ??= '临时台账容量已满，无法继续确认连续性';
    tracker.pending.delete(`${oldest.dimension}:${cellKeyOf(oldest)}`);
  }
  for (const scope of proof.scopes) if (!scope.finished && tracker.scopes.has(scope)) scope.records.push(record);
}

/** Only strict proofs from this bot instance are exposed; unknown historical placements are absent. */
export function pendingTemporaryScaffolds(bot: Bot): ReadonlyArray<{
  x: number; y: number; z: number; dimension: string; name: string; invalid: string | null;
}> {
  return [...(trackers.get(bot)?.pending.values() ?? [])].map(({ x, y, z, dimension, name, invalid }) =>
    ({ x, y, z, dimension, name, invalid }));
}

/** An explicit building or reusable-route intention permanently removes cleanup authority. */
export function promoteTemporaryScaffold(bot: Bot, cells: Iterable<{ x: number; y: number; z: number } | string>): number {
  const tracker = trackers.get(bot);
  if (!tracker) return 0;
  let promoted = 0;
  for (const cell of cells) {
    const key = `${dimensionOf(bot)}:${typeof cell === 'string' ? cell : cellKeyOf(cell)}`;
    const record = tracker.pending.get(key);
    if (!record) continue;
    record.promoted = true;
    tracker.pending.delete(key);
    promoted++;
  }
  return promoted;
}

export interface TemporaryScaffoldScope {
  readonly bot: Bot;
  readonly records: SupportRecord[];
  finished: boolean;
}
export function beginTemporaryScaffold(bot: Bot): TemporaryScaffoldScope {
  const scope: TemporaryScaffoldScope = { bot, records: [], finished: false };
  trackerOf(bot).scopes.add(scope);
  return scope;
}
export function temporaryScaffoldScopeCount(bot: Bot): number {
  return trackers.get(bot)?.scopes.size ?? 0;
}
export function closeTemporaryScaffold(scope: TemporaryScaffoldScope): void {
  scope.finished = true;
  trackers.get(scope.bot)?.scopes.delete(scope);
}

function retainedReason(bot: Bot, record: SupportRecord, ctx: SkillContext): string | null {
  const tracker = trackerOf(bot);
  if (record.invalid) return record.invalid;
  if (record.generation !== tracker.generation || record.dimension !== dimensionOf(bot)) return '维度或连接已变化';
  if (record.promoted) return '明确保留为建筑或可复用通路';
  if (ctx.intended?.has(cellKeyOf(record))) {
    promoteTemporaryScaffold(bot, [record]);
    return '任务有意保留的落点';
  }
  const block = bot.blockAt(new Vec3(record.x, record.y, record.z));
  if (!block || block.stateId !== record.stateId || block.name !== record.name) return '当前方块身份未确认';
  for (const [dx, dy, dz, direction, back] of FACES) {
    const neighbour = bot.blockAt(new Vec3(record.x + dx, record.y + dy, record.z + dz));
    if (!neighbour) return '相邻方块未加载，无法确认支撑关系';
    if (LIQUIDS.has(neighbour.name) || neighbour.getProperties().waterlogged === true) {
      return '相邻仍有液体，清理可能放出水或岩浆';
    }
    if (dy === 1 && !AIR.has(neighbour.name)) return '上方仍有承重方块或依附物';
    if (dy === 0 && sideAttached(neighbour, direction, back)) return '侧面仍有梯子或其他依附结构';
    if (dy === -1 && ceilingAttached(neighbour)) return '下方仍有悬挂依附结构';
  }
  for (const entity of [bot.entity, ...Object.values(bot.entities)]) {
    if (!entity?.position) continue;
    const p = entity.position;
    const halfWidth = (entity.width ?? 0.6) / 2;
    if (['item_frame', 'glow_item_frame', 'painting', 'leash_knot'].includes(entity.name ?? '')
      && Math.abs(p.x - (record.x + .5)) < 1.5 + halfWidth
      && Math.abs(p.z - (record.z + .5)) < 1.5 + halfWidth
      && Math.abs(p.y - (record.y + .5)) < 1.5 + (entity.height ?? 1) / 2) return '附近仍有物品展示框或其他悬挂实体';
    if (entity !== bot.entity && entity.type !== 'player' && entity.type !== 'mob') continue;
    if (p.x + halfWidth > record.x && p.x - halfWidth < record.x + 1
      && p.z + halfWidth > record.z && p.z - halfWidth < record.z + 1
      && p.y >= record.y && p.y <= record.y + 1.6) return '仍在实体脚下或身位内';
  }
  if (!bot.canDigBlock(block)) return '当前安全站位够不到';
  if (!canSeeBlockAt(bot, record)) return '当前安全站位看不见';
  return null;
}

function sideAttached(block: ReadBlock, direction: string, back: string): boolean {
  const properties = block.getProperties() as Record<string, unknown>;
  if (['vine', 'glow_lichen', 'sculk_vein'].includes(block.name)) return properties[back] === true;
  if (block.name.endsWith('_wall_hanging_sign')) return true;
  const facingSupport = block.name === 'ladder' || block.name === 'tripwire_hook'
    || /wall_(?:torch|sign|banner)$|wall_fan$/.test(block.name);
  const wallMount = (block.name === 'lever' || block.name.endsWith('_button'))
    && (properties.face === 'wall' || properties.face === undefined);
  return (facingSupport || wallMount) && (properties.facing === undefined || properties.facing === direction);
}

function ceilingAttached(block: ReadBlock): boolean {
  const properties = block.getProperties() as Record<string, unknown>;
  return block.name.endsWith('_hanging_sign') || block.name === 'hanging_roots'
    || block.name === 'spore_blossom' || (block.name.endsWith('lantern') && properties.hanging === true)
    || (block.name === 'chain' && properties.axis === 'y')
    || (block.name === 'pointed_dripstone' && properties.vertical_direction === 'down')
    || ((block.name === 'lever' || block.name.endsWith('_button')) && properties.face === 'ceiling');
}

/** Called by the confirmed-dig wrapper after its awaited preflight, before starting native digging. */
export function assertTemporaryScaffoldDigSafe(bot: Bot, block: ReadBlock): void {
  const guard = digGuards.get(bot);
  if (!guard || cellKeyOf(block.position) !== cellKeyOf(guard.record)) return;
  checkAbort(guard.ctx);
  const reason = retainedReason(bot, guard.record, guard.ctx);
  if (reason) throw new SkillBlocked(`临时垫脚清理前再次核验未通过：${reason}`);
}

/** Retry known retained supports from the current position, without pathfinding or new placements. */
export async function reclaimPendingTemporaryScaffold(bot: Bot, ctx: SkillContext): Promise<string> {
  const tracker = trackers.get(bot);
  if (!tracker || tracker.pending.size === 0) return '';
  const scope: TemporaryScaffoldScope = { bot, records: [...tracker.pending.values()], finished: false };
  return reclaimTemporaryScaffold(bot, ctx, scope);
}

/** Reclaim only reachable supports; retained coordinates remain observable without moving or building. */
export async function reclaimTemporaryScaffold(bot: Bot, ctx: SkillContext, scope: TemporaryScaffoldScope): Promise<string> {
  if (scope.bot !== bot || scope.finished) return '';
  checkAbort(ctx);
  const tracker = trackerOf(bot);
  if (tracker.reclaiming) return ';临时垫脚清理已在进行，没有重复开挖';
  const records = scope.records.filter((record) => !record.reclaimed)
    .sort((a, b) => b.y - a.y || b.seq - a.seq);
  if (records.length === 0) { closeTemporaryScaffold(scope); return ''; }
  tracker.reclaiming = true;
  const retained: Array<{ record: SupportRecord; reason: string }> = [];
  const before = invSnapshot(bot);
  const removed: SupportRecord[] = [];
  const removedCounts = new Map<string, number>();
  const inventoryIncrease = (): Array<{ name: string; removed: number; increase: number }> => {
    const after = invSnapshot(bot);
    return [...removedCounts].map(([name, count]) => ({ name, removed: count,
      increase: Math.min(count, Math.max(0, (after.get(name) ?? 0) - (before.get(name) ?? 0))),
    }));
  };
  let reclaimed = 0;
  const deadline = Date.now() + RECLAIM_BUDGET_MS;
  try { for (const record of records) {
    checkAbort(ctx);
    let reason = retainedReason(bot, record, ctx);
    if (!reason && (reclaimed >= RECLAIM_LIMIT || Date.now() >= deadline)) reason = '本轮清理预算已到，留待下次';
    if (!reason) {
      try {
        await equipToolFor(bot, bot.blockAt(new Vec3(record.x, record.y, record.z))!, ctx);
        checkAbort(ctx);
        reason = retainedReason(bot, record, ctx);
        if (!reason) {
          digGuards.set(bot, { record, ctx });
          try { await digBlock(bot, bot.blockAt(new Vec3(record.x, record.y, record.z))!, ctx); }
          finally { digGuards.delete(bot); }
          const after = bot.blockAt(new Vec3(record.x, record.y, record.z));
          if (!after || !AIR.has(after.name)) throw new SkillBlocked('挖掘后没有确认目标变为空气，保留记录');
          record.reclaimed = true;
          const key = `${record.dimension}:${cellKeyOf(record)}`;
          if (tracker.pending.get(key) === record) tracker.pending.delete(key);
          reclaimed++;
          removed.push(record);
          removedCounts.set(record.name, (removedCounts.get(record.name) ?? 0) + 1);
        }
      } catch (err) {
        if (err instanceof Aborted || ctx.aborted()) throw err;
        reason = err instanceof Error ? err.message : String(err);
      }
    }
    if (reason) retained.push({ record, reason });
  }
    if (reclaimed > 0) {
      for (let elapsed = 0; elapsed < PICKUP_SETTLE_MS; elapsed += 100) {
        checkAbort(ctx);
        if (inventoryIncrease().every((item) => item.increase >= item.removed)) break;
        await sleep(100);
      }
    }
  } finally { tracker.reclaiming = false; closeTemporaryScaffold(scope); }
  const increase = inventoryIncrease();
  const pendingPickup = increase.some((item) => item.increase < item.removed)
    ? removed.map(({ x, y, z }) => ({ x, y, z })) : [];
  ctx.diag?.write({ lane: 'skill', event: 'temporary-scaffold-reclaimed',
    msg: `本步临时垫脚拆除 ${reclaimed} 块，保留 ${retained.length} 块`,
    data: { reclaimed, inventoryIncrease: increase, pendingPickup, retained: retained.map(({ record, reason }) => ({
      at: { x: record.x, y: record.y, z: record.z }, dimension: record.dimension, reason,
    })) },
  });
  // Keep every audit entry, but do not repeatedly inject an unchanged retained
  // scene into the model's context on each later cleanup-eligible completion.
  const notice = JSON.stringify({ retained: retained.map(({ record, reason }) => ({
    seq: record.seq, dimension: record.dimension, x: record.x, y: record.y, z: record.z, reason,
  })), inventory: [...invSnapshot(bot)].sort(([a], [b]) => a.localeCompare(b)) });
  const unchanged = reclaimed === 0 && tracker.lastNotice === notice;
  tracker.lastNotice = notice;
  if (unchanged) return '';
  const kept = retained.slice(0, 12).map(({ record, reason }) => `(${record.x},${record.y},${record.z}) ${reason}`).join('；')
    + (retained.length > 12 ? `；另有 ${retained.length - 12} 块留在临时台账` : '');
  const stock = increase.length ? `；背包同名物品净增:${increase.map((item) => `${zhName(item.name)}×${item.increase}`).join('、')}(未单独确认掉落来源)` : '';
  const pending = pendingPickup.length ? `；掉落入包尚未全部确认，拆除处:${pendingPickup.map((p) => `(${p.x},${p.y},${p.z})`).join('、')}` : '';
  return `;本步临时垫脚拆除 ${reclaimed} 块${stock}${pending}${retained.length ? `；保留 ${retained.length} 块:${kept}` : ''}`;
}

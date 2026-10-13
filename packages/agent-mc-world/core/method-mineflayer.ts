/** JSON transport for Mineflayer's public primitives; the executor owns the program's body. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Bot, ControlState } from 'mineflayer';
import { Vec3 } from 'vec3';
import { createHash } from 'node:crypto';
import type { Executor } from './executor.ts';
import { checkAbort, type SkillContext } from './skill-context.ts';
import { breakPermissionNote } from './travel.ts';
import { permitPlacement } from './placement.ts';
import { withPreparedInteractionHand } from './hand-interaction.ts';
import { equipSlotConfirmed, unequipSlotConfirmed } from './equipment.ts';

const nativeCalls = new AsyncLocalStorage<() => void>();
const guarded = new WeakSet<object>();

export const NATIVE_API = Object.freeze({
  read: 'read(path): JSON read of entity, health, food, game, heldItem, inventory.slots, or registry.itemsByName.<id>/blocksByName.<id>. No client, credentials or private fields.',
  blockAt: 'blockAt(point, extraInfos=true): Block|null. Unloaded is null. Block.getProperties() synchronously reads this returned snapshot, preserving native string|number|boolean values. Numeric-looking enum properties may be strings (for example age:"7", level:"0"); inspect their types and explicitly convert only a property known to be numeric before a numeric comparison. Re-read blockAt for current values. A completed read-only program does not prove any block or inventory changed.',
  findBlocks: 'findBlocks({point?,matching,maxDistance?,count?,useExtraInfo?}): Vec3[]. matching is a numeric block id or array of ids; maxDistance 1..32 and count 1..64. Function predicates stay in the program: filter returned blocks there.',
  findBlock: 'findBlock(options): Block|null, with the same options and bounds as findBlocks.',
  canSeeBlock: 'canSeeBlock(block): boolean from Mineflayer visibility, using a fresh block at its position.',
  canDigBlock: 'canDigBlock(block): boolean from Mineflayer reach and diggability; server permission is separately checked when digging.',
  digTime: 'digTime(block): milliseconds for the currently held tool.',
  'inventory.items': 'inventory.items(): current native inventory stacks, including slot and instance identity. Read heldItem or inventory.slots separately for equipment.',
  getControlState: 'getControlState(control): boolean. forward/back/left/right/jump/sprint/sneak.',
  look: 'look(yaw,pitch,force?): Promise<void>. Native radians; no relative angle or automatic navigation.',
  lookAt: 'lookAt(point,force?): Promise<void>. Use Vec3 coordinates.',
  setControlState: 'setControlState(control,state): native key input. Keys remain held across awaited calls in this program; all are released on completion or revocation. Normal collision physics applies; flight uses existing flight/control tools.',
  clearControlStates: 'clearControlStates(): release all native movement keys held by this program.',
  waitForTicks: 'waitForTicks(ticks): native physics ticks, 1..200. Await serially; cancellation revokes the entire program.',
  dig: 'dig(block,forceLook=true,digFace="auto"): native dig with current tool and measured reach; no navigation or automatic tool selection. digFace is auto/raycast or a Vec3 face. Protected, unknown-permission or changed blocks are rejected.',
  stopDigging: 'stopDigging(): interrupt current native digging.',
  placeBlock: 'placeBlock(referenceBlock,faceVector): native server-confirmed placement at reference.position.plus(faceVector). Six cardinal faces only; current held item and normal material permission apply. No automatic equip or navigation; installed World confirmation and retry fixes still apply.',
  equip: 'equip(itemOrNumericType,destination): native inventory equip, using a fresh item instance/slot. Destination hand/head/torso/legs/feet/off-hand; existing inventory synchronization remains active.',
  unequip: 'unequip(destination): native removal; refuses when no inventory space is available, so native toss fallback cannot discard equipment.',
  activateBlock: 'activateBlock(block,direction?,cursorPos?): native right click with the CURRENT hand, default up face and center cursor. Does not clear/equip the hand. Return confirms dispatch only; read actual block/inventory effects.',
  activateItem: 'activateItem(offHand=false): native held-item use (including buckets). Aim with lookAt first. Return confirms dispatch only; re-read world and inventory. Does not clear/equip the hand.',
  deactivateItem: 'deactivateItem(): native release of held use; releasing bow/crossbow/trident can fire it.',
});
type NativeName = keyof typeof NATIVE_API;
const READ_ONLY = new Set<NativeName>(['read', 'blockAt', 'findBlocks', 'findBlock', 'canSeeBlock',
  'canDigBlock', 'digTime', 'inventory.items', 'getControlState']);

export function nativeApiHelp(name?: string): string {
  const lead = 'mc_script 提供 bot 与 Vec3。Mineflayer 4.37.1 公共接口通过 Worker JSON 传输，所有 bot 调用须逐个 await；返回 Block.getProperties() 与 Vec3 运算在 Worker 内同步。属性保留原生 string/number/boolean，不自动转数字；具体见 api:"blockAt"。'
    + ' 首次身体调用排入现有身体队列并独占至程序结束；此后不能再调用 mc.do，防止等待自己的队列。读数不占身体。'
    + ' 取消、战斗/环境接管、死亡、断线或超时均撤销原生程序，不自动重放。可用 api:<方法名> 按需查看签名；缺少的 API 明确不可用。';
  if (name === undefined || name === 'index') return `${lead}\n${Object.keys(NATIVE_API).join(', ')}\n上游文档：https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md`;
  if (!Object.hasOwn(NATIVE_API, name)) throw new Error(`未开放 Mineflayer API ${name}；api:"index" 查看当前入口`);
  return `${lead}\n${name}: ${NATIVE_API[name as NativeName]}`;
}

function point(value: unknown): Vec3 {
  const p = value as { x?: unknown; y?: unknown; z?: unknown } | null;
  if (!p || ![p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 30_000_000)) {
    throw new Error('坐标须为有限 Vec3 {x,y,z}');
  }
  return new Vec3(p.x as number, p.y as number, p.z as number);
}
function block(bot: Bot, value: unknown, fresh = false): NonNullable<ReturnType<Bot['blockAt']>> {
  const supplied = value as { position?: unknown; stateId?: number } | null;
  const current = bot.blockAt(point(supplied?.position));
  if (!current) throw new Error('目标区块未加载');
  if (fresh && supplied?.stateId !== current.stateId) throw new Error('方块状态已变化；先重新 blockAt 再决定');
  return current;
}
function packBlock(b: ReturnType<Bot['blockAt']>): unknown {
  if (!b) return null;
  return { name: b.name, type: b.type, stateId: b.stateId, metadata: b.metadata, position: b.position,
    boundingBox: b.boundingBox, shapes: b.shapes, diggable: b.diggable, hardness: b.hardness,
    properties: b.getProperties(), light: b.light, skyLight: b.skyLight };
}
function itemIdentity(item: NonNullable<Bot['heldItem']>): string {
  return createHash('sha256').update(JSON.stringify([item.type, item.metadata, item.count, item.nbt,
    (item as unknown as { components?: unknown }).components])).digest('hex');
}
function packItem(item: Bot['heldItem']): unknown {
  return item ? { name: item.name, displayName: item.displayName, type: item.type, count: item.count,
    metadata: item.metadata, slot: item.slot, customName: item.customName, enchants: item.enchants,
    durabilityUsed: item.durabilityUsed, instanceHash: itemIdentity(item) } : null;
}
function control(value: unknown): ControlState {
  if (!['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].includes(String(value))) throw new Error('未知控制键');
  return value as ControlState;
}
function destination(value: unknown): 'hand' | 'head' | 'torso' | 'legs' | 'feet' | 'off-hand' {
  if (value == null) return 'hand';
  if (!['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'].includes(String(value))) throw new Error('未知装备槽');
  return value as ReturnType<typeof destination>;
}
function face(value: unknown): Vec3 {
  const p = point(value);
  if (![p.x, p.y, p.z].every(n => [-1, 0, 1].includes(n)) || Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) !== 1) throw new Error('faceVector 须为六个正交单位方向之一');
  return p;
}

/** A lazy body lease spans native calls and is revoked with the originating method. */
export class MineflayerMethod {
  private readonly connectionBot: Bot | null;
  private body: Promise<{ bot: Bot; ctx: SkillContext }> | null = null;
  private release: (() => void) | null = null;
  private taskId: number | null = null;
  private terminalError: Error | null = null;
  constructor(private readonly opts: { executor: Executor; name: string; signal: AbortSignal;
    getBot(): Bot | null; successful(): boolean; revoke(reason: string): void; beforeEnqueue(): void }) {
    this.connectionBot = opts.getBot();
    opts.signal.addEventListener('abort', () => {
      this.release?.();
      if (!opts.successful() && !this.terminalError && this.taskId !== null) opts.executor.cancelTask(this.taskId, '原生程序权限撤销');
    }, { once: true });
  }
  get ownsBody(): boolean { return this.body !== null; }
  private acquire(): Promise<{ bot: Bot; ctx: SkillContext }> {
    if (this.body) return this.body;
    let enter!: (owner: { bot: Bot; ctx: SkillContext }) => void;
    let fail!: (error: Error) => void;
    this.body = new Promise((resolve, reject) => { enter = resolve; fail = reject; });
    const untilFinished = new Promise<void>(resolve => { this.release = resolve; });
    this.opts.beforeEnqueue();
    this.taskId = this.opts.executor.enqueueProgram({ name: this.opts.name,
      run: async (bot, ctx) => {
        const revoke = () => this.opts.revoke('原生程序的连接、位置或身体状态已变化');
        const events = ['end', 'death', 'respawn', 'forcedMove'] as const;
        for (const event of events) bot.on(event, revoke);
        try { enter({ bot, ctx }); await untilFinished; }
        finally { for (const event of events) bot.off(event, revoke); }
      },
      cancel: reason => {
        if (this.terminalError) return;
        this.terminalError = new Error(reason);
        fail(this.terminalError); this.release?.(); this.opts.revoke(reason);
      } });
    return this.body;
  }
  async call(name: string, args: unknown[]): Promise<unknown> {
    if (!Object.hasOwn(NATIVE_API, name)) throw new Error(`未开放 Mineflayer API ${name}`);
    this.opts.signal.throwIfAborted();
    if (this.terminalError) throw this.terminalError;
    const owner = READ_ONLY.has(name as NativeName) ? null : await this.acquire();
    const bot = owner?.bot ?? this.opts.getBot();
    if (!bot || bot !== this.connectionBot || bot !== this.opts.getBot()) throw new Error('Minecraft 连接已变化');
    const active = () => {
      this.opts.signal.throwIfAborted();
      if (owner) checkAbort(owner.ctx);
      if (bot !== this.opts.getBot()) throw new Error('Minecraft 连接已变化');
    };
    active();
    if (!guarded.has(bot._client)) {
      const original = bot._client.write;
      bot._client.write = function (...packet: Parameters<typeof original>) {
        nativeCalls.getStore()?.(); return original.apply(this, packet);
      };
      guarded.add(bot._client);
    }
    const value = await nativeCalls.run(active, async () => {
      const value = await this.invoke(bot, owner?.ctx, name as NativeName, args);
      active();
      return value ?? null;
    });
    return { value, taskId: this.taskId, sampledAt: new Date().toISOString(), nativeMethod: name };
  }
  private async invoke(bot: Bot, ctx: SkillContext | undefined, name: NativeName, args: unknown[]): Promise<unknown> {
    const [a, b, c] = args;
    switch (name) {
      case 'read': {
        if (a === 'entity') return bot.entity ? { id: bot.entity.id, position: bot.entity.position,
          velocity: bot.entity.velocity, yaw: bot.entity.yaw, pitch: bot.entity.pitch, onGround: bot.entity.onGround } : null;
        if (a === 'health') return bot.health;
        if (a === 'food') return bot.food;
        if (a === 'game') return bot.game;
        if (a === 'heldItem') return packItem(bot.heldItem);
        if (a === 'inventory.slots') return bot.inventory.slots.map(packItem);
        const path = String(a).match(/^registry\.(itemsByName|blocksByName)\.([a-z0-9_]+)$/);
        if (!path) throw new Error('read 仅支持 api:"read" 列出的公开字段');
        return (bot.registry[path[1] as 'itemsByName' | 'blocksByName'] as Record<string, unknown>)[path[2]] ?? null;
      }
      case 'blockAt': return packBlock(bot.blockAt(point(a), b === undefined ? true : Boolean(b)));
      case 'findBlock': case 'findBlocks': {
        const options = a as { point?: unknown; matching?: unknown; maxDistance?: number; count?: number; useExtraInfo?: boolean } | null;
        const matching = Array.isArray(options?.matching) ? options.matching : [options?.matching];
        if (matching.length < 1 || matching.length > 64 || !matching.every(id => Number.isInteger(id) && Number(id) >= 0)) throw new Error('matching 须为方块数字 ID 或 ID 数组');
        const maxDistance = options?.maxDistance ?? 16, count = options?.count ?? 1;
        if (!Number.isInteger(maxDistance) || maxDistance < 1 || maxDistance > 32 || !Number.isInteger(count) || count < 1 || count > 64) throw new Error('搜索范围或数量超出 api 契约');
        const query = { matching: matching as number[], maxDistance, count,
          ...(options?.point === undefined ? {} : { point: point(options.point) }), useExtraInfo: options?.useExtraInfo === true };
        return name === 'findBlock' ? packBlock(bot.findBlock(query)) : bot.findBlocks(query);
      }
      case 'canSeeBlock': return bot.canSeeBlock(block(bot, a));
      case 'canDigBlock': return bot.canDigBlock(block(bot, a));
      case 'digTime': return bot.digTime(block(bot, a));
      case 'inventory.items': return bot.inventory.items().map(packItem);
      case 'getControlState': return bot.getControlState(control(a));
      case 'look':
        if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b) || Math.abs(b) > Math.PI / 2) throw new Error('look 要有限弧度与有效 pitch');
        return bot.look(a, b, c === true);
      case 'lookAt': return bot.lookAt(point(a), b === true);
      case 'setControlState':
        if (typeof b !== 'boolean') throw new Error('控制键状态须为布尔值');
        if (!bot.physicsEnabled) throw new Error('普通物理未启用；飞行控制使用现有 flight/control 入口');
        return bot.setControlState(control(a), b);
      case 'clearControlStates': return bot.clearControlStates();
      case 'waitForTicks':
        if (!Number.isInteger(a) || Number(a) < 1 || Number(a) > 200) throw new Error('ticks 须为1..200');
        return bot.waitForTicks(a as number);
      case 'dig': {
        const target = block(bot, a, true), permission = breakPermissionNote(bot, target);
        if (permission) throw new Error(permission);
        if (!bot.canDigBlock(target)) throw new Error('Mineflayer.canDigBlock 为 false；未导航或开挖');
        if (b !== undefined && typeof b !== 'boolean' && b !== 'ignore') throw new Error('forceLook 须为布尔值或 ignore');
        const digFace = c === undefined || c === 'auto' || c === 'raycast' ? c : face(c);
        return bot.dig(target, (b ?? true) as boolean | 'ignore', (digFace ?? 'auto') as 'auto' | 'raycast' | Vec3);
      }
      case 'stopDigging': return bot.stopDigging();
      case 'placeBlock': {
        const target = block(bot, a, true), direction = face(b), held = bot.heldItem;
        if (!held) throw new Error('主手没有放置材料');
        const permit = permitPlacement(ctx!, held.name, false, target.position.plus(direction));
        if (!permit.ok) throw new Error(permit.reason);
        let placed = false;
        try { await bot.placeBlock(target, direction); placed = true; }
        finally { await permit.finish(placed); }
        return null;
      }
      case 'equip': {
        const slot = typeof a === 'object' && a !== null ? (a as { slot?: number }).slot : undefined;
        const item = typeof a === 'number' ? a : bot.inventory.slots[slot ?? -1];
        if (typeof a !== 'number' && (!item || (a as { instanceHash?: string }).instanceHash !== itemIdentity(item as NonNullable<Bot['heldItem']>))) throw new Error('物品槽位或实例已变化；先重新读取 inventory.items');
        if (typeof item === 'number' && (!Number.isInteger(item) || !bot.registry.items[item])) throw new Error('未知物品数字 ID');
        const dest = destination(b);
        const stack = typeof item === 'number'
          ? bot.inventory.items().find(candidate => candidate.type === item) : item;
        if (!stack) throw new Error('当前库存没有该物品实例');
        return dest === 'hand' ? bot.equip(stack, dest) : equipSlotConfirmed(bot, stack, dest);
      }
      case 'unequip':
        if (!bot.inventory.slots.slice(9, 45).some(slot => slot === null)) throw new Error('背包没有空格；未调用可能丢物的原生 unequip');
        return destination(a) === 'hand' ? bot.unequip('hand') : unequipSlotConfirmed(bot, destination(a) as Exclude<ReturnType<typeof destination>, 'hand'>);
      case 'activateBlock': {
        const target = block(bot, a, true), direction = b === undefined ? undefined : face(b), cursor = c === undefined ? undefined : point(c);
        if (cursor && [cursor.x, cursor.y, cursor.z].some(n => n < 0 || n > 1)) throw new Error('cursorPos 须在方块的0..1范围内');
        return withPreparedInteractionHand(bot, () => bot.activateBlock(target, direction, cursor));
      }
      case 'activateItem':
        if (a !== undefined && typeof a !== 'boolean') throw new Error('offHand 须为布尔值');
        return bot.activateItem(a as boolean | undefined);
      case 'deactivateItem': return bot.deactivateItem();
    }
  }
}

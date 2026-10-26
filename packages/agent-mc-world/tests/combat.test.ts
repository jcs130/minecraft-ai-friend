import { installDeathLifecycle } from '../core/death-lifecycle.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CombatSession, footingAhead, type CombatTuning } from '../core/combat.ts';
import type { CombatRangedActions } from '../core/combat.ts';
import { BowController, type RangedTarget } from '../core/ranged.ts';
import { MinecraftLog } from '../core/log.ts';
import { Executor, type TaskReport } from '../core/executor.ts';
import { skillEat } from '../core/skills-craft.ts';
import { skillAttack } from '../core/melee.ts';
import type { CombatResult } from '../core/combat-observation.ts';
import type { Logger } from '../src/client/contracts.ts';

const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as unknown as Logger;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function sleep(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function waitUntil(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitUntil 超时');
    await sleep(10);
  }
}

interface FakeFoe {
  id: number;
  name: string;
  isValid: boolean;
  position: Vec3;
  height: number;
  width: number;
  velocity: { x: number; y: number; z: number };
  metadata?: unknown[];
}

function foe(id: number, name: string, x: number, z = 0.5): FakeFoe {
  return { id, name, isValid: true, position: new Vec3(x, 64, z), height: 1.95, width: 0.6, velocity: { x: 0, y: 0, z: 0 } };
}

/** 平地上的战斗假 bot:实体表、方向键、可控血量;physicsTick 由测试手动发 */
function combatRigBot(foes: FakeFoe[] = []) {
  const bot = new EventEmitter() as unknown as Record<string, unknown> & EventEmitter;
  const attacks: number[] = [];
  const controls: Record<string, boolean> = {};
  bot.entity = {
    id: 1, position: new Vec3(0.5, 64, 0.5), yaw: 0,
    velocity: new Vec3(0, 0, 0), onGround: true,
  };
  bot.health = 20;
  bot.entities = Object.fromEntries(foes.map((f) => [f.id, f]));
  bot.heldItem = { name: 'iron_sword' };
  bot.inventory = { items: () => [{ name: 'iron_sword', type: 1, count: 1 }], slots: [] as unknown[] };
  bot.registry = { entitiesByName: { piglin: { metadataKeys: ['flags', 'baby'] } } };
  bot.equip = async () => {};
  bot.lookAt = async () => {};
  bot.attack = (e: { id: number }) => { attacks.push(e.id); };
  bot.setControlState = (k: string, v: boolean) => { controls[k] = v; };
  bot.controlState = controls;
  bot.blockAt = (p: { y: number }) => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty',
    getProperties: () => ({}), shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [] });
  bot.world = { raycast: () => null };
  bot.pathfinder = { setGoal: () => {} };
  return { bot: bot as never, attacks, controls };
}

function rig(
  bot: unknown,
  over: Partial<CombatTuning> = {},
  diag?: MinecraftLog,
  ranged?: CombatRangedActions,
  onLowHealth?: (bot: Bot) => void,
) {
  const events: Array<{ text: string; urgent: boolean }> = [];
  const combatReports: CombatResult[] = [];
  const calls = { suspended: 0, resumed: 0, suspendedBy: [] as string[] };
  let envBusy = false;
  let taskEscaping = false;
  let taskFighting = false;
  const session = new CombatSession({
    diag,
    getBot: () => bot as never,
    tuning: () => ({
      enabled: true, engageRadius: 3, chaseMax: 6, maxSec: 30, space: 2.6,
      busyRatio: 60, cooldownSec: 60, fleeHealth: 10, fight: 'auto', ...over,
    }),
    envBusy: () => envBusy,
    taskEscaping: () => taskEscaping,
    taskFighting: () => taskFighting,
    suspendTasks: (by) => { calls.suspended++; calls.suspendedBy.push(by); },
    resumeTasks: () => { calls.resumed++; return '刚才做到一半的任务#1 接着做(第 1 步:去坐标)'; },
    emit: (text, urgent) => events.push({ text, urgent }),
    onLowHealth,
    report: result => combatReports.push(result),
    ranged,
    log,
  });
  return {
    session, events, calls, combatReports,
    setEnvBusy: (v: boolean) => { envBusy = v; },
    setTaskEscaping: (v: boolean) => { taskEscaping = v; },
    setTaskFighting: (v: boolean) => { taskFighting = v; },
  };
}

function rangedRig() {
  const shots: Array<{ target: RangedTarget; ownerToken: unknown }> = [];
  let aborts = 0;
  let active = false;
  const actions: CombatRangedActions = {
    ready: () => true,
    active: () => active,
    shoot: async (target, ownerToken) => {
      shots.push({ target, ownerToken });
      return { kind: 'blocked', reason: 'aborted', cause: 'busy' };
    },
    abort: () => { aborts += 1; active = false; },
  };
  return {
    actions,
    shots,
    get aborts() { return aborts; },
    setActive(value: boolean) { active = value; },
  };
}

/** 每拍先发 physicsTick,再推进同一时钟上的定时器与 Date。 */
async function drive(bot: EventEmitter, ms: number, stepMs = 50): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    bot.emit('physicsTick');
    await sleep(stepMs);
  }
}

describe('combat death and respawn boundary', () => {
  it('does not reopen combat on the dead body during the 250ms watch or count respawn as escape', async () => {
    const enemy=foe(7,'zombie',2.5),{bot,controls}=combatRigBot([enemy]),b=bot as any;
    b.respawn=()=>{};
    const lifecycle=installDeathLifecycle(b,4000,()=>true);
    const {session,combatReports,calls,events}=rig(bot,{arena:true});
    try{
      session.start();await drive(bot,300);
      expect(session.active).toBe(true);
      b.health=0;bot.emit('death');
      expect(combatReports).toHaveLength(1);
      const episode=b.deathLifecycle.episodeId;
      expect(combatReports[0]).toMatchObject({reason:'death',healthAfter:0,deathEpisodeId:episode});
      await drive(bot,1000);
      expect(session.onHurtBy(7,'zombie')).toBe(false); // delayed lethal hit
      expect(session.active).toBe(false);
      expect(calls.suspended).toBe(1);
      b.health=26;await drive(bot,300); // health can precede native spawn
      expect(session.active).toBe(false);
      b.entities={};b.entity.position=new Vec3(1463,64,0.5);
      bot.emit('respawn');bot.emit('spawn');await drive(bot,2000);
      expect(combatReports).toHaveLength(1);
      expect(events.some(e=>/跑开了|撤出来了|血只剩 0/.test(e.text))).toBe(false);
      expect(calls.resumed).toBe(0);
      expect(Object.values(controls).some(Boolean)).toBe(false);
      const fresh=foe(9,'zombie',1465);b.entities={9:fresh};
      expect(session.onHurtBy(9,'zombie')).toBe(true);
      session.stop();
      expect(combatReports[1]).toMatchObject({healthBefore:26,reason:'gone'});
      expect(combatReports[1].deathEpisodeId).toBeUndefined();
    }finally{session.stop();lifecycle.dispose();}
  });

  it.each(['zero','pending-positive'] as const)('rejects all combat admissions for %s body state',async mode=>{
    const {bot}=combatRigBot([foe(7,'zombie',2.5)]),b=bot as any;
    b.health=mode==='zero'?0:26;
    if(mode==='pending-positive')b.deathLifecycle={episodeId:'pending',phase:'respawn_pending',observedAt:new Date().toISOString(),respawnAt:null};
    const {session,calls,events,combatReports}=rig(bot,{arena:true});
    try{
      session.start();await drive(bot,600);
      expect(session.engagementTargets()).toEqual([]);
      expect(session.trackingTargets()).toEqual([]);
      expect(session.canRetreat()).toBe(false);
      expect(session.react({kind:'retreat'})).toBe(false);
      expect(session.react({kind:'engage',targetId:7})).toBe(false);
      expect(session.onHurtBy(7,'zombie')).toBe(false);
      expect(session.active).toBe(false);
      expect(calls.suspended).toBe(0);expect(calls.resumed).toBe(0);
      expect(combatReports).toEqual([]);expect(events).toEqual([]);
    }finally{session.stop();}
  });

  it('settles a lethal health sample before the native death event once, without a success or task resume',async()=>{
    const {bot}=combatRigBot([foe(7,'zombie',2.5)]),b=bot as any;
    const {session,calls,combatReports,events}=rig(bot);
    try{
      b.health=9;session.onHurtBy(7,'zombie');await drive(bot,200);
      b.health=0;await drive(bot,100);
      expect(session.active).toBe(false);
      expect(combatReports).toHaveLength(1);
      expect(combatReports[0]).toMatchObject({reason:'death',healthBefore:9,healthAfter:0});
      bot.emit('death');await drive(bot,100);
      expect(combatReports).toHaveLength(1);expect(calls.resumed).toBe(0);
      expect(events.some(e=>/跑开了|撤出来了/.test(e.text))).toBe(false);
    }finally{session.stop();}
  });

  it('does not lend a new alive death episode to an old retreat if native death delivery was missed',async()=>{
    const {bot}=combatRigBot([foe(7,'zombie',2.5)]),b=bot as any;
    b.health=9;
    const {session,combatReports,calls,events}=rig(bot);
    try{
      session.onHurtBy(7,'zombie');await drive(bot,300);
      b.deathLifecycle={episodeId:'next-life',phase:'alive',observedAt:new Date().toISOString(),respawnAt:null};
      b.health=26;b.entities={};b.entity.position=new Vec3(1463,64,0.5);
      await drive(bot,2000);
      expect(combatReports).toHaveLength(1);
      expect(combatReports[0]).toMatchObject({reason:'death',deathEpisodeId:'next-life',healthBefore:9,healthAfter:0});
      expect(combatReports[0].controlSummary?.retreat?.movement.observedHorizontalDistance).toBe(0);
      expect(calls.resumed).toBe(0);
      expect(events.some(e=>/跑开了|撤出来了/.test(e.text))).toBe(false);
    }finally{session.stop();}
  });

  it.each(['missing-entity','unknown-health'] as const)('keeps %s and connection loss distinct from a witnessed death',async mode=>{
    const {bot}=combatRigBot([foe(7,'zombie',2.5)]),b=bot as any;
    const {session,combatReports,calls}=rig(bot);
    try{
      session.onHurtBy(7,'zombie');
      if(mode==='missing-entity')b.entity=null;else b.health=undefined;
      session.onConnectionLost();
      expect(combatReports).toHaveLength(1);
      expect(combatReports[0].reason).toBe('gone');
      expect(combatReports[0].deathEpisodeId).toBeUndefined();
      expect(calls.resumed).toBe(0);
    }finally{session.stop();}
  });

  it.each(['requestStop','standDown'] as const)('does not acknowledge %s as a retreat on a terminal body',method=>{
    const {bot}=combatRigBot([foe(7,'zombie',2.5)]),b=bot as any;
    const {session,combatReports,calls,events}=rig(bot);
    try{
      session.onHurtBy(7,'zombie');b.health=0;
      expect(session.reactionState()).toMatchObject({canStep:false,targetId:null,retreating:false});
      expect(session[method]()).toBeNull();
      expect(combatReports).toHaveLength(1);
      expect(combatReports[0].reason).toBe('death');
      expect(calls.resumed).toBe(0);
      expect(events.some(e=>/跑开了|撤出来了|先不打了/.test(e.text))).toBe(false);
    }finally{session.stop();}
  });
});

describe('战斗补给', () => {
  it('tracks proactively, keeps the chosen range on physics ticks and never swings until told to engage', async () => {
    const enemy = foe(7, 'zombie', 10), { bot, controls, attacks } = combatRigBot([enemy]);
    const { session, calls } = rig(bot, { chaseMax: 12 });
    const track = { kind: 'track' as const, targetId: 7, uuid: null, minDistance: 5, maxDistance: 8, leaseMs: 4000 };
    session.start();
    expect(session.react(track)).toBe(true);
    await drive(bot, 300);
    expect(session.tracking).toBe(true); expect(attacks).toEqual([]);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(true);
    enemy.position.x = 7;
    await drive(bot, 200);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(false);
    enemy.position.x = 3;
    await drive(bot, 200);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(true);
    expect(attacks).toEqual([]); expect(calls.suspended).toBe(1);
    expect(session.react(track)).toBe(true); expect(calls.suspended).toBe(1);
    enemy.position = new Vec3(.5, 64, 3);
    expect(session.react({ kind: 'engage', targetId: 7 })).toBe(true);
    bot.entity.velocity.y = -.1; // Simulate the descent phase of the native jump-attack controller.
    await drive(bot, 800);
    expect(session.fighting).toBe(true); expect(attacks).toContain(7);
    session.stop();
  });

  it.each(['expired', 'identity', 'unseen', 'unloaded', 'neutral'])('ends or holds tracking safely when %s instead of chasing or attacking', async change => {
    const enemy = foe(7, 'zombie', 10), { bot, controls, attacks } = combatRigBot([enemy]);
    const { session, calls } = rig(bot, { chaseMax: 12 });
    session.start();
    expect(session.react({ kind: 'track', targetId: 7, uuid: null, minDistance: 5, maxDistance: 8, leaseMs: 500 })).toBe(true);
    if (change === 'identity') Object.assign(enemy, { uuid: 'replacement-entity' });
    if (change === 'unseen') bot.world.raycast = (() => ({})) as never;
    if (change === 'unloaded') bot.blockAt = (() => null) as never;
    if (change === 'neutral') enemy.name = 'cow';
    await drive(bot, change === 'expired' ? 550 : 100);
    expect(attacks).toEqual([]);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(false);
    if (change !== 'unloaded') { expect(session.active).toBe(false); expect(calls.resumed).toBe(1); }
    session.stop();
  });

  it('withdraws before being hit and does not convert tracking into a duplicate hit-triggered fight', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 5)]), { session, calls } = rig(bot);
    session.start();
    expect(session.react({ kind: 'retreat' })).toBe(true);
    await drive(bot, 150);
    expect(session.reactionState().retreating).toBe(true); expect(attacks).toEqual([]);
    expect(calls.suspended).toBe(1); session.stop();
    const r = combatRigBot([foe(7, 'zombie', 5)]), c = rig(r.bot);
    c.session.start();
    expect(c.session.react({ kind: 'track', targetId: 7, uuid: null, minDistance: 5, maxDistance: 8, leaseMs: 4000 })).toBe(true);
    expect(c.session.onHurtBy(7, 'zombie')).toBe(true);
    expect(c.session.reactionState().retreating).toBe(true); expect(c.calls.suspended).toBe(1);
    await drive(r.bot, 300); expect(r.attacks).toEqual([]); c.session.stop();
  });

  it('authoritative incapacitation stops attacks and movement without claiming a stuck route or resuming tasks', async () => {
    const {bot,controls,attacks}=combatRigBot([foe(7,'zombie',3)]);
    const {session,calls,combatReports,setEnvBusy}=rig(bot);
    session.start(); session.onHurtBy(7,'zombie');
    await drive(bot,500);
    setEnvBusy(true); session.inhibit();
    const count=attacks.length;
    await drive(bot,2000);
    expect(session.active).toBe(false);
    expect(attacks).toHaveLength(count);
    expect(Object.values(controls).every(value=>!value)).toBe(true);
    expect(calls.resumed).toBe(0);
    expect(combatReports.at(-1)?.reason).toBe('inhibited');
    expect(session.react({kind:'engage',targetId:7})).toBe(false);
    setEnvBusy(false);
    expect(session.onHurtBy(7,'zombie')).toBe(true);
    expect(session.active).toBe(true);
    session.stop();
  });
  it('副手空着时补备用图腾，已持盾时保留盾牌', async () => {
    const first = combatRigBot([foe(7, 'zombie', 3)]);
    const bag = [{ name: 'iron_sword', type: 1, count: 1 },
      { name: 'totem_of_undying', type: 2, count: 2 }];
    const slots = Array.from({ length: 46 }, () => null as { name: string } | null);
    (first.bot as any).inventory = { items: () => bag, slots };
    (first.bot as any).equip = async (item: { name: string }, dest: string) => {
      if (dest === 'off-hand') {
        slots[45] = { name: item.name };
        bag[1].count -= 1;
      }
    };
    const a = rig(first.bot);
    a.session.onHurtBy(7, 'zombie');
    await drive(first.bot, 300);
    expect(slots[45]).toEqual({ name: 'totem_of_undying' });
    expect(bag[1].count).toBe(1);
    slots[45] = null; // 第一枚图腾被消耗
    await drive(first.bot, 5_100);
    expect(slots[45]).toEqual({ name: 'totem_of_undying' });
    expect(bag[1].count).toBe(0);
    a.session.stop();

    const second = combatRigBot([foe(8, 'skeleton', 3)]);
    const shieldSlots = Array.from({ length: 46 }, () => null as { name: string } | null);
    shieldSlots[45] = { name: 'shield' };
    const shieldBag = [{ name: 'iron_sword', type: 1, count: 1 },
      { name: 'totem_of_undying', type: 2, count: 1 }];
    (second.bot as any).inventory = { items: () => shieldBag, slots: shieldSlots };
    const equip = vi.fn(async (_item: { name: string }, _dest: string) => {});
    (second.bot as any).equip = equip;
    const b = rig(second.bot);
    b.session.onHurtBy(8, 'skeleton');
    await drive(second.bot, 300);
    expect(shieldSlots[45]?.name).toBe('shield');
    expect(equip.mock.calls.some(([, dest]) => dest === 'off-hand')).toBe(false);
    b.session.stop();
  });

  it('远离近身与远程压制后进食，库存减少并恢复武器', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 9)]);
    const bag = [{ name: 'iron_sword', type: 1, count: 1 }, { name: 'bread', type: 2, count: 2 }];
    (bot as any).food = 12;
    (bot as any).health = 15;
    (bot as any).inventory = { items: () => bag, slots: Array(46).fill(null) };
    (bot as any).registry.foodsByName = { bread: { foodPoints: 5 } };
    (bot as any).equip = async (item: { name: string }) => { (bot as any).heldItem = item; };
    (bot as any).consume = async () => {
      await sleep(1_600);
      bag[1].count -= 1;
      (bot as any).food = 17;
    };
    (bot as any).deactivateItem = () => {};
    const { session, events } = rig(bot);
    session.onHurtBy(7, 'zombie');
    await drive(bot, 2_400);
    expect(bag[1].count).toBe(2);
    await drive(bot, 2_100);
    expect(bag[1].count).toBe(1);
    expect((bot as any).heldItem.name).toBe('iron_sword');
    expect(events.some((event) => event.text.includes('吃了一个面包'))).toBe(true);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it('战斗空档能吃副手口粮，满包交换后恢复武器且不丢物品', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 9)]);
    const sword = { name: 'iron_sword', type: 1, count: 1 };
    const bread = { name: 'bread', type: 2, count: 2 };
    const bag = [sword, ...Array.from({ length: 35 }, () => ({ name: 'cobblestone', type: 3, count: 64 }))];
    const slots = Array(46).fill(null);
    slots[45] = bread;
    Object.assign(bot, { food: 12, health: 15, heldItem: sword, inventory: { items: () => bag, slots } });
    (bot as any).registry.foodsByName = { bread: { foodPoints: 5 } };
    (bot as any).equip = async (item: typeof sword) => {
      if (item === slots[45]) {
        slots[45] = bag[0];
        bag[0] = item;
      }
      (bot as any).heldItem = item;
    };
    (bot as any).consume = async () => {
      await sleep(1_600);
      bread.count -= 1;
      (bot as any).food = 17;
    };
    (bot as any).deactivateItem = () => {};
    const { session, events } = rig(bot);
    session.onHurtBy(7, 'zombie');
    await drive(bot, 4_500);
    expect(bread.count).toBe(1);
    expect((bot as any).heldItem.name).toBe('iron_sword');
    expect(slots[45]).toBe(bread);
    expect(bag).toHaveLength(36);
    expect(bag.filter(item => item.name === 'cobblestone')).toHaveLength(35);
    expect(events.some(event => event.text.includes('吃了一个面包'))).toBe(true);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it('副手持盾时面对远程敌人会举盾', async () => {
    const { bot } = combatRigBot([foe(7, 'skeleton', 6)]);
    (bot as any).inventory.slots[45] = { name: 'shield' };
    const raised: boolean[] = [];
    (bot as any).activateItem = (offhand: boolean) => { raised.push(offhand); };
    (bot as any).deactivateItem = () => {};
    const { session } = rig(bot);
    session.onHurtBy(7, 'skeleton');
    await drive(bot, 500);
    expect(raised).toContain(true);
    session.stop();
  });

  it('远程敌人仍在射程内时不为吃饭放下战斗', async () => {
    const { bot } = combatRigBot([foe(7, 'skeleton', 9)]);
    const bag = [{ name: 'iron_sword', type: 1, count: 1 }, { name: 'bread', type: 2, count: 2 }];
    (bot as any).food = 10;
    (bot as any).health = 15;
    (bot as any).inventory = { items: () => bag, slots: Array(46).fill(null) };
    (bot as any).registry.foodsByName = { bread: { foodPoints: 5 } };
    const consume = vi.fn(async () => {});
    (bot as any).consume = consume;
    const { session } = rig(bot);
    session.onHurtBy(7, 'skeleton');
    await drive(bot, 3_000);
    expect(consume).not.toHaveBeenCalled();
    expect(bag[1].count).toBe(2);
    session.stop();
  });
});

/**
 * 岩浆的 boundingBox 为 empty，岩浆块为 block；可站性须同时检查危险方块名称，使用共享的 BURNING_BLOCKS/SCORCHING_FLOOR。
 */
describe('standable 认岩浆', () => {
  it('低一格是岩浆、脚下是岩浆块:都不算可站方向', () => {
    const { bot } = combatRigBot();
    const { session } = rig(bot);
    const world: Record<string, { name: string; boundingBox: string }> = {};
    (bot as unknown as { blockAt: unknown }).blockAt = (p: { x: number; y: number; z: number }) => {
      const hit = world[`${p.x},${p.y},${p.z}`];
      return hit ?? { name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' };
    };
    const standable = (x: number, y: number, z: number): boolean =>
      (session as unknown as { standable(b: unknown, x: number, y: number, z: number): boolean })
        .standable(bot, x, y, z);
    // 平地照旧可站
    expect(standable(5, 64, 5)).toBe(true);
    // 低一格是 boundingBox 为 empty 的岩浆，下方是石头、头部是空气，仍不能站立。
    world['5,63,5'] = { name: 'lava', boundingBox: 'empty' };
    world['5,62,5'] = { name: 'stone', boundingBox: 'block' };
    expect(standable(5, 63, 5)).toBe(false);
    // 脚下是岩浆块(boundingBox block):踩上去也烧
    world['6,63,6'] = { name: 'magma_block', boundingBox: 'block' };
    expect(standable(6, 64, 6)).toBe(false);
  });
});

describe('战斗会话:进入(夺手不夺嘴)', () => {
  it('fast engagement cannot immediately reopen a stuck fight, but observed injury still permits self defence', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 6)]);
    const { session } = rig(bot);
    try {
      expect(session.react({ type: 'engage', targetId: 7 })).toBe(true);
      await drive(bot, 7_000);
      expect(session.active).toBe(false);
      expect(session.engagementTargets()).toEqual([]);
      expect(session.react({ type: 'engage', targetId: 7 })).toBe(false);
      expect(session.onHurtBy(7, 'zombie')).toBe(true);
      expect(session.active).toBe(true);
    } finally { session.stop(); }
  });

  it.each(['equip', 'busy'] as const)('a bow-only body retreats on %s failure and cannot corner itself into punching with bread', async cause => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = { name: 'bread', type: 3, count: 5 };
    b.inventory.items = () => [{ name: 'bow', type: 2, count: 1 }];
    const ranged = rangedRig();
    ranged.actions.shoot = vi.fn(async () => ({ kind: 'blocked' as const, reason: 'aborted' as const, cause }));
    const diag = new MinecraftLog(), { session, events } = rig(bot, {}, diag, ranged.actions);
    try {
      session.onHurtBy(7, 'zombie'); await drive(bot, 2_000);
      expect(session.reactionState().retreating).toBe(true);
      for (let i = 0; i < 9; i++) { // sustained injury while escape has no net movement
        session.onHurtBy(7, 'zombie'); await drive(bot, 1_000);
      }
      expect(session.reactionState().retreating).toBe(true);
      expect(attacks).toHaveLength(0);
      expect(events.filter(event => event.text.includes('弓箭未能出手'))).toHaveLength(1);
      expect(diag.after(0).find(event => event.event === 'ranged-blocked')?.data)
        .toMatchObject({ cause, held: 'bread', targetId: 7 });
    } finally { session.stop(); }
  });

  it('a cornered bow-only body still uses its bow rather than food as a melee fallback', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = { name: 'bread', type: 3, count: 5 };
    b.inventory.items = () => [{ name: 'bow', type: 2, count: 1 }];
    const ranged = rangedRig(), { session } = rig(bot, {}, undefined, ranged.actions);
    try {
      session.onHurtBy(7, 'zombie');
      // Same state transition as retreat's cornered recovery, without making
      // the mock no-damage body repeatedly fail before the assertion.
      (session as any).desperate = true;
      await drive(bot, 500);
      expect(ranged.shots.length).toBeGreaterThan(0);
      expect(attacks).toHaveLength(0);
    } finally { session.stop(); }
  });
  it.each(['cancel', 'low-health', 'timeout'] as const)('pending explicit attack equipment yields its body on %s before a late equip confirmation', async cause => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.registry.entitiesByName.zombie = { name: 'zombie' }; b.heldItem = null;
    let finish!: () => void, cancelled = false;
    b.equip = () => new Promise<void>(resolve => { finish = () => { b.heldItem = { name: 'iron_sword', type: 1, count: 1 }; resolve(); }; });
    const stats = { token: {}, targetId: 7, swings: 0, meleeHits: 0, arrows: 0, rangedHits: 0,
      hurts: 0, lastHurtAt: 0, lastSwingAt: 0, lastSwingTargetId: -1, dead: false, disconnected: false };
    const release = vi.fn();
    const result = skillAttack(bot, 'zombie', 'melee', { aborted: () => cancelled, fleeHealth: () => 10,
      escape: { active: false }, attack: { acquire: () => stats, release }, log } as never)
      .then(value => ({ value, error: null }), error => ({ value: null, error }));
    await drive(bot, 100);
    if (cause === 'cancel') cancelled = true;
    if (cause === 'low-health') b.health = 5;
    await drive(bot, cause === 'timeout' ? 3000 : 100);
    expect((await result).error).toBeInstanceOf(Error);
    expect(release).toHaveBeenCalledTimes(1); expect(attacks).toHaveLength(0);
    expect(Object.values(controls).every(value => !value)).toBe(true);
    finish(); await drive(bot, 100);
    expect(release).toHaveBeenCalledTimes(1); expect(attacks).toHaveLength(0);
  });

  it.each(['blocked', 'unavailable'] as const)('auto attack with only a bow reports %s rather than silently using fists', async failure => {
    const enemy = foe(7, 'zombie', 2.5), { bot, attacks, controls } = combatRigBot([enemy]), b = bot as any;
    b.registry.entitiesByName.zombie = { name: 'zombie' };
    b.heldItem = null; b.inventory.items = () => [{ name: 'bow', type: 2, count: 1 }];
    const stats = { token: {}, targetId: 7, swings: 0, meleeHits: 0, arrows: 0, rangedHits: 0,
      hurts: 0, lastHurtAt: 0, lastSwingAt: 0, lastSwingTargetId: -1, dead: false, disconnected: false };
    const ranged = rangedRig(), release = vi.fn();
    if (failure === 'unavailable') ranged.actions.shoot = async () => {
      ranged.actions.ready = () => false;
      return { kind: 'released', shotId: 1, targetId: 7, ownerToken: stats.token,
        at: Date.now(), aim: enemy.position, hitWindow: { from: Date.now(), until: Date.now() + 1500 } };
    };
    const result = skillAttack(bot, 'zombie', 'auto', { aborted: () => false, fleeHealth: () => 0,
      escape: { active: false }, attack: { acquire: () => stats, release, ranged: ranged.actions }, log } as never)
      .then(value => ({ value, error: null }), error => ({ value: null, error }));
    await drive(bot, 300);
    expect(String((await result).error)).toContain('未改为空手攻击');
    expect(attacks).toHaveLength(0); expect(release).toHaveBeenCalledWith(stats);
    expect(Object.values(controls).every(value => !value)).toBe(true);
  });

  it('a ranged-only loadout keeps distance instead of switching to an empty melee hand at close range', async () => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = null; b.inventory.items = () => [{ name: 'bow', type: 2, count: 1 }];
    const ranged = rangedRig(), { session } = rig(bot, {}, undefined, ranged.actions);
    try {
      session.onHurtBy(7, 'zombie'); await drive(bot, 1200);
      expect(attacks).toHaveLength(0); expect(Object.values(controls).some(Boolean)).toBe(true);
      expect(session.reactionState().retreating).toBe(false); // the ranged body is actively making space
    } finally { session.stop(); }
  });

  it('a bow-only body trapped in close terrain actually releases arrows instead of waiting for 5.5 blocks', async () => {
    const enemy = foe(7, 'zombie', 2.5), { bot, attacks, controls } = combatRigBot([enemy]), b = bot as any;
    const bow = { name: 'bow', type: 2, count: 1 }, arrows = { name: 'arrow', type: 3, count: 15 };
    b.heldItem = bow; b.quickBarSlot = 0; b.inventory.hotbarStart = 36;
    b.inventory.items = () => [bow, arrows]; b.inventory.slots[36] = bow;
    b.equip = async () => { b.heldItem = bow; };
    b.activateItem = vi.fn(() => { b.usingHeldItem = true; });
    b.deactivateItem = vi.fn(() => { b.usingHeldItem = false; });
    b.setQuickBarSlot = (slot: number) => { b.quickBarSlot = slot; b.usingHeldItem = false; };
    // The real body has no safe lateral/backward cell; LOS towards the enemy
    // is independently known clear. No artificial movement should be forced.
    b.blockAt = () => ({ name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], getProperties: () => ({}) });
    let session: CombatSession;
    const bowBody = new BowController({ getBot: () => bot, resolveTarget: () => enemy,
      leaseValid: token => session.ownsRanged(token), emit: event => session.onBowEvent(event) });
    ({ session } = rig(bot, {}, undefined, {
      ready: () => true, active: () => bowBody.active,
      shoot: (target, owner) => bowBody.shoot(target, owner), abort: () => bowBody.abort(),
    }));
    try {
      session.onHurtBy(7, 'zombie'); await drive(bot, 1300);
      expect(b.deactivateItem).toHaveBeenCalledTimes(1);
      expect(attacks).toHaveLength(0);
      expect(Object.values(controls).every(value => !value)).toBe(true);
      expect(session.reactionState().retreating).toBe(false);
    } finally { session.stop(); }
  });

  it.each(['reject', 'unconfirmed'] as const)('explicit attack surfaces %s equipment failure and releases its lease without a fist swing', async failure => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.registry.entitiesByName.zombie = { name: 'zombie' };
    b.heldItem = null;
    b.equip = async () => { if (failure === 'reject') throw Error('server denied equip'); };
    const stats = { token: {}, targetId: 7, swings: 0, meleeHits: 0, arrows: 0, rangedHits: 0,
      hurts: 0, lastHurtAt: 0, lastSwingAt: 0, lastSwingTargetId: -1, dead: false, disconnected: false };
    const release = vi.fn();
    await expect(skillAttack(bot, 'zombie', 'melee', { aborted: () => false, fleeHealth: () => 0,
      escape: { active: false }, attack: { acquire: () => stats, release }, log } as never)).rejects.toThrow('未改为空手攻击');
    expect(attacks).toHaveLength(0); expect(release).toHaveBeenCalledWith(stats);
    expect(Object.values(controls).every(value => !value)).toBe(true);
  });

  it('does not swing while a bag weapon is still equipping, then attacks after the real hand reading', async () => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = null;
    let finish!: () => void;
    b.equip = vi.fn((item: unknown) => new Promise<void>(resolve => { finish = () => { b.heldItem = item; resolve(); }; }));
    const { session } = rig(bot);
    try {
      session.onHurtBy(7, 'zombie');
      await drive(bot, 900);
      expect(attacks).toHaveLength(0);
      expect(b.equip).toHaveBeenCalledTimes(1);
      expect(Object.values(controls).some(Boolean)).toBe(true); // maneuvering is not held by inventory wait
      finish(); await drive(bot, 900);
      expect(attacks.length).toBeGreaterThan(0);
    } finally { session.stop(); finish?.(); }
  });

  it.each(['reject', 'unconfirmed', 'timeout'] as const)('failed equip %s cannot turn into normal barehand attacks', async failure => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = null;
    b.equip = vi.fn(() => failure === 'reject' ? Promise.reject(Error('denied'))
      : failure === 'timeout' ? new Promise<void>(() => {}) : Promise.resolve());
    const { session } = rig(bot);
    try {
      session.onHurtBy(7, 'zombie');
      await drive(bot, failure === 'timeout' ? 3_100 : 200);
      expect(attacks).toHaveLength(0);
      expect(session.reactionState().retreating).toBe(true);
      expect(b.equip).toHaveBeenCalledTimes(1);
    } finally { session.stop(); }
  });

  it('a cancelled equip cannot report failure or revive the ended combat session', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]), b = bot as any;
    b.heldItem = null;
    let reject!: (error: Error) => void;
    b.equip = () => new Promise<void>((_, no) => { reject = no; });
    const { session, events } = rig(bot);
    session.onHurtBy(7, 'zombie'); session.stop();
    const count = events.length;
    reject(Error('late rejection')); await sleep(100);
    expect(session.active).toBe(false); expect(attacks).toHaveLength(0); expect(events).toHaveLength(count);
  });

  it('换武器没成:接敌播报不说手里是它,换手结果出来后照实补一条', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const b = bot as unknown as Record<string, unknown>;
    b.heldItem = null;
    b.inventory = { items: () => [{ name: 'diamond_sword', type: 1, count: 1 }], slots: [] };
    b.equip = async () => { throw new Error('Server rejected transaction for clicking on slot 36'); };
    const { session, events } = rig(bot);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(events[0].text).not.toContain('手里是钻石剑');
    await new Promise((r) => setImmediate(r));
    expect(events.some((e) => e.text.includes('钻石剑没换到手上') && e.text.includes('手里是空手'))).toBe(true);
    session.stop();
  });

  it('被打就接手:挂起任务、发第一人称接敌事件,文本不出现「战斗模式/脚本/接管」', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, events, calls } = rig(bot);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(session.active).toBe(true);
    expect(calls.suspended).toBe(1);
    expect(events[0].urgent).toBe(true);
    expect(events[0].text).toContain('抄家伙还手');
    expect(events[0].text).toContain('生命 20/20');
    expect(events[0].text).toContain('铁剑');
    for (const banned of ['战斗模式', '脚本', '接管', '控制器']) {
      expect(events[0].text).not.toContain(banned);
    }
    session.stop();
  });

  it('不主动招惹:触发圈外的怪不动手,贴进 3 格才开打', async () => {
    const far = combatRigBot([foe(7, 'zombie', 6.5)]);
    const a = rig(far.bot);
    a.session.start();
    await sleep(600);
    expect(a.session.active).toBe(false);
    a.session.stop();

    const near = combatRigBot([foe(7, 'zombie', 2.5)]);
    const b = rig(near.bot);
    b.session.start();
    await waitUntil(() => b.session.active, 2000);
    expect(b.events[0].text).toContain('贴到跟前');
    b.session.stop();
  });

  it('试炼层主动接战本层远处怪物，但忽略上下层重叠的敌人', async () => {
    const distant = foe(7, 'zombie', 8);
    const upper = foe(8, 'skeleton', 2);
    upper.position.y = 76;
    const { bot } = combatRigBot([upper, distant]);
    const { session, events } = rig(bot, { arena: true, engageRadius: 16, chaseMax: 18 });
    session.start();
    await waitUntil(() => session.active, 2_000);
    expect(events[0].text).toContain('僵尸');
    expect(events[0].text).not.toContain('骷髅');
    session.stop();

    const onlyUpper = combatRigBot([upper]);
    const other = rig(onlyUpper.bot, { arena: true, engageRadius: 16, chaseMax: 18 });
    other.session.start();
    await sleep(600);
    expect(other.session.active).toBe(false);
    other.session.stop();
  });

  it('试炼层的墙外敌人不触发接战，也不抢走已看见的目标', async () => {
    const hidden = foe(7, 'creeper', 2);
    const seen = foe(8, 'zombie', 0.5, 2.5);
    const { bot, attacks } = combatRigBot([hidden, seen]);
    (bot as any).world.raycast = (_eye: Vec3, dir: Vec3) =>
      dir.x > 0.2 ? { position: new Vec3(1, 65, 0) } : null;
    const { session, events } = rig(bot, { arena: true, engageRadius: 16, chaseMax: 18 });
    session.start();
    await waitUntil(() => session.active, 2_000);
    expect(events[0].text).toContain('僵尸');
    expect(events[0].text).not.toContain('苦力怕');
    await drive(bot, 2_000);
    expect(attacks).not.toContain(7);
    session.stop();

    const onlyHidden = combatRigBot([hidden]);
    (onlyHidden.bot as any).world.raycast = () => ({ position: new Vec3(1, 65, 0) });
    const blocked = rig(onlyHidden.bot, { arena: true, engageRadius: 16, chaseMax: 18 });
    blocked.session.start();
    await sleep(700);
    expect(blocked.session.active).toBe(false);
    blocked.session.stop();
  });

  it('连续清试炼层时不因战斗占比暂停；受击自卫也不受冷却限制', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session } = rig(bot, { arena: true });
    (session as any).busyLog.push({ from: Date.now() - 250_000, to: Date.now() });
    (session as any).cooldownUntil = Date.now() + 60_000;
    session.start();
    await waitUntil(() => session.active, 2_000);
    session.stop();

    const other = rig(bot);
    (other.session as any).busyLog.push({ from: Date.now() - 250_000, to: Date.now() });
    (other.session as any).cooldownUntil = Date.now() + 60_000;
    expect(other.session.onHurtBy(7, 'zombie')).toBe(true);
    expect(other.session.active).toBe(true);
    other.session.stop();
  });

  it('普通猪灵只认实际穿戴的金甲:穿在装备槽不进场,只放背包仍主动接敌', async () => {
    const worn = combatRigBot([foe(7, 'piglin', 2.5)]);
    (worn.bot as unknown as { inventory: { slots: unknown[] } }).inventory.slots[8] = { name: 'golden_boots' };
    const protectedSession = rig(worn.bot);
    protectedSession.session.start();
    await sleep(600);
    expect(protectedSession.session.active).toBe(false);
    protectedSession.session.stop();

    const bagOnly = combatRigBot([foe(8, 'piglin', 2.5)]);
    (bagOnly.bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [
      { name: 'iron_sword', type: 1, count: 1 },
      { name: 'golden_boots', type: 2, count: 1 },
    ];
    const hostileSession = rig(bagOnly.bot);
    hostileSession.session.start();
    await waitUntil(() => hostileSession.session.active, 2000);
    hostileSession.session.stop();
  });

  it('幼年猪灵不主动进场,猪灵蛮兵即使玩家穿着金甲也始终敌对', async () => {
    const baby = foe(7, 'piglin', 2.5);
    baby.metadata = [false, true];
    const young = combatRigBot([baby]);
    const youngSession = rig(young.bot);
    youngSession.session.start();
    await sleep(600);
    expect(youngSession.session.active).toBe(false);
    youngSession.session.stop();

    const brute = combatRigBot([foe(8, 'piglin_brute', 2.5)]);
    (brute.bot as unknown as { inventory: { slots: unknown[] } }).inventory.slots[5] = { name: 'golden_helmet' };
    const bruteSession = rig(brute.bot);
    bruteSession.session.start();
    await waitUntil(() => bruteSession.session.active, 2000);
    bruteSession.session.stop();
  });

  it('穿着金甲时被普通猪灵实际打到,仍按这只来源接敌', () => {
    const protectedRig = combatRigBot([foe(7, 'piglin', 2.5)]);
    (protectedRig.bot as unknown as { inventory: { slots: unknown[] } }).inventory.slots[6] = {
      name: 'golden_chestplate',
    };
    const { session } = rig(protectedRig.bot);
    expect(session.onHurtBy(7, 'piglin')).toBe(true);
    expect(session.active).toBe(true);
    session.stop();
  });

  it('死亡是终态:释放战斗并报告实际血量和时间，不恢复被冻结的旧任务', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, calls, combatReports } = rig(bot);
    const startedAt = new Date(Date.now()).toISOString();
    session.onHurtBy(7, 'zombie');
    expect(session.active).toBe(true);

    await sleep(2000);
    Object.assign(bot, { health: 0 });
    (bot as unknown as EventEmitter).emit('death');

    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0);
    expect(combatReports).toHaveLength(1);
    expect(combatReports[0]).toMatchObject({ startedAt, endedAt: new Date(Date.now()).toISOString(),
      reason: 'death', healthBefore: 20, healthAfter: 0, kills: {},
      sceneBefore: { position: { x: 0.5, y: 64, z: 0.5 }, nearbyHostiles: { zombie: 1 },
        equipment: { mainHand: 'iron_sword', offHand: null } } });
    session.stop();
    expect(combatReports).toHaveLength(1);
  });

  /**
   * 交还身体须释放 sneak，并停止挖掘和右键，不能只松方向键与盾。
   */
  it('收工交还身体:sneak 也松开,挖掘与右键一并停掉', () => {
    const { bot, controls } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const stopped: string[] = [];
    const b = bot as unknown as Record<string, unknown>;
    b.clearControlStates = (): void => { stopped.push('controls'); };
    b.stopDigging = (): void => { stopped.push('dig'); };
    b.deactivateItem = (): void => { stopped.push('use'); };
    b.usingHeldItem = true; // 举着盾;松手不发射的那一类
    const goals: unknown[] = [];
    b.pathfinder = { goal: null, setGoal: (g: unknown) => { goals.push(g); } };
    const { session } = rig(bot);
    session.onHurtBy(7, 'zombie');
    // 寻路器交互放置失败时留下的半蹲
    (bot as unknown as { setControlState(k: string, v: boolean): void }).setControlState('sneak', true);
    expect(controls.sneak).toBe(true);

    session.standDown();

    expect(controls.sneak).toBe(false);
    expect(stopped).toContain('dig');
    expect(stopped).toContain('use');
    expect(goals).toEqual([null]);
    session.stop();
  });

  it('关着 / 环境自保中 / 冷却中都进不了场,退回反射的降级行为', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const off = rig(bot, { enabled: false });
    expect(off.session.onHurtBy(7, 'zombie')).toBe(false);

    const busy = rig(bot);
    busy.setEnvBusy(true);
    expect(busy.session.onHurtBy(7, 'zombie')).toBe(false);
  });

  it('任务逃生期间，巡检与受击都保留正在执行的路线', async () => {
    const near = combatRigBot([foe(7, 'cave_spider', 2.2)]);
    const a = rig(near.bot);
    a.setTaskEscaping(true);
    a.session.start();
    await sleep(600);
    expect(a.session.active).toBe(false); // 不趁逃跑抢场
    expect(a.session.onHurtBy(7, 'cave_spider')).toBe(true);
    expect(a.session.active).toBe(false);
    expect(a.calls.suspended).toBe(0);
    a.session.stop();
  });

  it.each([5, 20])('真实逃跑任务生命=%s：连续受击后仍到达，后续任务只执行一次', async (health) => {
    const { bot, attacks } = combatRigBot([foe(7, 'skeleton', 2.2)]);
    const native = bot as unknown as Bot;
    const said: string[] = [];
    const reports: TaskReport[] = [];
    let arrive: (() => void) | undefined;
    let destination: Vec3 | undefined;
    Object.assign(bot, { health, food: 16, game: { dimension: 'overworld' },
      chat: (text: string) => said.push(text) });
    Object.assign(native.pathfinder, {
      movements: { canDig: true, scafoldingBlocks: [1] },
      goto: async (goal: { x: number; z: number }) => {
        destination = new Vec3(goal.x, 64, goal.z);
        await new Promise<void>((resolve) => { arrive = resolve; });
      },
    });
    let id = 0;
    let exec: Executor;
    const session = new CombatSession({
      getBot: () => native,
      tuning: () => ({ enabled: true, engageRadius: 3, chaseMax: 6, maxSec: 30, space: 2.6,
        busyRatio: 60, cooldownSec: 60, fleeHealth: 10, fight: 'auto' }),
      envBusy: () => false,
      taskEscaping: () => exec?.escaping ?? false,
      suspendTasks: (reason) => exec.suspend(reason),
      resumeTasks: () => exec.resume(), emit: () => {}, log,
    });
    exec = new Executor({ getBot: () => native, report: (r) => reports.push(r), log, nextId: () => ++id,
      busyWith: () => session.active ? '正在跟怪打' : null,
      stopCombat: (first) => session.standDown(first) });
    try {
      exec.submit([{ skill: 'flee', distance: 24 }, { skill: 'chat', text: '撤退后的待办' }]);
      await waitUntil(() => exec.escaping && arrive !== undefined);
      session.start();
      for (let i = 0; i < 5; i++) {
        expect(session.onHurtBy(7, 'skeleton')).toBe(true);
        await drive(native, 200);
        expect(session.active).toBe(false);
        expect(exec.escaping).toBe(true);
        expect(reports).toEqual([]);
      }
      expect(attacks).toEqual([]);
      expect(said).toEqual([]);
      native.entity.position = destination!;
      arrive!();
      await waitUntil(() => reports.length === 1);
      expect(reports[0].kind).toBe('done');
      expect(said).toEqual(['撤退后的待办']);
      expect(exec.escaping).toBe(false);
      expect(native.pathfinder.movements.canDig).toBe(true);
      (native.entities[7] as { isValid: boolean }).isValid = false;
      await drive(native, 300);
      expect(session.active).toBe(false);
    } finally {
      session.stop();
      exec.shutdown();
    }
  });

  it('头在水里不接手:水下近战交回 surface/防溺水那条线', () => {
    const { bot } = combatRigBot([foe(7, 'drowned', 2.5)]);
    (bot as unknown as { blockAt: unknown }).blockAt = () => ({ name: 'water', boundingBox: 'empty' });
    const { session } = rig(bot);
    expect(session.onHurtBy(7, 'drowned')).toBe(false);
    expect(session.active).toBe(false);
  });

  it('被隔墙目标打到时直接撤退，不反复开一场零挥刀的战斗', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'creeper', 2.5)]);
    (bot as unknown as { world: { raycast: () => unknown } }).world.raycast = () => ({ name: 'stone' });
    const { session, events, calls } = rig(bot);
    expect(session.onHurtBy(7, 'creeper')).toBe(true);
    await drive(bot as unknown as EventEmitter, 500, 100);
    expect(events.some((e) => e.text.includes('看不见它,先撤'))).toBe(true);
    expect(attacks).toEqual([]);
    expect(calls.suspended).toBe(1);
    session.stop();
  });

  /**
   * mc_policy.fight 只控制主动进场，不处理 onHurtBy。
   */
  describe('fight 三档:只管主动进场', () => {
    it('off:3 格圈内也不主动动手', async () => {
      const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
      const a = rig(bot, { fight: 'off' });
      a.session.start();
      await sleep(600);
      expect(a.session.active).toBe(false);
      a.session.stop();
    });

    it('armed:空手不进场,包里有剑就进场', async () => {
      const bare = combatRigBot([foe(7, 'zombie', 2.2)]);
      (bare.bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [];
      (bare.bot as unknown as { heldItem: unknown }).heldItem = null;
      const a = rig(bare.bot, { fight: 'armed' });
      a.session.start();
      await sleep(600);
      expect(a.session.active).toBe(false);
      a.session.stop();

      const armed = combatRigBot([foe(7, 'zombie', 2.2)]);
      const b = rig(armed.bot, { fight: 'armed' });
      b.session.start();
      await waitUntil(() => b.session.active, 2000);
      b.session.stop();
    });

    it('三档下空手挨打均撤退，保留自动进场配置', async () => {
      for (const fight of ['auto', 'armed', 'off'] as const) {
        const bare = combatRigBot([foe(7, 'zombie', 2.2)]);
        (bare.bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [];
        (bare.bot as unknown as { heldItem: unknown }).heldItem = null;
        const a = rig(bare.bot, { fight });
        a.session.start();
        await sleep(400);
        // 主动那条路:auto 会进场,armed 空手与 off 不会
        expect(a.session.active).toBe(fight === 'auto');
        a.session.stop();

        const hit = combatRigBot([foe(7, 'zombie', 2.2)]);
        (hit.bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [];
        (hit.bot as unknown as { heldItem: unknown }).heldItem = null;
        const b = rig(hit.bot, { fight });
        expect(b.session.onHurtBy(7, 'zombie')).toBe(true);
        expect(b.session.reactionState().retreating).toBe(true);
        expect(b.events[0].text).not.toContain('我先动手');
        b.session.stop();
      }
    });
  });

  /**
   * 血量不足时主动入场转为撤退并播报；不能在每次巡检中静默跳过。
   */
  describe('入场血线闸', () => {
    it('主动进场要留出挨一下的余量:血低于线时转撤退,不开打', async () => {
      const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.2)]);
      (bot as unknown as { health: number }).health = 12; // fleeHealth 10 + 余量 3
      const a = rig(bot);
      a.session.start();
      await waitUntil(() => a.events.length > 0, 2000);
      expect(a.events[0].text).toContain('这架不接了');
      expect(a.events[0].urgent).toBe(true);
      expect(attacks).toHaveLength(0);
      a.session.stop();
    });

    it('挨打不加余量:脱战线以上照旧还手', () => {
      const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
      (bot as unknown as { health: number }).health = 11;
      const a = rig(bot);
      expect(a.session.onHurtBy(7, 'zombie')).toBe(true);
      expect(a.events[0].text).toContain('抄家伙还手');
      a.session.stop();
    });

    it('挨打且已在脱战线以下:接手但直接撤,不发「我抄家伙还手」', () => {
      const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.2)]);
      (bot as unknown as { health: number }).health = 3;
      const a = rig(bot);
      expect(a.session.onHurtBy(7, 'zombie')).toBe(true);
      expect(a.events[0].text).toContain('血只剩 3/20');
      expect(a.events[0].text).not.toContain('抄家伙还手');
      expect(a.calls.suspended).toBe(1);
      expect(attacks).toHaveLength(0);
      a.session.stop();
    });
  });

  it('E7:warden 找上门不交战,直接跑', () => {
    const { bot, attacks } = combatRigBot([foe(9, 'warden', 2.5)]);
    const { session, events, calls } = rig(bot);
    expect(session.onHurtBy(9, 'warden')).toBe(true);
    expect(events[0].text).toContain('打不过');
    expect(calls.suspended).toBe(1);
    expect(attacks).toHaveLength(0);
    session.stop();
  });
});

describe('弓与近战的同一战斗会话', () => {
  function rangedTerrain(
    bot: unknown,
    cell: (x: number, y: number, z: number) => 'air' | 'stone' | 'lava' | 'water',
  ): void {
    (bot as { blockAt: (p: Vec3) => unknown }).blockAt = (p) => {
      const name = cell(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      return { name, boundingBox: name === 'stone' ? 'block' : 'empty' };
    };
  }

  it('远处可见敌对只进入感知，不会由 3 格巡检主动开火', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'skeleton', 20)]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.start();

    await sleep(600);

    expect(session.active).toBe(false);
    expect(ranged.shots).toHaveLength(0);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it('主动 attack 持有身体时:三格巡检不重复接管', async () => {
    const near = combatRigBot([foe(7, 'zombie', 2.2)]);
    const active = rig(near.bot);
    active.setTaskFighting(true);
    active.session.start();
    await sleep(600);
    expect(active.session.active).toBe(false);
    expect(active.calls.suspended).toBe(0);
    active.session.stop();
  });

  it('20 格外打过来的骷髅进入 40 格交战池并用弓回火', async () => {
    const skeleton = foe(7, 'skeleton', 20);
    const { bot, attacks } = combatRigBot([skeleton]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);

    expect(session.onHurtBy(7, 'skeleton')).toBe(true);
    (bot as unknown as EventEmitter).emit('physicsTick');
    await waitUntil(() => ranged.shots.length > 0);

    expect(ranged.shots[0].target.id).toBe(7);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it('8–14 格面对远程敌人也持续横移，不在骷髅射线上站桩', () => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'skeleton');

    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(controls.left || controls.right).toBe(true);

    controls.left = false;
    controls.right = false;
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(controls.left || controls.right).toBe(true);
    session.stop();
  });

  it('轨迹采样发现持续顶墙后封锁原方向并改走另一侧', async () => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    const diag = new MinecraftLog({ log });
    const ranged = rangedRig();
    const { session } = rig(bot, {}, diag, ranged.actions);
    session.onHurtBy(7, 'skeleton');
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(controls.left).toBe(true);

    // 假 bot 按键但不产生位置变化，模拟角色顶着墙持续走。
    await drive(bot as unknown as EventEmitter, 1_600);
    const entries = diag.after(0);
    expect(entries.filter((entry) => entry.event === 'trajectory').length).toBeGreaterThanOrEqual(4);
    expect(entries.find((entry) => entry.event === 'wall-stall')?.incident).toBe(true);
    expect(controls.left).toBe(false);
    expect(controls.right).toBe(true);
    session.stop();
  });

  it('斜走时检查玩家身体宽度和整段路径，不把墙角当成可走', () => {
    const { bot } = combatRigBot();
    (bot as unknown as { blockAt: (p: Vec3) => unknown }).blockAt = (p) => {
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const solid = y < 64 || (x === 1 && z === 0 && (y === 64 || y === 65));
      return { name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' };
    };
    const { session } = rig(bot);
    const safe = (dx: number, dz: number) =>
      (session as unknown as { movementSafe(bot: Bot, dx: number, dz: number): boolean })
        .movementSafe(bot, dx, dz);
    expect(safe(1, 1)).toBe(false);
    expect(safe(0, 1)).toBe(true);
  });

  it('寻路器尚未按键时不把计算路径的静止误判为顶墙', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 5.5)]);
    const diag = new MinecraftLog({ log });
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    (session as unknown as { pathing: boolean }).pathing = true;
    (session as unknown as { pathUntil: number }).pathUntil = Date.now() + 4_000;
    await drive(bot as unknown as EventEmitter, 1_500);
    expect(diag.after(0).some((entry) => entry.event === 'wall-stall')).toBe(false);
    session.stop();
  });

  it('弓态后退被墙挡住时沿墙横移', () => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    rangedTerrain(bot, (_x, y, z) => z < 0 && y >= 64 && y <= 65 ? 'stone' : y < 64 ? 'stone' : 'air');
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'skeleton');
    (bot as unknown as EventEmitter).emit('physicsTick');
    skeleton.position = new Vec3(0.5, 64, 7);
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(controls.forward).toBe(false);
    expect(controls.left || controls.right).toBe(true);
    session.stop();
  });

  it.each([
    ['悬崖', (_y: number): 'air' => 'air'],
    ['岩浆', (y: number): 'air' | 'stone' | 'lava' => y === 63 ? 'lava' : y < 63 ? 'stone' : 'air'],
  ])('10 格风筝时左侧是%s、右侧可站：改走右侧', (_name, leftCell) => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    rangedTerrain(bot, (x, y) => x < 0 ? leftCell(y) : y < 64 ? 'stone' : 'air');
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'skeleton');

    (bot as unknown as EventEmitter).emit('physicsTick');

    expect(controls.left).toBe(false);
    expect(controls.right).toBe(true);
    session.stop();
  });

  it('侧向一格高墙按横移方向起跳，不再按面向目标的 yaw 探测', () => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    rangedTerrain(bot, (x, y) => {
      if (x < 0 && y === 64) return 'stone';
      return y < 64 ? 'stone' : 'air';
    });
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'skeleton');

    (bot as unknown as EventEmitter).emit('physicsTick');

    expect(controls.left).toBe(true);
    expect(controls.jump).toBe(true);
    session.stop();
  });

  it('两侧都没有干燥落脚格时不写水平键', () => {
    const skeleton = foe(7, 'skeleton', 0.5, 10);
    const { bot, controls } = combatRigBot([skeleton]);
    rangedTerrain(bot, (x, y) => {
      if (x < 0) return 'air';
      if (x >= 1 && y === 63) return 'water';
      return y < 64 ? 'stone' : 'air';
    });
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'skeleton');

    (bot as unknown as EventEmitter).emit('physicsTick');

    expect(controls.forward).toBe(false);
    expect(controls.back).toBe(false);
    expect(controls.left).toBe(false);
    expect(controls.right).toBe(false);
    session.stop();
  });

  it('8/5.5 格滞回保持弓态，8–14 格横移风筝，贴近后回到近战', async () => {
    const zombie = foe(7, 'zombie', 0.5, 10);
    const { bot, attacks, controls } = combatRigBot([zombie]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'zombie');

    (bot as unknown as EventEmitter).emit('physicsTick');
    await waitUntil(() => ranged.shots.length > 0);
    expect((session as unknown as { hybridWeapon: string }).hybridWeapon).toBe('ranged');
    expect(controls.left).toBe(true);

    zombie.position = new Vec3(0.5, 64, 8);
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect((session as unknown as { hybridWeapon: string }).hybridWeapon).toBe('ranged');

    zombie.position = new Vec3(0.5, 64, 3);
    await drive(bot as unknown as EventEmitter, 900);
    expect((session as unknown as { hybridWeapon: string }).hybridWeapon).toBe('melee');
    expect(ranged.aborts).toBeGreaterThan(0);
    expect(attacks).toContain(7);
    session.stop();
  });

  it('死亡、低血撤退和会话结束都先撤销在途拉弓', () => {
    const deathBot = combatRigBot([foe(7, 'skeleton', 20)]);
    const deathRanged = rangedRig();
    const death = rig(deathBot.bot, {}, undefined, deathRanged.actions).session;
    death.onHurtBy(7, 'skeleton');
    (deathBot.bot as unknown as EventEmitter).emit('physicsTick');
    (deathBot.bot as unknown as EventEmitter).emit('death');
    expect(deathRanged.aborts).toBeGreaterThan(0);

    const fleeBot = combatRigBot([foe(7, 'skeleton', 20)]);
    const fleeRanged = rangedRig();
    const flee = rig(fleeBot.bot, {}, undefined, fleeRanged.actions).session;
    flee.onHurtBy(7, 'skeleton');
    (fleeBot.bot as unknown as EventEmitter).emit('physicsTick');
    (fleeBot.bot as unknown as { health: number }).health = 5;
    (fleeBot.bot as unknown as EventEmitter).emit('physicsTick');
    expect(fleeRanged.aborts).toBeGreaterThan(0);
    flee.stop();

    const endBot = combatRigBot([foe(7, 'skeleton', 20)]);
    const endRanged = rangedRig();
    const end = rig(endBot.bot, {}, undefined, endRanged.actions).session;
    end.onHurtBy(7, 'skeleton');
    (endBot.bot as unknown as EventEmitter).emit('physicsTick');
    end.stop();
    expect(endRanged.aborts).toBeGreaterThan(0);
  });

  it('箭数与远程命中单独记账，旧 owner 的事件不能污染下一场', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 20)]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, diag, ranged.actions);
    session.onHurtBy(7, 'skeleton');
    (bot as unknown as EventEmitter).emit('physicsTick');
    const ownerToken = ranged.shots[0].ownerToken;
    const at = Date.now();
    session.onBowEvent({
      kind: 'released', shotId: 1, targetId: 7, ownerToken, at,
      aim: new Vec3(20, 65, 0), hitWindow: { from: at, until: at + 1_500 },
    });
    session.onBowEvent({ kind: 'hit', shotId: 1, targetId: 7, ownerToken, at: at + 20 });
    session.stop();

    expect(diag.after(0).find((entry) => entry.event === 'end')?.data).toMatchObject({
      arrows: 1, rangedLanded: 1, meleeLanded: 0, landed: 1,
    });
    session.onBowEvent({ kind: 'hit', shotId: 1, targetId: 7, ownerToken, at: at + 30 });
    expect(session.claims(7)).toBe(false);
  });
});

describe('战斗会话:打与收', () => {
  it('出手打中目标后 claims 生效;打死由会话说「砍翻了」,收工报战果并恢复队列', async () => {
    const zombie = foe(7, 'zombie', 2.5);
    const { bot, attacks } = combatRigBot([zombie]);
    const { session, events, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    // 暴击相位:起跳后下落中出手
    (bot as unknown as { entity: { velocity: { y: number } } }).entity.velocity.y = -0.1;
    await drive(bot as unknown as EventEmitter, 600);
    expect(attacks).toContain(7);
    expect(session.claims(7)).toBe(true);
    // 打死了:会话自己说,不再由 World 补「死了」
    (bot as unknown as EventEmitter).emit('entityDead', { id: 7, name: 'zombie' });
    expect(events.some((e) => e.text.includes('砍翻了僵尸'))).toBe(true);
    expect(events.some((e) => e.text.includes('砍翻了僵尸') && e.text.includes('周围没别的了'))).toBe(true);
    expect(session.claims(7)).toBe(false);
    // Mineflayer 的实体表还没删掉死亡对象、生命又已掉到撤退线；这一拍仍应按清场处理。
    (bot as unknown as { health: number }).health = 5;
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(events.some((e) => e.text.includes('我先撤'))).toBe(false);
    // E1:场上没怪,滞后 3s 收工;战果 + 队列恢复各一句
    await drive(bot as unknown as EventEmitter, 3400, 100);
    await waitUntil(() => !session.active, 2000);
    expect(calls.resumed).toBe(1);
    expect(events.some((e) => e.text.includes('打完了') && e.text.includes('僵尸'))).toBe(true);
    expect(events.some((e) => e.text.includes('接着做'))).toBe(true);
    session.stop();
  }, 15_000);

  /**
   * 携带弓箭不能扩大普通战斗的退出扫描范围，否则未交手的远处敌人会一直阻止任务恢复。
   */
  it('带弓时退出半径不被撑开:25 格外那只没交过手的骷髅拦不住收工', async () => {
    const zombie = foe(7, 'zombie', 2.5);
    const skeleton = foe(9, 'skeleton', 25);
    const { bot } = combatRigBot([zombie, skeleton]);
    const ranged = rangedRig();
    const { session, events } = rig(bot, {}, undefined, ranged.actions);
    session.onHurtBy(7, 'zombie');
    (bot as unknown as { entity: { velocity: { y: number } } }).entity.velocity.y = -0.1;
    await drive(bot as unknown as EventEmitter, 600);
    // 打死近处那只;25 格外的骷髅还在实体表里,但它一次都没打过我们
    zombie.isValid = false;
    (bot as unknown as EventEmitter).emit('entityDead', { id: 7, name: 'zombie' });
    delete (bot as unknown as { entities: Record<number, unknown> }).entities[7];
    await drive(bot as unknown as EventEmitter, 3600, 100);
    await waitUntil(() => !session.active, 2000);
    expect(session.active).toBe(false);
    // 「还剩几只」也按退出口径报:远处那只没交过手的不算在内
    expect(events.some((e) => e.text.includes('砍翻了僵尸') && e.text.includes('周围没别的了'))).toBe(true);
    session.stop();
  }, 15_000);

  it('交过手的远程目标照旧留在场上:25 格外的骷髅射过我们就不算清场', async () => {
    const skeleton = foe(9, 'skeleton', 25);
    const { bot } = combatRigBot([skeleton]);
    const ranged = rangedRig();
    const { session } = rig(bot, {}, undefined, ranged.actions);
    expect(session.onHurtBy(9, 'skeleton')).toBe(true);
    await drive(bot as unknown as EventEmitter, 3600, 100);
    expect(session.active).toBe(true);
    session.stop();
  }, 15_000);

  it('E3 硬时长:到点强制收手,点名还剩几只', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5), foe(8, 'zombie', 4)]);
    const { session, events, calls } = rig(bot, { maxSec: 1 });
    session.onHurtBy(7, 'zombie');
    await drive(bot as unknown as EventEmitter, 1300, 100);
    expect(session.active).toBe(false);
    expect(events.some((e) => e.text.includes('打太久了') && e.text.includes('2 只'))).toBe(true);
    expect(calls.resumed).toBe(1);
    session.stop();
  }, 10_000);

  it('E2 血线:低血收手转撤退,撤完恢复队列', async () => {
    const zombie = foe(7, 'zombie', 2.5);
    const { bot } = combatRigBot([zombie]);
    const { session, events, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    (bot as unknown as { health: number }).health = 5;
    await drive(bot as unknown as EventEmitter, 200);
    expect(events.some((e) => e.text.includes('血被打到 5/20') && e.text.includes('先撤'))).toBe(true);
    // 怪不在追击圈内后还要守住无伤时窗，不能靠一拍实体表丢失假完成。
    zombie.position = new Vec3(60, 64, 0.5);
    await drive(bot as unknown as EventEmitter, 1_700);
    await waitUntil(() => !session.active, 2000);
    expect(calls.resumed).toBe(1);
    session.stop();
  }, 10_000);

  it('mc_stop = 收手 + 撤退,不是原地站住', async () => {
    const zombie = foe(7, 'zombie', 2.5);
    const { bot } = combatRigBot([zombie]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    expect(session.requestStop()).toContain('收手');
    expect(session.active).toBe(true); // 还在撤,没有原地放手
    zombie.position = new Vec3(40, 64, 0.5);
    await drive(bot as unknown as EventEmitter, 1_700);
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(1);
    session.stop();
  }, 10_000);

  it('mc_stop 后被近战怪贴身追打:恢复自卫，追敌寻路全程不挖墙', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'husk', 2.5)]);
    const movements = { canDig: true };
    ((bot as unknown as { pathfinder: { movements: typeof movements } }).pathfinder).movements = movements;
    const { session, events } = rig(bot, {}, diag);
    session.onHurtBy(7, 'husk');
    expect(movements.canDig).toBe(false);
    expect(session.requestStop()).toContain('收手');
    Object.assign(session as unknown as Record<string, unknown>, { retreatStartedAt: Date.now() - 1_600 });
    session.onHurtBy(7, 'husk');
    session.onHurtBy(7, 'husk');
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(diag.after(0).find((e) => e.event === 'cornered')?.data)
      .toMatchObject({ cause: 'close', foe: 'husk' });
    expect(events.some((e) => e.text.includes('回头打'))).toBe(true);
    expect(movements.canDig).toBe(false);
    session.stop();
    expect(movements.canDig).toBe(true);
  });

  it('E6:环境自保夺权时静默让位,一句话都不抢', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, events, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    const before = events.length;
    session.yieldToEnv();
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0);
    expect(events.length).toBe(before); // 让位不发事件,由环境反射自己汇报
    session.stop();
  });

  it('断线终止会话但不在失联窗口恢复冻结任务', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');

    session.onConnectionLost();

    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0);
    session.stop();
  });
});

/**
 * bot.attack() 只发包，没有命中确认；本组断言出手次数与抢占原因，出手不能等同命中。
 */
describe('战斗:打不中它的时候', () => {
  it('E8:够得着、刀也挥了,却一下没打中,6 秒后收手——不再耗到 E3 硬时长', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, events, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    await drive(bot, 7_000, 100);
    expect(attacks.length).toBeGreaterThanOrEqual(3); // 刀确实挥出去了
    const quit = events.find((e) => e.text.includes('一下都没打到'));
    expect(quit).toBeDefined();
    expect(quit!.text).toContain('僵尸');
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(1);
    session.stop();
  }, 15_000);

  it('繁忙闸按正常收尾恢复断点', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');

    (session as unknown as { end(reason: 'busy'): void }).end('busy');

    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(1);
    session.stop();
  });

  it('够不着就平视它的方向:视线不扎向脚下那一格', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 5.5)]);
    const looks: Array<{ y: number }> = [];
    (bot as unknown as { lookAt: (p: { y: number }) => Promise<void> })
      .lookAt = async (p) => { looks.push(p); };
    const { session } = rig(bot);
    session.onHurtBy(7, 'zombie');
    await drive(bot, 1_000, 100);
    expect(looks.length).toBeGreaterThan(0);
    // 眼高 1.62:够不着时每一次都平着看过去,而不是瞄怪脚下(y≈64.x)
    for (const p of looks) expect(p.y).toBeCloseTo(64 + 1.62, 5);
    session.stop();
  }, 10_000);
});

describe('战斗:抢占方与出手记账', () => {
  it('夺手时点名是哪一只怪触发的:执行器据此填 aborted 的抢占方', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    expect(calls.suspendedBy).toEqual(['战斗:被僵尸打了']);
    session.stop();
  });

  it('打不过的那类(E7)也点名,措辞与主动进场分得开', () => {
    const { bot } = combatRigBot([foe(7, 'warden', 2.5)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'warden');
    expect(calls.suspendedBy[0]).toContain('打不过');
    session.stop();
  });

  /** 喂 tick 直到出了一刀;`onSwing` 在同一拍里跑,用来模拟服务端的回应 */
  async function untilSwing(
    bot: EventEmitter, attacks: number[], onSwing: () => void, budgetMs = 4000,
  ): Promise<boolean> {
    for (let t = 0; t < budgetMs; t += 50) {
      const before = attacks.length;
      bot.emit('physicsTick');
      if (attacks.length > before) { onSwing(); return true; }
      await sleep(50);
    }
    return false;
  }

  it('收工日志分账挥刀次数与命中次数:够不着的空挥不再与命中同形', async () => {
    const diag = new MinecraftLog();
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const em = bot as unknown as EventEmitter;
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    // 只有第一刀落在目标身上,之后照挥不报掉血
    expect(await untilSwing(em, attacks, () => em.emit('entityHurt', { id: 7 }))).toBe(true);
    await drive(em, 1200);
    session.stop();
    const end = diag.after(0).find((e) => e.event === 'end')!;
    expect(attacks.length).toBeGreaterThan(1);
    expect(end.data!.swings).toBe(attacks.length);
    expect(end.data!.landed).toBe(1);
    expect(end.msg).toContain(`挥刀 ${attacks.length} 次命中 1 次`);
  }, 15_000);

  it('别人打掉的血不记进命中:超窗的掉血与别的实体掉血都不算我们那一刀', async () => {
    const diag = new MinecraftLog();
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]);
    const em = bot as unknown as EventEmitter;
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    expect(await untilSwing(em, attacks, () => {
      // 同一拍里别的实体掉血:不是我们打的那只
      em.emit('entityHurt', { id: 99 });
    })).toBe(true);
    await sleep(500); // 出刀之后隔了半秒,已经出了一个往返的窗口
    em.emit('entityHurt', { id: 7 });
    session.stop();
    expect(diag.after(0).find((e) => e.event === 'end')!.data!.landed).toBe(0);
  }, 15_000);
});

/**
 * 服务端近战在 reach≤3 时不检查遮挡；客户端视线断开时须停止挥刀，也不能将隔墙目标记作够得着。
 */
describe('战斗:隔着方块不出手', () => {
  it('射线被方块挡住:够得着也不挥;视线恢复才开打', async () => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.5)]);
    let blocked = true;
    (bot as unknown as Record<string, unknown>).world = {
      raycast: () => (blocked ? { position: { x: 1, y: 64, z: 0 } } : null),
    };
    const { session } = rig(bot);
    session.onHurtBy(7, 'zombie');
    await drive(bot as unknown as EventEmitter, 1_200);
    expect(attacks.length).toBe(0);
    blocked = false;
    await drive(bot as unknown as EventEmitter, 1_500);
    expect(attacks.length).toBeGreaterThan(0);
    session.stop();
  }, 15_000);
});

/**
 * 水中撤退须按跳键向岸游；连续受击且敌人贴身时转为还手，血线不再阻止。
 */
describe('战斗:水里与逃不掉', () => {
  const require = createRequire(import.meta.url);
  const Block = require('prismarine-block')('1.21.1');
  const data = require('minecraft-data')('1.21.1');
  const block = (name: string) => Block.fromProperties(data.blocksByName[name].id, name === 'water' ? { level: 0 } : {}, 0);
  /** 头在水面上、脚泡在水里的假 bot;x≥5 是岸 */
  function swimRigBot(foes: FakeFoe[] = []) {
    const r = combatRigBot(foes);
    (r.bot as unknown as Record<string, unknown>).blockAt = (p: { x: number; y: number }) => {
      const onLand = p.x >= 5;
      if (p.y >= 65) return block('air');
      if (p.y === 64) return onLand
        ? block('air')
        : block('water');
      if (p.y === 63) return onLand
        ? block('stone')
        : block('water');
      return block('stone');
    };
    return r;
  }

  function deepRig() {
    const r = combatRigBot([foe(7, 'drowned', -2)]), b = r.bot as any;
    b.entity.position = new Vec3(.12, 64.68, .75); b.entity.onGround = false;
    b.health = 9; b.heldItem = null; b.inventory.items = () => [];
    const overrides = new Map<string, string | null>();
    b.blockAt = (p: Vec3) => {
      const [x, y, z] = [p.x, p.y, p.z].map(Math.floor), key = `${x},${y},${z}`;
      const name = overrides.has(key) ? overrides.get(key) : x >= 5 && y < 65 ? 'stone' : y <= 64 ? 'water' : 'air';
      return name === null ? null : block(name!);
    };
    return { ...r, b, overrides };
  }

  it('water-to-bank keeps native controls through the fractional shoreline then requires terrestrial support', async () => {
    const { bot, b, controls } = deepRig();
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'drowned');
    for (const x of [.12, 2.5, 4.2, 4.69]) {
      b.entity.position.x = x;
      await drive(bot, 300);
      expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(true);
      expect((session as any).movementIntent.x).toBeGreaterThan(0);
      expect(controls.jump).toBe(true);
    }
    b.entity.position = new Vec3(5.5, 65, .75); b.entity.onGround = true;
    await drive(bot, 300);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(true);
    expect(calls.suspended).toBe(1); expect(calls.resumed).toBe(0);
    session.stop();
  });

  it.each(['stone', 'lava', 'fire', null] as const)('deep water rejects known obstruction, hazard or unknown body corridor: %s', async name => {
    const { bot, b, controls, overrides } = deepRig();
    // Surround the actual body, including above its fractional head height.
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 64; y <= 67; y++) {
      if (x < -1 || x > 0 || z < 0 || z > 1) overrides.set(`${x},${y},${z}`, name);
    }
    const { session } = rig(bot);
    session.onHurtBy(7, 'drowned'); await drive(bot, 300);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(false);
    expect((session as any).movementIntent).toBeNull();
    session.stop();
  });

  it('checks the actual quantized direction and fractional head/side footprint, with no dry ledge bypass', () => {
    const { bot, b, overrides } = deepRig(); const { session } = rig(bot);
    b.entity.position = new Vec3(.75, 64.68, .75); b.entity.yaw = 0;
    const safe = (x: number, z: number) => (session as any).movementSafe(bot, x, z, false, 2.1);
    expect(safe(1, .4)).toBe(true);
    // Requested 1,.4 quantizes to 1,1: this lies in that actual diagonal body sweep.
    overrides.set('2,66,2', 'stone'); expect(safe(1, .4)).toBe(false);
    overrides.clear(); overrides.set('1,66,1', 'stone'); expect(safe(1, 0)).toBe(false);
    overrides.clear(); overrides.set('1,64,1', 'lava'); expect(safe(1, 0)).toBe(false);
    overrides.clear(); b.blockAt = (p: Vec3) => block(Math.floor(p.x) <= 0 && Math.floor(p.y) <= 64 ? 'water' : 'air');
    expect(safe(1, 0)).toBe(false);
    // The final sweep still touches water behind the body; its dry endpoint is unsupported.
    expect((session as any).movementSafe(bot, 1, 0, false, .55)).toBe(false);
    session.stop();
  });

  it('reports retreat-only sampled facts and exact native death ID before teardown without resuming cancelled work', async () => {
    const { bot, b, controls } = deepRig();
    b.respawn = () => {};
    const lifecycle = installDeathLifecycle(b, 4000, () => true);
    const { session, combatReports, calls } = rig(bot);
    session.onHurtBy(7, 'drowned'); await drive(bot, 600);
    b.health = 0; bot.emit('death');
    const r = combatReports[0];
    expect(r).toMatchObject({ reason: 'death', deathEpisodeId: b.deathLifecycle.episodeId, swings: 0, healthBefore: 9, healthAfter: 0,
      controlSummary: { finalMode: 'retreating', enteredDesperate: false, retreat: { waterAtStart: true, routeStatus: 'unverified' } } });
    expect(r.controlSummary!.retreat!.bankCandidate).not.toBeNull();
    expect(r.controlSummary!.retreat!.movement.samples).toBeGreaterThan(0);
    expect(r.controlSummary!.retreat!.movement.horizontalIntentSamples).toBeGreaterThan(0);
    expect(r.controlSummary!.retreat!.movement.observedHorizontalDistance).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(r.controlSummary))).toBeLessThanOrEqual(2048);
    expect(calls.resumed).toBe(0);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(false);
    b.health = 9; bot.emit('respawn'); bot.emit('spawn'); session.onHurtBy(7, 'drowned'); session.stop();
    expect(combatReports[1].deathEpisodeId).toBeUndefined();
    lifecycle.dispose();
  });

  it('deep water retreat applies horizontal controls with a real nearby bank and original fractional footprint', async () => {
    const enemy = foe(7, 'drowned', -14.5, 285.75); enemy.position.y = 62;
    const { bot, controls, attacks } = combatRigBot([enemy]);
    const b = bot as any;
    b.entity.position = new Vec3(-12.098910593411883, 62.68288979426175, 285.74739562800346);
    b.entity.onGround = false;
    b.health = 9; b.heldItem = null; b.inventory.items = () => [];
    b.blockAt = (p: Vec3) => {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      return block(x >= -7 && y < 63 ? 'stone' : y <= 62 ? 'water' : 'air');
    };
    const diag = new MinecraftLog();
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'drowned');
    await drive(bot, 300);
    expect(diag.after(0).some(e => e.event === 'retreat-to-bank')).toBe(true);
    expect(['forward', 'back', 'left', 'right'].some(k => controls[k])).toBe(true);
    expect(diag.after(0).filter(e => e.event === 'trajectory').some(e => (e.data as any).intent !== null)).toBe(true);
    expect(controls.jump).toBe(true);
    expect(attacks).toEqual([]);
    session.stop();
  });

  it('低血在水里被打:撤退带登岸目标,水里按住跳不沉底', async () => {
    const diag = new MinecraftLog();
    const { bot, controls } = swimRigBot([foe(7, 'drowned', 2.5)]);
    (bot as unknown as { health: number }).health = 5;
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'drowned');
    expect(session.active).toBe(true); // 血线拒战也不是不管:转撤退
    await drive(bot as unknown as EventEmitter, 300);
    expect(diag.after(0).some((e) => e.event === 'retreat-to-bank')).toBe(true);
    expect(controls.jump).toBe(true); // 水里不按跳就往下沉
    session.stop();
  }, 15_000);

  it('撤退路上挨两下、怪还贴着:转身还手,血线不再把人按回撤退', async () => {
    const diag = new MinecraftLog();
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 1.8)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie'); // 血线拒战 → 撤退
    await drive(bot as unknown as EventEmitter, 1_600);
    session.onHurtBy(7, 'zombie'); // 撤退路上还在挨打
    session.onHurtBy(7, 'zombie');
    await drive(bot as unknown as EventEmitter, 400);
    expect(diag.after(0).some((e) => e.event === 'cornered')).toBe(true);
    expect(events.some((e) => e.text.includes('回头打'))).toBe(true);
    // 血 5/20 也照打:E2 对本场静默,挥得出刀
    await drive(bot as unknown as EventEmitter, 1_500);
    expect(attacks.length).toBeGreaterThan(0);
    session.stop();
  }, 15_000);
});

/**
 * 空手且低血时，受击的默认反应是脱离。
 */
describe('空手低血:挨打的默认反应改成脱离', () => {
  it('低血撤退前先给即时防护技能一次机会', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    (bot as unknown as { health: number }).health = 7;
    (bot as unknown as { heldItem: unknown; inventory: { items(): unknown[] } }).heldItem = null;
    (bot as unknown as { inventory: { items(): unknown[] } }).inventory.items = () => [];
    const observed: number[] = [];
    const { session } = rig(bot, {}, undefined, undefined, (current) => {
      observed.push((current as { health: number }).health);
    });
    session.onHurtBy(7, 'zombie');
    expect(observed).toEqual([7]);
    expect(session.active).toBe(true);
    session.stop();
  });
  function bareHanded(foes: Parameters<typeof combatRigBot>[0], health: number) {
    const r = combatRigBot(foes);
    (r.bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [];
    (r.bot as unknown as { heldItem: unknown }).heldItem = null;
    (r.bot as unknown as { health: number }).health = health;
    return r;
  }

  it('空手 + 血低于入场线:不还手,当场撤,并说明为什么', () => {
    const diag = new MinecraftLog();
    // 11 落在「挨打还手线 10」与「主动进场线 13」之间:有家伙就照打,空手就不打
    const { bot } = bareHanded([foe(7, 'zombie', 2.2)], 11);
    const { session, events, calls } = rig(bot, {}, diag);
    expect(session.onHurtBy(7, 'zombie')).toBe(true); // 会话仍接手(不退回反射自己抡)
    expect(session.active).toBe(true);
    expect(calls.suspended).toBe(1);
    expect(events[0].text).toContain('空手');
    expect(events[0].text).toContain('不还手');
    expect(events[0].text).not.toContain('抄家伙');
    expect(diag.after(0).some((e) => e.event === 'barehand-flee')).toBe(true);
    session.stop();
  });

  it('空手第一击后即撤退，不等到低血', () => {
    const { bot, attacks } = bareHanded([foe(7, 'zombie', 2.2)], 17);
    const { session } = rig(bot);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(session.reactionState().retreating).toBe(true);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it.each(['hurt', 'tick'] as const)('交战中武器损失由 %s 重新判断，空手及时撤离', async (trigger) => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session } = rig(bot);
    session.onHurtBy(7, 'zombie');
    expect(session.fighting).toBe(true);
    Object.assign(bot, { heldItem: null, health: 17, inventory: { items: () => [], slots: [] } });
    if (trigger === 'hurt') session.onHurtBy(7, 'zombie');
    else await drive(bot, 50);
    expect(session.reactionState().retreating).toBe(true);
    expect(attacks).toHaveLength(0);
    session.stop();
  });

  it('空手但远程可用仍可自卫，显式攻击任务仍持有身体', () => {
    const ranged = rangedRig();
    const a = bareHanded([foe(7, 'skeleton', 12)], 17);
    const first = rig(a.bot, {}, undefined, ranged.actions);
    first.session.onHurtBy(7, 'skeleton');
    expect(first.session.fighting).toBe(true);
    first.session.stop();
    const b = bareHanded([foe(7, 'zombie', 2.2)], 17);
    const second = rig(b.bot);
    second.setTaskFighting(true);
    expect(second.session.onHurtBy(7, 'zombie')).toBe(true);
    expect(second.session.active).toBe(false);
    expect(second.calls.suspended).toBe(0);
  });

  it.each([false, true])('撤退跳跃侧向抖动不能冒充前进，真实前进不误封锁 (%s)', async (advancing) => {
    const { bot } = bareHanded([foe(7, 'zombie', 7)], 5);
    const diag = new MinecraftLog({ log });
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    const body = (bot as unknown as Bot).entity;
    const internal = session as unknown as { movementIntent: { x: number; z: number }; blockedHeadings: unknown[] };
    bot.emit('physicsTick');
    const original = { ...internal.movementIntent };
    for (let i = 0; i < 30; i++) {
      const intent = internal.movementIntent;
      if (intent) {
        const jitter = i % 2 ? 0.12 : -0.12;
        body.position.x += advancing ? intent.x * 0.08 : -intent.z * jitter;
        body.position.z += advancing ? intent.z * 0.08 : intent.x * jitter;
      }
      body.position.y = 64 + (i % 2 ? 0.2 : 0);
      body.onGround = false;
      await drive(bot, 50);
    }
    expect(diag.after(0).some(e => e.event === 'wall-stall')).toBe(!advancing);
    if (!advancing) {
      expect(internal.blockedHeadings.length).toBeGreaterThan(0);
      expect(internal.movementIntent.x * original.x + internal.movementIntent.z * original.z).toBeLessThan(0.9);
    }
    session.stop();
  });

  it('同一条血线上有家伙就照打:闸分的是手上有没有东西,不是血本身', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]); // 包里有铁剑
    (bot as unknown as { health: number }).health = 11;
    const { session, events } = rig(bot);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(events[0].text).toContain('抄家伙还手'); // 挨打不加入场余量,照旧还手
    expect(events[0].text).not.toContain('空手');
    session.stop();
  });

  it('血再低一档:有家伙走原来的血线拒战那一支,措辞不变', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    (bot as unknown as { health: number }).health = 6;
    const { session, events } = rig(bot);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(events[0].text).toContain('这架不接了');
    session.stop();
  });

  it('三档 fight 不受影响:off 档空手低血挨打仍走脱离,不是"什么都不做"', () => {
    const { bot } = bareHanded([foe(7, 'zombie', 2.2)], 11);
    const { session, events } = rig(bot, { fight: 'off' });
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(events[0].text).toContain('不还手');
    session.stop();
  });
});

/**
 * queue:"now" 让战斗交还身体；低血时只让位给进食和撤离首步。
 */
describe('standDown:queue:"now" 夺手', () => {
  it('容器游标无法归还时保留物品与窗口，不开始消费', async () => {
    const { bot } = combatRigBot([]);
    const apple = { name: 'golden_apple', type: 2, count: 2 };
    const cursor = { name: 'diamond', type: 3, count: 1, stackSize: 64 };
    const window = { id: 1, inventoryStart: 0, inventoryEnd: 0, slots: [], selectedItem: cursor };
    Object.assign(bot, { currentWindow: window, inventory: { items: () => [apple], slots: [] },
      closeWindow: () => { Object.assign(bot, { currentWindow: null }); },
      consume: async () => { apple.count -= 1; } });
    Object.assign((bot as unknown as Bot).registry, { foodsByName: { golden_apple: { foodPoints: 4 } } });
    await expect(skillEat(bot, 'golden_apple')).rejects.toThrow('游标');
    expect((bot as unknown as Bot).currentWindow).toBe(window);
    expect(window.selectedItem).toBe(cursor);
    expect(apple.count).toBe(2);
    expect((bot as unknown as Bot).heldItem?.name).toBe('iron_sword');
  });

  it.each(['eat', 'flee', 'surface'] as const)('低血撤退可交还给即时 %s，不恢复旧任务抢跑', (skill) => {
    const { bot, controls } = combatRigBot([foe(7, 'skeleton', 7)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, calls, combatReports } = rig(bot);
    session.onHurtBy(7, 'skeleton');
    session.onHurtBy(7, 'skeleton');
    expect(session.active).toBe(true);
    const step = skill === 'eat' ? { skill, item: 'golden_apple' } as const
      : skill === 'flee' ? { skill, distance: 8 } as const : { skill } as const;
    expect(session.standDown(step)).toBe('正在跟怪打');
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0);
    expect(combatReports).toHaveLength(1);
    expect(combatReports[0]).toMatchObject({ reason: 'preempt', healthBefore: 5, healthAfter: 5 });
    expect(Object.values(controls).every((pressed) => !pressed)).toBe(true);
    session.stop();
  });

  it('环境自保持有时即使即时进食也不夺走身体', () => {
    const { bot } = combatRigBot([foe(7, 'skeleton', 7)]);
    const r = rig(bot);
    r.session.onHurtBy(7, 'skeleton');
    r.setEnvBusy(true);
    expect(r.session.standDown({ skill: 'eat', item: 'golden_apple' })).toBeNull();
    expect(r.session.active).toBe(true);
    r.session.stop();
  });

  it.each([true, false])('真实执行器急救进食确认=%s：受击不换剑，保留待办并恢复控制', async (confirmed) => {
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const native = bot as unknown as Bot;
    const bag = [{ name: 'iron_sword', type: 1, count: 1 }, { name: 'golden_apple', type: 2, count: 2 }];
    const said: string[] = [];
    const reports: TaskReport[] = [];
    Object.assign(bot, {
      food: 16, game: { dimension: 'overworld' }, effects: {},
      currentWindow: { id: 1, inventoryStart: 54, inventoryEnd: 90, selectedItem: null },
      closeWindow: () => { Object.assign(bot, { currentWindow: null }); },
      inventory: { items: () => bag, slots: Array(46).fill(null) },
      equip: async (item: unknown) => { Object.assign(bot, { heldItem: item }); },
      chat: (text: string) => { said.push(text); },
      deactivateItem: () => {},
      consume: async () => {
        if (native.currentWindow) throw new Error('容器窗口仍开着，服务端未使用食物');
        await new Promise((resolve) => setTimeout(resolve, 1_600));
        if (native.heldItem?.name !== 'golden_apple') throw new Error('主手被换掉');
        if (!confirmed) throw new Error('消费被服务端拒绝');
        bag[1].count -= 1;
        Object.assign(bot, { food: 20, health: 13, effects: { 10: { id: 10, amplifier: 1, duration: 100 } } });
      },
    });
    Object.assign(native.registry, { foodsByName: { golden_apple: { foodPoints: 4 } } });
    let id = 0;
    let exec: Executor;
    const session = new CombatSession({
      getBot: () => native,
      tuning: () => ({ enabled: true, engageRadius: 3, chaseMax: 6, maxSec: 30, space: 2.6,
        busyRatio: 60, cooldownSec: 60, fleeHealth: 10, fight: 'auto', arena: true }),
      envBusy: () => false,
      taskEscaping: () => exec?.escaping ?? false,
      taskEating: () => exec?.eating ?? false,
      suspendTasks: (reason) => exec.suspend(reason),
      resumeTasks: () => exec.resume(), emit: () => {}, log,
    });
    exec = new Executor({ getBot: () => native, report: (r) => reports.push(r), log, nextId: () => ++id,
      busyWith: () => session.active ? '正在跟怪打' : null,
      stopCombat: (first) => session.standDown(first) });
    session.onHurtBy(7, 'zombie');
    Object.assign(bot, { health: 5 });
    exec.submit([{ skill: 'chat', text: '救急后继续的待办' }], 'append');
    const receipt = exec.submit([{ skill: 'eat', item: 'golden_apple' }], 'now');
    expect(receipt).toContain('已经放开手');
    expect(receipt).not.toContain('排上了');
    await waitUntil(() => exec.eating && native.heldItem?.name === 'golden_apple');
    expect(native.currentWindow).toBeNull();
    session.start();
    for (let i = 0; i < 5; i++) {
      session.onHurtBy(7, 'zombie');
      native.emit('physicsTick');
      await sleep(200);
      expect(session.active).toBe(false);
      expect(native.heldItem?.name).toBe('golden_apple');
    }
    expect(attacks).toEqual([]);
    expect(said).toEqual([]);
    await waitUntil(() => reports.length === 2);
    expect(reports[0].kind).toBe(confirmed ? 'done' : 'blocked');
    expect(reports[0].text).toContain(confirmed ? '吃了一个金苹果' : '消费被服务端拒绝');
    expect(bag[1].count).toBe(confirmed ? 1 : 2);
    expect(said).toEqual(['救急后继续的待办']);
    expect(exec.eating).toBe(false);
    await sleep(300);
    expect(session.active).toBe(true);
    if (confirmed) expect(native.heldItem?.name).toBe('iron_sword');
    session.stop();
    exec.shutdown();
  });

  it('当场交还身体但不恢复旧断点，并把刚才在做什么交回给受理回执', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    expect(session.active).toBe(true);
    expect(session.standDown()).toBe('正在跟怪打');
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0); // 抢占方负责启动新意图，旧断点不能在这里抢跑
    expect(diag.after(0).some((e) => e.event === 'stand-down')).toBe(true);
    session.stop();
  });

  it('交还之后不出「接着做」那一句:它紧接着就被新任务顶掉了', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session, events } = rig(bot);
    session.onHurtBy(7, 'zombie');
    session.standDown();
    expect(events.some((e) => e.text.includes('接着做'))).toBe(false);
    expect(events.some((e) => e.text.includes('先不打了'))).toBe(true);
    session.stop();
  });

  it('交还之后留一段宽限:250ms 巡检不会立刻把刚开跑的那一单再挂起', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    session.standDown();
    session.start();
    await sleep(700);
    expect(session.active).toBe(false);
    expect(calls.suspended).toBe(1); // 只有最初那一次
    session.stop();
  });

  it('本来就没在打:返回 null,不惊动任何东西', () => {
    const { bot } = combatRigBot([]);
    const { session, calls } = rig(bot);
    expect(session.standDown()).toBeNull();
    expect(calls.resumed).toBe(0);
    session.stop();
  });

  it('低血撤退不交手:now 排在脱身后,不重置撤退会话', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 7)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    session.onHurtBy(7, 'skeleton');
    expect(session.active).toBe(true);

    expect(session.standDown()).toBeNull();

    expect(session.active).toBe(true);
    expect(calls.resumed).toBe(0);
    expect(diag.after(0).some((e) => e.event === 'stand-down-deferred')).toBe(true);
    // 会话仍认得撤退中的伤害，后续同一来源继续由它接手。
    expect(session.onHurtBy(7, 'skeleton')).toBe(true);
    session.stop();
  });

  it('撤退里 10 秒没挨打、血也在线:now 能把身体要回去', () => {

    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 10)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton'); // 血线拒战 → 撤退
    expect(session.active).toBe(true);
    (bot as unknown as { health: number }).health = 15;
    Object.assign(session as unknown as Record<string, unknown>, { retreatLastHurtAt: Date.now() - 11_000 });

    expect(session.standDown()).toBe('正在跟怪打');

    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(0);
    expect(diag.after(0).some((e) => e.event === 'stand-down-deferred')).toBe(false);
    expect(diag.after(0).some((e) => e.event === 'stand-down')).toBe(true);
    session.stop();
  });

  it('撤退里刚挨过打:now 仍排在脱身后', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 10)]);
    (bot as unknown as { health: number }).health = 5;
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    (bot as unknown as { health: number }).health = 15;
    Object.assign(session as unknown as Record<string, unknown>, { retreatLastHurtAt: Date.now() - 2_000 });

    expect(session.standDown()).toBeNull();
    expect(session.active).toBe(true);
    expect(diag.after(0).find((e) => e.event === 'stand-down-deferred')?.msg).toContain('刚挨过打');
    session.stop();
  });

  it('够不着收工之后留一段冷却:圈里那只下一拍不会再把她拖进去', async () => {

    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    const { session, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    expect(session.active).toBe(true);
    (session as unknown as { end(reason: string): void }).end('stuck');
    expect(session.active).toBe(false);

    session.start();
    await sleep(700);
    expect(session.active).toBe(false);
    expect(calls.suspended).toBe(1); // 只有最初那一次
    expect(session.onHurtBy(7, 'zombie')).toBe(true); // 挨打自卫不受主动接战冷却限制
    session.stop();
  });
});

describe('撤退:安全结束与失败升级', () => {
  it('退路正后方是墙时选择可走的侧向，不持续顶墙', () => {
    const { bot, controls } = combatRigBot([foe(7, 'zombie', 2)]);
    (bot as unknown as { health: number }).health = 5;
    (bot as unknown as { blockAt: (p: Vec3) => object }).blockAt = (p) => ({
      name: p.y < 64 || (p.x < 0 && p.y <= 65) ? 'stone' : 'air',
      boundingBox: p.y < 64 || (p.x < 0 && p.y <= 65) ? 'block' : 'empty',
    });
    const { session } = rig(bot);
    session.onHurtBy(7, 'zombie');
    (bot as unknown as EventEmitter).emit('physicsTick');
    expect(controls.left).not.toBe(true);
    expect(controls.forward || controls.back || controls.right).toBe(true);
    session.stop();
  });

  it('完全无退路且刚受击，停下回身迎敌，不无限面壁', async () => {
    const diag = new MinecraftLog();
    const { bot, controls } = combatRigBot([foe(7, 'zombie', 2)]);
    (bot as unknown as { health: number }).health = 5;
    (bot as unknown as { blockAt: (p: Vec3) => object }).blockAt = (p) => {
      const blocked = p.y < 64 || ((p.x < 0 || p.x >= 1 || p.z < 0 || p.z >= 1) && p.y <= 65);
      return { name: blocked ? 'stone' : 'air', boundingBox: blocked ? 'block' : 'empty' };
    };
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    await drive(bot as unknown as EventEmitter, 1_700);
    expect(diag.after(0).some((e) => e.event === 'cornered')).toBe(true);
    expect(controls.forward).not.toBe(true);
    session.stop();
  });

  it('远程骷髅射中后撤退 1.5 秒无位移:及时回身处理威胁', async () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 7)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    await drive(bot as unknown as EventEmitter, 1_650);
    (bot as unknown as EventEmitter).emit('physicsTick');

    const cornered = diag.after(0).find((e) => e.event === 'cornered');
    expect(cornered?.data).toMatchObject({ cause: 'stalled', foe: 'skeleton' });
    expect(cornered?.data).toMatchObject({ hits: 0 });
    expect(events.some((e) => e.text.includes('远处压着我') && e.text.includes('回头打'))).toBe(true);
    expect(session.active).toBe(true);
    expect(calls.resumed).toBe(0);
    session.stop();
  }, 10_000);

  it('远程怪在常规追击圈外打中时，不按周围无敌人原地等待并提前收工', async () => {
    const { bot } = combatRigBot([foe(7, 'skeleton', 13)]);
    const { session } = rig(bot);
    expect(session.onHurtBy(7, 'skeleton')).toBe(true);
    await drive(bot as unknown as EventEmitter, 3_250);
    expect(session.active).toBe(true);
    session.stop();
  });

  it('堵住直到撤退时限:时限只升级策略,威胁仍近时不报跑开、不恢复任务', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'zombie', 5)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    Object.assign(session as unknown as Record<string, unknown>, {
      retreatStartedAt: Date.now() - 9_000,
      retreatProgressAt: Date.now() - 9_000,
    });

    (bot as unknown as EventEmitter).emit('physicsTick');

    // RETREAT_MAX_MS 到期只升级提示，不因此判为 cornered 或转身还手。
    expect(diag.after(0).find((e) => e.event === 'cornered')).toBeUndefined();
    expect(diag.after(0).find((e) => e.event === 'retreat-extended')?.data)
      .toMatchObject({ why: 'flee' });
    expect(events.some((e) => e.text.includes('回头打'))).toBe(false);
    expect(events.some((e) => e.text.includes('跑开了'))).toBe(false);
    expect(session.active).toBe(true);
    expect(calls.resumed).toBe(0);
    session.stop();
  });

  it('撤退跑满时限但怪已经拉开:不转身还手,继续撤,也不报跑开', () => {
    const diag = new MinecraftLog();
    const { bot, attacks } = combatRigBot([foe(7, 'skeleton', 14.7)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    Object.assign(session as unknown as Record<string, unknown>, {
      retreatStartedAt: Date.now() - 9_000,
      retreatProgressAt: Date.now() - 9_000,
    });

    (bot as unknown as EventEmitter).emit('physicsTick');

    // 血 5/20 冲 14.7 格外的骷髅是自造的死亡主线:一下没挨、拉开到近 15 格,
    // 撤退在客观上是成功的
    expect(diag.after(0).some((e) => e.event === 'cornered')).toBe(false);
    expect(attacks.length).toBe(0);
    expect(events.some((e) => e.text.includes('回头打'))).toBe(false);
    session.stop();
  });

  it('空手低血被堵住:入场侧那道空手闸 cornered 也认,不转身空手对砍', async () => {
    const diag = new MinecraftLog();
    const { bot, attacks } = combatRigBot([foe(7, 'zombie', 1.8)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie'); // 手上还有剑:血线拒战 → 撤退
    // 撤退开始不久剑没了(掉耐久断了/被换手):空手 + 血 5 低于 fleeHealth(10)+3
    (bot as unknown as Record<string, unknown>).heldItem = null;
    (bot as unknown as { inventory: { items: () => unknown[] } }).inventory.items = () => [];
    await drive(bot as unknown as EventEmitter, 1_600);
    session.onHurtBy(7, 'zombie');
    session.onHurtBy(7, 'zombie');
    await drive(bot as unknown as EventEmitter, 400);

    expect(diag.after(0).some((e) => e.event === 'cornered')).toBe(false);
    expect(diag.after(0).find((e) => e.event === 'cornered-barehand')?.data)
      .toMatchObject({ foe: 'zombie', health: 5 });
    expect(events.some((e) => e.text.includes('回头打'))).toBe(false);
    expect(attacks.length).toBe(0);
    session.stop();
  }, 15_000);

  it('威胁真正拉开并守住无伤时窗后才结束、恢复任务', async () => {
    const zombie = foe(7, 'zombie', 2.5);
    const { bot } = combatRigBot([zombie]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events, calls } = rig(bot);
    session.onHurtBy(7, 'zombie');
    zombie.position = new Vec3(40, 64, 0.5);

    await drive(bot as unknown as EventEmitter, 800);
    expect(session.active).toBe(true);
    expect(calls.resumed).toBe(0);
    await drive(bot as unknown as EventEmitter, 1_000);

    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(1);
    expect(events.some((e) => e.text.includes('跑开了'))).toBe(true);
    session.stop();
  }, 10_000);

  it('跑不动也没人打:撤退到时收工还身体,不再无限持有', () => {
    // 远处上层的骷髅不离开范围也不再次命中，玩家无法移动；夹具覆盖常规撤退出口均未满足的状态。
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 10)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, events, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    (bot as unknown as { health: number }).health = 15;
    Object.assign(session as unknown as Record<string, unknown>, {
      retreatStartedAt: Date.now() - 12_000,
      retreatProgressAt: Date.now() - 12_000,
      retreatLastHurtAt: Date.now() - 11_000,
    });

    (bot as unknown as EventEmitter).emit('physicsTick');

    expect(diag.after(0).find((e) => e.event === 'retreat-idle')?.data).toMatchObject({ why: 'flee', hits: 0 });
    expect(diag.after(0).find((e) => e.event === 'cornered')).toBeUndefined();
    expect(events.some((e) => e.text.includes('先把手还回去'))).toBe(true);
    expect(session.active).toBe(false);
    expect(calls.resumed).toBe(1);
    session.stop();
  });

  it('跑不动但 10 秒内挨过打:撤退照旧,只升级不收工', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'skeleton', 10)]);
    (bot as unknown as { health: number }).health = 5;
    const { session, calls } = rig(bot, {}, diag);
    session.onHurtBy(7, 'skeleton');
    Object.assign(session as unknown as Record<string, unknown>, {
      retreatStartedAt: Date.now() - 12_000,
      retreatProgressAt: Date.now() - 12_000,
      retreatLastHurtAt: Date.now() - 3_000,
    });

    (bot as unknown as EventEmitter).emit('physicsTick');

    expect(diag.after(0).find((e) => e.event === 'retreat-idle')).toBeUndefined();
    expect(diag.after(0).find((e) => e.event === 'retreat-extended')).toBeDefined();
    expect(session.active).toBe(true);
    expect(calls.resumed).toBe(0);
    session.stop();
  });
});

/**
 * 血量播报向上取整，与 HUD 半颗心显示一致；血线判定仍使用浮点原值。
 */
describe('血量播报向上取整', () => {
  it('0.086 血挨打:拒战文案与 diag 都写 1/20,不写 0/20', () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'zombie', 2.2)]);
    (bot as unknown as { health: number }).health = 0.086;
    const { session, events } = rig(bot, {}, diag);
    expect(session.onHurtBy(7, 'zombie')).toBe(true);
    expect(events[0].text).toContain('血只剩 1/20');
    expect(events[0].text).not.toContain('0/20');
    const refused = diag.after(0).find((e) => e.event === 'engage-refused');
    expect(refused?.msg).toContain('生命 1/20');
    expect(refused?.data).toMatchObject({ health: 0.086 });
    session.stop();
  });
});

describe('末地:龙只报不撤,撤退不朝悬崖跑', () => {
  it('末影龙打中:只播报(不急报),不挂起任务、不撤退', () => {
    const { bot } = combatRigBot([foe(9, 'ender_dragon', 2.5)]);
    const { session, events, calls } = rig(bot);
    expect(session.onHurtBy(9, 'ender_dragon')).toBe(false);
    expect(calls.suspended).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain('不在自动撤退之列');
    expect(events[0].urgent).toBe(false);
    session.stop();
  });

  /** x < 0 整柱是空的(岛边往下是虚空),其余 y < 64 是石头 */
  function cliffBlockAt(p: { x: number; y: number }) {
    if (p.x < 0 || p.y >= 64) return { name: 'air', boundingBox: 'empty' };
    return { name: 'stone', boundingBox: 'block' };
  }

  it('footingAhead:前方整柱空是悬崖,3 格内有实心算踩得住,落脚面是岩浆不算', () => {
    const { bot } = combatRigBot();
    const b = bot as unknown as { blockAt: unknown };
    b.blockAt = cliffBlockAt;
    expect(footingAhead(bot, -1, 0)).toBe(false);
    expect(footingAhead(bot, 1, 0)).toBe(true);
    b.blockAt = (p: { y: number }) => (p.y === 62
      ? { name: 'lava', boundingBox: 'empty' }
      : p.y < 62 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' });
    expect(footingAhead(bot, 1, 0)).toBe(false);
  });

  it('背对怪群那边是悬崖:撤退改走侧面,记一条 retreat-edge', async () => {
    const diag = new MinecraftLog();
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5)]);
    (bot as unknown as { health: number }).health = 5;
    (bot as unknown as { blockAt: unknown }).blockAt = cliffBlockAt;
    const { session } = rig(bot, {}, diag);
    session.onHurtBy(7, 'zombie');
    expect(session.active).toBe(true);
    await drive(bot as unknown as EventEmitter, 300);
    const edge = diag.after(0).find((e) => e.event === 'retreat-edge');
    expect(edge?.msg).toContain('改走侧面');
    session.stop();
  }, 15_000);
});

describe('异步战术动作共用战斗控制器', () => {
  it('can approach a visible 7.7-block enemy and attack before any hurt event, within the existing pursuit pool', async () => {
    const enemy = foe(7, 'zombie', 8.2), { bot, controls, attacks } = combatRigBot([enemy]);
    const r = rig(bot); // Production defaults: chaseMax 6, existing pursuit pool 10.
    try {
      expect(r.session.fighting).toBe(false);
      expect(r.session.engagementTargets()).toEqual([7]);
      expect(r.session.react({kind:'engage',targetId:7})).toBe(true);
      await drive(bot, 200);
      expect(r.session.fighting).toBe(true);
      expect(['forward','back','left','right'].some(k=>controls[k])).toBe(true);
      enemy.position = new Vec3(.5,64,3);
      bot.entity.velocity.y = -.1;
      await drive(bot, 900);
      expect(attacks).toContain(7);
      expect(bot.health).toBe(20);
      expect(r.calls.suspended).toBe(1);
      expect(r.events.some(e=>e.text.includes('打过来了'))).toBe(false);
      enemy.isValid = false;
      await drive(bot, 3600);
      expect(r.calls.resumed).toBe(1);
    } finally { r.session.stop(); }
    const far = rig(combatRigBot([foe(8,'zombie',10.6)]).bot);
    try { expect(far.session.engagementTargets()).toEqual([]); } finally { far.session.stop(); }
  });
  it('跟随与撤离候选沿用真实挑衅判据，不因末影人的类型标签产生无法执行的选择', () => {
    const { bot, attacks } = combatRigBot([foe(7, 'enderman', 5)]);
    const r = rig(bot);
    const track = { kind: 'track' as const, targetId: 7, uuid: null, minDistance: 5, maxDistance: 8, leaseMs: 4000 };
    expect(r.session.trackingTargets()).toEqual([]);
    expect(r.session.canRetreat()).toBe(false);
    expect(r.session.react(track)).toBe(false);
    expect(r.calls.suspended).toBe(0);
    (bot as unknown as Bot).entities[8] = foe(8, 'zombie', 7) as never;
    expect(r.session.trackingTargets()).toEqual([8]);
    expect(r.session.canRetreat()).toBe(true);
    r.setTaskFighting(true);
    expect(r.session.trackingTargets()).toEqual([]);
    expect(r.session.canRetreat()).toBe(false);
    r.setTaskFighting(false);
    expect(r.session.react({ ...track, targetId: 8 })).toBe(true);
    expect(attacks).toEqual([]);
    r.session.stop();
  });

  it('观望不要求攻击许可，但入场冷却和低血量不能隐式变成跟随受理', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 6)]);
    const r = rig(bot, { fight: 'off' });
    expect(r.session.engagementTargets()).toEqual([]);
    expect(r.session.trackingTargets()).toEqual([7]);
    (r.session as unknown as { capCooldownUntil: number }).capCooldownUntil = Date.now() + 1000;
    expect(r.session.trackingTargets()).toEqual([]);
    (r.session as unknown as { capCooldownUntil: number }).capCooldownUntil = 0;
    (bot as unknown as Bot).health = 8;
    expect(r.session.trackingTargets()).toEqual([]);
    expect(r.session.canRetreat()).toBe(true);
    expect(r.session.react({ kind: 'track', targetId: 7, uuid: null, minDistance: 5, maxDistance: 8, leaseMs: 4000 })).toBe(false);
    expect(r.calls.suspended).toBe(0);
    r.session.stop();
  });

  it('rechecks weapons at fast engagement admission without disabling withdrawal or explicit task combat', () => {
    const {bot,attacks}=combatRigBot([foe(7,'zombie',5)]);
    const r=rig(bot);
    (bot as any).inventory.items=()=>[];(bot as any).heldItem=null;
    expect(r.session.react({kind:'engage',targetId:7})).toBe(false);
    expect(r.calls.suspended).toBe(0);expect(attacks).toHaveLength(0);
    expect(r.session.react({kind:'retreat'})).toBe(true);
    r.session.stop();
  });
  it('接敌候选沿用控制器的中立生物、危险目标和距离判据，采样不接管身体', () => {
    const { bot } = combatRigBot([foe(7, 'enderman', 3), foe(8, 'zombie', 5.5),
      foe(9, 'warden', 3), foe(10, 'zombie', 20)]);
    const r = rig(bot);
    expect(r.session.engagementTargets()).toEqual([8]);
    expect(r.session.active).toBe(false);
    expect(r.calls.suspended).toBe(0);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(false);
    expect(r.session.react({ kind: 'engage', targetId: 8 })).toBe(true);
    expect(r.session.engagementTargets()).toEqual([8]);
    r.session.stop();
  });

  it('keeps an explicitly selected valid target through controller ticks and permits retargeting', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5), foe(8, 'zombie', 5.5)]);
    const r = rig(bot);
    try {
      expect(r.session.react({ kind: 'engage', targetId: 8 })).toBe(true);
      await drive(bot, 200);
      expect(r.session.reactionState().targetId).toBe(8);
      expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(true);
      await drive(bot, 100);
      expect(r.session.reactionState().targetId).toBe(7);
      expect(r.calls.suspended).toBe(1);
    } finally { r.session.stop(); }
  });

  it('does not keep a selected unknown-UUID entity after its numeric ID is reused', async () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 2.5), foe(8, 'zombie', 5.5)]);
    const r = rig(bot);
    try {
      expect(r.session.react({ kind: 'engage', targetId: 8 })).toBe(true);
      await drive(bot, 100);
      expect(r.session.reactionState().targetId).toBe(8);
      bot.entities[8] = foe(8, 'zombie', 5.5);
      await drive(bot, 100);
      expect(r.session.reactionState().targetId).toBe(7);
    } finally { r.session.stop(); }
  });

  it('接敌候选在身体占用、低血、未武装和策略关闭时均不提供', () => {
    const { bot } = combatRigBot([foe(7, 'zombie', 5.5)]);
    const r = rig(bot, { fight: 'armed' });
    r.setTaskFighting(true); expect(r.session.engagementTargets()).toEqual([]);
    r.setTaskFighting(false); r.setEnvBusy(true); expect(r.session.engagementTargets()).toEqual([]);
    r.setEnvBusy(false); r.setTaskEscaping(true); expect(r.session.engagementTargets()).toEqual([]);
    r.setTaskEscaping(false); (bot as unknown as Bot).health = 5;
    expect(r.session.engagementTargets()).toEqual([]);
    (bot as unknown as Bot).health = 20;
    (bot as unknown as Bot).inventory.items = () => [];
    expect(r.session.engagementTargets()).toEqual([]);
    r.session.stop();
    const off = rig(bot, { fight: 'off' });
    expect(off.session.engagementTargets()).toEqual([]);
    off.session.stop();
  });

  it('在近身自保圈外接敌后持续接近，环境与主动任务仍有优先权', async () => {
    const { bot, controls } = combatRigBot([foe(7, 'zombie', 5.5)]);
    const r = rig(bot);
    r.setTaskFighting(true);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(false);
    r.setTaskFighting(false); r.setEnvBusy(true);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(false);
    r.setEnvBusy(false);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(true);
    await drive(bot as unknown as EventEmitter, 50);
    expect(r.session.fighting).toBe(true);
    expect(Object.entries(controls).some(([key, pressed]) => ['forward', 'back', 'left', 'right'].includes(key) && pressed)).toBe(true);
    expect(r.calls.suspended).toBe(1);
    r.session.stop();
  });

  it('战术短步保持出手，危险落脚点与已释放的身体拒绝旧动作', async () => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 3)]);
    const cast = bot as unknown as Bot;
    cast.blockAt = (p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty',
      shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [], getProperties: () => ({}) })) as Bot['blockAt'];
    const r = rig(bot);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(true);
    expect(r.session.react({ kind: 'step', destination: [0.5, 64, 1.7] })).toBe(true);
    await drive(bot as unknown as EventEmitter, 1000);
    expect(attacks.length).toBeGreaterThan(0);
    cast.blockAt = () => null;
    expect(r.session.react({ kind: 'step', destination: [0.5, 64, 1.7] })).toBe(false);
    r.session.stop();
    expect(r.session.react({ kind: 'step', destination: [0.5, 64, 1.7] })).toBe(false);
    expect(Object.values(controls).every(pressed => !pressed)).toBe(true);
  });

  it('主动接敌遵守关闭策略和血线，战术撤退交给已有撤退控制器', () => {
    const b = combatRigBot([foe(7, 'zombie', 3)]);
    const off = rig(b.bot, { fight: 'off' });
    expect(off.session.react({ kind: 'engage', targetId: 7 })).toBe(false);
    off.session.stop();
    const r = rig(b.bot);
    (b.bot as unknown as Bot).health = 5;
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(false);
    (b.bot as unknown as Bot).health = 20;
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(true);
    expect(r.session.react({ kind: 'retreat' })).toBe(true);
    expect(r.session.reactionState().retreating).toBe(true);
    r.session.stop();
  });

  it('短步让出横扫的站定窗口并继续完成攻击', async () => {
    const { bot, attacks, controls } = combatRigBot([foe(7, 'zombie', 2.5), foe(8, 'zombie', 2.7)]);
    const cast = bot as unknown as Bot;
    cast.blockAt = (p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty',
      shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [], getProperties: () => ({}) })) as Bot['blockAt'];
    const r = rig(bot);
    expect(r.session.react({ kind: 'engage', targetId: 7 })).toBe(true);
    expect(r.session.react({ kind: 'step', destination: [0.5, 64, 1.7] })).toBe(true);
    await drive(bot as unknown as EventEmitter, 100);
    expect(['forward', 'back', 'left', 'right', 'sprint'].every(k => !controls[k])).toBe(true);
    await drive(bot as unknown as EventEmitter, 100);
    expect(attacks.length).toBeGreaterThan(0);
    r.session.stop();
  });
});

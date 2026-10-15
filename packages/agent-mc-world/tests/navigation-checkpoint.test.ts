import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Executor, type TaskReport } from '../core/executor.ts';

const meals = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock('../core/skills-craft.ts', async original => ({
  ...await original<typeof import('../core/skills-craft.ts')>(),
  skillEat: async (bot: { food: number }) => { meals.order.push('eat'); bot.food = 20; return '已进食'; },
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
beforeEach(() => { vi.useFakeTimers(); meals.order.length = 0; });
afterEach(() => vi.useRealTimers());

function rig(waterFirst = false) {
  let serial = 0, legs = 0, moving = false, wet = false;
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 6, entities: {},
    inventory: { items: () => [], slots: Array(46).fill(null), selectedItem: null }, currentWindow: null,
    blockAt: (p: Vec3) => ({ name: wet && p.y === 64 ? 'water' : p.y < 64 ? 'stone' : 'air',
      type: wet && p.y === 64 ? registry.blocksByName.water.id : p.y < 64 ? 1 : 0,
      position: p.floored(), boundingBox: p.y < 64 ? 'block' : 'empty', shapes: p.y < 64 ? [[0,0,0,1,1,1]] : [],
      getProperties: () => ({ level: 0 }) }),
    chat: vi.fn(), setControlState: vi.fn(), clearControlStates() {}, stopDigging() {},
    pathfinder: { goal: null as unknown, movements: { canDig: false, scafoldingBlocks: [] },
      isMoving: () => moving, isMining: () => false, isBuilding: () => false,
      setGoal(goal: unknown) { this.goal = goal; }, stop() { moving = false; },
      async goto(goal: { x: number; z: number; y?: number }) {
        this.goal = goal; moving = true; legs++; meals.order.push('leg-'+legs);
        if (legs === 1) await first;
        bot.entity.position = new Vec3(goal.x + .5, goal.y ?? 64, goal.z + .5);
        moving = false; wet = waterFirst && legs === 1; this.goal = null;
      },
    },
  });
  const reports: TaskReport[] = [],log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot as never, report: r => reports.push(r), nextId: () => ++serial,
    log: log as never, precheck: () => false });
  return { bot, exec, reports, release, legs: () => legs };
}

it.each([false, true])('executes checkpoint food after a dry completed leg, retaining the navigation identity (initial water=%s)', async water => {
  const r = rig(water);
  try {
    r.exec.submit([{ skill: 'goto', at: [250,64,0] }], 'append');
    await vi.advanceTimersByTimeAsync(20);
    expect(r.legs()).toBe(1); const owner = r.exec.status().running!.id;
    r.exec.submit([{ skill: 'eat', item: 'bread' }], 'afterCheckpoint');
    expect(meals.order).not.toContain('eat');
    r.release(); await vi.advanceTimersByTimeAsync(1000);
    const eat = meals.order.indexOf('eat');
    expect(eat).toBe(water ? 2 : 1);
    expect(meals.order.at(-1)).not.toBe('eat');
    expect(r.reports.some(r => r.taskId === owner && r.kind === 'suspended')).toBe(true);
    expect(r.reports.some(r => r.taskId === owner && r.kind === 'resumed')).toBe(true);
    expect(r.reports.filter(r => r.taskId === owner && r.kind === 'done')).toHaveLength(1);
    expect(r.reports.some(r => r.kind === 'cancelled')).toBe(false);
    expect(r.bot.food).toBe(20);
  } finally { r.release(); r.exec.shutdown(); }
});

it('rejects an already-near unverified server destination and never releases dependent actions', async () => {
  const r=rig();
  try {
    r.exec.submit([{ skill:'server_travel',command:'/travel dungeon',at:[0,64,0],within:3 },
      { skill:'chat',text:'/start',needs:[1] }],'append');
    await vi.advanceTimersByTimeAsync(300);
    expect(r.bot.chat).not.toHaveBeenCalled();
    expect(r.reports).toHaveLength(1);expect(r.reports[0].kind).toBe('blocked');
    expect(r.reports[0].text).toContain('命令未发送');
    expect(r.reports[0].text).toContain('跳过');
  } finally { r.exec.shutdown(); }
});

it('confirms an actual remote arrival before releasing the next action', async () => {
  const r=rig();r.bot.chat.mockImplementation(text=>{if(text==='/travel dungeon')r.bot.entity.position=new Vec3(20.5,64,.5);});
  try {
    r.exec.submit([{skill:'server_travel',command:'/travel dungeon',at:[20,64,0],within:3},
      {skill:'chat',text:'/start',needs:[1]}],'append');
    await vi.advanceTimersByTimeAsync(300);
    expect(r.bot.chat.mock.calls.map(c=>c[0])).toEqual(['/travel dungeon','/start']);
    expect(r.reports[0].kind).toBe('done');expect(r.reports[0].text).toContain('服务端传送已核验');
  } finally { r.exec.shutdown(); }
});

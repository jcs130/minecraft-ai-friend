import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { skillBuild } from '../core/skills-build.ts';
import type { SkillContext } from '../core/skill-context.ts';

const require = createRequire(import.meta.url);
const registry = require('minecraft-data')('1.21.1');
const Blocks = createRequire(require.resolve('mineflayer'))('prismarine-block')('1.21.1');
const target = new Vec3(2, 64, 0), support = target.offset(0, -1, 0), other = new Vec3(-2, 64, 0);
const log = { info() {}, warn() {}, error() {}, debug() {} };
function rig() {
  const world = new Map<string, any>();
  const block = (name: string, position: Vec3) => {
    const b = Blocks.fromStateId(registry.blocksByName[name].minStateId, 0); b.position = position; return b;
  };
  const set = (p: Vec3, name: string) => world.set(p.toString(), block(name, p));
  set(support, 'stone'); set(other.offset(0, -1, 0), 'stone');
  const sends: string[] = [], accepted = new Set<string>();
  const item = { name: 'torch', count: 4, type: registry.itemsByName.torch.id };
  const bot = Object.assign(new EventEmitter(), {
    registry, game: { dimension: 'overworld' },
    entity: { position: new Vec3(.5, 64, .5), width: .6, height: 1.8, eyeHeight: 1.62, onGround: true, effects: {} },
    entities: {}, heldItem: item, inventory: { items: () => [item], slots: [] },
    _client: Object.assign(new EventEmitter(), { write() { throw Error('Offline fixture has no packet port'); } }),
    craft: async () => {}, placeBlock: async () => {}, lookAt: async () => {}, setControlState: vi.fn(),
    pathfinder: { isBuilding: () => false, setGoal() {} },
    blockAt: (p: Vec3) => world.get(p.toString()) ?? block('air', p),
    _genericPlace: async (ref: any, face: Vec3) => {
      const dest = ref.position.plus(face); sends.push(dest.toString());
      if (accepted.has(dest.toString())) { set(dest, 'torch'); item.count--; }
    },
  }) as unknown as Bot;
  installMineflayerFixes(bot, log as never);
  const ctx = { aborted: () => false, taskId: 1, partial: vi.fn() } as unknown as SkillContext;
  return { bot, ctx, sends, accepted, set, place: () => bot.placeBlock(bot.blockAt(support)!, new Vec3(0, 1, 0)) };
}
async function failFirst(r: ReturnType<typeof rig>) {
  const failure = r.place().then(() => null, error => error as Error);
  await vi.runAllTimersAsync(); expect(await failure).toBeInstanceOf(Error); expect(r.sends).toHaveLength(3);
}
afterEach(() => vi.useRealTimers());
describe('build reports cached placement attempts without resending them', () => {
  it('preserves local no-send classification and recovery through the composed build result', async () => {
    vi.useFakeTimers(); const r = rig(); await failFirst(r);
    const failure = skillBuild(r.bot, { skill: 'build', material: 'torch', anchors: [[2,64,0]] }, r.ctx)
      .then(() => null, error => error);
    await vi.runAllTimersAsync(); const error = await failure;
    expect(error).toMatchObject({ code: 'placement-retry-cached', source: 'local' });
    expect(error.message).toContain('本次未发包');
    expect(error.message).toContain('不代表新的服务端拒绝');
    expect(error.scene.join('\n')).toContain('场景');
    expect(r.sends).toHaveLength(3);
    expect(r.bot.heldItem?.count).toBe(4);
    expect(r.bot.setControlState).toHaveBeenLastCalledWith('sneak', false);
  });
  it('keeps trying other requested cells and reports a mixed partial result', async () => {
    vi.useFakeTimers(); const r = rig(); await failFirst(r); r.accepted.add(other.toString());
    const result = skillBuild(r.bot, { skill: 'build', material: 'torch', anchors: [[2,64,0],[-2,64,0]] }, r.ctx);
    await vi.runAllTimersAsync(); const text = await result;
    expect(text).toContain('放上了 1/2 处'); expect(text).toContain('本次未发包');
    expect(r.sends.filter(x => x === target.toString())).toHaveLength(3);
    expect(r.sends.filter(x => x === other.toString())).toHaveLength(1);
    expect(r.bot.blockAt(other)?.name).toBe('torch'); expect(r.bot.heldItem?.count).toBe(3);
  });
  it('does not classify fresh unconfirmed sends as a cached local decision', async () => {
    vi.useFakeTimers(); const r = rig();
    const failure = skillBuild(r.bot, { skill: 'build', material: 'torch', anchors: [[2,64,0]] }, r.ctx)
      .then(() => null, error => error);
    await vi.runAllTimersAsync(); const error = await failure;
    expect(error.source).toBe('server'); expect(error.code).not.toBe('placement-retry-cached');
    expect(error.message).not.toContain('本次未发包'); expect(r.sends).toHaveLength(3);
  });
  it('retains the existing scene-change invalidation and confirms a new actual placement', async () => {
    vi.useFakeTimers(); const r = rig(); await failFirst(r);
    r.set(support, 'dirt'); r.accepted.add(target.toString());
    const result = skillBuild(r.bot, { skill: 'build', material: 'torch', anchors: [[2,64,0]] }, r.ctx);
    await vi.runAllTimersAsync(); await expect(result).resolves.toContain('放下了');
    expect(r.sends).toHaveLength(4); expect(r.bot.blockAt(target)?.name).toBe('torch');
  });
});

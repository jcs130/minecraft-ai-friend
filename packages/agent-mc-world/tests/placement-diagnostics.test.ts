import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { SkillBlocked } from '../core/skill-context.ts';
import { jumpPlaceBelow, localGuardRefusal, placeIntoCell } from '../core/placement.ts';
import { placeConfirmMs } from '../core/mineflayer-fixes.ts';

const require = createRequire(import.meta.url);
const registry = require('minecraft-data')('1.21.1');
const dependency = createRequire(require.resolve('mineflayer'));
const Blocks = dependency('prismarine-block')('1.21.1');
const GUARD = 'LOCAL_STRUCTURE_PROTECTION: 放置点附近有未知归属人工结构 jungle_planks@-688,61,436；这是本地保护，不代表服务器权限。';

const block = (name: string, position: Vec3) => {
  const b = Blocks.fromStateId(registry.blocksByName[name].minStateId, 0);
  b.position = position; return b;
};
function rig(placeBlock: () => Promise<void>) {
  const feet = new Vec3(0, 64, 0);
  const bot: Bot = Object.assign(new EventEmitter(), {
    registry, game: { dimension: 'overworld' },
    entity: { position: new Vec3(.5, 64, .5), width: .6, height: 1.8, eyeHeight: 1.62, onGround: true, effects: {}, velocity: new Vec3(0, 0, 0) },
    entities: {}, heldItem: { name: 'cobblestone', count: 4 }, inventory: { items: () => [], slots: [] },
    setControlState(name: string, on: boolean) { if (name === 'jump' && on) (bot.entity.position as Vec3).y += 1.2; }, lookAt: async () => {}, placeBlock,
    blockAt: (p: Vec3) => block(p.y <= feet.y - 1 ? 'stone' : 'air', p),
  }) as unknown as Bot;
  return bot;
}
const ctx = { aborted: () => false, abortedBy: () => null } as never;

describe('local guard refusals are not reported as "server did not accept"', () => {
  it('recognises LOCAL_ guard errors and nothing else', () => {
    const refusal = localGuardRefusal(new Error(GUARD));
    expect(refusal).toBeInstanceOf(SkillBlocked);
    expect(refusal?.message).toContain('没有向服务端发包');
    expect(refusal?.message).toContain('LOCAL_STRUCTURE_PROTECTION');
    expect(refusal?.code).toBe('protection-denied');
    expect(localGuardRefusal(new Error('No block has been placed : the block is still air'))).toBeNull();
  });
  it('placeIntoCell rethrows the guard refusal on the first face instead of trying every face', async () => {
    const calls = vi.fn(async () => { throw new Error(GUARD); });
    const bot = rig(calls);
    await expect(placeIntoCell(bot, { x: 1, y: 64, z: 1 }, 'cobblestone', ctx, 'up')).rejects.toMatchObject({
      code: 'protection-denied', message: expect.stringContaining('LOCAL_STRUCTURE_PROTECTION') });
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it('jumpPlaceBelow does not swallow the guard refusal as a timing miss', async () => {
    vi.useFakeTimers();
    try {
      const bot = rig(async () => { throw new Error(GUARD); });
      const result = jumpPlaceBelow(bot, ctx, 'cobblestone').then(() => null, e => e as Error);
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({ code: 'protection-denied' });
    } finally { vi.useRealTimers(); }
  });
  it('an ordinary unconfirmed placement is still a plain false (no false local-protection claim)', async () => {
    vi.useFakeTimers();
    try {
      const bot = rig(async () => { throw new Error('No block has been placed : the block is still air'); });
      const result = jumpPlaceBelow(bot, ctx, 'cobblestone');
      await vi.runAllTimersAsync();
      expect(await result).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('placement read-back window follows the connection ping', () => {
  const withPing = (ping: unknown) => ({ player: { ping } }) as unknown as Bot;
  it('keeps 400 ms without ping data and for fast links', () => {
    expect(placeConfirmMs({} as Bot)).toBe(400);
    expect(placeConfirmMs(withPing(20))).toBe(400);
  });
  it('covers a 350-520 ms round trip and is capped', () => {
    expect(placeConfirmMs(withPing(350))).toBeGreaterThanOrEqual(900);
    expect(placeConfirmMs(withPing(520))).toBeGreaterThan(520 * 2);
    expect(placeConfirmMs(withPing(9_999))).toBe(2_500);
  });
});

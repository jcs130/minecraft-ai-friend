import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { CRAFTING_STATION, ensureStation } from '../core/placement.ts';
import { nullLogger } from '../src/client/index.ts';
import { methodHarness } from './method-harness.ts';

const rigs: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function fixture(version = '1.21.1') {
  vi.useFakeTimers();
  const h = methodHarness(version), bot = h.bot as unknown as Bot;
  Object.assign(bot, { supportFeature: (n: string) => bot.registry.supportFeature(n),
    getControlState: (k: string) => h.keys[k], isAlive: true,
    dig: vi.fn(() => { throw Error('Must use the available walking route'); }), placeBlock: vi.fn() });
  Object.assign(bot.game, { minY: -64, height: 384 });
  Object.assign(bot.world, { getBlockStateId: (p: Vec3) => bot.blockAt(p)!.stateId, getColumn: () => ({}) });
  pathfinder.pathfinder(bot);
  class TestBridge extends Bridge { attach() { this._bot = bot; this.applyTuning(bot, bot.pathfinder.movements); } }
  const bridge = new TestBridge({ host: 'fixture.invalid', port: 25565, username: 'Fixture', version,
    viewerPort: 0, log: nullLogger(), onSnapshot() {}, onEvent() {}, onMessage() {} } as never);
  bridge.attach();
  bot.pathfinder.movements.canDig = true;
  bot.pathfinder.movements.scafoldingBlocks = [];
  bot.pathfinder.thinkTimeout = 100; bot.pathfinder.tickTimeout = 5;
  const ctx: any = { aborted: () => false, probeRoutes: bridge.probeRoutes.bind(bridge) };
  const r = { ...h, bot, ctx, bridge }; rigs.push(r); return r;
}
async function finish<T>(promise: Promise<T>) {
  let settled = false;
  const wrapped = promise.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  for (let tick = 0; tick < 400 && !settled; tick++) await vi.advanceTimersByTimeAsync(50);
  expect(settled, 'station approach must finish in the local 20-second movement window').toBe(true);
  const result = await wrapped;
  if ('error' in result) throw result.error;
  return result.value;
}

it.each(['1.21.1', '1.20.6'])('selects a real walkable station before a closer table buried below a floor (%s)', async version => {
  const r = fixture(version), buried = new Vec3(5, 58, 0), open = new Vec3(0, 64, 12);
  r.set(buried.x, buried.y, buried.z, 'crafting_table'); r.set(open.x, open.y, open.z, 'crafting_table');
  r.bot.findBlocks = () => [buried, open];
  const result = await finish(ensureStation(r.bot, CRAFTING_STATION, r.ctx));
  expect([result.x, result.y, result.z]).toEqual([open.x, open.y, open.z]);
  expect(result.placed).toBe(false);
  expect(r.bot.entity.position.distanceTo(open.offset(.5, .5, .5))).toBeLessThanOrEqual(4);
  expect(r.bot.dig).not.toHaveBeenCalled(); expect(r.bot.placeBlock).not.toHaveBeenCalled();
  expect(r.bot.pathfinder.movements.canDig).toBe(true);
  expect(r.bot.blockAt(buried)?.name).toBe('crafting_table');
});

it('uses an already reachable station without requiring a two-block landing or planning', async () => {
  const r = fixture(), table = new Vec3(3, 64, 0); r.set(3, 64, 0, 'crafting_table');
  r.bot.findBlocks = () => [table];
  const goto = vi.spyOn(r.bot.pathfinder, 'goto'); r.ctx.probeRoutes = vi.fn();
  expect((await ensureStation(r.bot, CRAFTING_STATION, r.ctx)).x).toBe(3);
  expect(goto).not.toHaveBeenCalled(); expect(r.ctx.probeRoutes).not.toHaveBeenCalled();
});

it('retains ordinary navigation for an unknown probe and does not blacklist that station', async () => {
  const r = fixture(), table = new Vec3(7, 64, 0); r.set(7, 64, 0, 'crafting_table'); r.bot.findBlocks = () => [table];
  r.ctx.probeRoutes = () => [{ profile: 'walk', status: 'timeout', steps: 0, breaks: 0, place: 0, endDist: 7 }];
  expect((await finish(ensureStation(r.bot, CRAFTING_STATION, r.ctx))).x).toBe(7);
  expect((await ensureStation(r.bot, CRAFTING_STATION, r.ctx)).x).toBe(7);
});

it('cancels selection before taking ownership of the pathfinder', async () => {
  const r = fixture(); r.ctx.aborted = () => true;
  const goto = vi.spyOn(r.bot.pathfinder, 'goto');
  await expect(ensureStation(r.bot, CRAFTING_STATION, r.ctx)).rejects.toThrow();
  expect(goto).not.toHaveBeenCalled(); expect(r.bot.pathfinder.movements.canDig).toBe(true);
});

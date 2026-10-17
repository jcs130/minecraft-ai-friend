import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelControlInput, skillControl, waterControlActive, ownNativeControlInput } from '../core/skills-control.ts';
import { type SkillContext, SkillBlocked } from '../core/skill-context.ts';
import { parseSteps } from '../core/skills.ts';
import { goals, installTreadWater, releaseBody, underwaterRouteNote, withRouteScene } from '../core/travel.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const fixtures: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of fixtures.splice(0)) h.close(); });

/** Actual pinned Prismarine collision/water physics; no manual coordinate advancement. */
function pool(y = 69, ascent = () => true) {
  const h = methodHarness(); fixtures.push(h);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) for (let y = 64; y <= 69; y++) h.set(x, y, z, 'water');
  h.bot.entity.position = new Vec3(.5, y, .5);
  h.bot.entity.onGround = false;
  Object.assign(h.bot.pathfinder, { isMoving: () => false });
  const bot = h.bot as unknown as Bot;
  installTreadWater(bot, ascent);
  const ctx = { aborted: () => false } as SkillContext;
  const move = (keys: ('jump' | 'forward' | 'sneak')[], durationMs = 1000) =>
    skillControl(bot, { skill: 'control', mode: 'water', keys, durationMs }, ctx);
  return { ...h, bot, ctx, move };
}

it('sinks using unchanged game physics while passive tread yields, then resumes floating', async () => {
  const h = pool(); h.bot.emit('physicsTick');
  expect(h.keys.jump).toBe(true);
  const from = h.bot.entity.position.clone();
  const done = h.move([], 2000);
  expect(h.keys.jump).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  const receipt = await done;
  expect(h.bot.entity.position.y).toBeLessThan(from.y - .5);
  expect(receipt).toContain('头部浸水:false→true');
  expect(receipt).toContain('氧气:20→20/20');
  expect(waterControlActive(h.bot)).toBe(false);
  const bottom = h.bot.entity.position.y;
  await vi.advanceTimersByTimeAsync(800);
  expect(h.keys.jump).toBe(true);
  expect(h.bot.entity.position.y).toBeGreaterThan(bottom);
  expect(h.bot.physicsEnabled).toBe(true);
});

it('stops passive ascent after a live disable and does not restore it after a water program', async () => {
  let enabled = true;
  const h = pool(67, () => enabled);
  h.bot.emit('physicsTick');
  expect(h.keys.jump).toBe(true);
  enabled = false;
  h.bot.emit('physicsTick');
  expect(h.keys.jump).toBe(false);
  const from = h.bot.entity.position.y;
  await vi.advanceTimersByTimeAsync(1500);
  expect(h.bot.entity.position.y).toBeLessThan(from - .5);
  const up = h.move(['jump'], 100);
  await vi.advanceTimersByTimeAsync(50);
  expect(h.keys.jump).toBe(true);
  await vi.advanceTimersByTimeAsync(50); await up;
  await vi.advanceTimersByTimeAsync(200);
  expect(h.keys.jump).toBe(false);
});

it('does not install implicit ascent when no permission callback is supplied', async () => {
  const h = methodHarness(); fixtures.push(h);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 64; y <= 69; y++) h.set(x, y, z, 'water');
  h.bot.entity.position = new Vec3(.5, 67, .5); h.bot.entity.onGround = false;
  Object.assign(h.bot.pathfinder, { isMoving: () => false });
  installTreadWater(h.bot as unknown as Bot);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.keys.jump).toBe(false);
  expect(h.bot.entity.position.y).toBeLessThan(66.5);
});

it('retains explicit upward input and measured horizontal motion without a pathfinder goal', async () => {
  const h = pool(66), from = h.bot.entity.position.clone();
  const done = h.move(['forward', 'jump']);
  await vi.advanceTimersByTimeAsync(500);
  expect(h.keys.jump).toBe(true);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(h.bot.entity.position.y).toBeGreaterThan(from.y + .2);
  expect(h.bot.entity.position.z).toBeLessThan(from.z - .2);
  expect(h.keys.forward).toBe(false);
  expect(h.bot.pathfinder.goal).toBeNull();
});

it('collides with the pool floor and does not describe elapsed inputs as arrival', async () => {
  const h = pool(64.3);
  const done = h.move([], 2000);
  await vi.advanceTimersByTimeAsync(2000);
  const receipt = await done;
  expect(h.bot.entity.position.y).toBe(64);
  expect(receipt).toContain('到达目标须按现场或 expect 另行核验');
});

it('preserves unknown oxygen and reports a low reading without an unconditional six-point dive veto', async () => {
  const h = pool(67, () => false);
  h.bot.oxygenLevel = undefined as never;
  const unknown = h.move([], 100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await unknown).toContain('氧气:未知→未知/20');
  h.bot.oxygenLevel = 8; h.bot.emit('breath');
  const from = h.bot.entity.position.y;
  const done = h.move([], 1000);
  await vi.advanceTimersByTimeAsync(100); h.bot.oxygenLevel = 5; h.bot.emit('breath');
  await vi.advanceTimersByTimeAsync(50);
  expect(waterControlActive(h.bot)).toBe(true); expect(h.keys.jump).toBe(false);
  await vi.advanceTimersByTimeAsync(850);
  const receipt = await done;
  expect(receipt).toContain('氧气:8→5/20'); expect(receipt).toContain('生命:20→20');
  expect(h.bot.entity.position.y).toBeLessThan(from);
  expect(waterControlActive(h.bot)).toBe(false);
  await vi.advanceTimersByTimeAsync(50); expect(h.keys.jump).toBe(false);
  const up = h.move(['jump'], 100);
  await vi.advanceTimersByTimeAsync(100); await up;
});

it('updates a single passive-water subscription and releases it on disconnect', async () => {
  const h=pool(67),before=h.bot.listenerCount('physicsTick');
  h.bot.emit('physicsTick');expect(h.keys.jump).toBe(true);
  const dispose=installTreadWater(h.bot,()=>false);
  for(let i=0;i<12;i++) expect(installTreadWater(h.bot,()=>false)).toBe(dispose);
  expect(h.bot.listenerCount('physicsTick')).toBe(before);
  await vi.advanceTimersByTimeAsync(100);expect(h.keys.jump).toBe(false);
  h.bot.emit('end');expect(h.bot.listenerCount('physicsTick')).toBe(before-1);
  dispose();expect(h.bot.listenerCount('physicsTick')).toBe(before-1);
});

it('does not let disposal of passive floating clear a newer native upward input',()=>{
  const h=pool(67);h.bot.emit('physicsTick');
  const dispose=installTreadWater(h.bot,()=>true),release=ownNativeControlInput(h.bot);
  h.bot.setControlState('jump',true);dispose();
  expect(h.keys.jump).toBe(true);
  release();h.bot.setControlState('jump',false);
});

it.each(['end', 'death', 'respawn', 'forcedMove'] as const)('%s revokes the water lease immediately', async event => {
  const h = pool(67);
  const done = h.move(['forward'], 2000).catch(e => e);
  await vi.advanceTimersByTimeAsync(100); h.bot.emit(event);
  expect(waterControlActive(h.bot)).toBe(false); expect(h.keys.forward).toBe(false);
  await vi.advanceTimersByTimeAsync(100); expect(await done).toBeInstanceOf(SkillBlocked);
  if(event==='end')expect(h.bot.listenerCount('breath')).toBe(0);
});

it('hands the body back to a rescue and does not let an old finally clear new keys', async () => {
  const h = pool(67);
  const old = h.move(['forward'], 2000).catch(e => e);
  await vi.advanceTimersByTimeAsync(50);
  releaseBody(h.bot, 'escape', '防溺水上浮');
  expect(waterControlActive(h.bot)).toBe(false);
  const rescue = h.move(['jump'], 1000);
  await vi.advanceTimersByTimeAsync(100);
  expect(await old).toBeInstanceOf(SkillBlocked);
  expect(waterControlActive(h.bot)).toBe(true); expect(h.keys.jump).toBe(true);
  await vi.advanceTimersByTimeAsync(900); await rescue;
});

it('refuses dry-land or vehicle water input and still cleans up cancellation', async () => {
  const h = pool(71);
  await expect(h.move([])).rejects.toThrow('身体已在水中');
  h.bot.entity.position.y = 67; h.bot.vehicle = {} as never;
  await expect(h.move([])).rejects.toThrow('未乘坐载具');
  h.bot.vehicle = undefined;
  const done = h.move([], 1000).catch(e => e);
  cancelControlInput(h.bot, '操作员停止');
  await vi.advanceTimersByTimeAsync(50);
  expect((await done).message).toContain('操作员停止');
  expect(waterControlActive(h.bot)).toBe(false);
});

it('parses deliberate sinking without widening the existing duration and key bounds', () => {
  const call = { skill: 'control', mode: 'water', keys: [], durationMs: 1000 };
  expect(parseSteps([call])).toMatchObject({ steps: [call] });
  expect(parseSteps([{ ...call, mode: 'ground' }])).toHaveProperty('error');
  expect(parseSteps([{ ...call, durationMs: 2001 }])).toHaveProperty('error');
  expect(parseSteps([{ ...call, keys: ['jump', 'sneak'] }])).toHaveProperty('error');
});

it('attributes an underwater route failure to missing dive planning, without inventing a blocked target', () => {
  const h = pool(69), target = { x: 2, y: 65, z: 2 };
  expect(underwaterRouteNote(h.bot, target)).toContain('不规划水下下降路线');
  expect(underwaterRouteNote(h.bot, target, new goals.GoalNearXZ(2, 2, 1))).toBeNull();
  expect(underwaterRouteNote(h.bot, { ...target, y: 70 })).toBeNull();
  const probeTarget = vi.fn(() => ({ kind: 'noSupport' as const, at: target }));
  const error = withRouteScene(h.bot, { ...h.ctx, probeTarget }, new SkillBlocked('算不出路'), target) as SkillBlocked;
  expect(error.scene.join('\n')).toContain('寻路失败不代表目标不可达');
  expect(probeTarget).not.toHaveBeenCalled();
  h.set(2, 65, 2, 'stone');
  expect(underwaterRouteNote(h.bot, target)).toBeNull();
});

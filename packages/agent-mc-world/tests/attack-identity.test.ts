import { EventEmitter } from 'node:events';
import Ajv from 'ajv';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skillAttack } from '../core/melee.ts';
import { precheckSteps } from '../core/precheck.ts';
import { parseSteps, readSkillHelp, SKILL_STEP_SCHEMA } from '../core/skills.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  const entity = (id: number, x: number) => ({ id, uuid: `fixture-${id}`, name: 'zombie', type: 'mob', isValid: true,
    position: new Vec3(x, 64, .5), height: 1.95, width: .6, velocity: new Vec3(0, 0, 0) });
  const nearby = entity(2, 1.5), selected = entity(7, 2.5);
  const stats = { token: {}, targetId: 7, swings: 0, meleeHits: 0, arrows: 0, rangedHits: 0,
    hurts: 0, lastHurtAt: 0, lastSwingAt: 0, lastSwingTargetId: -1, dead: false, disconnected: false };
  const controls: Record<string, boolean> = {};
  const weapon = { name: 'iron_sword', type: 1, count: 1 };
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, velocity: new Vec3(0, 0, 0), onGround: true },
    entities: { 2: nearby, 7: selected } as Record<number, any>, players: {} as Record<string, any>,
    registry: { entitiesByName: { zombie: { name: 'zombie' } } }, health: 20, heldItem: weapon,
    inventory: { items: () => [weapon], slots: [] }, equip: vi.fn(async () => {}), lookAt: vi.fn(async () => {}),
    attack: vi.fn((_entity: unknown) => { stats.dead = true; }),
    setControlState: (key: string, value: boolean) => { controls[key] = value; }, controlState: controls,
    world: { raycast: vi.fn((): unknown => null) }, pathfinder: { setGoal: vi.fn() },
    blockAt: (p: Vec3) => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({}) }),
  });
  const ctx = { aborted: () => false, fleeHealth: () => 0, escape: { active: false },
    attack: { acquire: vi.fn(() => stats), release: vi.fn() } };
  return { bot, ctx, stats, controls, nearby, selected };
}

describe('attack target identity shared by declarations, precheck and execution', () => {
  const validate = new Ajv({ strict: false }).compile(SKILL_STEP_SCHEMA);
  it.each([undefined, 0, 27534])('retains an explicitly supplied entityId %s without inventing a default', entityId => {
    const step = { skill: 'attack', target: 'zombie', ...(entityId === undefined ? {} : { entityId }) };
    expect(validate(step), JSON.stringify(validate.errors)).toBe(true);
    expect(parseSteps([step])).toEqual({ steps: [step] });
    expect(readSkillHelp({ skill: 'attack' })).toHaveProperty('text', expect.stringContaining('entityId'));
  });
  it.each([-1, 1.5, '27534', null, 2_147_483_648])('rejects invalid identity %s instead of dropping it', entityId => {
    const step = { skill: 'attack', target: 'zombie', entityId };
    expect(validate(step)).toBe(false);
    expect(parseSteps([step])).toHaveProperty('error');
  });
  it('selects exactly the observed farther entity rather than a nearer one of the same type', async () => {
    const f = fixture();
    const result = skillAttack(f.bot as never, 'zombie', 'melee', f.ctx as never, 7);
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(f.ctx.attack.acquire).toHaveBeenCalledWith(7);
    expect(f.bot.attack).toHaveBeenCalledTimes(1);
    expect(f.bot.attack).toHaveBeenCalledWith(f.selected);
    expect(f.ctx.attack.release).toHaveBeenCalledWith(f.stats);
  });
  it('retains legacy nearest-type selection when identity is omitted', async () => {
    const f = fixture();
    const result = skillAttack(f.bot as never, 'zombie', 'melee', f.ctx as never);
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(f.bot.attack).toHaveBeenCalledWith(f.nearby);
  });
  it.each(['absent', 'different-type', 'invalid', 'out-of-range', 'occluded'] as const)
    ('does not fall back to another target when the named entity is %s', async kind => {
      const f = fixture();
      if (kind === 'absent') delete f.bot.entities[7];
      if (kind === 'different-type') f.selected.name = 'skeleton';
      if (kind === 'invalid') f.selected.isValid = false;
      if (kind === 'out-of-range') f.selected.position = new Vec3(60, 64, 0);
      if (kind === 'occluded') f.bot.world.raycast.mockReturnValue({ name: 'stone' });
      await expect(skillAttack(f.bot as never, 'zombie', 'melee', f.ctx as never, 7)).rejects.toThrow('未改打其他实体');
      expect(f.ctx.attack.acquire).not.toHaveBeenCalled();
      expect(f.bot.attack).not.toHaveBeenCalled();
      expect(f.bot.pathfinder.setGoal).not.toHaveBeenCalled();
    });
  it('reports a missing named target even if another entity of that type is present', () => {
    const f = fixture(); delete f.bot.entities[7];
    const notes = precheckSteps(f.bot as never, [{ skill: 'attack', target: 'zombie', entityId: 7 }],
      { resolve: () => null, cellsOf: () => null, blockAt: () => null });
    expect(notes[0]?.note).toMatchObject({ level: 'soft', rule: 'attack.noTarget' });
    expect(notes[0]?.note.text).toContain('entityId=7');
  });
  it('does not guess that a numeric target string is an entity ID', async () => {
    const f = fixture(); f.bot.entities[27534] = { ...f.selected, id: 27534 };
    await expect(skillAttack(f.bot as never, '27534', 'melee', f.ctx as never)).rejects.toThrow('另填 entityId');
    expect(f.ctx.attack.acquire).not.toHaveBeenCalled(); expect(f.bot.attack).not.toHaveBeenCalled();
  });
  it('preserves an actual numeric player name instead of selecting an entity with that number', async () => {
    const f = fixture();
    const player = { ...f.selected, id: 9, type: 'player', name: 'player', username: '27534' };
    f.bot.players['27534'] = { entity: player }; f.bot.entities[9] = player;
    f.bot.entities[27534] = { ...f.nearby, id: 27534 };
    const result = skillAttack(f.bot as never, '27534', 'melee', f.ctx as never);
    await vi.advanceTimersByTimeAsync(1000); await result;
    expect(f.bot.attack).toHaveBeenCalledWith(player);
  });
  it('retains brief occlusion tolerance for the same named entity without swinging through the wall', async () => {
    const f = fixture();
    const pending = skillAttack(f.bot as never, 'zombie', 'melee', f.ctx as never, 7)
      .then(value => ({ value }), error => ({ error }));
    f.bot.world.raycast.mockReturnValue({ name: 'stone' });
    setTimeout(() => f.bot.world.raycast.mockReturnValue(null), 200);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.bot.attack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(await pending).not.toHaveProperty('error');
    expect(f.ctx.attack.acquire).toHaveBeenCalledTimes(1);
    expect(f.bot.attack).toHaveBeenCalledWith(f.selected);
  });
  it.each(['replacement', 'changed-uuid'] as const)('rechecks %s after an asynchronous aim and jump before the actual swing', async kind => {
    const f = fixture();
    f.bot.lookAt.mockImplementation(async () => {
      if (kind === 'replacement') f.bot.entities[7] = { ...f.selected, uuid: 'replacement' };
      else f.selected.uuid = 'replacement';
    });
    const pending = skillAttack(f.bot as never, 'zombie', 'melee', f.ctx as never, 7)
      .then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(String(await pending)).toContain('已失效');
    expect(f.bot.attack).not.toHaveBeenCalled(); expect(f.stats.swings).toBe(0);
    expect(f.ctx.attack.release).toHaveBeenCalledTimes(1);
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });
});

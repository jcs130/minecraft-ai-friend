import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture(distance = 2) {
  const r = methodHarness('1.21.1');
  const reports: TaskReport[] = [];
  const enemy = { id: 7, uuid: 'original-target', name: 'skeleton', type: 'mob', isValid: true,
    position: new Vec3(distance, 64, .5), height: 1.95, width: .6, velocity: new Vec3(0, 0, 0) };
  const sword = { name: 'iron_sword', type: r.bot.registry.itemsByName.iron_sword.id, count: 1 };
  const bow = { name: 'bow', type: r.bot.registry.itemsByName.bow.id, count: 1 };
  const arrow = { name: 'arrow', type: r.bot.registry.itemsByName.arrow.id, count: 4 };
  Object.assign(r.bot, { physicsEnabled: false, heldItem: sword,
    inventory: { items: () => [sword, bow, arrow], slots: [] }, equip: vi.fn(async () => {}),
    lookAt: vi.fn(async () => {}), attack: vi.fn() });
  Object.assign(r.bot.world, { raycast: () => null });
  r.bot.entities[7] = enemy as never;
  const ranged = { ready: () => true, shoot: vi.fn(), abort: vi.fn() };
  let id = 0;
  const exec = new Executor({ getBot: () => r.bot as never, nextId: () => ++id, report: value => reports.push(value), log: r.host.log, ranged });
  const died = () => { exec.noteCombatTargetDead(7); enemy.isValid = false; };
  Object.assign(r.bot.pathfinder, { goto: vi.fn(async () => { r.bot.entity.position.x += 1; died(); }) });
  return { r, exec, enemy, reports, ranged, died, close: () => { exec.shutdown(); r.close(); } };
}

describe('native target death versus own combat credit', () => {
  it('keeps a zero-attempt target death successful without claiming our kill, with structured step evidence', async () => {
    const f = fixture();
    try {
      f.r.bot.lookAt.mockImplementation(async () => { f.died(); });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'melee' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'done')!;
      expect(result).toBeDefined();
      expect(f.r.bot.attack).not.toHaveBeenCalled();
      expect(result.text).not.toContain('打死了');
      expect(result.steps?.[0].observation).toMatchObject({ schema: 'agent-mc-attack-evidence/v1',
        target: { entityId: 7, uuid: 'original-target' }, targetState: 'death-observed',
        ownKillCredit: null, attempts: { meleeSwings: 0, arrowsReleased: 0 } });
      expect(result.steps?.[0].decision?.status).toBe('completed');
    } finally { f.close(); }
  });
  it('a disappearance without a death event stays unconfirmed rather than becoming a kill', async () => {
    const f = fixture();
    try {
      f.r.bot.lookAt.mockImplementation(async () => { f.enemy.isValid = false; });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'melee' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'blocked')!;
      expect(result).toBeDefined(); expect(result.text).not.toContain('打死了');
      expect(result.steps?.[0].observation).toMatchObject({ targetState: 'untracked', ownKillCredit: null, deathObservedAt: null });
      expect(result.steps?.[0].decision).toMatchObject({ status: 'unknown', reason: 'attack-target-unconfirmed', retryable: false });
    } finally { f.close(); }
  });
  it.each(['replacement', 'mutated-uuid', 'id-only-after-reuse'] as const)('does not accept a %s death for the selected entity', async mode => {
    const f = fixture();
    try {
      f.r.bot.lookAt.mockImplementation(async () => {
        if (mode === 'mutated-uuid') f.enemy.uuid = 'replacement-target';
        else f.r.bot.entities[7] = { ...f.enemy, uuid: 'replacement-target' } as never;
        f.exec.noteCombatTargetDead(mode === 'id-only-after-reuse' ? 7 : f.r.bot.entities[7]);
      });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'melee' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'blocked')!;
      expect(result).toBeDefined(); expect(f.r.bot.attack).not.toHaveBeenCalled();
      expect(result.steps?.[0].observation).toMatchObject({ target: { uuid: 'original-target' }, targetState: 'untracked',
        ownKillCredit: null, deathObservedAt: null });
    } finally { f.close(); }
  });
  it('keeps the exact target death when its entity-table entry was removed before delivery', async () => {
    const f = fixture();
    try {
      f.r.bot.lookAt.mockImplementation(async () => {
        delete f.r.bot.entities[7]; f.enemy.isValid = false; f.exec.noteCombatTargetDead(f.enemy);
      });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'melee' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'done')!;
      expect(result.steps?.[0].observation).toMatchObject({ targetState: 'death-observed', ownKillCredit: null });
      expect(f.r.bot.attack).not.toHaveBeenCalled();
    } finally { f.close(); }
  });
  it('even a confirmed own hit plus target death does not prove the final kill belongs to us', async () => {
    const f = fixture(2);
    try {
      f.r.bot.entity.velocity.y = -.1;
      f.r.bot.attack.mockImplementation(() => { f.exec.noteCombatTargetHurt(7); f.died(); });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'melee' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'done')!;
      expect(result.text).not.toContain('打死了');
      expect(result.steps?.[0].observation).toMatchObject({ targetState: 'death-observed', ownKillCredit: null,
        attempts: { meleeSwings: 1 }, observedHits: { melee: 1 } });
    } finally { f.close(); }
  });
  it.each(['released', 'blocked'] as const)('preserves actual bow dispatch when death races a %s result', async kind => {
    const f = fixture();
    try {
      f.ranged.shoot.mockImplementation(async () => {
        f.died(); return kind === 'released' ? { kind, shotId: 1 } : { kind, reason: 'aborted', cause: 'target_lost' };
      });
      f.exec.submit([{ skill: 'attack', target: 'skeleton', entityId: 7, mode: 'ranged' }]);
      await vi.advanceTimersByTimeAsync(1000);
      const result = f.reports.find(r => r.kind === 'done')!;
      expect(result).toBeDefined(); expect(result.text).not.toContain('打死了');
      expect(result.steps?.[0].observation).toMatchObject({ targetState: 'death-observed', ownKillCredit: null,
        attempts: { meleeSwings: 0, arrowsReleased: kind === 'released' ? 1 : 0 } });
    } finally { f.close(); }
  });
});

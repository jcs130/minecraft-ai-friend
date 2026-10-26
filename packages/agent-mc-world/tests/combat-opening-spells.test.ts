import { expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { CombatSession } from '../core/combat.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { methodHarness } from './method-harness.ts';
import type { CombatCandidate } from '../core/combat-decision-types.ts';

class SpellWorld extends TacticalMinecraftWorld {
  sent: string[] = [];
  frame() { return this.sampleCombatDecision(); }
  choose(c: CombatCandidate, revision: number) { return this.applyCombatDecision(c, revision); }
  abilities() { return this.tactics; }
  policyFight(fight: 'off' | 'armed') { this.policy.set({ fight }); }
  protected override sendAutoCombatSpell(_bot: Bot, spell: string, ruleId?: string) {
    this.sent.push(spell); this.tactics.noteSent(spell, Date.now(), 'automatic', ruleId); return true;
  }
}

function rig() {
  const cfg = structuredClone(MINECRAFT_DEFAULTS);
  cfg.combatOptions = { allowEngage: true, allowMovement: true, engageScope: 'hostile' };
  const world = new SpellWorld({ cfg }), r = methodHarness('1.21.1', () => world), bot = r.bot as unknown as Bot;
  const session = new CombatSession({ getBot: () => bot, tuning: () => ({ ...cfg.combat, fight: 'armed', fleeHealth: cfg.reflex.fleeHealth }),
    envBusy: () => false, suspendTasks: () => {}, resumeTasks: () => null, emit: () => {}, log: r.host.log });
  Object.assign(world, { combat: session });
  bot.entity.yaw = Math.PI; // Both skeletons are in the current south-facing view.
  Object.assign(bot.world, { raycast: () => null });
  for (const id of [7, 8]) bot.entities[id] = { id, name: 'skeleton', type: 'mob', isValid: true,
    position: new Vec3(.5, 64, id === 7 ? 2.4 : 4.3), height: 1.95, width: .6, metadata: [] } as never;
  world.abilities().setTactic({ spells: null, healAtOrBelow: null,
    rules: [{ id: 'opening', spell: 'frostnova', intent: 'Freeze the visible group before its first hit.',
      when: { within: 8, hostilesAtLeast: 2, reserveMana: 10 } }] });
  world.abilities().noteMana(42);
  world.abilities().noteAbilities([{ id: 'frostnova', manaCost: 7, cooldownMs: 15000, cooldownRemainingMs: 0 }]);
  return { ...r, world, cfg, session, close: () => { session.stop(); r.close(); } };
}

it('offers and dispatches an observed authored spell before melee or injury, without a sword or arrows', () => {
  const r = rig();
  try {
    expect(r.session.engagementTargets()).toEqual([]);
    const frame = r.world.frame()!;
    expect(frame.battlefield.action).toMatchObject({ fighting: false, canStep: false });
    const spell = frame.candidates.find(c => c.kind === 'cast')!;
    expect(spell, JSON.stringify(frame)).toMatchObject({ spell: 'frostnova', ruleId: 'opening' });
    expect(r.world.sent).toEqual([]); // Merely sampling never acts.
    expect(r.world.choose(spell, frame.tacticRevision)).toBe(true);
    expect(r.world.sent).toEqual(['frostnova']);
    expect(r.world.choose(spell, frame.tacticRevision)).toBe(false); // Actual cooldown is rechecked.
  } finally { r.close(); }
});

it.each(['disabled', 'off', 'low-health', 'busy', 'window', 'unknown-mana', 'cooldown', 'lost-sight', 'unknown-party', 'one-enemy'])
('does not offer or dispatch a stale opening after %s', condition => {
  const r = rig();
  try {
    const before = r.world.frame()!, candidate = before.candidates.find(c => c.kind === 'cast')!;
    expect(candidate).toBeDefined();
    if (condition === 'disabled') r.cfg.combatOptions!.allowEngage = false;
    if (condition === 'off') r.world.policyFight('off');
    if (condition === 'low-health') r.bot.health = 6;
    if (condition === 'busy') {
      r.runner.start({ code: 'await mc.state(); return 1;' });
      Object.assign(r.world, { nativeMethod: { runId: r.runner.current!.id, session: { ownsBody: true } } });
    }
    if (condition === 'window') r.bot.currentWindow = {} as never;
    if (condition === 'unknown-mana') r.world.abilities().noteMana(null);
    if (condition === 'cooldown') r.world.abilities().noteAbilities([{ id: 'frostnova', manaCost: 7, cooldownMs: 15000, cooldownRemainingMs: 2000 }]);
    if (condition === 'lost-sight') Object.assign(r.bot.world, { raycast: () => ({ block: {} }) });
    if (condition === 'unknown-party') r.cfg.combatOptions!.engageScope = 'party';
    if (condition === 'one-enemy') delete r.bot.entities[8];
    expect(r.world.frame()!.candidates.filter(c => c.kind === 'cast')).toEqual([]);
    expect(r.world.choose(candidate, before.tacticRevision)).toBe(false);
    expect(r.world.sent).toEqual([]);
  } finally {
    if (condition === 'busy') Object.assign(r.world, { nativeMethod: null });
    r.close();
  }
});

it('allows fast combat during a real read-only worker without cancelling that script', async () => {
  const r = rig();
  try {
    const run = r.runner.start({ name: 'read-only-observation', code: 'const state = await mc.state(); return state.sampledAt;' });
    expect(r.runner.current?.id).toBe(run.id);
    const frame = r.world.frame()!, spell = frame.candidates.find(c => c.kind === 'cast')!;
    expect(spell).toBeDefined();
    expect(r.world.choose(spell, frame.tacticRevision)).toBe(true);
    await r.runner.wait(run.id, 3000);
    expect(r.runner.read(run.id)[0].status).toBe('completed');
    expect(r.world.sent).toEqual(['frostnova']);
  } finally { r.close(); }
});

it('still defers fast combat while a real scripted movement owns the executor', async () => {
  const r = rig();
  try {
    r.runner.start({ name: 'scripted-body', code: 'return await mc.do([{skill:"control",keys:["forward"],durationMs:1000}]);' });
    await vi.waitFor(() => expect(r.exec.status().running?.skill).toBe('control'));
    expect(r.world.frame()!.candidates.filter(c => c.kind === 'cast' || c.kind === 'engage')).toEqual([]);
  } finally { r.close(); }
});

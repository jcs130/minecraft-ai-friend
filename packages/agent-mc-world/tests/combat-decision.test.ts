import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CombatDecisionLoop, assessCombatDecisionScene, type CombatDecisionFrame, type CombatCandidate, type CombatDecisionConfig } from '../src/decisions/combat-decision.ts';
import { COMBAT_DECISION_DEFAULTS } from '../src/decisions/defaults.ts';
import { combatReactions } from '../core/combat-reactions.ts';
import { combatMayTakeTask, diverseCombatOptions } from '../core/combat-options.ts';
import { CombatAbilities as CombatSpells } from '../core/combat-abilities.ts';

function frame(): CombatDecisionFrame {
  return { battlefield: { sampledAtMs: Date.now(), connectionGeneration: 1, dimension: 'overworld',
    self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 0 },
      food: 20, position: [0, 64, 0], scoreboardTeam: null },
    action: { fighting: true, emergency: false, taskId: null, step: null,
      targetEntityId: 3, sinceHitMs: 3000, canStep: true },
    actors: [ { entityId: 3, uuid: '00000000-0000-0000-0000-000000000003', type: 'skeleton', name: null,
      relation: 'hostile', relationSource: 'server', scoreboardTeam: null,
      health: { current: 12, max: 20, source: 'server', updatedAtMs: 0 }, position: [3, 64, 0], distance: 3,
      lineOfSight: true, targetEntityId: 1 },
    { entityId: 2, uuid: '00000000-0000-0000-0000-000000000002', type: 'player', name: 'Companion',
      relation: 'ally', relationSource: 'server', scoreboardTeam: null,
      health: { current: 5, max: 30, source: 'server', updatedAtMs: 0 }, position: [2, 64, 0], distance: 2,
      lineOfSight: true, targetEntityId: null } ], omitted: 0, server: null },
    tacticRevision: 2, mana: 24, skills: [{ spell: 'spark', available: true, manaCost: 4, cooldownRemainingMs: 0, block: null }],
    candidates: [{ id: 'ranged', kind: 'cast', spell: 'spark', intent: 'Hit one visible ranged attacker.', manaCost: 4, ruleId: 'ranged' }],
    omittedCandidates: 0 };
}
const config = (): CombatDecisionConfig => ({ ...COMBAT_DECISION_DEFAULTS,
  enabled: true, mode: 'act', selectionMode:'single', endpoint: 'http://decision.invalid/systemone' });
function response(choice = 'option_0', p = 0.9) {
  return new Response(JSON.stringify({ answers: { tactic: { type: 'choice', choice,
    confidence: p, probabilities: { keep: choice === 'keep' ? p : 1 - p, option_0: choice === 'keep' ? 1 - p : p } } },
    latency_ms: 20, usage: { input_tokens: 440 } }), { status: 200 });
}
function rig() {
  let f: CombatDecisionFrame | null = frame();
  const cfg = config(), reports: Array<{ event: string; data: Record<string, unknown> }> = [];
  const sent: CombatCandidate[] = [], requests: Record<string, unknown>[] = [];
  let resolve!: (r: Response) => void, signal: AbortSignal | undefined, fallbacks = 0, samples = 0;
  const loop = new CombatDecisionLoop({ config: () => cfg,
    sample: () => { samples++; return f ? structuredClone(f) : null; },
    apply: candidate => { sent.push(candidate); return true; },
    fallback: () => { fallbacks++; }, report: (event, data) => reports.push({ event, data }),
    fetchImpl: (async (_url, init) => {
      signal = init?.signal as AbortSignal;
      requests.push(JSON.parse(String(init?.body)));
      return await new Promise<Response>(r => { resolve = r; });
    }) as typeof fetch,
  });
  return { loop, cfg, reports, sent, requests, get f() { return f; }, set f(value) { f = value; },
    resolve: (r = response()) => resolve(r), get signal() { return signal; },
    get fallbacks() { return fallbacks; }, get samples() { return samples; } };
}
afterEach(() => vi.useRealTimers());

describe('independent asynchronous combat choices', () => {
  it('thresholds the selected probability consistently when the service reports above-chance confidence', async () => {
    vi.useFakeTimers(); const r = rig(); r.loop.tick();
    r.resolve(new Response(JSON.stringify({ answers: { tactic: { choice: 'option_0', confidence: .6,
      probabilities: { keep: .2, option_0: .8 } } } })));
    await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'sent', probability: .8, confidence: .6 });
    r.loop.stop();
  });

  it('offers alternative visible enemies while the current combat controller is already fighting', () => {
    const r = rig(); r.cfg.allowEngage = true; r.cfg.allowMovement = true; r.cfg.engageScope = 'hostile';
    r.f!.battlefield.actors.push(...[4, 5].map(entityId => ({ ...r.f!.battlefield.actors[0], entityId,
      uuid: String(entityId), distance: entityId })));
    const choices = combatReactions(flatBot(), r.f!.battlefield, r.cfg, { bodyFree: false, canStep: false,
      targetId: 3, sinceHitMs: 100, fight: 'auto', fleeHealth: 6, chaseMax: 12 });
    expect(choices.filter(c => c.kind === 'engage').map(c => c.kind === 'engage' && c.targetId)).toEqual([4, 5]);
    expect(choices.some(c => c.kind === 'retreat')).toBe(true);
    r.loop.stop();
  });
  it('tolerates unrelated neutral bystander visibility and departure', async () => {
    vi.useFakeTimers(); const r = rig();
    r.f!.battlefield.actors.push({ ...r.f!.battlefield.actors[1], entityId: 8, uuid: 'neutral', relation: 'neutral', targetEntityId: null });
    r.loop.tick(); r.f!.battlefield.actors.pop(); r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1); expect(r.reports.at(-1)?.data.outcome).toBe('sent'); r.loop.stop();
  });
  it.each(['new-hostile', 'bystander-attacks', 'hidden-actors'])('still rejects a changed threat: %s', async change => {
    vi.useFakeTimers(); const r = rig(); r.loop.tick();
    if (change === 'hidden-actors') r.f!.battlefield.omitted = 2;
    else r.f!.battlefield.actors.push({ ...r.f!.battlefield.actors[0], entityId: 8, uuid: 'new',
      relation: change === 'new-hostile' ? 'hostile' : 'neutral', targetEntityId: 1 });
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(0); expect(r.reports.at(-1)?.data.outcome).toBe('scene-changed'); r.loop.stop();
  });
  it.each([['clear-lead', [.45, .3, .2, .05], 'sent'], ['near-tie', [.4, .39, .16, .05], 'uncertain']] as const)
    ('uses a separately configured multi-option floor and rejects %s ambiguity', async (_name, scores, expected) => {
      vi.useFakeTimers(); const r = rig(); r.cfg.minConfidence = .4; r.cfg.minMargin = .1;
      r.f!.candidates.push({ id: 'withdraw', kind: 'retreat', intent: 'Withdraw.' },
        { id: 'follow', kind: 'track', targetId: 3, uuid: 'target', minDistance: 5, maxDistance: 8, leaseMs: 4000, intent: 'Observe at distance.' });
      r.loop.tick(); r.resolve(new Response(JSON.stringify({ answers: { tactic: { choice: 'option_0', confidence: scores[0],
        probabilities: { option_0: scores[0], option_1: scores[1], option_2: scores[2], keep: scores[3] } } } })));
      await vi.advanceTimersByTimeAsync(1);
      expect(r.reports.at(-1)?.data.outcome).toBe(expected); expect(r.sent).toHaveLength(expected === 'sent' ? 1 : 0);
    });
  it('uses a ranked lead by default, with explicit probability floors and live stricter gates preserved', async () => {
    vi.useFakeTimers(); const r = rig();
    r.f!.candidates.push({ id: 'withdraw', kind: 'retreat', intent: 'Withdraw.' },
      { id: 'follow', kind: 'track', targetId: 3, uuid: 'target', minDistance: 5, maxDistance: 8, leaseMs: 4000, intent: 'Observe at distance.' });
    const choose = () => r.resolve(new Response(JSON.stringify({ answers: { tactic: { choice: 'option_0', confidence: .45,
      probabilities: { option_0: .45, option_1: .3, option_2: .2, keep: .05 } } } })));
    r.loop.tick(); choose(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data).toMatchObject({ application: { attempted: true, dispatched: true, keptCurrent: false },
      validation: { ranking: { accepted: true, minProbability: 0, minMargin: .1 } } });
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs); r.cfg.minConfidence = .75;
    r.loop.tick(); choose(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'uncertain', validation: { ranking: { reason: 'probability-floor' } } });
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs); r.cfg.minConfidence = 0;
    r.loop.tick(); r.cfg.minMargin = .3; choose(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'uncertain', validation: { ranking: { minMargin: .3 } } });
    r.loop.stop();
  });
  it('abstains on tied or near-tied ranks instead of manufacturing a useful choice', async () => {
    vi.useFakeTimers(); const r = rig();
    for (const p of [.5, .52]) {
      r.loop.tick(); r.resolve(response('option_0', p)); await vi.advanceTimersByTimeAsync(1);
      expect(r.sent).toHaveLength(0); expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'uncertain',
        application: { attempted: false, dispatched: false }, validation: { ranking: { reason: 'ambiguous-ranking' } } });
      await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs);
    }
    r.loop.stop();
  });
  it('tolerates visibility changes of an unknown bystander without treating it as an ally', async () => {
    vi.useFakeTimers(); const r = rig();
    r.f!.battlefield.actors.push({ ...r.f!.battlefield.actors[1], entityId: 7, uuid: 'unknown', relation: 'unknown', relationSource: 'unknown' });
    r.loop.tick(); r.f!.battlefield.actors[2].lineOfSight = false;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1); expect(r.f!.battlefield.actors[2].relation).toBe('unknown');
    expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'sent', validation: { toleratedSceneChanges: ['non-target-unknown-visibility'] } });
    r.loop.stop();
  });
  it.each(['departed', 'died', 'hidden'] as const)('refreshes a chosen target when an unrelated threat %s', async change => {
    vi.useFakeTimers(); const r = rig();
    r.f!.battlefield.actors.push({ ...r.f!.battlefield.actors[0], health: {...r.f!.battlefield.actors[0].health}, entityId: 7, uuid: 'other-threat', targetEntityId: null });
    r.loop.tick();
    if (change === 'departed') r.f!.battlefield.actors.pop();
    if (change === 'died') r.f!.battlefield.actors[2].health.current = 0;
    if (change === 'hidden') r.f!.battlefield.actors[2].lineOfSight = false;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);expect(r.reports.at(-1)?.data.outcome).toBe('sent');r.loop.stop();
  });
  it('retains strict actor dependencies for opaque authored methods', () => {
    const before=frame();before.battlefield.actors.push({...before.battlefield.actors[1],entityId:7,uuid:'unknown',relation:'unknown'});
    const after=structuredClone(before);after.battlefield.actors[2].lineOfSight=false;
    // No method executes here; comparison must not assume what a user program reads.
    expect(assessCombatDecisionScene(before,after,{kind:'method'} as CombatCandidate).changed).toContain('actors');
  });
  it.each(['unknown-attacks', 'ally-hidden', 'threat-visible', 'target-identity', 'relation-changed'] as const)
    ('keeps critical dependency checks for %s', async change => {
      vi.useFakeTimers(); const r = rig();
      r.f!.battlefield.actors.push({ ...r.f!.battlefield.actors[0], entityId: 7, uuid: 'other',
        relation: change === 'unknown-attacks' ? 'unknown' : 'hostile', targetEntityId: null,
        lineOfSight: change !== 'threat-visible' });
      r.loop.tick();
      if (change === 'unknown-attacks') r.f!.battlefield.actors[2].targetEntityId = 1;
      if (change === 'ally-hidden') r.f!.battlefield.actors[1].lineOfSight = false;
      if (change === 'threat-visible') r.f!.battlefield.actors[2].lineOfSight = true;
      if (change === 'target-identity') r.f!.battlefield.actors[0].uuid = 'replacement';
      if (change === 'relation-changed') r.f!.battlefield.actors[2].relation = 'unknown';
      r.resolve();await vi.advanceTimersByTimeAsync(1);
      expect(r.sent).toHaveLength(0);expect(r.reports.at(-1)?.data.outcome).toBe('scene-changed');r.loop.stop();
    });
  it('sends game health/type facts and applies a choice while the main-model request is still pending', async () => {
    vi.useFakeTimers();
    let mainReturned = false;
    let finishMain!: () => void;
    const main = new Promise<void>(r => { finishMain = r; }).then(() => { mainReturned = true; });
    const r = rig();
    expect(r.loop.tick()).toBe(true);
    expect(r.requests).toHaveLength(1);
    expect((r.requests[0].state as CombatDecisionFrame).battlefield.actors).toMatchObject([
      { type: 'skeleton', health: [12, 20, 'server', expect.any(Number)], targetEntityId: 1 },
      { relation: 'ally', health: [5, 30, 'server', expect.any(Number)] },
    ]);
    expect((r.requests[0].state as CombatDecisionFrame).battlefield.action).toMatchObject({ targetEntityId: 3, sinceHitMs: 3000, canStep: true });
    r.f!.battlefield.action.sinceHitMs = 3050;
    expect(r.sent).toHaveLength(0);
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(mainReturned).toBe(false); expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data).toMatchObject({ outcome: 'sent', modelMs: 20, usage: { input_tokens: 440 } });
    finishMain(); await main;
  });

  it('revalidates the same engagement after a small distance change', async () => {
    vi.useFakeTimers(); const r = rig(), bot = flatBot(), f = r.f!.battlefield;
    r.cfg.allowEngage = true; r.cfg.engageScope = 'hostile';
    f.action.fighting = false; f.action.canStep = false; f.action.targetEntityId = null;
    const control = { bodyFree: true, canStep: false, targetId: null, sinceHitMs: null,
      fight: 'armed', fleeHealth: 6, chaseMax: 12 };
    r.f!.candidates = combatReactions(bot, f, r.cfg, control);
    const before = r.f!.candidates[0];
    r.loop.tick();
    bot.entity.position.x = .25; f.self.position[0] = .25; f.actors[0].distance = 2.75;
    r.f!.candidates = combatReactions(bot, f, r.cfg, control);
    expect(r.f!.candidates[0].intent).not.toBe(before.intent);
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toEqual([r.f!.candidates[0]]);
    expect(r.reports.at(-1)?.data.outcome).toBe('sent');
  });

  it('uses the freshly checked short-step destination after bounded movement', async () => {
    vi.useFakeTimers(); const r = rig(), bot = flatBot(), f = r.f!.battlefield;
    r.cfg.allowMovement = true;
    const control = { bodyFree: false, canStep: true, targetId: 3, sinceHitMs: 3000,
      fight: 'armed', fleeHealth: 6, chaseMax: 12 };
    r.f!.candidates = combatReactions(bot, f, r.cfg, control).filter(c => c.kind === 'step').slice(0, 1);
    const before = r.f!.candidates[0];
    r.loop.tick();
    bot.entity.position.x = .25; f.self.position[0] = .25; f.actors[0].distance = 2.75;
    r.f!.candidates = combatReactions(bot, f, r.cfg, control).filter(c => c.kind === 'step').slice(0, 1);
    expect(r.f!.candidates[0]).not.toEqual(before);
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toEqual([r.f!.candidates[0]]);
  });

  it('preserves a choice when distance sorting changes actor order', async () => {
    vi.useFakeTimers(); const r = rig(); r.loop.tick();
    r.f!.battlefield.actors.reverse();
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('sent');
  });

  it('preserves an eligible choice across mana regeneration', async () => {
    vi.useFakeTimers(); const r = rig(); r.f!.mana = 20; r.loop.tick();
    r.f!.mana = 20.12;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('sent');
  });

  it.each(['health', 'ally-health', 'mana', 'connection', 'plan', 'target', 'sight', 'task', 'cooldown', 'emergency', 'attack-target'])
    ('rejects a result after %s changes', async change => {
      vi.useFakeTimers(); const r = rig(); r.loop.tick();
      const f = r.f!;
      if (change === 'health') f.battlefield.self.health.current = 8;
      if (change === 'ally-health') f.battlefield.actors[1].health.current = 1;
      if (change === 'mana') f.mana = 2;
      if (change === 'connection') f.battlefield.connectionGeneration++;
      if (change === 'plan') f.tacticRevision++;
      if (change === 'target') f.battlefield.actors.shift();
      if (change === 'sight') f.battlefield.actors[0].lineOfSight = false;
      if (change === 'task') f.battlefield.action.taskId = 90;
      if (change === 'attack-target') f.battlefield.action.targetEntityId = 4;
      if (change === 'body-phase') f.battlefield.action.canStep = false;
      if (change === 'cooldown') { f.skills[0].block = 'cooldown'; f.candidates = []; }
      if (change === 'emergency') f.battlefield.action.emergency = true;
      r.resolve(); await vi.advanceTimersByTimeAsync(1);
      expect(r.sent).toHaveLength(0); expect(r.reports.at(-1)?.data.outcome).toBe('scene-changed');
    });

  it('does not cast in shadow mode and invalidates a hot mode change', async () => {
    vi.useFakeTimers(); const r = rig(); r.cfg.mode = 'shadow'; r.loop.tick();
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(0); expect(r.reports.at(-1)?.data.outcome).toBe('shadow');
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs);
    r.loop.tick(); r.cfg.mode = 'act'; r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(0); expect(r.reports.at(-1)?.data.outcome).toBe('configuration-changed');
  });

  it('retains a ready cast when an unrelated skill becomes ready', async () => {
    vi.useFakeTimers(); const r = rig();
    r.f!.skills.push({ spell: 'other', available: true, manaCost: 4, cooldownRemainingMs: 2000, block: 'cooldown' });
    r.loop.tick(); r.f!.skills[1].cooldownRemainingMs = 1950;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs); r.loop.tick();
    r.f!.skills[1].cooldownRemainingMs = 0;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(2);
    expect(r.reports.at(-1)?.data.outcome).toBe('sent');
  });

  it('rechecks the chosen skill without discarding it for an ordinary hit, food tick or melee swing phase', async () => {
    vi.useFakeTimers(); const r=rig(); r.loop.tick();
    r.f!.battlefield.self.health.current=19;
    r.f!.battlefield.self.food=19;
    r.f!.battlefield.action.canStep=false;
    r.f!.battlefield.actors[0].health.current=10;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('sent');
  });

  it('still rejects a short step after movement ownership changes', async () => {
    vi.useFakeTimers(); const r=rig();
    r.f!.candidates=[{id:'step',kind:'step',intent:'side step',destination:[0,64,1]}];
    r.loop.tick();r.f!.battlefield.action.canStep=false;
    r.resolve();await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(0);expect(r.reports.at(-1)?.data.outcome).toBe('scene-changed');
  });

  it('times out without overlapping requests and ignores a late reply', async () => {
    vi.useFakeTimers(); const r = rig();
    r.loop.tick(); for (let i = 0; i < 20; i++) r.loop.tick();
    expect(r.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(r.cfg.timeoutMs + 1);
    expect(r.signal?.aborted).toBe(true); expect(r.fallbacks).toBe(1);
    expect(r.reports.at(-1)?.data.reason).toBe('timeout');
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.sent).toHaveLength(0);
  });

  it('expires old results and keeps a completed movement from using an old origin', async () => {
    vi.useFakeTimers(); const r = rig(); r.cfg.timeoutMs = 2000; r.loop.tick();
    await vi.advanceTimersByTimeAsync(r.cfg.maxAgeMs + 1);
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('expired');
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs); r.loop.tick();
    r.f!.battlefield.self.position[0] += 2;
    r.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('moved'); expect(r.sent).toHaveLength(0);
    expect(r.reports.at(-1)?.data.application).toEqual({attempted:false,dispatched:false,keptCurrent:false,reason:'origin-moved'});
  });

  it('preserves keep and falls back on low probability using selected-option probability', async () => {
    vi.useFakeTimers(); const r = rig(); r.cfg.minConfidence = .75; r.loop.tick(); r.resolve(response('keep'));
    await vi.advanceTimersByTimeAsync(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('keep'); expect(r.fallbacks).toBe(0);
    expect(r.reports.at(-1)?.data.application).toMatchObject({attempted:false,dispatched:false,keptCurrent:true});
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs); r.loop.tick(); r.resolve(response('option_0', .6));
    await vi.advanceTimersByTimeAsync(1);
    expect(r.reports.at(-1)?.data.outcome).toBe('uncertain'); expect(r.fallbacks).toBe(1); expect(r.sent).toHaveLength(0);
  });

  it('bounds empty-scene sampling and never asks inference to handle an emergency', async () => {
    vi.useFakeTimers(); const r = rig(); r.f!.candidates = [];
    for (let i = 0; i < 20; i++) { r.loop.tick(); await vi.advanceTimersByTimeAsync(10); }
    expect(r.samples).toBe(1); expect(r.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(r.cfg.minIntervalMs);
    r.f = frame(); r.f.battlefield.action.emergency = true;
    expect(r.loop.tick()).toBe(false); expect(r.requests).toHaveLength(0);
  });
});

function flatBot() {
  const bot = { entity: { id: 1, position: new Vec3(0, 64, 0), onGround: true }, health: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] },
    entities: { 3: { name: 'skeleton', position: new Vec3(3, 64, 0), isValid: true } },
    blockAt: (p: Vec3) => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty',
      shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [], getProperties: () => ({}) }),
  };
  return bot as unknown as Bot;
}
describe('physically available combat candidates', () => {
  it('does not offer native engagement without a usable weapon, but still offers withdrawal', () => {
    const bot=flatBot(), f=frame().battlefield;
    f.action.fighting=false;
    const cfg={...config(),allowEngage:true,allowMovement:true,engageScope:'hostile' as const};
    const control={bodyFree:true,canStep:false,targetId:null,sinceHitMs:null,fight:'auto',fleeHealth:6,chaseMax:12};
    bot.inventory.items=()=>[];
    expect(combatReactions(bot,f,cfg,control).map(c=>c.kind)).toEqual(['retreat']);
    bot.inventory.items=()=>[{name:'iron_sword',count:1}] as any;
    expect(combatReactions(bot,f,cfg,control).some(c=>c.kind==='engage')).toBe(true);
    (bot as any).deathLifecycle={inventorySynced:false};
    expect(combatReactions(bot,f,cfg,control).map(c=>c.kind)).toEqual(['retreat']);
  });
  it('does not let a neutral first actor hide an eligible tracking target, or offer withdrawal without a native threat', () => {
    const bot = flatBot(), f = frame().battlefield;
    f.action.fighting = false;
    f.actors = [ { ...f.actors[0], entityId: 7, type: 'enderman' }, { ...f.actors[0], entityId: 8, type: 'zombie' } ];
    const cfg = { ...config(), allowEngage: false, allowMovement: true };
    const control = { bodyFree: true, canStep: false, targetId: null, sinceHitMs: null, fight: 'auto', fleeHealth: 6,
      chaseMax: 12, trackingTargets: new Set([8]), retreatAvailable: true };
    expect(combatReactions(bot, f, cfg, control).map(c => c.kind)).toEqual(['retreat']);
    const choices = combatReactions(bot, f, cfg, control, true);
    expect(choices.map(c => c.kind)).toEqual(['retreat', 'track']);
    expect(choices[1]).toMatchObject({ kind: 'track', targetId: 8 });
    expect(combatReactions(bot, f, cfg, { ...control, trackingTargets: new Set(), retreatAvailable: false })).toEqual([]);
  });
  it('offers attack and withdrawal before the first hit, without a default watch option or stealing unavailable work', () => {
    const bot = flatBot(), f = frame().battlefield, cfg = { ...config(), allowEngage: true, allowMovement: true, engageScope: 'hostile' as const };
    f.action.fighting = false;
    const control = { bodyFree: true, canStep: false, targetId: null, sinceHitMs: null, fight: 'armed', fleeHealth: 6, chaseMax: 12 };
    expect(combatReactions(bot, f, cfg, control).map(c => c.kind)).toEqual(['retreat', 'engage']);
    f.actors[0].position = [7.7,64,0]; f.actors[0].distance = 7.7;
    expect(combatReactions(bot, f, cfg, { ...control, chaseMax: 6, engagementTargets: new Set([3]) })
      .find(c => c.kind === 'engage')).toMatchObject({ targetId: 3 });
    expect(combatReactions(bot, f, cfg, { ...control, engagementTargets: new Set() })
      .some(c => c.kind === 'engage')).toBe(false);
    expect(combatReactions(bot, f, cfg, { ...control, bodyFree: false })).toEqual([]);
    f.actors[0].relation = 'unknown';
    expect(combatReactions(bot, f, cfg, control)).toEqual([]);
  });
  it('retains a server catalogued cost through partial HUD updates, but forgets it on removal or reconnect', () => {
    const spells=new CombatSpells(), bot=flatBot(), field=frame().battlefield;
    spells.setTactic({spells:null,healAtOrBelow:6,rules:[{id:'bolt',spell:'spark',intent:'Hit a visible enemy',when:{within:12}}]});
    spells.noteMana(20);
    spells.noteAbilities([{id:'spark', cooldownMs:null, manaCost:4}]);
    spells.noteAbilities([{id:'spark',cooldownMs:null,cooldownRemainingMs:0,manaCost:null}]);
    expect(spells.decisionFrame(bot,field,2).candidates[0]).toMatchObject({kind:'cast',manaCost:4});
    spells.noteAbilities([{id:'spark',cooldownMs:null,cooldownRemainingMs:0,manaCost:7}]);
    expect(spells.decisionFrame(bot,field,2).candidates[0]).toMatchObject({manaCost:7});
    spells.noteAbilities([]);
    spells.noteAbilities([{id:'spark',cooldownMs:null,cooldownRemainingMs:0,manaCost:null}]);
    expect(spells.decisionFrame(bot,field,2).skills[0].block).toBe('mana-cost-unknown');
    spells.noteAbilities([{id:'spark', cooldownMs:null, manaCost:4}]);
    spells.reset();
    expect(spells.decisionFrame(bot,field,2).skills[0].manaCost).toBeNull();
  });
  const control = { bodyFree: true, canStep: true, targetId: 3, sinceHitMs: 3000,
    fight: 'armed', fleeHealth: 6, chaseMax: 12 };
  it('party scope requires an authoritative target relation and a free body', () => {
    const bot = flatBot(), f = frame().battlefield, cfg = config();
    f.action.fighting = false; cfg.allowEngage = true;
    f.actors[0].targetEntityId = 2;
    expect(combatReactions(bot, f, cfg, control).map(c => c.kind)).toEqual(['engage']);
    expect(combatReactions(bot, f, cfg, { ...control, bodyFree: false })).toEqual([]);
    f.actors[1].relation = 'unknown';
    expect(combatReactions(bot, f, cfg, control)).toEqual([]);
    cfg.engageScope = 'hostile';
    expect(combatReactions(bot, f, cfg, control).map(c => c.kind)).toEqual(['engage']);
    f.self.health.current = 5;
    expect(combatReactions(bot, f, cfg, control)).toEqual([]);
  });

  it('offers loaded, supported short moves without disrupting a useful ongoing attack', () => {
    const bot = flatBot(), f = frame().battlefield, cfg = config(); cfg.allowMovement = true;
    const choices = combatReactions(bot, f, cfg, control);
    expect(choices.filter(c => c.kind === 'step')).toHaveLength(2);
    expect(choices.some(c => c.kind === 'retreat')).toBe(true);
    expect(choices.map(c => c.kind)).toEqual(['retreat', 'step', 'step']);
    expect(combatReactions(bot, f, cfg, { ...control, sinceHitMs: 20 }).map(c => c.kind)).toEqual(['retreat']);
    expect(combatReactions(bot, f, cfg, { ...control, canStep: false }).map(c => c.kind)).toEqual(['retreat']);
    bot.blockAt = () => null;
    expect(combatReactions(bot, f, cfg, control).map(c => c.kind)).toEqual(['retreat']);
  });

  it('removes casts for unknown cost, missing abilities, occlusion and changed mana', () => {
    const spells = new CombatSpells(), bot = flatBot(), f = frame().battlefield;
    spells.setTactic({ spells: ['spark'], healAtOrBelow: 6,
      rules: [{ id: 'ranged', spell: 'spark', intent: 'Hit one visible ranged enemy.', when: { within: 12, reserveMana: 6 } }] });
    spells.noteMana(20);
    spells.noteAbilities([{ id: 'spark', cooldownMs: 0 }]);
    expect(spells.decisionFrame(bot, f, 2).candidates).toEqual([]);
    spells.noteAbilities([{ id: 'spark', cooldownMs: 0, cooldownRemainingMs: 0, manaCost: 4 }]);
    expect(spells.decisionFrame(bot, f, 2).candidates).toHaveLength(1);
    spells.noteAbilities([{ id: 'spark', cooldownMs: 0, cooldownRemainingMs: null, manaCost: 4 }]);
    expect(spells.decisionFrame(bot, f, 2).candidates).toEqual([]);
    spells.noteAbilities([{ id: 'spark', cooldownMs: 0, cooldownRemainingMs: 0, manaCost: 4 }]);
    f.actors[0].lineOfSight = false;
    expect(spells.decisionFrame(bot, f, 2).candidates).toEqual([]);
    f.actors[0].lineOfSight = true; spells.noteMana(5);
    expect(spells.decisionFrame(bot, f, 2).candidates).toEqual([]);
    spells.reset();
    expect(spells.decisionFrame(bot, f, 2).skills[0].available).toBe(false);
  });
});

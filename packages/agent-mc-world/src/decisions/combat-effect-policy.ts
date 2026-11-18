import { join } from 'node:path';
import { z } from 'zod';
import { reweightJitRl } from '../../core/jitrl.ts';
import { experienceHash, operationActionHash, operationScopeKey, OperationExperienceBook } from '../../core/operation-experience.ts';
import { parseTypedChoice } from '../../core/support/typed-decision.ts';
import type { DecisionPort } from '../contracts/decision.ts';

const key = z.string().regex(/^[a-z0-9][a-z0-9_./:-]{0,95}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const amount = z.number().min(0).max(10_000);
const timestamp = z.iso.datetime({offset:true});
const scopeSchema = z.strictObject({realm:key, account:key, agent:key});
const observation = z.strictObject({
  at:timestamp, position:z.strictObject({x:z.number(),y:z.number(),z:z.number()}), health:amount,
});
const candidateSchema = z.strictObject({id:key, revision:digest, expectedTargets:z.number().int().min(0).max(8),
  expectedAllies:z.number().int().min(0).max(8), cost:amount, priority:z.number().int().min(1).max(3),
  effect:z.enum(['single_target','single_target_with_bleed','group_damage','group_damage_and_heal','group_heal'])});
const frameSchema = z.strictObject({scope:scopeSchema, run:key, sceneId:digest, dimension:key,
  goal:z.enum(['guard','heal']), rangeBand:z.number().int().min(0).max(2), threatType:key,
  threatCount:z.number().int().min(0).max(8), injuredAllies:z.number().int().min(0).max(8),
  durable:z.boolean(), before:observation, resource:amount, candidates:z.array(candidateSchema).min(1).max(8),
  baseline:key,
}).refine(frame => new Set(frame.candidates.map(row => row.id)).size === frame.candidates.length
  && frame.candidates.some(row => row.id === frame.baseline)
  && frame.candidates.every(row => row.cost <= frame.resource && row.expectedTargets <= frame.threatCount
    && row.expectedAllies <= frame.injuredAllies && row.expectedTargets + row.expectedAllies > 0));
const feedbackSchema = z.strictObject({frame:frameSchema, decisionId:key.optional(), operationId:z.uuid(), candidateId:key,
  after:observation, damage:amount, healing:amount, resourceSpent:amount, status:z.enum(['applied','blocked'])});

export type CombatEffectFrame = z.infer<typeof frameSchema>;
export type CombatEffectFeedback = z.infer<typeof feedbackSchema>;
type Choice = {decisionId:string; choice:string; source:'system1'|'history'|'rule'; expiresAt:number; evidenceIds:string[]};
type Issued = {choice:Choice; bind:string; scope:string; probabilities:Record<string,number>; model:string|null;
  elapsedMs:number; usedBy?:string};
const CHOICE_MAX_AGE = 1500;
const ACTION = 'native-combat-effect';
const featureKey = (frame:CombatEffectFrame) => experienceHash([frame.dimension, frame.goal, frame.rangeBand, frame.threatType,
  frame.threatCount, frame.injuredAllies, frame.durable]);
const actionArgs = (candidate:CombatEffectFrame['candidates'][number]) => ({spell:candidate.id, revision:candidate.revision});
const snapshot = (frame:CombatEffectFrame, sample:CombatEffectFrame['before']) => ({
  ...sample, dimension:frame.dimension, food:null, inventory:null,
});
const boundFrame = (frame:CombatEffectFrame) => experienceHash([frame.scope, frame.run, frame.sceneId, featureKey(frame),
  frame.candidates.map(candidate => [candidate.id,candidate.revision]).sort()]);
type KnownEffect = {damage:number; healing:number; resourceSpent:number};
function measuredValue(effect:KnownEffect, goal:CombatEffectFrame['goal'], blocked:boolean) {
  if (blocked) return -0.35;
  const useful = goal === 'heal' ? effect.healing / 12 + effect.damage / 80 : effect.damage / 32 + effect.healing / 40;
  return Math.max(-1, Math.min(1, useful - effect.resourceSpent / 120));
}

/** Host-owned typed choice and authoritative execution. The core persists comparable effects and adjusts ready candidates. */
export function createCombatEffectPolicy(options:{directory:string; port:DecisionPort; timeoutMs?:number; now?:()=>number}) {
  const book = new OperationExperienceBook(join(options.directory, 'minecraft-memory'));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 450;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 650) throw Error('Invalid combat choice deadline');
  const issued = new Map<string,Issued>();
  const active = new Set<string>();
  function purge() {
    for (const [id, row] of issued) if (row.choice.expiresAt + 5_000 < now()) issued.delete(id);
  }
  async function choose(input:unknown, decisionId:string):Promise<Choice> {
    const frame = frameSchema.parse(input);
    const id = key.parse(decisionId);
    const scope = operationScopeKey(frame.scope), binding = boundFrame(frame);
    const started = now(), expiresAt = Date.parse(frame.before.at) + CHOICE_MAX_AGE;
    if (started >= expiresAt || Date.parse(frame.before.at) > started + 100) throw Error('Combat frame expired');
    if (frame.candidates.length < 2) throw Error('A single ready action is handled by the executor');
    purge();
    const original = issued.get(id);
    if (original) {
      if (original.bind !== binding) throw Error('Decision ID conflict');
      return original.choice;
    }
    if (active.has(scope) || issued.size >= 256) throw Error('A combat choice is already pending');
    active.add(scope);
    const ready = frame.candidates.map(row => row.id);
    // The fallback prior is deliberately modest. It orders current eligible actions only.
    const fallback = Object.fromEntries(ready.map(name => [name, name === frame.baseline ? 0.54 : 0.46 / (ready.length - 1)]));
    let probabilities = fallback, model:string|null = null, base = frame.baseline;
    let source:Choice['source'] = 'rule';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const promise = options.port.request({
        state:{goal:frame.goal, threatCount:frame.threatCount, threatType:frame.threatType, durable:frame.durable,
          rangeBand:frame.rangeBand, injuredAllies:frame.injuredAllies, resource:frame.resource},
        questions:{effect:{type:'choice',
          instructions:'Choose one currently available combat action. Prioritize useful healing if the goal is heal, otherwise maximize reliable damage for the actual threats. Compare their effect, eligible targets, allies and resource cost.',
          criteria:Object.fromEntries(frame.candidates.map(row => [row.id,
            `${row.effect}, eligible hostiles ${row.expectedTargets}, injured allies ${row.expectedAllies}, resource cost ${row.cost}`]))}},
      }, {timeoutMs,signal:controller.signal});
      const answer = await Promise.race([promise, new Promise<never>((_resolve, reject) =>
        controller.signal.addEventListener('abort', () => reject(Error('Combat choice timeout')), {once:true}))]);
      const typed = parseTypedChoice(answer.answers.effect, ready);
      if (typed && typed.choiceProbability >= 0.55 && ready.every(name =>
        name === typed.choice || typed.choiceProbability - typed.probabilities[name]! >= 0.10)) {
        probabilities = typed.probabilities;
        base = typed.choice;
        model = typeof answer.model === 'string' && answer.model.length <= 160 ? answer.model : null;
        source = 'system1';
      }
    } catch { /* The body keeps its immediately executable fallback. */ }
    finally { clearTimeout(timer); controller.abort(); active.delete(scope); }
    if (now() >= expiresAt) throw Error('Combat choice arrived too late');
    const contextKey = featureKey(frame);
    const candidates = frame.candidates.map(row => ({id:row.id, actionHash:operationActionHash(ACTION, actionArgs(row)),
      prior:probabilities[row.id]!, ready:true}));
    const samples = book.list(frame.scope, {limit:20}).entries.filter(row => row.combatEffect?.contextKey === contextKey
      && row.execution?.terminal && ['completed','blocked'].includes(row.execution.phase)
      && candidates.some(candidate => candidate.actionHash === row.actionHash)
      && now() - Date.parse(row.combatEffect!.observedAt) >= 0 && now() - Date.parse(row.combatEffect!.observedAt) <= 30 * 86_400_000)
      .slice(0,10);
    const ranked = reweightJitRl(candidates, samples.map(row => ({
      id:row.id, actionHash:row.actionHash!, value:measuredValue(row.combatEffect!,frame.goal,row.execution!.phase === 'blocked'),
    })));
    // Require repeated evidence for a single action before a historical result can replace a fresh choice.
    const best = ranked.candidates.reduce((left,right) => left.posterior >= right.posterior ? left : right);
    const baseRow = ranked.candidates.find(row => row.id === base)!;
    const repeated = best.samples >= 2 || baseRow.samples >= 2;
    const useMemory = repeated && best.id !== base && best.posterior - baseRow.posterior >= 0.04;
    const choice = {decisionId:id, choice:useMemory ? best.id : base, source:useMemory ? 'history' : source, expiresAt,
      evidenceIds:useMemory ? samples.map(row => row.id) : []} satisfies Choice;
    issued.set(id,{choice,bind:binding,scope,probabilities,model,elapsedMs:now()-started});
    return choice;
  }
  function observe(input:unknown) {
    const report = feedbackSchema.parse(input);
    const {frame, operationId, after, status} = report;
    const sampled = Date.parse(frame.before.at), completed = Date.parse(after.at);
    if (completed < sampled || completed - sampled > CHOICE_MAX_AGE || completed > now() + 100
      || now() - completed > 5_000) throw Error('Effect receipt time is invalid');
    const candidate = frame.candidates.find(row => row.id === report.candidateId);
    if (!candidate || status === 'applied' && (report.damage + report.healing <= 0 || report.resourceSpent > candidate.cost + 0.01)
      || status === 'blocked' && (report.damage + report.healing + report.resourceSpent !== 0)) throw Error('Unverified combat effect');
    const decision = report.decisionId === undefined ? null : issued.get(report.decisionId);
    if (report.decisionId !== undefined && (!decision || decision.scope !== operationScopeKey(frame.scope)
      || decision.bind !== boundFrame(frame) || decision.choice.choice !== candidate.id || completed > decision.choice.expiresAt
      || decision.usedBy && decision.usedBy !== operationId)) throw Error('Effect does not match the adopted choice');
    if (!decision && frame.baseline !== candidate.id) throw Error('Rule effect does not match the ready fallback');
    const contextKey = featureKey(frame), decisionId = report.decisionId ?? `rule-${operationId}`;
    const at = decision?.choice.source ?? 'rule';
    const memoryRefs = decision?.choice.evidenceIds.map(id => `mc-experience:${id}`) ?? [];
    book.decision(frame.scope,frame.run,{id:decisionId,category:'combat-effect',selected:candidate.id,
      status:at, controller:at === 'rule' ? 'unknown' : 'system1', contextHash:contextKey, model:decision?.model,
      elapsedMs:decision?.elapsedMs, candidates:frame.candidates.map(row => ({id:row.id,ready:true,
        probability:decision?.probabilities[row.id] ?? null})), recalledMemoryRefs:memoryRefs}, snapshot(frame,frame.before));
    const operation = book.begin(frame.scope,frame.run,operationId,ACTION,actionArgs(candidate),snapshot(frame,frame.before),
      {decisionId, controller:at === 'rule' ? 'unknown' : 'system1', memoryRefs});
    if (operation.combatEffect && experienceHash([operation.combatEffect.damage,operation.combatEffect.healing,operation.combatEffect.resourceSpent,operation.combatEffect.observedAt])
      !== experienceHash([report.damage,report.healing,report.resourceSpent,after.at])) throw Error('Physical receipt conflict');
    const row = book.finish(frame.scope,operation.id,{execution:{kind:'task',id:operationId,phase:status === 'applied' ? 'completed' : 'blocked',
      terminal:true,goalCompleted:false},text:status},snapshot(frame,after),completed-sampled,{contextKey,revision:candidate.revision,
      damage:report.damage,healing:report.healing,resourceSpent:report.resourceSpent,observedAt:after.at});
    if (decision) decision.usedBy = operationId;
    return {experienceId:row.id, decisionId, deduplicated:operation.execution?.terminal === true, goalVerified:false};
  }
  return {choose,observe};
}

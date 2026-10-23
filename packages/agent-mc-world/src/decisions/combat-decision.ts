/** Optional HOST-side selector. The game engine never imports or starts this loop. */
import { parseTypedChoice } from '../../core/support/typed-decision.ts';
import { randomUUID } from 'node:crypto';
import { combatChoiceBindings,combatRequest } from './combat-request.ts';
import type { CombatExecutionPolicy, CombatCandidate, CombatDecisionFrame } from '../../core/combat-decision-types.ts';
import type { TypedChoice } from '../../core/support/typed-decision.ts';
export type { CombatExecutionPolicy, CombatCandidate, CombatDecisionFrame } from '../../core/combat-decision-types.ts';
export interface CombatDecisionConfig extends CombatExecutionPolicy {
  connection?: 'auto' | 'host' | 'endpoint'; decisionProvider?: string;
  enabled:boolean;mode:'shadow'|'act';endpoint:string;timeoutMs:number;minIntervalMs:number;minConfidence:number;maxAgeMs:number;
  /** Optional lead over the strongest alternative; model scores are not calibrated win probabilities. */
  minMargin?: number;
  /** One categorical option may combine one short body move with one ready ability. */
  selectionMode?: 'single' | 'compatible';
  model?: string; apiKeyEnv?: string;
}
export interface CombatDecisionOptions {
  config: () => CombatDecisionConfig;
  sample: () => CombatDecisionFrame | null;
  apply: (candidate: CombatCandidate, frame: CombatDecisionFrame, decision: { id: number; decisionId: string }) => boolean | Promise<boolean>;
  /** Refresh through a host tool/SDK port immediately before applying a remote choice. */
  refresh?: () => Promise<CombatDecisionFrame | null>;
  prepare?: (frame: CombatDecisionFrame) => Promise<CombatDecisionFrame>;
  fallback?: () => void;
  report: (event: string, data: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
  /** Supplied by the host adapter; the game core never resolves providers or credentials. */
  request?: (input: { state: unknown; questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> },
    options: { provider?: string; signal: AbortSignal; timeoutMs: number }) => Promise<{ answers?: Record<string,unknown>; latency_ms?: unknown; usage?: unknown }>;
  now?: () => number;
}

export const usesHostDecision = (cfg: Pick<CombatDecisionConfig, 'connection' | 'endpoint'>) =>
  cfg.connection === 'host' || (cfg.connection !== 'endpoint' && !cfg.endpoint.trim());

const healthBand = (hp: number | null, max: number | null) => hp === null ? 'unknown'
  : hp <= 0 ? 'dead' : hp <= 4 ? 'critical'
    : hp <= Math.max(10, (max ?? 20) * .5) ? 'wounded' : 'healthy';

function sceneFacts(frame: CombatDecisionFrame, selected: CombatCandidate | null) {
  const f = frame.battlefield;
  const targetId = selected?.kind === 'engage' || selected?.kind === 'track' ? selected.targetId : f.action.targetEntityId;
  const protectedIds = new Set([f.self.entityId, ...f.actors.filter(a => a.relation === 'ally').map(a => a.entityId)]);
  return { connection: [f.connectionGeneration, f.dimension], tactic: frame.tacticRevision,
    self: [f.self.entityId, healthBand(f.self.health.current, f.self.health.max), f.self.health.max,
      f.self.food === null ? null : f.self.food <= 6 ? 'hungry' : 'fed', f.self.equipment],
    omitted: f.omitted,
    action: [f.action.fighting, f.action.tracking, f.action.emergency, f.action.taskId, f.action.step, f.action.followTarget,
      f.action.targetEntityId, selected?.kind === 'step' ? f.action.canStep : null],
    skills: frame.skills.filter(s => selected?.kind === 'cast' && s.spell === selected.spell)
      .map(s => [s.spell, s.available, s.manaCost, s.block,
      s.cooldownRemainingMs === null ? null : s.cooldownRemainingMs > 0]),
    // Neutral bystanders are not action dependencies. A new threat, selected target,
    // ally, unknown relation or actor attacking the party still invalidates the choice.
    actors: f.actors.filter(e => e.relation !== 'neutral' || e.entityId === targetId
      || e.targetEntityId !== null && protectedIds.has(e.targetEntityId))
      .sort((a, b) => (a.entityId ?? -1) - (b.entityId ?? -1)
      || (a.uuid ?? '').localeCompare(b.uuid ?? '')).map(e => [e.entityId, e.uuid, e.type, e.relation,
      e.relation === 'ally' ? healthBand(e.health.current, e.health.max)
        : e.health.current === null ? 'unknown' : e.health.current <= 0 ? 'dead' : 'alive',
      e.lineOfSight, e.targetEntityId]) };
}

/** Pure dependency comparison. It starts no inference and does not authorize an action. */
export function assessCombatDecisionScene(before: CombatDecisionFrame, after: CombatDecisionFrame, selected: CombatCandidate | null): { changed: string[]; tolerated: string[] } {
  const prior = sceneFacts(before, selected), current = sceneFacts(after, selected);
  const changed: string[] = (Object.keys(prior) as Array<keyof typeof prior>)
    .filter(key => key !== 'actors' && JSON.stringify(prior[key]) !== JSON.stringify(current[key]));
  const tolerated: string[] = [];
  const targetId = selected?.kind === 'engage' || selected?.kind === 'track' ? selected.targetId
    : selected?.kind === 'retreat' ? null : before.battlefield.action.targetEntityId;
  const protectedIds = new Set([before.battlefield.self.entityId,
    ...before.battlefield.actors.filter(a => a.relation === 'ally').map(a => a.entityId)]);
  const key = (a: (typeof prior.actors)[number]) => JSON.stringify(a.slice(0, 2));
  const afterActors = new Map(current.actors.map(a => [key(a), a]));
  let actorsChanged = false;
  // Ambiguous identities cannot be relaxed by matching array positions or names.
  if (selected?.kind === 'method' || prior.actors.some(a => a[0] === null) || current.actors.some(a => a[0] === null)) {
    actorsChanged = JSON.stringify(prior.actors) !== JSON.stringify(current.actors);
  } else {
    for (const a of prior.actors) {
      const b = afterActors.get(key(a));
      afterActors.delete(key(a));
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const targeted = a[0] === targetId, ally = a[3] === 'ally';
      const attacksParty = typeof a[6] === 'number' && protectedIds.has(a[6])
        || b !== undefined && typeof b[6] === 'number' && protectedIds.has(b[6]);
      if (!b) {
        if (!targeted && a[3] === 'hostile' && !attacksParty) tolerated.push('non-target-threat-departed');
        else actorsChanged = true;
        continue;
      }
      const identityAndRelation = JSON.stringify(a.slice(0, 4)) === JSON.stringify(b.slice(0, 4));
      const sameTarget = a[6] === b[6];
      if (!targeted && !ally && !attacksParty && identityAndRelation && sameTarget) {
        if (a[3] === 'unknown' && a[4] === b[4]) {
          // Visibility of an unclassified bystander is not an attack permission or an ally fact.
          tolerated.push('non-target-unknown-visibility'); continue;
        }
        if (a[3] === 'hostile' && (b[4] === 'dead' || a[4] === b[4] && a[5] === true && b[5] === false)) {
          tolerated.push('non-target-threat-reduced'); continue;
        }
      }
      actorsChanged = true;
    }
    // New relevant actors, newly visible threats, new attacks and relation changes still recheck.
    if (afterActors.size) actorsChanged = true;
  }
  if (actorsChanged) changed.push('actors');
  // Only a cast consumes mana. Eligibility (including rule reserves) is recomputed by the engine.
  if (selected?.kind === 'cast' && before.mana !== after.mana
    && (after.mana === null || after.mana < selected.manaCost))
    changed.push('mana');
  return { changed, tolerated: [...new Set(tolerated)] };
}

/** Compare ranked alternatives without interpreting their softmax scores as win probabilities. */
export function assessCombatChoice(answer: TypedChoice<string>, config: Pick<CombatDecisionConfig, 'minConfidence' | 'minMargin'>,
  live = config) {
  const runnerUp = Math.max(0, ...Object.entries(answer.probabilities).filter(([key]) => key !== answer.choice).map(([, p]) => p));
  const margin = answer.choiceProbability - runnerUp;
  const minProbability = Math.max(config.minConfidence, live.minConfidence);
  const minMargin = Math.max(config.minMargin ?? 0, live.minMargin ?? 0);
  const reason = answer.choiceProbability < minProbability ? 'probability-floor'
    : margin <= 0.000001 || margin + 0.000001 < minMargin ? 'ambiguous-ranking' : 'eligible';
  return { accepted: reason === 'eligible', reason, probability: answer.choiceProbability, runnerUp, margin, minProbability, minMargin };
}

export class CombatDecisionLoop {
  private readonly runId = randomUUID();
  private stopped = false;
  private readonly lifetime = new AbortController();
  private readonly observations = new Set<ReturnType<typeof setTimeout>>();
  stop(): void { this.stopped=true; this.lifetime.abort(); for(const timer of this.observations) clearTimeout(timer); this.observations.clear(); }
  private inFlight = false;
  private lastCheckedAtMs = -Infinity;
  private lastEligible = false;
  private serial = 0;
  private readonly decisions: Array<Record<string, unknown>> = [];
  constructor(private readonly options: CombatDecisionOptions) {}

  inspect(id?: number): unknown {
    if (id !== undefined) return structuredClone(this.decisions.find(d => d.id === id) ?? null);
    return this.decisions.map(({ frame: _frame, ...entry }) => structuredClone(entry));
  }

  /** Called from the game clock. Neither this method nor the attack executor awaits inference. */
  tick(): boolean {
    if (this.stopped) return false;
    const cfg = { ...this.options.config() };
    const now = this.options.now?.() ?? Date.now();
    if (!cfg.enabled || (!usesHostDecision(cfg) && !cfg.endpoint)) return false;
    if (this.inFlight) return true;
    if (now - this.lastCheckedAtMs < cfg.minIntervalMs) return this.lastEligible;
    this.lastCheckedAtMs = now;
    const frame = this.options.sample();
    this.lastEligible = !!frame && !frame.battlefield.action.emergency && (frame.candidates.length > 0 || !!frame.program);
    if (!frame || !this.lastEligible) return false;
    this.inFlight = true;
    void this.choose(frame, cfg, now).finally(() => { this.inFlight = false; });
    return true;
  }

  private async choose(frame: CombatDecisionFrame, cfg: CombatDecisionConfig, startedAtMs: number): Promise<void> {
    const now = () => this.options.now?.() ?? Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = ++this.serial;
    const entry: Record<string, unknown> = { id, startedAtMs, tacticRevision: frame.tacticRevision };
    this.decisions.push(entry);
    if (this.decisions.length > 8) this.decisions.shift();
    try {
      if (frame.program && this.options.prepare) frame = await this.options.prepare(frame);
    } catch (error) {
      entry.outcome = 'program-error'; entry.reason = String(error);
      if (this.stopped) return;
      this.options.report('error', { ...entry });
      if (cfg.mode === 'act') this.options.fallback?.();
      return;
    }
    if (this.stopped) return;
    if (!frame.candidates.length) { entry.outcome = 'program-idle'; return; }
    const bindings=combatChoiceBindings(frame,cfg.selectionMode==='compatible');
    const compact = combatRequest(frame, {compatible:cfg.selectionMode==='compatible'});
    const criteria = compact.questions.tactic.criteria;
    const { program: _program, actionPool: _pool, ...publicFrame } = frame;
    const body = JSON.stringify({ ...(cfg.model ? { model: cfg.model } : {}), ...compact });
    const scope = { id, decisionId: `${this.runId}:${id}`, startedAtMs, connectionGeneration: frame.battlefield.connectionGeneration,
      sampledAtMs: frame.battlefield.sampledAtMs, tacticRevision: frame.tacticRevision,
      program: frame.policy ? { name: frame.policy.name, sourceHash: frame.policy.sourceHash } : null };
    Object.assign(entry, scope, { frame: publicFrame });
    this.options.report('requested', { ...scope, mode: cfg.mode, frame: publicFrame,
      inputFormat: 'combat-compact-v3',choiceBindings:bindings,request:compact,requestBytes: Buffer.byteLength(body) });
    let dispatchAttempted = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, cfg.timeoutMs);
      });
      const payload = await Promise.race([(async () => {
        if (usesHostDecision(cfg)) {
          if (!this.options.request) throw new Error('host-decision-unavailable');
          const { state, questions } = JSON.parse(body);
          return this.options.request({ state, questions }, { provider: cfg.decisionProvider?.trim() || undefined,
            signal: AbortSignal.any([controller.signal, this.lifetime.signal]), timeoutMs: cfg.timeoutMs });
        }
        const secret = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
        if (cfg.apiKeyEnv && !secret) throw new Error('credential-unavailable');
        const response = await (this.options.fetchImpl ?? fetch)(cfg.endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
          body, signal: AbortSignal.any([controller.signal,this.lifetime.signal]),
        });
        if (!response.ok) throw new Error(`http-${response.status}`);
        return await response.json() as { answers?: Record<string,unknown>; latency_ms?: unknown; usage?: unknown };
      })(), timeout]);
      if (this.stopped) return;
      const answer = parseTypedChoice(payload.answers?.tactic, Object.keys(criteria));
      if (!answer) throw new Error('invalid-response');
      let current = this.options.refresh ? await this.options.refresh() : this.options.sample();
      if (current?.program && this.options.prepare) current = await this.options.prepare(current);
      if (this.stopped) return;
      const liveCfg = this.options.config();
      const ranking = assessCombatChoice(answer, cfg, liveCfg);
      const elapsedMs = now() - startedAtMs;
      const indices=bindings[answer.choice]??[];
      const selected = indices.length?frame.candidates[indices[0]!]:null;
      const executable = selected && current?.candidates.find(c => c.id === selected.id && c.kind === selected.kind
        && (selected.kind !== 'cast' || (c.kind === 'cast' && c.spell === selected.spell && c.ruleId === selected.ruleId))
        && (selected.kind !== 'engage' || (c.kind === 'engage' && c.targetId === selected.targetId && c.uuid === selected.uuid))
        && (selected.kind !== 'track' || (c.kind === 'track' && c.targetId === selected.targetId && c.uuid === selected.uuid))
        && (selected.kind !== 'method' || c.kind === 'method' && c.procedure.handle === selected.procedure.handle
          && c.procedure.revision === selected.procedure.revision && JSON.stringify(c.params) === JSON.stringify(selected.params)
          && c.durationMs === selected.durationMs));
      const scene = current ? assessCombatDecisionScene(frame, current, selected ?? null) : { changed: ['unavailable'], tolerated: [] };
      const changed = scene.changed;
      let outcome: string;
      if (!liveCfg.enabled || liveCfg.mode !== cfg.mode || liveCfg.endpoint !== cfg.endpoint
        || liveCfg.connection !== cfg.connection || liveCfg.decisionProvider !== cfg.decisionProvider
        || liveCfg.model !== cfg.model || liveCfg.apiKeyEnv !== cfg.apiKeyEnv || liveCfg.selectionMode !== cfg.selectionMode) outcome = 'configuration-changed';
      else if (elapsedMs > Math.min(cfg.maxAgeMs, liveCfg.maxAgeMs)) outcome = 'expired';
      else if (!current || changed.length) outcome = 'scene-changed';
      else if ((!selected || selected.kind === 'step' || selected.kind === 'cast')
        && Math.hypot(...current.battlefield.self.position.map((v, i) => v - frame.battlefield.self.position[i])) > 1.5) outcome = 'moved';
      else if (!ranking.accepted) outcome = 'uncertain';
      else if (!selected) outcome = 'keep';
      else if (!executable) outcome = 'no-longer-executable';
      else if (cfg.mode === 'shadow') outcome = 'shadow';
      // Movement prose includes measured distance; apply the freshly checked candidate.
      else { dispatchAttempted = true; outcome = await this.options.apply(executable, current, scope) ? 'sent' : 'rejected'; }
      if (this.stopped) return;
      if (outcome === 'uncertain' && cfg.mode === 'act') this.options.fallback?.();
      const selections: Array<Record<string,unknown>> = [{question:'tactic',component:selected?.kind==='cast'?'ability':'body',choice:answer.choice,candidate:selected??null,
        confidence:answer.confidence,probabilities:answer.probabilities,ranking,outcome,application:{attempted:dispatchAttempted,dispatched:outcome==='sent',keptCurrent:outcome==='keep'}}];
      let abilityCandidate:CombatCandidate|null=null;
      if(indices.length>1){
        const candidate=frame.candidates[indices[1]!];
        let extraOutcome='incompatible-body-choice',attempted=false,extraRanking=ranking;
        try {
            if(!['sent','shadow'].includes(outcome)||executable?.kind!=='step')extraOutcome='incompatible-body-choice';
            else if(candidate?.kind!=='cast')extraOutcome='invalid-ability';
            else {
              const fresh=this.options.refresh?await this.options.refresh():this.options.sample(),live=this.options.config();
              const eligible=fresh?.candidates.find(c=>c.kind==='cast'&&c.id===candidate.id&&c.spell===candidate.spell&&c.ruleId===candidate.ruleId);
              if(this.stopped)return;
              extraRanking=assessCombatChoice(answer,cfg,live);
              if(!live.enabled||live.mode!==cfg.mode||live.endpoint!==cfg.endpoint||live.connection!==cfg.connection
                ||live.decisionProvider!==cfg.decisionProvider||live.model!==cfg.model||live.apiKeyEnv!==cfg.apiKeyEnv||live.selectionMode!==cfg.selectionMode)extraOutcome='configuration-changed';
              else if(now()-startedAtMs>Math.min(cfg.maxAgeMs,live.maxAgeMs))extraOutcome='expired';
              else if(!extraRanking.accepted)extraOutcome='uncertain';
              else if(!fresh||!fresh.battlefield.action.fighting||assessCombatDecisionScene(frame,fresh,candidate).changed.length)extraOutcome='scene-changed';
              else if(Math.hypot(...fresh.battlefield.self.position.map((v,i)=>v-frame.battlefield.self.position[i]))>1.5)extraOutcome='moved';
              else if(!eligible)extraOutcome='no-longer-executable';
              else if(cfg.mode==='shadow')extraOutcome='shadow';
              else {attempted=true;extraOutcome=await this.options.apply(eligible,fresh,{id,decisionId:scope.decisionId+':ability'})?'sent':'rejected';if(extraOutcome==='sent')abilityCandidate=eligible;}
            }
        }catch{extraOutcome=attempted?'dispatch-unknown':'error';}
        selections.push({question:'tactic',component:'ability',choice:answer.choice,confidence:answer.confidence,ranking:extraRanking,
          candidate:frame.candidates[indices[1]!]??null,outcome:extraOutcome,
          application:{attempted,dispatched:extraOutcome==='dispatch-unknown'?null:extraOutcome==='sent',keptCurrent:extraOutcome==='keep'}});
      }
      if(this.stopped)return;
      const primaryOutcome=outcome;
      if(abilityCandidate)outcome='sent';
      const uncertainDispatch=selections.some(s=>(s.application as {dispatched:boolean|null}).dispatched===null);
      if(uncertainDispatch&&outcome!=='sent')outcome='dispatch-unknown';
      const dispatched=[...(primaryOutcome==='sent'&&executable?[executable]:[]),...(abilityCandidate?[abilityCandidate]:[])];
      const effective=primaryOutcome==='sent'?executable:abilityCandidate;
      const lead=selections.find(s=>(s.application as {dispatched:boolean|null}).dispatched===true)??selections[0]!;
      const leadRanking=lead.ranking as typeof ranking;
      const result = { ...scope, elapsedMs:now()-startedAtMs, choice:lead.choice,
        probability:leadRanking.probability,confidence:lead.confidence,probabilities:lead.probabilities,margin:leadRanking.margin,outcome,
        sceneChanges: changed,
        modelMs: payload.latency_ms ?? null, usage: payload.usage ?? null,
        validation: { ranking:leadRanking, toleratedSceneChanges: scene.tolerated, selectedExecutable: !!executable||!!abilityCandidate },
        ...(cfg.selectionMode==='compatible'?{selectionMode:'compatible',selections}:{}),
        application: { attempted: dispatchAttempted||selections.some(s=>(s.application as {attempted:boolean}).attempted),
          dispatched: outcome==='sent'?true:uncertainDispatch?null:false, keptCurrent: outcome === 'keep', reason: outcome === 'moved' ? 'origin-moved' : outcome },
        candidate: (outcome === 'sent' ? effective : selected) ?? null, candidates:dispatched };
      Object.assign(entry, result);
      this.options.report('result', result);
      if (outcome === 'sent') {
        const before = current!.battlefield;
        const targetId = effective?.kind === 'engage' || effective?.kind === 'track' ? effective.targetId : before.action.targetEntityId;
        const timer = setTimeout(() => { void (async () => {
          this.observations.delete(timer);
          if(this.stopped)return;
          const after = (this.options.refresh ? await this.options.refresh() : this.options.sample())?.battlefield;
          if (this.stopped) return;
          const observation = !after || after.connectionGeneration !== before.connectionGeneration || after.dimension !== before.dimension
            ? { verified: false, reason: 'connection-or-dimension-changed' }
            : { verified: true, sampledAtMs: after.sampledAtMs, positionBefore: before.self.position,
              positionAfter: after.self.position, displacement: Math.hypot(...after.self.position.map((v, i) => v - before.self.position[i])),
              healthBefore: before.self.health.current, healthAfter: after.self.health.current,
              actionBefore: before.action, actionAfter: after.action,
              targetBefore: before.actors.find(a => a.entityId === targetId) ?? null,
              targetAfter: after.actors.find(a => a.entityId === targetId) ?? null };
          entry.observation = observation;
          this.options.report('observation', { ...scope, candidate: effective, candidates:dispatched, observation });
        })().catch(() => {}); }, 1000);
        this.observations.add(timer);
        timer.unref?.();
      }
    } catch (error) {
      if(this.stopped)return;
      const live = this.options.config();
      if (cfg.mode === 'act' && live.enabled && live.mode === cfg.mode && live.endpoint === cfg.endpoint
        && live.connection === cfg.connection && live.decisionProvider === cfg.decisionProvider)
        this.options.fallback?.();
      const failure = { ...scope, outcome: 'error', elapsedMs: now() - startedAtMs,
        application: { attempted: dispatchAttempted, dispatched: dispatchAttempted ? null : false, keptCurrent: false },
        reason: controller.signal.aborted ? 'timeout' : error instanceof Error ? error.message : 'transport' };
      Object.assign(entry, failure); this.options.report('error', failure);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

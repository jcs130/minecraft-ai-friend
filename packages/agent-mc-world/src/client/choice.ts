import { createHash, randomUUID } from 'node:crypto';
import type { ToolDef, WorldHost, WorldRequestFacts } from './contracts.ts';
import { parseTypedChoice } from '../../core/support/typed-decision.ts';

const CATEGORIES = ['route', 'survival', 'skill', 'method', 'goal'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
type Candidate = { id: string; label: string; evidence: string; ready: boolean };
const guidance = {
  route: '比较现场已测路线的进展、支撑净空、距离、挖放成本与风险；未知路段须先观察。旅途新发现可比较继续赶路与短暂探索，保留原目的地；新奇本身不意味着必须停下。',
  survival: '比较进食、避险、恢复与继续工作；正在有效执行的任务无需重复接管。',
  skill: '只比较已核实资格、魔力、冷却和目标的技能；未知冷却不是零。',
  method: '按条件与反例选择已校验方法版本；程序结束不等于目标完成。',
  goal: '尊重用户最新意向与当前未完目标，挑一段有可验收里程碑的生活目标；勿反复准备或为多样性强行换目标。',
};
const focus = {
  route: ['journey', 'terrain', 'structure', 'flight', 'life', 'options'], survival: ['foodReserve', 'life', 'gear', 'equip', 'options'],
  skill: ['combat', 'flight', 'life', 'equip', 'options'], method: ['lastTask', 'gear', 'structure', 'goals', 'options'],
  goal: ['goals', 'lastTask', 'foodReserve', 'gear', 'explored'],
};
const timing = {
  survival: { wait: 800, age: 1200 }, route: { wait: 1500, age: 2500 },
  skill: { wait: 1500, age: 2500 }, method: { wait: 2000, age: 10000 }, goal: { wait: 3000, age: 30000 },
};

// Advice may survive a short ordinary walking step, never an unbounded scene change.
// These distances are expiry tolerances, not a path safety check or a body lease.
const ROUTE_VERTICAL_DRIFT = 1.25;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function routeObservation(f: WorldRequestFacts) {
  const sample = f.decisionStability, route = sample?.route, state = f.decision?.state;
  const position = sample?.position;
  if (!sample || !route || !state || !f.parts?.length || !position || !position.every(Number.isFinite)
    || !Number.isFinite(sample.sampledAtMs) || !Number.isFinite(route.generation) || !Number.isFinite(route.positionEpoch)
    || !Number.isFinite(route.speedBlocksPerSec) || route.speedBlocksPerSec < 0
    || !route.policy || ![route.policy.choiceMinBlocks,route.policy.choiceMaxBlocks,route.policy.dangerChoiceMaxBlocks]
      .every(value=>Number.isFinite(value)&&value>=1&&value<=64)
    || route.policy.choiceMinBlocks>route.policy.choiceMaxBlocks || !Array.isArray(route.risks)
    || !Number.isFinite(sample.health) || !Number.isFinite(sample.food) || (sample.health ?? 0) <= 0
    || !['body', 'place', 'clock'].every(key => Object.hasOwn(sample.guards, key))
    || !object(state.connection) || state.connection.ready !== true
    || !object(state.danger) || !object(state.constraints)
    || !route.task || route.task.skill !== 'goto' || !route.task.resumable
    || ![route.task.id, route.task.stepIndex, route.task.stepCount].every(Number.isFinite)
    || !Array.isArray(route.task.destination) || ![2, 3].includes(route.task.destination.length)
    || !route.task.destination.every(Number.isFinite) || route.task.dimension !== sample.dimension
    || !Array.isArray(route.waiting) || route.waiting.some(task => !Number.isFinite(task.id) || typeof task.label !== 'string')
    || typeof route.fighting !== 'boolean' || typeof route.windowOpen !== 'boolean' || typeof route.cursorOccupied !== 'boolean'
    || route.hold !== null || route.fighting || route.environment !== null
    || route.goalOwner !== 'task' || route.windowOpen || route.cursorOccupied
    || route.footing?.kind !== 'support' || route.footing.grounded !== true) return null;
  if (!Array.isArray(route.entities)||route.entities.some(entity=>!Number.isFinite(entity.id)
    ||typeof entity.visible!=='boolean'||!Array.isArray(entity.position)||entity.position.length!==3||!entity.position.every(Number.isFinite))) return null;
  if (!Array.isArray(route.journeyCues) || route.journeyId !== null && (!route.journeyCues.length
    || route.journeyCues.some(cue=>!Number.isFinite(cue.observedAtMs)||sample.sampledAtMs<cue.observedAtMs
      || sample.sampledAtMs-cue.observedAtMs>10_000 || !Array.isArray(cue.position) || cue.position.length!==3
      || !cue.position.every(Number.isFinite)||Math.hypot(...cue.position.map((value:number,index:number)=>value-position[index]!))>32))) return null;
  // Only producer-backed position/clock/queue timing and the online-only roster are excluded.
  // All other full source facts (including terrain, entities, goals, receipts and capability changes) expire advice.
  const parts = f.parts.filter(part => !['sample', 'realclock', 'place', 'clock', 'queue', 'taskProgress', 'players', 'life'].includes(part.key))
    .map(part => {
      if (part.key !== 'recoveryState') return part;
      try {
        const value: unknown = JSON.parse(part.text);
        if (!object(value)) return part;
        const { sampledAt: _time, position: _position, ...rest } = value;
        return { key: part.key, text: JSON.stringify(rest) };
      } catch { return part; }
    });
  const {speedBlocksPerSec,...identity}=route;
  // Relative entity ranges change when we walk; their full visible absolute identities/states remain in route.entities.
  const {nearestHostile:_distance,...danger}=state.danger;
  return { sampledAtMs: sample.sampledAtMs, position: [...position], speedBlocksPerSec, policy:route.policy, risk:route.risks.length>0,
    revision: hash([identity, sample.identity, sample.dimension, sample.health, sample.food, sample.guards,
      state.connection, danger, state.constraints, parts]) };
}
type RouteObservation = ReturnType<typeof routeObservation>;
function routeTolerance(before:NonNullable<RouteObservation>,after:NonNullable<RouteObservation>,elapsedMs:number):number {
  const normal=Math.min(before.policy.choiceMaxBlocks,before.policy.choiceMinBlocks
    +Math.max(before.speedBlocksPerSec,after.speedBlocksPerSec)*Math.max(0,elapsedMs)/1000);
  return before.risk||after.risk?Math.min(normal,before.policy.dangerChoiceMaxBlocks):normal;
}
function stableRoute(before: RouteObservation, after: RouteObservation, now: number, maxAgeMs: number, elapsedMs:number): boolean {
  return !!before && !!after && before.revision === after.revision
    && [before, after].every(sample => now >= sample.sampledAtMs && now - sample.sampledAtMs <= maxAgeMs)
    && Math.hypot(before.position[0]! - after.position[0]!, before.position[2]! - after.position[2]!) <= routeTolerance(before,after,elapsedMs)
    && Math.abs(before.position[1]! - after.position[1]!) <= ROUTE_VERTICAL_DRIFT;
}

/** One explicit request, short evidence, no timer, body action or persistent goal ownership. */
export function createMinecraftChoiceTool(host: () => WorldHost | null,
  facts: () => WorldRequestFacts | null, provider?: () => string | undefined): ToolDef {
  let busy = false;
  let last: { key: string; owner: WorldHost; until: number; result: string; route:RouteObservation; startedAt:number } | null = null;
  const sample = (category: typeof CATEGORIES[number]) => {
    const f = facts();
    if (!f) return null;
    const parts = f.parts?.filter(p => !['sample', 'realclock'].includes(p.key));
    const selected = ['place', 'body', 'queue', ...focus[category]]
      .flatMap(key => parts?.find(p => p.key === key) ?? []).filter(p => p.text);
    let budget = 2400;
    const source = (selected.length ? selected : [{ key: 'current', text: f.text }]).flatMap(p => {
      if (budget <= 0) return [];
      const text = p.text.slice(0, Math.min(600, budget)); budget -= text.length;
      return [{ key: p.key, text, truncated: text.length < p.text.length }];
    });
    // Even when a new producer cannot relax a route (e.g. an old cue or open window),
    // its unrendered generation/body/entity changes must still expire advice and caches.
    const {sampledAtMs:_sampleTime,...typed}=f.decisionStability??{};
    const revision=category==='route'&&f.decisionStability?.route
      ?hash([parts?.length?parts:f.text,typed,f.decision?.state])
      :hash(parts?.length?parts:f.text);
    return { revision,
      sample: f.parts?.find(p => p.key === 'sample')?.text ?? null, facts: source,
      route: category === 'route' ? routeObservation(f) : null };
  };
  return {
    name: 'mc_choose', tags: ['read'], interruptible: true,
    description: '按需用宿主快模型在路线、生存、技能、方法或长期目标候选中选择。传2–12个简短候选及实测依据、ready；未知条件填false。返回建议与置信度，不行动、不改目标；执行前再验条件。无宿主服务则交还主Agent。',
    parameters: { type: 'object', required: ['category', 'goal', 'candidates'], additionalProperties: false, properties: {
      category: { type: 'string', enum: CATEGORIES }, goal: { type: 'string', maxLength: 240 },
      candidates: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'object', additionalProperties: false,
        required: ['id', 'label', 'evidence', 'ready'], properties: { id: { type: 'string', maxLength: 40 },
          label: { type: 'string', maxLength: 120 }, evidence: { type: 'string', maxLength: 400 }, ready: { type: 'boolean' } } } },
    } },
    handler: async (args, ctx) => {
      const category = args.category as typeof CATEGORIES[number];
      if (!CATEGORIES.includes(category) || !text(args.goal, 240) || !Array.isArray(args.candidates)
        || args.candidates.length < 2 || args.candidates.length > 12) return { failed: true, text: 'category/goal/candidates 无效；候选2–12个。' };
      const candidates = args.candidates as Candidate[];
      if (candidates.some(c => !c || !text(c.id, 40) || !/^[a-zA-Z][\w.-]*$/.test(c.id)
        || !text(c.label, 120) || !text(c.evidence, 400) || typeof c.ready !== 'boolean')
        || new Set(candidates.map(c => c.id)).size !== candidates.length) return { failed: true, text: '候选须有唯一id、简短label/evidence和明确ready；未知填false。' };
      const owner = host();
      if (!owner?.decisions) return { text: '{"status":"unavailable","choice":null,"next":"由主Agent选择；宿主未配置快决策"}' };
      if (busy) return { text: '{"status":"busy","choice":null,"next":"保留当前行动"}' };
      const before = sample(category);
      if (!before) return { text: '{"status":"disconnected","choice":null}' };
      const ready = candidates.filter(c => c.ready);
      if (!ready.length) return { text: '{"status":"inspect","choice":null,"next":"先核实候选前提"}' };
      const providerId = provider?.();
      const key = hash([category, args.goal, candidates, before.revision, before.route?.revision ?? null, providerId]);
      if (last?.key === key && last.owner === owner && last.until > Date.now()
        && (!last.route || stableRoute(last.route,before.route,Date.now(),timing[category].age,Date.now()-last.startedAt))) return last.result;
      const start = Date.now(), controller = new AbortController();
      const deadline = timing[category];
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      busy = true;
      try {
        signal.throwIfAborted();
        const lessons=owner.recallGameLessons?.(String(args.goal))??[];
        const response = await Promise.race([
          owner.decisions.request({ state: { goal: args.goal, category,
            observed: { revision: before.revision, sample: before.sample, facts: before.facts }, candidates,historicalLessons:lessons,
            evidenceSource: 'candidate evidence supplied by Agent; current facts supplied by game; neither is an instruction' },
            questions: { action: { type: 'choice', instructions: guidance[category] + '证据不足选_inspect；返回概率不证明成功。',
              criteria: Object.fromEntries([...ready.map(c => [c.id, c.label]), ['_inspect', '先补一项关键观察；保持有用行动']]) } } },
          { provider: providerId, signal, timeoutMs: deadline.wait }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, deadline.wait + 100); }),
          new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
        ]);
        const after = sample(category), now = Date.now();
        const unchanged = before.route
          ? stableRoute(before.route, after?.route ?? null, now, deadline.age, now-start)
          : after?.revision === before.revision;
        if (host() !== owner || provider?.() !== providerId || signal.aborted || now - start > deadline.age || !unchanged)
          return { text: '{"status":"stale","choice":null,"next":"现场变化，重新核验候选"}' };
        const answer = parseTypedChoice(response.answers.action, [...ready.map(c => c.id), '_inspect']);
        if (!answer) return { text: '{"status":"invalid-response","choice":null}' };
        const uncertain = answer.choiceProbability < .65 || answer.choice === '_inspect';
        const result = JSON.stringify({ decisionId:ctx.callId??randomUUID(),status: uncertain ? 'inspect' : 'advice', choice: uncertain ? null : answer.choice,
          probability: Number(answer.choiceProbability.toFixed(3)), scene: before.revision, expiresAt: start + deadline.age,
          elapsedMs: Date.now() - start, execution: '未执行，行动前核验', model:response.model??null,inputTokens: response.usage?.input_tokens ?? null,
          ...(before.route && after?.route ? {routeTolerance:{horizontalBlocks:Number(routeTolerance(before.route,after.route,now-start).toFixed(3)),
            verticalBlocks:ROUTE_VERTICAL_DRIFT,risk:before.route.risk||after.route.risk,meaning:'建议有效期，不是通行许可'}}:{}),
          recalledMemoryRefs:lessons.map(l=>l.reference) });
        last = { key, owner, until: Math.min(start + deadline.age, Date.now() + 2000), result, route:before.route, startedAt:start };
        return result;
      } catch { return { text: JSON.stringify({ status: ctx.signal?.aborted ? 'cancelled' : 'unavailable', choice: null, next: '保留当前行动，由主Agent处理' }) }; }
      finally { clearTimeout(timer); controller.abort(); busy = false; }
    },
  };
}

/** Passive evidence for the host's next decision. Never refuses, retries or cancels work. */
import { createHash } from 'node:crypto';

type Row = Record<string, any>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const effect = (p: Row) => object(p.observedEffect) && p.observedEffect.schema === 'agent-mc-observed-effect/v1' ? p.observedEffect : null;
const status = (p: Row) => effect(p)?.status ?? (typeof p.observedEffect === 'string' ? p.observedEffect : 'unknown');
const inventoryChanges = (e: Row): Array<{ item: string; before: number; after: number }> | null => {
  const before=e.before?.inventory,after=e.after?.inventory;
  if(!object(before)||!object(after))return null;
  const valid=(v:Row)=>Object.entries(v).every(([k,n])=>/^[a-z0-9_:]{1,120}$/.test(k)&&Number.isSafeInteger(n)&&n>=0);
  if(!valid(before)||!valid(after))return null;
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort()
    .filter(k=>(before[k]??0)!==(after[k]??0)).map(item=>({item,before:before[item]??0,after:after[item]??0}));
};
const effectPreview = (p: Row) => {
  const e=effect(p);if(!e)return null;const target=e.before?.target;
  return{status:status(p),at:Array.isArray(e.at)&&e.at.length===3&&e.at.every(Number.isFinite)?e.at:null,
    target:object(target)?{name:typeof target.name==='string'?target.name.slice(0,120):null,stateId:Number.isSafeInteger(target.stateId)?target.stateId:null}:null,
    changed:object(e.changed)?Object.fromEntries(['target','inventory','position','window'].filter(k=>typeof e.changed[k]==='boolean').map(k=>[k,e.changed[k]])):null,
    coverage:typeof e.coverage==='string'?e.coverage.slice(0,80):null,goalVerified:false};
};
export interface FailedPlanEpisode {
  key: string; run: string; planHash: string; firstExecutionId: string; latestExecutionId: string;
  localId: number | null; count: number; active: boolean; stepKinds: string[];
  toolPrefix: string;
  firstAt: number; lastAt: number; dimension: string | null;
  observation: 'changed' | 'unchanged' | 'unknown';
}
export interface RecentPlanEffect {
  run: string; executionId: string; step: number; at: number; dimension: string | null; skill: string;
  submission: 'matched-tool-call' | 'unattributed'; outcome: string | null;
  inventoryChanges: Array<{ item: string; before: number; after: number }>;
  changesTruncated: boolean; historical: true; goalVerified: false;
}
interface Submission { run: string; planHash: string; localId: number | null; stepKinds: string[]; toolPrefix: string }

/** One instance per owning Agent. Only hashes/identities are in snapshot(); native quotes stay in RAM. */
export class PlanReviewBook {
  private readonly submitted = new Map<string, Submission>();
  private readonly seen = new Set<string>();
  private readonly episodes = new Map<string, FailedPlanEpisode>();
  private readonly latest = new Map<string, { hash: string; id: string }>();
  private readonly quotes = new Map<string, Row[]>();
  private readonly effects = new Map<string, RecentPlanEffect>();
  constructor(private readonly options: { now?: () => number; windowMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private fresh(e: FailedPlanEpisode) { return this.now() - e.lastAt <= (this.options.windowMs ?? 900000); }
  recordCall(input: { run: string; name: string; args: unknown; result: unknown }): void {
    const { run, name, args } = input;
    const result = object(input.result) ? input.result : {}, value = result.structuredContent ?? result;
    const x = value.execution;
    if (!run || !/_(do|scout)$/.test(name) || !object(args) || !Array.isArray(args.steps)
      || !args.steps.length || args.steps.length > 64 || !object(x) || x.kind !== 'task' || typeof x.id !== 'string') return;
    this.submitted.set(x.id, { run, planHash: digest(args.steps), localId: Number.isSafeInteger(x.evidence?.localId) ? x.evidence.localId : null,
      stepKinds: args.steps.map((s: any) => typeof s?.skill === 'string' ? s.skill : 'unknown'), toolPrefix: name.replace(/_(do|scout)$/, '') });
    for(const e of this.effects.values())if(e.run===run&&e.executionId===x.id)e.submission='matched-tool-call';
    this.latest.set(run, {hash:digest(args.steps),id:x.id});while(this.latest.size>8)this.latest.delete(this.latest.keys().next().value!);
    while (this.submitted.size > 128) this.submitted.delete(this.submitted.keys().next().value!);
  }
  recordEvents(events: readonly unknown[]): void {
    for (const raw of events) {
      if (!object(raw)) continue;
      const x = raw.execution;
      if (!object(x) || x.kind !== 'task' || x.terminal !== true || typeof x.id !== 'string') continue;
      // Body-owned work may finish while the model is generating. Keep native
      // measured changes even without a matching tool call; never invent its source.
      const at=Date.parse(raw.ts),nativeSteps:Row[]=Array.isArray(x.evidence?.steps)?x.evidence.steps.filter(object):[];
      if(typeof raw.run==='string'&&raw.run.length<=160&&x.id.length<=240&&Number.isFinite(at))for(const p of nativeSteps){
        const e=effect(p),changes=e?inventoryChanges(e):null;
        if(!e||!changes?.length||!Number.isSafeInteger(p.step)||p.step<1||p.step>64
          ||typeof e.skill!=='string'||!/^[a-z_]{1,40}$/.test(e.skill)||['chat','tell'].includes(e.skill))continue;
        const key=`${raw.run}:${x.id}:${p.step}`,old=this.effects.get(key);
        this.effects.set(key,{run:raw.run,executionId:x.id,step:p.step,at,dimension:typeof e.dimension==='string'?e.dimension.slice(0,160):null,skill:e.skill,
          submission:old?.submission==='matched-tool-call'||this.submitted.get(x.id)?.run===raw.run?'matched-tool-call':'unattributed',
          outcome:typeof p.outcome==='string'&&/^[a-z-]{1,40}$/.test(p.outcome)?p.outcome:null,
          inventoryChanges:changes.slice(0,8),changesTruncated:changes.length>8,historical:true,goalVerified:false});
        const chronological=[...this.effects.entries()].sort((a,b)=>a[1].at-b[1].at||a[0].localeCompare(b[0])).slice(-8);
        this.effects.clear();for(const [id,value]of chronological)this.effects.set(id,value);
      }
      const s = this.submitted.get(x.id);
      if (!s || raw.run !== s.run || this.seen.has(x.id)) continue;
      this.seen.add(x.id); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
      const steps: Row[] = Array.isArray(x.evidence?.steps) ? x.evidence.steps.filter(object) : [];
      if (['cancelled', 'superseded'].includes(x.phase)) continue;
      const failed = steps.filter(p => ['fail', 'partial'].includes(p.outcome));
      const negative = ['blocked', 'partial'].includes(x.phase) || failed.length > 0;
      const dimension = steps.map(p => effect(p)?.dimension).find(d => typeof d === 'string') ?? null;
      const slot = `${s.run}:${dimension ?? '?'}:${s.planHash}`;
      if (failed.some(p => status(p) === 'changed')) { const old = this.episodes.get(slot); if (old) {old.active = false;this.quotes.delete(old.key);} continue; }
      if (!negative) {
        if (x.phase === 'completed' && steps.length && steps.every(p => ['ok', 'noop'].includes(p.outcome))) {
          const old = this.episodes.get(slot); if (old) {old.active = false;this.quotes.delete(old.key);}
        }
        continue; // Unknown/empty success is not an observed improvement.
      }
      const old = this.episodes.get(slot), continuing = old?.active === true && this.fresh(old);
      if(old&&!continuing)this.quotes.delete(old.key);
      const entry: FailedPlanEpisode = { key: continuing ? old.key : `${slot}:${x.id}`, run: s.run, planHash: s.planHash,
        firstExecutionId: continuing ? old.firstExecutionId : x.id, latestExecutionId: x.id,
        localId: s.localId, count: continuing ? old.count + 1 : 1, active: true, stepKinds: s.stepKinds, toolPrefix: s.toolPrefix,
        firstAt: continuing ? old.firstAt : Date.parse(raw.ts) || this.now(), lastAt: Date.parse(raw.ts) || this.now(), dimension,
        observation: ['changed', 'unchanged'].includes(raw.meta?.repeatFailure?.observation) ? raw.meta.repeatFailure.observation
          : failed.length && failed.every(p => status(p) === 'unchanged') ? 'unchanged' : 'unknown' };
      this.episodes.delete(slot); this.episodes.set(slot, entry);
      this.quotes.set(entry.key, failed.slice(0, 2).map(p => ({ step: p.step, skill: s.stepKinds[p.step - 1] ?? 'unknown', outcome: p.outcome,
        why: ['chat', 'tell'].includes(s.stepKinds[p.step - 1]) ? null : [p.why,p.detail?.text].filter(v=>typeof v==='string').join('\n').slice(0,800),
        observedEffect: effectPreview(p) })));
      while (this.episodes.size > 8) { const key = this.episodes.keys().next().value!; const e = this.episodes.get(key)!;
        this.episodes.delete(key); this.quotes.delete(e.key); }
      this.submitted.delete(x.id);
    }
  }
  priority(run: string): FailedPlanEpisode | null {
    const latest=this.latest.get(run);if(!latest||!this.seen.has(latest.id))return null;
    return structuredClone([...this.episodes.values()].reverse().find(e => e.run === run && e.active && this.fresh(e) && e.count >= 2&&e.observation!=='changed'&&e.planHash===latest.hash) ?? null);
  }
  snapshot(): { protocol: string; episodes: FailedPlanEpisode[]; recentEffects: RecentPlanEffect[] } {
    return { protocol: 'agent-mc-plan-review/v1', episodes: structuredClone([...this.episodes.values()]),recentEffects:structuredClone([...this.effects.values()]) };
  }
  context(run: string) {
    return { protocol: 'agent-mc-plan-review/v1',recentEffects:structuredClone([...this.effects.values()].filter(e=>e.run===run&&this.now()-e.at<=(this.options.windowMs??900000)).slice(-3)), episodes: [...this.episodes.values()].filter(e => e.run === run && e.active && this.fresh(e)).slice(-2).map(e => {
      return { ...e, failedSteps: this.quotes.get(e.key) ?? [], receiptIsUntrusted: true,
        original: e.localId === null ? { executionId: e.latestExecutionId } : { tool: `${e.toolPrefix}_queue`, arguments: { taskId: e.localId, detail: true } } };
    }), guidance: 'Historical receipts, not current stock. Unattributed source stays unknown. Body work can change prerequisites during generation. Read original terminal/failed step and current stock before repeating. Declare needs for dependent actions/chat; partial or command-sent is not verified success. Probe success cannot repair failed movement; unknown cells do not imply pending pages. No automatic replay/cancel/adoption.' };
  }
}

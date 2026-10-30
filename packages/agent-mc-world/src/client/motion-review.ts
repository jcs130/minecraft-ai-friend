/** Bounded, observed motion metadata. A loop can be intentional; it never authorizes intervention. */
import {createHash} from 'node:crypto';
type Point = [number, number, number];
type Sample = { key: string; executionId: string; at: number; before: Point; after: Point };
export interface MotionReview {
  protocol: 'agent-mc-motion-review/v1'; run: string; dimension: string; samples: number;
  firstAt: number; lastAt: number; firstExecutionId: string; latestExecutionId: string;
  travelledDistance: number; netDisplacement: number; boundsDiagonal: number;
  loopObserved: boolean; stationaryObserved: boolean; historical: true; goalVerified: false; guidance: string;
}
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const point = (v: any): v is Point => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 30000000);
const distance = (a: Point, b: Point) => Math.hypot(...a.map((n, i) => n - b[i]));
const round = (n: number) => Math.round(n * 100) / 100;
/** Consume typed measured terminal receipts, never requested coordinates or event counts. */
export class MotionReviewBook {
  private readonly scopes = new Map<string, { run: string; dimension: string; samples: Sample[] }>();
  private readonly seen = new Set<string>();
  constructor(private readonly options: { now?: () => number; windowMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  clear(): void { this.scopes.clear();this.seen.clear(); }
  recordEvents(events: readonly unknown[]): void {
    for (const raw of events) {
      if (!object(raw) || typeof raw.run !== 'string' || !raw.run || raw.run.length > 160) continue;
      const x = raw.execution, at = Date.parse(raw.ts);
      if (!object(x) || x.kind !== 'task' || x.terminal !== true || !['completed', 'blocked', 'partial'].includes(x.phase)
        || typeof x.id !== 'string' || !x.id || x.id.length > 240 || !Number.isFinite(at)
        || at > this.now() + 5000 || this.now() - at > (this.options.windowMs ?? 300000)) continue;
      for (const step of Array.isArray(x.evidence?.steps) ? x.evidence.steps : []) {
        const e = step?.observedEffect;
        if (!object(e) || e.schema !== 'agent-mc-observed-effect/v1' || !['control', 'goto', 'follow', 'walk', 'swim'].includes(e.skill)
          || !Number.isSafeInteger(step.step) || step.step < 1 || step.step > 64
          || typeof e.dimension !== 'string' || !/^[a-z0-9_:./-]{1,160}$/.test(e.dimension)
          || !point(e.before?.position) || !point(e.after?.position)) continue;
        const key = `${raw.run}:${x.id}:${step.step}`, scope = `${raw.run}:${e.dimension}`;
        if (this.seen.has(key)) continue;
        const book = this.scopes.get(scope) ?? { run: raw.run, dimension: e.dimension, samples: [] };
        if (book.samples.length && at < book.samples.at(-1)!.at) continue; // Old pages cannot rewrite the current trace.
        this.seen.add(key);while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
        book.samples = book.samples.filter(s => this.now() - s.at <= (this.options.windowMs ?? 300000));
        // A teleport, unobserved gap or foreign movement cannot close a known trajectory.
        if (book.samples.length && distance(book.samples.at(-1)!.after, e.before.position) > 2) book.samples = [];
        const before: Point = [e.before.position[0], e.before.position[1], e.before.position[2]];
        const after: Point = [e.after.position[0], e.after.position[1], e.after.position[2]];
        book.samples.push({ key, executionId: x.id, at, before, after });
        book.samples = book.samples.slice(-16);this.scopes.delete(scope);this.scopes.set(scope, book);
        while (this.scopes.size > 8) this.scopes.delete(this.scopes.keys().next().value!);
      }
    }
  }
  context(run: string): MotionReview | null {
    const book = [...this.scopes.values()].filter(s => s.run === run && s.samples.length && this.now() - s.samples.at(-1)!.at <= (this.options.windowMs ?? 300000))
      .sort((a, b) => b.samples.at(-1)!.at - a.samples.at(-1)!.at)[0];
    if (!book) return null;
    const samples = book.samples.filter(s => this.now() - s.at <= (this.options.windowMs ?? 300000));
    if (!samples.length) return null;
    const first = samples[0], last = samples.at(-1)!;
    const points = samples.flatMap(s => [s.before, s.after]);
    const low = [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))) as Point;
    const high = [0, 1, 2].map(i => Math.max(...points.map(p => p[i]))) as Point;
    const travelled = samples.reduce((sum, s) => sum + distance(s.before, s.after), 0), net = distance(first.before, last.after), bounds = distance(low, high);
    return { protocol: 'agent-mc-motion-review/v1', run, dimension: book.dimension, samples: samples.length,
      firstAt: first.at, lastAt: last.at, firstExecutionId: first.executionId, latestExecutionId: last.executionId,
      travelledDistance: round(travelled), netDisplacement: round(net), boundsDiagonal: round(bounds),
      loopObserved: samples.length >= 8 && last.at - first.at >= 15000 && travelled >= 32 && net <= 4 && bounds <= 32,
      stationaryObserved: samples.length >= 8 && last.at - first.at >= 15000 && travelled <= 2,
      historical: true, goalVerified: false,
      guidance: 'Measured body movement, not goal progress. A compact closed path may be intentional: check the current objective and original receipts. control.yawDeg is a RELATIVE rotation on each call, not an absolute heading; repeating a nonzero angle repeatedly turns again. If circling was not intended, inspect current heading and tool help before changing the plan. No automatic cancel/retry/adoption.' };
  }
}

export interface MotionAdmission { admitted: boolean; signature: string; submissions: number; review: MotionReview | null }
/** Submission review gate; never cancels existing work or selects a recovery action. */
export class MotionReviewGate {
  readonly book: MotionReviewBook;
  private current: {run:string;signature:string;submissions:number}|null=null;
  private readonly requests=new Map<string,{signature:string;result:MotionAdmission}>();
  constructor(readonly limit=8, options:{now?:()=>number;windowMs?:number}={}){
    if(!Number.isSafeInteger(limit)||limit<0||limit>1000)throw Error('Invalid motion repetition limit');
    this.book=new MotionReviewBook(options);
  }
  admit(name:string,args:Record<string,unknown>,requestId:string,run:string):MotionAdmission|null {
    const steps=args.steps;
    if(!this.limit||!name.endsWith('_do')||!Array.isArray(steps)||!steps.length||steps.length>64)return null;
    if(!steps.every(s=>object(s)&&s.skill==='control')){
      if(steps.some(s=>object(s)&&!['control','chat'].includes(s.skill)))this.current=null;
      return null;
    }
    const stable=(v:any):any=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
    const signature=createHash('sha256').update(JSON.stringify(stable(steps))).digest('hex'),previous=this.requests.get(requestId);
    if(previous){if(previous.signature!==signature)throw Error('Motion request id reused with different arguments');return structuredClone(previous.result);}
    if(this.current?.run!==run||this.current.signature!==signature)this.current={run,signature,submissions:0};
    const review=this.book.context(run),admitted=this.current.submissions<this.limit||!review||!review.loopObserved&&!review.stationaryObserved;
    if(admitted)this.current.submissions++;
    const result:MotionAdmission={admitted,signature,submissions:this.current.submissions,review};
    this.requests.set(requestId,{signature,result});while(this.requests.size>256)this.requests.delete(this.requests.keys().next().value!);
    return structuredClone(result);
  }
  /** Deliberate spatial inspection/tool help, never ordinary event polling. */
  inspected():void{this.current=null;}
  /** A new body generation cannot inherit another generation's trajectory or gate decisions. */
  reset():void{this.current=null;this.requests.clear();this.book.clear();}
}

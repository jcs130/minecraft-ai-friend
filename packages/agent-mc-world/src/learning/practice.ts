/** Measured, explicitly isolated practice. No model, connection or adoption on import. */
import { MethodRunner, METHOD_ADAPTER, type MethodHost, type MethodRun } from '../../core/method-runner.ts';
import { MethodLibrary, type MethodReview } from '../../core/method-library.ts';
import { PROCEDURE_RECEIPT_SCHEMA, procedureHash, resolveProcedure, type ProcedureReference, type ProcedureReceipt } from '../../core/support/procedure.ts';

export interface PracticeBinding { instanceId: string; realm: string; account: string; agent: string; isolated: true }
export interface PracticeCandidate { code: string; params: Record<string, unknown>; guidance: string }
export interface PracticeSnapshot {
  at: number; instanceId: string; snapshotId: string; environmentVersion: string;
  dimension: string | null; position: { x: number; y: number; z: number } | null;
  health: number | null; inventory: Record<string, number> | null;
}
export type PracticeGoal =
  | { kind: 'reach'; dimension: string; position: { x: number; y: number; z: number }; radius: number; maxHealthLoss: number }
  | { kind: 'inventory-gain'; item: string; count: number; maxHealthLoss: number };
export interface PracticeCase { id: string; snapshotId: string; environmentVersion: string; goal: PracticeGoal }
export interface PracticeAssessment {
  achieved: boolean | null; reason: 'measured' | 'missing-observation' | 'stale-observation' | 'binding-mismatch' | 'execution-incomplete';
  measurements: { distance: number | null; gained: number | null; healthLoss: number | null; elapsedMs: number | null };
}
export interface PracticeTrial {
  trialId: string; caseId: string; candidateHash: string; binding: PracticeBinding;
  reference: ProcedureReference | null; executionId: string | null; reviewId: string | null;
  startedAt: number; endedAt: number; completed: boolean; cleanup: 'settled';
  before: PracticeSnapshot | null; after: PracticeSnapshot | null;
}
export interface PracticeExecutionPort {
  readonly binding: PracticeBinding;
  execute(request: { trialId: string; methodId: string; candidate: PracticeCandidate; fixture: PracticeCase; durationMs: number }, signal: AbortSignal): Promise<PracticeTrial>;
}

export class PracticeUnknownEffect extends Error {
  constructor() { super('Practice effect or cleanup is unknown; reconcile the original execution before another trial'); }
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validPosition = (p: PracticeSnapshot['position']): p is NonNullable<typeof p> => !!p && [p.x,p.y,p.z].every(finite);
export function validatePracticeCandidate(value: PracticeCandidate): void {
  if (!value || typeof value.code !== 'string' || !value.code.trim() || value.code.length > 12000
    || typeof value.guidance !== 'string' || value.guidance.length > 4000
    || !value.params || typeof value.params !== 'object' || Array.isArray(value.params)
    || JSON.stringify(value.params).length > 4096) throw Error('Invalid bounded practice candidate');
}
export function validatePracticeCase(value: PracticeCase): void {
  if (!value || ![value.id,value.snapshotId].every(v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(v))
    || typeof value.environmentVersion!=='string' || !/^[A-Za-z0-9_.:/+-]{1,100}$/.test(value.environmentVersion)) throw Error('Invalid practice case identity');
  const g = value.goal;
  if (!g || !finite(g.maxHealthLoss) || g.maxHealthLoss < 0 || g.maxHealthLoss > 20) throw Error('Invalid health bound');
  if (g.kind === 'reach') {
    if (!validPosition(g.position) || !finite(g.radius) || g.radius <= 0 || g.radius > 16 || typeof g.dimension !== 'string' || !g.dimension) throw Error('Invalid reach goal');
  } else if (g.kind !== 'inventory-gain' || !/^[a-z0-9_:]{1,100}$/.test(g.item) || !Number.isInteger(g.count) || g.count < 1) throw Error('Invalid inventory goal');
}

/** Tool completion is not a goal witness. Missing/stale measurements remain unknown. */
export function assessPracticeTrial(trial: PracticeTrial, fixture: PracticeCase, binding: PracticeBinding): PracticeAssessment {
  const measurements: PracticeAssessment['measurements'] = { distance:null,gained:null,healthLoss:null,elapsedMs:null };
  const result = (reason: PracticeAssessment['reason'], achieved: boolean | null = null) => ({ achieved, reason, measurements });
  if (procedureHash(trial.binding) !== procedureHash(binding) || trial.caseId !== fixture.id) return result('binding-mismatch');
  if (!trial.completed || !trial.executionId || !trial.reference || trial.cleanup !== 'settled') return result('execution-incomplete');
  const a = trial.before, b = trial.after;
  if (!a || !b || !finite(a.health) || !finite(b.health)) return result('missing-observation');
  if ([a,b].some(s => s.instanceId !== binding.instanceId || s.snapshotId !== fixture.snapshotId || s.environmentVersion !== fixture.environmentVersion)) return result('binding-mismatch');
  if (![a.at,b.at,trial.startedAt,trial.endedAt].every(finite) || trial.endedAt < trial.startedAt
    || Math.abs(a.at-trial.startedAt) > 5000 || b.at < trial.endedAt-5000 || b.at > trial.endedAt+1000 || b.at < a.at) return result('stale-observation');
  measurements.elapsedMs = trial.endedAt-trial.startedAt;
  measurements.healthLoss = Math.max(0,a.health-b.health);
  const g = fixture.goal;
  if (g.kind === 'reach') {
    if (!validPosition(b.position) || !b.dimension) return result('missing-observation');
    measurements.distance = Math.hypot(b.position.x-g.position.x,b.position.y-g.position.y,b.position.z-g.position.z);
    return result('measured', b.dimension === g.dimension && measurements.distance <= g.radius && measurements.healthLoss <= g.maxHealthLoss);
  }
  const first = a.inventory?.[g.item], last = b.inventory?.[g.item];
  if (!finite(first) || !finite(last)) return result('missing-observation'); // Absence is not a known zero.
  measurements.gained = last-first;
  return result('measured', measurements.gained >= g.count && measurements.healthLoss <= g.maxHealthLoss);
}

export interface MethodPracticeOptions {
  binding: PracticeBinding;
  /** Existing scoped MethodLibrary, never a separate mutable skill notebook. */
  library: MethodLibrary;
  host: Pick<MethodHost, 'call' | 'nativeMethods'>;
  /** Explicit dedicated fixture reset. Must never target the production body. */
  reset(fixture: PracticeCase, signal: AbortSignal): Promise<void>;
  observe(fixture: PracticeCase, signal: AbortSignal): Promise<PracticeSnapshot>;
  /** Confirm the originating executor has released keys/actions, even on cancellation. */
  settle(run: MethodRun): Promise<'settled' | 'unknown'>;
}

/** Core method sandbox + exact version/receipt/review lifecycle, reusable by any host. */
export class MethodPracticeExecutor implements PracticeExecutionPort {
  readonly binding: PracticeBinding;
  private readonly runner: MethodRunner;
  private busy = false;
  private poisoned = false;
  private readonly references = new Map<string, ProcedureReference>();
  constructor(private readonly options: MethodPracticeOptions) {
    this.binding = structuredClone(options.binding);
    if (this.binding.isolated !== true) throw Error('A dedicated isolated practice binding is required');
    this.runner = new MethodRunner({ ...options.host, onFinish: () => {} });
  }
  private async terminal(request: Parameters<MethodRunner['start']>[0], signal: AbortSignal): Promise<MethodRun> {
    signal.throwIfAborted();
    const run = this.runner.start(request);
    const abort = () => this.runner.stop('Isolated practice cancelled');
    signal.addEventListener('abort',abort,{once:true}); if (signal.aborted) abort();
    try {
      while (this.runner.read(run.id)[0]?.status === 'running') await this.runner.wait(run.id,1000);
      return this.runner.read(run.id)[0];
    } finally { signal.removeEventListener('abort',abort); }
  }
  async execute(request: Parameters<PracticeExecutionPort['execute']>[0], signal: AbortSignal): Promise<PracticeTrial> {
    if (this.busy || this.poisoned) throw new PracticeUnknownEffect();
    validatePracticeCandidate(request.candidate); validatePracticeCase(request.fixture);
    signal.throwIfAborted(); this.busy = true;
    let reset = false;
    const { candidate, fixture, trialId, methodId, durationMs } = request;
    const trial: PracticeTrial = { trialId,caseId:fixture.id,candidateHash:procedureHash(candidate),binding:this.binding,
      reference:null,executionId:null,reviewId:null,startedAt:Date.now(),endedAt:Date.now(),completed:false,cleanup:'settled',before:null,after:null };
    try {
      const validation = await this.terminal({ code:candidate.code,validate:true,durationMs },signal);
      if (validation.status !== 'validated') return trial;
      signal.throwIfAborted();
      const key = procedureHash({methodId,code:candidate.code,guidance:candidate.guidance});
      let reference = this.references.get(key);
      if (!reference) {
        const entries = this.options.library.list({query:methodId,limit:20}) as {methods:Array<{id:string;revision:string}>};
        const parent = entries.methods.find(e=>e.id===methodId)?.revision ?? null;
        const saved = this.options.library.save({id:methodId,code:candidate.code,parent,
          description:candidate.guidance.slice(0,800) || 'Harness2 isolated practice candidate',
          conditions:['Isolated practice evidence only; explicit host review before use elsewhere.']},validation,'harness2-practice') as {reference:ProcedureReference};
        reference = saved.reference; this.references.set(key,reference);
      }
      trial.reference = reference;
      const graph = resolveProcedure(reference,METHOD_ADAPTER,handle=>this.options.library.blob(handle));
      reset = true; await this.options.reset(fixture,signal);
      trial.before = await this.options.observe(fixture,signal); trial.startedAt = Date.now();
      const run = await this.terminal({code:candidate.code,params:candidate.params,durationMs,procedure:{reference,graph}},signal);
      if (await this.options.settle(run) !== 'settled') throw new PracticeUnknownEffect();
      trial.endedAt = Date.now();
      // Observe after cleanup, not the method's self-reported return value.
      if (!signal.aborted) trial.after = await this.options.observe(fixture,signal);
      if (!run.procedure || !run.endedAt || run.status === 'running') throw new PracticeUnknownEffect();
      const receipt: ProcedureReceipt = {schema:PROCEDURE_RECEIPT_SCHEMA,executionId:run.procedure.executionId,
        root:reference,adapter:METHOD_ADAPTER,mode:'execution',status:run.status,startedAt:run.startedAt,endedAt:run.endedAt,
        invocations:run.procedure.invocations,trace:run.trace,...(run.result===undefined?{}:{result:run.result})};
      this.options.library.recordExecution(receipt);
      trial.executionId = receipt.executionId; trial.completed = run.status === 'completed';
      const assessment = assessPracticeTrial(trial,fixture,this.binding);
      const review = this.options.library.review({id:methodId,revision:reference.revision,executionId:receipt.executionId,
        outcome:assessment.achieved===null?'unknown':assessment.achieved?'achieved':'not-achieved',
        assessment:`Measured isolated fixture ${fixture.id}: ${assessment.reason}.`,context:`Practice ${fixture.environmentVersion}/${fixture.snapshotId}; no live improvement claim.`,
        measurements:assessment.measurements,counterexamples:['One isolated case does not establish live-world or general success.']},'harness2-practice') as MethodReview;
      trial.reviewId = review.id;
      return structuredClone(trial);
    } catch (error) {
      if (reset) { this.poisoned = true; throw new PracticeUnknownEffect(); }
      throw error;
    } finally { this.busy = false; }
  }
}

/** Independent baseline and held-out checks. No implicit skill adoption. */
export function gatePracticeCandidate(baseline: PracticeAssessment[], candidate: PracticeAssessment[],
  holdoutBaseline: PracticeAssessment[], holdoutCandidate: PracticeAssessment[]): { eligible: boolean; reason: string; adopted: false } {
  const all = [...baseline,...candidate,...holdoutBaseline,...holdoutCandidate];
  if (!baseline.length || candidate.length !== baseline.length || !holdoutBaseline.length || holdoutCandidate.length !== holdoutBaseline.length
    || all.some(a=>a.achieved===null)) return {eligible:false,reason:'incomplete-evidence',adopted:false};
  if (candidate.some((a,i)=>baseline[i].achieved===true && a.achieved!==true)
    || holdoutCandidate.some(a=>a.achieved!==true)) return {eligible:false,reason:'regression-or-holdout-failure',adopted:false};
  if (!candidate.some((a,i)=>a.achieved===true && baseline[i].achieved===false)
    && !holdoutCandidate.some((a,i)=>a.achieved===true && holdoutBaseline[i].achieved===false))
    return {eligible:false,reason:'no-measured-success-improvement',adopted:false};
  return {eligible:true,reason:'isolated-comparison-passed',adopted:false};
}

/** Agent-authored candidate construction in a revocable, isolated worker. */
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { CombatCandidate, CombatDecisionFrame } from './combat-decision-types.ts';

export interface CombatProgram { name: string; code: string; params?: Record<string, unknown> }
export interface CombatProgramResult { candidates: CombatCandidate[]; instructions: string }
export const COMBAT_PROGRAM_LIMITS = Object.freeze({ sourceChars: 12_000, paramsChars: 4096,
  outputChars: 24_000, candidates: 16, startupMs: 2000, evaluationMs: 50, responseMs: 500, stepBlocks: 1.6 });

export function validCombatProgram(value: unknown): value is CombatProgram {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as CombatProgram;
  return Object.keys(p).every(k => ['name', 'code', 'params'].includes(k))
    && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 80
    && typeof p.code === 'string' && p.code.trim().length > 0 && p.code.length <= COMBAT_PROGRAM_LIMITS.sourceChars
    && (p.params === undefined || (!!p.params && typeof p.params === 'object' && !Array.isArray(p.params)
      && JSON.stringify(p.params).length <= COMBAT_PROGRAM_LIMITS.paramsChars));
}

export function combatProgramHash(program: CombatProgram): string {
  return createHash('sha256').update(program.code).digest('hex');
}

export class CombatProgramRunner {
  private worker: Worker | null = null;
  private key = '';
  private ready: Promise<void> | null = null;
  private failure: string | null = null;
  private evaluationMs: number | null = null;
  private roundTripMs: number | null = null;
  private cancelStartup: ((reason: string) => void) | null = null;
  private pending: { resolve: (value: CombatProgramResult) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> } | null = null;

  status(): { sourceHash: string | null; error: string | null; evaluationMs: number | null; roundTripMs: number | null } {
    return { sourceHash: this.key.split(':')[0] || null, error: this.failure,
      evaluationMs: this.evaluationMs, roundTripMs: this.roundTripMs };
  }

  async configure(program: CombatProgram): Promise<void> {
    if (!validCombatProgram(program)) throw new Error('Invalid combat program');
    const key = combatProgramHash(program) + ':' + JSON.stringify(program.params ?? {});
    if (key === this.key) {
      if (this.failure) throw new Error(this.failure);
      await this.ready; return;
    }
    this.close();
    this.key = key;
    const worker = new Worker(new URL('./combat-program-worker.mjs', import.meta.url), {
      workerData: { code: program.code, outputChars: COMBAT_PROGRAM_LIMITS.outputChars,
        evaluationMs: COMBAT_PROGRAM_LIMITS.evaluationMs },
      env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    this.worker = worker;
    worker.unref();
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail('Combat program startup timed out'), COMBAT_PROGRAM_LIMITS.startupMs);
      let initialized = false;
      const fail = (reason: string) => {
        if (this.worker !== worker) return;
        this.cancelStartup = null;
        clearTimeout(timer);
        this.failure = reason;
        this.pending?.reject(new Error(reason));
        if (this.pending) clearTimeout(this.pending.timer);
        this.pending = null;
        this.worker = null;
        void worker.terminate();
        if (!initialized) reject(new Error(reason));
      };
      this.cancelStartup = fail;
      worker.on('error', error => fail(String(error)));
      worker.on('exit', code => fail(`Combat program worker exited (${code})`));
      worker.on('message', message => {
        if (this.worker !== worker) return;
        if (message.kind === 'ready') { clearTimeout(timer); this.cancelStartup = null; initialized = true; resolve(); return; }
        if (message.kind === 'error') { fail(String(message.error)); return; }
        if (message.kind === 'result' && this.pending) {
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
          this.evaluationMs = message.evaluationMs;
          pending.resolve(message.value);
        }
      });
    });
    await this.ready;
  }

  async run(program: CombatProgram, frame: CombatDecisionFrame): Promise<CombatProgramResult> {
    await this.configure(program);
    if (this.pending) throw new Error('Combat program already evaluating');
    const startedAt = performance.now();
    return await new Promise<CombatProgramResult>((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => {
        this.failure = 'Combat program worker response timed out';
        const pending = this.pending; this.pending = null;
        const worker = this.worker; this.worker = null;
        void worker?.terminate(); pending?.reject(new Error(this.failure));
      }, COMBAT_PROGRAM_LIMITS.responseMs) };
      const { program: _program, ...input } = frame;
      this.worker!.postMessage({ frame: input, params: program.params ?? {} });
    }).finally(() => { this.roundTripMs = performance.now() - startedAt; });
  }

  close(): void {
    this.cancelStartup?.('Combat program revoked during startup');
    if (this.pending) {
      clearTimeout(this.pending.timer); this.pending.reject(new Error('Combat program revoked')); this.pending = null;
    }
    const worker = this.worker; this.worker = null; this.key = ''; this.failure = null; this.ready = null;
    this.evaluationMs = null; this.roundTripMs = null;
    void worker?.terminate();
  }
}

/** The program may choose tactics freely within the current executable capability set. */
export function combatProgramCandidates(result: unknown, frame: CombatDecisionFrame,
  safeStep: (to: [number, number, number]) => boolean): CombatProgramResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Program must return an object');
  const r = result as CombatProgramResult;
  if (!Array.isArray(r.candidates) || r.candidates.length > COMBAT_PROGRAM_LIMITS.candidates
    || typeof r.instructions !== 'string' || r.instructions.length > 1200)
    throw new Error('Program must return candidates (at most 16) and instructions (at most 1200 characters)');
  const ids = new Set<string>();
  const pool = frame.actionPool ?? frame.candidates;
  const candidates = r.candidates.map(c => {
    if (!c || !/^[a-z][a-z0-9_:-]{0,63}$/.test(c.id) || ids.has(c.id)
      || typeof c.intent !== 'string' || !c.intent.trim() || c.intent.length > 240)
      throw new Error('Program candidate needs a unique id and concise intent');
    ids.add(c.id);
    if (frame.battlefield.action.emergency) throw new Error('Emergency owns the body');
    if (c.kind === 'step') {
      const to = c.destination, from = frame.battlefield.self.position;
      if (!frame.battlefield.action.canStep || !Array.isArray(to) || to.length !== 3
        || !to.every(Number.isFinite) || Math.hypot(...to.map((v, i) => v - from[i])) > COMBAT_PROGRAM_LIMITS.stepBlocks
        || !safeStep(to)) throw new Error(`Unsafe or unavailable step: ${c.id}`);
      return { id: c.id, kind: c.kind, intent: c.intent, destination: [...to] as [number, number, number] };
    }
    const eligible = pool.find(a => a.kind === c.kind && (c.kind === 'cast'
      ? a.kind === 'cast' && a.spell === c.spell && a.ruleId === c.ruleId
      : c.kind === 'engage' ? a.kind === 'engage' && a.targetId === c.targetId && a.uuid === c.uuid
        : c.kind === 'retreat'));
    if (!eligible) throw new Error(`Unavailable candidate: ${c.id}`);
    return { ...eligible, id: c.id, intent: c.intent };
  });
  return { candidates, instructions: r.instructions };
}

/** Counterfactual candidate-menu tests. This is not a fight simulator or a second body. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CombatDecisionFrame } from './combat-decision-types.ts';
import { CombatProgramRunner, combatProgramCandidates, combatProgramHash, validCombatProgram, type CombatProgram } from './combat-program.ts';

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const combatProgramParametersHash = (program: CombatProgram) => digest(program.params ?? {});
export interface CombatProbeSample { id: string; capturedAt: string; frame: CombatDecisionFrame }
export interface CombatProbeRequest { program: CombatProgram; samples?: string[] }
export const validCombatProbe = (v: unknown): v is CombatProbeRequest => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const x = v as CombatProbeRequest;
  return Object.keys(x).every(k => k === 'program' || k === 'samples') && validCombatProgram(x.program)
    && (x.samples === undefined || (Array.isArray(x.samples) && x.samples.length > 0 && x.samples.length <= 8
      && new Set(x.samples).size === x.samples.length && x.samples.every(s => typeof s === 'string' && /^sample-[a-f0-9]{24}$/.test(s))));
};

export class CombatProgramProbe {
  private realm = '';
  private samples: CombatProbeSample[] = [];
  private serial = 0;
  private lastCapture = -Infinity;
  private busy = false;
  private file: string | null = null;
  private persistenceError: string | null = null;
  constructor(private readonly directory: string | null = null) {}
  useRealm(realm: string): void {
    if (this.realm === realm) return;
    this.flush(); this.realm = realm; this.samples = []; this.lastCapture = -Infinity; this.serial++;
    this.file = this.directory ? join(this.directory, digest(realm) + '.json') : null;
    this.persistenceError=null;
    if (this.file && existsSync(this.file)) try {
      if (statSync(this.file).size > 2_000_000) throw Error('Combat probe archive exceeds bounded size');
      const value = readFileSync(this.file, 'utf8');
      if (Buffer.byteLength(value) > 2_000_000) throw Error('Combat probe archive exceeds bounded size');
      const data = JSON.parse(value);
      if (data.schema !== 'combat-probe/v1' || data.realm !== realm || !Array.isArray(data.samples) || data.samples.length > 32)
        throw Error('Invalid combat probe archive');
      for(const s of data.samples)if(!s||typeof s.capturedAt!=='string'||!Number.isFinite(Date.parse(s.capturedAt))
        ||!s.frame?.battlefield?.self?.health||!Array.isArray(s.frame.battlefield.actors)||!s.frame.battlefield.action||!Array.isArray(s.frame.candidates)
        ||s.id!=='sample-'+digest([realm,s.frame]).slice(0,24))throw Error('Invalid recorded sample; original archive retained');
      this.samples = data.samples;
    }catch(error){this.persistenceError=String(error);this.file=null;}
  }
  capture(frame: CombatDecisionFrame): string | null {
    const at = frame.battlefield.sampledAtMs;
    if (!this.realm || !Number.isFinite(at)) return null;
    if (at - this.lastCapture < 1000) return this.samples.at(-1)?.id ?? null;
    // Immutable pre-program pool. Never borrow a later live scene for a historical test.
    const clean = structuredClone(frame); delete clean.policy; delete clean.programDeferred;
    if (Buffer.byteLength(JSON.stringify(clean)) > 48_000) return null;
    const row = { id: 'sample-' + digest([this.realm, clean]).slice(0, 24), capturedAt: new Date(at).toISOString(), frame: clean };
    this.samples.push(row); this.samples = this.samples.slice(-32); this.lastCapture = at;
    return row.id;
  }
  index() {
    return { scope: digest(this.realm), historical: true,persistenceError:this.persistenceError, samples: this.samples.map(s => ({ id: s.id, capturedAt: s.capturedAt,
      tacticRevision: s.frame.tacticRevision, health: s.frame.battlefield.self.health.current, mana: s.frame.mana,
      fighting: s.frame.battlefield.action.fighting, emergency: s.frame.battlefield.action.emergency,
      actors: s.frame.battlefield.actors.map(a => ({ type: a.type, relation: a.relation, distance: a.distance })),
      offeredKinds: [...new Set((s.frame.actionPool ?? s.frame.candidates).map(c => c.kind))] })) };
  }
  flush(): void {
    if (!this.file || !this.realm) return;
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      mkdirSync(this.directory!, { recursive: true });
      writeFileSync(temp, JSON.stringify({ schema: 'combat-probe/v1', realm: this.realm, samples: this.samples }) + '\n');
      renameSync(temp, this.file);
      this.persistenceError=null;
    } catch(error){this.persistenceError=String(error);}
    finally { try{if(existsSync(temp))unlinkSync(temp);}catch{/* Keep original failure visible; never break the body loop. */} }
  }
  async run(request: CombatProbeRequest, parentRevision: number, signal?: AbortSignal) {
    if (!validCombatProbe(request)) throw Error('probe requires a valid program and up to eight recorded sample IDs');
    if (this.busy) throw Error('A combat program probe is already running; do not queue duplicate probes');
    signal?.throwIfAborted();
    const selected = request.samples ? request.samples.map(id => {
      const row = this.samples.find(s => s.id === id);
      if (!row) throw Error(`Unknown historical sample in this world: ${id}`);
      return structuredClone(row);
    }) : structuredClone(this.samples.slice(-4));
    if (!selected.length) throw Error('No recorded battlefield samples; wait for a natural sample or read battlefield once');
    this.busy = true;
    const serial = this.serial, runner = new CombatProgramRunner();
    const abort = () => runner.close(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const rows = [];
      for (const sample of selected) {
        signal?.throwIfAborted();
        if (serial !== this.serial) throw Error('World changed during combat program probe');
        const f = sample.frame, pool = f.actionPool ?? f.candidates;
        const evaluate = async (p?: CombatProgram) => {
          if (!p) return { ok: true, candidates: f.candidates, instructions: '', sourceHash: null, parametersHash: null };
          try {
            const result = combatProgramCandidates(await runner.run(p, f), f,
              to => pool.some(c => c.kind === 'step' && c.destination.every((x, i) => x === to[i])));
            return { ok: true, ...result, sourceHash: combatProgramHash(p), parametersHash: combatProgramParametersHash(p) };
          } catch (error) {
            return { ok: false, error: String(error), sourceHash: combatProgramHash(p), parametersHash: combatProgramParametersHash(p) };
          }
        };
        const baseline = await evaluate(f.program), candidate = await evaluate(request.program);
        rows.push({ sampleId: sample.id, capturedAt: sample.capturedAt, tacticRevision: f.tacticRevision, baseline, candidate,
          changed: digest({ok:baseline.ok,candidates:baseline.candidates,instructions:baseline.instructions,error:baseline.error})
            !== digest({ok:candidate.ok,candidates:candidate.candidates,instructions:candidate.instructions,error:candidate.error}) });
      }
      signal?.throwIfAborted();
      if (serial !== this.serial) throw Error('World changed during combat program probe');
      this.flush();
      return { protocol: 'combat-program-probe/v1', id: randomUUID(), parentRevision,
        sourceHash: combatProgramHash(request.program), parametersHash: combatProgramParametersHash(request.program),
        rows, valid: rows.every(r => r.candidate.ok), adopted: false, executed: false, improvement: null,
        boundary: 'Historical candidate-menu comparison only. No model choice, world simulation, damage, win or actual movement. Custom steps absent from the recorded checked pool are unverified. Automatic spell rules and weapon selection are separate; this probe does not change them.' };
    } finally { signal?.removeEventListener('abort', abort); runner.close(); this.busy = false; }
  }
}

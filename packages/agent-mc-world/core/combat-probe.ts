/** Counterfactual candidate-menu tests. This is not a fight simulator or a second body. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CombatDecisionFrame } from './combat-decision-types.ts';
import { CombatProgramRunner, combatProgramCandidates, combatProgramHash, validCombatProgram, type CombatProgram } from './combat-program.ts';

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const combatProgramParametersHash = (program: CombatProgram) => digest(program.params ?? {});
export interface CombatProbeSample { id: string; capturedAt: string; frame: CombatDecisionFrame }
interface RetainedSample { sample: CombatProbeSample; expiresAt: number }
export const COMBAT_PROBE_RETENTION = Object.freeze({ recent: 32, retained: 256, leaseMs: 30 * 60_000,
  sampleBytes: 48_000, archiveBytes: 16_000_000 });
export class CombatProbeSampleUnavailableError extends Error {
  readonly code = 'combat_probe_sample_unavailable';
  constructor(readonly sampleId: string) {
    super(`Historical sample unavailable in this world: ${sampleId}. Read samples again; retain the candidate program and use only returned sample IDs.`);
    this.name = 'CombatProbeSampleUnavailableError';
  }
}
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
  private retained = new Map<string, RetainedSample>();
  private retainedFile: string | null = null;
  private persistenceError: string | null = null;
  constructor(private readonly directory: string | null = null, private readonly now: () => number = Date.now) {}
  private pruneRetained(): void {
    const now = this.now();
    for (const [id, row] of this.retained) if (row.expiresAt <= now) this.retained.delete(id);
  }
  private validSample(s: CombatProbeSample): boolean {
    return !!s && typeof s.capturedAt === 'string' && Number.isFinite(Date.parse(s.capturedAt))
      && !!s.frame?.battlefield?.self?.health && Array.isArray(s.frame.battlefield.actors)
      && !!s.frame.battlefield.action && Array.isArray(s.frame.candidates)
      && Buffer.byteLength(JSON.stringify(s.frame)) <= COMBAT_PROBE_RETENTION.sampleBytes
      && s.id === 'sample-' + digest([this.realm, s.frame]).slice(0, 24);
  }
  useRealm(realm: string): void {
    if (this.realm === realm) return;
    this.flush(); this.realm = realm; this.samples = []; this.retained.clear(); this.lastCapture = -Infinity; this.serial++;
    this.file = this.directory ? join(this.directory, digest(realm) + '.json') : null;
    this.retainedFile = this.directory ? join(this.directory, digest(realm) + '.retained.json') : null;
    this.persistenceError=null;
    if (this.file && existsSync(this.file)) try {
      if (statSync(this.file).size > 2_000_000) throw Error('Combat probe archive exceeds bounded size');
      const value = readFileSync(this.file, 'utf8');
      if (Buffer.byteLength(value) > 2_000_000) throw Error('Combat probe archive exceeds bounded size');
      const data = JSON.parse(value);
      if (data.schema !== 'combat-probe/v1' || data.realm !== realm || !Array.isArray(data.samples) || data.samples.length > 32)
        throw Error('Invalid combat probe archive');
      for(const s of data.samples)if(!this.validSample(s))throw Error('Invalid recorded sample; original archive retained');
      this.samples = data.samples;
    }catch(error){this.persistenceError=String(error);this.file=null;}
    if (this.retainedFile && existsSync(this.retainedFile)) try {
      if (statSync(this.retainedFile).size > COMBAT_PROBE_RETENTION.archiveBytes) throw Error('Retained probe archive exceeds bounded size');
      const data = JSON.parse(readFileSync(this.retainedFile, 'utf8'));
      if (data.schema !== 'combat-probe-retention/v1' || data.realm !== realm || !Array.isArray(data.samples)
        || data.samples.length > COMBAT_PROBE_RETENTION.retained) throw Error('Invalid retained probe archive');
      const restored = new Map<string, RetainedSample>();
      for (const row of data.samples) {
        if (!row || !Number.isFinite(row.expiresAt) || !this.validSample(row.sample)
          || restored.has(row.sample.id)) throw Error('Invalid retained sample; original archive retained');
        if (row.expiresAt > this.now()) restored.set(row.sample.id, row);
      }
      this.retained = restored;
    } catch (error) { this.persistenceError = String(error); this.retainedFile = null; }
  }
  capture(frame: CombatDecisionFrame): string | null {
    const at = frame.battlefield.sampledAtMs;
    if (!this.realm || !Number.isFinite(at)) return null;
    if (at - this.lastCapture < 1000) return this.samples.at(-1)?.id ?? null;
    // Immutable pre-program pool. Never borrow a later live scene for a historical test.
    const clean = structuredClone(frame); delete clean.policy; delete clean.programDeferred;
    if (Buffer.byteLength(JSON.stringify(clean)) > COMBAT_PROBE_RETENTION.sampleBytes) return null;
    const row = { id: 'sample-' + digest([this.realm, clean]).slice(0, 24), capturedAt: new Date(at).toISOString(), frame: clean };
    this.samples.push(row); this.samples = this.samples.slice(-COMBAT_PROBE_RETENTION.recent); this.lastCapture = at;
    return row.id;
  }
  index() {
    this.pruneRetained();
    const expiresAt = this.now() + COMBAT_PROBE_RETENTION.leaseMs;
    let omitted = 0;
    for (const sample of this.samples) {
      if (!this.retained.has(sample.id) && this.retained.size >= COMBAT_PROBE_RETENTION.retained) { omitted++; continue; }
      this.retained.set(sample.id, {sample, expiresAt});
    }
    // Never advertise an ID which the next capture can evict. At capacity, return
    // existing protected history rather than silently breaking an earlier lease.
    const rows = [...this.retained.values()].slice(-COMBAT_PROBE_RETENTION.recent);
    // A newly advertised ID gets a full lease even when the archive is full and
    // these rows are older than the rotating capture buffer.
    for (const row of rows) row.expiresAt = expiresAt;
    this.flush();
    return { scope: digest(this.realm), historical: true,persistenceError:this.persistenceError,
      retention: {leaseMs:COMBAT_PROBE_RETENTION.leaseMs, capacity:COMBAT_PROBE_RETENTION.retained,
        retained:this.retained.size, omittedRecent:omitted, persisted:!!this.retainedFile && !this.persistenceError},
      samples: rows.map(({sample:s, expiresAt}) => ({ id: s.id, capturedAt: s.capturedAt, availableUntil:new Date(expiresAt).toISOString(),
      tacticRevision: s.frame.tacticRevision, health: s.frame.battlefield.self.health.current, mana: s.frame.mana,
      fighting: s.frame.battlefield.action.fighting, emergency: s.frame.battlefield.action.emergency,
      actors: s.frame.battlefield.actors.map(a => ({ type: a.type, relation: a.relation, distance: a.distance })),
      offeredKinds: [...new Set((s.frame.actionPool ?? s.frame.candidates).map(c => c.kind))] })) };
  }
  flush(): void {
    if (!this.directory || !this.realm) return;
    this.pruneRetained();
    // Keep the original recent archive readable by older releases on rollback.
    const files = [
      {file:this.file, data:{schema:'combat-probe/v1',realm:this.realm,samples:this.samples}},
      {file:this.retainedFile, data:{schema:'combat-probe-retention/v1',realm:this.realm,samples:[...this.retained.values()]}}
    ];
    let failure: string | null = (!this.file || !this.retainedFile) ? this.persistenceError : null;
    for (const {file, data} of files) {
      if (!file) continue;
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        mkdirSync(this.directory, {recursive:true});
        writeFileSync(temp, JSON.stringify(data) + '\n');
        renameSync(temp, file);
      } catch(error) { failure = String(error); }
      finally { try{if(existsSync(temp))unlinkSync(temp);}catch{/* Preserve original failure. */} }
    }
    this.persistenceError = failure;
  }
  async run(request: CombatProbeRequest, parentRevision: number, signal?: AbortSignal) {
    if (!validCombatProbe(request)) throw Error('probe requires a valid program and up to eight recorded sample IDs');
    if (this.busy) throw Error('A combat program probe is already running; do not queue duplicate probes');
    signal?.throwIfAborted();
    this.pruneRetained();
    const selected = request.samples ? request.samples.map(id => {
      const row = this.retained.get(id)?.sample ?? this.samples.find(s => s.id === id);
      if (!row) throw new CombatProbeSampleUnavailableError(id);
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

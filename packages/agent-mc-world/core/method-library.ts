/** Host-independent, immutable Agent-authored method versions. Saving never executes or installs code. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_ADAPTER, type MethodRun } from './method-runner.ts';
import { parseProcedure, procedureId, procedureRevision, procedureHash, resolveProcedure, PROCEDURE_SCHEMA, PROCEDURE_RECEIPT_SCHEMA,
  type ProcedureReference, type ProcedureVersion, type ProcedureReceipt } from './support/procedure.ts';

interface Trial { executionId: string; revision: string; mode: ProcedureReceipt['mode']; status: ProcedureReceipt['status']; endedAt: string }
interface Selection { revision: string; reviewId: string; selectionId?: string }
export interface MethodReview {
  id: string; method: string; revision: string; executionId: string; receiptHash: string;
  outcome: 'achieved' | 'not-achieved' | 'unknown'; assessment: string; context: string;
  measurements: Record<string, number | null>; counterexamples: string[];
  author: { kind: 'agent'; role: string }; createdAt: string;
}
interface Entry { revision: string; versions: number; description: string; conditions: string[]; updatedAt: string;
  recentTrials?: Trial[]; latestReview?: Pick<MethodReview, 'id' | 'revision' | 'executionId' | 'outcome'>; selected?: Selection }
type Index = Record<string, Entry>;
const uuid = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) throw new Error('Expected an exact execution/review UUID');
  return value;
};
const text = (value: unknown, name: string, max = 1600): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must contain 1..${max} characters`);
  return value;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const REF_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  handle: { type: 'string' }, revision: { type: 'string' } }, required: ['handle', 'revision'] };
export const METHOD_LIBRARY_SCHEMA = { type: 'object', additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['list', 'read', 'save', 'evidence', 'review', 'adopt'] }, id: { type: 'string' }, revision: { type: 'string' },
    code: { type: 'string', maxLength: 12000 }, description: { type: 'string', maxLength: 800 },
    conditions: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
    parent: { type: ['string', 'null'] }, validationRunId: { type: 'integer', minimum: 1 },
    query: { type: 'string', maxLength: 200 }, after: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 },
    dependencies: { type: 'object', maxProperties: 7, additionalProperties: REF_SCHEMA,
      description: 'Alias to an exact version returned by this scoped library; methods.run(alias,params) composes it.' },
    executionId: { type: 'string' }, reviewId: { type: 'string' }, selectionId: { type: 'string' }, call: { type: 'integer', minimum: 1, maximum: 32 },
    outcome: { type: 'string', enum: ['achieved', 'not-achieved', 'unknown'] }, assessment: { type: 'string', maxLength: 1600 },
    context: { type: 'string', maxLength: 1600 }, measurements: { type: 'object', maxProperties: 12, additionalProperties: { type: ['number', 'null'] } },
    counterexamples: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
    expectedAdopted: { type: ['string', 'null'] }, reason: { type: 'string', maxLength: 800 },
  }, required: ['op'] };

export class MethodLibrary {
  private index: Index = {};
  private readonly versions = new Map<string, ProcedureVersion>();
  private readonly artifacts = new Map<string, unknown>();
  private stamp: string | null = null;
  constructor(private readonly directory: string | null) {}

  private reload(): void {
    if (!this.directory) return;
    const file = join(this.directory, 'index.json');
    if (!existsSync(file)) { this.index = {}; this.stamp = null; return; }
    const stat = statSync(file), stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    if (stamp === this.stamp) return;
    if (stat.size > 2_000_000) throw new Error('method index too large');
    const text = readFileSync(file, 'utf8');
    const index = JSON.parse(text) as Index;
    if (!index || typeof index !== 'object' || Array.isArray(index) || Object.keys(index).length > 128) throw new Error('invalid method index');
    for (const [id, entry] of Object.entries(index)) {
      procedureId(id); procedureRevision(entry?.revision);
      if (!Number.isInteger(entry.versions) || entry.versions < 1 || entry.versions > 64
        || typeof entry.description !== 'string' || entry.description.length > 800
        || !Array.isArray(entry.conditions) || entry.conditions.length > 8
        || entry.conditions.some(c => typeof c !== 'string' || c.length > 400)
        || typeof entry.updatedAt !== 'string') throw new Error('invalid method index entry');
      if (entry.selected) { procedureRevision(entry.selected.revision); uuid(entry.selected.reviewId); if (entry.selected.selectionId) uuid(entry.selected.selectionId); }
      if (entry.recentTrials !== undefined && (!Array.isArray(entry.recentTrials) || entry.recentTrials.length > 8)) throw new Error('invalid method trials');
      for (const trial of entry.recentTrials ?? []) {
        uuid(trial.executionId); procedureRevision(trial.revision);
        if (!['validation', 'execution'].includes(trial.mode) || !['validated', 'completed', 'failed', 'cancelled'].includes(trial.status)
          || !Number.isFinite(Date.parse(trial.endedAt))) throw new Error('invalid method trial');
      }
      if (entry.latestReview) { uuid(entry.latestReview.id); uuid(entry.latestReview.executionId); procedureRevision(entry.latestReview.revision);
        if (!['achieved', 'not-achieved', 'unknown'].includes(entry.latestReview.outcome)) throw new Error('invalid method review'); }
    }
    this.index = index;
    this.stamp = stamp;
  }

  private writeIndex(next: Index): void {
    if (this.directory) {
      const temporary = join(this.directory, `index-${randomUUID()}.tmp`);
      try { writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); renameSync(temporary, join(this.directory, 'index.json')); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }
    this.index = next; this.stamp = null;
  }

  private writing<T>(work: () => T): T {
    let lock: number | undefined;
    if (this.directory) { mkdirSync(this.directory, { recursive: true }); lock = openSync(join(this.directory, 'write.lock'), 'wx'); }
    try { this.reload(); return work(); }
    finally { if (lock !== undefined) { closeSync(lock); unlinkSync(join(this.directory!, 'write.lock')); } }
  }

  private artifact(key: string, value?: unknown): unknown {
    const file = this.directory ? join(this.directory, key + '.json') : null;
    if (value !== undefined) {
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body) > 1_200_000) throw new Error('method evidence too large');
      const existing = file ? existsSync(file) : this.artifacts.has(key);
      if (existing) { if (procedureHash(this.artifact(key)) !== procedureHash(value)) throw new Error('immutable method evidence conflict'); }
      else if (file) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, body, { flag: 'wx', mode: 0o600 }); }
      else this.artifacts.set(key, structuredClone(value));
      return value;
    }
    if (file) { if (statSync(file).size > 1_200_000) throw new Error('method evidence too large'); return JSON.parse(readFileSync(file, 'utf8')); }
    if (!this.artifacts.has(key)) throw new Error('method evidence unavailable');
    return structuredClone(this.artifacts.get(key));
  }

  list(args: Record<string, unknown> = {}): unknown {
    this.reload();
    const limit = args.limit ?? 8, query = args.query ?? '', after = args.after ?? '';
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20 || typeof query !== 'string'
      || query.length > 200 || typeof after !== 'string') throw new Error('list: limit=1..20; query<=200 characters; after=id');
    const all = Object.entries(this.index).sort(([a],[b]) => a.localeCompare(b))
      .filter(([id, entry]) => (!after || id.localeCompare(after) > 0)
        && `${id} ${entry.description} ${entry.conditions.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    const shown = all.slice(0, Number(limit));
    return { persistent: !!this.directory, methods: shown.map(([id, entry]) => ({ id, revision: entry.revision,
      description: entry.description.slice(0,240), conditions: entry.conditions.slice(0,2).map(c=>c.slice(0,160)),
      updatedAt: entry.updatedAt, reference: this.reference(id, entry.revision),
      selected: entry.selected ? { ...entry.selected, reference: this.reference(id, entry.selected.revision) } : null,
      latestExecution: entry.recentTrials?.find(t => t.mode === 'execution') ?? null,
      latestReview: entry.latestReview ?? null, verifiedImprovement: false })),
    next: all.length > shown.length ? shown.at(-1)![0] : null,
    note: '源码版本与语法校验不是玩法效果证据；read 按需读取，procedure 显式选择版本运行。' };
  }

  reference(id: string, revision: string): ProcedureReference {
    return { handle: `mem:mc-method/${procedureId(id)}/${procedureRevision(revision)}`, revision };
  }

  read(id: string, revision?: string): ProcedureVersion {
    procedureId(id); this.reload();
    const rev = procedureRevision(revision ?? (Object.hasOwn(this.index, id) ? this.index[id].revision : undefined));
    const key = `${id}/${rev}`;
    const file = this.directory ? join(this.directory, id, `${rev}.json`) : null;
    if (file && statSync(file).size > 128_000) throw new Error('method version too large');
    const version = file ? JSON.parse(readFileSync(file, 'utf8')) : this.versions.get(key);
    const result = parseProcedure(version);
    if (result.id !== id || result.revision !== rev) throw new Error('method identity mismatch');
    return result;
  }

  blob(handle: string): { bytes: Uint8Array; mime: string } | null {
    const match = /^mem:mc-method\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{64})$/.exec(handle);
    if (!match) return null;
    if (this.directory ? !existsSync(join(this.directory, match[1], `${match[2]}.json`)) : !this.versions.has(`${match[1]}/${match[2]}`)) return null;
    const version = this.read(match[1], match[2]);
    return { bytes: Buffer.from(JSON.stringify(version)), mime: 'application/json' };
  }

  /** A small, replaceable discovery fact. No source, directory scan, inference or action. */
  facts(): string {
    this.reload();
    const entries = Object.entries(this.index);
    const recent = entries.sort(([,a],[,b]) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
    return '[动作方法索引] 本作用域已保存 ' + entries.length + ' 个方法；mc_script {api:"authoring"} 可直接编写条件动作，'
      + '{library:{op:"list",query:"目的"}} 按需检索，源码不常驻。'
      + recent.map(([id, e]) => {
        const trial = e.recentTrials?.find(t => t.mode === 'execution');
        const pending = trial && e.latestReview?.executionId !== trial.executionId;
        return `\n${JSON.stringify(id)} ${JSON.stringify(e.description.slice(0, 70))}；候选 ${e.revision.slice(0, 12)}`
          + (e.selected ? `；已选择 ${e.selected.revision.slice(0,12)}` : '；尚未选择')
          + (pending ? `；原执行 ${trial.executionId}(${trial.status}) 待核验/复盘` : '');
      }).join('') + '\n历史方法不是当前现场或已学会证明；需要保持按键、计算反馈分支或复用编排时可写候选，并核验真实效果。';
  }

  /** Called by the actual adapter terminal, never by an Agent-supplied success claim. */
  recordExecution(receipt: ProcedureReceipt): boolean {
    const match = /^mem:mc-method\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{64})$/.exec(receipt.root.handle);
    if (!match) return false; // Personal/cross-World libraries retain their own evidence owner.
    const id = match[1], executionId = uuid(receipt.executionId);
    return this.writing(() => {
      const version = this.read(id, receipt.root.revision);
      if (version.revision !== match[2] || receipt.schema !== PROCEDURE_RECEIPT_SCHEMA || receipt.adapter !== METHOD_ADAPTER
        || !['validation', 'execution'].includes(receipt.mode) || !['validated', 'completed', 'failed', 'cancelled'].includes(receipt.status)
        || !Number.isFinite(Date.parse(receipt.startedAt)) || !Number.isFinite(Date.parse(receipt.endedAt))
        || !Array.isArray(receipt.trace) || receipt.trace.length > 32) throw new Error('invalid method execution receipt');
      this.artifact(`evidence/${id}/${executionId}`, { receipt, receiptHash: procedureHash(receipt), sourceHash: version.sourceHash });
      const entry = this.index[id];
      const trial: Trial = { executionId, revision: version.revision, status: receipt.status, mode: receipt.mode, endedAt: receipt.endedAt };
      // This bounded index is a reading window; older immutable files remain addressable by UUID.
      const recentTrials = [trial, ...(entry.recentTrials ?? []).filter(t => t.executionId !== executionId)]
        .sort((a,b) => b.endedAt.localeCompare(a.endedAt)).slice(0,8);
      this.writeIndex({ ...this.index, [id]: { ...entry, recentTrials } });
      return true;
    });
  }

  private execution(id: string, executionId: string): { receipt: ProcedureReceipt; receiptHash: string } {
    const saved = this.artifact(`evidence/${procedureId(id)}/${uuid(executionId)}`) as { receipt: ProcedureReceipt; receiptHash: string; sourceHash: string };
    const version = this.read(id, saved.receipt.root.revision);
    if (saved.receipt.executionId !== executionId || saved.receipt.root.handle !== this.reference(id, version.revision).handle
      || saved.sourceHash !== version.sourceHash || saved.receiptHash !== procedureHash(saved.receipt)) throw new Error('method receipt identity/hash mismatch');
    return saved;
  }

  evidence(args: Record<string, unknown>): unknown {
    const id = procedureId(args.id); this.reload();
    const entry = this.index[id]; if (!entry) throw new Error('unknown method');
    if ([args.selectionId,args.reviewId,args.executionId].filter(v=>v!==undefined).length>1) throw new Error('Select one exact executionId, reviewId or selectionId');
    if (args.selectionId !== undefined) {
      if (args.call !== undefined) throw new Error('call requires executionId');
      const selection = this.artifact(`selections/${id}/${uuid(args.selectionId)}`) as { id:string; method:string; revision:string; reviewId:string };
      if (selection.id !== args.selectionId || selection.method !== id || this.reviewRecord(id,selection.reviewId).revision !== selection.revision) throw new Error('selection evidence identity mismatch');
      return selection;
    }
    if (args.reviewId !== undefined) {
      if (args.executionId !== undefined || args.call !== undefined) throw new Error('reviewId cannot be combined with executionId/call');
      return this.reviewRecord(id, uuid(args.reviewId));
    }
    if (args.executionId === undefined) {
      if (args.call !== undefined) throw new Error('call requires executionId');
      return { id, recent: entry.recentTrials ?? [], selected: entry.selected ?? null, latestReview: entry.latestReview ?? null,
        note: 'Recent eight receipt references only; older exact execution UUIDs remain readable. No automatic success classification.' };
    }
    const { receipt, receiptHash } = this.execution(id, uuid(args.executionId));
    if (args.call !== undefined) {
      if (!Number.isInteger(args.call) || Number(args.call) < 1 || Number(args.call) > 32) throw new Error('call must be 1..32');
      const trace = receipt.trace.find(t => (t as { call: number }).call === args.call);
      if (!trace) throw new Error('SDK call unavailable in this receipt');
      return { executionId: receipt.executionId, root: receipt.root, status: receipt.status, receiptHash, trace };
    }
    const result = JSON.stringify(receipt.result ?? null);
    return { ...receipt, result: result.length > 2000 ? undefined : receipt.result,
      ...(result.length > 2000 ? { resultExcerpt: result.slice(0,2000), resultTruncated: true } : {}),
      trace: receipt.trace.map(t => { const trace = t as MethodRun['trace'][number];
        return { call: trace.call, method: trace.method, startedAt: trace.startedAt, endedAt: trace.endedAt, error: trace.error,
          procedure: trace.procedure, resultAvailable: trace.result !== undefined }; }),
      receiptHash, goalVerified: false, note: 'Expand call for actual fields; program output and completion do not verify its objective.' };
  }

  private reviewRecord(id: string, reviewId: string): MethodReview {
    const review = this.artifact(`reviews/${procedureId(id)}/${uuid(reviewId)}`) as MethodReview;
    if (review.id !== reviewId || review.method !== id) throw new Error('method review identity mismatch');
    const { receipt, receiptHash } = this.execution(id, review.executionId);
    if (receiptHash !== review.receiptHash || receipt.root.revision !== review.revision || receipt.mode !== 'execution') throw new Error('review receipt unavailable or changed');
    return review;
  }

  review(args: Record<string, unknown>, role: string): unknown {
    const id = procedureId(args.id), revision = procedureRevision(args.revision), executionId = uuid(args.executionId);
    const { receipt, receiptHash } = this.execution(id, executionId);
    if (receipt.mode !== 'execution' || receipt.root.revision !== revision) throw new Error('review requires an actual execution of this exact version; syntax validation is insufficient');
    if (!['achieved','not-achieved','unknown'].includes(String(args.outcome))) throw new Error('outcome must be achieved/not-achieved/unknown');
    const measurements = args.measurements ?? {}, counterexamples = args.counterexamples ?? [];
    if (!record(measurements) || Object.keys(measurements).length > 12
      || Object.entries(measurements).some(([k,v]) => k.length > 80 || (v !== null && (typeof v !== 'number' || !Number.isFinite(v))))) throw new Error('measurements must be at most 12 finite numbers or null');
    if (!Array.isArray(counterexamples) || counterexamples.length > 8 || counterexamples.some(c => typeof c !== 'string' || c.length > 400)) throw new Error('counterexamples must be at most eight short failure boundaries');
    const review: MethodReview = { id: randomUUID(), method: id, revision, executionId, receiptHash,
      outcome: args.outcome as MethodReview['outcome'], assessment: text(args.assessment,'assessment'), context: text(args.context,'context'),
      measurements: structuredClone(measurements) as MethodReview['measurements'], counterexamples,
      author: { kind: 'agent', role: role.slice(0,80) }, createdAt: new Date().toISOString() };
    return this.writing(() => {
      this.artifact(`reviews/${id}/${review.id}`, review);
      const latestReview = { id: review.id, revision, executionId, outcome: review.outcome };
      this.writeIndex({ ...this.index, [id]: { ...this.index[id], latestReview } });
      return { ...review, assessmentAuthority: 'agent-interpretation', goalVerified: false, verifiedImprovement: false };
    });
  }

  adopt(args: Record<string, unknown>, role = 'unknown'): unknown {
    const id = procedureId(args.id), revision = procedureRevision(args.revision), reviewId = uuid(args.reviewId);
    const expected = args.expectedAdopted === null ? null : procedureRevision(args.expectedAdopted);
    const reason = text(args.reason,'reason',800);
    return this.writing(() => {
      const entry = this.index[id]; if (!entry) throw new Error('unknown method');
      if ((entry.selected?.revision ?? null) !== expected) throw new Error('selected version changed; read before adopting');
      const review = this.reviewRecord(id, reviewId), { receipt } = this.execution(id, review.executionId);
      if (review.revision !== revision || review.outcome !== 'achieved' || receipt.status !== 'completed') throw new Error('selection requires this version\'s completed execution and explicit achieved-goal assessment');
      const selection = { id: randomUUID(), method: id, revision, previous: expected, reviewId, reason,
        author: { kind: 'agent', role: role.slice(0,80) }, createdAt: new Date().toISOString() };
      this.artifact(`selections/${id}/${selection.id}`, selection);
      this.writeIndex({ ...this.index, [id]: { ...entry, selected: { revision, reviewId, selectionId: selection.id } } });
      return { ...selection, reference: this.reference(id,revision),
        changedRunningProgram: false, verifiedImprovement: false,
        note: 'Preferred version for future explicit selection only; the assessment remains an Agent interpretation. Older versions and counterexamples are retained.' };
    });
  }

  save(args: Record<string, unknown>, validation: MethodRun | undefined, role: string): unknown {
    const id = procedureId(args.id);
    const code = args.code;
    if (typeof code !== 'string') throw new Error('code is required');
    const sourceHash = createHash('sha256').update(code).digest('hex');
    if (!validation || validation.status !== 'validated' || validation.sourceHash !== sourceHash) {
      throw new Error('先对同一源码执行 mc_script {name,code,validate:true} 并取得 validated 终态，再传 validationRunId；完成运行不能代替语法校验。');
    }
    return this.writing(() => {
      const previous = Object.hasOwn(this.index, id) ? this.index[id] : undefined;
      if (args.parent !== (previous?.revision ?? null)) throw new Error('parent 与当前版本不一致；先 read，保留他人修订后再合并。新方法须 parent:null。');
      if (!previous && Object.keys(this.index).length >= 128) throw new Error('method library limit reached (128 methods)');
      if ((previous?.versions ?? 0) >= 64) throw new Error('method version limit reached (64 per method)');
      const body = { schema: PROCEDURE_SCHEMA, id, adapter: METHOD_ADAPTER,
        description: args.description, conditions: args.conditions, code, dependencies: args.dependencies ?? {},
        parent: args.parent, author: { kind: 'agent', role: role.slice(0, 80) },
        createdAt: new Date().toISOString(), sourceHash };
      const version = parseProcedure({ ...body, revision: procedureHash(body) });
      const reference = this.reference(id, version.revision);
      resolveProcedure(reference, METHOD_ADAPTER, handle => handle === reference.handle
        ? { bytes: Buffer.from(JSON.stringify(version)), mime: 'application/json' } : this.blob(handle));
      const entry: Entry = { ...previous, revision: version.revision, versions: (previous?.versions ?? 0) + 1,
        description: version.description, conditions: version.conditions, updatedAt: version.createdAt };
      const next = { ...this.index, [id]: entry };
      if (this.directory) {
        mkdirSync(join(this.directory, id), { recursive: true });
        writeFileSync(join(this.directory, id, `${version.revision}.json`), JSON.stringify(version), { flag: 'wx', mode: 0o600 });
      } else this.versions.set(`${id}/${version.revision}`, version);
      this.writeIndex(next);
      return { reference: this.reference(id, version.revision), sourceHash, parent: version.parent,
        persistent: !!this.directory, author: version.author, validationRunId: validation.id,
        verifiedImprovement: false, note: '已保存、未运行。procedure 可运行该版本或旧版；按真实任务终态和世界净变化评价效果。' };
    });
  }
}

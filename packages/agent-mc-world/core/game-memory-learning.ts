/** Explicit game evidence and reviewed learning workflows. The service, not this core, may organize evidence. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { memoryRequest } from './game-memory-http.ts';
import { artifactRef, sourceRef, LEARNING_INPUTS, LEARNING_WRITES, learningHelp, type LearningOperation } from './game-memory-learning-contract.ts';
import type { GameMemoryConfig } from './game-memory-service.ts';

type Data = Record<string, any>;
interface Submission { operation: LearningOperation; digest: string; state: 'unverified' | 'confirmed'; at: string; source?: unknown; runKey?: string; evidence?: Data; receipt?: Data }
interface Ledger { version: 1; scopeKey: string; refs: string[]; candidates: Record<string, { version: number; status: string; family: string }>; submissions: Record<string, Submission> }
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const canonical = (v: any): string => JSON.stringify(v, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const referenceKey = (v: unknown) => canonical(v);
const enc = (value: string) => {
  if (value === '.' || value === '..' || /[\\/]/.test(value)) throw new Error('Invalid learning path identifier');
  return encodeURIComponent(value);
};
const queues = new Map<string, Promise<void>>();

async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current); queues.set(key, queued);
  await previous;
  try { return await work(); }
  finally { release(); if (queues.get(key) === queued) queues.delete(key); }
}
const refList = <T extends z.ZodType>(schema: T) => z.array(schema).max(32);
const candidateSchema = z.object({ candidate_id: z.string().min(1).max(128), version: z.number().int().min(1),
  family: z.enum(['experience', 'skill']), status: z.enum(['pending', 'approved', 'rejected']), proposal: z.record(z.string(), z.unknown()),
  source_refs: refList(sourceRef), artifact_refs: refList(artifactRef), target: artifactRef.nullable(),
  reason: z.string().nullable(), result_artifact: artifactRef.nullable(), decision_reason: z.string().nullable(),
});
const bounds = (value: unknown, max = 65536) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > max) throw new Error('Learning result exceeds output budget; use a smaller selection');
};

export class GameMemoryLearning {
  constructor(private readonly directory: string | null, private readonly request: typeof fetch = fetch) {}

  async execute(args: Data, scopeKey: string, cfg: GameMemoryConfig, signal?: AbortSignal): Promise<Data> {
    if (Object.keys(args).some(k => !['action', 'operation', 'input', 'requestId'].includes(k))) throw new Error('Unexpected learning argument');
    if (args.operation === 'help') {
      if (args.requestId !== undefined || (args.input !== undefined && (!args.input || typeof args.input !== 'object'
        || Array.isArray(args.input) || Object.keys(args.input).some(k => k !== 'operation')))) throw new Error('Invalid learning help arguments');
      return { ...learningHelp(args.input?.operation), enabled: cfg.learningEnabled, scopeKey };
    }
    if (cfg.learningEnabled !== true || cfg.mode !== 'remote') throw new Error('Service learning is disabled; enable it explicitly in memory configuration');
    if (!['powercontext', 'http'].includes(cfg.provider)) throw new Error('This memory provider supports retrieval only; configure a learning-capable HTTP bridge');
    if (!this.directory || !/^[a-f0-9]{64}$/.test(scopeKey)) throw new Error('Service learning requires persistent scoped storage');
    const operation = args.operation as LearningOperation;
    if (!Object.hasOwn(LEARNING_INPUTS, operation)) throw new Error('Unknown learning operation; approval, installation and administration are not Agent tools');
    bounds(args.input ?? {}, 65536);
    const parsed = LEARNING_INPUTS[operation].safeParse(args.input ?? {});
    if (!parsed.success) throw new Error(`Invalid ${operation} input; use service help for its schema`);
    const input = parsed.data as Data, writing = LEARNING_WRITES.has(operation);
    if (writing ? typeof args.requestId !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(args.requestId) : args.requestId !== undefined)
      throw new Error('Writes require a stable requestId (1..128 ASCII characters); reads do not accept one');
    if (cfg.provider === 'powercontext' && (!cfg.scopeId.trim() || cfg.scopeId.length > 256)) throw new Error('Configure a dedicated existing PowerContext game scopeId');
    // Bind this configured service Scope once to the engine-selected game identity; never derive/create a remote Scope.
    let endpoint: URL;
    try { endpoint = new URL(cfg.endpoint); } catch { throw new Error('Invalid learning endpoint'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new Error('Invalid learning endpoint');
    const binding = hash(canonical([cfg.provider, endpoint.href.replace(/\/$/, ''), cfg.provider === 'powercontext' ? cfg.scopeId : scopeKey]));
    const path = join(this.directory, 'learning', binding + '.json');
    return exclusive(path, async () => {
      signal?.throwIfAborted();
      const ledger = this.read(path, scopeKey);
      const envelope = { protocol: 'agent-mc-learning/v1', provider: cfg.provider, scopeKey,
        ...(cfg.provider === 'powercontext' ? { scopeId: cfg.scopeId } : {}), historical: true, currentWorldVerified: false,
        learningVerified: false, authority: 'untrusted-historical-data', automaticInjection: false };
      if (operation === 'operation') return { ...envelope, submission: ledger.submissions[hash(input.request_id)] ?? null };
      const requestId = args.requestId as string;
      const digest = hash(canonical({ operation, input }));
      if (writing && Object.hasOwn(ledger.submissions, hash(requestId))) {
        const old = ledger.submissions[hash(requestId)];
        if (old.digest !== digest) throw new Error('requestId already binds different input; reconcile the original event before submitting a revision');
        return { ...envelope, replayed: false, priorSubmission: old, result: old.receipt ?? null,
          status: old.state, guidance: old.state === 'unverified' ? 'Read exact Source, candidate list or Dream state before any new submission; do not create a new requestId to bypass an unknown write.' : 'Returning the stored receipt; no new remote request was made.' };
      }
      if (writing && Object.keys(ledger.submissions).length >= 1000) throw new Error('Learning receipt capacity reached; preserve/export the ledger before rotating');
      this.checkEvidence(operation, input, ledger);
      // A capability read neither invokes a model nor proves successful extraction. Unknown/disabled is never auto-enabled.
      if (['generate_experience', 'generate_skill', 'dream'].includes(operation)) {
        const caps = await this.call(cfg, scopeKey, 'capabilities', {}, undefined, signal);
        const feature = operation === 'dream' ? 'artifact_dreaming' : operation === 'generate_skill' ? 'managed_skill_generation' : 'experience_generation';
        if (caps[feature] !== true) throw new Error(`Memory service capability ${feature} is disabled or unknown`);
      }
      const eventId = writing ? `mc-${hash(scopeKey + ':' + operation + ':' + requestId)}` : undefined;
      if (writing) {
        ledger.submissions[hash(requestId)] = { operation, digest, state: 'unverified', at: new Date().toISOString(),
          ...(input.source_refs || input.artifact_refs ? { evidence: { source_refs: input.source_refs ?? [], artifact_refs: input.artifact_refs ?? [], target: input.target ?? null } } : {}),
          ...(['capture_source', 'record_outcome'].includes(operation) ? { source: { name: 'content', source_id: eventId } } : {}),
          ...(operation === 'dream' ? { runKey: eventId } : {}) };
      }
      this.save(path, ledger); // Persist binding and dispatch uncertainty BEFORE any mutating HTTP request.
      try {
        const raw = await this.call(cfg, scopeKey, operation, input, eventId, signal);
        const result = this.normalize(operation, raw, input, ledger, cfg, eventId);
        bounds(result);
        if (writing) { ledger.submissions[hash(requestId)].state = 'confirmed'; ledger.submissions[hash(requestId)].receipt = result; }
        this.save(path, ledger);
        return { ...envelope, status: 'confirmed', ...(writing ? { requestId, automaticRetry: false } : {}), result };
      } catch (error) {
        if (!writing) throw error;
        // The file already says unverified, including after process loss, cancellation, bad replies or a lost response.
        return { ...envelope, status: 'unverified', requestId, automaticRetry: false, result: null,
          reason: error instanceof Error && /^(Memory (service|request)|Learning result|Invalid learning response)/.test(error.message)
            ? error.message : 'Learning response could not be validated or its receipt persisted',
          recovery: ledger.submissions[hash(requestId)].source ?? { operation: operation === 'dream' ? 'dreams' : 'candidates', runKey: eventId ?? null } };
      }
    });
  }

  private read(path: string, scopeKey: string): Ledger {
    if (!existsSync(path)) return { version: 1, scopeKey, refs: [], candidates: {}, submissions: {} };
    const bytes = readFileSync(path);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Learning ledger too large; preserved');
    let ledger: Ledger;
    try {
      ledger = JSON.parse(bytes.toString('utf8'));
      if (ledger.version !== 1 || !Array.isArray(ledger.refs) || !ledger.candidates || !ledger.submissions
        || typeof ledger.submissions !== 'object' || Array.isArray(ledger.submissions)) throw new Error();
    } catch { throw new Error('Invalid learning ledger; restore a verified backup, no overwrite'); }
    if (ledger.scopeKey !== scopeKey) throw new Error('This service Scope is already bound to another server/account/agent; select its own existing Scope');
    return ledger;
  }
  private save(path: string, ledger: Ledger) {
    if (ledger.refs.length > 2000 || Object.keys(ledger.candidates).length > 1000) throw new Error('Learning evidence capacity reached; preserve/export before rotating');
    const body = JSON.stringify(ledger);
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Learning ledger capacity reached; no eviction');
    mkdirSync(join(path, '..'), { recursive: true }); const temp = path + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temp, body, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
    finally { rmSync(temp, { force: true }); }
  }
  private rememberRef(ledger: Ledger, value: unknown) {
    const key = referenceKey(value); if (!ledger.refs.includes(key)) ledger.refs.push(key);
  }
  private checkEvidence(operation: LearningOperation, input: Data, ledger: Ledger) {
    const known = (ref: unknown) => {
      if (!ledger.refs.includes(referenceKey(ref))) throw new Error('Evidence must be an exact previously returned Source/Artifact; read it first in this bound Scope');
    };
    const sources = input.source_refs ?? [], artifacts = input.artifact_refs ?? [];
    if (sources.length + artifacts.length > 32) throw new Error('At most 32 combined evidence references');
    if (new Set([...sources, ...artifacts].map(referenceKey)).size !== sources.length + artifacts.length) throw new Error('Duplicate references are not independent evidence');
    [...sources, ...artifacts].forEach(known); if (input.target) known(input.target);
    if (['propose_experience', 'generate_experience', 'generate_skill', 'revise_experience'].includes(operation) && !sources.length && !artifacts.length)
      throw new Error('Select real evidence before organizing experience');
    if (['propose_experience', 'generate_experience', 'revise_experience'].includes(operation) && input.target && input.target.family !== 'experience')
      throw new Error('Experience replacement target must be an exact Experience revision');
    if (operation === 'record_outcome') {
      for (const claim of [...input.observations, ...input.checks]) {
        if (claim.basis === 'verified' ? !claim.evidence.length : claim.evidence.length !== 0) throw new Error('verified requires prior exact citations; declared uses empty evidence');
        claim.evidence.forEach((c: Data) => known(c.kind === 'source' ? c.source_ref : c.artifact_ref));
      }
      input.produced_artifacts.forEach(known);
    }
    if (operation === 'generate_skill') {
      if (input.origin === 'experience' && (sources.length || !artifacts.length || artifacts.some((r: Data) => r.family !== 'experience') || input.target))
        throw new Error('Skill generation from experience requires only reviewed Experience artifacts and no target');
      if (input.origin === 'usage' && (!sources.length || input.target?.family !== 'skill')) throw new Error('Skill improvement requires actual usage Sources and an exact existing Skill target');
    }
    if (operation === 'dream') {
      if (artifacts.some((r: Data) => !['experience', ...(input.operation === 'refine_experience' ? ['atomic-memory'] : [])].includes(r.family)))
        throw new Error('Dream artifacts must be Experience; only refinement also accepts Atomic Memory');
      if (input.target && (input.operation !== 'refine_experience' || input.target.family !== 'experience')) throw new Error('Only Experience refinement accepts an exact Experience target');
    }
    if (operation === 'revise_experience') {
      const head = ledger.candidates[hash(input.candidate_id)];
      if (!head || head.version !== input.expected_version || head.status !== 'pending' || head.family !== 'experience')
        throw new Error('Read the pending Experience candidate at expected_version before revising; never refresh just the version');
    }
  }

  private async call(cfg: GameMemoryConfig, namespace: string, operation: LearningOperation, input: Data, eventId?: string, signal?: AbortSignal): Promise<Data> {
    if (cfg.provider === 'http') {
      const { data } = await memoryRequest(this.request, cfg, `/learning/${operation}`, {
        protocol: 'agent-mc-learning/v1', namespace, ...(eventId ? { request_id: eventId } : {}), input,
      }, signal);
      if (data.protocol !== 'agent-mc-learning/v1' || data.namespace !== namespace || !data.result || typeof data.result !== 'object' || Array.isArray(data.result))
        throw new Error('Invalid learning response from bridge');
      return data.result as Data;
    }
    const scope = `/v1/scopes/${enc(cfg.scopeId)}`;
    let path: string, method: 'GET' | 'POST' = 'POST', body: Data = { scope_id: cfg.scopeId, ...input }, query = {};
    switch (operation) {
      case 'capabilities': path = '/v1/capabilities'; method = 'GET'; break;
      case 'prepare': path = '/v1/context/prepare'; body = { ...body, include_code: false, assembly: { format: 'markdown', sections: [
        { family: 'experience', limit: 2 }, { family: 'memory', limit: 4 }, { family: 'topic-memory', limit: 2 },
      ], show: [] } }; break;
      case 'capture_source': path = '/v1/sources/content'; body = { scope_id: cfg.scopeId, source_id: eventId, content: input.content,
        metadata: { origin: 'agent-mc-learning/v1', mc_scope: namespace, attribution: input.attribution, trust: 'untrusted_observation', ...(input.observed_at ? { observed_at: input.observed_at } : {}) } }; break;
      case 'record_outcome': path = '/v1/work/outcomes/record'; body = { scope_id: cfg.scopeId, source_id: eventId,
        outcome: { schema: 'powercontext.task-outcome.v1', trust: 'untrusted_observation', ...input } }; break;
      case 'propose_experience': path = '/v1/experience/propose'; break;
      case 'generate_experience': path = '/v1/experience/generate'; break;
      case 'generate_skill': path = '/v1/skill/generate'; break;
      case 'revise_experience': path = '/v1/artifact-candidates/revise'; break;
      case 'candidates': path = '/v1/artifact-candidates/list'; break;
      case 'candidate': path = '/v1/artifact-candidates/get'; break;
      case 'dream': path = `${scope}/dream`; body = { operation: input.operation, artifacts: input.artifact_refs,
        sources: input.source_refs.map((r: Data) => ({ source_type: r.name, source_id: r.source_id })), idempotency_key: eventId,
        ...(input.target ? { target: input.target } : {}) }; break;
      case 'dream_get': path = `${scope}/dream/${enc(input.run_id)}`; method = 'GET'; break;
      case 'dreams': path = `${scope}/dream`; method = 'GET'; query = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)])); break;
      case 'source': path = `${scope}/sources/${enc(input.source.name)}/${enc(input.source.source_id)}`; method = 'GET'; break;
      case 'artifact': path = `${scope}/artifacts/${enc(input.artifact.family)}/${enc(input.artifact.artifact_id)}/revisions/${input.artifact.revision}`; method = 'GET'; break;
      default: throw new Error('Unsupported learning operation');
    }
    const reply = await memoryRequest(this.request, cfg, path, body, signal, method, query);
    return { ...reply.data, _etag: reply.etag, _requestId: reply.requestId };
  }

  private normalize(operation: LearningOperation, raw: Data, input: Data, ledger: Ledger, cfg: GameMemoryConfig, eventId?: string): Data {
    const invalid = () => { throw new Error('Invalid learning response; no result was promoted to evidence'); };
    const checkScope = () => { if (cfg.provider === 'powercontext' && raw.scope_id !== cfg.scopeId) invalid(); };
    const addRef = (value: unknown, schema: typeof sourceRef | typeof artifactRef) => {
      const result = schema.safeParse(value); if (!result.success) return invalid();
      this.rememberRef(ledger, result.data); return result.data;
    };
    const candidate = (value: unknown, pendingOnly = false, body = true): Data => {
      const parsed = candidateSchema.safeParse(value); if (!parsed.success) return invalid();
      const c = parsed.data;
      if ((pendingOnly && c.status !== 'pending') || (c.status === 'approved' ? !c.result_artifact : c.result_artifact !== null)) return invalid();
      if (c.result_artifact && c.result_artifact.family !== c.family) return invalid();
      // Listing a head is not reading/reviewing its body; only full reads authorize a same-version candidate revision.
      if (body) ledger.candidates[hash(c.candidate_id)] = { version: c.version, status: c.status, family: c.family };
      return body ? c : { candidate_id: c.candidate_id, version: c.version, family: c.family, status: c.status, target: c.target, result_artifact: c.result_artifact };
    };
    switch (operation) {
      case 'capabilities': {
        const extraction = raw.extraction;
        return { memory_extraction: typeof raw.memory_extraction === 'boolean' ? raw.memory_extraction : null,
          experience_generation: typeof raw.experience_generation === 'boolean' ? raw.experience_generation : null,
          managed_skill_generation: typeof raw.managed_skill_generation === 'boolean' ? raw.managed_skill_generation : null,
          artifact_dreaming: typeof raw.artifact_dreaming === 'boolean' ? raw.artifact_dreaming : null,
          extraction: extraction ? { configuration: extraction.configuration, background: extraction.background ? { location: extraction.background.location, state: extraction.background.state, automatic_processing_enabled: extraction.background.automatic_processing_enabled } : null,
            observation: { status: extraction.observation?.status, since: extraction.observation?.since, last_success_at: extraction.observation?.last_success_at,
              last_failure_present: !!extraction.observation?.last_failure } } : null,
          executionVerified: false, clientOperations: Object.keys(LEARNING_INPUTS) };
      }
      case 'prepare': {
        const bytes = typeof raw.content === 'string' ? Buffer.byteLength(raw.content, 'utf8') : 0;
        if (raw.schema !== (cfg.provider === 'powercontext' ? 'powercontext.prepared-context.v1' : 'agent-mc-prepared-context/v1') || !['ready', 'empty'].includes(raw.status) || raw.content_bytes !== bytes
          || bytes > input.max_bytes || (raw.status === 'ready' ? !bytes : bytes !== 0)) return invalid();
        return { schema: raw.schema, status: raw.status, content: raw.content ?? null, content_bytes: bytes, unit: 'utf8-bytes', injected: false };
      }
      case 'capture_source': case 'record_outcome': {
        if ((operation === 'capture_source' ? raw.status !== 'accepted' : raw.kind !== 'task-outcome')
          || raw.source?.source_id !== eventId || !Number.isInteger(raw.position) || raw.position < 1) return invalid();
        return { status: 'source_stored', source: addRef(raw.source, sourceRef), position: raw.position, memoryCreated: false, experiencePublished: false };
      }
      case 'propose_experience': case 'revise_experience': {
        const c = candidate(raw, true);
        if (c.family !== 'experience' || (operation === 'revise_experience' && (c.candidate_id !== input.candidate_id || c.version !== input.expected_version + 1))) return invalid();
        return { candidate: c, requiresHumanReview: true, installed: false };
      }
      case 'generate_experience': case 'generate_skill': {
        if (raw.status === 'no_op' && raw.candidate === null) return { status: 'no_op', candidate: null, installed: false };
        if (raw.status !== 'pending') return invalid();
        const c = candidate(raw.candidate, true);
        if (c.family !== (operation === 'generate_skill' ? 'skill' : 'experience')) return invalid();
        return { status: 'pending', candidate: c, requiresHumanReview: true, installed: false };
      }
      case 'candidate': {
        const c = candidate(raw); if (c.candidate_id !== input.candidate_id) return invalid();
        return { candidate: c, requiresHumanReview: c.status === 'pending', installed: false };
      }
      case 'candidates': {
        if (!Array.isArray(raw.candidates) || raw.candidates.length > input.limit || (raw.next_cursor !== null && typeof raw.next_cursor !== 'string')) return invalid();
        const heads = raw.candidates.map((c: unknown) => candidate(c, false, false));
        if (heads.some((c: Data) => c.family !== input.family || c.status !== input.status)) return invalid();
        return { candidates: heads, next_cursor: raw.next_cursor, bodiesIncluded: false };
      }
      case 'dreams': {
        if (!Array.isArray(raw.runs) || raw.runs.length > input.limit || (raw.next_cursor != null && (typeof raw.next_cursor !== 'string' || raw.next_cursor.length > 4096))) return invalid();
        return { runs: raw.runs.map((run: Data) => this.normalize('dream_get', run, { run_id: run.run_id }, ledger, cfg)), next_cursor: raw.next_cursor ?? null };
      }
      case 'dream': case 'dream_get':
        checkScope();
        if (typeof raw.run_id !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(raw.run_id) || !['queued', 'running', 'succeeded', 'failed'].includes(raw.status)
          || !['refine_experience', 'derive_skill'].includes(raw.operation) || ![null, undefined, 'proposed', 'no_change', 'needs_evidence'].includes(raw.outcome)
          || (operation === 'dream_get' && raw.run_id !== input.run_id) || (operation === 'dream' && raw.operation !== input.operation)) return invalid();
        if (raw.candidate && (typeof raw.candidate.candidate_id !== 'string' || !Number.isInteger(raw.candidate.version) || raw.candidate.version < 1)) return invalid();
        if (raw.input_manifest && (!z.array(artifactRef).max(20).safeParse(raw.input_manifest.artifacts).success
          || !z.array(z.strictObject({ source_type: z.literal('content'), source_id: z.string().min(1).max(256) })).max(32).safeParse(raw.input_manifest.sources).success)) return invalid();
        return { run_id: raw.run_id, operation: raw.operation, status: raw.status, outcome: raw.outcome ?? null,
          candidate: raw.candidate ? { candidate_id: raw.candidate.candidate_id, version: raw.candidate.version } : null,
          requiresHumanReview: raw.outcome === 'proposed', installed: false, errorPresent: !!raw.error,
          inputReferences: raw.input_manifest ? { artifacts: raw.input_manifest.artifacts, sources: raw.input_manifest.sources, incomplete: raw.input_manifest.incomplete } : null,
          requestId: raw._requestId ?? null };
      case 'source':
        checkScope();
        if (raw.source_type !== input.source.name || raw.source_id !== input.source.source_id || !/^sha256:[a-f0-9]{64}$/.test(raw.content_digest ?? '')) return invalid();
        bounds(raw.content); addRef(input.source, sourceRef);
        return { source: input.source, content: raw.content, content_digest: raw.content_digest, position: raw.position };
      case 'artifact':
        checkScope();
        if (raw.family !== input.artifact.family || raw.artifact_id !== input.artifact.artifact_id || raw.revision !== input.artifact.revision
          || !raw.content || typeof raw.content !== 'object' || !/^sha256:[a-f0-9]{64}$/.test(raw.content_digest ?? '')) return invalid();
        bounds(raw.content); addRef(input.artifact, artifactRef);
        return { artifact: input.artifact, content: raw.content, content_digest: raw.content_digest,
          sources: raw.sources ?? [], artifacts: raw.artifacts ?? [], etag: raw._etag ?? null, installed: false };
      default: return invalid();
    }
  }
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, GAME_MEMORY_TOOL, type GameMemoryContext } from '../core/game-memory.ts';
import { GameMemoryService, type GameMemoryConfig } from '../core/game-memory-service.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider: 'powercontext', endpoint: 'https://fixture.invalid', scopeId: 'operator-game-scope', learningEnabled: true };
const ctx: GameMemoryContext = { scope: { realm: 'fixture', account: 'offline:a', agent: 'a' }, dimension: null };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers });
const call = (operation: string, input = {}, requestId?: string) => ({ action: 'service', operation, input, ...(requestId ? { requestId } : {}) });
const artifact = { family: 'experience', artifact_id: 'experience-one', revision: 2 };
const source = { name: 'content', source_id: 'actual-source' };
const sha = 'sha256:' + 'a'.repeat(64);
const proposal = { situation: 'Short dive lacked air.', action: 'Tested a nearby air pocket.', outcome: 'Surfaced and recovered.', lesson: 'Recheck water geometry and oxygen; one short dive does not validate long dives.' };
const candidate = (overrides = {}) => ({ candidate_id: 'candidate-1', version: 1, family: 'experience', status: 'pending', proposal,
  source_refs: [source], artifact_refs: [], target: null, reason: null, result_artifact: null, decision_reason: null, ...overrides });
const artifactReply = (ref = artifact, scope = cfg.scopeId) => ({ scope_id: scope, ...ref, content: { lesson: 'historical' }, sources: [], artifacts: [], content_digest: sha });
const outcome = { objective: 'Dive', status: 'partial', summary: 'Reached air pocket, ship not reached.', observations: [{ text: 'Recovered air', basis: 'declared', evidence: [] }], checks: [], produced_artifacts: [], remaining_work: ['Find cabin'] };
function openApiToJsonSchema(value: any): any {
  if (Array.isArray(value)) return value.map(openApiToJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const { nullable, discriminator: _discriminator, ...rest } = value;
  const schema = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, openApiToJsonSchema(v)]));
  return nullable ? { anyOf: [schema, { type: 'null' }] } : schema;
}
const official = openApiToJsonSchema(JSON.parse(readFileSync(new URL('./fixtures/powercontext-1.3.0-requests.json', import.meta.url), 'utf8')));
const ajv = new Ajv({ strict: false, validateFormats: false });
const contracts: Record<string, string> = {
  '/v1/context/prepare': 'PrepareContextRequest', '/v1/sources/content': 'CaptureContentSourceRequest', '/v1/work/outcomes/record': 'RecordTaskOutcomeRequest',
  '/v1/experience/propose': 'ProposeExperienceRequest', '/v1/experience/generate': 'GenerateExperienceRequest', '/v1/skill/generate': 'GenerateSkillRequest',
  '/v1/artifact-candidates/revise': 'ReviseArtifactCandidateRequest', '/v1/artifact-candidates/list': 'ListArtifactCandidatesRequest', '/v1/artifact-candidates/get': 'GetArtifactCandidateRequest',
  '/v1/scopes/operator-game-scope/dream': 'CreateDreamRunRequest',
};
const validators = Object.fromEntries(Object.entries(contracts).map(([path, name]) => [path, ajv.compile({ ...official, $ref: `#/components/schemas/${name}` })]));
function setup(respond: (url: URL, body: any, init: RequestInit) => Response | Promise<Response>) {
  const directory = mkdtempSync(join(tmpdir(), 'mc-learning-')); dirs.push(directory);
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url)), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const validate = validators[target.pathname];
    if (validate && init?.method === 'POST') { expect(validate(body), JSON.stringify(validate.errors)).toBe(true); }
    return respond(target, body, init!);
  });
  const service = () => new GameMemoryService(new GameMemoryBook(directory), directory, request);
  return { directory, request, service: service(), reopen: service };
}
const result = (value: any) => value.result as any;

it('keeps local notebooks offline and opt-in service help progressively available', async () => {
  const { service, request } = setup(() => { throw new Error('No network'); });
  expect((GAME_MEMORY_TOOL.parameters as any).properties.action.enum).toContain('service');
  expect(await service.execute(call('help', { operation: 'record_outcome' }), ctx)).toMatchObject({ enabled: false, inputSchema: { type: 'object' } });
  await expect(service.execute(call('capabilities'), ctx)).rejects.toThrow('disabled');
  await expect(service.execute(call('capabilities'), ctx, { ...cfg, provider: 'bailian' })).rejects.toThrow('retrieval only');
  await expect(service.execute(call('approve'), ctx, cfg)).rejects.toThrow('not Agent tools');
  expect(request).not.toHaveBeenCalled();
});

it('captures game evidence, records an evidenced outcome and proposes a pending experience through exact native contracts', async () => {
  let returned: any;
  const { service, request, reopen } = setup((url, body, init) => {
    expect(init.redirect).toBe('error'); expect(body.scope_id).toBe(cfg.scopeId);
    if (url.pathname === '/v1/sources/content') {
      expect(body.metadata.trust).toBe('untrusted_observation'); returned = { name: 'content', source_id: body.source_id };
      return json({ status: 'accepted', source: returned, position: 1 }, 202);
    }
    if (url.pathname === '/v1/work/outcomes/record') {
      expect(body.outcome).toMatchObject({ schema: 'powercontext.task-outcome.v1', trust: 'untrusted_observation' });
      expect(body.outcome.observations[0].evidence[0].source_ref).toEqual(returned);
      return json({ kind: 'task-outcome', source: { name: 'content', source_id: body.source_id }, position: 2, content_digest: sha }, 202);
    }
    expect(url.pathname).toBe('/v1/experience/propose');
    return json(candidate({ source_refs: body.source_refs }), 201);
  });
  const captured = await service.execute(call('capture_source', { content: 'task 9 partial, oxygen recovered; ship not reached', attribution: 'agent observation; task 9' }, 'run:one:task:9'), ctx, cfg);
  expect(captured).toMatchObject({ status: 'confirmed', learningVerified: false, result: { status: 'source_stored', memoryCreated: false } });
  const documented = { ...outcome, observations: [{ text: 'Recovered air', basis: 'verified', evidence: [{ kind: 'source', source_ref: returned }] }] };
  expect(await reopen().execute(call('record_outcome', documented, 'task:9:outcome'), ctx, cfg)).toMatchObject({ result: { experiencePublished: false } });
  expect(await service.execute(call('propose_experience', { proposal, source_refs: [returned], artifact_refs: [] }, 'task:9:lesson:1'), ctx, cfg))
    .toMatchObject({ result: { requiresHumanReview: true, installed: false, candidate: { status: 'pending', version: 1 } } });
  expect(request).toHaveBeenCalledTimes(3);
});

it('retains bounded PreparedContext and exact citations without automatic injection or fake token counts', async () => {
  const content = '历史经验 [experience/experience-one@2]：需复核水流。';
  const { service } = setup((url, body) => {
    expect(url.pathname).toBe('/v1/context/prepare');
    expect(body).toMatchObject({ max_bytes: 512, include_code: false });
    expect(body.assembly.sections).toEqual([{ family: 'experience', limit: 2 }, { family: 'memory', limit: 4 }, { family: 'topic-memory', limit: 2 }]);
    return json({ schema: 'powercontext.prepared-context.v1', status: 'ready', content, content_bytes: Buffer.byteLength(content) });
  });
  expect(await service.execute(call('prepare', { query: 'Diving', max_bytes: 512 }), ctx, cfg))
    .toMatchObject({ authority: 'untrusted-historical-data', automaticInjection: false, result: { content, injected: false, unit: 'utf8-bytes' } });
  const bad = setup(() => json({ schema: 'powercontext.prepared-context.v1', status: 'ready', content, content_bytes: content.length }));
  await expect(bad.service.execute(call('prepare', { query: 'water' }), ctx, cfg)).rejects.toThrow('Invalid learning response');
});

it('blocks invented/self evidence, duplicate samples, injected scopes, unbound accounts and incorrect targets before a write', async () => {
  const { service, request } = setup(() => json(artifactReply()));
  await expect(service.execute(call('record_outcome', { ...outcome, observations: [{ text: 'Success', basis: 'verified', evidence: [] }] }, 'bad1'), ctx, cfg)).rejects.toThrow('prior exact');
  await expect(service.execute(call('propose_experience', { proposal, source_refs: [source], artifact_refs: [] }, 'bad2'), ctx, cfg)).rejects.toThrow('read it first');
  await expect(service.execute(call('prepare', { query: 'x', scope_id: 'foreign' }), ctx, cfg)).rejects.toThrow('Invalid prepare');
  await expect(service.execute(call('artifact', { artifact: { ...artifact, artifact_id: '..' } }), ctx, cfg)).rejects.toThrow('Invalid artifact');
  expect(request).not.toHaveBeenCalled();
  await service.execute(call('artifact', { artifact }), ctx, cfg);
  await expect(service.execute(call('dream', { operation: 'derive_skill', artifact_refs: [artifact, artifact] }, 'bad3'), ctx, cfg)).rejects.toThrow('Duplicate');
  await expect(service.execute(call('capabilities'), { ...ctx, scope: { ...ctx.scope, agent: 'other' } }, cfg)).rejects.toThrow('another server/account/agent');
  expect(request).toHaveBeenCalledTimes(1);
});

it('journals unknown writes before dispatch, rejects changed replays and preserves the ledger across cancellation/restart', async () => {
  vi.stubEnv('MEMORY_FIXTURE_KEY', 'private-fixture-key');
  const { service, request, reopen } = setup((_url, _body, init) => {
    expect((init.headers as any).Authorization).toBe('Bearer private-fixture-key');
    return json({ secret: 'private-fixture-key, internal trace' }, 503, { 'X-PowerContext-Request-ID': 'trace-1' });
  });
  const args = call('capture_source', { content: 'actual failure', attribution: 'task 1' }, '__proto__');
  expect(await service.execute(args, ctx, { ...cfg, apiKeyEnv: 'MEMORY_FIXTURE_KEY' }))
    .toMatchObject({ status: 'unverified', automaticRetry: false, reason: 'Memory service HTTP 503; request trace-1' });
  expect(await reopen().execute(args, ctx, cfg)).toMatchObject({ status: 'unverified', replayed: false });
  await expect(service.execute({ ...args, input: { ...args.input, content: 'changed' } }, ctx, cfg)).rejects.toThrow('different input');
  expect(await service.execute(call('operation', { request_id: '__proto__' }), ctx, cfg)).toMatchObject({ submission: { state: 'unverified' } });
  expect(request).toHaveBeenCalledTimes(1);
  const cancelled = setup((_url, _body, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('private')))));
  const abort = new AbortController();
  const pending = cancelled.service.execute(args, ctx, cfg, abort.signal);
  await vi.waitFor(() => expect(cancelled.request).toHaveBeenCalledTimes(1)); abort.abort();
  expect(await pending).toMatchObject({ status: 'unverified' });
  expect(await cancelled.reopen().execute(args, ctx, cfg)).toMatchObject({ status: 'unverified', replayed: false });
  expect(cancelled.request).toHaveBeenCalledTimes(1);
});

it('requires enabled capabilities, keeps generated no-op and queued Dream separate from a reviewed result', async () => {
  let dreamKey: string;
  const { service, request } = setup((url, body) => {
    if (url.pathname.includes('/artifacts/')) return json(artifactReply(), 200, { ETag: '"revision-2"' });
    if (url.pathname === '/v1/capabilities') return json({ experience_generation: true, managed_skill_generation: true, artifact_dreaming: true });
    if (url.pathname === '/v1/experience/generate') return json({ status: 'no_op', candidate: null });
    if (url.pathname === '/v1/skill/generate') return json({ status: 'pending', candidate: candidate({ family: 'skill', source_refs: [], artifact_refs: [artifact] }) });
    if (url.pathname.endsWith('/dream')) { dreamKey = body.idempotency_key; return json({ scope_id: cfg.scopeId, run_id: 'dream-1', operation: body.operation, status: 'queued', outcome: null, candidate: null }, 202); }
    expect(url.pathname).toBe('/v1/scopes/operator-game-scope/dream/dream-1');
    return json({ scope_id: cfg.scopeId, run_id: 'dream-1', operation: 'derive_skill', status: 'succeeded', outcome: 'needs_evidence', candidate: null });
  });
  const read = result(await service.execute(call('artifact', { artifact }), ctx, cfg)); expect(read.etag).toBe('"revision-2"');
  expect(await service.execute(call('generate_experience', { source_refs: [], artifact_refs: [artifact] }, 'generate-1'), ctx, cfg)).toMatchObject({ result: { status: 'no_op', candidate: null } });
  expect(await service.execute(call('generate_skill', { origin: 'experience', source_refs: [], artifact_refs: [artifact] }, 'skill-1'), ctx, cfg)).toMatchObject({ result: { requiresHumanReview: true, installed: false } });
  const dream = call('dream', { operation: 'derive_skill', artifact_refs: [artifact] }, 'dream-1');
  expect(await service.execute(dream, ctx, cfg)).toMatchObject({ result: { status: 'queued', outcome: null } });
  expect(dreamKey!).toMatch(/^mc-[a-f0-9]{64}$/);
  const before = request.mock.calls.length;
  await service.execute(dream, ctx, cfg); expect(request).toHaveBeenCalledTimes(before);
  expect(await service.execute(call('dream_get', { run_id: 'dream-1' }), ctx, cfg)).toMatchObject({ result: { status: 'succeeded', outcome: 'needs_evidence', installed: false } });
  const disabled = setup(url => url.pathname.includes('/artifacts/') ? json(artifactReply()) : json({ artifact_dreaming: false }));
  await disabled.service.execute(call('artifact', { artifact }), ctx, cfg);
  await expect(disabled.service.execute(dream, ctx, cfg)).rejects.toThrow('disabled or unknown');
  expect(disabled.request).toHaveBeenCalledTimes(2);
});

it('lists compact candidate heads, requires full body/version before revision and never self-approves', async () => {
  const { service, request } = setup((url, body) => {
    if (url.pathname.includes('/artifacts/')) return json(artifactReply());
    if (url.pathname.endsWith('/list')) return json({ candidates: [candidate({ source_refs: [], artifact_refs: [artifact] })], next_cursor: null });
    if (url.pathname.endsWith('/get')) return json(candidate({ source_refs: [], artifact_refs: [artifact] }));
    expect(url.pathname).toBe('/v1/artifact-candidates/revise'); expect(body.expected_version).toBe(1);
    return json(candidate({ version: 2, proposal: body.proposal, source_refs: [], artifact_refs: [artifact] }));
  });
  await service.execute(call('artifact', { artifact }), ctx, cfg);
  const heads = result(await service.execute(call('candidates'), ctx, cfg)); expect(heads.candidates[0].proposal).toBeUndefined();
  const revise = call('revise_experience', { candidate_id: 'candidate-1', expected_version: 1, proposal, source_refs: [], artifact_refs: [artifact] }, 'revise:1');
  await expect(service.execute(revise, ctx, cfg)).rejects.toThrow('Read the pending');
  await service.execute(call('candidate', { candidate_id: 'candidate-1' }), ctx, cfg);
  expect(await service.execute(revise, ctx, cfg)).toMatchObject({ result: { candidate: { version: 2, status: 'pending' } } });
  const before = request.mock.calls.length;
  expect(await service.execute(revise, ctx, cfg)).toMatchObject({ replayed: false, result: { candidate: { version: 2 } } });
  expect(request).toHaveBeenCalledTimes(before);
  expect(request.mock.calls.map(([url]) => String(url)).join('\n')).not.toMatch(/approve|install|flush/);
});

it('recovers unknown Dream submissions through bounded read-only run listings and exact input references', async () => {
  const { service } = setup((url, _body, init) => {
    expect(init.method).toBe('GET'); expect(url.pathname).toBe('/v1/scopes/operator-game-scope/dream');
    expect(url.searchParams.get('limit')).toBe('2');
    return json({ runs: [{ scope_id: cfg.scopeId, run_id: 'accepted-run', operation: 'derive_skill', status: 'running', outcome: null,
      input_manifest: { artifacts: [artifact], sources: [], incomplete: false } }], next_cursor: null });
  });
  expect(await service.execute(call('dreams', { limit: 2 }), ctx, cfg)).toMatchObject({ result: { runs: [{ run_id: 'accepted-run', inputReferences: { artifacts: [artifact] } }] } });
});

it('supports a namespace-bound generic bridge without pretending every cloud vendor has learning APIs', async () => {
  const { service } = setup((url, body) => {
    expect(url.pathname).toBe('/learning/capabilities'); expect(body.protocol).toBe('agent-mc-learning/v1'); expect(body.namespace).toMatch(/^[a-f0-9]{64}$/);
    return json({ protocol: body.protocol, namespace: body.namespace, result: { experience_generation: true } });
  });
  expect(await service.execute(call('capabilities'), ctx, { ...cfg, provider: 'http' })).toMatchObject({ result: { experience_generation: true, artifact_dreaming: null } });
  const wrong = setup(() => json({ protocol: 'agent-mc-learning/v1', namespace: 'wrong', result: {} }));
  await expect(wrong.service.execute(call('capabilities'), ctx, { ...cfg, provider: 'http' })).rejects.toThrow('Invalid learning response');
});

it('rejects foreign or mismatched artifact responses and cannot use a pending candidate as verified evidence', async () => {
  const { service, request } = setup(() => json(artifactReply(artifact, 'foreign')));
  await expect(service.execute(call('artifact', { artifact }), ctx, cfg)).rejects.toThrow('Invalid learning response');
  await expect(service.execute(call('dream', { operation: 'derive_skill', artifact_refs: [artifact] }, 'dream-1'), ctx, cfg)).rejects.toThrow('read it first');
  expect(request).toHaveBeenCalledTimes(1);
});

it('rejects a newly generated candidate that bypasses human review, retaining an unknown receipt rather than promoting it', async () => {
  const { service } = setup(url => url.pathname.includes('/artifacts/') ? json(artifactReply())
    : json(candidate({ status: 'approved', result_artifact: artifact, source_refs: [], artifact_refs: [artifact] })));
  await service.execute(call('artifact', { artifact }), ctx, cfg);
  expect(await service.execute(call('propose_experience', { proposal, source_refs: [], artifact_refs: [artifact] }, 'bad-approval'), ctx, cfg))
    .toMatchObject({ status: 'unverified', result: null, automaticRetry: false });
});

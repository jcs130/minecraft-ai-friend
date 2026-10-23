import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';

const identifier = { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9_.:/+-]+$' };
const count = { type: 'integer', minimum: 0 };
const duration = { type: 'number', minimum: 0 };
const handle = { type: 'string', pattern: '^log:[a-f0-9]{64}$' };
export const traceSchema = { type: 'object', additionalProperties: false, required: ['kind', 'id'],
  properties: { kind: { enum: ['model', 'method'] }, id: identifier, phase: { enum: ['start', 'finish'] },
    role: { enum: ['system1', 'system2', 'background'] }, model: identifier, effort: { enum: ['none', 'low', 'medium', 'high', 'xhigh', 'default'] },
    outcome: { enum: ['success', 'failed', 'cancelled', 'unknown'] }, elapsedMs: duration, ttftMs: duration,
    inputTokens: count, outputTokens: count, cachedTokens: count, reasoningTokens: count,
    stage: { enum: ['authored', 'revised', 'validated', 'executed', 'evaluated', 'reused', 'reverted'] },
    method: identifier, author: identifier, parentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, artifact: handle, receipt: handle, executionId: identifier },
  allOf: [
    { if: { properties: { kind: { const: 'model' } } }, then: { required: ['phase', 'role', 'model'] } },
    { if: { properties: { kind: { const: 'method' } } }, then: { required: ['stage', 'method', 'author', 'sourceHash', 'artifact'] } },
  ] };
export interface HarnessTrace {
  kind: 'model' | 'method'; id: string; phase?: 'start' | 'finish'; role?: 'system1' | 'system2' | 'background';
  model?: string; effort?: string; outcome?: 'success' | 'failed' | 'cancelled' | 'unknown';
  elapsedMs?: number; ttftMs?: number; inputTokens?: number; outputTokens?: number; cachedTokens?: number; reasoningTokens?: number;
  stage?: string; method?: string; author?: string; sourceHash?: string; parentHash?: string;
  artifact?: string; receipt?: string; executionId?: string;
}
type ModelRecord = HarnessTrace & { at: number; startedAt?: number; endedAt?: number };
type ToolRecord = { id: string; name: string; at: number; endedAt?: number; failed?: boolean };
const WINDOW = 600_000;
function distribution(values: number[]) {
  values.sort((a, b) => a - b);
  const percentile = (p: number) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  return { samples: values.length, p50: percentile(.5), p95: percentile(.95) };
}

/** Metadata only. Host reports remain attributed reports, never environment verification or memories. */
export class AgentMetrics {
  private readonly startedAt: number;
  private readonly models = new Map<string, ModelRecord>();
  private readonly tools = new Map<string, ToolRecord>();
  private readonly methods = new Map<string, HarnessTrace & { at: number }>();
  private truncatedUntil = 0;
  private readonly validate = new Ajv({ strict: false, strictNumbers: true }).compile<HarnessTrace>(traceSchema);
  constructor(readonly run: string, private readonly dataDir: string,
    private readonly hasArtifact: (handle: string) => boolean, private readonly now = Date.now,
    private readonly limit = 2048) { this.startedAt = now(); }

  report(input: unknown): void {
    if (!this.validate(input)) throw new Error('Invalid metadata trace; use only declared fields and opaque identifiers.');
    const trace = structuredClone(input) as HarnessTrace;
    if (trace.cachedTokens !== undefined && trace.inputTokens !== undefined && trace.cachedTokens > trace.inputTokens)
      throw new Error('cachedTokens exceeds inputTokens.');
    if (trace.reasoningTokens !== undefined && trace.outputTokens !== undefined && trace.reasoningTokens > trace.outputTokens)
      throw new Error('reasoningTokens must be included in outputTokens.');
    const at = this.now();
    if (trace.kind === 'model') {
      const previous = this.models.get(trace.id);
      if (previous && (previous.role !== trace.role || previous.model !== trace.model)) throw new Error('Trace id belongs to another model request.');
      if (previous?.endedAt !== undefined) throw new Error('Model trace is already terminal.');
      if (trace.phase === 'start' && previous) throw new Error('Duplicate model start.');
      this.models.set(trace.id, { ...previous, ...trace, at: previous?.at ?? at,
        startedAt: trace.phase === 'start' ? at : previous?.startedAt,
        endedAt: trace.phase === 'finish' ? at : undefined });
    } else {
      if (this.methods.has(trace.id)) throw new Error('Duplicate method trace id.');
      if (!this.hasArtifact(trace.artifact!) || (trace.receipt && !this.hasArtifact(trace.receipt)))
        throw new Error('Method trace references an unavailable execution artifact.');
      this.methods.set(trace.id, { ...trace, at });
    }
    appendFileSync(join(this.dataDir, `traces-${this.run}.jsonl`), JSON.stringify({ at, run: this.run, source: 'host-reported', ...trace }) + '\n');
    this.prune();
  }

  toolStarted(id: string, name: string) { this.tools.set(id, { id, name, at: this.now() }); this.prune(); }
  toolEnded(id: string, failed: boolean) {
    const tool = this.tools.get(id);
    if (tool) Object.assign(tool, { endedAt: this.now(), failed });
  }
  private prune() {
    const now = this.now();
    for (const records of [this.models, this.tools, this.methods]) {
      for (const [id, record] of records) {
        const terminalAt = 'endedAt' in record ? record.endedAt : 'kind' in record && record.kind === 'method' ? record.at : undefined;
        if (terminalAt !== undefined && terminalAt < now - WINDOW) records.delete(id);
      }
      while (records.size > this.limit) {
        records.delete(records.keys().next().value!); this.truncatedUntil = now + WINDOW;
      }
    }
  }
  snapshot(phase: string) {
    this.prune();
    const now = this.now();
    const tools = [...this.tools.values()], endedTools = tools.filter(tool => tool.endedAt !== undefined);
    const models = [...this.models.values()], methods = [...this.methods.values()];
    return { schema: 'agent-harness-metrics-v1', time: now / 1000, run: this.run, phase,
      window: { seconds: 600, coveredSeconds: Math.min(600, (now - this.startedAt) / 1000), complete: now - this.startedAt >= WINDOW && now >= this.truncatedUntil },
      tools: { source: 'runtime-measured', calls: tools.filter(tool => tool.at >= now - WINDOW).length, returned: endedTools.length,
        errors: endedTools.filter(tool => tool.failed).length, active: tools.filter(tool => tool.endedAt === undefined).length,
        elapsedMs: distribution(endedTools.map(tool => tool.endedAt! - tool.at)) },
      models: ['system1', 'system2', 'background'].map(role => {
        const selected = models.filter(model => model.role === role), ended = selected.filter(model => model.endedAt !== undefined);
        const total = (key: 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'reasoningTokens') => ({
          samples: ended.filter(model => model[key] !== undefined).length,
          total: ended.length && ended.every(model => model[key] !== undefined) ? ended.reduce((sum, model) => sum + model[key]!, 0) : null,
        });
        const paired = ended.filter(model => model.inputTokens !== undefined && model.cachedTokens !== undefined);
        const input = paired.reduce((sum, model) => sum + model.inputTokens!, 0);
        return { role, source: 'host-reported', calls: selected.filter(model => model.at >= now - WINDOW).length, completed: ended.length,
          active: selected.filter(model => model.endedAt === undefined).length,
          failed: ended.filter(model => model.outcome === 'failed').length, cancelled: ended.filter(model => model.outcome === 'cancelled').length,
          elapsedMs: distribution(ended.flatMap(model => model.elapsedMs === undefined ? [] : [model.elapsedMs])),
          ttftMs: distribution(ended.flatMap(model => model.ttftMs === undefined ? [] : [model.ttftMs])),
          inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), reasoningTokens: total('reasoningTokens'), cachedTokens: total('cachedTokens'),
          cacheSamples: paired.length, cacheRatio: input ? paired.reduce((sum, model) => sum + model.cachedTokens!, 0) / input : null,
          last: selected.at(-1) ?? null };
      }),
      learning: { source: 'host-reported', reportedEvents: methods.length,
        stages: Object.fromEntries(['authored', 'revised', 'validated', 'executed', 'evaluated', 'reused', 'reverted'].map(stage => [stage, methods.filter(method => method.stage === stage).length])),
        latest: methods.slice(-12), environmentVerifiedImprovement: null },
    };
  }
}

/** Local, read-only metrics transport. It cannot connect, reload or operate a game. */
export async function serveAgentMetrics(port: number, snapshot: () => unknown) {
  const server = createServer((request, response) => {
    const address = server.address();
    const expected = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    if (request.headers.host !== expected || request.headers.origin && request.headers.origin !== `http://${expected}`) {
      response.writeHead(403).end(); return;
    }
    if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }).end(); return; }
    if (request.url !== '/api/harness/metrics') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(snapshot()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/api/harness/metrics`, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}

import { Ajv } from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
  type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { BlobRef, ToolOutcome } from '../client/contracts.ts';
import type { MinecraftAgentClient } from '../client/runtime.ts';
import { traceSchema } from '../client/metrics.ts';
import { randomUUID } from 'node:crypto';
import { PROTOCOL, requireProtocol, type ArchiveQuery } from '../contracts/protocol.ts';

const protocolSpec: Tool = {
  name: 'mc_protocol', description: 'Versioned host protocol: explicitly begin/end a real decision turn, cancel a request, query execution state, replace current facts, read original archives, or budget request context. Tool RPC completion does not end a turn. Execution completion does not complete your goal.',
  inputSchema: { type: 'object', properties: {
    protocol: { type: 'string', const: PROTOCOL },
    action: { enum: ['begin_turn', 'end_turn', 'ack_barrier', 'cancel', 'task', 'facts', 'archive', 'archive_runs', 'prepare_context'] },
    id: { type: 'string', minLength: 1, maxLength: 256 }, kind: { enum: ['task', 'method', 'observation'] },
    run: { type: 'string' }, after: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 256 },
    type: { type: 'string' }, keyword: { type: 'string' }, history: { type: 'string' },
    contextTokens: { type: 'integer', minimum: 1 }, reservedOutputTokens: { type: 'integer', minimum: 0 },
  }, required: ['protocol', 'action'], additionalProperties: false },
};

const connectionSpec: Tool = {
  name: 'mc_connection', description: 'Connect, inspect or disconnect this Agent\'s Minecraft runtime. '
    + 'Connecting starts the engine; check status lamps and actual game events for authentication and connection. '
    + 'Tool discovery does not connect. A disconnect stops this runtime\'s actions.',
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['connect', 'status', 'disconnect', 'environment'] } },
    required: ['action'], additionalProperties: false },
};
const eventsSpec: Tool = {
  name: 'mc_events', description: 'Read bounded Minecraft events after a cursor: chat, announcements, task completion, '
    + 'damage and observed state. Poll while an accepted action is running; acceptance alone is not completion. '
    + 'Use the returned run and nextCursor on the next read. A gap means some events have left the recent buffer. '
    + 'Archived events are excluded unless explicitly requested. Reading does not prove the Agent has acted on a message.',
  inputSchema: { type: 'object', properties: {
    after: { type: 'integer', minimum: 0 }, run: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 256 },
    waitMs: { type: 'integer', minimum: 0, maximum: 30000 }, includeArchived: { type: 'boolean' },
  }, additionalProperties: false }, annotations: { readOnlyHint: true },
};
const artifactSpec: Tool = {
  name: 'mc_artifact', description: 'Put a UTF-8 execution artifact or read a receipt by its log: handle. '
    + 'An explicitly selected procedure artifact can be passed to mc_script; its schema, revision and dependencies '
    + 'are checked by the existing executor. This stores execution data, without creating or adopting Agent memories.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['put', 'get'] }, handle: { type: 'string' },
    text: { type: 'string', maxLength: 64000 }, mime: { type: 'string', enum: ['application/json', 'text/plain'] },
  }, required: ['action'], additionalProperties: false },
};
const metricsSpec: Tool = { name: 'mc_metrics', description: 'Read runtime-measured tool return latency and explicitly host-reported model/method metadata. Tool returns are not game task completion. No intelligence score or verified learning is inferred.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } };
const traceSpec: Tool = { name: 'mc_trace', description: 'Optional HOST instrumentation: report measured model request metadata or an attributed method lifecycle event linked to saved artifacts. Do not invent token counts, timings, authorship or improvement. Stores metadata, not Agent memory. Each transport attempt uses a unique id.',
  inputSchema: traceSchema as Tool['inputSchema'] };

export function createMinecraftMcpServer(runtime: MinecraftAgentClient, version: string): Server {
  const prefix = runtime.toolPrefix;
  const translate = (text: string) => text.replaceAll('mc_', prefix + '_');
  const [connection, events, artifact, metrics, trace, protocol] = [connectionSpec, eventsSpec, artifactSpec, metricsSpec, traceSpec, protocolSpec]
    .map(tool => ({ ...tool, name: translate(tool.name), description: translate(tool.description ?? '') }));
  const server = new Server({ name: `minecraft-agent-${runtime.profile}`, version }, {
    capabilities: { tools: {}, resources: {} },
    instructions: translate('This server supplies Minecraft observation and execution. You own goals, memory, reasoning and wakeups. '
      + 'Read mc_connection action:environment, connect explicitly, and consume mc_events while tasks execute. '
      + 'Use mc_help and mc_script api:index for progressive tool and native Mineflayer documentation. '
      + 'Keep measured world facts and actual execution receipts separate from hypotheses and goal-success judgments.'),
  });
  const session = randomUUID();
  const tools: Tool[] = [connection, events, artifact, metrics, trace, protocol, ...runtime.tools().map(tool => ({
    name: tool.name, description: tool.description, inputSchema: tool.parameters as Tool['inputSchema'],
    annotations: { readOnlyHint: tool.tags.includes('read') && !tool.tags.some(tag => ['write', 'act', 'speak'].includes(tag)) },
    _meta: { [PROTOCOL]: { tags: tool.tags, barrierAfter: tool.barrierAfter === true,
      endsTurn: tool.endsTurn === true, interruptible: tool.interruptible !== false } },
  }))];
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validators = new Map(tools.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));

  const contents = (refs: readonly BlobRef[]): CallToolResult['content'] => refs.flatMap<CallToolResult['content'][number]>(ref => {
    const saved = runtime.journal.blob(ref.handle);
    if (saved && saved.mime.startsWith('image/')) return [{ type: 'image' as const,
      mimeType: saved.mime, data: Buffer.from(saved.bytes).toString('base64') }];
    return [{ type: 'resource_link' as const, uri: `${prefix}-artifact://${ref.handle.slice(4)}`,
      name: ref.name ?? ref.handle, mimeType: ref.mime, description: ref.fallbackText }];
  });
  const outcome = (result: ToolOutcome): CallToolResult => ({
    content: [{ type: 'text', text: result.text }, ...contents(runtime.journal.saveBlobs(result.blobs))],
    structuredContent: { ...result, protocol: PROTOCOL, text: result.text, failed: result.failed === true,
      endsTurn: result.endsTurn === true, control: result.control ?? null, execution: result.execution ?? null,
      events: result.events ?? [], blobs: runtime.journal.saveBlobs(result.blobs) },
    ...(result.failed ? { isError: true } : {}),
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    try {
      const validate = validators.get(name);
      if (!validate) throw new Error(`Unknown tool: ${name}`);
      if (!validate(args)) throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors)}`);
      if (extra.signal.aborted) throw new Error('Request cancelled before submission.');
      if (name === protocol.name) {
        requireProtocol(String(args.protocol));
        const id = () => { if (typeof args.id !== 'string' || !args.id) throw new Error('id is required'); return args.id; };
        let result: unknown;
        switch (args.action) {
          case 'begin_turn': result = runtime.beginTurn(id()); break;
          case 'end_turn': result = await runtime.endTurn(id()); break;
          case 'ack_barrier': runtime.acknowledgeBarrier(id()); result = { acknowledged: true }; break;
          case 'cancel': result = runtime.cancel(id()); break;
          case 'task': {
            if (!['task', 'method', 'observation'].includes(String(args.kind))) throw new Error('kind is required');
            result = runtime.task(args.kind as 'task' | 'method' | 'observation', id()); break;
          }
          case 'facts': result = runtime.currentFacts(); break;
          case 'archive_runs': result = runtime.journal.archiveRuns(); break;
          case 'archive': result = await runtime.journal.archive(args as ArchiveQuery); break;
          case 'prepare_context': result = await runtime.prepareContext({ contextTokens: Number(args.contextTokens),
            reservedOutputTokens: Number(args.reservedOutputTokens) }, String(args.history ?? ''), undefined,
            tools.map(tool => ({ name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema }))); break;
        }
        return outcome({ text: JSON.stringify(result) });
      }
      if (name === metrics.name) return outcome({ text: JSON.stringify(runtime.metrics.snapshot(runtime.status().phase)) });
      if (name === trace.name) {
        runtime.metrics.report(args);
        return outcome({ text: JSON.stringify({ recorded: true, source: 'host-reported', run: runtime.journal.run }) });
      }
      if (name === connection.name) {
        if (args.action === 'connect') await runtime.connect();
        else if (args.action === 'disconnect') await runtime.disconnect();
        else if (args.action === 'environment') return outcome({ text: await runtime.environment() });
        return outcome({ text: JSON.stringify(runtime.status()) });
      }
      if (name === events.name) {
        return outcome({ text: JSON.stringify(await runtime.events(args, extra.signal)) });
      }
      if (name === artifact.name) {
        if (args.action === 'put') {
          if (typeof args.text !== 'string') throw new Error('put requires text.');
          const [ref] = runtime.journal.saveBlobs([{ bytes: Buffer.from(args.text), mime: String(args.mime ?? 'application/json'),
            fallbackText: 'Agent-provided execution artifact; not evidence of successful execution.' }]);
          return outcome({ text: JSON.stringify(ref) });
        }
        if (typeof args.handle !== 'string') throw new Error('get requires handle.');
        const saved = runtime.journal.blob(args.handle);
        if (!saved) throw new Error('Execution artifact not found.');
        if (saved.mime === 'application/json' || saved.mime.startsWith('text/'))
          return outcome({ text: Buffer.from(saved.bytes).toString('utf8') });
        return outcome({ text: args.handle, blobs: [{ handle: args.handle, fallbackText: 'Execution artifact' }] });
      }
      if (Object.keys(request.params._meta ?? {}).some(key => key.startsWith('agent-mc/') && key !== PROTOCOL)) throw new Error('Unsupported call protocol version');
      const metadata = request.params._meta?.[PROTOCOL] as { requestId?: string; turnId?: string } | undefined;
      if (metadata && (typeof metadata !== 'object' || (metadata.requestId !== undefined && typeof metadata.requestId !== 'string')
        || (metadata.turnId !== undefined && typeof metadata.turnId !== 'string'))) throw new Error('Invalid protocol call metadata');
      return outcome(await runtime.call(name, args, { requestId: metadata?.requestId ?? `${session}:${extra.requestId}`,
        turnId: metadata?.turnId, signal: extra.signal }));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{
    uri: `${prefix}://environment`, name: 'Minecraft environment and tool guide index', mimeType: 'text/plain',
  }, { uri: `${prefix}://status`, name: 'Game runtime status', mimeType: 'application/json' },
  { uri: `${prefix}://metrics`, name: 'Harness metadata with source and coverage', mimeType: 'application/json' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const uri = request.params.uri;
    if (uri === `${prefix}://environment`) return { contents: [{ uri, mimeType: 'text/plain', text: await runtime.environment() }] };
    if (uri === `${prefix}://status`) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(runtime.status()) }] };
    if (uri === `${prefix}://metrics`) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(runtime.metrics.snapshot(runtime.status().phase)) }] };
    const match = new RegExp(`^${prefix}-artifact://([a-f0-9]{64})$`).exec(uri);
    const saved = match && runtime.journal.blob(`log:${match[1]}`);
    if (!saved) throw new Error('Resource unavailable.');
    return { contents: [{ uri, mimeType: saved.mime, blob: Buffer.from(saved.bytes).toString('base64') }] };
  });
  return server;
}

/** Existing integrations retain this public import. */
export const createMymcMcpServer = createMinecraftMcpServer;

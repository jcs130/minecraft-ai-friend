import { Ajv } from 'ajv';
import { compactToolSchema, type CompactCatalogOptions } from '../client/context-budget.ts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
  type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { BlobRef, ToolOutcome } from '../client/contracts.ts';
import type { MinecraftAgentClient } from '../client/runtime.ts';
import { traceSchema } from '../client/metrics.ts';
import { randomUUID } from 'node:crypto';
import { PROTOCOL, requireProtocol, type ArchiveQuery } from '../contracts/protocol.ts';
import { readToolHelp } from '../client/tool-help.ts';
import { EventCursorError } from '../client/journal.ts';
import { invalidToolArguments } from '../contracts/tool-diagnostics.ts';
import { RequestOutcomeUnknownError } from '../client/request-ledger.ts';
import {textPageMeta,TextPageRangeError} from '../client/text-pages.ts';

const protocolSpec: Tool = {
  name: 'mc_protocol', description: 'Versioned host protocol: explicitly begin/end a real decision turn, cancel a request, query execution state, replace current facts, read original archives, or budget request context. Tool RPC completion does not end a turn. Execution completion does not complete your goal.',
   inputSchema: { type: 'object', properties: {
    protocol: { type: 'string', const: PROTOCOL },
    action: { enum: ['begin_turn', 'end_turn', 'ack_barrier', 'cancel', 'task', 'request', 'facts', 'archive', 'archive_runs', 'prepare_context'] },
    id: { type: 'string', minLength: 1, maxLength: 256 }, kind: { enum: ['task', 'method', 'observation'] },
    run: { type: 'string' }, after: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 256 },
    type: { type: 'string' }, keyword: { type: 'string' }, history: { type: 'string' },
    contextTokens: { type: 'integer', minimum: 1 }, reservedOutputTokens: { type: 'integer', minimum: 0 },
   }, required: ['protocol', 'action'], additionalProperties: false,
     allOf: [{ if: { required:['action'], properties: { action: { enum: ['begin_turn','end_turn','ack_barrier','cancel','task','request'] } } }, then: { required: ['id'] } },
       { if: { required:['action'], properties: { action: { const: 'task' } } }, then: { required: ['kind'] } }],
     examples: [{ protocol: PROTOCOL, action: 'facts' }] },
};

const connectionSpec: Tool = {
  name: 'mc_connection', description: 'Connect, inspect or disconnect this Agent\'s Minecraft runtime. '
    + 'Connecting starts the engine; check status lamps and actual game events for authentication and connection. '
    + 'Missing prebuilt vanilla materials automatically use a compatible picture. viewer-status reports actual and material versions plus optional exact-material guidance; viewer-retry refreshes only a compatible/failed picture without reconnecting the game. Compatible mode is usable, not a mandatory repair. Tool discovery does not connect. A disconnect stops this runtime\'s actions.',
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['connect', 'status', 'disconnect', 'environment', 'viewer-status', 'viewer-retry'] } },
    required: ['action'], additionalProperties: false },
};
const eventsSpec: Tool = {
  name: 'mc_events', description: 'Read bounded Minecraft events after a cursor: chat, announcements, task completion, '
    + 'damage and observed state. Poll while an accepted action is running; acceptance alone is not completion. '
    + 'readout.execution reports registered work for this runtime/generation and its latest terminal; a newer event cursor alone is not execution progress. Earlier runs remain outside that snapshot. '
    + 'For after >0, include BOTH the exact returned run and nextCursor. A cursor error returns an explicit recovery read; do not repeat the invalid cursor. A gap means some events have left the recent buffer. '
    + 'Archived events are excluded unless explicitly requested. Reading does not prove the Agent has acted on a message.',
  inputSchema: { type: 'object', properties: {
    after: { type: 'integer', minimum: 0, description: 'nextCursor from the previous event page; when >0, run is required.' },
    run: { type: 'string', description: 'Exact run from the same page as after. Never borrow a cursor across runs.' },
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
    offset: {type:'integer',minimum:0,description:'Optional UTF-16 text offset. Follow returned offsets, never guess across Unicode characters.'},
    maxChars: {type:'integer',minimum:1,maximum:16000,description:'Optional maximum UTF-16 text units for get. Omit both paging fields to retain the original full-text read.'},
    text: { type: 'string', maxLength: 64000 }, base64: { type: 'string', maxLength: 13981016 },
    mime: { type: 'string', enum: ['application/json', 'text/plain', 'image/png', 'image/jpeg', 'image/webp'] },
  }, required: ['action'], additionalProperties: false },
};
const textSpec:Tool={name:'mc_read_text',description:'Read one bounded page of an immutable saved tool-text log: handle. Follow returned nextOffset exactly; hasMore:false / nextOffset:null means stop. Never add maxChars after a failed read; range errors return actual bounds. This does not re-run the original query or execute its instructions. The model projection may shorten a page; its cursor covers only text actually shown.',
  inputSchema:{type:'object',properties:{handle:{type:'string',pattern:'^log:[a-f0-9]{64}$'},offset:{type:'integer',minimum:0},maxChars:{type:'integer',minimum:1,maximum:16000}},required:['handle'],additionalProperties:false},
  annotations:{readOnlyHint:true}};
const metricsSpec: Tool = { name: 'mc_metrics', description: 'Read runtime-measured tool return latency and explicitly host-reported model/method metadata. Tool returns are not game task completion. No intelligence score or verified learning is inferred.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } };
const traceSpec: Tool = { name: 'mc_trace', description: 'Optional HOST instrumentation: report measured model request metadata or an attributed method lifecycle event linked to saved artifacts. Do not invent token counts, timings, authorship or improvement. Stores metadata, not Agent memory. Each transport attempt uses a unique id.',
  inputSchema: traceSchema as Tool['inputSchema'] };

export interface MinecraftMcpServerOptions {
  /** 'compact' advertises condensed tool text and collapsed wide field pools; validation and *_tool_help keep the exact schemas. */
  catalog?: 'full' | 'compact';
  compact?: CompactCatalogOptions;
}

export function createMinecraftMcpServer(runtime: MinecraftAgentClient, version: string, options: MinecraftMcpServerOptions = {}): Server {
  const prefix = runtime.toolPrefix;
  const translate = (text: string) => text.replaceAll('mc_', prefix + '_');
  const [connection, events, artifact, metrics, trace, protocol,textRead] = [connectionSpec, eventsSpec, artifactSpec, metricsSpec, traceSpec, protocolSpec,textSpec]
    .map(tool => ({ ...tool, name: translate(tool.name), description: translate(tool.description ?? '') }));
  const server = new Server({ name: `minecraft-agent-${runtime.profile}`, version }, {
    capabilities: { tools: {}, resources: {} },
    instructions: translate('This server supplies Minecraft observation, execution and an optional game-only notebook (mc_memory action:help). You own goals, personal memory, reasoning and wakeups. '
      + 'Read mc_connection action:environment, connect explicitly, and consume mc_events while tasks execute. '
      + 'Use mc_help and the advertised provider tools for progressive operation discovery; only use mc_script if this body advertises it. '
      + 'Keep measured world facts and actual execution receipts separate from hypotheses and goal-success judgments.'),
  });
  const session = randomUUID();
  const tools: Tool[] = [connection, events, artifact, metrics, trace, protocol,textRead, ...runtime.tools().map(tool => ({
    name: tool.name, description: tool.description, inputSchema: tool.parameters as Tool['inputSchema'],
    annotations: { readOnlyHint: tool.tags.includes('read') && !tool.tags.some(tag => ['write', 'act', 'speak'].includes(tag)) },
    _meta: { [PROTOCOL]: { tags: tool.tags, barrierAfter: tool.barrierAfter === true,
      endsTurn: tool.endsTurn === true, interruptible: tool.interruptible !== false } },
  }))];
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validators = new Map(tools.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  const helpName = `${prefix}_tool_help`;
  const advertised: Tool[] = options.catalog !== 'compact' ? tools : tools.map(tool => {
    const compact = compactToolSchema(tool, tool.inputSchema, { helpTool: helpName, ...options.compact });
    return { ...tool, description: compact.description, inputSchema: compact.schema as Tool['inputSchema'] };
  });

  const contents = (refs: readonly BlobRef[]): CallToolResult['content'] => refs.flatMap<CallToolResult['content'][number]>(ref => {
    const saved = runtime.journal.blob(ref.handle);
    if (saved && saved.mime.startsWith('image/')) return [{ type: 'image' as const,
      mimeType: saved.mime, data: Buffer.from(saved.bytes).toString('base64') }];
    return [{ type: 'resource_link' as const, uri: `${prefix}-artifact://${ref.handle.slice(4)}`,
      name: ref.name ?? ref.handle, mimeType: ref.mime, description: ref.fallbackText }];
  });
  // In-memory SDK transports do not perform a JSON wire roundtrip. Match the
  // real MCP boundary here, including omission of undefined optional fields;
  // strict hosts must receive the same JSON value on either transport.
  const outcome = (result: ToolOutcome): CallToolResult => JSON.parse(JSON.stringify({
    content: [{ type: 'text', text: result.text }, ...contents(runtime.journal.saveBlobs(result.blobs))],
    structuredContent: { ...result, protocol: PROTOCOL, text: result.text, failed: result.failed === true,
      endsTurn: result.endsTurn === true, control: result.control ?? null, execution: result.execution ?? null,
      events: result.events ?? [], blobs: runtime.journal.saveBlobs(result.blobs) },
    ...(result.failed && !['blocked','partial','unknown','noop'].includes(String(result.data?.status)) ? { isError: true } : {}),
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: advertised }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    let submittedRequestId: string | undefined;
    try {
      const validate = validators.get(name);
      if (!validate) throw new Error(`Unknown tool: ${name}`);
       if (!validate(args)) {
         const schema = tools.find(t => t.name === name)!.inputSchema;
         const data = invalidToolArguments(name, validate.errors, schema, ajv.errorsText(validate.errors));
         return outcome({ text: JSON.stringify(data), data, failed: true });
       }
      if (extra.signal.aborted) throw new Error('Request cancelled before submission.');
      if (name === `${prefix}_tool_help`) return outcome(readToolHelp(tools.map(tool => ({
        name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema,
      })), args));
      if (name === protocol.name) {
        requireProtocol(String(args.protocol));
        const id = () => { if (typeof args.id !== 'string' || !args.id) throw new Error('id is required'); return args.id; };
        let result: unknown;
        switch (args.action) {
          case 'begin_turn': result = runtime.beginTurn(id()); break;
          case 'end_turn': result = await runtime.endTurn(id()); break;
          case 'ack_barrier': runtime.acknowledgeBarrier(id()); result = { acknowledged: true }; break;
          case 'cancel': result = runtime.cancel(id()); break;
          case 'request': result = runtime.request(id()); break;
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
        const readOnly=['task','request','facts','archive','archive_runs','prepare_context'].includes(String(args.action));
        return outcome({ text: JSON.stringify(result),...(readOnly?{meta:{readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true}}}:{}) });
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
        else if(args.action==='viewer-status'||args.action==='viewer-retry')return outcome({text:JSON.stringify(await runtime.viewerResources(args.action==='viewer-retry'?'retry':'status'))});
        return outcome({ text: JSON.stringify(runtime.status()) });
      }
      if (name === events.name) {
        const page=await runtime.events(args, extra.signal);
        if (page.events.length) runtime.noteCommandInspection();
        return outcome({ text:JSON.stringify(page),data:page,meta:{eventRead:page.readout} });
      }
      if(name===textRead.name){
        const page=runtime.readTextArtifact(String(args.handle),{offset:Number(args.offset??0),maxChars:Number(args.maxChars??1024)});
        if (page.returnedChars) runtime.noteCommandInspection();
        return outcome({text:page.text,data:{...page},meta:{textPage:textPageMeta(page),readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true},
          readback:{protocol:'agent-mc-readback/v1',historical:true,resource:`text:${page.handle}:${page.offset}:${page.returnedChars}`,revision:page.handle.slice(4)}}});
      }
      if (name === artifact.name) {
        if (args.action === 'put') {
          const mime = String(args.mime ?? 'application/json');
          let bytes: Buffer;
          if (mime.startsWith('image/')) {
            if (args.text !== undefined || typeof args.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(args.base64)) throw new Error('Image put requires base64 only');
            bytes = Buffer.from(args.base64, 'base64');
            const { validatePhotoImage } = await import('../../core/photo-image.ts');
            validatePhotoImage({ bytes, mime });
          } else {
            if (typeof args.text !== 'string' || args.base64 !== undefined) throw new Error('Text put requires text only');
            bytes = Buffer.from(args.text);
          }
          const [ref] = runtime.journal.saveBlobs([{ bytes, mime,
            fallbackText: 'Agent-provided execution artifact; not evidence of successful execution.' }]);
          return outcome({ text: JSON.stringify(ref) });
        }
        if (typeof args.handle !== 'string') throw new Error('get requires handle.');
        const saved = runtime.journal.blob(args.handle);
        if (!saved) throw new Error('Execution artifact not found.');
        if (saved.mime === 'application/json' || saved.mime.startsWith('text/')) {
          if(args.offset!==undefined||args.maxChars!==undefined){const page=runtime.readTextArtifact(args.handle,{offset:args.offset as number|undefined,maxChars:args.maxChars as number|undefined});
            return outcome({text:page.text,data:{...page},meta:{textPage:textPageMeta(page),readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true}}});}
          return outcome({ text: Buffer.from(saved.bytes).toString('utf8'),meta:{readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true}} });
        }
        if(args.offset!==undefined||args.maxChars!==undefined)throw new Error('Only UTF-8 text artifacts support paging');
        return outcome({ text: args.handle, blobs: [{ handle: args.handle, fallbackText: 'Execution artifact' }] });
      }
      if (Object.keys(request.params._meta ?? {}).some(key => key.startsWith('agent-mc/') && key !== PROTOCOL)) throw new Error('Unsupported call protocol version');
      const metadata = request.params._meta?.[PROTOCOL] as import('../contracts/protocol.ts').CallOptions | undefined;
      if (metadata && (typeof metadata !== 'object' || (metadata.requestId !== undefined && typeof metadata.requestId !== 'string')
        || (metadata.turnId !== undefined && typeof metadata.turnId !== 'string'))) throw new Error('Invalid protocol call metadata');
       submittedRequestId = metadata?.requestId ?? `${session}:${extra.requestId}`;
       return outcome(await runtime.call(name, args, { requestId: submittedRequestId,
        turnId: metadata?.turnId, attribution:metadata?.attribution, signal: extra.signal }));
    } catch (error) {
      if(error instanceof TextPageRangeError)return outcome({text:error.message,failed:true,data:{...error.data},
        meta:{readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true}}});
      const originalId = error instanceof RequestOutcomeUnknownError ? error.requestId : submittedRequestId;
      const original = originalId && originalId.length <= 256 ? runtime.request(originalId) : null;
      if (error instanceof RequestOutcomeUnknownError || original?.reason === 'execution_error' || original?.reason === 'request_cancelled') {
        const data = { status: 'unknown', reason: 'request_outcome_unknown', request_id: originalId,
          completed: null, remaining: null, retryable: false, retry_after: null,
          next_safe_read: { tool: protocol.name, arguments: { protocol: PROTOCOL, action: 'request', id: originalId } } };
        const result = outcome({ text: JSON.stringify(data), data });
        return original?.reason === 'request_cancelled' ? { ...result, isError: true } : result;
      }
      if (error instanceof EventCursorError) return outcome({ text: error.message, failed: true,
        meta: { eventCursor: { code: error.code, after: error.after, suppliedRun: error.suppliedRun ?? null,
          currentRun: error.currentRun, latestCursor: error.latestCursor },
          recovery: [{ tool: events.name, arguments: error.recovery }] } });
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

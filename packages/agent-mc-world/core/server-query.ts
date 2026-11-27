import { createHash, randomUUID } from 'node:crypto';
import type { ToolDef, ToolOutcome } from './support/host-contract.ts';
import { readTextPage, TextPageRangeError } from '../src/client/text-pages.ts';

/** Server packages define a finite read-only protocol; callers cannot supply commands. */
export type ServerQueryDefinition = {
  id: string;
  description: string;
  /** Public argument contract for discovery; command() remains the dispatch authority. */
  argumentsSchema?: { type: 'array'; minItems: number; maxItems: number;
    items: { type: 'string'; pattern?: string; maxLength?: number; description?: string } };
  command(arguments_: readonly string[]): string | null;
  /** Opt-in bounded multi-message replies. Partial rows never settle a query. */
  maxReplyParts?: number;
  matchReply(text: string, args: readonly string[], username: string, parts?: readonly unknown[]):
    { data?: unknown; ok?: boolean; partial?: boolean } | null;
};

/** Keep mounted tools and offline discovery on the configured protocol's same facts. */
export function serverQueryTool(definitions: readonly ServerQueryDefinition[]): Omit<ToolDef, 'handler'> {
  if (!definitions.length) return SERVER_QUERY_TOOL;
  const groups = new Map<string, { ids: string[]; schema: Record<string, unknown> }>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    // Dispatch selects the first registered definition of an ID as well.
    if (ids.has(definition.id)) continue;
    ids.add(definition.id);
    const declared = definition.argumentsSchema;
    const schema = declared ? { type: 'array', minItems: declared.minItems, maxItems: declared.maxItems,
      items: { type: 'string', ...(declared.items.pattern ? { pattern: declared.items.pattern } : {}),
        ...(declared.items.maxLength !== undefined ? { maxLength: declared.items.maxLength } : {}) } }
      : SERVER_QUERY_TOOL.parameters.properties.arguments;
    const key = JSON.stringify(schema);
    const group = groups.get(key);
    if (group) group.ids.push(definition.id);
    else groups.set(key, { ids: [definition.id], schema });
  }
  return { ...SERVER_QUERY_TOOL, parameters: { ...SERVER_QUERY_TOOL.parameters,
    properties: { ...SERVER_QUERY_TOOL.parameters.properties,
      query: { ...SERVER_QUERY_TOOL.parameters.properties.query,
        enum: [...ids] },
    },
    // Keep flat fields for decoders that ignore nested properties. The union
    // additionally binds each query to its declared arguments and separates
    // receipt reads from sends, including after catalogue compaction.
    anyOf: [
      { maxProperties: 0 },
      SERVER_QUERY_RECEIPT_TOOL.parameters,
      ...[...groups.values()].map(group => ({ type: 'object', additionalProperties: false,
        required: ['query', ...(Number(group.schema.minItems) > 0 ? ['arguments'] : [])],
        properties: { query: { type: 'string', enum: group.ids }, arguments: group.schema } })),
    ],
  } };
}

function queryContract({ id, description, argumentsSchema }: ServerQueryDefinition) {
  return { id, description: description.slice(0, 1024), ...(argumentsSchema ? { argumentsSchema } : {}) };
}

function queryArgumentFailure(message: string, definition: ServerQueryDefinition): ToolOutcome {
  const queryDefinition = queryContract(definition);
  const next_safe_read = { tool: 'mc_query', arguments: {} };
  return { text: message + '\n' + JSON.stringify({ queryDefinition, next_safe_read }), failed: true,
    data: { goal_completed: false, queryDefinition, next_safe_read } };
}

export type ServerQueryContext = {
  generation: string;
  username: string;
  /** Last server-message arrival observed before sending; prevents queued old replies being reused. */
  afterSequence?: number;
  send(command: string): void;
};

export type ServerQueryReceipt = {
  requestId: string;
  query: string;
  arguments: string[];
  command: string;
  generation: string;
  username: string;
  afterSequence?: number;
  phase: 'sent' | 'replied' | 'timeout' | 'cancelled' | 'send_failed';
  sentAt: string;
  sentAtMs: number;
  endedAt?: string;
  requestNonce: false;
  goal_completed: false;
  outcomeUnknown: boolean;
  /** Incomplete observations are retained on timeout/cancel, never reported as a full list. */
  partialReply?: { parts: unknown[]; complete: false };
  reply?: { text: string; textTruncated: boolean; data?: unknown; dataTruncated?: boolean; ok?: boolean };
  reason?: string;
};

export const SERVER_QUERY_RECEIPT_TOOL = {
  name: 'mc_query_receipt',
  tags: ['read'],
  description: 'Read a previously returned server query receipt by exact requestId. For oversized results follow next_safe_read with the returned offset. Reads never send a command. Unknown IDs have unknown results.',
  parameters: { type: 'object', additionalProperties: false, required: ['requestId'],
    properties: { requestId: { type: 'string', minLength: 1, maxLength: 128 },
      offset: { type: 'integer', minimum: 0, description: 'Optional continuation offset from next_safe_read. Omit for the first page.' } } },
} satisfies Omit<ToolDef, 'handler'>;

const queryFields = {
  query: { type: 'string', minLength: 1, maxLength: 128 },
  arguments: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 256 } },
};

export const SERVER_QUERY_TOOL = {
  name: 'mc_query',
  tags: ['read'],
  description: '{} lists registered read-only queries and their argument contracts. '
    + '{query,arguments?:string[]} sends one; omit requestId. Read an existing result through mc_query_receipt. '
    + 'Required subject IDs must come from observed server data. No body slot or chat wait is used. '
    + 'A fast matched reply returns directly; otherwise sent means awaiting a reply, not completed. Only listed queries are supported. '
    + 'At most one query is pending; identical requests reuse its receipt and terminal receipts for five seconds. '
    + 'Timeout means the result is unknown; there is no automatic retry. Replies have no request nonce and are only correlated server feedback, '
    + 'not proof of a uniquely identified request or completion of a gameplay goal.',
  parameters: {
    type: 'object', properties: queryFields,
    // Close each variant separately. Old clients can still read with {requestId},
    // without advertising that field as an input to a new query.
    anyOf: [{ maxProperties: 0 }, SERVER_QUERY_RECEIPT_TOOL.parameters,
      { type: 'object', additionalProperties: false, required: ['query'], properties: queryFields }],
  },
} satisfies Omit<ToolDef, 'handler'>;

/** Full replies remain in the query receipt and event ledger. Broadcast only a source-bound
 * lookup notice to other readers; failures/incomplete reads keep their full diagnostics. */
export function serverQueryContextNotice(data: Record<string, unknown> | undefined, receiptTool = 'mc_query_receipt'): string | null {
  const reply=data?.reply as {ok?:boolean;dataTruncated?:boolean}|undefined;
  if(data?.phase!=='replied'||data.outcomeUnknown!==false||reply?.ok!==true||reply.dataTruncated)return null;
  const notice=JSON.stringify({source:'server-query-notice',requestId:data.requestId,query:data.query,
    arguments:data.arguments,phase:data.phase,observedAt:data.endedAt,requestNonce:false,goal_completed:false,
    next_safe_read:receiptRead(data.requestId, receiptTool),
    detail:'Full result belongs to the original query receipt. This notice is not current inventory or goal completion.'});
  return notice.length<=2000?notice:null;
}

const TIMEOUT_MS = 5000;
const REUSE_MS = 5000;
const HISTORY_LIMIT = 32;
const REPLY_LIMIT = 4096;
const DATA_LIMIT = 8192;
const MULTIPART_LIMIT = 65536;
const RECEIPT_TEXT_LIMIT = 7000;

type Record_ = {
  receipt: ServerQueryReceipt;
  definition: ServerQueryDefinition;
  key: string;
  endedAtMs?: number;
  dispatching: boolean;
  parts: unknown[];
  partBytes: number;
  lastSequence?: number;
  synchronousReply?: NonNullable<ServerQueryReceipt['reply']>;
  timer?: ReturnType<typeof setTimeout>;
  waiters?: Set<() => void>;
};

const failure = (message: string): ToolOutcome => ({ text: message, failed: true, data: { goal_completed: false } });
const receiptRead = (requestId: unknown, tool = SERVER_QUERY_RECEIPT_TOOL.name, offset?: number) =>
  ({ tool, arguments: { requestId, ...(offset === undefined ? {} : { offset }) } });
const isReceiptRead = (keys: string[]) => keys.includes('requestId') && keys.every(key => key === 'requestId' || key === 'offset');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Page only the model's text. The SDK result and archived terminal retain the original data. */
function receiptPageText(header: string, data: Record<string, unknown>, original: string, offset: number): string | null {
  const render = (value: Record<string, unknown>) => header + '\n' + JSON.stringify(value);
  const details = object(data.reply) ? data.reply : {};
  const native = object(details.data) ? details.data : {};
  const items = native.items;
  if (Array.isArray(items) && items.length) {
    const page = (start: number, rows: unknown[], returned = rows.length, forceContinuation = false) => {
      const next = start + returned, hasMore = next < items.length;
      return render({ ...data, reply: { ...details, data: { ...native, items: rows } },
        receiptView: { unit: 'items', offset: start, returned, total: items.length, hasMore,
          note: 'Only these rows are shown. Server completeness fields describe the original reply.' },
        ...(hasMore || forceContinuation ? { next_safe_read: receiptRead(data.requestId, undefined, next) } : {}) });
    };
    // Reserve the longest pagination metadata. Choose one unit for this receipt,
    // even if a later native item is too large to display as a whole row.
    const budget = RECEIPT_TEXT_LIMIT - page(items.length, [], items.length, true).length - 8;
    const sizes = items.map(row => JSON.stringify(row).length + 1);
    if (sizes.every(size => size <= budget)) {
      if (offset >= items.length) return null;
      const rows: unknown[] = [];
      let used = 0;
      for (let index = offset; index < items.length && used + sizes[index] <= budget; index++) {
        used += sizes[index];
        rows.push(items[index]);
      }
      return page(offset, rows);
    }
  }
  // Some servers return one very large row or an object without a row list.
  // Expose exact JSON as bounded UTF-16 chunks without splitting a character.
  const handle = 'log:' + createHash('sha256').update(original).digest('hex');
  try {
    const page = readTextPage(original, handle, { offset, maxChars: 2400 });
    return render({ requestId: data.requestId, query: data.query, phase: data.phase,
      outcomeUnknown: data.outcomeUnknown, requestNonce: false, goal_completed: false,
      receiptView: { unit: page.unit, offset, returned: page.returnedChars, total: page.totalChars, hasMore: page.hasMore,
        note: 'Join the jsonChunk strings in offset order to recover the exact original JSON.' },
      jsonChunk: page.text,
      ...(page.nextOffset === null ? {} : { next_safe_read: receiptRead(data.requestId, undefined, page.nextOffset) }) });
  } catch (error) {
    if (error instanceof TextPageRangeError) return null;
    throw error;
  }
}
/** Return a bounded repair path in the failed receipt itself; never infer or send a command. */
function queryInputFailure(message: string, definitions: readonly ServerQueryDefinition[]): ToolOutcome {
  const ids = [...new Set(definitions.map(item => item.id))];
  const recovery = {
    supportedQueryIds: ids.slice(0, 32).map(id => id.slice(0, 128)),
    moreQueries: Math.max(0, ids.length - 32),
    index: {},
    callForms: ['{}', '{"query":"listed query ID","arguments":["argument token"]}', '{"requestId":"returned requestId"}'],
    rule: 'Choose one form. arguments is optional and query-specific. requestId is returned by a sent query; never invent it or combine it with query. Only registered queries are supported. For other server commands, read the chat action contract via next_safe_read.',
  };
  const next_safe_read = { tool: 'mc_help', arguments: { skill: 'chat' } };
  return { text: message + '\n' + JSON.stringify({ recovery, next_safe_read }), failed: true,
    data: { goal_completed: false, recovery, next_safe_read } };
}
const scopeKey = (context: Pick<ServerQueryContext, 'generation' | 'username'>) => JSON.stringify([context.generation, context.username]);

/** A single-flight non-body lane. receive() must only be called for provenance-filtered server messages. */
export class ServerQueryLane {
  private readonly now: () => number;
  private readonly onTerminal?: (outcome: ToolOutcome) => void;
  private readonly records = new Map<string, Record_>();
  private pending?: Record_;
  private scope?: string;
  private scopeEpoch = 0;

  constructor(options: { now?: () => number; onTerminal?: (outcome: ToolOutcome) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.onTerminal = options.onTerminal;
  }

  readReceipt(args: Record<string, unknown>): ToolOutcome {
    this.expire();
    if (!args || !isReceiptRead(Object.keys(args)) || typeof args.requestId !== 'string' ||
        !args.requestId.length || args.requestId.length > 128 ||
        (args.offset !== undefined && (typeof args.offset !== 'number' || !Number.isSafeInteger(args.offset) || args.offset < 0))) {
      return failure('Provide the original requestId and optional non-negative integer offset from next_safe_read. No query was sent.');
    }
    const record = this.records.get(args.requestId);
    return record ? this.outcome(record, {}, typeof args.offset === 'number' ? args.offset : 0) : { text: 'Unknown or expired requestId; its server result is unknown. No query was sent.',
      data: { requestId: args.requestId, found: false, outcomeUnknown: true, requestNonce: false, goal_completed: false } };
  }

  /** Optional short read window, independent of the body queue and the query's
   * original deadline. Legacy call() stays synchronous; no request is resent. */
  async callAndWait(args: Record<string, unknown>, definitions: readonly ServerQueryDefinition[],
    context: ServerQueryContext | null, options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<ToolOutcome> {
    const waitMs=options.waitMs??350;
    if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>1000)throw new RangeError('Query read window must be 0..1000 ms');
    options.signal?.throwIfAborted();
    const outcome=this.call(args,definitions,context),id=outcome.data?.requestId;
    // A busy response belongs to another query; waiting must not replace its
    // explicit busy identity with an apparently successful requested read.
    if(waitMs===0||outcome.data?.busy===true||outcome.data?.phase!=='sent'||typeof id!=='string')return outcome;
    const record=this.records.get(id);
    if(!record||record.receipt.phase!=='sent')return record?this.outcome(record):outcome;
    const reused=outcome.data?.reused===true?{reused:true}:{};
    return new Promise(resolve=>{
      let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
      const finish=(aborted=false)=>{
        if(finished)return;finished=true;clearTimeout(timer);record.waiters?.delete(settled);
        options.signal?.removeEventListener('abort',abort);
        resolve(this.outcome(record,{...reused,...(aborted?{readWaitAborted:true}:{})}));
      };
      const settled=()=>finish(),abort=()=>finish(true);
      (record.waiters??=new Set()).add(settled);
      options.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(settled,waitMs);
      if(options.signal?.aborted)abort();
      else if(record.receipt.phase!=='sent')settled();
    });
  }

  call(args: Record<string, unknown>, definitions: readonly ServerQueryDefinition[], context: ServerQueryContext | null): ToolOutcome {
    // A new connection is a new correlation domain, even when it has the same player name.
    if (context && this.scope !== scopeKey(context)) {
      this.reset('Connection scope changed; the previous query result is unknown.');
      this.scope = scopeKey(context);
    }
    this.expire();
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return queryInputFailure('Use {}, {query,arguments?:string[]}, or {requestId} separately. No query was sent.', definitions);
    }
    const keys = Object.keys(args);
    if (keys.length === 0) {
      const data = { queries: definitions.map(queryContract),
        pendingRequestId: this.pending?.receipt.requestId ?? null, requestNonce: false, goal_completed: false };
      return { text: 'Available read-only server queries. The observed phase and original requestId identify the read; it does not complete a goal. '
        + 'If still sent, read that requestId later. Timeout is unknown, with no automatic retry.\n' + JSON.stringify(data), data };
    }
    if (isReceiptRead(keys)) return this.readReceipt(args);
    if ('requestId' in args && typeof args.query === 'string' && keys.every(k => ['query','arguments','requestId'].includes(k))) {
      const known = typeof args.requestId === 'string' && this.records.has(args.requestId);
      const definition = definitions.find(item => item.id === args.query);
      const recovery = { goal_completed: false, requestedQuerySent: false,
        ...(known ? {next_safe_read: receiptRead(args.requestId)} : {}),
        ...(definition ? {queryDefinition: queryContract(definition)} : {next_discovery: {tool: 'mc_query', arguments: {}}}) };
      const message = known ? 'A stored receipt and a query were supplied together. Read the original result with next_safe_read, or send a fresh query with query and its arguments only.'
        : 'This requestId has no stored receipt. For a new query send query and its arguments only; never generate an ID.';
      return {text: message + ' No query was sent.\n' + JSON.stringify(recovery), failed: true, data: recovery};
    }
    if (keys.some(key => key !== 'query' && key !== 'arguments') || typeof args.query !== 'string'
      || args.query.length === 0 || args.query.length > 128 || (args.arguments !== undefined
        && (!Array.isArray(args.arguments) || args.arguments.length > 16
          || args.arguments.some(value => typeof value !== 'string' || value.length > 256 || /[\r\n\0]/u.test(value))))) {
      return queryInputFailure('Use {}, {query,arguments?:string[]}, or {requestId} separately. No query was sent.', definitions);
    }
    const matches = definitions.filter(definition => definition.id === args.query);
    if (matches.length !== 1) return queryInputFailure('Unknown or ambiguous query. Read {} for the available protocol definitions. No query was sent.', definitions);
    if (!context) return failure('Server connection is unavailable. No query was sent; reconnect before submitting a query.');
    if (context.afterSequence !== undefined && (!Number.isSafeInteger(context.afterSequence) || context.afterSequence < 0)) {
      return failure('Server reply arrival sequence is invalid. No query was sent.');
    }
    const arguments_ = [...(args.arguments as string[] | undefined ?? [])];
    const definition = matches[0];
    const key = JSON.stringify([this.scopeEpoch, scopeKey(context), definition.id, arguments_]);
    if (this.pending) {
      if (this.pending.key === key) return this.outcome(this.pending, { reused: true });
      return { text: 'Another server query is awaiting its reply. No new query was sent; read the pending requestId first.',
        data: { busy: true, requestId: this.pending.receipt.requestId,
          next_safe_read: receiptRead(this.pending.receipt.requestId), phase: 'sent', goal_completed: false, requestNonce: false } };
    }
    for (const record of [...this.records.values()].reverse()) {
      if (record.key === key && record.endedAtMs !== undefined && this.now() - record.endedAtMs < REUSE_MS) {
        return this.outcome(record, { reused: true });
      }
    }
    let command: string | null;
    try { command = definition.command(Object.freeze([...arguments_])); }
    catch { return queryArgumentFailure('The query definition rejected its arguments. No query was sent.', definition); }
    if (typeof command !== 'string' || command.length === 0 || command.length > 1024 || /[\r\n\0]/u.test(command)) {
      return queryArgumentFailure('Invalid arguments for this server query. Read the selected definition below and correct its arguments. No query was sent.', definition);
    }
    const sentAtMs = this.now();
    const record: Record_ = { definition, key, dispatching: true, parts: [], partBytes: 0, receipt: {
      requestId: `query-${randomUUID()}`, query: definition.id, arguments: arguments_, command,
      generation: context.generation, username: context.username, phase: 'sent',
      ...(context.afterSequence !== undefined ? { afterSequence: context.afterSequence } : {}),
      sentAt: new Date(sentAtMs).toISOString(), sentAtMs, requestNonce: false, goal_completed: false, outcomeUnknown: true,
    } };
    // Publish before send: fake transports and in-process adapters may reply synchronously.
    this.records.set(record.receipt.requestId, record);
    this.pending = record;
    this.trim();
    try { context.send(command); }
    catch (error) {
      record.dispatching = false;
      record.synchronousReply = undefined;
      if (record.receipt.phase === 'sent') this.finish(record, 'send_failed', String(error).slice(0, 512));
      return this.outcome(record);
    }
    record.dispatching = false;
    if (record.receipt.phase !== 'sent') return this.outcome(record);
    if (record.synchronousReply) {
      record.receipt.reply = record.synchronousReply;
      record.synchronousReply = undefined;
      this.finish(record, 'replied');
    } else if (this.now() >= sentAtMs + TIMEOUT_MS) {
      this.finish(record, 'timeout', 'No matching reply was observed before the deadline; the server result remains unknown.');
    } else {
      record.timer = setTimeout(() => {
        if (this.pending === record) this.finish(record, 'timeout', 'No matching reply was observed before the deadline; the server result remains unknown.');
      }, Math.max(0, sentAtMs + TIMEOUT_MS - this.now()));
      record.timer.unref?.();
    }
    return this.outcome(record);
  }

  receive(text: string, generation: string, username: string, sequence?: number): boolean {
    this.expire();
    const record = this.pending;
    if (!record || scopeKey({ generation, username }) !== this.scope || typeof text !== 'string') return false;
    if (record.receipt.afterSequence !== undefined && (!Number.isFinite(sequence)
      || (sequence as number) <= record.receipt.afterSequence)) return false;
    if (record.lastSequence !== undefined && (!Number.isFinite(sequence) || sequence! <= record.lastSequence)) return false;
    if (record.synchronousReply) return false;
    let matched: ReturnType<ServerQueryDefinition['matchReply']>;
    // Reject oversized messages before invoking an extension parser; do not match a truncated prefix.
    if (text.length > 65536) return false;
    try { matched = record.definition.matchReply(text, Object.freeze([...record.receipt.arguments]), username,
      Object.freeze(JSON.parse(JSON.stringify(record.parts)))); }
    catch { return false; }
    if (!matched || typeof matched !== 'object') return false;
    if (matched.partial === true) {
      const limit = record.definition.maxReplyParts;
      if (!Number.isSafeInteger(limit) || limit! < 1 || limit! > 64 || matched.data === undefined) return false;
      let json: string | undefined;
      try { json = JSON.stringify(matched.data); } catch { return false; }
      if (json === undefined) return false;
      const bytes = Buffer.byteLength(json, 'utf8');
      if (record.parts.length >= limit! || record.partBytes + bytes > MULTIPART_LIMIT) {
        this.finish(record, 'cancelled', 'Multipart reply exceeded its bounded capacity; the list is incomplete. No retry was sent.');
        return true;
      }
      record.parts.push(JSON.parse(json)); record.partBytes += bytes;
      if (Number.isFinite(sequence)) record.lastSequence = sequence;
      return true;
    }
    const reply: NonNullable<ServerQueryReceipt['reply']> = { text: text.slice(0, REPLY_LIMIT), textTruncated: text.length > REPLY_LIMIT };
    if (typeof matched.ok === 'boolean') reply.ok = matched.ok;
    if (matched.data !== undefined) {
      try {
        const json = JSON.stringify(matched.data);
        if (json !== undefined && (record.definition.maxReplyParts
          ? Buffer.byteLength(json, 'utf8') <= MULTIPART_LIMIT : json.length <= DATA_LIMIT)) reply.data = JSON.parse(json);
        else reply.dataTruncated = true;
      } catch { reply.dataTruncated = true; }
    }
    if (reply.dataTruncated && record.definition.maxReplyParts) {
      this.finish(record, 'cancelled', 'Multipart result could not be retained within its bound; the list is incomplete. No retry was sent.');
      return true;
    }
    if (record.dispatching) record.synchronousReply ??= reply;
    else {
      record.receipt.reply = reply;
      this.finish(record, 'replied');
    }
    return true;
  }

  reset(reason: string): void {
    // Respawn may keep the same connection generation. Its earlier receipts remain readable,
    // but neither pending nor completed observations may be reused across this lifecycle boundary.
    this.scopeEpoch++;
    this.scope = undefined;
    if (this.pending) this.finish(this.pending, 'cancelled', reason.slice(0, 512));
  }

  private expire(): void {
    const record = this.pending;
    if (record && this.now() >= record.receipt.sentAtMs + TIMEOUT_MS) {
      this.finish(record, 'timeout', 'No matching reply was observed before the deadline; the server result remains unknown.');
    }
  }

  private finish(record: Record_, phase: Exclude<ServerQueryReceipt['phase'], 'sent'>, reason?: string): void {
    if (record.receipt.phase !== 'sent') return;
    if (record.timer) clearTimeout(record.timer);
    record.timer = undefined;
    record.receipt.phase = phase;
    record.endedAtMs = this.now();
    record.receipt.endedAt = new Date(record.endedAtMs).toISOString();
    record.receipt.outcomeUnknown = phase !== 'replied';
    if (phase !== 'replied' && record.parts.length) record.receipt.partialReply = { parts: record.parts, complete: false };
    record.parts = []; record.partBytes = 0;
    if (reason) record.receipt.reason = reason;
    if (this.pending === record) this.pending = undefined;
    for(const settle of record.waiters??[])settle();
    record.waiters?.clear();
    try { this.onTerminal?.(this.outcome(record, {}, null)); } catch { /* A consumer's event sink cannot strand the query lane. */ }
  }

  private outcome(record: Record_, extra: Record<string, unknown> = {}, offset: number | null = 0): ToolOutcome {
    const archived = JSON.stringify(record.receipt);
    const original: ServerQueryReceipt = JSON.parse(archived);
    const data: Record<string, unknown> = { ...original, ...extra,
      ...(record.receipt.phase === 'sent' ? {next_safe_read: receiptRead(record.receipt.requestId)} : {}) };
    const messages: Record<ServerQueryReceipt['phase'], string> = {
      sent: '已发送，待回复。Read requestId later; sending does not prove completion.',
      replied: 'A matching server reply was observed. Correlation has no request nonce and does not prove a unique request or a gameplay goal.',
      timeout: 'Reply deadline expired; the server result is unknown. No automatic retry was sent.',
      cancelled: 'Query observation was cancelled; the server result is unknown. No automatic retry was sent.',
      send_failed: 'The send operation failed; delivery and server result are unknown. No automatic retry was sent.',
    };
    const header = messages[record.receipt.phase];
    let text = header + '\n' + JSON.stringify(data);
    if (offset !== null) {
      const pageable = header.length + 1 + archived.length > RECEIPT_TEXT_LIMIT &&
        record.receipt.phase === 'replied' && record.receipt.reply?.ok !== false;
      if (pageable) {
        const page = receiptPageText(header, original, archived, offset);
        if (page === null) return failure('Receipt offset is outside the original result. Read the same requestId without an offset or follow next_safe_read. No query was sent.');
        text = page;
      } else if (offset !== 0) {
        return failure('This receipt has no continuation. Read the same requestId without an offset. No query was sent.');
      }
    }
    return { text, data,
      ...(record.receipt.phase === 'send_failed' || record.receipt.reply?.ok === false ? { failed: true as const } : {}) };
  }

  private trim(): void {
    while (this.records.size > HISTORY_LIMIT) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }
}

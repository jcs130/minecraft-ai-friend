import { randomUUID } from 'node:crypto';
import type { ToolDef, ToolOutcome } from './support/host-contract.ts';

/** Server packages define a finite read-only protocol; callers cannot supply commands. */
export type ServerQueryDefinition = {
  id: string;
  description: string;
  command(arguments_: readonly string[]): string | null;
  matchReply(text: string, args: readonly string[], username: string): { data?: unknown; ok?: boolean } | null;
};

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
  reply?: { text: string; textTruncated: boolean; data?: unknown; dataTruncated?: boolean; ok?: boolean };
  reason?: string;
};

export const SERVER_QUERY_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'mc_query',
  tags: ['read'],
  description: 'Query an explicitly configured read-only server protocol without occupying the body or waiting for chat. '
    + '{} lists available queries; {query,arguments?:string[]} sends one; {requestId} reads its receipt. '
    + 'Only listed queries are supported, never arbitrary commands. A sent status means accepted and awaiting a reply, not completed. '
    + 'At most one query is pending; identical requests reuse its receipt and terminal receipts for five seconds. '
    + 'Timeout means the result is unknown; there is no automatic retry. Replies have no request nonce and are only correlated server feedback, '
    + 'not proof of a uniquely identified request or completion of a gameplay goal.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 128 },
      arguments: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 256 } },
      requestId: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};

const TIMEOUT_MS = 5000;
const REUSE_MS = 5000;
const HISTORY_LIMIT = 32;
const REPLY_LIMIT = 4096;
const DATA_LIMIT = 8192;

type Record_ = {
  receipt: ServerQueryReceipt;
  definition: ServerQueryDefinition;
  key: string;
  endedAtMs?: number;
  dispatching: boolean;
  synchronousReply?: NonNullable<ServerQueryReceipt['reply']>;
  timer?: ReturnType<typeof setTimeout>;
};

const failure = (message: string): ToolOutcome => ({ text: message, failed: true, data: { goal_completed: false } });
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

  call(args: Record<string, unknown>, definitions: readonly ServerQueryDefinition[], context: ServerQueryContext | null): ToolOutcome {
    // A new connection is a new correlation domain, even when it has the same player name.
    if (context && this.scope !== scopeKey(context)) {
      this.reset('Connection scope changed; the previous query result is unknown.');
      this.scope = scopeKey(context);
    }
    this.expire();
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return failure('Use {}, {query,arguments?:string[]}, or {requestId} separately. No query was sent.');
    }
    const keys = Object.keys(args);
    if (keys.length === 0) {
      const data = { queries: definitions.map(({ id, description }) => ({ id, description })),
        pendingRequestId: this.pending?.receipt.requestId ?? null, requestNonce: false, goal_completed: false };
      return { text: 'Available read-only server queries. Sending returns immediately as sent/awaiting reply; it does not complete a goal. '
        + 'Read requestId later. Timeout is unknown, with no automatic retry.\n' + JSON.stringify(data), data };
    }
    if (keys.length === 1 && typeof args.requestId === 'string' && args.requestId.length > 0 && args.requestId.length <= 128) {
      const record = this.records.get(args.requestId);
      return record ? this.outcome(record) : { text: 'Unknown or expired requestId; its server result is unknown. No query was sent.',
        data: { requestId: args.requestId, found: false, outcomeUnknown: true, requestNonce: false, goal_completed: false } };
    }
    if (keys.some(key => key !== 'query' && key !== 'arguments') || typeof args.query !== 'string'
      || args.query.length === 0 || args.query.length > 128 || (args.arguments !== undefined
        && (!Array.isArray(args.arguments) || args.arguments.length > 16
          || args.arguments.some(value => typeof value !== 'string' || value.length > 256 || /[\r\n\0]/u.test(value))))) {
      return failure('Use {}, {query,arguments?:string[]}, or {requestId} separately. No query was sent.');
    }
    const matches = definitions.filter(definition => definition.id === args.query);
    if (matches.length !== 1) return failure('Unknown or ambiguous query. Read {} for the available protocol definitions. No query was sent.');
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
        data: { busy: true, requestId: this.pending.receipt.requestId, phase: 'sent', goal_completed: false, requestNonce: false } };
    }
    for (const record of [...this.records.values()].reverse()) {
      if (record.key === key && record.endedAtMs !== undefined && this.now() - record.endedAtMs < REUSE_MS) {
        return this.outcome(record, { reused: true });
      }
    }
    let command: string | null;
    try { command = definition.command(Object.freeze([...arguments_])); }
    catch { return failure('The query definition rejected its arguments. No query was sent.'); }
    if (typeof command !== 'string' || command.length === 0 || command.length > 1024 || /[\r\n\0]/u.test(command)) {
      return failure('Invalid arguments for this server query. No query was sent.');
    }
    const sentAtMs = this.now();
    const record: Record_ = { definition, key, dispatching: true, receipt: {
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
    let matched: ReturnType<ServerQueryDefinition['matchReply']>;
    // Reject oversized messages before invoking an extension parser; do not match a truncated prefix.
    if (text.length > 65536) return false;
    try { matched = record.definition.matchReply(text, Object.freeze([...record.receipt.arguments]), username); }
    catch { return false; }
    if (!matched || typeof matched !== 'object') return false;
    const reply: NonNullable<ServerQueryReceipt['reply']> = { text: text.slice(0, REPLY_LIMIT), textTruncated: text.length > REPLY_LIMIT };
    if (typeof matched.ok === 'boolean') reply.ok = matched.ok;
    if (matched.data !== undefined) {
      try {
        const json = JSON.stringify(matched.data);
        if (json !== undefined && json.length <= DATA_LIMIT) reply.data = JSON.parse(json);
        else reply.dataTruncated = true;
      } catch { reply.dataTruncated = true; }
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
    if (reason) record.receipt.reason = reason;
    if (this.pending === record) this.pending = undefined;
    try { this.onTerminal?.(this.outcome(record)); } catch { /* A consumer's event sink cannot strand the query lane. */ }
  }

  private outcome(record: Record_, extra: Record<string, unknown> = {}): ToolOutcome {
    const data: Record<string, unknown> = { ...JSON.parse(JSON.stringify(record.receipt)), ...extra };
    const messages: Record<ServerQueryReceipt['phase'], string> = {
      sent: '已发送，待回复。Read requestId later; sending does not prove completion.',
      replied: 'A matching server reply was observed. Correlation has no request nonce and does not prove a unique request or a gameplay goal.',
      timeout: 'Reply deadline expired; the server result is unknown. No automatic retry was sent.',
      cancelled: 'Query observation was cancelled; the server result is unknown. No automatic retry was sent.',
      send_failed: 'The send operation failed; delivery and server result are unknown. No automatic retry was sent.',
    };
    return { text: messages[record.receipt.phase] + '\n' + JSON.stringify(data), data,
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

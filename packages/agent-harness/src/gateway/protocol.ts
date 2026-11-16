import type { HarnessEvent, HarnessEventKind, IntentState, PriorityInput } from '../types.ts';

/**
 * Harness gateway message protocol (v1). Transport-neutral JSON envelopes; see docs/agent-harness-protocol.md.
 *
 *   client → server  { v: 1, id, type, ts?, agent?, payload? }
 *   server → client  { v: 1, id, re, type: 'result' | 'error' | 'welcome' | 'pong', ts, payload }
 *   server push      { v: 1, id, type: 'event', ts, payload: { subscription, stream, event } }
 */
export const GATEWAY_PROTOCOL = 'agent-mc-harness-gateway' as const;
export const GATEWAY_VERSION = 1 as const;
export const SUPPORTED_VERSIONS: readonly number[] = [1];

export const REQUEST_TYPES = ['hello', 'submit_intent', 'update_intent', 'control', 'get_summary', 'subscribe', 'unsubscribe', 'pull_events', 'ping'] as const;
export type RequestType = typeof REQUEST_TYPES[number];
export type ResponseType = 'result' | 'error' | 'welcome' | 'pong' | 'event';

export const ERROR_CODES = ['bad_request', 'unsupported_version', 'unknown_type', 'unauthorized', 'forbidden', 'not_found',
  'conflict', 'too_large', 'rate_limited', 'quota_exceeded', 'unavailable', 'internal'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export const HTTP_STATUS: Record<ErrorCode, number> = { bad_request: 400, unsupported_version: 400, unknown_type: 400, unauthorized: 401,
  forbidden: 403, not_found: 404, conflict: 409, too_large: 413, rate_limited: 429, quota_exceeded: 429, unavailable: 503, internal: 500 };

export interface ErrorPayload { code: ErrorCode; message: string; retryAfterMs?: number; supported?: readonly number[] }

export class GatewayError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly extra: Partial<ErrorPayload> = {}) { super(message); }
  payload(): ErrorPayload { return { code: this.code, message: this.message, ...this.extra }; }
}

export interface RequestEnvelope<T extends RequestType = RequestType> { v: 1; id: string; type: T; ts?: string; agent?: string; payload: PayloadOf<T> }
export interface ResponseEnvelope<P = unknown> { v: 1; id: string; re?: string; type: ResponseType; ts: string; payload: P }

const KINDS: readonly HarnessEventKind[] = ['death', 'task_completed', 'task_failed', 'interaction', 'skill', 'player_presence', 'intent_state', 'reflection'];
const STATES: readonly IntentState[] = ['queued', 'active', 'paused', 'done', 'cancelled', 'failed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export type StepPayload = { tool: string; args: Record<string, unknown>; note?: string };
export type ConstraintsPayload = { steps?: StepPayload[]; deadlineMs?: number; rules?: string[] };
export interface Payloads {
  hello: { token?: string; client?: { name?: string; version?: string }; protocols?: number[] };
  submit_intent: { goal: string; priority?: PriorityInput; constraints?: ConstraintsPayload; hostRef?: string };
  update_intent: { intentId: string; goal?: string; priority?: PriorityInput; constraints?: ConstraintsPayload };
  control: { action: 'pause' | 'resume' | 'cancel' | 'get' | 'list'; intentId?: string; reason?: string; states?: IntentState[]; limit?: number };
  get_summary: { topic?: string; maxTokens?: number };
  subscribe: { minSeverity?: 1 | 2 | 3; kinds?: HarnessEventKind[]; after?: number; stream?: string };
  unsubscribe: { subscription: string };
  pull_events: { after?: number; limit?: number; minSeverity?: 1 | 2 | 3; kinds?: HarnessEventKind[]; stream?: string };
  ping: { nonce?: string };
}
export type PayloadOf<T extends RequestType> = Payloads[T];

export type HarnessEventKindList = HarnessEventKind[];
export interface EventPush { subscription: string; stream: string; event: HarnessEvent; gap?: boolean }

// ---------- validation (hand-written, strict, no dependencies) ----------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (m: string): never => { throw new GatewayError('bad_request', m); };

function keys(o: Obj, allowed: string[], where: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${where}: unknown field "${k}"`);
}
function str(o: Obj, k: string, max: number, required = false, min = 1): string | undefined {
  const v = o[k];
  if (v === undefined) { if (required) bad(`${k} is required`); return undefined; }
  if (typeof v !== 'string' || v.length < min || v.length > max) bad(`${k} must be a string of ${min}..${max} chars`);
  return v as string;
}
function int(o: Obj, k: string, min: number, max: number): number | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(`${k} must be an integer in ${min}..${max}`);
  return v as number;
}
function oneOf<T>(o: Obj, k: string, values: readonly T[], required = false): T | undefined {
  const v = o[k];
  if (v === undefined) { if (required) bad(`${k} is required`); return undefined; }
  if (!values.includes(v as T)) bad(`${k} must be one of ${values.join(', ')}`);
  return v as T;
}
function list<T>(o: Obj, k: string, values: readonly T[], max: number): T[] | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > max || v.some(x => !values.includes(x as T))) bad(`${k} must be an array (≤${max}) of ${values.join(', ')}`);
  return [...new Set(v as T[])];
}
function priority(o: Obj): PriorityInput | undefined {
  const v = o.priority;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) return v;
  if (typeof v === 'string' && PRIORITIES.includes(v)) return v as PriorityInput;
  return bad('priority must be 0..100 or low|normal|high|urgent');
}
function constraints(o: Obj): ConstraintsPayload | undefined {
  const v = o.constraints;
  if (v === undefined) return undefined;
  if (!isObj(v)) bad('constraints must be an object');
  const c = v as Obj; keys(c, ['steps', 'deadlineMs', 'rules'], 'constraints');
  const out: ConstraintsPayload = {};
  if (c.steps !== undefined) {
    if (!Array.isArray(c.steps) || c.steps.length < 1 || c.steps.length > 20) bad('constraints.steps must be an array of 1..20 steps');
    out.steps = (c.steps as unknown[]).map((s, i) => {
      if (!isObj(s)) bad(`constraints.steps[${i}] must be an object`);
      const step = s as Obj; keys(step, ['tool', 'args', 'note'], `constraints.steps[${i}]`);
      const tool = str(step, 'tool', 64, true)!;
      if (step.args !== undefined && !isObj(step.args)) bad(`constraints.steps[${i}].args must be an object`);
      const note = str(step, 'note', 200);
      return { tool, args: (step.args as Obj | undefined) ?? {}, ...(note ? { note } : {}) };
    });
  }
  const deadlineMs = int(c, 'deadlineMs', 1000, 86_400_000);
  if (deadlineMs !== undefined) out.deadlineMs = deadlineMs;
  if (c.rules !== undefined) {
    if (!Array.isArray(c.rules) || c.rules.length > 10 || c.rules.some(r => typeof r !== 'string' || !r || r.length > 200))
      bad('constraints.rules must be ≤10 strings of ≤200 chars');
    out.rules = c.rules as string[];
  }
  return out;
}
const severity = (o: Obj) => oneOf(o, 'minSeverity', [1, 2, 3] as const);

const PAYLOAD: { [T in RequestType]: (p: Obj) => Payloads[T] } = {
  hello: p => {
    keys(p, ['token', 'client', 'protocols'], 'hello');
    const token = str(p, 'token', 512);
    let client: Payloads['hello']['client'];
    if (p.client !== undefined) {
      if (!isObj(p.client)) bad('client must be an object');
      const c = p.client as Obj; keys(c, ['name', 'version'], 'client');
      client = { name: str(c, 'name', 64), version: str(c, 'version', 32) };
    }
    if (p.protocols !== undefined && (!Array.isArray(p.protocols) || p.protocols.length > 8 || p.protocols.some(x => !Number.isInteger(x))))
      bad('protocols must be an array of integers');
    return { token, client, protocols: p.protocols as number[] | undefined };
  },
  submit_intent: p => {
    keys(p, ['goal', 'priority', 'constraints', 'hostRef'], 'submit_intent');
    return { goal: str(p, 'goal', 500, true)!, priority: priority(p), constraints: constraints(p), hostRef: str(p, 'hostRef', 200) };
  },
  update_intent: p => {
    keys(p, ['intentId', 'goal', 'priority', 'constraints'], 'update_intent');
    const out = { intentId: str(p, 'intentId', 128, true)!, goal: str(p, 'goal', 500), priority: priority(p), constraints: constraints(p) };
    if (out.goal === undefined && out.priority === undefined && out.constraints === undefined) bad('update_intent needs goal, priority or constraints');
    return out;
  },
  control: p => {
    keys(p, ['action', 'intentId', 'reason', 'states', 'limit'], 'control');
    const action = oneOf(p, 'action', ['pause', 'resume', 'cancel', 'get', 'list'] as const, true)!;
    const intentId = str(p, 'intentId', 128);
    if ((action === 'cancel' || action === 'get') && !intentId) bad(`${action} requires intentId`);
    return { action, intentId, reason: str(p, 'reason', 200), states: list(p, 'states', STATES, 6), limit: int(p, 'limit', 1, 100) };
  },
  get_summary: p => { keys(p, ['topic', 'maxTokens'], 'get_summary'); return { topic: str(p, 'topic', 100), maxTokens: int(p, 'maxTokens', 80, 800) }; },
  subscribe: p => {
    keys(p, ['minSeverity', 'kinds', 'after', 'stream'], 'subscribe');
    return { minSeverity: severity(p), kinds: list(p, 'kinds', KINDS, KINDS.length), after: int(p, 'after', 0, Number.MAX_SAFE_INTEGER), stream: str(p, 'stream', 128) };
  },
  unsubscribe: p => { keys(p, ['subscription'], 'unsubscribe'); return { subscription: str(p, 'subscription', 64, true)! }; },
  pull_events: p => {
    keys(p, ['after', 'limit', 'minSeverity', 'kinds', 'stream'], 'pull_events');
    return { after: int(p, 'after', 0, Number.MAX_SAFE_INTEGER), limit: int(p, 'limit', 1, 100), minSeverity: severity(p),
      kinds: list(p, 'kinds', KINDS, KINDS.length), stream: str(p, 'stream', 128) };
  },
  ping: p => { keys(p, ['nonce'], 'ping'); return { nonce: str(p, 'nonce', 64) }; },
};

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Parse + validate one request. Throws GatewayError (with `re` recoverable via `requestIdOf`). */
export function parseRequest(raw: string | unknown): RequestEnvelope {
  let msg: unknown = raw;
  if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch { bad('message is not valid JSON'); } }
  if (!isObj(msg)) bad('message must be a JSON object');
  const m = msg as Obj;
  keys(m, ['v', 'id', 'type', 'ts', 'agent', 'payload'], 'envelope');
  if (m.v === undefined) bad('v is required');
  if (!SUPPORTED_VERSIONS.includes(m.v as number))
    throw new GatewayError('unsupported_version', `protocol version ${String(m.v)} is not supported`, { supported: SUPPORTED_VERSIONS });
  if (typeof m.id !== 'string' || !ID.test(m.id)) bad('id must match [A-Za-z0-9._:-]{1,128}');
  if (typeof m.type !== 'string') bad('type is required');
  if (!(REQUEST_TYPES as readonly string[]).includes(m.type as string)) throw new GatewayError('unknown_type', `unknown message type "${String(m.type).slice(0, 40)}"`);
  str(m, 'ts', 40); str(m, 'agent', 64);
  if (m.payload !== undefined && !isObj(m.payload)) bad('payload must be an object');
  const type = m.type as RequestType;
  const payload = PAYLOAD[type]((m.payload as Obj | undefined) ?? {});
  return { v: 1, id: m.id as string, type, ...(m.ts ? { ts: m.ts as string } : {}), ...(m.agent ? { agent: m.agent as string } : {}), payload } as RequestEnvelope;
}

/** Best effort: the request id of an invalid message, for error correlation. */
export function requestIdOf(raw: string | unknown): string | undefined {
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return isObj(m) && typeof m.id === 'string' && ID.test(m.id) ? m.id : undefined;
  } catch { return undefined; }
}

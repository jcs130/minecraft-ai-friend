/** Package-owned game/host ports, structurally compatible with Cortico API 5.
 * The standalone SDK requires no Cortico package, including its types.
 */
import type { CallControl, ExecutionReceipt } from './protocol.ts';
export * from './protocol.ts';
export type EventOrigin = 'external' | 'internal';
export type EventTag = 'snapshot' | 'speak';
export type TriggerMode = 'preempt' | 'interrupt' | 'flush' | 'debounce' | 'piggyback';
export interface PushOptions { deliver?: boolean; trigger?: TriggerMode }
export interface BlobRef { handle: string; mime: string; name?: string; fallbackText: string }
export type BlobInput = { bytes: Uint8Array; mime: string; name?: string; fallbackText: string }
  | { handle: string; fallbackText: string };
export interface EventEnvelope {
  protocol?: import('./protocol.ts').ProtocolVersion;
  cursor: number; run?: string; type: string; ts: string; source: string; origin: EventOrigin;
  text: string; senderKey?: string; tags?: readonly EventTag[]; meta?: Record<string, unknown>;
  contextDelivery?: 'deliver' | 'archive-only'; trigger?: TriggerMode; blobs?: BlobRef[]; ephemeral?: true;
  execution?: ExecutionReceipt;
}
export type DeferredRendered = string | { text: string; blobs?: BlobInput[] };
export interface DeferredEventSpec {
  type: string; source: string; origin: EventOrigin; senderKey?: string;
  meta?: Record<string, unknown>; tags?: readonly EventTag[];
  render(signal?: AbortSignal): DeferredRendered | null | Promise<DeferredRendered | null>;
}
export interface EventRangeQuery {
  fromCursor?: number; toCursor?: number; fromTs?: string; toTs?: string;
  senderKey?: string; source?: string; origin?: EventOrigin; limit?: number;
}
export interface EventGrepQuery extends Omit<EventRangeQuery, 'fromCursor' | 'toCursor'> { keyword: string; context: number }
export interface EventStoreReader {
  get(cursor: number): EventEnvelope | undefined;
  latestCursor(): number;
  range(query: EventRangeQuery): EventEnvelope[];
  around(cursor: number, before: number, after: number): EventEnvelope[];
  grep(query: EventGrepQuery): Array<{ hitCursor: number; events: EventEnvelope[] }>;
}
export type ToolTag = 'read' | 'write' | 'speak' | 'act' | 'flow' | 'snapshot';
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCallContext {
  role: string; log: Logger; callId?: string; turnId?: string; round?: number; signal?: AbortSignal;
  queueExternalEvents?: (events: EventEnvelope[]) => void;
}
export interface ToolOutcome {
  text: string; blobs?: BlobInput[]; failed?: true; endsTurn?: boolean; retryAfterMs?: number; meta?: Record<string, unknown>;
  execution?: ExecutionReceipt; events?: EventEnvelope[]; control?: CallControl;
}
export interface ToolDef extends ToolSchema {
  tags: readonly ToolTag[]; barrierAfter?: boolean; endsTurn?: boolean; interruptible?: boolean;
  handler(args: Record<string, unknown>, context: ToolCallContext): Promise<string | ToolOutcome>;
}
export interface LLMUsage {
  promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number; reasoningTokens?: number;
}
export interface ModelFacts { model(): string; accepts(mime: string): boolean; contextWindow(): number | undefined }
export interface WorldHost {
  pushEvent(event: Omit<EventEnvelope, 'cursor' | 'origin' | 'contextDelivery' | 'blobs'> & {
    origin?: EventOrigin; blobs?: BlobInput[] }, options?: PushOptions): Promise<EventEnvelope>;
  pushDeferred(event: Pick<DeferredEventSpec, 'type' | 'senderKey' | 'meta' | 'tags' | 'render'> & {
    origin?: EventOrigin }, options?: { trigger?: TriggerMode }): void;
  store: EventStoreReader;
  drainPendingEvents(filter: (event: EventEnvelope) => boolean): Promise<EventEnvelope[]>;
  modelFacts: ModelFacts;
  blob(handle: string): { bytes: Uint8Array; mime: string } | null;
  reportUsage(usage: LLMUsage, options?: { model?: string; label?: string }): void;
  llmStalls?(withinMs: number): Promise<number>;
  log: Logger;
}
export interface WorldRequestFacts {
  text: string; snapshotTypes: readonly string[]; parts?: readonly { key: string; text: string }[];
}
export interface StoragePart {
  key: string; label: string; kind: 'disk' | 'memory'; location?: string; danger?: boolean; note?: string; order?: number;
  stat(): string; clear(): Promise<string> | string;
}
export interface WorldPanelDecl { id: string; title: string; description?: string; getMethods?: readonly string[] }
export interface PromptDocDecl {
  key: string; title: string; description: string; path: string; deploymentPath?: string; role?: 'envPrompt' | 'prefix';
  vars?: Array<{ name: string; description: string; multiline?: boolean }>;
}
export interface ConfigProperty {
  type: 'integer' | 'number' | 'boolean' | 'string' | 'array' | 'object'; title: string; description?: string;
  minimum?: number; maximum?: number; multipleOf?: number; enum?: string[];
  items?: { type: 'integer' | 'number'; minimum?: number; maximum?: number };
  minItems?: number; maxItems?: number; nullable?: boolean;
  'x-scale'?: number; 'x-suffix'?: string; 'x-hot'?: boolean; 'x-options'?: string;
  'x-path'?: { kind: 'file' | 'directory'; extensions?: string[]; recommendedDir?: string };
  'x-download'?: { href: string; label?: string };
}
export interface ConfigGroup {
  id: string; owner: 'core' | 'persona' | `world:${string}` | `provider:${string}`;
  schema: { type: 'object'; title: string; description?: string; properties: Record<string, ConfigProperty> };
}
export interface WorldConsoleDecl {
  label?: string;
  lamps?: Array<{ label: string; state: 'online' | 'loading' | 'error' | 'offline'; hint?: string }>;
  badges?: Array<{ label: string; value: string | number; tone?: 'on' | 'off' | 'plain' }>;
  panels?: WorldPanelDecl[];
  invoke?(panel: string, method: string, args: unknown[]): Promise<unknown>;
  promptDocs?: PromptDocDecl[]; storage?: StoragePart[];
  links?: Array<{ label: string; href: string; inheritTheme?: boolean }>; config?: ConfigGroup[];
}
/** Execution environment port; callers can supply an alternative implementation. */
export interface World {
  id: string;
  envPromptVars(): Record<string, string> | null | Promise<Record<string, string> | null>;
  tools(): ToolDef[];
  console?(): WorldConsoleDecl;
  start(host: WorldHost): Promise<void>;
  stop(): Promise<void>;
  onTurnEnded?(): void | Promise<void>;
}
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export interface LogAnchorFields { sess?: string; round?: number; resp?: string; call?: string; ev?: number; task?: number }
export interface LogEmitOptions extends LogAnchorFields { event?: string; durMs?: number; data?: unknown; err?: unknown; ts?: string }
export interface LogError { name: string; message: string; stack?: string }
export interface Logger {
  trace(msg: string, data?: unknown): void; debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void; warn(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void;
  emit(level: LogLevel, msg: string, options?: LogEmitOptions): void;
  child(area: string): Logger;
}

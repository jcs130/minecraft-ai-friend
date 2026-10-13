import type { MinecraftAgentClient, Logger, ModelFacts } from 'agent-mc-world/client';
import type { ExecutionReceipt, World, WorldHost } from 'agent-mc-world/contracts';

export interface MyAgentWorldConfig {
  provider: 'mineflayer' | 'numen'; username: string; controllerId: string;
  dataDir: string; ledgerDir: string;
  host?: string; port?: number; expectedUuid?: string; loginFile?: string;
  bodyId?: string; credentialsFile?: string; viewerUrl?: string;
  connectTimeoutMs?: number; timeoutMs?: number; pollMs?: number;
}
/** Injectable transport for tests or an already owned native adapter. No new connection is implicit. */
export interface BodyAdapter {
  identity(): unknown | Promise<unknown>; operations(id?: string): unknown | Promise<unknown>;
  snapshot(): Promise<unknown>; read(id: string, args: Record<string, unknown>): Promise<unknown>;
  submit(request: {action_id: string; operation: string; args: Record<string, unknown>}): Promise<unknown>;
  actionStatus(id: string): Promise<unknown>; wait(id: string, options: {timeoutMs: number}): Promise<unknown>;
  cancel(id: string): Promise<unknown>; claimControl(): Promise<unknown>; releaseControl(): Promise<unknown>;
  stop(): Promise<unknown>; restore(): Promise<unknown>; viewer(): unknown | Promise<unknown>;
  luaOperations?(group?: string): Promise<unknown>; close(): Promise<unknown>;
}
export class MyAgentWorldEnvironment implements World {
  constructor(config: MyAgentWorldConfig, options?: {connect?: (config: MyAgentWorldConfig) => Promise<BodyAdapter>});
  readonly id: string;
  start(host: WorldHost): Promise<void>; stop(): Promise<void>;
  envPromptVars(): Record<string, string>;
  tools(): ReturnType<World['tools']>;
  requestFacts(): import('agent-mc-world/contracts').WorldRequestFacts | null;
  console(): import('agent-mc-world/contracts').WorldConsoleDecl;
}
export function executionOf(value: Record<string, any>, id?: string): ExecutionReceipt | undefined;
export function createMyAgentWorldClient(config: MyAgentWorldConfig, options?: {
  log?: Logger; modelFacts?: ModelFacts; connect?: (config: MyAgentWorldConfig) => Promise<BodyAdapter>;
}): MinecraftAgentClient;
export const HOST_INSTRUCTIONS: string;
export type TaskCriterion = { type: 'owned_item'; itemId: string; countAtLeast: number; requireEquipped?: boolean }
  | { type: 'reach_position'; position: { x: number; y: number; z: number }; dimension: string; radius: number }
  | { type: 'quest_completed'; questId: string; countAtLeast: number }
  | { type: 'all'; criteria: TaskCriterion[] };
export interface TaskSpec {
  id: string; criteria: TaskCriterion; bodyId: string; objective?: string;
  scenarioId: string; scenarioVersion: string; harnessVersion: string; initialStateFingerprint: string;
  startedAtCall: number; startedAtRound: number;
}
/** Host-controlled, immutable criteria and durable counters; model claims cannot mark success. */
export class TaskMonitor {
  constructor(options: { directory: string; clock?: () => number; readOnly?: boolean });
  start(spec: TaskSpec): Record<string, any>;
  record(id: string, event: Record<string, any>): void;
  observe(id: string, observations: { body: any; society?: any }, counters: { calls: number; round: number }): Record<string, any>;
  finish(id: string, options: { observations: { body: any; society?: any }; counters: { calls: number; round: number }; reason: string; cancelled?: boolean; outcomeUnknown?: boolean }): Record<string, any>;
  get(id: string): Record<string, any> | null;
  report(): Record<string, any>; close(): void;
}
export function evaluateTask(criteria: TaskCriterion, observations: { body: any; society?: any }, options: { bodyId: string; now?: number; maxAgeMs?: number }): Record<string, any>;

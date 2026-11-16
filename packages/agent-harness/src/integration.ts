import { join } from 'node:path';
import { AgentMemory, createMinecraftMemory, type MemoryEventObserver, type MinecraftMemoryIntegration } from 'agent-mc-memory';
import { HarnessRuntime, type HarnessRuntimeOptions } from './harness.ts';
import { clientBodyPort, type BodyOutcome } from './planner.ts';
import { createHarnessTools, type HarnessToolDef } from './tools.ts';

export interface AgentHarnessConfig {
  /** Master switch. OFF unless AGENT_HARNESS_ENABLED=1. */
  enabled: boolean;
  /** Let the harness drive the body for intents. OFF unless AGENT_HARNESS_EXECUTE=1 (tracking/summary/events still work). */
  execute: boolean;
  dataDir?: string;
  memory: { enabled: boolean; backend: 'local' | 'hybrid'; graphitiUrl: string; graphitiTokenEnv?: string };
  /** Also expose memory_* tools to the host (default off; get_summary already carries relevant memory). */
  exposeMemoryTools: boolean;
}

const on = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v ?? '');

export function harnessConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentHarnessConfig {
  const tokenEnv = env.AGENT_MEMORY_GRAPHITI_TOKEN_ENV;
  return {
    enabled: on(env.AGENT_HARNESS_ENABLED),
    execute: on(env.AGENT_HARNESS_EXECUTE),
    dataDir: env.AGENT_HARNESS_DIR || undefined,
    memory: {
      enabled: env.AGENT_HARNESS_MEMORY === undefined ? true : on(env.AGENT_HARNESS_MEMORY),
      backend: env.AGENT_MEMORY_BACKEND === 'hybrid' ? 'hybrid' : 'local',
      graphitiUrl: env.AGENT_MEMORY_GRAPHITI_URL || 'http://127.0.0.1:8765',
      ...(tokenEnv && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) ? { graphitiTokenEnv: tokenEnv } : {}),
    },
    exposeMemoryTools: on(env.AGENT_HARNESS_MEMORY_TOOLS),
  };
}

/** Structural subset of agent-mc-world `MinecraftClientOptions`. */
export interface HarnessClientOptionsLike {
  cfg: { username: string };
  dataDir: string;
  eventObservers?: readonly MemoryEventObserver[];
  extraTools?: readonly unknown[];
}

export interface AgentHarnessIntegration {
  harness: HarnessRuntime;
  memory: MinecraftMemoryIntegration | null;
  tools: HarnessToolDef[];
  /** Call after constructing MinecraftAgentClient. No-op unless config.execute. */
  attachClient(client: { call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<BodyOutcome> }): void;
  close(): Promise<void>;
}

/**
 * Opt-in wiring of the harness (and its memory) into MinecraftAgentClient options.
 * Disabled → returns the very same options object and null; nothing is created, nothing changes.
 */
export function withAgentHarness<T extends HarnessClientOptionsLike>(clientOptions: T, config: AgentHarnessConfig = harnessConfigFromEnv(),
  extra: Partial<Omit<HarnessRuntimeOptions, 'self' | 'memory'>> & { memoryDataDir?: string } = {}):
  { options: T; integration: AgentHarnessIntegration | null } {
  if (!config.enabled) return { options: clientOptions, integration: null };
  const dir = config.dataDir ?? join(clientOptions.dataDir, 'agent-harness');
  const self = clientOptions.cfg.username;
  const memory = config.memory.enabled ? createMinecraftMemory({ self, onWarning: extra.log,
    memory: new AgentMemory({ dataDir: extra.memoryDataDir ?? join(dir, 'memory'), backend: config.memory.backend, onWarning: extra.log,
      ...(config.memory.backend === 'hybrid' ? { graphiti: { url: config.memory.graphitiUrl, tokenEnv: config.memory.graphitiTokenEnv } } : {}) }) }) : null;
  const harness = new HarnessRuntime({ ...extra, self, memory, dataDir: extra.dataDir ?? dir });
  const tools = createHarnessTools(harness);
  const options = { ...clientOptions, eventObservers: [...(clientOptions.eventObservers ?? []), harness.observer],
    extraTools: [...(clientOptions.extraTools ?? []), ...tools, ...(config.exposeMemoryTools && memory ? memory.tools : [])] };
  return {
    options,
    integration: { harness, memory, tools,
      attachClient(client) { if (config.execute) harness.bindBody(clientBodyPort(client)); },
      close: () => harness.close() },
  };
}

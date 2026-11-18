import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AgentMemory, type AgentMemoryOptions, type ScopedMemory } from './memory.ts';
import { fromEvent, type McEventLike, type SourceContext } from './minecraft-source.ts';
import { createMemoryTools, type MemoryToolDef } from './tools.ts';
import type { MemoryScope, WorldRef } from './types.ts';

/** Structural subset of agent-mc-world `WorldRequestFacts`. */
export interface ObservedFacts {
  world?: { key: string | null; dimensionType?: string | null; revision?: number } | null;
  experience?: { scope?: { realm: string; account: string; agent: string } | null } | null;
}

/** Matches agent-mc-world `MinecraftEventObserver` (lazy facts) and also accepts a plain facts object. */
export type MemoryEventObserver = (event: McEventLike, facts: ObservedFacts | null | (() => ObservedFacts | null)) => void;

/** Event types that can yield an episode; anything else is skipped without reading facts. */
const RELEVANT = /^minecraft\.(enter|leave|chat|event|task)$/;

export interface MinecraftMemoryIntegration {
  memory: AgentMemory;
  /** Pass to MinecraftAgentClient `eventObservers`. Never throws, never blocks the event path. */
  observer: MemoryEventObserver;
  tools: MemoryToolDef[];
  /** Resolve the current partition (null until a scope was observed or configured). */
  current(): { memory: ScopedMemory; context: SourceContext } | null;
  /** Resolves when everything observed so far is written locally (and, with flushGraphiti, to Graphiti). */
  idle(options?: { flushGraphiti?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export interface MinecraftMemoryOptions {
  memory: AgentMemory;
  /** The body's Minecraft username. */
  self: string;
  /** Used until the world reports `experience.scope`. */
  fallbackScope?: MemoryScope;
  onWarning?: (message: string, data?: Record<string, unknown>) => void;
}

export function createMinecraftMemory(options: MinecraftMemoryOptions): MinecraftMemoryIntegration {
  const connection = randomUUID();
  let factSource: Parameters<MemoryEventObserver>[1] = null;
  let chain: Promise<void> = Promise.resolve();

  const current = () => {
    const facts = typeof factSource === 'function' ? factSource() : factSource;
    const scope = facts?.experience?.scope ?? options.fallbackScope;
    if (!scope || typeof scope.realm !== 'string' || typeof scope.account !== 'string' || typeof scope.agent !== 'string') return null;
    const world: WorldRef | null = facts?.world ? { key: facts.world.key, dimensionType: facts.world.dimensionType ?? null,
      revision: facts.world.revision ?? 0, connection } : null;
    return { memory: options.memory.scope(scope), context: { self: options.self, world } };
  };

  const observer: MemoryEventObserver = (event, facts) => {
    try {
      factSource = facts;
      if (!RELEVANT.test(event.type) && !event.execution) return;
      // Capture the verified scope before scheduling the write, even if two realms change in one tick.
      let resolved: ReturnType<typeof current> | undefined;
      const targetForEvent = () => resolved === undefined ? (resolved = current()) : resolved;
      const draft = fromEvent(event, { self: options.self, get world() { return targetForEvent()?.context.world ?? null; } });
      if (!draft) return;
      const target = targetForEvent(); if (!target) return;
      chain = chain.then(() => target.memory.ingest(draft).then(() => undefined))
        .catch(error => options.onWarning?.('memory ingest failed', { type: event.type, error: String(error).slice(0, 300) }));
    } catch (error) {
      options.onWarning?.('memory observer failed', { type: event.type, error: String(error).slice(0, 300) });
    }
  };

  return {
    memory: options.memory, observer, tools: createMemoryTools(current), current,
    async idle(o = {}) { await chain; if (o.flushGraphiti) await options.memory.flush(); },
    async close() { await chain; await options.memory.close(); },
  };
}

export interface AgentMemoryConfig {
  enabled: boolean;
  dataDir?: string;
  backend: 'local' | 'hybrid';
  graphitiUrl: string;
  graphitiTokenEnv?: string;
}

/** Environment flags; memory is OFF unless AGENT_MEMORY_ENABLED=1. */
export function memoryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentMemoryConfig {
  const backend = env.AGENT_MEMORY_BACKEND === 'hybrid' ? 'hybrid' : 'local';
  const tokenEnv = env.AGENT_MEMORY_GRAPHITI_TOKEN_ENV;
  return {
    enabled: /^(1|true|yes|on)$/i.test(env.AGENT_MEMORY_ENABLED ?? ''),
    dataDir: env.AGENT_MEMORY_DIR || undefined,
    backend,
    graphitiUrl: env.AGENT_MEMORY_GRAPHITI_URL || 'http://127.0.0.1:8765',
    ...(tokenEnv && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) ? { graphitiTokenEnv: tokenEnv } : {}),
  };
}

/** Options shape this helper extends: agent-mc-world `MinecraftClientOptions` (structurally). */
export interface ClientOptionsLike {
  cfg: { username: string };
  dataDir: string;
  eventObservers?: readonly MemoryEventObserver[];
  extraTools?: readonly unknown[];
}

/**
 * Opt-in wiring for MinecraftAgentClient. With `enabled: false` (default) the options object is returned
 * unchanged, so existing behaviour is untouched.
 */
export function withAgentMemory<T extends ClientOptionsLike>(clientOptions: T, config: AgentMemoryConfig = memoryConfigFromEnv(),
  extra: Partial<AgentMemoryOptions> = {}): { options: T & Required<Pick<ClientOptionsLike, 'eventObservers' | 'extraTools'>> | T; integration: MinecraftMemoryIntegration | null } {
  if (!config.enabled) return { options: clientOptions, integration: null };
  const memory = new AgentMemory({ dataDir: config.dataDir ?? join(clientOptions.dataDir, 'agent-memory'), backend: config.backend,
    ...(config.backend === 'hybrid' ? { graphiti: { url: config.graphitiUrl, tokenEnv: config.graphitiTokenEnv } } : {}), ...extra });
  const integration = createMinecraftMemory({ memory, self: clientOptions.cfg.username, onWarning: extra.onWarning });
  return {
    integration,
    options: { ...clientOptions, eventObservers: [...(clientOptions.eventObservers ?? []), integration.observer],
      extraTools: [...(clientOptions.extraTools ?? []), ...integration.tools] },
  };
}

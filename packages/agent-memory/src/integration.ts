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
const FACTS_TTL_MS = 2_000;

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
  let scope: MemoryScope | null = options.fallbackScope ?? null;
  let world: WorldRef | null = null;
  let scoped: ScopedMemory | null = scope ? options.memory.scope(scope) : null;
  let chain: Promise<void> = Promise.resolve();
  let factsReadAt = -Infinity;

  const update = (facts: ObservedFacts | null) => {
    const s = facts?.experience?.scope;
    if (s && typeof s.realm === 'string' && typeof s.account === 'string' && typeof s.agent === 'string'
      && (!scope || s.realm !== scope.realm || s.account !== scope.account || s.agent !== scope.agent)) {
      scope = { realm: s.realm, account: s.account, agent: s.agent };
      scoped = options.memory.scope(scope);
    }
    if (facts?.world) world = { key: facts.world.key, dimensionType: facts.world.dimensionType ?? null,
      revision: facts.world.revision ?? 0, connection };
  };
  const current = () => scoped ? { memory: scoped, context: { self: options.self, world } } : null;

  const observer: MemoryEventObserver = (event, facts) => {
    try {
      if (!RELEVANT.test(event.type) && !event.execution) return;
      if (typeof facts !== 'function') update(facts);
      else if (!scoped || Date.now() - factsReadAt > FACTS_TTL_MS) { factsReadAt = Date.now(); update(facts()); }
      const target = current(); if (!target) return;
      const draft = fromEvent(event, target.context); if (!draft) return;
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

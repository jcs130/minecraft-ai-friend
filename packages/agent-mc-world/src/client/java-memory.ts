import { join } from 'node:path';
import { GameMemoryBook, GAME_MEMORY_TOOL } from '../../core/game-memory.ts';
import { GameMemoryService } from '../../core/game-memory-service.ts';
import { PlayerMemoryRecall } from '../../core/game-memory-player.ts';
import type { JavaClientState } from '../contracts/java-client.ts';
import type { MinecraftClientConfig } from './config.ts';
import type { ToolDef } from './contracts.ts';
import { compactNativeItems } from './native-evidence.ts';

/** Host-owned storage and identity binding; never creates or reconnects a body. */
export interface JavaClientServices {
  dataDir: string;
  agentName?: string;
  /** Optional display/cache alias; never used as authoritative player identity. */
  accountName?: string;
}

const dimensionOf = (state: JavaClientState | null) => state?.connected
  ? String(state.dimension ?? '').replace(/^minecraft:/, '') || null : null;

export function createJavaMemoryTool(cfg: MinecraftClientConfig, services: JavaClientServices,
  readFresh: (signal?: AbortSignal) => Promise<JavaClientState>, current: () => JavaClientState | null): ToolDef {
  return createJavaMemoryAccess(cfg, services, readFresh, current).tool;
}

/** Tool writes and encounter recall share one isolated notebook; recall never calls a provider. */
export function createJavaMemoryAccess(cfg: MinecraftClientConfig, services: JavaClientServices,
  readFresh: (signal?: AbortSignal) => Promise<JavaClientState>, current: () => JavaClientState | null) {
  const directory = join(services.dataDir, 'minecraft-memory');
  const book = new GameMemoryBook(directory);
  const memory = new GameMemoryService(book, directory), players = new PlayerMemoryRecall(book);
  // Native identity is available offline. A new namespace deliberately does not
  // import older weak host/login-alias notebooks or notes from another provider.
  const native = cfg.javaClient;
  const scope = native ? { realm: `java:${native.expectedServer.toLowerCase().replace(/:25565$/, '')}`,
    account: `uuid:${native.expectedUuid.replaceAll('-', '').toLowerCase()}`,
    agent: services.agentName ?? native.controllerId } : null;
  const tool: ToolDef = { ...GAME_MEMORY_TOOL,
    description: GAME_MEMORY_TOOL.description + ' Historical notebook operations also work while the body is disconnected; capture alone requires a fresh connected identity-checked state. Offline dimension is unknown; use dimension:"*" to search across dimensions.',
    handler: async (args, ctx) => {
      try {
        ctx.signal?.throwIfAborted();
        if (!scope || !scope.realm.slice(5) || !/^uuid:[a-f0-9]{32}$/.test(scope.account) || !scope.agent)
          throw new Error('Java memory requires an explicit native server, UUID and agent/controller identity');
        // Historical retrieval/notes must not depend on a body RPC, lease or launcher.
        const fresh = args.action === 'capture' ? await readFresh(ctx.signal) : null;
        ctx.signal?.throwIfAborted();
        const result = await memory.execute(args, { scope, dimension: dimensionOf(fresh ?? current()),
          capture: () => {
            const dimension = dimensionOf(fresh);
            if (!fresh?.connected || !dimension) throw new Error('Native body disconnected; current facts cannot be captured');
            return { observedAt: fresh.sampledAt, dimension, reference: `native:${fresh.generation}:${fresh.sampledAt}`,
              content: JSON.stringify({ position: fresh.position, health: fresh.health, food: fresh.food,
                inventoryObservation: 'native-client-state', inventory: compactNativeItems(fresh).inventory }) };
          },
        }, cfg.memory, ctx.signal);
        return { text: JSON.stringify(result), meta: { gameMemory: result } };
      } catch (error) { return { text: String(error), failed: true }; }
    },
  };
  return { tool, recallPlayer: (name: string) => scope
    ? players.recall({ name, direct: true }, { scope, dimension: null }) : null };
}

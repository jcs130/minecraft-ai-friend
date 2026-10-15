import { join } from 'node:path';
import { GameMemoryBook, GAME_MEMORY_TOOL } from '../../core/game-memory.ts';
import { GameMemoryService } from '../../core/game-memory-service.ts';
import type { JavaClientState } from '../contracts/java-client.ts';
import type { MinecraftClientConfig } from './config.ts';
import type { ToolDef } from './contracts.ts';
import { compactNativeItems } from './native-evidence.ts';

/** Host-owned storage and identity binding; never creates or reconnects a body. */
export interface JavaClientServices {
  dataDir: string;
  agentName?: string;
  /** Exact configured game account, after any host-side login-name mapping. */
  accountName?: string;
}

const dimensionOf = (state: JavaClientState | null) => state?.connected
  ? String(state.dimension ?? '').replace(/^minecraft:/, '') || null : null;

export function createJavaMemoryTool(cfg: MinecraftClientConfig, services: JavaClientServices,
  readFresh: (signal?: AbortSignal) => Promise<JavaClientState>, current: () => JavaClientState | null): ToolDef {
  const directory = join(services.dataDir, 'minecraft-memory');
  const memory = new GameMemoryService(new GameMemoryBook(directory), directory);
  const scope = { realm: `weak:${cfg.host}:${cfg.port}|`,
    account: `${cfg.auth ?? 'offline'}:${services.accountName ?? cfg.username}`,
    agent: services.agentName ?? cfg.username };
  return { ...GAME_MEMORY_TOOL,
    description: GAME_MEMORY_TOOL.description + ' Historical notebook operations also work while the body is disconnected; capture alone requires a fresh connected identity-checked state. Offline dimension is unknown; use dimension:"*" to search across dimensions.',
    handler: async (args, ctx) => {
      try {
        ctx.signal?.throwIfAborted();
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
}

/**
 * Compile-time contract check against the in-repo agent-mc-world sources (type-only import; erased at runtime).
 * `pnpm typecheck` fails if the memory observer/tools stop being assignable to MinecraftAgentClient options.
 */
import { describe, expect, it } from 'vitest';
import type { MinecraftClientOptions } from '../../agent-mc-world/src/client/runtime.ts';
import type { MinecraftEventObserver } from '../../agent-mc-world/src/client/index.ts';
import type { ToolDef } from '../../agent-mc-world/src/client/contracts.ts';
import { AgentMemory, createMinecraftMemory } from '../src/index.ts';

describe('agent-mc-world structural compatibility', () => {
  it('observer and tools plug into MinecraftClientOptions', async () => {
    const integration = createMinecraftMemory({ memory: new AgentMemory({ dataDir: ':memory:' }), self: 'Komi' });
    const observer: MinecraftEventObserver = integration.observer;
    const tools: readonly ToolDef[] = integration.tools;
    const options: Pick<MinecraftClientOptions, 'eventObservers' | 'extraTools'> = { eventObservers: [observer], extraTools: tools };
    expect(options.extraTools).toHaveLength(4);
    await integration.close();
  });
});

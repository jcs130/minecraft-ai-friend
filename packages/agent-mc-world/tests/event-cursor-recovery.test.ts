import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentJournal, EventCursorError, MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

it('keeps run ownership strict and exposes a bounded read recovery through SDK and MCP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'event-cursor-recovery-'));
  const runtime = new MinecraftAgentClient({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: dir, log: nullLogger() });
  const journal = runtime.journal as AgentJournal;
  const server = createMinecraftMcpServer(runtime, 'fixture'), client = new Client({ name: 'cursor-fixture', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await journal.pushEvent({ type: 'minecraft.fixture', source: 'fixture', ts: new Date().toISOString(), text: 'observed fixture' });
    expect(() => journal.read(1, 8)).toThrow(EventCursorError);
    try { journal.read(1, 8); } catch (error) {
      expect(error).toMatchObject({ code: 'EVENT_RUN_REQUIRED', currentRun: journal.run, after: 1,
        recovery: { after: 0, run: journal.run, waitMs: 0 } });
    }
    await server.connect(left); await client.connect(right);
    for (const [args, code] of [[{ after: 1 }, 'EVENT_RUN_REQUIRED'],
      [{ after: 1, run: 'old-run' }, 'EVENT_RUN_CHANGED'], [{ after: 2, run: journal.run }, 'EVENT_CURSOR_AHEAD']] as const) {
      const bad = await client.callTool({ name: 'mc_events', arguments: args });
      expect(bad.isError).toBe(true);
      const meta = (bad.structuredContent as any).meta;
      expect(meta.eventCursor.code).toBe(code);
      expect(meta.recovery).toEqual([{ tool: 'mc_events', arguments: { after: 0, run: journal.run, waitMs: 0 } }]);
      const recovered = await client.callTool({ name: meta.recovery[0].tool, arguments: meta.recovery[0].arguments });
      expect(recovered.isError).not.toBe(true);
      const page = JSON.parse((recovered.structuredContent as any).text);
      expect(page).toMatchObject({ run: journal.run, nextCursor: 1, gap: false });
      expect(page.events).toHaveLength(1);
    }
    expect(journal.store.latestCursor()).toBe(1); // Recovery never mutates or manufactures events.
    expect(runtime.status().phase).toBe('disconnected');
  } finally {
    await client.close(); await server.close(); await runtime.disconnect();
    expect(dirname(dir)).toBe(resolve(tmpdir())); expect(dir.split(/[\\/]/).at(-1)).toMatch(/^event-cursor-recovery-/);
    await rm(dir, { recursive: true, force: true });
  }
});

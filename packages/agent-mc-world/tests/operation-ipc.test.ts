import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MinecraftWorldProxy } from '../core/proxy.ts';
import { WorldOperationLearning } from '../src/client/world-learning.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { OperationExperienceBook } from '../core/operation-experience.ts';
import { FakeHost } from './method-host.ts';
import type { ToolOutcome } from '../src/contracts/host.ts';

const scope = { realm: 'fixture-realm', account: 'offline:fixture', agent: 'fixture' };
it.each(['direct World', 'SDK'] as const)('%s records execution-correlated facts across the real child IPC boundary', async adapter => {
  const data = mkdtempSync(join(tmpdir(), 'mc-operation-ipc-'));
  const oldOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--import=${new URL('./fixtures/deny-network.mjs', import.meta.url).href}`;
  const cfg = structuredClone(MINECRAFT_CLIENT_DEFAULTS);
  cfg.host = 'offline.invalid'; cfg.username = 'fixture';
  const proxy = new MinecraftWorldProxy({ cfg, dataDir: data,
    extension: { module: new URL('./fixtures/operation-engine.mjs', import.meta.url).href,
      tools: [{ name: 'mc_fixture_finish', description: '', parameters: {}, tags: ['sense'] }] } });
  const learning = new WorldOperationLearning(data, () => proxy.requestFacts());
  const client = new MinecraftAgentClient({ dataDir: data, cfg, log: nullLogger() }, proxy);
  const host = new FakeHost();
  const book = new OperationExperienceBook(join(data, 'minecraft-memory'));
  let sequence = 0;
  const call = async (name: string, args: Record<string, unknown>, requestId: string): Promise<ToolOutcome> => {
    if (adapter === 'SDK') return client.call(name, args, requestId);
    return await learning.tools(proxy.tools()).find(t => t.name === name)!.handler(args,
      { role: 'main', log: host.log, callId: requestId }) as ToolOutcome;
  };
  try {
    if (adapter === 'SDK') await client.connect();
    else await proxy.start(learning.start(host));
    const act = async (mode: string) => {
      const requestId = `${mode}-${++sequence}`;
      const out = await call('mc_do', { skill: 'goto', mode, id: `fixture:${requestId}` }, requestId);
      expect(out.text).toBe('original outcome');
      return (out.meta!.experience as { id: string }).id;
    };
    const early = await act('early');
    expect(book.get(scope, early)).toMatchObject({ execution: { terminal: true },
      before: { position: { x: 0 } }, after: { position: { x: 3 }, inventory: { stone: 3 } }, goalVerified: false });
    // The later RPC response must not overwrite a previously recorded terminal.
    expect(proxy.requestFacts()?.experience?.observation.position?.x).toBe(9);
    const later = await act('later');
    expect(book.get(scope, later)).toMatchObject({ execution: { terminal: false }, after: { position: { x: 11 } } });
    await call('mc_fixture_finish', {}, 'finish');
    expect(book.get(scope, later)).toMatchObject({ execution: { terminal: true }, after: { position: { x: 13 }, inventory: { stone: 13 } } });
    expect(proxy.requestFacts()?.experience?.observation.position?.x).toBe(15);
    const sync = await act('sync');
    expect(book.get(scope, sync)).toMatchObject({ execution: { terminal: true }, after: { position: { x: 17 } } });
    for (const mode of ['missing', 'broken', 'early-broken']) {
      await call('mc_fixture_finish', { reset: true }, `reset-${mode}`);
      const id = await act(mode);
      expect(book.get(scope, id)).toMatchObject({ execution: { terminal: true }, after: null });
      expect(proxy.requestFacts()).toBeNull();
    }
    await call('mc_fixture_finish', { reset: true }, 'reset-throws');
    const failed = await call('mc_do', { mode: 'throws' }, 'throws');
    expect(failed).toMatchObject({ failed: true, text: expect.stringContaining('original dispatch failure') });
    expect(proxy.requestFacts()).toBeNull();
  } finally {
    if (adapter === 'SDK') await client.disconnect();
    else { await proxy.stop(); learning.stop(); }
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
    rmSync(data, { recursive: true, force: true });
  }
}, 30_000);

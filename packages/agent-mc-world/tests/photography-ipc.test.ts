import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MinecraftClientWorld } from '../src/client/world.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

it('transfers uploaded reference images, originals and native completion receipts through a real offline engine child', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mc-photo-ipc-')), previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--import=${new URL('./fixtures/deny-network.mjs', import.meta.url).href}`;
  const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Fixture',
    photography: { provider: 'volcengine' as const, endpoint: 'https://offline-image.invalid/api/native', model: 'doubao-seedream-4-5-251128', apiKeyEnv: 'FIXTURE_PHOTO_KEY' } };
  const runtime = new MinecraftAgentClient({ cfg, dataDir: directory, autoAcknowledgeBarriers: true, log: nullLogger() }, new MinecraftClientWorld({ cfg, dataDir: directory,
    extension: { module: new URL('./fixtures/photography-engine.mjs', import.meta.url).href, tools: [] } }));
  const server = createMinecraftMcpServer(runtime, 'test'), client = new Client({ name: 'photo-ipc', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a); await client.connect(b); await runtime.connect();
    const captured = await client.callTool({ name: 'mc_photo', arguments: { action: 'capture', request_id: 'photo-ipc-1' } });
    expect(captured.isError).not.toBe(true);
    const body = captured.structuredContent as any;
    const image = (captured.content as any[]).find(value => value.type === 'image');
    const uploaded = await client.callTool({ name: 'mc_artifact', arguments: { action: 'put', mime: image.mimeType, base64: image.data } });
    expect(uploaded.isError).not.toBe(true);
    const reference = JSON.parse((uploaded.content as any[])[0].text);
    const request = { action: 'enhance', source_id: body.execution.id, prompt: 'Improve the captured village, preserving its scene', reference_handles: [reference.handle], request_id: 'photo-ipc-2' };
    const accepted = await client.callTool({ name: 'mc_photo', arguments: request });
    expect(accepted.isError).not.toBe(true);
    const job = (accepted.structuredContent as any).execution;
    expect(job).toMatchObject({ terminal: false, goalCompleted: false });
    let cursor = 0, completion: any;
    for (let i = 0; i < 20 && !completion; i++) {
      const events = await runtime.events({ after: cursor, run: runtime.journal.run, waitMs: 100 }); cursor = events.nextCursor;
      completion = events.events.find(event => event.type === 'minecraft.photo');
    }
    expect(completion).toMatchObject({ execution: { id: job.id, terminal: true, phase: 'completed', goalCompleted: false },
      meta: { photography: { providerRequestId: 'native-ipc-request', usage: { generated_images: 1 } } } });
    expect(runtime.journal.blob(completion.blobs[0].handle)?.mime).toBe('image/png');
    const dedup = await client.callTool({ name: 'mc_photo', arguments: request });
    expect((dedup.structuredContent as any).meta.photography.usage.generated_images).toBe(1);
    const invalid = await client.callTool({ name: 'mc_artifact', arguments: { action: 'put', mime: 'image/png', base64: Buffer.from('not an image').toString('base64') } });
    expect(invalid.isError).toBe(true);
  } finally {
    await runtime.disconnect(); await client.close(); await server.close();
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

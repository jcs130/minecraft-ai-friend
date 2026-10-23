import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MinecraftClientWorld } from '../src/client/world.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

it('transfers originals and artifact handles, and rejects relocated creation through a real offline engine child', async () => {
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
    expect(runtime.journal.blob(reference.handle)?.mime).toBe('image/png');
    const original = await client.callTool({ name: 'mc_photo', arguments: { action: 'read', id: body.execution.id } });
    expect(original.isError).not.toBe(true);
    expect((original.content as any[]).find(v => v.type === 'image').data).toBe(image.data);
    const moved = await client.callTool({ name: 'mc_photo', arguments: { action: 'enhance', source_id: body.execution.id, request_id: 'old-call', prompt: 'a village' } });
    expect(moved.isError).toBe(true);
    expect(JSON.parse((moved.content as any[]).find(v => v.type === 'text').text).code).toBe('capability_moved');
    const invalid = await client.callTool({ name: 'mc_artifact', arguments: { action: 'put', mime: 'image/png', base64: Buffer.from('not an image').toString('base64') } });
    expect(invalid.isError).toBe(true);
  } finally {
    await runtime.disconnect(); await client.close(); await server.close();
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

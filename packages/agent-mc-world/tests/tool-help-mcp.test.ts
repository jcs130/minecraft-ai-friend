import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, withToolHelp } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import type { World } from '../src/contracts/host.ts';

it('serves complete parameter notes through actual MCP after advertising compact schemas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compact-tool-help-'));
  const parameters = { type: 'object', required: ['value'], properties: {
    value: { type: 'string', enum: ['one', 'two'], description: 'Complete original parameter notes' },
  } };
  const tools = withToolHelp([{ name: 'mc_echo', tags: ['read'], description: 'Read the supplied value', parameters,
    handler: async args => ({ text: String(args.value) }) }], 'mc_tool_help', { parameterDescriptions: 'on-demand' });
  const world: World = { id: 'minecraft', tools: () => tools, envPromptVars: () => null,
    start: async () => { throw new Error('Help must not connect a game'); }, stop: async () => {} };
  const runtime = new MinecraftAgentClient({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: dir, log: nullLogger() }, world);
  const server = createMinecraftMcpServer(runtime, 'fixture'), client = new Client({ name: 'schema-reader', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left); await client.connect(right);
    const advertised = (await client.listTools()).tools.find(tool => tool.name === 'mc_echo')!;
    expect((advertised.inputSchema.properties as any).value.description).toBeUndefined();
    const result = await client.callTool({ name: 'mc_tool_help', arguments: {
      name: 'mc_echo', path: '/properties/value', full: true,
    } });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.structuredContent as { text: string }).text).schema).toEqual(parameters.properties.value);
    expect(runtime.status().phase).toBe('disconnected');
  } finally {
    await client.close(); await server.close(); await runtime.disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});

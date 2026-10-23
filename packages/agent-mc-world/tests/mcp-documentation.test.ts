import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { Ajv } from 'ajv';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

it('validates documented MCP calls against advertised contracts and keeps discovery offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mc-doc-contract-'));
  const network = vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Documentation discovery must stay offline'); });
  const runtime = new MinecraftAgentClient({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: directory, log: nullLogger() });
  const server = createMinecraftMcpServer(runtime, 'documentation-check');
  const client = new Client({ name: 'documentation-reader', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left); await client.connect(right);
    const tools = (await client.listTools()).tools;
    const markdown = readFileSync(new URL('../docs/mcp.md', import.meta.url), 'utf8');
    const examples = [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
      .filter(value => typeof value.name === 'string' && value.arguments);
    expect(examples.length).toBeGreaterThanOrEqual(7);
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    for (const example of examples) {
      const tool = tools.find(tool => tool.name === example.name);
      expect(tool, `Documented tool is not advertised: ${example.name}`).toBeDefined();
      const validate = ajv.compile(tool!.inputSchema);
      expect(validate(example.arguments), `${example.name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      if (example.name === 'mc_tool_help' || example.name === 'mc_protocol' || example.name === 'mc_events'
          || example.name === 'mc_connection' && example.arguments.action === 'status') {
        const result = await client.callTool(example);
        expect(result.isError, `${example.name} must be a real offline read`).not.toBe(true);
      }
    }
    expect(runtime.status().phase).toBe('disconnected');
    expect(network).not.toHaveBeenCalled();
  } finally {
    await client.close(); await server.close(); await runtime.disconnect();
    network.mockRestore(); rmSync(directory, { recursive: true, force: true });
  }
});

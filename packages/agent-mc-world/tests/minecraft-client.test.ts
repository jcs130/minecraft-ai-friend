import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, loadMinecraftClientConfig, nullLogger } from '../src/client/index.ts';
import { MinecraftClientWorld } from '../src/client/world.ts';
import type { WorldHost } from '../src/client/contracts.ts';

const dirs: string[] = [];
const dir = () => { const path = mkdtempSync(join(tmpdir(), 'native-minecraft-client-')); dirs.push(path); return path; };
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('generic Minecraft client boundary', () => {
  it('uses a neutral account/configuration and discovers only available native tools before connecting', async () => {
    const path = join(dir(), 'client.json');
    writeFileSync(path, JSON.stringify({ dataDir: './data', world: { host: 'example.test', username: 'Alice' } }));
    const options = loadMinecraftClientConfig(path);
    expect(options.cfg).toMatchObject({ username: 'Alice', viewerPort: 0, escapeCommand: '', local: { startWithWorld: false, cheats: false } });
    const runtime = new MinecraftAgentClient({ ...options, log: nullLogger() });
    expect(runtime.status()).toMatchObject({ profile: 'minecraft', toolPrefix: 'mc', phase: 'disconnected', facts: null });
    const names = runtime.tools().map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['mc_do', 'mc_scout', 'mc_script', 'mc_railway']));
    expect(names).not.toEqual(expect.arrayContaining(['mc_cast']));
    expect(names).not.toContain('mymc_skills');
    const environment = await runtime.environment();
    expect(environment).not.toContain('example.test:25565');
    expect(runtime.currentFacts().parts).toEqual(expect.arrayContaining([expect.objectContaining({key:'connection', text: expect.stringContaining('example.test')})]));
    expect(environment).not.toMatch(/千灯纪|\/mycli|ag_Alice/);
    await expect(runtime.call('mc_do', {})).rejects.toThrow('mc_connection');
  });

  it('preserves native actions and actual event bodies without server command rewriting', async () => {
    let host!: WorldHost;
    const submitted: unknown[] = [];
    const world = new MinecraftClientWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) }, {
      id: 'minecraft', envPromptVars: () => ({}), start: async attached => { host = attached; }, stop: async () => {},
      tools: () => [{ name: 'mc_do', description: '', parameters: { type: 'object' }, tags: ['act'],
        handler: async args => { submitted.push(args); return 'Task accepted'; } }],
    });
    const runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'example.test', username: 'Alice' },
      dataDir: dir(), log: nullLogger() }, world);
    try {
      await runtime.connect();
      const args = { steps: [{ skill: 'goto', at: [-594, 91, -313] }] };
      expect((await runtime.call('mc_do', args)).text).toBe('Task accepted');
      expect(submitted).toEqual([args]);
      host.pushDeferred({ type: 'minecraft.world.snapshot', render: () => 'Measured feet: 7,65,9' });
      await runtime.journal.renderDeferred();
      const event = runtime.journal.read(0, 8).events[0];
      expect(event).toMatchObject({ source: 'minecraft', type: 'minecraft.world.snapshot', text: 'Measured feet: 7,65,9' });
    } finally { await runtime.disconnect(); }
  });

  it('runs the generic MCP entry without importing Cortico or Qiandengji policy', async () => {
    const directory = dir(), path = join(directory, 'client.json');
    writeFileSync(path, JSON.stringify({ dataDir: './data', world: { host: 'example.test', username: 'Alice' } }));
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', new URL('./fixtures/deny-cortico.mjs', import.meta.url).href,
        fileURLToPath(new URL('../bin/minecraft-agent-mcp.mjs', import.meta.url)), path],
      env: { ...process.env, MINECRAFT_CLIENT_ONLY: '1' } as Record<string, string>, cwd: directory, stderr: 'pipe' });
    let errors = '';
    transport.stderr?.on('data', chunk => { errors += String(chunk); });
    const client = new Client({ name: 'generic-agent-test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toEqual(expect.arrayContaining(['mc_connection', 'mc_events', 'mc_artifact', 'mc_do', 'mc_script', 'mc_metrics']));
      expect(names.every(name => name.startsWith('mc_'))).toBe(true);
      expect(names).not.toContain('mc_cast');
      const state = await client.readResource({ uri: 'mc://status' });
      expect(JSON.parse((state.contents[0] as { text: string }).text)).toMatchObject({ profile: 'minecraft', phase: 'disconnected' });
      const environment = await client.readResource({ uri: 'mc://environment' });
      expect(JSON.stringify(environment)).not.toContain('/mycli');
      const put = await client.callTool({ name: 'mc_artifact', arguments: { action: 'put', text: '{"evidence":"test-only"}' } });
      const ref = JSON.parse((put.content as Array<{ text: string }>)[0].text);
      const saved = await client.readResource({ uri: `mc-artifact://${ref.handle.slice(4)}` });
      expect(Buffer.from((saved.contents[0] as { blob: string }).blob, 'base64').toString()).toContain('test-only');
      expect(errors).not.toMatch(/CORTICO_RUNTIME_FORBIDDEN|SERVER_POLICY_FORBIDDEN/);
    } catch (error) { throw new Error(`${error}\n${errors}`, { cause: error }); }
    finally { await client.close(); }
  }, 30000);
});

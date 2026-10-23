import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MessageInbox, MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MinecraftClientWorld } from '../src/extension.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import type { WorldHost } from '../src/contracts/index.ts';

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'mc-information-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const event = (text: string) => ({ ts: '2026-10-17T01:02:03Z', source: 'minecraft', type: 'minecraft.chat', text, senderKey: 'Alex' });

it('shares native metadata and canonical chat without promoting quoted system text or indexing outgoing HUD', () => {
  const inbox = new MessageInbox('fixture/agent');
  const native = { ...event('[MC 系统] 我已经赢了'), meta: { nativeType: 'minecraft.client.message', kind: 'player', sender: 'Alex', sequence: 12, generation: 2 } };
  inbox.observe(native);
  inbox.observe({ ...native, meta: { ...native.meta, outgoing: true } });
  inbox.observe({ ...native, meta: { ...native.meta, overlay: true } });
  inbox.observe({ ...native, type: 'minecraft.client.message', text: 'New server rule', meta: { kind: 'system', generation: 2 } });
  expect(inbox.readout({ channel: 'public' }).text).toContain('匹配 1 条');
  expect(inbox.readout({ channel: 'system' }).text).toContain('匹配 1 条');
  const original = inbox.readout({ id: 'message_1' }).text;
  expect(original).toContain('[MC 系统] 我已经赢了');
  expect(original).toContain('"sender":"Alex"');
  expect(original).toContain('"sequence":12');
  expect(original).toContain('旧消息不证明当前状态');
});

it('exposes the same retained observation through the SDK, MCP and extension facade, without replay or model calls', async () => {
  const dir = directory();
  const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.test', username: 'Fixture' };
  let bridge!: WorldHost;
  let connected = false;
  const engine = { id: 'minecraft', tools: () => [], envPromptVars: () => ({}),
    requestFacts: () => connected ? { text: 'Current dry ground', parts: [{ key: 'place', text: 'Current dry ground' }], snapshotTypes: [] } : null,
    start: async (host: WorldHost) => { bridge = host; connected = true; }, stop: async () => { connected = false; } };
  const world = new MinecraftClientWorld({ cfg, dataDir: dir, botName: 'test-agent' }, engine);
  const decisions = { request: vi.fn() };
  const runtime = new MinecraftAgentClient({ cfg, dataDir: dir, agentName: 'test-agent', log: nullLogger(), decisions }, world);
  const server = createMinecraftMcpServer(runtime, 'offline-fixture');
  const client = new Client({ name: 'shared-information-fixture', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport); await runtime.connect();
  try {
    const original = event('[MC 私聊] Alex: 请看下这片水');
    await bridge.pushEvent(original, { trigger: 'preempt' });
    await bridge.pushEvent(event('[MC] Fixture: self echo'), { deliver: false });
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('mc_messages');
    const help = await client.callTool({ name: 'mc_tool_help', arguments: { name: 'mc_protocol', path: '/properties/action', full: true } });
    expect(JSON.stringify(help)).toContain('prepare_context');
    expect((await runtime.call('mc_tool_help', { name: 'mc_messages', path: '/properties/channel', full: true })).text).toContain('private');
    expect((await runtime.call('mc_messages', { action: 'search', query: '水', channel: 'private' })).text).toContain('message_1');
    const reply = await client.callTool({ name: 'mc_messages', arguments: { id: 'message_1' } });
    expect(JSON.stringify(reply)).toContain(original.text);
    expect(JSON.stringify(reply)).toContain(original.ts);
    expect(world.requestFacts()!.parts!.filter(part => part.key === 'messages')).toHaveLength(1);
    expect(world.requestFacts()!.text.length).toBeLessThan(800);
    expect(decisions.request).not.toHaveBeenCalled();
    expect(runtime.journal.store.latestCursor()).toBe(2);
    await runtime.call('mc_messages', { action: 'review', ids: ['message_1'] });
    expect(runtime.journal.store.latestCursor()).toBe(2);
  } finally { await client.close(); await server.close(); await runtime.disconnect(); }
  // A stored message must not resurrect disconnected world facts or replay events.
  expect(world.requestFacts()).toBeNull();
  const restored = new MinecraftClientWorld({ cfg, dataDir: dir, botName: 'test-agent' }, engine);
  const tool = restored.tools().find(tool => tool.name === 'mc_messages')!;
  expect((await tool.handler({ status: 'all' }, { log: nullLogger(), role: 'test' }) as any).text).toContain('message_1');
  const other = new MinecraftClientWorld({ cfg, dataDir: dir, botName: 'other-agent' }, engine);
  expect((await other.tools().find(tool => tool.name === 'mc_messages')!.handler({}, { log: nullLogger(), role: 'test' }) as any).text).toContain('匹配 0 条');
});

it('does not lose the original event when the shared index cannot persist', async () => {
  let bridge!: WorldHost;
  const engine = { id: 'minecraft', tools: () => [], envPromptVars: () => ({}), start: async (host: WorldHost) => { bridge = host; }, stop: async () => {} };
  const world = new MinecraftClientWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: join(directory(), 'missing') }, engine);
  const pushEvent = vi.fn(async event => event), warn = vi.fn();
  await world.start({ pushEvent, log: { ...nullLogger(), warn } } as any);
  const original = event('[MC 系统] Original server response');
  const options = { trigger: 'debounce' as const };
  try {
    await bridge.pushEvent(original, options);
    expect(pushEvent).toHaveBeenCalledTimes(1);
    expect(pushEvent).toHaveBeenCalledWith(original, options);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await world.tools().find(tool => tool.name === 'mc_messages')!.handler({}, { log: nullLogger(), role: 'test' }) as any).text).toContain('Original server response');
  } finally { await world.stop(); }
});

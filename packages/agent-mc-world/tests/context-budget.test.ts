import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, classifyWake, compactEvents, capModelText,
  compactToolSchema, WAKE_ACTIVE_GOAL } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { SKILL_STEP_SCHEMA, SKILL_SIGNATURE_DOC } from '../core/skills.ts';

const chat = (text: string, uname?: string, trigger = 'debounce') =>
  ({ type: 'mymc.chat', text, trigger, ...(uname ? { meta: { uname } } : {}) }) as any;
const self = { selfNames: ['ag_jojo', 'Jojo'] };

describe('classifyWake', () => {
  it('wakes on whispers and mentions only, not chat between other players', () => {
    expect(classifyWake(chat('[MC 私聊] ag_CorMy: 你好'), self)).toEqual({ wake: true, category: 'whisper' });
    expect(classifyWake(chat('[MC] ag_CorMy: 欢迎回来 Jojo~', 'ag_CorMy', 'flush'), self).category).toBe('mention');
    expect(classifyWake(chat('[MC] ag_CorMy: @ag_jojo 来一下', 'ag_CorMy'), self).wake).toBe(true);
    expect(classifyWake(chat('[MC] ag_CorMy: 小鱼早呀~ 天亮了', 'ag_CorMy'), self)).toEqual({ wake: false, category: 'chat-other' });
    expect(classifyWake(chat('[MC] ag_jojo: 大家好', 'ag_jojo'), self).wake).toBe(false);
    expect(classifyWake(chat('[MC 私聊发出] ag_jojo → ag_CorMy: 好'), self).wake).toBe(false);
    expect(classifyWake(chat('[MC 插件] 槽位1「技能罗盘」', undefined, 'flush'), self)).toEqual({ wake: false, category: 'system' });
  });
  it('ignores countdowns and ambient observations but wakes on danger', () => {
    const ev = (text: string, trigger: string) => ({ type: 'mymc.event', text, trigger }) as any;
    expect(classifyWake(ev('[Minecraft] ☆ 旅人顺风 | 1:25 状态条进度为 47%。', 'debounce'), self).wake).toBe(false);
    expect(classifyWake(ev('[Minecraft] LittleFish0510 在 12 格外走动。', 'flush'), self).wake).toBe(false);
    expect(classifyWake(ev('[Minecraft] 濒死!生命只剩 3/20；没有食物。', 'flush'), self)).toEqual({ wake: true, category: 'danger' });
    expect(classifyWake(ev('[Minecraft] 附近有僵尸×2。', 'piggyback'), self).wake).toBe(false);
  });
  it('wakes on task receipts only when the host says a goal is active', () => {
    const task = { type: 'minecraft.task', text: '[执行器] 任务#6 完成', trigger: 'flush' } as any;
    expect(classifyWake(task, self).wake).toBe(false);
    expect(classifyWake(task, { ...self, wakeOn: WAKE_ACTIVE_GOAL }).wake).toBe(true);
    expect(classifyWake({ type: 'minecraft.client.disconnected', text: 'x' } as any, self).wake).toBe(true);
  });
});

describe('context helpers', () => {
  it('bounds the event tail and caps model text', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ cursor: i, ts: '2026-10-19T22:23:25.021+08:00', type: 'mymc.chat',
      source: 'mymc', origin: 'external', text: 'MC_STATUS ' + '{"a":1}'.repeat(200), meta: { big: 'x'.repeat(999) } })) as any;
    const out = compactEvents(events, 10, 200);
    expect(out).toHaveLength(10); expect(out[0]).toMatchObject({ cursor: 20, at: '22:23:25' });
    expect(out[0].text!.length).toBeLessThanOrEqual(201); expect((out[0] as any).meta).toBeUndefined();
    expect(capModelText('y'.repeat(5000), 1500)).toMatch(/^y{1500}…\[truncated 3500 chars/);
  });
  it('collapses the mc_do field pool to the skill discriminator plus signatures', () => {
    const schema = { type: 'object', properties: { steps: { type: 'array', description: SKILL_SIGNATURE_DOC, items: SKILL_STEP_SCHEMA },
      queue: { type: 'string', enum: ['now', 'append'], description: 'long '.repeat(40) } }, required: ['steps'] };
    const { schema: slim, description } = compactToolSchema({ name: 'mc_do', description: 'Queue skills. ' + 'More detail. '.repeat(60) }, schema, { helpTool: 'mc_tool_help' });
    const steps = (slim as any).properties.steps;
    expect(steps.items.required).toEqual(['skill']);
    expect(steps.items.properties.skill.enum).toEqual((SKILL_STEP_SCHEMA as any).properties.skill.enum);
    expect(steps.items.additionalProperties).toBe(true);
    expect(steps.description).toContain('goto(');
    expect((slim as any).properties.queue.enum).toEqual(['now', 'append']);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(schema).length / 2);
    expect(description).toContain('mc_tool_help {"name":"mc_do"}');
  });
});

it('compact MCP catalogue advertises small schemas but validates and documents the exact ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compact-catalog-'));
  const runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'c' },
    dataDir: dir, log: nullLogger() });
  const full = createMinecraftMcpServer(runtime, 'fixture'), compact = createMinecraftMcpServer(runtime, 'fixture', { catalog: 'compact' });
  const list = async (server: ReturnType<typeof createMinecraftMcpServer>) => {
    const client = new Client({ name: 'reader', version: '1' }); const [l, r] = InMemoryTransport.createLinkedPair();
    await server.connect(l); await client.connect(r); return { client, tools: (await client.listTools()).tools };
  };
  try {
    const a = await list(full), b = await list(compact);
    const size = (tools: any[]) => JSON.stringify(tools).length;
    expect(size(b.tools)).toBeLessThan(size(a.tools) * 0.6);
    const doFull = a.tools.find(t => t.name === 'mc_do')!, doCompact = b.tools.find(t => t.name === 'mc_do')!;
    expect(JSON.stringify(doCompact).length).toBeLessThan(JSON.stringify(doFull).length / 2);
    const bad = await b.client.callTool({ name: 'mc_do', arguments: { steps: [{ skill: 'goto', distance: 999999 }] } });
    expect(bad.isError).toBe(true); expect(JSON.stringify(bad.content)).toContain('Invalid arguments');
    const help = await b.client.callTool({ name: 'mc_tool_help', arguments: { name: 'mc_do', path: '/properties/steps/items', full: true } });
    expect(JSON.parse((help.structuredContent as any).text).schema).toEqual(SKILL_STEP_SCHEMA);
    await a.client.close(); await b.client.close();
  } finally {
    await full.close(); await compact.close(); await runtime.disconnect(); await rm(dir, { recursive: true, force: true });
  }
});

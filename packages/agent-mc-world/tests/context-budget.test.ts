import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, classifyWake, compactEvents, capModelText,
  compactToolSchema, WAKE_ACTIVE_GOAL, MovementProgress, isIdleControlStep, compactFacts } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { SKILL_STEP_SCHEMA, SKILL_SIGNATURE_DOC } from '../core/skills.ts';

const chat = (text: string, uname?: string, trigger = 'debounce') =>
  ({ type: 'mymc.chat', text, trigger, ...(uname ? { meta: { uname } } : {}) }) as any;
const self = { selfNames: ['ag_jojo', 'Jojo'] };

describe('classifyWake', () => {
  it('offers public player conversation to the model, retaining self/system suppression and explicit opt-out', () => {
    expect(classifyWake(chat('[MC 私聊] ag_CorMy: 你好'), self)).toEqual({ wake: true, category: 'whisper' });
    expect(classifyWake(chat('[MC] ag_CorMy: 欢迎回来 Jojo~', 'ag_CorMy', 'flush'), self).category).toBe('mention');
    expect(classifyWake(chat('[MC] ag_CorMy: @ag_jojo 来一下', 'ag_CorMy'), self).wake).toBe(true);
    expect(classifyWake(chat('[MC] ag_CorMy: 小鱼早呀~ 天亮了', 'ag_CorMy'), self)).toEqual({ wake: true, category: 'chat-other' });
    expect(classifyWake(chat('[MC] ag_CorMy: 天亮了', 'ag_CorMy'), {...self,wakeOn:['mention','whisper']})).toEqual({wake:false,category:'chat-other'});
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
  it('continues from method terminals while keeping progress, archived and idle notifications quiet', () => {
    for (const prefix of ['minecraft', 'mymc']) {
      const terminal = { type: `${prefix}.method`, text: 'method ended', trigger: 'flush',
        execution: { kind: 'method', id: 'fixture:7', phase: 'blocked', terminal: true, goalCompleted: false } } as const;
      const active = { ...self, wakeOn: WAKE_ACTIVE_GOAL };
      expect(classifyWake(terminal, active)).toEqual({ wake: true, category: 'task' });
      expect(classifyWake(terminal, self).wake).toBe(false);
      expect(classifyWake({ ...terminal, trigger: 'piggyback' }, active).wake).toBe(false);
      expect(classifyWake({ ...terminal, contextDelivery: 'archive-only' }, active).wake).toBe(false);
      expect(classifyWake({ ...terminal, execution: { ...terminal.execution, terminal: false } }, active).wake).toBe(false);
      expect(classifyWake({ ...terminal, execution: undefined }, active).wake).toBe(false);
    }
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

describe('MovementProgress', () => {
  const goto = (x: number, z: number) => [{ skill: 'goto', at: [x, 67, z] }];
  it('flags many movement-only calls inside one small area', () => {
    const progress = new MovementProgress();
    let verdict;
    for (let i = 0; i < 6; i++) verdict = progress.record(goto(-536 + (i % 3) * 6, -450 + (i % 2) * 6));
    expect(verdict).toMatchObject({ streak: 6, repetitive: true });
    expect(verdict!.spread).toBeLessThanOrEqual(24);
  });
  it('does not flag a long straight walk to new ground, and real work or chat-only calls behave', () => {
    const progress = new MovementProgress();
    let verdict;
    for (let i = 0; i < 8; i++) verdict = progress.record(goto(i * 40, 0));
    expect(verdict!.repetitive).toBe(false);
    expect(progress.record([{ skill: 'chat', text: 'hi' }]).streak).toBe(8);
    expect(progress.record([{ skill: 'mine', at: [0, 60, 0] }]).streak).toBe(0);
  });
  it('counts idle sneak/jump control bursts as no progress (does not reset like real work)', () => {
    const progress = new MovementProgress({ window: 4 });
    let verdict;
    for (let i = 0; i < 4; i++) verdict = progress.record([{ skill: 'control', keys: ['sneak'], durationMs: 2000, mode: 'ground' }]);
    expect(verdict).toMatchObject({ streak: 4, repetitive: true, kind: 'control' });
    expect(progress.record([{ skill: 'control', keys: ['forward', 'jump'], durationMs: 500, mode: 'ground' }]).streak).toBe(5);
    expect(progress.record([{ skill: 'control', keys: ['forward'], durationMs: 500, mode: 'ground' }]).repetitive).toBe(false);
    expect(progress.record([{ skill: 'mine', at: [0, 60, 0] }]).streak).toBe(0);
  });
  it.each([
    {mode:'water',keys:[]},
    {mode:'water',keys:['jump']},
    {mode:'flight',keys:['jump']},
    {mode:'flight',keys:['sneak']},
    {mode:'ground',keys:['forward','jump']},
    {mode:'ground',keys:[],yawDeg:30},
    {mode:'ground',keys:['sneak'],pitchDeg:20},
  ])('does not call unknown swimming, flying, walking or turning motion idle: %j',control=>{
    const step={skill:'control',durationMs:500,...control},progress=new MovementProgress({window:4});
    expect(isIdleControlStep(step)).toBe(false);
    for(let i=0;i<4;i++)progress.record([step]);
    expect(progress.record([step])).toMatchObject({streak:5,repetitive:false});
    expect(progress.record([step])).not.toHaveProperty('kind');
  });
  it('keeps malformed or absent control keys unknown and preserves mixed productive work',()=>{
    for(const keys of [undefined,null,{},[1],['sneak',1],['unexpected']])
      expect(isIdleControlStep({skill:'control',keys})).toBe(false);
    const progress=new MovementProgress({window:2});
    progress.record([{skill:'control',keys:['sneak']}]);
    expect(progress.record([{skill:'control',keys:['sneak']},{skill:'place',at:[1,64,2]}])).toMatchObject({streak:0,repetitive:false});
  });
});

it('compact catalogue collapses deep wide unions such as goal verify conditions', () => {
  const condition = { type: ['object', 'array', 'null'], required: ['source'], properties: {
    source: { type: 'string', enum: ['block', 'inventory'] }, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, { type: 'string', description: 'long note' }])) } };
  const schema = { type: 'object', properties: { add: { type: 'object', properties: { text: { type: 'string' },
    plan: { type: 'array', items: { type: 'object', properties: { do: { type: 'string' }, verify: { ...condition, items: { type: 'object', required: ['source'], properties: condition.properties } } } } } } } } };
  const { schema: slim } = compactToolSchema({ name: 'mc_goal' }, schema);
  const verify = (slim as any).properties.add.properties.plan.items.properties.verify;
  expect(verify).toEqual({ type: ['object', 'array', 'null'], properties: { source: { type: 'string', enum: ['block', 'inventory'] } }, required: ['source'], additionalProperties: true,
    items: { type: 'object', properties: { source: { type: 'string', enum: ['block', 'inventory'] } }, required: ['source'], additionalProperties: true } });
});

it('compactFacts drops host hashes and duplicates and inlines JSON parts', () => {
  const facts = { protocol: 'agent-mc/v1', run: 'r1', decisionStability: { sampledAtMs: 1, position: [1.23456, 2, 3] },
    observation: { at: 'T', dimension: 'minecraft:overworld', position: { x: -491.505999, y: 69, z: -451.5 }, health: 20, food: 19, inventory: { compass: 1 } },
    parts: [{ key: 'clock', text: '{"night":true}', revision: 'a'.repeat(64), original: 'log:' + 'b'.repeat(64) },
      { key: 'life', text: '', revision: 'c', original: 'd' }, { key: 'messages', text: '没有新消息', revision: 'e', original: 'f' }] };
  expect(compactFacts(facts)).toEqual({ run: 'r1', at: 'T', dimension: 'minecraft:overworld', position: [-491.5, 69, -451.5], health: 20, food: 19,
    inventory: { compass: 1 }, clock: { night: true }, messages: '没有新消息' });
});

it('collapsed field pools keep enums and array shapes of optional fields', () => {
  const pool = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, { type: 'string', description: 'x' }]));
  const schema = { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', required: ['skill'], properties: { skill: { type: 'string', enum: ['observe'] },
    mode: { type: 'string', enum: ['sites', 'voxels'], description: 'long' }, bounds: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'integer' } },
    keys: { type: 'array', items: { type: 'string', enum: ['jump'] } }, ...pool } } } } };
  const items = (compactToolSchema({ name: 't' }, schema).schema as any).properties.steps.items;
  expect(items.properties).toEqual({ skill: { type: 'string', enum: ['observe'] }, mode: { type: 'string', enum: ['sites', 'voxels'] },
    bounds: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'integer' } }, keys: { type: 'array', items: { type: 'string', enum: ['jump'] } } });
});

it('MovementProgress counts repeated look-arounds that report nothing new', async () => {
  const { observationDigest } = await import('../src/client/index.ts');
  const progress = new MovementProgress();
  progress.record([{ skill: 'goto', at: [0, 64, 0] }]);
  expect(progress.recordObservation(observationDigest('[00:01] 附近: 村民 3, 铁傀儡 1 at (-5, 64, 2)')).streak).toBe(1);
  let verdict;
  for (let i = 0; i < 5; i++) verdict = progress.recordObservation(observationDigest(`[00:0${i + 2}] 附近: 村民 3, 铁傀儡 1 at (-${i}, 64, 2)`));
  expect(verdict).toMatchObject({ streak: 6, repetitive: true });
  expect(progress.recordObservation(observationDigest('发现一个洞穴入口')).streak).toBe(6);
  expect(progress.record([{ skill: 'mine', at: [0, 60, 0] }]).streak).toBe(0);
});

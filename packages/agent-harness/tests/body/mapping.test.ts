/**
 * Per-body mapping fidelity: unified verbs/events ↔ each body's REAL vocabulary (checked against the original sources).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSteps, SKILL_NAMES } from '../../../agent-mc-world/core/skills.ts';
import { MAID_TOOL, maidCommand } from '../../../../paper/integrations/touhou-maids/agent/maid-port.mjs';
import { classifyMineflayerEvent, decodeMcbotFrame, encodeMcbotFrame, MaidBodyAdapter, MCBOT_TOOLS, McbotNumenPort, MineflayerBodyAdapter,
  NumenBodyAdapter, numenHostedAdapter, toMcEvent, type ActionVerb, type BodyEvent, type MineflayerClientLike } from '../../src/index.ts';
import { until } from '../helpers.ts';
import { fakeMaidServer, fakeMcbotServer, MAID, numenHostedDriver } from './drivers.ts';

const PAPER = join(import.meta.dirname, '../../../../paper/integrations');

const SAMPLE: Partial<Record<ActionVerb, Record<string, unknown>>> = {
  move: { x: 1, y: 64, z: 2 }, follow: { player: 'Steve' }, look: { at: [1, 65, 2] }, chat: { text: 'hi' }, interact: { x: 1, y: 64, z: 2 },
  use_item: { item: 'bread' }, attack: { target: 'zombie' }, mine: { x: 1, y: 63, z: 2 }, collect: { block: 'oak_log', count: 3 },
  place: { item: 'cobblestone', x: 1, y: 64, z: 3 }, craft: { item: 'stick', count: 4 }, smelt: { input: 'iron_ore', fuel: 'coal', count: 1 },
  equip: { item: 'iron_sword' }, eat: { item: 'bread' }, drop: { item: 'dirt', count: 2 }, pickup: { item: 'apple' },
  transfer: { direction: 'take', item: 'coal', count: 2, x: 1, y: 64, z: 2 }, flee: { distance: 16 }, observe: {}, inventory: {},
};

describe('mineflayer adapter ↔ agent-mc-world', () => {
  function fakeClient() {
    const calls: Array<{ name: string; args: Record<string, unknown>; bodyKey?: object }> = [];
    const client: MineflayerClientLike = { toolPrefix: 'mc', connect: async () => {}, disconnect: async () => {},
      status: () => ({ phase: 'started', connection: { ready: true, phase: 'online' }, facts: { parts: [
        { key: 'place', text: '生物群系：平原，脚下是草方块，站在格 (12, 64, -7)，主世界，世界 minecraft:overworld。静止，面朝北。' },
        { key: 'body', text: '健康（生命 18/20），饱（饥饿 19/20）。' }], world: { key: 'minecraft:overworld', dimensionType: 'minecraft:overworld' },
        experience: { scope: { realm: 'r', account: 'offline:Komi', agent: 'komi' } } } }),
      call: async (name, args, o) => { calls.push({ name, args, bodyKey: o?.bodyKey }); return { text: 'ok', execution: { kind: 'task', id: `t${calls.length}`, phase: 'accepted', terminal: false } }; } };
    return { client, calls };
  }

  it('every declared verb maps to a step agent-mc-world parseSteps accepts, sent with the exclusive bodyKey', async () => {
    const key = {}; const { client, calls } = fakeClient();
    const body = new MineflayerBodyAdapter({ username: 'Komi', bodyKey: key }).attach(client);
    const caps = body.capabilities();
    for (const verb of Object.keys(caps.actions) as ActionVerb[]) {
      if (verb === 'stop') continue;
      const r = await body.act({ verb, args: SAMPLE[verb] ?? {} });
      expect(['accepted', 'completed'], `${verb}: ${r.text}`).toContain(r.status);
      const call = calls.at(-1)!;
      expect(call.bodyKey).toBe(key);
      if (call.name === 'mc_do') expect('error' in parseSteps(call.args.steps)).toBe(false);
    }
    expect(calls.map(c => c.name)).toContain('mc_observe');
    expect(calls.map(c => c.name)).toContain('mc_bag');
  });

  it('exposes every agent-mc-world skill as a native action with its own schema; bad native steps are rejected by parseSteps', async () => {
    const { client, calls } = fakeClient();
    const body = new MineflayerBodyAdapter({ username: 'Komi' }).attach(client);
    const names = body.capabilities().nativeActions.map(n => n.name);
    for (const s of SKILL_NAMES) expect(names).toContain(`skill:${s}`);
    expect(names).toContain('tool:mc_scout');
    expect((await body.act({ verb: 'native', name: 'skill:fish', args: {} })).status).toBe('accepted');
    const bad = await body.act({ verb: 'native', name: 'skill:goto', args: { at: 'nowhere?' } });
    expect(bad.status).toBe('rejected');
    expect(calls.length).toBe(1);
  });

  it('snapshot parses the client fact parts; events are classified from real envelope shapes', async () => {
    const { client } = fakeClient();
    const body = new MineflayerBodyAdapter({ username: 'Komi' }).attach(client);
    const s = await body.snapshot();
    expect(s).toMatchObject({ position: { x: 12, y: 64, z: -7 }, health: 18, maxHealth: 20, food: 19, dimension: 'minecraft:overworld', lifeState: 'alive' });
    const k = (type: string, text: string, meta: Record<string, unknown> = {}) => classifyMineflayerEvent({ type, ts: '', text, meta }, 'Komi').kind;
    expect(k('minecraft.chat', '[MC 私聊] Steve: hi', { uname: 'Steve' })).toBe('whisper');
    expect(k('minecraft.chat', 'Steve: hi', { uname: 'Steve' })).toBe('chat');
    expect(k('mymc.chat', '公告', { channel: 'system' })).toBe('system_message');
    expect(k('minecraft.enter', 'Steve 进服', { uname: 'Steve' })).toBe('player_join');
    expect(k('minecraft.leave', 'Steve 离开', { uname: 'Steve' })).toBe('player_leave');
    expect(k('minecraft.event', '你死了', { death: { cause: { text: 'x' } } })).toBe('death');
    expect(k('minecraft.event', '[Minecraft] 已收到重生后的生命读数。', { deathLifecycle: { phase: 'alive' } })).toBe('respawn');
    expect(k('minecraft.event', '[Minecraft] 升到 12 级')).toBe('level');
    expect(k('minecraft.event', '[Minecraft] 濒死!生命只剩 2')).toBe('health');
    expect(k('minecraft.event', '世界已切换', { worldTransition: { from: 'a', to: 'b' } })).toBe('dimension');
    expect(k('minecraft.event', '[Minecraft] 服务器停了,世界下线')).toBe('server_status');
    expect(k('minecraft.client.disconnected', 'bye')).toBe('connection');
    expect(classifyMineflayerEvent({ type: 'minecraft.task', ts: '', text: 'done', execution: { kind: 'task', id: 't', phase: 'completed', terminal: true } }, 'Komi').kind).toBe('action_result');
  });
});

describe('numen adapters ↔ numen-hosting / mcbot', () => {
  it('hosted_body: capabilities come from the real Numen catalog (say→chat, lua/skill/todo/memory/guide native)', async () => {
    const d = await numenHostedDriver();
    try {
      await d.body.spawn();
      const c = d.body.capabilities();
      expect(Object.keys(c.actions).sort()).toEqual(['chat', 'observe']);
      expect(c.nativeActions.map(n => n.name).sort()).toEqual(['guide', 'lua', 'memory', 'say', 'skill', 'todo']);
      expect(c.transport).toBe('numen-hosted');
      expect(d.body.identity()).toMatchObject({ kind: 'numen', bodyId: '00000000-0000-0000-0000-0000000000a1', ownerId: '00000000-0000-0000-0000-0000000000b2' });
      const obs = await d.body.act({ verb: 'observe' });
      expect(obs).toMatchObject({ status: 'completed', text: 'Kirito stands in a meadow.' });
      const snap = await d.body.snapshot();
      expect(snap).toMatchObject({ position: { x: 10, y: 64, z: 10 }, health: 20, food: 18, lifeState: 'alive' });
      expect((await d.body.stop()).status).toBe('unsupported');
    } finally { await d.close(); }
  });

  it('numenHostedAdapter() wires numen-hosting numenCorePort without copying it', async () => {
    const hosting = { status: () => ({ state: 'ready', mode: 'harness', epoch: 7 }), boot: 'b',
      body: { observe: async () => ({ text: 'ok', sampledAt: 1, roleUuid: 'u-1', serverId: 's', ready: true }), catalog: async () => ({ tools: [{ name: 'say', description: '', parameters: {} }] }) },
      call: async (_r: unknown, a: { id: string }) => ({ id: a.id, state: 'completed', message: 'said' }), reconcile: async () => null };
    const body = await numenHostedAdapter({ hosting, role: { serverId: 's', roleUuid: 'u-1', name: 'N' }, epoch: 7, pollMs: 0, resultPollMs: 0 });
    await body.spawn();
    expect((await body.act({ verb: 'chat', args: { text: 'hi' } })).status).toBe('completed');
    expect(body.identity()!.generation).toBe('7');
  });

  it('mcbot: tool set and argument names match the Paper plugin source (Policy.java / Toolbox.java)', () => {
    const policy = readFileSync(join(PAPER, 'mcbot/src/org/qiandengji/mcbot/Policy.java'), 'utf8');
    const tools = [.../TOOLS=Set\.of\(([^)]*)\)/s.exec(policy)![1]!.matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort();
    expect(Object.keys(MCBOT_TOOLS).sort()).toEqual(tools);
    const java = readFileSync(join(PAPER, 'mcbot/src/org/qiandengji/mcbot/Toolbox.java'), 'utf8') + readFileSync(join(PAPER, 'mcbot/src/org/qiandengji/mcbot/Containers.java'), 'utf8');
    const declared = new Set([...java.matchAll(/Policy\.keys\(a((?:,"[a-z_]+")*)\)/g)].flatMap(m => [...m[1]!.matchAll(/"([a-z_]+)"/g)].map(x => x[1]!)));
    for (const [name, t] of Object.entries(MCBOT_TOOLS)) for (const a of t.args) expect(declared.has(a), `${name}.${a}`).toBe(true);
  });

  it('mcbot: frames are varint-length-prefixed JSON like Wire.java; verbs map to plugin argument names', async () => {
    const frame = encodeMcbotFrame({ kind: 'tool_call', seq: 1, tool: 'status', args: {} });
    expect(frame[0]).toBe(frame.length - 1);
    expect(decodeMcbotFrame(frame)).toMatchObject({ kind: 'tool_call', tool: 'status' });
    expect(decodeMcbotFrame(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBeNull();
    expect(() => encodeMcbotFrame({ kind: 'x', pad: 'a'.repeat(40000) })).toThrow();
    const server = fakeMcbotServer();
    const port = new McbotNumenPort({ connection: server.conn, name: 'Asuna', serverId: 'qd', timeoutMs: 1000 });
    const body = new NumenBodyAdapter({ port, pollMs: 0, resultPollMs: 0 });
    await body.spawn();
    expect(server.sent.map(m => m.kind).slice(0, 2)).toEqual(['summon', 'task_begin']);
    const cases: Array<[ActionVerb, Record<string, unknown>, string, Record<string, unknown>]> = [
      ['move', { x: 1, y: 2, z: 3, walkOnly: true }, 'move_to', { x: 1, y: 2, z: 3, walk_only: true }],
      ['follow', { targetUuid: '00000000-0000-0000-0000-00000000000f', seconds: 30 }, 'follow', { target_uuid: '00000000-0000-0000-0000-00000000000f', seconds: 30 }],
      ['attack', { entityId: 9, maxHits: 3 }, 'attack', { entity_id: 9, max_hits: 3 }],
      ['mine', { at: [4, 5, 6] }, 'break_block', { x: 4, y: 5, z: 6 }],
      ['place', { x: 1, y: 2, z: 3, item: 'stone' }, 'place_block', { x: 1, y: 2, z: 3, item: 'stone' }],
      ['transfer', { x: 1, y: 2, z: 3, direction: 'take', item: 'coal' }, 'transfer', { x: 1, y: 2, z: 3, dir: 'out', item: 'coal' }],
      ['eat', { slot: 4 }, 'consume', { slot: 4 }],
      ['interact', { x: 1, y: 2, z: 3 }, 'use_block', { x: 1, y: 2, z: 3 }],
      ['command', { command: '/mycli status' }, 'command', { command: '/mycli status' }],
    ];
    for (const [verb, args, tool, native] of cases) {
      await body.act({ verb, args });
      const sent = server.sent.filter(m => m.kind === 'tool_call').at(-1)!;
      expect(sent.tool).toBe(tool);
      expect(sent.args).toEqual(native);
      for (const k of Object.keys(native)) expect(MCBOT_TOOLS[tool]!.args).toContain(k);
    }
    expect((await body.act({ verb: 'follow', args: { player: 'Bob' } })).status).toBe('rejected');
    expect((await body.stop()).status).toBe('completed');
    expect(server.sent.at(-1)!.kind).toBe('cancel');
    await body.destroy();
    expect(server.sent.at(-1)!.kind).toBe('task_end');
  });
});

describe('maid adapter ↔ touhou-maids maid-port', () => {
  it('native actions are exactly MAID_TOOL actions; every unified verb becomes a /qdmaid command maidCommand accepts', async () => {
    const server = fakeMaidServer();
    const body = new MaidBodyAdapter({ connection: server.bot as never, serverId: 'qd', timeoutMs: 1000 });
    await body.spawn();
    expect(body.identity()).toMatchObject({ kind: 'maid', bodyId: MAID, name: 'Sakuya', ownerId: 'fce37da4-0183-4f20-a160-3fe49d871878' });
    expect(body.capabilities().nativeActions.map(n => n.name).sort()).toEqual([...(MAID_TOOL.parameters.properties.action as { enum: string[] }).enum].sort());
    const cases: Array<[ActionVerb, Record<string, unknown>, RegExp]> = [
      ['follow', {}, /^\/qdmaid follow /], ['stay', {}, /^\/qdmaid stay /], ['sit', {}, /^\/qdmaid sit /], ['recall', {}, /^\/qdmaid recall /],
      ['chat', { text: '你好' }, /^\/qdmaid speak .* 你好$/], ['equip', { hand: 'head', slot: 2 }, /^\/qdmaid equip .* head 2$/],
      ['transfer', { direction: 'put', slot: 1, count: 3, playerSlot: 5 }, /^\/qdmaid transfer .* put 1 3 5$/],
      ['craft', { workshopId: 'kitchen', recipeId: 'minecraft:bread' }, /^\/qdmaid make .* kitchen minecraft:bread once chest$/],
      ['pickup', { enabled: false }, /^\/qdmaid pickup .* false$/], ['observe', {}, /^\/qdmaid context /], ['inventory', {}, /^\/qdmaid inventory /],
    ];
    for (const [verb, args, re] of cases) {
      const r = await body.act({ verb, args });
      expect(['completed', 'accepted'], `${verb}: ${r.text}`).toContain(r.status);
      expect(server.commands.at(-1)).toMatch(re);
      expect(() => maidCommand(commandArgs(server.commands.at(-1)!))).not.toThrow();
    }
    expect((await body.act({ verb: 'follow', args: { player: 'Bob' } })).status).toBe('rejected');
    expect((await body.act({ verb: 'native', name: 'tasks' })).status).toBe('completed');
    expect(server.commands.at(-1)).toMatch(/^\/qdmaid tasks /);
    await body.destroy();
  });

  it('dialogue, lifecycle and chat-result envelopes become unified events / settle pending chats', async () => {
    const server = fakeMaidServer();
    const body = new MaidBodyAdapter({ connection: server.bot as never, serverId: 'qd', maidId: MAID, timeoutMs: 1000 });
    await body.spawn();
    const events: BodyEvent[] = [];
    body.subscribe(e => events.push(e));
    const send = (action: string, requestId: string, data: Record<string, unknown>) => server.bot._client.emit('custom_payload', { channel: 'qiandengji:maids',
      data: Buffer.from(JSON.stringify({ schema: 1, protocol: 'qiandengji-maids/v1', recipientUuid: 'fce37da4-0183-4f20-a160-3fe49d871878', action, requestId, ok: true, sampledAt: new Date().toISOString(), data })) });
    send('dialogue', 'ev-1', { maidId: MAID, eventId: `${MAID}:ev-1`, sessionKey: 's1', text: '主人回来啦', speaker: 'Visitor' });
    send('lifecycle', 'death-9', { maidId: MAID, lifeState: 'dead', death: { name: 'Sakuya', position: { x: 1, y: 2, z: 3 } } });
    send('lifecycle', 'rec-1', { maidId: MAID, lifeState: 'alive', recovery: { name: 'Sakuya', persisted: true } });
    await until(() => events.length >= 3);
    expect(events.map(e => e.kind)).toEqual(['dialogue', 'death', 'respawn']);
    const mc = toMcEvent(events[1]!, body);
    expect(mc.event).toMatchObject({ type: 'minecraft.event', meta: { death: { position: { x: 1, y: 2, z: 3 } } } });
    expect(mc.facts()).toMatchObject({ experience: { scope: { realm: 'qd', account: `maid:${MAID}` } } });
  });
});

/** Turn a recorded /qdmaid command back into maid-port args (to prove maidCommand accepts what the adapter produced). */
function commandArgs(command: string): Record<string, unknown> {
  const w = command.split(' '); const action = w[1]!, maidId = w[2]!, requestId = w[3]!, tail = w.slice(4);
  const base: Record<string, unknown> = { action, maidId, ...(['context', 'inventory'].includes(action) ? {} : { requestId }) };
  if (action === 'speak') base.text = tail.join(' ');
  if (action === 'equip') Object.assign(base, { hand: tail[0], slot: Number(tail[1]) });
  if (action === 'transfer') Object.assign(base, { direction: tail[0], slot: Number(tail[1]), count: Number(tail[2]), playerSlot: Number(tail[3]) });
  if (action === 'make') Object.assign(base, { workshopId: tail[0], recipeId: tail[1], inventory: tail[3] });
  if (action === 'pickup') base.enabled = tail[0] === 'true';
  return base;
}

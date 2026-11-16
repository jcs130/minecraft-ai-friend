/**
 * Contract-test drivers: each builds a REAL adapter over the body's REAL client/bridge code, with only the network edge faked.
 *  - mineflayer: agent-mc-world MinecraftAgentClient + offline fake World (createFakeWorld)
 *  - numen-hosted: numen-hosting HostedRoles + HostingStore (sqlite) + numenCorePort, fake hosted_body
 *  - numen-mcbot: McbotNumenPort over a fake owner connection answering like QiandengjiMcbot
 *  - maid: touhou-maids createMaidPort over a fake owner connection answering like the maid bridge
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../../../agent-mc-world/src/client/index.ts';
import { createRequire } from 'node:module';
import { HostedRoles } from '../../../../paper/integrations/numen-hosting/src/hosting.mjs';
import { PROTOCOL as HOSTED_PROTOCOL } from '../../../../paper/integrations/numen-hosting/src/protocol.mjs';
import { MAID_CHANNEL, MAID_REQUEST_CHANNEL } from '../../../../paper/integrations/touhou-maids/agent/maid-port.mjs';
import { createFakeWorld, decodeMcbotFrame, encodeMcbotFrame, MaidBodyAdapter, MCBOT_C2S, MCBOT_S2C, McbotNumenPort, MineflayerBodyAdapter,
  NumenBodyAdapter, type ActionVerb, type BodyAction, type BodyAdapter, type GuardedBody, type NumenBodyPort } from '../../src/index.ts';
import { until } from '../helpers.ts';

export interface BodyDriver {
  name: string;
  body: BodyAdapter;
  sent(): number;
  supported: BodyAction;
  motion: BodyAction;
  invalid: BodyAction;
  unsupportedVerb: ActionVerb;
  finish(): Promise<void>;
  kill(): Promise<void>;
  serverWarning(guard: GuardedBody, text: string): Promise<void>;
  close(): Promise<void>;
}

// numen-hosting's store uses `node:sqlite`, which vite 5 cannot resolve; load that one module natively (Node ≥22.12 require(esm)).
const { HostingStore } = createRequire(import.meta.url)('../../../../paper/integrations/numen-hosting/src/store.mjs') as { HostingStore: new (path: string) => { close(): void } };

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

// ---------- mineflayer ----------
export async function mineflayerDriver(): Promise<BodyDriver> {
  const dataDir = tmp('body-mf-');
  const fake = createFakeWorld({ username: 'Komi', completeAfterMs: 40 });
  const bodyKey = Object.freeze({ owner: 'test' });
  const adapter = new MineflayerBodyAdapter({ username: 'Komi', bodyKey, serverId: 'fake-realm' });
  const client = new MinecraftAgentClient({ dataDir, log: nullLogger(), eventObservers: [adapter.observer],
    bodyGate: { key: bodyKey, expose: () => false },
    cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Komi' } }, fake.world as never);
  adapter.attach(client);
  return {
    name: 'mineflayer', body: adapter, sent: () => fake.calls.length,
    supported: { verb: 'chat', args: { text: 'hello' } },
    motion: { verb: 'move', args: { x: 10, y: 64, z: -3 } },
    invalid: { verb: 'move', args: { x: 'north' } },
    unsupportedVerb: 'sit',
    finish: async () => { await new Promise(r => setTimeout(r, 120)); },
    kill: async () => { await fake.push({ type: 'minecraft.event', text: '[Minecraft] 你死了', meta: { death: { id: 'd1', position: { x: 1, y: 2, z: 3 }, cause: { text: '摔死' } } } }); },
    serverWarning: async (_g, text) => { await fake.push({ type: 'minecraft.chat', text, meta: { channel: 'system' } }); },
    close: async () => { await client.disconnect().catch(() => {}); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

// ---------- numen (hosted_body via numen-hosting) ----------
const role = { ownerId: 'website-owner', serverId: 'test-world', roleUuid: '00000000-0000-0000-0000-0000000000a1',
  numenOwnerUuid: '00000000-0000-0000-0000-0000000000b2', name: 'Kirito' };
export async function numenHostedDriver(): Promise<BodyDriver> {
  const dir = tmp('body-numen-');
  const store = new HostingStore(join(dir, 'host.sqlite'));
  const response = { protocol: HOSTED_PROTOCOL, roleUuid: role.roleUuid, serverId: role.serverId, name: role.name, bodyKind: 'numen', fenced: true };
  const facts = { health: 20, maxHealth: 20, food: 18, dimension: 'minecraft:overworld', position: [10, 64, 10] as [number, number, number], workPending: false };
  let calls = 0;
  const body = {
    attach: async () => response,
    transition: async (_r: unknown, args: Record<string, unknown>) => ({ ...response, ...args }),
    input: async (_r: unknown, args: unknown) => args,
    call: async (_r: unknown, args: { id: string; tool: string }) => { calls++; facts.workPending = true; return { id: args.id, state: 'partial', message: `dispatched ${args.tool}` }; },
    result: async (_r: unknown, id: string) => ({ id, state: 'completed', message: 'original result' }),
    observe: async () => ({ roleUuid: role.roleUuid, serverId: role.serverId, sampledAt: Date.now(), ready: true, text: 'Kirito stands in a meadow.' }),
    facts: async () => ({ roleUuid: role.roleUuid, serverId: role.serverId, sampledAt: Date.now(), ...facts, position: [...facts.position] }),
    catalog: async () => ({ tools: ['lua', 'skill', 'todo', 'memory', 'guide', 'say'].map(name => ({ name, description: `native ${name}`, parameters: { type: 'object' } })) }),
  };
  let port: NumenBodyPort | null = null;
  const harness = { prepare: async () => {}, start: async (_r: unknown, o: { port: NumenBodyPort }) => { port = o.port; }, stop: async () => ({ stopped: true }) };
  const hosting = new HostedRoles({ store, body, harness, profiles: undefined, now: Date.now });
  await hosting.attach(role);
  const state = await hosting.switch(role, 'harness', { runtime: 'configured-hub' });
  // The hosting service hands its harness exactly this port (numenCorePort bound to the epoch); the adapter wraps it.
  const adapter = new NumenBodyAdapter({ port: port!, transport: 'numen-hosted', epoch: state.epoch, ownerId: role.numenOwnerUuid, pollMs: 0, resultPollMs: 0 });
  return {
    name: 'numen-hosted', body: adapter, sent: () => calls,
    supported: { verb: 'chat', args: { text: '你好' } },
    motion: { verb: 'native', name: 'lua', args: { code: 'move()' } },
    invalid: { verb: 'chat', args: {} },
    unsupportedVerb: 'move',
    finish: async () => { facts.workPending = false; await adapter.poll(); },
    kill: async () => { await adapter.poll(); facts.health = 0; await adapter.poll(); },
    serverWarning: async (g, text) => { g.feedServerText(text); await new Promise(r => setTimeout(r, 5)); },
    close: async () => { store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------- numen via mcbot plugin channel ----------
export function fakeMcbotServer(options: { companionUuid?: string } = {}) {
  const client = new EventEmitter() as EventEmitter & { write: (n: string, p: { channel: string; data: Buffer }) => void };
  const uuid = options.companionUuid ?? '00000000-0000-0000-0000-0000000000c3';
  const sent: Array<Record<string, unknown>> = [];
  const jobs: Array<{ seq: number; job: string; tool: string }> = [];
  let jobN = 0, alive = true;
  const reply = (m: Record<string, unknown>) => queueMicrotask(() => client.emit('custom_payload', { channel: MCBOT_S2C, data: encodeMcbotFrame(m) }));
  const state = (kind: string, text: string) => reply({ kind, companion: 'Asuna', companion_uuid: uuid, body_id: 'epoch-1', body_state: alive ? 'alive' : 'dead', text });
  client.write = (_n, p) => {
    if (p.channel !== MCBOT_C2S) return;
    const m = decodeMcbotFrame(p.data)!; sent.push(m);
    switch (m.kind) {
      case 'summon': state('summon_result', '原生身体已就绪'); break;
      case 'companion_status': state('companion_state', '本人同伴状态。'); break;
      case 'cancel': reply({ kind: 'cancel_ack', text: '本连接的取消已提交' }); break;
      case 'tool_call': {
        const tool = String(m.tool), seq = Number(m.seq);
        if (tool === 'status') reply({ kind: 'tool_result', seq, ok: true, feedback: 'status', data: { x: 5, y: 70, z: -2, dimension: 'minecraft:overworld', hp: alive ? 20 : 0, food: 17 } });
        else if (tool === 'inventory') reply({ kind: 'tool_result', seq, ok: true, feedback: 'inventory', data: { slots: [] } });
        else if (m.accept) { const job = `job-${++jobN}`; jobs.push({ seq, job, tool }); reply({ kind: 'job_ack', seq, job_id: job, tool, text: 'ACCEPTED' }); }
        else reply({ kind: 'tool_result', seq, ok: true, feedback: 'done', data: {} });
      }
    }
  };
  const conn = { _client: client as never };
  return {
    conn, sent, toolCalls: () => sent.filter(m => m.kind === 'tool_call' && !['status', 'inventory'].includes(String(m.tool))).length,
    finishJobs: () => { for (const j of jobs.splice(0)) reply({ kind: 'job_event', seq: j.seq, job_id: j.job, tool: j.tool, phase: 'done', text: `${j.tool} done`, data: {} }); },
    die: () => { alive = false; state('companion_state', '同伴死亡'); },
    system: (text: string) => reply({ kind: 'notice', text }),
  };
}
export async function numenMcbotDriver(): Promise<BodyDriver> {
  const server = fakeMcbotServer();
  const port = new McbotNumenPort({ connection: server.conn, name: 'Asuna', serverId: 'qiandengji', timeoutMs: 2000 });
  const adapter = new NumenBodyAdapter({ port, ownerId: '00000000-0000-0000-0000-0000000000d4', pollMs: 0, resultPollMs: 0 });
  return {
    name: 'numen-mcbot', body: adapter, sent: () => server.toolCalls(),
    supported: { verb: 'move', args: { x: 1, y: 70, z: 1 } },
    motion: { verb: 'attack', args: { entityId: 42 } },
    invalid: { verb: 'move', args: { x: 'a' } },
    unsupportedVerb: 'sit',
    finish: async () => { server.finishJobs(); await new Promise(r => setTimeout(r, 10)); },
    kill: async () => { server.die(); await new Promise(r => setTimeout(r, 10)); },
    serverWarning: async (_g, text) => { server.system(text); await new Promise(r => setTimeout(r, 10)); },
    close: async () => {},
  };
}

// ---------- Touhou Little Maid ----------
export const MAID = 'e3228ffc-eb42-441d-a08c-3e5948a307e8';
export const OWNER = 'fce37da4-0183-4f20-a160-3fe49d871878';
export function fakeMaidServer() {
  const bot = new EventEmitter() as EventEmitter & Record<string, any>;
  const client = new EventEmitter() as EventEmitter & Record<string, any>;
  bot._client = client; client.uuid = OWNER;
  const commands: string[] = [];
  let life = 'alive';
  const envelope = (action: string, requestId: string, data: Record<string, unknown>, ok = true) =>
    ({ schema: 1, protocol: 'qiandengji-maids/v1', recipientUuid: OWNER, action, requestId, ok, sampledAt: new Date().toISOString(), ...(ok ? { data } : { error: String(data.error) }) });
  const send = (v: unknown) => queueMicrotask(() => client.emit('custom_payload', { channel: MAID_CHANNEL, data: Buffer.from(JSON.stringify(v)) }));
  // The bridge accepts the same /qdmaid command as a chat command (before the plugin transport is confirmed) or a plugin message.
  const handle = (command: string) => {
    commands.push(command);
    const w = command.split(' '); const action = w[1]!;
    if (action === 'list') return send(envelope('list', w[2]!, { maids: [{ maidId: MAID, name: 'Sakuya' }] }));
    if (action === 'nearby') return send(envelope('nearby', w[2]!, { maids: [] }));
    const maidId = w[2]!, id = w[3]!;
    if (action === 'receipt') return send(envelope('receipt', w[4]!, { maidId, operationId: id, action: 'speak', status: 'completed' }));
    if (action === 'context') return send(envelope('context', id, { maidId, name: 'Sakuya', lifeState: life, dimension: 'minecraft:overworld', position: { x: 3, y: 65, z: 9 }, mode: 'follow' }));
    if (action === 'make') return send(envelope('make', id, { maidId, operationId: id, action: 'make', actorId: OWNER, status: 'reserved', goalCompleted: false }));
    if (action === 'inventory') return send(envelope('inventory', id, { maidId, usableSlotIndexes: [0, 1], slots: [] }));
    return send(envelope(action, id, { maidId }));
  };
  bot.chat = (text: string) => handle(text);
  client.write = (_name: string, p: { channel: string; data: Buffer }) => {
    if (p.channel === 'minecraft:register') { send(envelope('transport', 'transport', { requestChannel: MAID_REQUEST_CHANNEL, workshop: true, spellCast: true })); return; }
    if (p.channel === MAID_REQUEST_CHANNEL) handle((JSON.parse(p.data.toString('utf8')) as { command: string }).command);
  };
  return { bot, commands, writes: () => commands.filter(c => !/^\/qdmaid (list|nearby|context|inventory|receipt) /.test(c)).length,
    die: () => { life = 'dead'; send(envelope('lifecycle', 'death-1', { maidId: MAID, lifeState: 'dead', death: { name: 'Sakuya', position: { x: 3, y: 65, z: 9 } } })); },
    system: (text: string) => bot.emit('messagestr', text, 'system', null, null) };
}
export async function maidDriver(): Promise<BodyDriver> {
  const server = fakeMaidServer();
  const adapter = new MaidBodyAdapter({ connection: server.bot as never, serverId: 'qiandengji', timeoutMs: 2000 });
  return {
    name: 'maid', body: adapter, sent: () => server.writes(),
    supported: { verb: 'chat', args: { text: '欢迎回来' } },
    motion: { verb: 'follow', args: {} },
    invalid: { verb: 'chat', args: { text: '' } },
    unsupportedVerb: 'move',
    finish: async () => {},
    kill: async () => { server.die(); await until(() => adapter.lifecycle() === 'dead'); },
    serverWarning: async (g, text) => { g.feedServerText(text); await new Promise(r => setTimeout(r, 5)); },
    close: async () => {},
  };
}

export const DRIVERS: Array<[string, () => Promise<BodyDriver>]> = [
  ['mineflayer (agent-mc-world)', mineflayerDriver],
  ['numen hosted_body (numen-hosting)', numenHostedDriver],
  ['numen mcbot channel', numenMcbotDriver],
  ['touhou little maid (maid-port)', maidDriver],
];

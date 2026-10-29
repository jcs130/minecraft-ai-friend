import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MinecraftWorld } from '../core/world.ts';
import { GoalCheckpointBook, createGoalCheckpoint, restoreGoalCheckpoint } from '../src/client/index.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

const dirs: string[] = [];
function directory() { const d = mkdtempSync(join(tmpdir(), 'mc-goals-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
class World extends MinecraftWorld {
  map = 'map-a';
  goalsNow() { return this.goalTable().list; }
  protected realmKey() {return JSON.stringify([this.serverRealmKey(),this.map]);}
}
function world(dataDir?: string, fields: Record<string, unknown> = {}, botName = 'fixture') {
  return new World({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), ...fields }, dataDir, botName });
}
const call = (w: MinecraftWorld, args: Record<string, unknown>) => w.tools().find(t => t.name === 'mc_goal')!.handler(args, {} as never);
const plan = [{ do: 'Read the invitation', judgment: 'Original invitation receipt' },
  { do: 'Carry iron', verify: { source: 'inventory', item: 'iron_ingot', count: '>=3' } },
  { do: 'Arrive in the specified dimension', verify: { source: 'position', region: [[0, 50, 0], [4, 75, 4]], dimension: 'minecraft:the_nether' } }];

it.each([true,false])('retains server intentions across native maps while discarding spatial proof (disk=%s)',async disk=>{
  const dir=disk?directory():undefined,w=world(dir);await call(w,{add:{text:'Journey through the portal',plan}});
  const original=w.goalsNow()[0];original.plan.steps[1].state='verified';
  original.plan.steps[1].evidence={observedAt:42,connectionGeneration:1,realm:'old-map',dimension:'overworld',verdict:'ok',results:[]};
  w.map='map-b';expect(w.goalsNow()[0]).toMatchObject({text:'Journey through the portal',at:original.at});
  expect(w.goalsNow()[0].plan.steps[1]).toMatchObject({state:'pending',evidence:null});
  await call(w,{drop:1});w.map='map-a';expect(w.goalsNow()).toEqual([]);
  if(dir){const restored=world(dir);expect(restored.goalsNow()).toEqual([]);}
});

it('restores scoped goals with identity and host history, but without mechanical proof or body work', async () => {
  const dir = directory(), first = world(dir);
  await call(first, { add: { text: 'Prepare for a journey', current: 2, total: 3, plan } });
  await call(first, { milestone: { slot: 1, step: 1, judgment: 'Invite #123 observed at 12:00' } });
  const original = first.goalsNow()[0];
  // A real runtime may have verified current inventory. It must be re-read next session.
  original.plan.steps[1].state = 'verified';
  original.plan.steps[1].evidence = { observedAt: 42, connectionGeneration: 1, realm: 'old', dimension: 'overworld', verdict: 'ok', results: [] };
  const scope = { realm: 'fixture', account: 'offline:player', agent: 'fixture' };
  const checkpoint = createGoalCheckpoint(scope, [original]);
  const decoded = restoreGoalCheckpoint(checkpoint, scope)[0];
  expect(decoded.plan.steps[1]).toMatchObject({ state: 'pending', evidence: null, completedAt: null });
  expect(checkpoint.goals[0].plan.steps[1].state).toBe('verified'); // source evidence is not mutated
  const second = world(dir), restored = second.goalsNow()[0];
  expect(restored).toMatchObject({ slot: 1, revision: 1, text: original.text, at: original.at,
    realTime: original.realTime, progress: { current: 2, total: 3 }, recoveredAt: expect.any(Number) });
  expect(restored.plan.steps[0]).toMatchObject({ state: 'judged', evidence: { note: 'Invite #123 observed at 12:00' } });
  expect(restored.plan.steps[1].state).toBe('pending');
  expect(restored.plan.steps[2].verify?.[0]).toMatchObject({ region: { dimension: 'minecraft:the_nether' } });
  expect(JSON.stringify(await call(second, {}))).toContain('未重放动作');
  expect(String(JSON.stringify(await call(second, { done: 1 })))).toContain('还不能结案');
});

it('saves criteria-only revisions and removed goals rather than resurrecting old intentions', async () => {
  const dir = directory(), first = world(dir);
  await call(first, { add: { text: 'Prepare', plan } });
  await call(first, { revise: { slot: 1, expectedRevision: 1, text: 'Prepare', reason: 'New required amount',
    plan: [{ ...plan[1], verify: { source: 'inventory', item: 'iron_ingot', count: '>=7' } }] } });
  const second = world(dir);
  expect(second.goalsNow()[0]).toMatchObject({ revision: 2, plan: { steps: [{ verify: [{ count: { n: 7 } }] }] } });
  await call(second, { drop: 1 });
  expect(world(dir).goalsNow()).toEqual([]);
});

it.each([{ loaded: true }, { matched: '>=3' }, { loaded: false }])('round-trips the normalized optional blueprint predicate %j', async probe => {
  const dir = directory(), first = world(dir);
  const result = await call(first, { add: { text: 'Check the blueprint', plan: [
    { do: 'Inspect the current blueprint', verify: { source: 'blueprint', key: 'house', ...probe } },
  ] } });
  expect(JSON.stringify(result)).not.toContain('恢复记录未保存');
  expect(world(dir).goalsNow()[0].plan.steps[0].verify).toEqual(first.goalsNow()[0].plan.steps[0].verify);
});

it('isolates world, account and Agent while preserving five slots and no-dataDir behavior', async () => {
  const dir = directory(), first = world(dir);
  for (let i = 0; i < 5; i++) await call(first, { add: { text: `Project ${i}`, plan } });
  await call(first, { add: { text: 'Overflow', plan } });
  expect(world(dir).goalsNow()).toHaveLength(5);
  expect(world(dir, { host: 'another.example' }).goalsNow()).toEqual([]);
  expect(world(dir, { username: 'another' }).goalsNow()).toEqual([]);
  expect(world(dir, {}, 'another-agent').goalsNow()).toEqual([]);
  const transient = world(); await call(transient, { add: { text: 'Transient', plan } });
  expect(world().goalsNow()).toEqual([]);
});

it('retains a corrupt checkpoint and reports a failed save rather than overwriting recovery evidence', async () => {
  const dir = directory(), first = world(dir);
  await call(first, { add: { text: 'Kept original', plan } });
  const file = join(dir, 'minecraft-goals', readdirSync(join(dir, 'minecraft-goals'))[0]);
  writeFileSync(file, '{broken');
  const second = world(dir);
  expect(second.goalsNow()).toEqual([]);
  expect(JSON.stringify(await call(second, { add: { text: 'New intention', plan } }))).toContain('恢复记录未保存');
  expect(readFileSync(file, 'utf8')).toBe('{broken');
});

it('rejects a foreign or oversized checkpoint and explicit storage clear removes saved goals', async () => {
  const dir = directory(), w = world(dir);
  await call(w, { add: { text: 'Remember', plan } });
  const scope = { realm: 'a', account: 'b', agent: 'c' }, c = createGoalCheckpoint(scope, w.goalsNow());
  expect(() => restoreGoalCheckpoint(c, { ...scope, account: 'other' })).toThrow('scope mismatch');
  expect(() => restoreGoalCheckpoint({ ...c, goals: Array(6).fill(c.goals[0]) }, scope)).toThrow();
  new GoalCheckpointBook(join(dir, 'minecraft-goals')).clear();
  expect(world(dir).goalsNow()).toEqual([]);
});

it('the real SDK/MCP tool transport restores the goal without connecting Minecraft or scheduling an action', async () => {
  const dir = directory();
  for (const initial of [true, false]) {
    const w = world(dir), runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.test', username: 'fixture' }, dataDir: directory(), log: nullLogger() },
      { id: 'minecraft', start: async () => {}, stop: async () => {}, tools: () => w.tools().filter(t => t.name === 'mc_goal'), envPromptVars: () => ({}) });
    const server = createMinecraftMcpServer(runtime, 'test'), client = new Client({ name: 'goal-reader', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await runtime.connect(); await server.connect(a); await client.connect(b);
      const result = await client.callTool({ name: 'mc_goal', arguments: initial ? { add: { text: 'Transport goal', plan } } : {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain('Transport goal');
      if (!initial) expect(JSON.stringify(result)).toContain('意图恢复自');
      expect(w.goalsNow()).toHaveLength(1);
    } finally { await client.close(); await server.close(); await runtime.disconnect(); }
  }
});

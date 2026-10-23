import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';

it('reports trusted caller attribution for queued tasks without treating admission as movement or exposing chat', async () => {
  const h = methodHarness(), events: unknown[] = [];
  h.bot.on('viewer:decision', value => events.push(value));
  try {
    const before = h.bot.entity.position.clone();
    const outcome = await h.world.tools().find(t => t.name === 'mc_do')!.handler({
      source: 'system1', queue: 'append', steps: [{ skill: 'goto', at: [8, 64, 0] }, { skill: 'chat', text: 'PRIVATE_CHAT' }],
    }, { role: 'main', log: h.host.log });
    expect(outcome).toHaveProperty('execution.phase', 'accepted');
    expect(events).toMatchObject([{ source: 'system2', status: 'accepted', target: { x: 8, y: 64, z: 0 } }]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_CHAT');
    expect(h.bot.entity.position).toEqual(before);
  } finally { h.close(); }
});

it('retains unknown script attribution and keeps telemetry failure from changing admitted work', async () => {
  const h = methodHarness(), events: unknown[] = [];
  h.bot.on('viewer:decision', value => { events.push(value); throw Error('viewer unavailable'); });
  try {
    const outcome = await h.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'append', steps: [{ skill: 'goto', at: [8, 64, 0] }],
    }, { role: 'unknown-sdk', log: h.host.log });
    expect(outcome).toHaveProperty('execution.phase', 'accepted');
    expect(events).toMatchObject([{ source: 'unknown', status: 'accepted' }]);
  } finally { h.close(); }
});

it.each([true, false])('shows actual host combat choice admission %s without changing its result', async accepted => {
  const bot = Object.assign(new EventEmitter(), { entity: { position: { x: 1, y: 64, z: 2 } },
    entities: { 7: { position: { x: 4, y: 64, z: 5 } } } });
  const events: unknown[] = []; bot.on('viewer:decision', value => events.push(value));
  const world: any = Object.create(TacticalMinecraftWorld.prototype);
  Object.assign(world, { bridge: { bot }, connectionGeneration: 9, choiceReceipts: [], syncRealm() {},
    sampleCombatDecision: () => ({ battlefield: { connectionGeneration: 9 } }), applyCombatDecision: () => accepted,
    emit() {}, toolLog: (_tool: string, _args: unknown, text: string) => text });
  const outcome = await world.setCombatTactic({ choice: { candidate: { id: 'engage_7', kind: 'engage', targetId: 7 },
    tacticRevision: 2, connectionGeneration: 9 } }, true, 'host-decision');
  expect(outcome.meta.receipt.accepted).toBe(accepted);
  expect(events).toMatchObject([{ source: 'system1', status: accepted ? 'accepted' : 'rejected', target: { x: 4, y: 64, z: 5 } }]);
  const tracked = await world.setCombatTactic({ choice: { candidate: { id: 'track_7', kind: 'track', targetId: 7 },
    tacticRevision: 2, connectionGeneration: 9 } }, true, 'host-decision');
  expect(tracked.meta.receipt.accepted).toBe(accepted);
  expect(events[1]).toMatchObject({ source:'system1',label:'停火盯防',status:accepted?'accepted':'rejected' });
});

it.each(['system1','system2','human','unknown'] as const)('uses explicit %s attribution independently of the host role/name', async source => {
  const h=methodHarness(),events:unknown[]=[];h.bot.on('viewer:decision',value=>events.push(value));
  try {
    const result=await h.world.tools().find(t=>t.name==='mc_scout')!.handler({
      source:'human',steps:[{skill:'observe',mode:'sites',sites:[[1,64,1]]}],
    },{role:'named-agent',attribution:{controller:source,decisionId:'test-turn'},log:h.host.log});
    expect(result).toHaveProperty('execution.phase','accepted');
    expect(events).toMatchObject([{source,status:'accepted'}]);
  } finally {h.close();}
});

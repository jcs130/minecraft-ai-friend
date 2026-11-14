import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattlefieldObserver, BATTLEFIELD_CHANNEL } from '../core/battlefield.ts';
import { configureObservationPolicy } from '../core/perception-sight.ts';
import { installWorldIdentity } from '../core/world-scope.ts';

const ownUuid = '00000000-0000-0000-0000-000000000001';
const allyUuid = '00000000-0000-0000-0000-000000000002';
const enemyUuid = '00000000-0000-0000-0000-000000000003';
function rig(version = '1.20.6') {
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(),
    entity: { id: 1, uuid: ownUuid, position: new Vec3(0, 64, 0), height: 1.8, yaw: -Math.PI / 2, pitch: 0 },
    entities: {
      2: { id: 2, uuid: allyUuid, type: 'player', name: 'player', username: 'Companion', metadata: [] as unknown[], position: new Vec3(2, 64, 0) },
      3: { id: 3, uuid: enemyUuid, type: 'mob', name: 'zombie', metadata: [] as unknown[], position: new Vec3(3, 64, 0) },
    }, registry: minecraftData(version), game: { dimension: 'overworld' }, health: 18, food: 19,
    username: 'Agent', teamMap: { Agent: { team: 'blue' }, Companion: { team: 'blue' } },
    world: { raycast: () => null },
    blockAt: (p: Vec3) => ({ name: 'air', position: p, shapes: [] as number[][] }),
  });
  const observer = new BattlefieldObserver(); observer.bind(bot as unknown as Bot, BATTLEFIELD_CHANNEL);
  const sample = (now = Date.now()) => observer.sample(bot as unknown as Bot, 7,
    { fighting: true, emergency: false, taskId: null, step: null }, 12, now);
  return { bot, observer, sample };
}
function payload(sequence = 1) {
  return { schemaVersion: 1, sequence, dimension: 'overworld', validForMs: 1000,
    entities: [ { entityId: 2, uuid: allyUuid, type: 'player', name: 'Companion', relation: 'ally',
      health: { current: 4, max: 30 }, targetEntityId: null },
    { entityId: 3, uuid: enemyUuid, type: 'zombie', name: 'Guard', relation: 'hostile',
      health: { current: 60, max: 80 }, targetEntityId: 2 } ] };
}
afterEach(() => vi.useRealTimers());

it('requires explicit telemetry opt-in and releases its listeners on disposal', () => {
  const r = rig();
  r.observer.close();
  r.observer.bind(r.bot as unknown as Bot);
  r.bot._client.emit('custom_payload', { channel: BATTLEFIELD_CHANNEL, data: Buffer.from(JSON.stringify(payload())) });
  expect(r.sample().server).toBeNull();
  r.observer.close();
  expect(r.bot._client.listenerCount('custom_payload')).toBe(0);
  expect(r.bot._client.listenerCount('entity_metadata')).toBe(0);
});

describe('programmatic battlefield observations', () => {
  it('retires confirmed deaths, keeps despawns uncertain and isolates reused entity IDs',()=>{
    const r=rig('1.21.1'); r.sample(1000);
    const old=r.bot.entities[3];
    r.bot.emit('entityGone',old);
    delete (r.bot.entities as any)[3];
    expect(r.sample(2000).clues?.some(c=>c.source==='last-seen')).toBe(true);
    r.bot.emit('entityDead',old);
    expect(r.sample(2100).clues?.some(c=>c.source==='last-seen')).toBe(false);
    r.bot.entities[3]={...old,uuid:'new-enemy'};r.sample(2200);
    r.bot.emit('entityDead',old);
    expect(r.sample(2300).actors.some(a=>a.uuid==='new-enemy')).toBe(true);
    r.bot.emit('entityDead',r.bot.entities[3]);
    expect(r.sample(2400).actors.some(a=>a.uuid==='new-enemy')).toBe(false);
    expect(r.sample(2400).clues?.some(c=>c.source==='last-seen')).toBe(false);
    r.observer.close();expect(r.bot.listenerCount('entityDead')).toBe(0);
  });
  it('clears old-world search clues when native world name changes within the same dimension type',()=>{
    const r=rig(),dispose=installWorldIdentity(r.bot as unknown as Bot);
    r.bot._client.emit('login',{worldState:{name:'minecraft:first',dimension:0}});r.sample(1000);
    r.bot.blockAt=(p:Vec3)=>({name:p.x===1?'stone':'air',position:p,shapes:p.x===1?[[0,0,0,1,1,1]]:[]});
    expect(r.sample(1100).clues?.some(c=>c.source==='last-seen')).toBe(true);
    r.bot._client.emit('respawn',{worldState:{name:'minecraft:second',dimension:0}});
    expect(r.sample(1200).world?.key).toBe('minecraft:second');
    expect(r.sample(1200).clues?.some(c=>c.source==='last-seen')).toBe(false);
    dispose();r.observer.close();
  });
  it('retains an expiring last-seen point without following hidden motion or carrying it across spawn/generation',()=>{
    const r=rig();r.sample(1000);
    r.bot.blockAt=(p:Vec3)=>({name:p.x===1?'stone':'air',position:p,shapes:p.x===1?[[0,0,0,1,1,1]]:[]});
    r.bot.entities[3].position=new Vec3(7,64,0);
    const hidden=r.sample(1100);
    expect(hidden.clues).toEqual(expect.arrayContaining([expect.objectContaining({source:'last-seen',position:[3,64,0],seenAt:1000})]));
    expect(r.sample(25000).clues?.some(c=>c.source==='last-seen')).toBe(true);
    expect(r.sample(31000).clues?.some(c=>c.source==='last-seen')).toBe(false);
    r.bot.blockAt=(p:Vec3)=>({name:'air',position:p,shapes:[]});r.sample(10000);
    r.bot._client.emit('end');
    expect(r.observer.sample(r.bot as unknown as Bot,8,{fighting:false,emergency:false,taskId:null,step:null},12,10001).clues?.some(c=>c.source==='last-seen')).toBe(false);
    r.observer.close();
  });
  it('can disable near occlusion reporting and keep confirmed ally telemetry non-spatial', () => {
    const r = rig();
    configureObservationPolicy(r.bot,()=>({nearbyOccludedRange:0}));
    r.observer.noteServerPayload(Buffer.from(JSON.stringify(payload())), 1000);
    r.bot.blockAt = (p: Vec3) => ({ name: p.x === 1 ? 'stone' : 'air', position: p,
      shapes: p.x === 1 ? [[0,0,0,1,1,1]] : [] });
    const hidden = r.sample(1100);
    expect(hidden.actors.find(e => e.entityId === 3)).toBeUndefined();
    expect(hidden.actors.find(e => e.entityId === 2)).toMatchObject({ relation: 'ally', position: null, distance: null, lineOfSight: null });
    r.bot.blockAt = (p: Vec3) => ({ name: 'air', position: p, shapes: [] });
    expect(r.sample(1100).actors.find(e => e.entityId === 3)?.position).toEqual([3,64,0]);
    r.bot.entity.yaw = Math.PI / 2;
    expect(r.sample(1100).actors.find(e => e.entityId === 3)?.position).toEqual([3,64,0]);
    configureObservationPolicy(r.bot, () => ({ entityView: 'camera' }));
    expect(r.sample(1100).actors.find(e => e.entityId === 3)).toBeUndefined();
  });
  it.each(['1.20.6', '1.21.1', '1.21.4'])('reads health using the %s registry and keeps missing player health unknown', version => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const r = rig(version);
    const index = r.bot.registry.entitiesByName.zombie.metadataKeys!.indexOf('health');
    r.bot.entities[3].metadata[index] = 7;
    r.bot._client.emit('entity_metadata', { entityId: 3, metadata: [{ key: index, value: 7 }] });
    const f = r.sample();
    expect(f.actors.find(e => e.entityId === 3)?.health).toEqual({ current: 7, max: null, source: 'native', updatedAtMs: 1000 });
    expect(f.actors.find(e => e.entityId === 2)).toMatchObject({ relation: 'unknown', scoreboardTeam: 'blue',
      health: { current: null, max: null, source: 'unknown' } });
    vi.setSystemTime(1900);
    expect(r.sample().actors.find(e => e.entityId === 3)?.health.updatedAtMs).toBe(1000);
    expect(f.self.health.max).toBeNull();
  });

  it('uses connection-local server party health and rejects reordered, expired or wrong-dimension data', () => {
    const r = rig();
    expect(r.observer.noteServerPayload(Buffer.from(JSON.stringify(payload())), 1000)).toBe(true);
    expect(r.sample(1100).actors.find(e => e.entityId === 2)).toMatchObject({ relation: 'ally', relationSource: 'server',
      health: { current: 4, max: 30, source: 'server', updatedAtMs: 1000 } });
    expect(r.sample(1100).actors.find(e => e.entityId === 3)).toMatchObject({ targetEntityId: 2, health: { current: 60, max: 80 } });
    expect(r.observer.noteServerPayload(Buffer.from(JSON.stringify(payload())), 1200)).toBe(false);
    expect(r.sample(2000).actors.find(e => e.entityId === 2)?.relation).toBe('unknown');
    r.bot.game.dimension = 'the_nether';
    expect(r.sample(1500).server).toBeNull();
    r.observer.reset(); r.bot.game.dimension = 'overworld';
    expect(r.sample(1500).server).toBeNull();
    expect(r.observer.noteServerPayload(Buffer.from(JSON.stringify(payload())), 1600)).toBe(true);
  });

  it('does not join telemetry by recycled entity ID and removes it when the entity disappears', () => {
    const r = rig();
    r.observer.noteServerPayload(Buffer.from(JSON.stringify(payload())), 1000);
    r.bot.entities[3].uuid = '00000000-0000-0000-0000-000000000099';
    expect(r.sample(1100).actors.find(e => e.entityId === 3)?.health.current).toBeNull();
    r.bot.emit('entityGone', r.bot.entities[2]);
    expect(r.sample(1100).actors.find(e => e.entityId === 2)?.relation).toBe('unknown');
    r.bot._client.emit('end');
    expect(r.sample(1100).server).toBeNull();
    expect(r.bot._client.listenerCount('custom_payload')).toBe(0);
  });

  it('includes untracked confirmed allies with unknown geometry and reports bounded omissions', () => {
    const r = rig();
    const p = payload(); p.entities[0].entityId = 44;
    p.entities[0].uuid = '00000000-0000-0000-0000-000000000044';
    r.observer.noteServerPayload(Buffer.from(JSON.stringify(p)), 1000);
    const f = r.sample(1100);
    expect(f.actors.find(e => e.entityId === 44)).toMatchObject({ relation: 'ally', position: null, distance: null,
      lineOfSight: null, health: { current: 4 } });
    const limited = r.observer.sample(r.bot as unknown as Bot, 7, f.action, 1, 1100);
    expect(limited.actors).toHaveLength(1); expect(limited.omitted).toBe(2);
  });

  it('rejects malformed telemetry without replacing an accepted frame', () => {
    const r = rig();
    r.bot._client.emit('custom_payload', { channel: BATTLEFIELD_CHANNEL, data: Buffer.from(JSON.stringify(payload())) });
    const bad = payload(2); bad.entities[0].health.current = 31;
    expect(r.observer.noteServerPayload(Buffer.from(JSON.stringify(bad)))).toBe(false);
    expect(r.sample().server?.sequence).toBe(1);
    expect(r.observer.noteServerPayload(Buffer.alloc(40_000))).toBe(false);
  });
});

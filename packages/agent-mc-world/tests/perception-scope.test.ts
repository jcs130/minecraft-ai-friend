import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { configureObservationPolicy, entityAwareness, observedEntity, observedBlock, observationView } from '../core/perception-sight.ts';
import { snapshotFromBot, narrateWorldSegments } from '../core/terrain.ts';
import { combatReactions, openingSpellBattlefield } from '../core/combat-reactions.ts';
import { AttentionReader } from '../core/perception-tools.ts';
import { BattlefieldObserver } from '../core/battlefield.ts';
import { assertMinecraftReady, MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

const air = { name: 'air', shapes: [] };
const stone = { name: 'stone', shapes: [[0, 0, 0, 1, 1, 1]] };
function rig() {
  const entity = { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0, eyeHeight: 1.62 };
  const mob = (id: number, x: number, z: number) => ({ id, name: 'zombie', height: 1.8, position: new Vec3(x, 64, z) });
  return { entity, entities: { 2: mob(2, .5, -6), 3: mob(3, 8, .5), 4: mob(4, .5, 8) },
    registry: { items: {}, blocksByName: {} }, game: { dimension: 'overworld' }, time: {}, health: 20, food: 20,
    inventory: { items: () => [], slots: [] }, players: {}, findBlocks: () => [],
    blockAt: (p: Vec3): any => ({ ...air, position: p }), world: { raycast: () => null } };
}

describe('surrounding observation scope', () => {
  it('keeps unobstructed nearby actors in snapshot, attention and battlefield when the camera turns', () => {
    const bot = rig();
    const ids = () => ({
      snapshot: snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId),
      attention: new AttentionReader().read(bot, 8).highlights.map(e => e.id),
      battlefield: new BattlefieldObserver().sample(bot as never, 1,
        { fighting: false, emergency: false, taskId: null, step: null }, 12).actors.map(e => e.entityId),
    });
    const before = ids();
    for (const rows of Object.values(before)) expect(rows.sort()).toEqual([2, 3, 4]);
    bot.entity.yaw = Math.PI;
    expect(ids()).toEqual(before);
  });

  it('preserves directional observation as an explicit camera policy', () => {
    const bot = rig();
    configureObservationPolicy(bot, () => ({ entityView: 'camera' }));
    expect(Object.values(bot.entities).filter(e => observedEntity(bot, e)).map(e => e.id)).toEqual([2]);
    bot.entity.yaw = Math.PI;
    expect(Object.values(bot.entities).filter(e => observedEntity(bot, e)).map(e => e.id)).toEqual([4]);
    expect(observedEntity(bot, bot.entities[3], false)).toBe(true);
  });

  it('uses the configured entity range in passive snapshots as well as explicit reads', () => {
    const bot = rig();
    bot.entities[2].position = new Vec3(.5, 64, -23.5);
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).toContain(2);
    let entityRange = 16;
    configureObservationPolicy(bot, () => ({ entityRange }));
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).not.toContain(2);
    entityRange = 48;
    bot.entities[2].position.z = -39.5;
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).toContain(2);
    expect(observedEntity(bot, bot.entities[2])).toBe(true);
  });

  it('reports actors through 64 blocks in snapshot, attention and battlefield, but never beyond', () => {
    const bot=rig();bot.entities[2].position.z=-63.5;
    const field=()=>new BattlefieldObserver().sample(bot as never,1,{fighting:false,emergency:false,taskId:null,step:null},12);
    expect(snapshotFromBot(bot,{scanBlocks:false}).entityObservation).toEqual({view:'surroundings',range:64,nearbyOccludedRange:8});
    expect(snapshotFromBot(bot,{scanBlocks:false}).entities.some(e=>e.entityId===2)).toBe(true);
    expect(new AttentionReader().read(bot,8).highlights.some(e=>e.id===2)).toBe(true);
    expect(field().actors.some(e=>e.entityId===2)).toBe(true);
    bot.entities[2].position.z=-63.51;
    expect(snapshotFromBot(bot,{scanBlocks:false}).entities.some(e=>e.entityId===2)).toBe(false);
    expect(field().actors.some(e=>e.entityId===2)).toBe(false);
  });

  it.each(['occluded','unknown'] as const)('carries nearby %s provenance into model text and battlefield without granting attack or interaction', visibility=>{
    const bot=rig();bot.entities={2:bot.entities[2]} as typeof bot.entities;
    bot.blockAt=p=>p.z===-2?(visibility==='occluded'?{...stone,position:p}:null):{...air,position:p};
    expect(entityAwareness(bot,bot.entities[2])).toEqual({source:'nearby-entity-tracking',visibility,lineOfSight:visibility==='occluded'?false:null});
    expect(observedEntity(bot,bot.entities[2])).toBe(false);
    expect(Object.keys(observationView(bot as never).entities)).toEqual([]);
    const snap=snapshotFromBot(bot,{scanBlocks:false});
    expect(snap.entities[0]).toMatchObject({entityId:2,visible:false,observation:{visibility}});
    const text=narrateWorldSegments(snap).find(part=>part.key==='life')?.text??narrateWorldSegments(snap).map(part=>part.text).join('\n');
    expect(text).toContain('近处未直视');expect(text).not.toContain('看得见的：');expect(text).not.toContain('听到');
    expect(new AttentionReader().read(bot,8).highlights[0]).toMatchObject({visible:false,observation:{visibility}});
    const field=new BattlefieldObserver().sample(bot as never,1,{fighting:false,emergency:false,taskId:null,step:null},12);
    expect(field.actors[0].lineOfSight).toBe(visibility==='occluded'?false:null);
    const policy={allowEngage:true,allowMovement:true,engageScope:'hostile'} as const;
    expect(combatReactions(bot as never,field,policy as never,{bodyFree:true,canStep:true,targetId:null,sinceHitMs:null,fight:'on',fleeHealth:4,chaseMax:16})).toEqual([]);
    expect(openingSpellBattlefield(field,policy as never,{bodyFree:true,fight:'on',enabled:true,fleeHealth:4})?.actors).toEqual([]);
  });

  it('hot-updates the occlusion radius, caps it by overall range, and excludes dead or invisible native rows',()=>{
    const bot=rig();bot.blockAt=p=>({...stone,position:p});
    let nearbyOccludedRange=8,entityRange=64;
    configureObservationPolicy(bot,()=>({nearbyOccludedRange,entityRange}));
    expect(entityAwareness(bot,bot.entities[2])?.visibility).toBe('occluded');
    nearbyOccludedRange=0;expect(entityAwareness(bot,bot.entities[2])).toBeNull();
    nearbyOccludedRange=8;entityRange=4;expect(entityAwareness(bot,bot.entities[2])).toBeNull();
    entityRange=64;
    for(const state of [{invisible:true},{dead:true},{health:0},{isValid:false}])
      expect(entityAwareness(bot,{...bot.entities[2],...state})).toBeNull();
    delete (bot.entities as Record<number,unknown>)[2];
    expect(snapshotFromBot(bot,{scanBlocks:false}).entities.some(e=>e.entityId===2)).toBe(false);
  });

  it('keeps a nearby threat and a distant player when dropped items fill the compact snapshot',()=>{
    const bot=rig();
    const drops=Object.fromEntries(Array.from({length:20},(_,n)=>[10+n,{id:10+n,name:'item',type:'other',height:.25,position:new Vec3(.5,64,-1)}]));
    bot.entities={...drops,2:bot.entities[2],3:{id:3,name:'player',type:'player',username:'Companion',height:1.8,position:new Vec3(40,64,.5)}} as never;
    const snap=snapshotFromBot(bot,{scanBlocks:false,maxEntities:12});
    expect(snap.entities.map(e=>e.entityId).slice(0,2)).toEqual([2,3]);
    expect(snap.entitiesOmitted).toBe(10);
    expect(narrateWorldSegments(snap).map(p=>p.text).join('\n')).toContain('未展开');
  });

  it('allows explicit visible block observation beyond 32 without expanding the local voxel scan or x-raying walls',()=>{
    const bot=rig(),target=new Vec3(.5,64,-48);
    expect(observedBlock(bot,target)).toBe(true);
    bot.blockAt=p=>p.z===-2?{...stone,position:p}:{...air,position:p};
    expect(observedBlock(bot,target)).toBe(false);
  });

  it('still rejects obscured, unloaded and invisible actors outside the camera direction', () => {
    const bot = rig();
    expect(observedEntity(bot, bot.entities[4])).toBe(true);
    bot.blockAt = p => p.z === 3 ? { ...stone, position: p } : { ...air, position: p };
    expect(observedEntity(bot, bot.entities[4])).toBe(false);
    bot.blockAt = p => p.z === 3 ? null : { ...air, position: p };
    expect(observedEntity(bot, bot.entities[4])).toBe(false);
    bot.blockAt = p => ({ ...air, position: p });
    expect(observedEntity(bot, { ...bot.entities[4], invisible: true })).toBe(false);
  });

  it('does not discard a requested scan tail before testing which blocks can be seen', () => {
    const bot = rig();
    const hidden = Array.from({ length: 512 }, (_, n) => new Vec3(n % 16 - 8, 64, 2 + Math.floor(n / 16)));
    const visible = new Vec3(-4, 64, -4);
    const all = [...hidden, visible];
    const blocks = new Set(all.map(p => p.toString()));
    bot.blockAt = p => p.z === 1 || blocks.has(p.toString()) ? { ...stone, position: p } : { ...air, position: p };
    const queryBot = { ...bot, findBlocks: (opts: { count: number }) => all.slice(0, opts.count) };
    expect(observationView(queryBot as never).findBlocks({ matching: 1, count: 2048 })).toEqual([visible]);
  });

  it.each([{ entityRange: 0 }, { entityRange: 65 }, { entityRange: 12.5 }, { entityView: 'tracking' },
    {nearbyOccludedRange:-1},{nearbyOccludedRange:17},{nearbyOccludedRange:1.5}])(
    'rejects invalid perception configuration %j', perception => {
      const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'localhost', username: 'agent', perception };
      expect(() => assertMinecraftReady(cfg as never)).toThrow(/perception/);
    },
  );
});

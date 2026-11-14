import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { rideDrive, useBoat, skillRide } from '../core/skills-interact.ts';
import { methodHarness } from './method-harness.ts';
import {createRequire} from 'node:module';
import pathfinder from 'mineflayer-pathfinder';
import '../core/dependency-patches.ts';

afterEach(() => vi.useRealTimers());

it.each([true,false])('uses the native passenger acknowledgement before driving a chosen boat: acknowledged=%s',async acknowledge=>{
  vi.useFakeTimers();const h=methodHarness('1.21.1'),bot=h.bot as unknown as Bot;
  const req=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
  Object.assign(bot,{supportFeature:bot.registry.supportFeature});const self=bot.entity;
  req('mineflayer/lib/plugins/entities.js')(bot);bot.entity=self;bot.entities[self.id]=self;
  const boat={id:9,name:'boat',type:'other',isValid:true,position:new Vec3(1.5,64,.5),width:1.4,height:.6,passengers:[]};
  bot.entities[9]=boat as never;
  Object.assign(bot,{unequip:vi.fn(async()=>{}),lookAt:vi.fn(async()=>{}),getControlState:(key:string)=>h.keys[key]});
  Object.assign(bot.game,{minY:-64,height:384});
  Object.assign(bot.world,{getBlockStateId:(at:any)=>bot.blockAt(at)!.stateId,getColumn:()=>({}),raycast:()=>null}); // open fixture
  pathfinder.pathfinder(bot);
  const packets:{name:string;data:any}[]=[];
  bot._client.write=((name:string,data:any)=>{
    packets.push({name,data});
    if(name==='use_entity'&&acknowledge){bot._client.emit('set_passengers',{entityId:9,passengers:[self.id]});bot.physicsEnabled=false;}
  }) as never;
  try{
    const attempt=skillRide(bot,{skill:'ride',target:'boat',entityId:9},{aborted:()=>false} as never).catch(e=>e);
    await vi.advanceTimersByTimeAsync(4_000);const receipt=await attempt;
    expect(packets.some(p=>p.name==='use_entity'&&p.data.target===9),String(receipt)).toBe(true);
    if(!acknowledge){expect(receipt).toBeInstanceOf(Error);expect(packets.some(p=>p.name==='vehicle_move')).toBe(false);return;}
    expect(receipt).toContain('骑上');expect(bot.vehicle).toBe(bot.entities[9]);
    const drive=rideDrive(bot,{aborted:()=>false} as never,{x:8,y:64,z:0});
    await vi.advanceTimersByTimeAsync(3_000);expect(await drive).toContain('船');
    expect(packets.some(p=>p.name==='vehicle_move')).toBe(true);
    expect(bot.vehicle?.position.x).toBeGreaterThan(6);
    expect(bot.vehicle!.position.distanceTo(new Vec3(8.5,64,.5))).toBeLessThanOrEqual(2.5);
    expect(bot.vehicle).toBe(bot.entities[9]);
  }finally{h.close();}
});

it.each(['one', 'none', 'ambiguous', 'removed'] as const)('reports a newly observed boat identity without substituting an old boat: %s', async mode => {
  vi.useFakeTimers(); const h = methodHarness('1.21.1');
  let count = 1;
  const boat = (id: number) => ({ id, name: 'boat', isValid: true, position: new Vec3(1.5, 64, .5) });
  Object.assign(h.bot, { lookAt: vi.fn(async () => {}), waitForTicks: vi.fn(async () => {}) });
  h.bot.inventory.items = (() => count ? [{ name: 'spruce_boat', count, type: h.bot.registry.itemsByName.spruce_boat.id }] : []) as never;
  Object.assign(h.bot.entities, { 8: boat(8) });
  try {
    const result = useBoat(h.bot as unknown as Bot, { x: 1, y: 64, z: 0 }, 'spruce_boat', '云杉木船', async () => {
      count = 0;
      if (mode !== 'none') Object.assign(h.bot.entities, { 9: { ...boat(9), isValid: mode !== 'removed' } });
      if (mode === 'ambiguous') Object.assign(h.bot.entities, { 10: boat(10) });
    });
    await vi.advanceTimersByTimeAsync(1000);
    const text = await result;
    expect(text).toContain('1 → 0');
    if (mode === 'one') {
      expect(text).toContain('entityId=9');
      expect(text).toContain('"entityId":9');
    } else {
      expect(text).toMatch(/未确认|不能确认/);
      expect(text).not.toContain('"entityId":');
    }
    expect(text).not.toContain('entityId=8');
  } finally { h.close(); }
});

it('stops at a real boat hull obstacle while keeping the rider aboard and releasing the correction listener', async () => {
  const h = methodHarness('1.21.1'); h.bot.physicsEnabled = false;
  const vehicle = { id: 9, name: 'boat', isValid: true, position: new Vec3(.5, 64, .5), width: 1.4, height: .6 };
  const dismount = vi.fn(() => { (h.bot as any).vehicle = null; });
  Object.assign(h.bot, { vehicle, dismount });
  for (let z = -2; z <= 2; z++) for (let y = 64; y <= 68; y++) h.set(1, y, z, 'stone');
  const before = h.bot._client.listenerCount('vehicle_move');
  try {
    await expect(rideDrive(h.bot as unknown as Bot, { aborted: () => false } as never, { x: 8, y: 64, z: 0 }))
      .rejects.toThrow(/停在/);
    expect(dismount).not.toHaveBeenCalled();
    expect((h.bot as any).vehicle).toBe(vehicle);
    expect(h.bot._client.listenerCount('vehicle_move')).toBe(before);
  } finally { h.close(); }
});

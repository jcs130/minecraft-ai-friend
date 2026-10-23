import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe,it,expect } from 'vitest';
import { observeSpatial, parseSpatialObservation, spatialObservationText } from '../core/spatial-observation.ts';
import { methodHarness } from './method-harness.ts';

function scene() {
  let phase=0;
  const bot=Object.assign(new EventEmitter(),{
    entity:{id:1,position:new Vec3(.5,64,.5),yaw:0,pitch:0},entities:{},game:{dimension:'overworld'},
    blockAt:(at:Vec3)=>{
      const name=at.y<63?'diamond_ore':at.y===63?(phase?'dirt':'stone'):'air';
      return {name,stateId:name==='air'?0:name==='stone'?1:2,shapes:name==='air'?[]:[[0,0,0,1,1,1]],getProperties:()=>({})};
    },
  }) as unknown as Bot;
  return {bot,change:()=>{phase++;}};
}
function query(bot:Bot,input:Record<string,unknown>) {
  const parsed=parseSpatialObservation(input);if('error' in parsed)throw Error(parsed.error);
  return JSON.parse(spatialObservationText(bot,parsed));
}
describe('visible surface default',()=>{
  it('returns the real visible floor, filtering air and occluded interior without a failed oversized call',()=>{
    const {bot}=scene(),input={mode:'voxels',bounds:[-5,-3,-5,5,5,5]},r=query(bot,input);
    expect(r).toMatchObject({format:'visible',status:'partial',coverage:{requestedCount:1089,scannedCount:1089,
      returnedCount:121,invisibleCount:242,airCount:726,remainingCount:0},next:null});
    expect(r.blocks).toHaveLength(121);expect(r.blocks.every((b:number[])=>b[1]===63 && b[3]===0)).toBe(true);
    expect(r.palette.map((p:{name:string})=>p.name)).toEqual(['stone']);
    expect(r).not.toHaveProperty('cells');expect(r).not.toHaveProperty('unknownCells');
    expect(JSON.stringify(r)).not.toContain('未知');expect(r.note).toContain('不可见');
    expect(JSON.stringify(r)).not.toContain('diamond_ore');
  });
  it('uses fewer bytes for an occluded dense neighborhood while preserving an explicit dense view',()=>{
    const {bot}=scene(),bounds=[-3,-3,-3,3,3,3];
    const visible=query(bot,{mode:'voxels',bounds}),dense=query(bot,{mode:'voxels',format:'dense',bounds});
    expect(dense.cells).toHaveLength(343);expect(visible.blocks).toHaveLength(49);
    expect(JSON.stringify(visible).length).toBeLessThan(JSON.stringify(dense).length);
    expect(dense).toHaveProperty('palette');
  });
  it('keeps a moving continuation anchored, reads fresh surfaces and never changes formats silently',()=>{
    const {bot,change}=scene(),first=query(bot,{mode:'voxels',bounds:[-16,-16,-16,16,16,16]});
    expect(first.coverage.scannedCount).toBeLessThanOrEqual(2048);expect(first.blocks.length).toBeLessThanOrEqual(512);
    expect(first.next).not.toBeNull();change();bot.entity.position=new Vec3(1.5,64,.5);
    const next=query(bot,first.next.arguments.steps[0]);
    expect(next.coverage.origin).toEqual([0,64,0]);expect(next.coverage.previouslyScannedCount).toBe(first.coverage.scannedCount);
    expect(next.palette.every((p:{name:string})=>p.name==='dirt')).toBe(true);
    expect(()=>query(bot,{...first.next.arguments.steps[0],format:'dense'})).toThrow(/cursor/);
  });
  it('distinguishes unloaded cells without publishing phantom air or hidden voxel entries',()=>{
    const {bot}=scene();bot.blockAt=()=>null;
    const r=query(bot,{mode:'voxels',bounds:[0,0,0,0,0,0]});
    expect(r.blocks).toEqual([]);expect(r.palette).toEqual([]);
    expect(r.coverage).toMatchObject({unloadedCount:1,invisibleCount:0,airCount:0});
    expect(JSON.stringify(r)).not.toContain('未知');
  });
  it('shrinks sparse text safely and marks a single overlarge visible material as detail not returned',()=>{
    const {bot}=scene();bot.blockAt=at=>({name:'stone',stateId:1,shapes:[],getProperties:()=>({detail:'x'.repeat(30000)})}) as never;
    const r=query(bot,{mode:'voxels',bounds:[0,0,0,0,0,0]});
    expect(r.blocks).toEqual([]);expect(r.coverage.omittedDetailCount).toBe(1);
    expect(r.coverage.partialReasons).toContain('细节未返回');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(24000);
  });
  it('continues the full largest region without duplicating visible surfaces or losing scan positions',()=>{
    const {bot}=scene(),seen=new Set<string>();let scanned=0,r=query(bot,{mode:'voxels',bounds:[-16,-16,-16,16,16,16]});
    for(let page=0;page<100;page++) {
      expect(r.coverage.previouslyScannedCount).toBe(scanned);scanned+=r.coverage.scannedCount;
      expect(scanned+r.coverage.remainingCount).toBe(33**3);
      for(const b of r.blocks){const key=b.slice(0,3).join(',');expect(seen.has(key)).toBe(false);seen.add(key);}
      if(!r.next)break;r=query(bot,r.next.arguments.steps[0]);
    }
    expect(scanned).toBe(33**3);expect(seen.size).toBe(33**2);expect(r.next).toBeNull();
  });
  it('uses the native queue for the default surface result and an independent following read',async()=>{
    const r=methodHarness('1.21.1');r.bot.physicsEnabled=false;
    try{
      const response=await r.world.tools().find(t=>t.name==='mc_scout')!.handler({steps:[
        {skill:'observe',mode:'voxels',bounds:[-5,-3,-5,5,5,5]},
        {skill:'observe',mode:'sites',sites:[[0,64,0]],needs:[]},
      ]},{role:'test',log:r.host.log});
      expect(response).not.toHaveProperty('failed');
      await expect.poll(()=>r.host.events.some(e=>e.execution?.terminal),{timeout:3000}).toBe(true);
      const end=r.host.events.find(e=>e.execution?.terminal)!;
      expect(end.execution).toMatchObject({kind:'task',phase:'completed',goalCompleted:false});
      expect(end.text).toContain('"format":"visible"');expect(end.text).toContain('"kind":"sites"');
      expect(end.text).not.toContain('"unknownCells"');
      expect(r.bot.entity.position.equals(new Vec3(.5,64,.5))).toBe(true);
    }finally{r.close();}
  });
});

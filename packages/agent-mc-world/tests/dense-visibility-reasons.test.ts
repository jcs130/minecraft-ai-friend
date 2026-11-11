import {expect,it}from'vitest';
import type {Bot}from'mineflayer';
import {Vec3}from'vec3';
import {observeSpatial}from'../core/spatial-observation.ts';
import {spatialReadout}from'../core/spatial-readout.ts';
import {methodHarness}from'./method-harness.ts';
it('separates dense occlusion from unloaded cells without exposing hidden block identities',()=>{
 const r=methodHarness('1.21.1'),original=r.bot.blockAt;
 try{
  r.set(1,64,0,'stone');r.set(1,65,0,'stone');r.set(2,64,0,'diamond_block');
  r.bot.blockAt=((p:Vec3)=>p.x>=3?null:original(p))as never;
  const data=observeSpatial(r.bot as unknown as Bot,{mode:'voxels',format:'dense',bounds:[0,0,0,4,1,0]});
  expect(data.readout!.unknownReasons!.unloaded).toBeGreaterThan(0);
  expect(data.readout!.unknownReasons!.notVisible).toBeGreaterThan(0);
  expect(data.readout!.unknownReasons!.notReturned).toBe(0);
  expect(JSON.stringify(data)).not.toContain('diamond_block');
  expect(spatialReadout({source:'client-visible-world',kind:'voxels',coverage:{unknownCount:8}})!.unknownReasons).toEqual({notVisible:null,unloaded:null,notReturned:null});
 }finally{r.close();}
});

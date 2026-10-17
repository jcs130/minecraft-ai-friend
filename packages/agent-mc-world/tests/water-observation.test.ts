import {afterEach,expect,it} from 'vitest';
import {Vec3} from 'vec3';
import type {Bot} from 'mineflayer';
import {headWaterObservation,waterAtPoint} from '../core/water-observation.ts';
import {breathingReadout} from '../core/breathing.ts';
import {headInWater} from '../core/terrain.ts';
import {methodHarness} from './method-harness.ts';
const rigs:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>rigs.splice(0).forEach(r=>r.close()));
function pool(version='1.21.1'){
  const r=methodHarness(version);rigs.push(r);r.set(0,64,0,'water');r.set(0,65,0,'water');
  return {...r,live:r.bot as unknown as Bot};
}
it.each(['1.21.1','1.20.6'])('uses breathing height and actual source-water surface in %s',version=>{
  const r=pool(version);r.live.entity.position=new Vec3(.5,64.3,.5);
  expect(breathingReadout(r.live)).toMatchObject({headWet:false,bodyWet:true,eyeHeight:1.62});
  expect(headInWater(r.live)).toBe(false);
  r.live.entity.position.y=64.1;expect(headWaterObservation(r.live).wet).toBe(true);
  r.live.entity.position.y=64.3;Object.assign(r.live.entity,{eyeHeight:1.27});
  expect(breathingReadout(r.live)).toMatchObject({headWet:true,eyeHeightSource:'client'});
});
it('distinguishes shallow flowing fluid from the whole block and knows a continued water column',()=>{
  const r=pool(),read=r.live.blockAt.bind(r.live);
  r.live.blockAt=((at:Vec3)=>{const block=read(at);if(block?.name==='water')block.getProperties=()=>({level:'7'}) as never;return block;}) as never;
  expect(waterAtPoint(r.live,new Vec3(.5,65.05,.5))).toBe(true);
  expect(waterAtPoint(r.live,new Vec3(.5,65.2,.5))).toBe(false);
  r.set(0,66,0,'water');expect(waterAtPoint(r.live,new Vec3(.5,65.99,.5))).toBe(true);
});
it('keeps unloaded coverage unknown at the fluid surface',()=>{
  const r=pool(),read=r.live.blockAt.bind(r.live);
  r.live.blockAt=((at:Vec3)=>at.y>=66?null:read(at)) as never;
  expect(waterAtPoint(r.live,new Vec3(.5,65.5,.5))).toBe(true);
  expect(waterAtPoint(r.live,new Vec3(.5,65.95,.5))).toBeNull();
  r.live.blockAt=()=>null;expect(headWaterObservation(r.live).wet).toBeNull();
});

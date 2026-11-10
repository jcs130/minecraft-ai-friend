import {describe,expect,it} from 'vitest';
import {Vec3} from 'vec3';
import {corridorSafe} from '../core/idle-actions.ts';
import {unwedgeBody} from '../core/travel.ts';
import type {SkillContext} from '../core/skill-context.ts';
import {methodHarness} from './method-harness.ts';

// The live stall's fence face ended at z+0.625; the 0.6-wide body was
// immediately outside it at z+0.925010. Rebuild the local geometry only,
// without assuming the original village's unknown route or support.
const settled=(r:ReturnType<typeof methodHarness>)=>new Promise<void>((resolve,reject)=>{
  const check=()=>{if(r.bot.entity.onGround&&r.bot.entity.position.y===64){cleanup();resolve();}};
  const cleanup=()=>{clearTimeout(timer);r.bot.off('physicsTick',check);};
  const timer=setTimeout(()=>{cleanup();reject(Error('local physics did not settle'));},2000);r.bot.on('physicsTick',check);
});

describe('supported short movement uses actual collision shapes',()=>{
  it.each(['1.20.6','1.21.1'])('can retreat alongside a partial fence using %s physics',async version=>{
    const r=methodHarness(version);
    try{
      r.set(0,64,0,'oak_fence');
      r.bot.entity.position=new Vec3(.61819760017625,64,.92501000000001);
      await settled(r);const before=r.bot.entity.position.clone();
      expect(corridorSafe(r.bot as never,before,before.offset(0,0,1.2))).toBe(true);
      expect(corridorSafe(r.bot as never,before,before.offset(0,0,-1.2))).toBe(false);
      expect(await unwedgeBody(r.bot as never,{aborted:()=>false} as SkillContext)).toBeGreaterThan(.2);
      expect(r.bot.entity.position.y).toBe(64);expect(r.bot.entity.onGround).toBe(true);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
    }finally{r.close();}
  });
  it('does not use the empty space beside a fence to permit a sweep through its post',()=>{
    const r=methodHarness('1.21.1');
    try{
      r.set(0,64,0,'oak_fence');
      const from=new Vec3(.5,64,.92501000000001);
      expect(corridorSafe(r.bot as never,from,from.offset(0,0,-1.2))).toBe(false);
    }finally{r.close();}
  });
  it('does not treat missing collision shapes as empty space',()=>{
    const r=methodHarness('1.21.1');
    try{
      const read=r.bot.blockAt;
      r.bot.blockAt=(at:Vec3)=>{const block=read(at);if(at.floored().equals(new Vec3(0,64,0)))block.shapes=undefined as never;return block;};
      const from=new Vec3(.5,64,.5);
      expect(corridorSafe(r.bot as never,from,from.offset(0,0,1.2))).toBe(false);
    }finally{r.close();}
  });
});

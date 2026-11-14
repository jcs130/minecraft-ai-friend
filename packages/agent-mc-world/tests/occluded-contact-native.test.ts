import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
import {Vec3} from 'vec3';
import {methodHarness} from './method-harness.ts';
import {BattlefieldObserver} from '../core/battlefield.ts';
import {canSeeEntity} from '../core/terrain.ts';
import {entityAwareness} from '../core/perception-sight.ts';
import {combatSearchCandidates} from '../core/combat-search.ts';

const require=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const WorldSync=require('prismarine-world/src/worldsync.js');

it('agrees on partial cover with native 1.21.1 collision rays and never sees through a solid wall',()=>{
  const r=methodHarness('1.21.1'),bot=r.bot as any;
  try{
    bot.world.raycast=WorldSync.prototype.raycast.bind(bot.world);
    const enemy={id:7,uuid:'blaze',name:'blaze',type:'mob',isValid:true,height:1.8,position:new Vec3(4.5,64,.5)};
    // Centre ray crosses the wall at y=65.08, the head ray at y=65.55.
    r.set(3,65,0,'stone_slab');
    expect(entityAwareness(bot,enemy)?.lineOfSight).toBe(true);
    expect(canSeeEntity(bot,enemy)).toBe(true);
    r.set(3,64,0,'stone');r.set(3,65,0,'stone');r.set(3,66,0,'stone');
    expect(entityAwareness(bot,enemy)?.lineOfSight).toBe(false);
    expect(canSeeEntity(bot,enemy)).toBe(false);
    // Even a sub-block distance never bypasses an opaque block.
    bot.entity.position=new Vec3(2.9,64,.5);enemy.position=new Vec3(3.7,64,.5);
    expect(canSeeEntity(bot,enemy)).toBe(false);
  }finally{r.close();}
});

it('keeps a hidden contact through a slow decision, executes a wall-side search and observes again',async()=>{
  const r=methodHarness('1.21.1'),bot=r.bot as any,observer=new BattlefieldObserver();
  try{
    bot.world.raycast=WorldSync.prototype.raycast.bind(bot.world);
    observer.bind(bot);
    bot.entities[7]={id:7,uuid:'blaze',name:'blaze',type:'mob',isValid:true,height:1.8,metadata:[],position:new Vec3(4.5,64,.5)};
    const action={fighting:false,emergency:false,taskId:null,step:null};
    observer.sample(bot,1,action,64,1000);
    for(const y of [64,65,66])r.set(1,y,0,'stone');
    // Packets may carry hidden motion, but the evidence remains the old point.
    bot.entities[7].position=new Vec3(5.5,64,.5);
    const field=observer.sample(bot,1,action,64,25000);
    expect(field.clues).toEqual(expect.arrayContaining([expect.objectContaining({source:'last-seen',position:[4.5,64,.5],seenAt:1000})]));
    const options=combatSearchCandidates(bot,field,true,true);
    const side=options.find(c=>c.kind==='search'&&c.destination[2]<-.6);
    expect(side?.kind).toBe('search');if(side?.kind!=='search')return;
    const from=bot.entity.position.clone(),to=new Vec3(...side.destination);
    const yaw=Math.atan2(-(to.x-from.x),-(to.z-from.z));
    const result=r.exec.submitDetailed([{skill:'control',keys:['forward'],durationMs:250,mode:'ground',yawDeg:yaw*180/Math.PI}],'append');
    expect(result.accepted).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,700));
    expect(bot.entity.position.distanceTo(from)).toBeGreaterThan(.3);
    expect(bot.entity.position.x).toBeLessThan(1);
    expect(r.keys.forward).toBe(false);
    // A second checked step clears the edge; reacquisition uses fresh rays.
    const next=observer.sample(bot,1,action,64,26000);
    if(!next.actors.some(a=>a.entityId===7&&a.lineOfSight)){
      r.exec.submitDetailed([{skill:'control',keys:['forward'],durationMs:250,mode:'ground',yawDeg:0}],'append');
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    expect(observer.sample(bot,1,action,64,27000).actors.some(a=>a.entityId===7&&a.lineOfSight)).toBe(true);
  }finally{observer.close();r.close();}
});

import {createRequire} from 'node:module';
import {afterEach,expect,it} from 'vitest';
import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
import {methodHarness,methodEnded} from './method-harness.ts';
import {parseSteps} from '../core/skills.ts';
import {skillRide} from '../core/skills-interact.ts';

const dep=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const fixtures:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>fixtures.splice(0).forEach(h=>h.close()));
async function until(test:()=>boolean){const end=Date.now()+3000;while(!test()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,10));}}
it('opens a real Mineflayer elytra with normal physics and reads actual gliding, without creative flags',async()=>{
 const h=methodHarness();fixtures.push(h);const bot=h.bot as unknown as Bot;
 Object.assign(bot,{supportFeature:(name:string)=>(bot.registry as any).supportFeature(name),swingArm(){}});
 dep('./lib/plugins/simple_inventory.js')(bot);dep('./lib/plugins/inventory.js')(bot,{hideErrors:true});dep('./lib/plugins/physics.js')(bot,{physicsEnabled:true});
 const Item=dep('prismarine-item')(bot.registry);bot.inventory.slots[6]=new Item(bot.registry.itemsByName.elytra.id,1);
 const packets:string[]=[];
 bot._client.write=((name:string,value:any)=>{packets.push(name);if(name==='entity_action' && [8,'start_elytra_flying'].includes(value.actionId))Object.assign(bot.entity,{elytraFlying:true});}) as never;
 const look=bot.look.bind(bot);bot.look=(y,p)=>look(y,p,true);
 bot.entity.position=new Vec3(.5,85,.5);bot.entity.onGround=false;Object.assign(bot.entity,{elytraFlying:false});
 const gravity=bot.physics.gravity;
 const id=h.runner.start({name:'normal glider',code:'await bot.look(-Math.PI/2,0,true);const before=await bot.read("entity");await bot.elytraFly();await bot.waitForTicks(12);return {before,after:await bot.read("entity")};'}).id;
 const result=await methodEnded(h,id);
 expect(result,JSON.stringify(result)).toMatchObject({status:'completed',result:{after:{elytraFlying:true,onGround:false}}});
 const value=result.result as any;expect(value.after.position.x).toBeGreaterThan(value.before.position.x+.1);
 expect(value.after.position.y).toBeLessThan(value.before.position.y);expect(bot.physics.gravity).toBe(gravity);expect(bot.physicsEnabled).toBe(true);
 expect(packets).not.toContain('abilities');
});
it('validates exact ride identity and never substitutes another nearby boat',async()=>{
 expect(parseSteps([{skill:'ride',target:'boat',entityId:42}])).toMatchObject({steps:[{target:'boat',entityId:42}]});
 expect(parseSteps([{skill:'ride',entityId:42,to:[1,64,0]}])).toHaveProperty('error');
 const h=methodHarness();fixtures.push(h);Object.assign(h.bot.entities,{9:{id:9,name:'boat',isValid:true,position:new Vec3(1.5,64,.5)}});
 await expect(skillRide(h.bot as unknown as Bot,{skill:'ride',target:'boat',entityId:42},{aborted:()=>false} as any)).rejects.toThrow(/点名载具/);
});
it('mounts and dismounts the exact public entity and reads its own attachment',async()=>{
 const h=methodHarness();fixtures.push(h);const entity={id:9,name:'boat',isValid:true,position:new Vec3(2.5,64,.5),height:.6,width:1.4};
 Object.assign(h.bot.entities,{9:entity});Object.assign(h.bot,{mount(e:unknown){(h.bot as any).vehicle=e;},dismount(){(h.bot as any).vehicle=null;}});
 const id=h.runner.start({name:'exact mount',code:'await bot.mount(9);const during=await bot.read("vehicle");await bot.dismount();return {during,after:await bot.read("vehicle")};'}).id;
 expect(await methodEnded(h,id)).toMatchObject({status:'completed',result:{during:{id:9,name:'boat'},after:null}});
});
it('rejects a server attachment to another entity after an exact ride request and never starts driving it',async()=>{
 const h=methodHarness();fixtures.push(h);
 const wanted={id:9,name:'boat',isValid:true,position:new Vec3(1.5,64,.5),height:.6};
 const other={...wanted,id:10};Object.assign(h.bot.entities,{9:wanted,10:other});
 Object.assign(h.bot.world,{raycast:()=>null});Object.assign(h.bot.pathfinder,{goto:async()=>{}});
 Object.assign(h.bot,{unequip:async()=>{},lookAt:async()=>{},mount(){(h.bot as any).vehicle=other;}});
 await expect(skillRide(h.bot as unknown as Bot,{skill:'ride',target:'boat',entityId:9,to:[5,64,0]},
   {aborted:()=>false} as any)).rejects.toThrow(/服务端确认的坐骑不是点名实体/);
 expect((h.bot as any).vehicle).toBe(other);
});
it('neutralizes bounded native vehicle inputs on cancellation before another owner can steer',async()=>{
 const h=methodHarness();fixtures.push(h);const inputs:number[][]=[];
 Object.assign(h.bot,{vehicle:{id:7,name:'modded_vehicle',position:new Vec3(.5,64,.5)},moveVehicle(left:number,forward:number){inputs.push([left,forward]);},
  waitForTicks:async()=>{await new Promise<void>(r=>h.bot.once('physicsTick',r));}});
 const id=h.runner.start({name:'vehicle control',code:'return await bot.moveVehicle(0,1,100);'}).id;
 await until(()=>inputs.length>0);h.runner.stop('cancel vehicle input');await new Promise(r=>setTimeout(r,120));
 expect(h.runner.read(id)[0].status).toBe('cancelled');expect(inputs.at(-1)).toEqual([0,0]);
 const count=inputs.length;await new Promise(r=>setTimeout(r,100));expect(inputs.length).toBe(count);
});

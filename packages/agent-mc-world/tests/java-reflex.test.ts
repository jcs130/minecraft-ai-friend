import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import { JavaReflexRuntime, JAVA_REFLEX_PROTOCOL } from '../src/client/java-reflex.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/index.ts';
import { methodHarness } from './method-harness.ts';
const rigs:ReturnType<typeof rig>[]=[];

it('reports the measured native task separately from old receipts and makes stale samples unknown',async()=>{
  const r=rig();expect(r.runtime.status().bodyControl).toBeNull();
  await r.runtime.poll();expect(r.runtime.status().bodyControl).toMatchObject({taskRunning:false,taskId:null,source:'native-reflex-frame'});
  r.task(true);await r.runtime.poll();expect(r.runtime.status().bodyControl).toMatchObject({taskRunning:true,taskId:'original-task'});
  const future=Date.now()+501,clock=vi.spyOn(Date,'now').mockReturnValue(future);
  try{expect(r.runtime.status().bodyControl).toBeNull();}finally{clock.mockRestore();}
});
afterEach(async()=>{for(const r of rigs.splice(0)){await r.runtime.close();r.physics.close();rmSync(r.dir,{recursive:true,force:true});}});
function rig(options:{enemyDistance?:number;health?:number;oxygen?:number;water?:boolean;combat?:boolean}={}){
  const physics=methodHarness(),dir=mkdtempSync(join(tmpdir(),'native-reflex-'));
  const cfg=structuredClone(MINECRAFT_CLIENT_DEFAULTS);Object.assign(cfg,{provider:'java-client',username:'Agent',version:'1.21.1',combatOptions:{allowMovement:true,allowEngage:true,engageScope:'hostile',maxCandidates:4}});
  cfg.javaClient={expectedServer:'fixture.test',expectedUuid:'00000000-0000-0000-0000-000000000001',controllerId:'fixture',credentialsFile:'unused',ledgerDir:dir,leaseMs:15000};
  cfg.combat.enabled=options.combat!==false;cfg.reflex.antiDrown=options.water===true;cfg.reflex.antiLava=false;
  const bot=physics.bot as any;bot.health=options.health??20;bot.entity.yaw=Math.PI;
  if(options.water)for(let x=-5;x<=5;x++)for(let y=64;y<=67;y++)for(let z=-5;z<=5;z++)physics.set(x,y,z,'water');
  const commands:any[]=[],calls:string[]=[],damage:any[]=[];let auth=true,connected=true,generation=1,bodyScope=1,taskRunning=false;
  const slots:any[]=Array(46).fill(null);slots[36]={name:'iron_sword',type:1,count:1,slot:36,instanceHash:'a'.repeat(64)};
  const actors=options.enemyDistance===undefined?[]:[{id:2,uuid:'00000000-0000-0000-0000-000000000002',name:'minecraft:zombie',player:false,alive:true,visible:true,
    position:[.5+options.enemyDistance,64,.5],velocity:[0,0,0],width:.6,height:1.95,health:20,maxHealth:20}];
  function frame(){const p=bot.entity.position,by=Math.floor(p.y),palette:any[]=[],indices=new Map<number,number>(),cells:number[][]=[];
    for(let x=Math.floor(p.x)-5;x<=Math.floor(p.x)+5;x++)for(let y=by-4;y<=by+4;y++)for(let z=Math.floor(p.z)-5;z<=Math.floor(p.z)+5;z++){
      const b=bot.blockAt(new Vec3(x,y,z));let id=indices.get(b.stateId);if(id===undefined){id=palette.length;indices.set(b.stateId,id);palette.push({name:b.name,stateId:b.stateId,properties:b.getProperties(),shapes:b.shapes});}cells.push([x,y,z,id]);}
    const proof={protocol:'agent-mc-server-authorization/v1',required:true,generation,username:'Agent',server:'fixture.test',authorized:auth,phase:auth?'confirmed':'required',connectionMatched:true};
    return{protocol:JAVA_REFLEX_PROTOCOL,minecraftVersion:'1.21.1',generation,reflexGeneration:bodyScope,absorption:0,sampledAtMs:Date.now(),taskRunning,taskId:taskRunning?'original-task':null,
      state:{protocol:'agent-mc-java/v1',connected,generation,uuid:cfg.javaClient!.expectedUuid,username:'Agent',server:'fixture.test',dimension:'minecraft:overworld',position:[p.x,p.y,p.z],
        yaw:180-bot.entity.yaw*180/Math.PI,pitch:0,health:bot.health,food:20,screen:'',selectedSlot:0,serverAuthorization:proof,actions:[],messages:[]},
      entityId:1,oxygen:options.oxygen??300,maxOxygen:300,height:1.8,eyeHeight:1.62,maxHealth:20,onGround:bot.entity.onGround,burning:false,velocity:[bot.entity.velocity.x,bot.entity.velocity.y,bot.entity.velocity.z],
      inventorySlots:slots,actors,actorsOmitted:0,damage,palette,cells};
  }
  const runtime=new JavaReflexRuntime(cfg,{canControl:()=>true,owner:()=>({controllerId:'fixture',nonce:'private'}),verify:()=>{},host:()=>physics.host,
    rpc:async(method,args)=>{calls.push(method);if(method==='reflex_frame')return frame();if(method==='reflex_control'){
      const control=args.control as any;commands.push(structuredClone(control));const input=control.input;
      if(input.look)bot.entity.yaw=Math.PI-input.look.yaw*Math.PI/180;
      for(const key of ['forward','back','left','right','jump','sprint','sneak'])bot.setControlState(key,!!input.keys[key]);
      return{accepted:true,active:input.owner!=='idle',owner:input.owner,sequence:control.sequence};}
      throw Error('Unexpected native body operation '+method);
    }});
  const result={runtime,physics,dir,cfg,commands,calls,damage,actors,frame,auth:(v:boolean)=>{auth=v;},connect:(v:boolean)=>{connected=v;},generation:()=>{generation++;bodyScope++;},respawn:()=>{bodyScope++;},task:(v:boolean)=>{taskRunning=v;}};
  rigs.push(result);return result;
}
it('reuses the real combat kernel and collision physics while a slow model would still be waiting',async()=>{
  const r=rig({enemyDistance:2.5});const before=r.physics.bot.entity.position.clone();r.runtime.start();
  await vi.waitFor(()=>expect(r.commands.some(c=>c.input.owner==='combat')).toBe(true),{timeout:3000});
  await vi.waitFor(()=>expect(r.commands.some(c=>c.input.attack?.id===2)).toBe(true),{timeout:3000});
  expect(r.runtime.status().kernels).toEqual(['CombatSession','Reflexes']);
  expect(r.calls.every(c=>['reflex_frame','reflex_control'].includes(c))).toBe(true);
  expect(r.commands.filter(c=>c.input.attack).every(c=>c.input.attack.uuid===r.actors[0].uuid)).toBe(true);
  expect(r.physics.bot.entity.position.distanceTo(before)).toBeLessThan(6);expect(r.runtime.status().goalCompleted).toBe(false);
});
it('the same low-health combat gate retreats without issuing an attack and keeps physical motion alive',async()=>{
  const r=rig({enemyDistance:2.5,health:6}),before=r.physics.bot.entity.position.clone();r.runtime.start();
  await vi.waitFor(()=>expect(r.runtime.status().combat.retreating).toBe(true),{timeout:3000});
  await vi.waitFor(()=>expect(r.physics.bot.entity.position.distanceTo(before)).toBeGreaterThan(.2),{timeout:3000});
  expect(r.commands.some(c=>c.input.attack)).toBe(false);
});
it('native air ticks are converted to the shared oxygen scale and reuse the drowning reflex',async()=>{
  const r=rig({combat:false,water:true,oxygen:30});r.runtime.start();
  await vi.waitFor(()=>expect(r.commands.some(c=>c.input.owner==='environment'&&c.input.keys.jump)).toBe(true),{timeout:4500});
  expect(r.commands.some(c=>c.input.attack)).toBe(false);expect(r.runtime.status().environment).toBe('drown');
},6000);
it('native emergency rescue remains enabled with ordinary surface swimming disabled',async()=>{
  const r=rig({combat:false,water:true,oxygen:30});
  r.cfg.reflex.antiDrown=false;
  expect(r.cfg.reflex.emergencyDrown).toBe(true);
  r.runtime.start();
  await vi.waitFor(()=>expect(r.commands.some(c=>c.input.owner==='environment'&&c.input.keys.jump)).toBe(true),{timeout:4500});
  expect(r.commands.some(c=>c.input.attack)).toBe(false);
},6000);
it('fresh tactical candidates use the existing track/engage selection and reject a stale generation',async()=>{
  const r=rig({enemyDistance:5});await r.runtime.poll();
  const sample=await r.runtime.tool({battlefield:true},{role:'host-decision'} as any),frame=(sample.meta as any).frame;
  expect(frame.candidates.map((c:any)=>c.kind)).toEqual(expect.arrayContaining(['track','engage','retreat']));
  const track=frame.candidates.find((c:any)=>c.kind==='track');
  const rejected=await r.runtime.tool({choice:{candidate:track,tacticRevision:frame.tacticRevision,connectionGeneration:99}},{role:'host-decision'} as any);
  expect((rejected.meta as any).receipt.accepted).toBe(false);
  const accepted=await r.runtime.tool({choice:{candidate:track,tacticRevision:frame.tacticRevision,connectionGeneration:frame.battlefield.connectionGeneration}},{role:'host-decision'} as any);
  expect((accepted.meta as any).receipt.accepted).toBe(true);expect(r.runtime.combat.tracking).toBe(true);
});
it('authorization revocation releases native inputs and never treats old damage as a new instruction',async()=>{
  const r=rig({enemyDistance:2.5});r.runtime.start();await vi.waitFor(()=>expect(r.runtime.combat.active).toBe(true),{timeout:3000});
  r.auth(false);await r.runtime.poll();expect(r.commands.at(-1).input.owner).toBe('idle');expect(r.runtime.combat.active).toBe(false);
  r.auth(true);r.actors.splice(0);r.damage.push({seq:1,atMs:Date.now()-60000,entityId:1,causeId:2,directId:2,sourceType:'minecraft:mob_attack'});
  await r.runtime.poll();expect(r.runtime.combat.active).toBe(false);
  expect(r.commands.map(c=>c.sequence)).toEqual([...r.commands.map(c=>c.sequence)].sort((a,b)=>a-b));
});
it('a body respawn rejects old tactical choices even while the network connection remains unchanged',async()=>{
  const r=rig({enemyDistance:5});await r.runtime.poll();
  const sample=await r.runtime.tool({battlefield:true},{role:'host-decision'} as any),frame=(sample.meta as any).frame;
  const candidate=frame.candidates.find((c:any)=>c.kind==='track'),network=r.frame().generation;
  r.respawn();await r.runtime.poll();
  expect(r.frame().generation).toBe(network);
  const rejected=await r.runtime.tool({choice:{candidate,tacticRevision:frame.tacticRevision,connectionGeneration:frame.battlefield.connectionGeneration}},{role:'host-decision'} as any);
  expect((rejected.meta as any).receipt.accepted).toBe(false);
  const fresh=await r.runtime.tool({battlefield:true},{role:'host-decision'} as any);
  expect((fresh.meta as any).frame.battlefield.connectionGeneration).not.toBe(frame.battlefield.connectionGeneration);
  expect(r.commands.at(-1).bodyScope).toBe(r.frame().reflexGeneration);
});

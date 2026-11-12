import { it, expect } from 'vitest';
import { MethodRunner, type MethodRun } from '../core/method-runner.ts';
import { prepareWorkRoutine } from '../core/work-routines.ts';

async function trip(options:{occupied?:boolean;blocked?:boolean;ambiguous?:boolean;shoreUnknown?:boolean;pickup?:boolean;changed?:boolean}={}){
 let p={x:.5,y:64,z:.5},vehicle:any=null,count=1,tick=0,generation=1;
 const entities:any={},calls:any[]=[];
 const state=()=>({sampledAt:new Date(++tick).toISOString(),connectionGeneration:generation,combatActive:false,
  snapshot:{position:{...p},dimension:'overworld',health:20,invSynced:true,inventory:[{name:'oak_boat',count}],vehicle:vehicle?structuredClone(vehicle):null},
  movement:{onGround:!vehicle,vehicleAttached:!!vehicle}});
 let finish!:(r:MethodRun)=>void;const ended=new Promise<MethodRun>(r=>finish=r);
 const runner=new MethodRunner({onFinish:finish,nativeMethods:['read','blockAt'],call:async(method,args)=>{
  if(method==='state')return state();
  if(method==='mineflayer'){
   if(args.name==='read')return {value:{availability:{entities:true},entities:structuredClone(entities)}};
   const at=(args.args as number[][])[0]!;return {value:options.shoreUnknown?null:{name:at[1]<64?'stone':'air',boundingBox:at[1]<64?'block':'empty'}};
  }
  const step=(args.steps as any[])[0];calls.push(step);let done=true;
  if(step.skill==='use'){count--;entities[9]={id:9,name:'boat',position:{x:1.5,y:64,z:.5},isValid:true};
   if(options.ambiguous)entities[10]={...entities[9],id:10};}
  else if(step.recover){done=!options.occupied;if(done)delete entities[9];}
  else if(step.skill==='pickup'){if(options.pickup!==false)count++;}
  else if(step.off){vehicle=null;}
  else if(step.to){done=!options.blocked;if(done){p={x:step.to[0]+.5,y:64,z:step.to[2]+.5};vehicle.position={...p};}if(options.changed)generation++;}
  else if(step.skill==='ride')vehicle={entityId:step.entityId,name:'boat',position:{...p}};
  else if(step.skill==='goto')p={x:step.at[0]+.5,y:step.at[1],z:step.at[2]+.5};
  return{accepted:true,done,taskId:calls.length,state:state(),receipt:done?'native operation confirmed':'blocked'};
 }});
 runner.start(prepareWorkRoutine('boat_trip',{dimension:'overworld',item:'oak_boat',placeAt:[1,64,0],waypoints:[[5,64,0]],shore:[6,64,0],recoverAtEnd:true}));
 return{end:await ended,calls,vehicle:()=>vehicle};
}
it('runs placement, identity-bound boarding, drive, landing and inventory-confirmed pickup in one script',async()=>{
 const r=await trip();expect(r.end.status).toBe('completed');
 expect(r.end.result).toMatchObject({goalCompleted:true,recovered:true,boatInventoryDelta:1,entityId:9});
 expect(r.calls).toEqual([{skill:'use',item:'oak_boat',at:[1,64,0]},{skill:'ride',target:'boat',entityId:9},
  {skill:'ride',target:'boat',entityId:9,to:[5,64,0]},{skill:'ride',off:true},
  {skill:'goto',at:[6,64,0],dimension:'overworld',exact:true,walkOnly:true},
  {skill:'ride',target:'boat',entityId:9,recover:true},{skill:'pickup',item:'oak_boat'}]);
});
it.each(['blocked','shoreUnknown','changed'] as const)('keeps the boat attached after %s and never starts recovery',async key=>{
 const r=await trip({[key]:true});expect(r.end.result).toMatchObject({goalCompleted:false});
 expect(r.calls.some(c=>c.off||c.recover)).toBe(false);expect(r.vehicle()).not.toBeNull();
});
it('does not choose an arbitrary boat when placement identity is ambiguous',async()=>{
 const r=await trip({ambiguous:true});expect(r.end.result).toMatchObject({goalCompleted:false,reason:'new_boat_unconfirmed_do_not_repeat_placement'});
 expect(r.calls).toHaveLength(1);
});
it('cannot report a successful trip when the empty boat disappeared but the item did not arrive',async()=>{
 const r=await trip({pickup:false});expect(r.end.result).toMatchObject({goalCompleted:false,recovered:false,reason:'boat_pickup_unconfirmed'});
});
it('stops on occupied recovery instead of issuing an unrelated pickup',async()=>{
 const r=await trip({occupied:true});expect(r.end.result).toMatchObject({goalCompleted:false,reason:'boat_recovery_blocked'});
 expect(r.calls.at(-1).recover).toBe(true);
});
it('requires an unambiguous starting boat and a real boat item',()=>{
 const base={dimension:'overworld',item:'oak_boat',waypoints:[[5,64,0]]};
 expect(()=>prepareWorkRoutine('boat_trip',base)).toThrow();
 expect(()=>prepareWorkRoutine('boat_trip',{...base,placeAt:[0,64,0],entityId:9})).toThrow();
 expect(()=>prepareWorkRoutine('boat_trip',{...base,entityId:9,item:'oak_chest_boat'})).toThrow();
});

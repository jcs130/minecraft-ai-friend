import {expect,it} from 'vitest';
import {MethodRunner,type MethodRun} from '../core/method-runner.ts';
import {prepareWorkRoutine} from '../core/work-routines.ts';
function run(id:string,params:any,options:{wrongDimension?:boolean;wrongVehicle?:boolean;lowHealth?:boolean}={}) {
 let dimension='overworld',vehicle:any=null,position={x:.5,y:64,z:.5},count=0;
 const writes:any[]=[];
 const state=()=>({sampledAt:new Date().toISOString(),connectionGeneration:1,snapshot:{health:options.lowHealth?2:20,dimension,position,vehicle},combatActive:false});
 let end!:(r:MethodRun)=>void;const terminal=new Promise<MethodRun>(r=>{end=r;});
 const runner=new MethodRunner({onFinish:end,call:async(method,args)=>{
  if(method==='state')return state();
  const s=(args.steps as any[])[0];writes.push(s);count++;
  if(s.skill==='transit') {dimension=options.wrongDimension?'the_end':params.portals[count-1].toDimension;position={x:10+count,y:70,z:10};}
  else if(s.skill==='ride') {
   if(s.off)vehicle=null;
   else if(s.target)vehicle={entityId:options.wrongVehicle?99:params.entityId,name:params.target,position};
   else {position={x:s.to[0]+.5,y:s.to[1],z:s.to[2]+.5};vehicle={...vehicle,position};}
  }
  return {accepted:true,done:true,taskId:count,receipt:'observed',state:state()};
 }});
 runner.start(prepareWorkRoutine(id,params));return {terminal,writes};
}
it('does not carry a portal route into an unexpected destination dimension',async()=>{
 const params={dimension:'overworld',portals:[{at:[1,64,0],fromDimension:'overworld',toDimension:'the_nether'},{at:[2,70,0],fromDimension:'the_nether',toDimension:'overworld'}]};
 const good=run('portal_route',params);expect(await good.terminal).toMatchObject({result:{goalCompleted:true,remaining:[]}});expect(good.writes).toHaveLength(2);
 const wrong=run('portal_route',params,{wrongDimension:true});expect(await wrong.terminal).toMatchObject({result:{goalCompleted:false,reason:'dimension_mismatch',dimension:'the_end',remaining:params.portals}});expect(wrong.writes).toHaveLength(1);
 const low=run('portal_route',params,{lowHealth:true});expect(await low.terminal).toMatchObject({result:{reason:'low_health',remaining:params.portals}});expect(low.writes).toHaveLength(0);
});
it('keeps one exact vehicle identity across a route and never drives after a wrong attachment',async()=>{
 const params={dimension:'overworld',target:'boat',entityId:7,waypoints:[[3,64,0],[6,64,0]],dismountAtEnd:true};
 const good=run('ride_route',params);expect(await good.terminal).toMatchObject({result:{goalCompleted:true,remaining:[],vehicle:null}});expect(good.writes).toHaveLength(4);
 const wrong=run('ride_route',params,{wrongVehicle:true});expect(await wrong.terminal).toMatchObject({result:{reason:'mount_unconfirmed',remaining:params.waypoints}});expect(wrong.writes).toHaveLength(1);
});

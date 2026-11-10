import {afterEach,it,expect,vi} from 'vitest';
import {Vec3} from 'vec3';
import {sampleIdleActions,executeIdleAction,wanderSafe} from '../core/idle-actions.ts';
import {IdleBehaviorController} from '../core/idle-behavior.ts';
function flat(){
 const controls:Record<string,boolean>={};
 const bot:any={entity:{id:1,position:new Vec3(.5,64,.5),yaw:0,pitch:0,onGround:true},entities:{},
  blockAt:(p:Vec3)=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',shapes:p.y<64?[[0,0,0,1,1,1]]:[],getProperties:()=>({})}),
  world:{raycast:()=>null},findBlocks:()=>[],getControlState:(k:string)=>!!controls[k],
  setControlState:(k:string,v:boolean)=>{controls[k]=v;},look:async(y:number,p:number)=>{bot.entity.yaw=y;bot.entity.pitch=p;}};
 return {bot,controls};
}
afterEach(()=>vi.useRealTimers());
it('offers a short grounded stroll but rejects water, missing chunks, cliffs and blocked headroom',()=>{
 const {bot}=flat(),from=bot.entity.position,to=from.offset(0,0,-2.4);
 expect(wanderSafe(bot,from,to)).toBe(true);
 expect(sampleIdleActions(bot,{allowMovement:true}).candidates.some(c=>c.id==='wander')).toBe(true);
 expect(sampleIdleActions(bot,{allowMovement:false}).candidates.some(c=>c.id==='wander')).toBe(false);
 const original=bot.blockAt;
 for(const mode of ['water','unloaded','cliff','head']){
  bot.blockAt=(p:Vec3)=>p.z>=0?original(p):mode==='unloaded'?null:mode==='water'?{...original(p),name:'water'}
   :mode==='cliff'?{...original(p),boundingBox:'empty',shapes:[]}:{...original(p),boundingBox:p.y===65?'block':original(p).boundingBox,
     shapes:p.y===65?[[0,0,0,1,1,1]]:original(p).shapes};
  expect(wanderSafe(bot,from,to),mode).toBe(false);
 }
});
it('moves through owned controls and releases synchronously before a successor takes the body',async()=>{
 vi.useFakeTimers();const {bot,controls}=flat(),stop=new AbortController();
 const sampled=sampleIdleActions(bot,{allowMovement:true});
 const outcome=executeIdleAction(bot,'wander',sampled.state,stop.signal,{available:()=>true,inventoryPreview:()=>{}}).catch(e=>e);
 await vi.advanceTimersByTimeAsync(60);expect(controls.forward).toBe(true);
 stop.abort('new task');expect(controls.forward).toBe(false);
 bot.setControlState('forward',true);await outcome;
 expect(controls.forward).toBe(true);
});
it('stops a stroll when its runtime safety lease changes',async()=>{
 vi.useFakeTimers();const {bot,controls}=flat();let safe=true;
 const result=executeIdleAction(bot,'wander',sampleIdleActions(bot,{allowMovement:true}).state,new AbortController().signal,
  {available:()=>safe,inventoryPreview:()=>{}}).catch(e=>e);
 await vi.advanceTimersByTimeAsync(60);safe=false;await vi.advanceTimersByTimeAsync(60);
 expect((await result).name).toBe('AbortError');expect(controls.forward).toBe(false);
});
it('does not choose wandering at random and admits a model-selected stroll only once',async()=>{
 vi.useFakeTimers();let cancelled=false;
 const execute=vi.fn((_id,_scene,signal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>{cancelled=true;resolve();},{once:true})));
 const controller=new IdleBehaviorController({config:()=>({enabled:true,selector:'random',minIdleMs:0,minIntervalMs:1000,maxIntervalMs:1000}),
  host:{scene:()=>({generation:'1',state:{},candidates:[{id:'wander',label:'stroll'}]}),execute,record:()=>{}}});
 controller.tick();expect(execute).not.toHaveBeenCalled();
 expect(controller.startSelected('wander')).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
 expect(controller.startSelected('wander')).toBe(false);controller.cancel('task');expect(cancelled).toBe(true);controller.stop();
});

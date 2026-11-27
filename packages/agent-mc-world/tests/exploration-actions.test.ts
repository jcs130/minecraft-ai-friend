import { describe, expect, it, vi } from 'vitest';
import { explorationActions } from '../src/client/exploration.ts';
import type { ToolDef, WorldHost, WorldRequestFacts } from '../src/client/contracts.ts';
import { MinecraftWorld } from '../core/world.ts';

function setup() {
  const scene={decision:{state:{action:{task:null,queued:0}}},parts:[{key:'terrain',text:'东侧草地'}],
    decisionStability:{sampledAtMs:Date.now(),position:[-10.5,65,20.5],dimension:'overworld',identity:['server','account'],
      route:{generation:2,positionEpoch:5,risks:[],task:null,waiting:[],fighting:false,windowOpen:false}}};
  let pick='east';
  const request=vi.fn(async(input:any)=>{
    const ids=Object.keys(input.questions.action.criteria);
    return {model:'fast',answers:{action:{choice:pick,confidence:1,probabilities:Object.fromEntries(ids.map(id=>[id,id===pick?1:0]))}}};
  });
  const host={decisions:{request}} as unknown as WorldHost;
  const native=vi.fn(async(_args:any,_ctx:any)=>({text:'queued #2',execution:{taskId:2}}));
  const base={name:'mc_do',parameters:{properties:{steps:{}},required:['steps']},handler:native} as unknown as ToolDef;
  const factory=explorationActions(()=>host,()=>scene as unknown as WorldRequestFacts,()=> 'fast-provider');
  const body=factory(base);
  const call=(args:any,signal?:AbortSignal)=>body.handler(args,{role:'agent',log:{} as any,callId:'test-call',signal});
  return {scene,request,native,call,setPick:(p:string)=>{pick=p;}};
}
describe('fast exploration through the existing body tool',()=>{
  it('selects from actual directional coordinates once and preserves the original body admission',async()=>{
    const {call,request,native}=setup();
    const out=await call({explore:{goal:'探路',distance:64}});
    expect(out).toMatchObject({execution:{taskId:2},data:{exploration:{at:[53,20],choice:'east'}}});
    expect(request).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith(expect.objectContaining({queue:'append',steps:[{skill:'goto',at:[53,20],dimension:'overworld'}]}),
      expect.objectContaining({callId:'test-call',attribution:{controller:'system1'}}));
  });
  it('respects exact feet coordinates and a diagonal heading',async()=>{
    const {call,native,setPick}=setup();setPick('destination');
    await call({explore:{at:[10,65,23]}});
    expect(native.mock.calls[0]![0].steps[0]).toMatchObject({at:[10,65,23],exact:true});
    setPick('southwest');await call({explore:{direction:'southwest',distance:10}});
    expect(native.mock.calls[1]![0].steps[0].at).toEqual([-18,27]);
  });
  it('never dispatches an invalid, held, stale, or concurrently selected route',async()=>{
    const {call,request,native,setPick,scene}=setup();
    await call({explore:{at:[1,2],direction:'east'}});expect(request).not.toHaveBeenCalled();
    setPick('hold');expect(await call({explore:{}})).toMatchObject({data:{executed:false}});
    let resolve!: (v:any)=>void;
    request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    const old=call({explore:{direction:'east'}});
    expect(await call({explore:{}})).toMatchObject({failed:true});
    scene.decisionStability.route.generation++;
    resolve({answers:{action:{choice:'east',confidence:1,probabilities:{east:1,hold:0}}}});
    expect(await old).toMatchObject({data:{executed:false}});expect(native).not.toHaveBeenCalled();
  });
  it('drops a late provider answer after caller cancellation and releases the selector',async()=>{
    const {call,request,native}=setup();
    const cancel=new AbortController();
    request.mockImplementationOnce(()=>new Promise(()=>{}));
    const pending=call({explore:{direction:'east'}},cancel.signal);
    cancel.abort();
    expect(await pending).toMatchObject({data:{executed:false}});
    expect(native).not.toHaveBeenCalled();
    expect(await call({explore:{direction:'east'}})).toMatchObject({execution:{taskId:2}});
  });
  it('preserves ordinary actions and distinguishes loss of the admission reply from no execution',async()=>{
    const {call,request,native}=setup();const original={steps:[{skill:'chat',text:'你好'}]};
    await call(original);expect(native.mock.calls[0]![0]).toBe(original);expect(request).not.toHaveBeenCalled();
    native.mockRejectedValueOnce(Error('IPC disconnected'));
    expect(await call({explore:{direction:'east'}})).toMatchObject({data:{status:'admission_unknown',executed:null}});
  });
  it('rejects stale body admissions inside the game process before they enter the native queue',()=>{
    const engine=Object.create(MinecraftWorld.prototype);
    engine.bridge={bot:{entity:{position:{x:0,y:64,z:0}}}};
    const outcome=engine.enqueueTool('mc_do',{explorationOrigin:{position:[100,64,0]}},()=>{throw Error('unexpected queue admission');});
    expect(outcome).toMatchObject({failed:true,data:{status:'stale',executed:false}});
  });
});

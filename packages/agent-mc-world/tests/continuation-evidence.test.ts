import {describe,it,expect} from 'vitest';
import {workContinuationEvidence as evidence, compactWorkExecutionEvidence as compact} from '../src/contracts/continuation-evidence.ts';
const read=(id:string,at:string,data:unknown)=>({text:'correlated '+id+' at '+at,data:{requestId:id,query:'dungeon.info',arguments:['crypt'],generation:'realm:1',username:'self',phase:'replied',sentAt:at,afterSequence:id.length,reply:{ok:true,text:id,data},endedAt:at}});

it('keeps the attempted action and observation separate across repeated compaction',()=>{
  const raw={steps:[{step:1,skill:'goto',what:'Go to (0,64,9)',outcome:'fail',why:'no movement',
    observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'goto',at:[0,64,9],status:'unchanged',
      before:{at:'2026-01-01T00:00:00Z',position:[0,64,0]},after:{at:'2026-01-01T00:00:10Z',position:[0,64,0]}}},
    {step:2,skill:'observe',what:'Read local voxels',outcome:'ok',decision:{status:'partial',completed:91,remaining:261,unit:'cells'},
      observation:{kind:'voxels',status:'partial',observedAt:'2026-01-01T00:00:10Z',readout:{kind:'voxels',knownComplete:false},cells:Array(352).fill(1)}}]};
  const result=compact(compact(raw))!;
  expect(result.steps).toMatchObject([{skill:'goto',what:'Go to (0,64,9)',outcome:'fail',observedEffect:{at:[0,64,9],
    before:{at:'2026-01-01T00:00:00Z',position:[0,64,0]},after:{at:'2026-01-01T00:00:10Z',position:[0,64,0]}}},
    {skill:'observe',what:'Read local voxels',decision:{unit:'cells'},observation:{kind:'voxels',readout:{knownComplete:false}}}]);
  expect(JSON.stringify(result)).not.toContain('"cells":[');expect(result.goalCompleted).toBe(false);
});
describe('checkpoint evidence content',()=>{
  it('delivers evidence clocks without counting resampling as new progress',()=>{
    const raw=(at:string,x:number)=>({steps:[{step:1,skill:'goto',what:'goto',observedEffect:{schema:'agent-mc-observed-effect/v1',at:[1,64,2],status:'unchanged',before:{at,position:[x,64,0]},after:{at,position:[x,64,0]}}},
      {step:2,skill:'observe',observation:{kind:'voxels',observedAt:at,summary:{observedCells:20,unknownCells:3}}}]});
    for(const kind of ['queue','terminal']){
      const run=(at:string,x:number)=>evidence({tool:'do',arguments:{},receipt:kind==='queue'?{data:{protocol:'agent-mc/task-queue-read/v1',last:{kind:'done',evidence:raw(at,x)}}}:{},
        ...(kind==='terminal'?{terminal:{execution:{kind:'task',phase:'completed',terminal:true,evidence:raw(at,x)}}}:{})}).key;
      expect(run('old',0)).toBe(run('new',0));expect(run('old',0)).not.toBe(run('new',1));
    }
    expect(JSON.stringify(compact(raw('observed-now',0)))).toContain('observed-now');
  });
  it('compares reply facts rather than request ids, timestamps, ordering or prose wrappers',()=>{
    const a=evidence({tool:'query',arguments:{query:'dungeon.info'},receipt:JSON.stringify(read('q-1','10:00',{entranceConfigured:false,routeVerified:false}))});
    const b=evidence({tool:'query',arguments:{requestId:'q-1234567'},receipt:read('q-1234567','11:00',{routeVerified:false,entranceConfigured:false})});
    expect(a.key).toBe(b.key);expect(a.goalCompleted).toBe(false);
    expect(evidence({tool:'query',arguments:{},receipt:read('q-2','12:00',{entranceConfigured:true,routeVerified:false})}).key).not.toBe(a.key);
  });
  it('preserves domain identities, coordinates and expiry changes',()=>{
    const run=(data:unknown)=>evidence({tool:'query',arguments:{},receipt:read('q','now',data)}).key;
    expect(run({id:'raid-a',x:1,expiresAt:10})).not.toBe(run({id:'raid-b',x:1,expiresAt:10}));
    expect(run({id:'raid-a',x:1,expiresAt:10})).not.toBe(run({id:'raid-a',x:2,expiresAt:10}));
    expect(run({id:'raid-a',x:1,expiresAt:10})).not.toBe(run({id:'raid-a',x:1,expiresAt:11}));
  });
  it('does not renew a checkpoint from pending requests or entirely unknown space',()=>{
    expect(evidence({tool:'query',arguments:{},receipt:{requestId:'q',query:'read',phase:'pending'}}).key).toBeNull();
    expect(evidence({tool:'do',arguments:{},receipt:{execution:{kind:'task',id:'1',terminal:false}}}).key).toBeNull();
    expect(evidence({tool:'observe',arguments:{},receipt:{readout:{protocol:'agent-mc-spatial-read/v1',revision:'r',selection:'s'},summary:{observedCells:0,unknownCells:480}}}).key).toBeNull();
  });
  it('uses spatial revisions while preserving selection and realm boundaries',()=>{
    const run=(worldKey:string,selection:string,revision:string,observedAt:string)=>evidence({tool:'observe',arguments:{},receipt:{readout:{protocol:'agent-mc-spatial-read/v1',worldKey,selection,revision},observedAt}}).key;
    expect(run('a','s','r','old')).toBe(run('a','s','r','new'));
    expect(run('a','s','r','old')).not.toBe(run('b','s','r','new'));
    expect(run('a','s','r','old')).not.toBe(run('a','s2','r','new'));
    expect(run('a','s','r','old')).not.toBe(run('a','s','r2','new'));
  });
  it('deduplicates redelivered native terminals without deleting narrative content',()=>{
    const run=(id:string,text:string)=>evidence({tool:'do',arguments:{at:[1,2,3]},receipt:{execution:{terminal:false}},terminal:{source:'game',type:'game.task',cursor:id,execution:{kind:'task',id,phase:'failed',terminal:true},text}}).key;
    expect(run('1','任务#1 [10:20:30] protected block (1,2,3)')).toBe(run('2','任务#2 [11:22:33] protected block (1,2,3)'));
    expect(run('1','任务#1 [10:20:30] protected block (1,2,3)')).not.toBe(run('2','任务#2 [11:22:33] protected block (2,2,3)'));
    expect(evidence({tool:'chat',arguments:{},receipt:'meet at 10:20:30'}).key).not.toBe(evidence({tool:'chat',arguments:{},receipt:'meet at 11:22:33'}).key);
  });
});

it('preserves blocked/unchanged and unknown scan evidence beside long native prose, without copying bulk arrays',()=>{
  const raw={receipt:'x'.repeat(9000),steps:[{step:1,outcome:'fail',why:'protected block',decision:{status:'blocked',completed:0,remaining:1,retryable:false},
    observedEffect:{schema:'agent-mc-observed-effect/v1',status:'unchanged',changed:{position:false,inventory:false,target:null,window:false},before:{position:[1,2,3],inventory:{privateBulk:'x'.repeat(9000)}},after:{position:[1,2,3]}}},
    {step:2,outcome:'ok',observation:{readout:{protocol:'agent-mc-spatial-read/v1',selection:'s',revision:'r',unknownCount:480},summary:{observedCells:0,unknownCells:480},cells:Array(480).fill(-1)}}]};
  const projected=compact(raw)!;expect(JSON.stringify(projected)).not.toContain('privateBulk');expect(JSON.stringify(projected).length).toBeLessThan(1800);
  expect((projected.steps as any[])[0]).toMatchObject({decision:{status:'blocked'},observedEffect:{status:'unchanged',changed:{position:false,inventory:false,target:null}}});
  expect((projected.steps as any[])[1].observation.summary).toEqual({observedCells:0,unknownCells:480});
  expect(projected.goalCompleted).toBe(false);
});
it('retains source step coverage when a cached compact summary is projected again',()=>{
  const once=compact({steps:Array.from({length:20},(_,i)=>({step:i+1,outcome:'ok'}))})!;
  const twice=compact(once)!;expect(twice.totalSteps).toBe(20);expect(twice.omittedSteps).toBe(12);
  expect((twice.steps as any[]).map(s=>s.step)).toEqual([1,2,3,4,17,18,19,20]);
});
it('does not label a native unknown-only scan terminal as useful new continuation',()=>{
  expect(evidence({tool:'do',arguments:{},receipt:{execution:{terminal:false}},terminal:{execution:{kind:'task',terminal:true,phase:'completed',evidence:{steps:[{step:1,observation:{summary:{observedCells:0,unknownCells:480}}}]}}}}).key).toBeNull();
});

it('preserves bounded native result qualifications and original truncation through repeated projection',()=>{
  const raw={steps:[{step:1,outcome:'ok',why:null,detail:{text:'命令未发送；改用 chat.text。'+'x'.repeat(900),chars:2000,truncated:true}}]};
  const once=compact(raw)!,twice=compact(once)!;
  expect(twice).toEqual(once);
  expect((twice.steps as any[])[0].detail).toMatchObject({chars:2000,truncated:true,text:expect.stringContaining('命令未发送')});
  expect((twice.steps as any[])[0].detail.text.length).toBe(600);
  expect(twice.goalCompleted).toBe(false);
  const run=(text:string)=>evidence({tool:'queue',arguments:{},receipt:{data:{protocol:'agent-mc/task-queue-read/v1',
    last:{kind:'done',evidence:{steps:[{step:1,outcome:'ok',detail:{text,chars:text.length,truncated:false}}]}}}}}).key;
  expect(run('命令未发送')).not.toBe(run('已向聊天发送，服务端结果未确认'));
});

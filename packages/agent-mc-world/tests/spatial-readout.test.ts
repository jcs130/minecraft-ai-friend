import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { observeSpatial } from '../core/spatial-observation.ts';
import { spatialReadout } from '../src/client/index.ts';
import { SPATIAL_READOUT_TEXT_RESERVE } from '../core/spatial-readout.ts';
import { methodHarness } from './method-harness.ts';

vi.mock('../core/perception-sight.ts', async load => ({ ...await load<typeof import('../core/perception-sight.ts')>(), observedBlock: () => true, observedEntity: () => true }));

const receipt = () => ({source:'client-visible-world',kind:'voxels',format:'dense',observedAt:'2026-10-29T00:00:00Z',
  observed_at:'2026-10-29T00:00:00Z',dimension:'overworld',frame:{position:[1.5,64,1.5],feet:[1,64,1]},
  coverage:{origin:[1,64,1],requestedBounds:[1,64,1,17,66,1],requestedCount:51,returnedCount:51,remainingCount:0,
    coverageComplete:true,unknownCount:39},complete:false,retryable:false,next_safe_read:null,next:null,
  bounds:[1,64,1,17,66,1],cells:[0,1,-1],palette:[{name:'chest',stateId:203,properties:{waterlogged:false}}]});

describe('shared current spatial read feedback',()=>{
  it('distinguishes an exhausted partial scan from a pending action or missing next page',()=>{
    const data=receipt(),before=structuredClone(data),r=spatialReadout(data)!;
    expect(r).toMatchObject({protocol:'agent-mc-spatial-read/v1',historical:false,kind:'voxels',
      scanComplete:true,knownComplete:false,remainingCount:0,unknownCount:39,unknownUnit:'cells',retryable:false,continuationAvailable:false});
    expect(r.interpretation).toContain('扫描已读完');expect(r.interpretation).toContain('不是排队结果');
    expect(JSON.stringify(r).length).toBeLessThan(SPATIAL_READOUT_TEXT_RESERVE);
    expect(data).toEqual(before);
  });
  it('ignores only sample time and opaque continuation identity, preserving numeric scene changes',()=>{
    const data=receipt(),first=spatialReadout(data)!;
    const repeated={...data,observedAt:'2026-10-29T01:00:00Z',observed_at:'2026-10-29T01:00:00Z',next:{cursor:'another-handle'}};
    expect(spatialReadout(repeated)!.revision).toBe(first.revision);
    for(const changed of [{...data,cells:[1,1,-1]},{...data,frame:{...data.frame,position:[2.5,64,1.5]}},
      {...data,palette:[{name:'chest',stateId:204,properties:{waterlogged:false}}]}]){
      expect(spatialReadout(changed)!.revision).not.toBe(first.revision);
    }
    expect(spatialReadout({...data,bounds:[2,64,1,18,66,1]})!.selection).not.toBe(first.selection);
  });
  it('keeps omitted counts unknown and does not infer read evidence from prose or another source',()=>{
    expect(spatialReadout({text:'unknown 39; complete'})).toBeNull();
    expect(spatialReadout({...receipt(),source:'historical-note'})).toBeNull();
    expect(spatialReadout({...receipt(),coverage:{},retryable:undefined})!).toMatchObject({scanComplete:null,unknownCount:null,remainingCount:null,retryable:null});
  });
  it('puts actual read coverage before a capped dense body and exposes it through the native read-only tool',async()=>{
    const r=methodHarness('1.21.1');
    try{
      const submit=vi.spyOn(r.exec,'submit'),position=r.bot.entity.position.clone();
      const feet=r.bot.entity.position.floored();
      r.bot.blockAt=((p:Vec3)=>p.x>r.bot.entity.position.x+3?null:p.x===feet.x+2&&p.y===feet.y&&p.z===feet.z
        ?{name:'chest',stateId:203,shapes:[[0,0,0,1,1,1]],getProperties:()=>({})}
        :{name:'air',stateId:0,shapes:[],getProperties:()=>({})}) as never;
      const tool=r.world.tools().find(x=>x.name==='mc_observe')!;
      const result=await tool.handler({mode:'voxels',bounds:[0,0,0,16,2,0]},{role:'test',log:r.host.log});
      if(typeof result==='string')throw Error('Expected native structured read');
      expect(result.meta?.observation).toMatchObject({protocol:'agent-mc-spatial-read/v1',historical:false,scanComplete:true,unknownCount:39});
      expect(result.text.slice(0,1200)).toContain('扫描已读完');
      expect(result.text.slice(0,1500)).toContain('"name":"chest"');
      expect(result.data?.readout).toEqual(result.meta?.observation);
      expect(submit).not.toHaveBeenCalled();expect(r.bot.entity.position.equals(position)).toBe(true);
    }finally{r.close();}
  });
  it('keeps real dense numeric cells and complete original data alongside the prefix',()=>{
    const bot={entity:{id:1,position:new Vec3(0.5,64,0.5),yaw:0,pitch:0},entities:{},game:{dimension:'overworld'},
      blockAt:()=>({name:'stone',stateId:1,shapes:[[0,0,0,1,1,1]],getProperties:()=>({})})} as unknown as Bot;
    const data=observeSpatial(bot,{mode:'voxels',format:'dense',bounds:[0,0,0,0,0,0]});
    expect(data).toMatchObject({readout:{scanComplete:true,knownComplete:true,unknownCount:0},cells:[0],palette:[{stateId:1}]});
    expect(Object.keys(data)[0]).toBe('readout');
  });
});

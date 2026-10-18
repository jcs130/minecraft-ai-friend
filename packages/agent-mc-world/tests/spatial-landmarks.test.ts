import { describe,it,expect,vi } from 'vitest';
vi.mock('../core/perception-sight.ts',async load=>({...await load<typeof import('../core/perception-sight.ts')>(),observedBlock:(_bot:unknown,p:{y:number})=>p.y>=63}));
import { Vec3 } from 'vec3';
import { observeSpatial } from '../core/spatial-observation.ts';
const full=[[0,0,0,1,1,1]];
function bot(){return {entity:{id:1,position:new Vec3(-20.5,64,-10.5),yaw:0,pitch:0},game:{dimension:'overworld'},entities:{},blockAt:(p:Vec3)=>{
  const name=p.y<63?'diamond_ore':p.x===-20&&p.z===-11&&p.y===64?'spruce_fence_gate':p.x===-21&&p.z===-10&&p.y===63?'stone_brick_stairs':p.y===63?'stone_bricks':'air';
  return {name,stateId:name==='air'?0:1,shapes:name==='air'||name.endsWith('gate')?[]:full,getProperties:()=>name.endsWith('gate')?{open:true,facing:'east'}:{}};
}};}
describe('bounded decoded voxel landmarks',()=>{
  it('preserves negative-coordinate stairs and open gates while reporting coverage before dense cells',()=>{
    const r=observeSpatial(bot() as never,{mode:'voxels',bounds:[-1,-3,-1,1,0,1]});if(r.kind!=='voxels')throw Error('voxels');
    expect(r.summary).toMatchObject({totalCells:36,observedCells:18,unknownCells:18,headLayerIncluded:false});
    expect(r.summary.landmarks).toContainEqual({at:[-20,64,-11],name:'spruce_fence_gate',properties:{open:true,facing:'east'}});
    expect(r.summary.landmarks).toContainEqual({at:[-21,63,-10],name:'stone_brick_stairs',properties:{}});
    expect(JSON.stringify(r.summary)).not.toContain('diamond_ore');expect(r.cells.filter(x=>x===-1)).toHaveLength(18);
    expect(r.summary.note).toContain('不证明入口');expect(r.summary.unknownMeaning).toContain('不是空气或实心');
  });
  it('caps landmarks, keeps omission counts and never promotes clues to route feasibility',()=>{
    const b=bot();b.blockAt=()=>({name:'stone_brick_stairs',stateId:1,shapes:full,getProperties:()=>({})});
    const r=observeSpatial(b as never,{mode:'voxels',bounds:[-2,0,-2,2,1,2]});if(r.kind!=='voxels')throw Error('voxels');
    expect(r.summary.headLayerIncluded).toBe(true);expect(r.summary.landmarks).toHaveLength(12);expect(r.summary.omittedLandmarks).toBe(38);
    expect(r.summary).not.toHaveProperty('reachable');expect(JSON.stringify(r.summary).length).toBeLessThan(2400);
  });
});

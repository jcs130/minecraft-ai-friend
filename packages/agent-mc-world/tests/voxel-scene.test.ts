import { describe, expect, it } from 'vitest';
import { captureVoxelScene,readVanillaBlockRegistry, type VoxelSceneInput } from '../core/voxel-scene.ts';

const box = [[0, 0, 0, 1, 1, 1]];
const input = (overrides: Partial<VoxelSceneInput> = {}): VoxelSceneInput => ({
  source: {kind:'client-loaded-chunks',minecraftVersion:'1.21.1',dimension:'minecraft:overworld',username:'test',uuid:'00000000-0000-0000-0000-000000000000',realmVerified:false},
  feet: [-.5,64,2.5], yaw: .2, pitch: -.4, eyeHeight: 1.62, fovDegrees: 75,
  bounds: {min:[-1,63,2],max:[1,63,2]}, sampledAt:'2026-10-20T00:00:00Z',
  blockAt:x=>({name:['oak_planks','stone_bricks','white_concrete'][x+1],stateId:x+4,shapes:box}), ...overrides,
});
describe('historical voxel scene export', () => {
  it('reads the complete explicit 1.21.1 registry rather than a color keyword table',()=>{
    const registry=readVanillaBlockRegistry('1.21.1');
    expect(registry.blocks.length).toBeGreaterThan(1000);
    expect(registry.blocks.find(x=>x.name==='minecraft:cherry_trapdoor')).toMatchObject({displayName:'Cherry Trapdoor'});
    const stairs=registry.blocks.find(x=>x.name==='minecraft:stone_brick_stairs')!;
    expect(stairs.maxStateId).toBeGreaterThan(stairs.minStateId);
    expect(()=>readVanillaBlockRegistry('missing-version')).toThrow('Exact Minecraft registry');
  });
  it('preserves distinct classes even when all would have had the same display color', () => {
    const scene=captureVoxelScene(input());
    expect(scene.palette.map(p=>p.name)).toEqual(['minecraft:oak_planks','minecraft:stone_bricks','minecraft:white_concrete']);
    expect(scene.cells).toEqual([0,1,2]);
    expect(scene.coverage).toMatchObject({known:3,nonAir:3,unknown:0,complete:true});
  });
  it('does not turn unloaded data or reader errors into air', () => {
    const scene=captureVoxelScene(input({blockAt:x=>{if(x===0)throw Error('unloaded');return x===-1?{name:'air',stateId:0,shapes:[]}:null;}}));
    expect(scene.cells).toEqual([0,-1,-1]);
    expect(scene.coverage).toMatchObject({known:1,air:1,unknown:2,nonAir:0,complete:false});
  });
  it('preserves mod names and state properties without assigning a vanilla category', () => {
    const scene=captureVoxelScene(input({blockAt:()=>({name:'example:polished_basalt_slab',stateId:902,properties:{type:'top',waterlogged:false},shapes:[[0,.5,0,1,1,1]]})}));
    expect(scene.palette).toHaveLength(1);
    expect(scene.palette[0]).toMatchObject({name:'example:polished_basalt_slab',stateId:902,properties:{type:'top',waterlogged:false},collisionShapes:[[0,.5,0,1,1,1]]});
  });
  it('preserves underground cells rather than retaining only the column top', () => {
    const scene=captureVoxelScene(input({bounds:{min:[0,0,0],max:[0,10,0]},blockAt:(_x,y)=>({name:y===2?'diamond_ore':'stone',stateId:y===2?9:1,shapes:box})}));
    expect(scene.cells).toHaveLength(11);
    expect(scene.palette[scene.cells[2]].name).toBe('minecraft:diamond_ore');
  });
  it('separates state variants of a class and retains explicit camera coordinates', () => {
    const scene=captureVoxelScene(input({blockAt:x=>({name:'oak_stairs',stateId:x+5,getProperties:()=>({facing:x===0?'east':'west'}),shapes:box})}));
    expect(scene.palette).toHaveLength(3);
    expect(scene.camera).toMatchObject({feet:[-.5,64,2.5],eye:[-.5,65.62,2.5],yaw:.2,pitch:-.4,roll:0,fovDegrees:75});
    expect(scene.source.realmVerified).toBe(false);
  });
  it('copies mutable source properties and collision shapes', () => {
    const properties={open:false},shapes=[[0,0,0,.2,1,1]];
    const scene=captureVoxelScene(input({blockAt:()=>({name:'oak_door',stateId:1,properties,shapes})}));
    properties.open=true;shapes[0][3]=1;
    expect(scene.palette[0].properties.open).toBe(false);
    expect(scene.palette[0].collisionShapes![0][3]).toBe(.2);
  });
  it('rejects unbounded/invalid scans before calling the reader', () => {
    const scan=input({bounds:{min:[0,0,0],max:[1000,1000,1000]},blockAt:()=>{throw Error('must not call');}});
    expect(()=>captureVoxelScene(scan)).toThrow('volume exceeds');
    expect(()=>captureVoxelScene(input({fovDegrees:NaN}))).toThrow('camera');
  });
  it('does not silently guess a shape for a known block with absent geometry', () => {
    const scene=captureVoxelScene(input({blockAt:()=>({name:'mod:machine',stateId:22000})}));
    expect(scene.palette[0]).toMatchObject({name:'mod:machine',collisionShapes:null,material:null});
  });
});

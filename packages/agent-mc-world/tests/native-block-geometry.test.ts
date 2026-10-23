import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import pathfinderPkg, { Movements } from 'mineflayer-pathfinder';
import AStar from 'mineflayer-pathfinder/lib/astar.js';
import Move from 'mineflayer-pathfinder/lib/move.js';
import { clearObservationRay } from '../core/perception-sight.ts';
import { observeSpatial } from '../core/spatial-observation.ts';
import { movementTouchesHazard } from '../core/hazard-geometry.ts';
import { doorPanelBlocksMove, doorStateOf, applyDoorState, installPathfinderPerf } from '../core/pathfinder-perf.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.21.1');
const Block = req('prismarine-block')(registry);
const air = Block.fromStateId(registry.blocksByName.air.defaultState, 0);
function state(name: string, properties: Record<string, string | boolean> = {}) {
  const type = registry.blocksByName[name];
  if (!Object.keys(properties).length) return Block.fromStateId(type.defaultState, 0);
  for (let id = type.minStateId; id <= type.maxStateId; id++) {
    const block = Block.fromStateId(id, 0), actual = block.getProperties();
    if (Object.entries(properties).every(([key, value]) => String(actual[key]) === String(value))) return block;
  }
  throw new Error(`Missing native state ${name} ${JSON.stringify(properties)}`);
}
function botFor(block: any) {
  return { entity: { position: new Vec3(.5,64,1.5), yaw: 0, pitch: 0 }, entities: {}, game: { dimension: 'overworld' },
    blockAt: (p: Vec3) => p.x===0&&p.y===64&&p.z===0 ? block : air };
}
function ray(block: any, y = .5, z = .5) {
  return clearObservationRay(botFor(block), { x:-.5,y:64+y,z }, { x:1.5,y:64+y,z });
}
function bodyIntersects(block: any, x = .5, z = .5) {
  const body=[x-.3,0,z-.3,x+.3,1.8,z+.3];
  return block.shapes.some((box:number[])=>[0,1,2].every(axis=>body[axis]<box[axis+3]&&body[axis+3]>box[axis]));
}

it('audits every installed Java 1.21.1 state and never makes known-empty geometry opaque', () => {
  let empty = 0, partial = 0, full = 0;
  const states = Object.keys(registry.blocksByStateId);
  expect(states.length).toBe(26684);
  for (const id of states) {
    const block = Block.fromStateId(Number(id), 0);
    expect(Array.isArray(block.shapes), `state ${id} ${block.name}`).toBe(true);
    for (const box of block.shapes) {
      expect(box.length, `state ${id} ${block.name}`).toBe(6);
      expect(box.every(Number.isFinite)).toBe(true);
      expect(box.slice(0,3).every((n: number, axis: number) => n < box[axis+3])).toBe(true);
    }
    if (!block.shapes.length) {
      empty++;
      expect(ray(block), `known empty state ${id} ${block.name}`).toBe(true);
    } else if (block.shapes.some((box: number[]) => box.every((n, axis) => n === [0,0,0,1,1,1][axis]))) full++;
    else partial++;
  }
  expect({empty,full,partial}).toEqual({empty:5011,full:2990,partial:18683});
}, 30000);

it.each(['vine','short_grass','tall_grass','fern','wheat','carrots','torch','rail','water','lava'])
  ('preserves native empty %s collision in both LOS and voxel material evidence', name => {
    const block = state(name);
    expect(block.shapes).toEqual([]);
    expect(ray(block)).toBe(true);
    const result = observeSpatial(botFor(block) as never,{mode:'voxels',bounds:[0,0,-1,0,0,-1]});
    expect(result.unknownCells).toBe(0);
    expect(result.palette[0]).toMatchObject({name,collision:[]});
  });

it('uses actual partial shapes for fence/wall/slab/stair/snow rather than whole-cell labels', () => {
  expect(ray(state('oak_fence'))).toBe(false);
  expect(ray(state('oak_fence'), .5, .1)).toBe(true); // A ray fits beside a post; this is not body clearance.
  expect(bodyIntersects(state('oak_fence'),.5,.1)).toBe(true); // The 0.6-wide body still clips the post.
  expect(ray(state('cobblestone_wall'))).toBe(false);
  expect(ray(state('oak_slab',{type:'bottom'}),.75)).toBe(true);
  expect(ray(state('oak_slab',{type:'top'}),.75)).toBe(false);
  expect(ray(state('oak_stairs',{half:'bottom',facing:'north',shape:'straight'}),.75,.75)).toBe(true);
  expect(ray(state('oak_stairs',{half:'bottom',facing:'north',shape:'straight'}),.75,.25)).toBe(false);
  expect(state('snow',{layers:'1'}).shapes).toEqual([]);
  expect(ray(state('snow',{layers:'8'}),.5)).toBe(false);
});

it('keeps open/closed door and trapdoor direction geometry distinct from gate emptiness', () => {
  const closed = state('oak_door',{facing:'north',half:'lower',hinge:'left',open:false});
  const opened = state('oak_door',{facing:'north',half:'lower',hinge:'left',open:true});
  expect(doorPanelBlocksMove(closed.shapes,0,-1)).toBe(true);
  expect(doorPanelBlocksMove(opened.shapes,0,-1)).toBe(false);
  expect(doorPanelBlocksMove(opened.shapes,1,0)).toBe(true);
  const closedGate = state('oak_fence_gate',{open:false});
  const openGate = state('oak_fence_gate',{open:true});
  expect(closedGate.shapes.length).toBeGreaterThan(0);
  expect(openGate.shapes).toEqual([]);
  expect(bodyIntersects(openGate)).toBe(false);
  const closedTrapdoor = state('oak_trapdoor',{facing:'north',half:'bottom',open:false});
  const openTrapdoor = state('oak_trapdoor',{facing:'north',half:'bottom',open:true});
  expect(ray(closedTrapdoor,.1)).toBe(false);
  expect(ray(closedTrapdoor,.5)).toBe(true);
  expect(openTrapdoor.shapes.length).toBeGreaterThan(0);
  expect(doorPanelBlocksMove(openTrapdoor.shapes,0,-1)).toBe(true);
  expect(doorStateOf(openTrapdoor.name,openTrapdoor.getProperties())).toBe(0); // No implicit trapdoor click.
  for (const block of [closed,opened,closedGate,openGate]) {
    const candidate = {safe:false,physical:true,openable:false,height:65};
    applyDoorState(candidate,doorStateOf(block.name,block.getProperties()),64,true);
    expect(candidate.physical).toBe(false);
    expect(candidate.openable).toBe(block.getProperties().open === false);
  }
});

it('keeps optical transparency, physical collision and hazard classification separate', () => {
  const glass = state('glass'), lava = state('lava'), water = state('water');
  expect(glass.shapes).toEqual([[0,0,0,1,1,1]]);
  expect(ray(glass)).toBe(true); // Optical rule; a body still collides with glass.
  expect(bodyIntersects(glass)).toBe(true);
  expect(lava.shapes).toEqual([]);
  expect(water.shapes).toEqual([]);
  const from={x:.5,y:64,z:1.5},to={x:.5,y:64,z:-1.5};
  const touches=(name:string)=>movementTouchesHazard(from,to,(x,y,z)=>x===0&&y===64&&z===0?name:'air');
  expect(touches('lava')).toBe(true);
  expect(touches('water')).toBe(false); // Not burning does not establish drowning/swimming safety.
  expect(touches('fire')).toBe(true);
});

function routeThrough(name: string, open: boolean, canOpenDoors = true) {
  const World=req('prismarine-world')(registry), Chunk=req('prismarine-chunk')(registry);
  const world=new World(null).sync, stone=registry.blocksByName.stone.defaultState;
  for(let x=-1;x<=0;x++)for(let z=-1;z<=0;z++)world.setColumn(x,z,new Chunk({minY:-64,worldHeight:384}));
  for(let z=-2;z<=2;z++)for(let x=-1;x<=1;x++) {
    world.setBlockStateId(new Vec3(x,63,z),stone);
    world.setBlockStateId(new Vec3(x,66,z),stone);
    if(x!==0)for(let y=64;y<=65;y++)world.setBlockStateId(new Vec3(x,y,z),stone);
  }
  const properties={facing:'north',open,...(name.endsWith('_trapdoor')?{half:'top'}:
    name.endsWith('_door')?{half:'lower',hinge:'left'}:{})};
  world.setBlockStateId(new Vec3(0,64,0),state(name,properties).stateId);
  if(name.endsWith('_door')&&!name.endsWith('_trapdoor'))
    world.setBlockStateId(new Vec3(0,65,0),state(name,{...properties,half:'upper'}).stateId);
  const bot={registry,version:'1.21.1',world,blockAt:(p:Vec3)=>world.getBlock(p),entities:{},
    entity:{position:new Vec3(.5,64,1.5),effects:{},height:1.8},inventory:{items:()=>[]},
    game:{minY:-64,height:384},pathfinder:{bestHarvestTool:()=>null}};
  installPathfinderPerf();
  const movements=new Movements(bot as never);
  movements.canDig=false; movements.canOpenDoors=canOpenDoors; movements.allowParkour=false;
  movements.allow1by1towers=false; movements.scafoldingBlocks=[];
  movements.exclusionAreasStep.push((b:any)=>b.position.x!==0||b.position.z < -1||b.position.z > 1?1000:0);
  (movements as any).clearCollisionIndex(); (movements as any).updateCollisionIndex();
  const {goals}=pathfinderPkg;
  const search=new (AStar as any)(new (Move as any)(0,64,1,0,0),movements,new goals.GoalBlock(0,64,-1),1000,40,4);
  let result=search.compute();
  while(result.status==='partial')result=search.compute();
  return result as {status:string;path:Array<{toPlace:Array<{useOne?:boolean}>;toBreak:unknown[]}>};
}

it.each(['oak_door','oak_fence_gate'])('routes through actual open/closed %s states with explicit optional click proposals',name=>{
  const open=routeThrough(name,true),closed=routeThrough(name,false);
  expect(open.status).toBe('success');
  expect(open.path.flatMap(p=>p.toPlace).filter(p=>p.useOne)).toHaveLength(0);
  expect(closed.status).toBe('success');
  expect(closed.path.flatMap(p=>p.toPlace).filter(p=>p.useOne)).toHaveLength(1);
  expect(closed.path.flatMap(p=>p.toBreak)).toEqual([]);
  expect(routeThrough(name,false,false).status).toBe('noPath');
});

it('does not assume an open trapdoor or closed iron door is an empty safe route',()=>{
  expect(routeThrough('oak_trapdoor',true).status).toBe('noPath');
  expect(routeThrough('oak_trapdoor',false).status).toBe('noPath'); // Top horizontal panel blocks this low corridor too.
  expect(routeThrough('iron_door',false).status).toBe('noPath');
});

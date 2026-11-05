import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {captureVoxelScene} from '../core/voxel-scene.ts';
import {RecordedSceneStore,recordedCase,reconstructRecordedScene,type RecordedScene} from '../src/learning/recorded-scene.ts';
import {createPhysicsMethodPractice} from '../src/learning/physics-practice.ts';
import {assessPracticeTrial} from '../src/learning/practice.ts';
import {installOffsetShapes} from '../core/mineflayer-fixes.ts';
import {Vec3} from 'vec3';
const require=createRequire(import.meta.url),data=require('minecraft-data')('1.21.1'),Block=require('prismarine-block')('1.21.1');
const dirs:string[]=[];afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});
function record(id:string,step:boolean,override?:(x:number,y:number,z:number)=>string|undefined):RecordedScene {
  const scene=captureVoxelScene({source:{kind:'client-loaded-chunks',minecraftVersion:'1.21.1',dimension:'overworld',username:'fixture',uuid:'a'.repeat(32),realmVerified:true},
    feet:[.5,64,.5],yaw:-Math.PI/2,pitch:0,eyeHeight:1.62,fovDegrees:75,bounds:{min:[-6,60,-6],max:[12,70,6]},
    blockAt:(x,y,z)=>Block.fromStateId(data.blocksByName[override?.(x,y,z)??(y<=63||(step&&x>=2&&y===64)?'stone':'air')].defaultState,0)});
  return {schema:'agent-mc-recorded-practice/v1',id,scene,initial:{velocity:[0,0,0],onGround:true,health:20},
    goal:{kind:'reach',dimension:'overworld',position:{x:4.5,y:step?65:64,z:.5},radius:.8,maxHealthLoss:0},evidence:['fixture:geometry'],events:[]};
}
const candidate=(jump:boolean)=>({code:`try{await bot.look(-Math.PI/2,0);await bot.setControlState('forward',true);await bot.setControlState('jump',${jump});
for(let i=0;i<8;i++){const s=await mc.state();if(s.snapshot.position.x>=4)break;await bot.waitForTicks(4);}}finally{await bot.clearControlStates();}await bot.waitForTicks(8);`,params:{},guidance:'Recorded step traversal; collision only'});
it('reconstructs real block collisions, compares movement methods and resets deterministic state',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'recorded-method-'));dirs.push(directory);
  const cases=[record('step',true),record('flat',false)],practice=createPhysicsMethodPractice({directory,scenarios:cases,binding:{instanceId:'recorded',realm:'fixture',account:'one',agent:'test',isolated:true}});
  const run=async(jump:boolean,id:string)=>practice.executor.execute({trialId:id,methodId:'step-walk',candidate:candidate(jump),fixture:practice.fixtures[0],durationMs:5000},new AbortController().signal);
  const old=await run(false,'baseline'),next=await run(true,'candidate'),again=await run(true,'repeat');
  expect(assessPracticeTrial(old,practice.fixtures[0],practice.executor.binding).achieved).toBe(false);
  expect(next.after?.position?.x).toBeGreaterThan(old.after!.position!.x);
  expect(next.after?.position).toEqual(again.after?.position);expect(practice.stats().heldKeys).toBe(0);
  expect(next.after?.position?.y).toBeGreaterThan(64);
  expect(assessPracticeTrial(next,practice.fixtures[0],practice.executor.binding).achieved).toBe(true);
},15000);
it('rebuilds water drag and a low ceiling from recorded blocks rather than replaying historical positions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'recorded-variants-'));dirs.push(directory);
  const cases=[record('dry-flat',false),record('water',false,(_x,y)=>y===64||y===65?'water':undefined),
    record('low-roof',true,(x,y)=>x>=1&&y===66?'stone':undefined)];
  const practice=createPhysicsMethodPractice({directory,scenarios:cases,binding:{instanceId:'variants',realm:'fixture',account:'one',agent:'test',isolated:true}});
  const run=(i:number,jump:boolean)=>practice.executor.execute({trialId:'scene-'+i,methodId:'move',candidate:candidate(jump),fixture:practice.fixtures[i],durationMs:5000},new AbortController().signal);
  const flat=await run(0,false),water=await run(1,false),roof=await run(2,true);
  expect(water.after!.position!.x).toBeLessThan(flat.after!.position!.x);
  expect(assessPracticeTrial(roof,practice.fixtures[2],practice.executor.binding).achieved).toBe(false);
  expect(roof.after!.position!.x).toBeLessThan(2);
  expect(practice.stats().heldKeys).toBe(0);
},15000);
it('preserves unknown cells, verifies the actual registry and does not count renamed captures as independent scenes',()=>{
  const original=record('original',false),copy=structuredClone(original);copy.id='renamed';copy.scene.sampledAt=new Date(Date.now()+1000).toISOString();
  expect(recordedCase(copy).snapshotId).toBe(recordedCase(original).snapshotId);
  const unknown=structuredClone(original);unknown.scene.cells.fill(-1);const sim=reconstructRecordedScene(unknown);
  expect(()=>sim.world.getBlock({x:0,y:63,z:0} as any)).toThrow('unknown');expect(()=>sim.world.getBlock({x:100,y:63,z:0} as any)).toThrow('unknown');
  const wrong=structuredClone(original);wrong.scene.palette[0].name='minecraft:diamond_block';expect(()=>reconstructRecordedScene(wrong)).toThrow('registry');
});
it('replays external block events by tick and retains immutable cases across reload',()=>{
  const input=record('terrain-event',false),block=input.scene.palette.find(p=>p.name==='minecraft:stone')!;
  input.events=[{tick:3,position:[1,64,0],block,source:'server:block-update:17'}];const sim=reconstructRecordedScene(input),point={x:1,y:64,z:0} as any;
  sim.beforeTick(2);expect(sim.world.getBlock(point).name).toBe('air');sim.beforeTick(3);expect(sim.world.getBlock(point).name).toBe('stone');
  const dir=mkdtempSync(join(tmpdir(),'recorded-store-'));dirs.push(dir);const store=new RecordedSceneStore(dir);store.save(input);
  expect(()=>store.save(input)).toThrow();expect(new RecordedSceneStore(dir).read(input.id)).toEqual(input);expect(store.list()).toHaveLength(1);
});

it('round-trips live positional dripstone/bamboo shapes and rejects shifted or forged recordings',()=>{
  for(const name of ['pointed_dripstone','bamboo']) {
    const state=data.blocksByName[name].defaultState;
    const raw=Block.fromStateId(state,0),original=JSON.stringify(raw.shapes);
    const live={registry:data,blockAt:(position:Vec3)=>{const b=Block.fromStateId(state,0);b.position=position;return b;}};
    installOffsetShapes(live as any);
    const r=record('offset-'+name.replaceAll('_','-'),false);
    r.scene=captureVoxelScene({source:r.scene.source,feet:[-440,45,658],yaw:0,pitch:0,eyeHeight:1.62,fovDegrees:75,
      bounds:{min:[-443,42,654],max:[-437,46,660]},blockAt:(x,y,z)=>live.blockAt(new Vec3(x,y,z))});
    const sim=reconstructRecordedScene(r);
    for(const p of [new Vec3(-443,42,654),new Vec3(-440,45,658),new Vec3(-437,46,660)]) {
      expect(sim.world.getBlock(p).shapes).toEqual(live.blockAt(p).shapes);
    }
    expect(JSON.stringify(Block.fromStateId(state,0).shapes)).toBe(original);
    const forged=structuredClone(r);forged.scene.palette[0].collisionShapes![0][0]+=.01;
    expect(()=>reconstructRecordedScene(forged)).toThrow('collision');
    const shifted=structuredClone(r);shifted.scene.bounds.min[0]++;shifted.scene.bounds.max[0]++;
    expect(()=>reconstructRecordedScene(shifted)).toThrow('collision');
    const event=live.blockAt(new Vec3(-440,45,658));
    const entry=r.scene.palette.find(e=>JSON.stringify(e.collisionShapes)===JSON.stringify(event.shapes))!;
    r.events=[{tick:1,position:[-440,45,658],block:entry,source:'fixture:live-offset'}];
    const replay=reconstructRecordedScene(r);replay.beforeTick(1);
    expect(replay.world.getBlock(new Vec3(-440,45,658)).shapes).toEqual(event.shapes);
  }
});

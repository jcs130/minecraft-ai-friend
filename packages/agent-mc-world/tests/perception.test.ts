import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {HearingLedger,audibleHint,attachHearing,hearingOf} from '../core/perception-hearing.ts';
import {clearObservationRay,observedEntity,observationView,configureObservationPolicy} from '../core/perception-sight.ts';
import {observeSpatial} from '../core/spatial-observation.ts';
import {AttentionReader,perceptionArgs,validDetection} from '../core/perception-tools.ts';
import {narrateWorldSegments,snapshotFromBot} from '../core/terrain.ts';
const air={name:'air',shapes:[]},stone={name:'stone',shapes:[[0,0,0,1,1,1]]};
const sound={name:'entity.zombie.ambient',category:'hostile',volume:1,pitch:1,position:{x:6,y:64,z:-6},entityId:9};
const self={id:1,position:new Vec3(.5,64,.5),yaw:0,pitch:0};
const rig=()=>({entity:self,entities:{9:{id:9,name:'zombie',height:1.8,position:new Vec3(.5,64,-6)}},registry:{},blockAt:()=>air});
it.each([
  { attributes: { 'minecraft:max_health': { value: 20, modifiers: [{ amount: 2.8, operation: 0 }] } }, expected: 22.8 },
  { attributes: { 'generic.max_health': { value: 20 } }, expected: 20 },
  { attributes: undefined, expected: null },
])('keeps native maximum health in planner body facts: $expected', ({attributes,expected})=>{
  const bot={...rig(),entity:{...self,attributes},registry:{items:{},blocksByName:{}},
    game:{dimension:'overworld'},time:{},health:21,food:18,
    inventory:{items:()=>[],slots:[]},players:{},blockAt:()=>stone,findBlocks:()=>[]};
  const snapshot=snapshotFromBot(bot,{scanBlocks:false});
  expect(snapshot).toHaveProperty('maxHealth',expected);
  const body=narrateWorldSegments(snapshot).find(part=>part.key==='body')!.text;
  expect(body).toContain(expected===null?'上限未同步':`21/${expected}`);
});

describe('perception evidence boundaries',()=>{
  it('does not report unknown candidate cells as air or contradict current physical support',()=>{
    const bot={...rig(),entity:{...self,onGround:true,width:.6},game:{dimension:'overworld'},blockAt:(p:Vec3)=>({...stone,position:p})};
    const result=observeSpatial(bot as never,{mode:'sites',sites:[[0,64,-3],[0,64,-4]]});
    expect(result).toMatchObject({status:'partial',coverage:{observedTargets:0,unknownTargets:2,airTargets:0},
      selfFooting:{kind:'support',block:'stone',grounded:true}});
    expect(result.sites[0]).toMatchObject({target:null,observation:{target:'occluded',below:'occluded'},body:{clear:null}});
    expect(result.interpretation).toContain('不等于空气');
    expect(result.blockReads).toBeGreaterThan(0);
    const unloaded=observeSpatial({...bot,blockAt:()=>null} as never,{mode:'sites',sites:[[0,64,-3]]});
    expect(unloaded).toMatchObject({status:'partial',selfFooting:{kind:'unknown',grounded:true},coverage:{airTargets:0}});
    expect(unloaded.sites[0].observation.target).toBe('unloaded');
  });
  it('observes loaded voxels and entities through known empty grass, fern and near-eye vine shapes',()=>{
    const bot={...rig(),game:{dimension:'overworld'},blockAt:(p:Vec3)=>{
      const name=p.z===-1&&p.y===64?'tall_grass':p.z===-1&&p.y===65?'fern':null;
      if(name)return {name,shapes:[],position:p};
      if(p.z===0&&p.y===65)return {name:'vine',shapes:[],position:p};
      if(p.z===-3&&p.y===64)return {...stone,name:'jungle_log',position:p};
      return {...air,position:p};
    }};
    const eye={x:.5,y:65.62,z:.5};
    expect(clearObservationRay(bot,eye,{x:.5,y:65,z:-2.5})).toBe(true);
    expect(observedEntity(bot,bot.entities[9])).toBe(true);
    const voxels=observeSpatial(bot as never,{mode: 'voxels', format: 'dense',bounds:[0,0,-3,0,1,-1]});
    expect(voxels.unknownCells).toBe(0);
    expect(voxels.cells.every((cell:number)=>cell>=0)).toBe(true);
    expect(JSON.stringify(voxels.palette)).toContain('tall_grass');
    expect(JSON.stringify(voxels.palette)).toContain('fern');
    expect(JSON.stringify(voxels.palette)).toContain('jungle_log');
  });
  it.each(['wall','unknown-shapes','unloaded-collar'] as const)('keeps %s opaque despite known empty vegetation shapes',kind=>{
    const bot={...rig(),game:{dimension:'overworld'},blockAt:(p:Vec3):any=>{
      if(p.z===-1)return {name:'fern',shapes:[],position:p};
      if(p.z===-2){
        if(kind==='unloaded-collar')return p.y===66?null:{...air,position:p};
        return kind==='wall'?{...stone,position:p}:{name:'opaque_unread_geometry',position:p};
      }
      if(p.z===-4)return {...stone,name:'diamond_ore',position:p};
      return {...air,position:p};
    }};
    expect(clearObservationRay(bot,{x:.5,y:65.62,z:.5},{x:.5,y:65,z:-4.5})).toBe(false);
    expect(observedEntity(bot,bot.entities[9])).toBe(false);
    const voxels=observeSpatial(bot as never,{mode: 'voxels', format: 'dense',bounds:[0,0,-4,0,0,-4]});
    expect(voxels).toMatchObject({unknownCells:1,palette:[],cells:[-1]});
  });
  it('masks hidden block identities consistently in direct reads, index searches and voxel palettes',()=>{
    const bot={...rig(),game:{dimension:'overworld'},findBlocks:()=>[new Vec3(0,64,-2),new Vec3(0,64,-5)],
      blockAt:(p:Vec3)=>p.z===-2?{...stone,position:p}:p.z===-5?{name:'diamond_ore',shapes:[[0,0,0,1,1,1]],position:p}:air};
    const view=observationView(bot as never);
    expect(view.blockAt(new Vec3(0,64,-2))?.name).toBe('stone');
    expect(view.blockAt(new Vec3(0,64,-5))).toBeNull();
    expect(view.findBlocks({matching:1,count:4})).toEqual([new Vec3(0,64,-2)]);
    const voxels=observeSpatial(bot as never,{mode: 'voxels', format: 'dense',bounds:[0,0,-5,0,0,-5]});
    expect(voxels).toMatchObject({unknownCells:1,palette:[],cells:[-1],entities:[]});
    expect(JSON.stringify(voxels)).not.toContain('diamond');
  });
  it('quantizes received sound position; no identity, coordinates or exact distance survive',()=>{
    const hint=audibleHint(sound,self,1000)!;
    expect(hint).toEqual({source:'sound-packet',kind:'怪物声',direction:'东北',distance:'中距离（约4–12格）',heardAt:1000,expiresAt:9000});
    expect(audibleHint({...sound,volume:0},self,1000)).toBeNull();
    expect(audibleHint({...sound,position:{x:100,y:64,z:0}},self,1000)).toBeNull();
    const ledger=new HearingLedger();for(let n=0;n<50;n++)ledger.add(sound,self,1000+n);
    expect(ledger.read(8,1100)).toHaveLength(1);expect(ledger.read(8,10_000)).toHaveLength(0);
  });
  it('attaches real packet events and cleans up on end; entity tracking alone emits no sound',async()=>{
    const bot=Object.assign(new EventEmitter(),rig(),{version:'1.21.1',_client:new EventEmitter(),registry:{sounds:{4:{name:'entity.zombie.ambient'}}}});
    const stop=attachHearing(bot as never,'');await vi.waitFor(()=>expect(hearingOf(bot)?.source).toBe('named-only'));
    const ledger=hearingOf(bot)!;expect(ledger.read()).toHaveLength(0);
    bot._client.emit('sound_effect',{soundId:4,soundCategory:5,x:48,y:512,z:-48,volume:1,pitch:1});
    expect(ledger.read()).toHaveLength(0);expect(ledger.source).toBe('named-only');
    bot._client.emit('sound_effect',{sound:{data:{soundName:'minecraft:entity.zombie.ambient'}},soundCategory:5,x:48,y:512,z:-48,volume:1,pitch:1});
    expect(ledger.read()[0]?.direction).toBe('东北');
    bot.emit('respawn');expect(ledger.read()).toHaveLength(0);
    bot.emit('end');expect(bot._client.listenerCount('sound_effect')).toBe(0);stop();
  });
  it('rejects walls, unknown geometry, diagonal grazes and outside view; hidden target query does not reveal existence',()=>{
    const bot=rig();configureObservationPolicy(bot,()=>({nearbyOccludedRange:0}));expect(observedEntity(bot,bot.entities[9])).toBe(true);
    bot.blockAt=()=>stone;expect(observedEntity(bot,bot.entities[9])).toBe(false);
    expect(new AttentionReader().read(bot,3,1000,true,9).highlights).toEqual([]);
    bot.blockAt=()=>null as never;expect(observedEntity(bot,bot.entities[9])).toBe(false);
    expect(clearObservationRay({blockAt:(p:Vec3)=>p.x===0&&p.z===1?stone:air},{x:.5,y:.5,z:.5},{x:1.5,y:.5,z:1.5})).toBe(false);
  });
  it('forecasts only across two visible observations and drops an occluded track',()=>{
    const bot=rig(),reader=new AttentionReader();const first=reader.read(bot,3,1000,true);
    expect(first.highlights[0]).toMatchObject({attackRange:null,sightRange:null,prediction:null});
    expect(first.highlights[0]).toMatchObject({id:9,entityId:9,target:'zombie'});
    bot.entities[9].position.x=1;
    expect(reader.read(bot,3,1500,true).highlights[0]?.prediction?.probability).toBeNull();
    bot.blockAt=()=>stone;expect(reader.read(bot,3,1600,true).highlights[0]).toMatchObject({visible:false,prediction:null});
    bot.blockAt=()=>air;expect(reader.read(bot,3,1700,true).highlights[0]?.prediction).toBeNull();
  });
  it('does not turn a stored invisible entity into an invented heard sound or omitted count',()=>{
    const bot={...rig(),registry:{items:{},blocksByName:{}},game:{dimension:'overworld'},time:{},
      inventory:{items:()=>[],slots:[]},players:{},blockAt:()=>stone,findBlocks:()=>[]};
    (bot.entities[9] as any).invisible=true;
    const snapshot=snapshotFromBot(bot,{scanBlocks:false});expect(snapshot.entities).toEqual([]);
    expect(snapshot.entitiesOmitted).toBe(0);
    const text=narrateWorldSegments({...snapshot,entities:[{name:'zombie',kind:'hostile',distance:7,dy:0,direction:'north',visible:false}]}).map(s=>s.text).join('\n');
    expect(text).not.toContain('僵尸');expect(text).not.toContain('动静');
  });
  it('skill evidence requires current generation, dimension, source and a short unexpired receipt; tool arguments cannot grant it',()=>{
    const proof={source:'test-adapter',receiptId:'receipt-1',connectionGeneration:4,dimension:'overworld',observedAt:1000,expiresAt:5000,position:{x:1,y:64,z:1}};
    expect(validDetection(proof,4,'overworld',2000)).toBe(true);
    for(const [g,dim,now] of [[3,'overworld',2000],[4,'the_nether',2000],[4,'overworld',6000]] as const)expect(validDetection(proof,g,dim,now)).toBe(false);
    expect(perceptionArgs({detected:true},'mc_attention')).toHaveProperty('error');
    expect(perceptionArgs({mode:'combat',limit:3},'mc_attention')).toEqual({mode:'combat',limit:3});
  });
});

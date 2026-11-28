import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { bedsWorkHere, installWorldIdentity } from '../core/world-scope.ts';
import { MinecraftWorld } from '../core/world.ts';
import { parseSteps } from '../core/skills.ts';
import { useOnce } from '../core/skills-interact.ts';

function fixture() {
  const wire = new EventEmitter(), position=new Vec3(0,64,0), target=new Vec3(1,64,0);
  const bed={name:'white_bed',position:target,shapes:[[0,0,0,1,.5625,1]],getProperties:()=>({part:'foot',occupied:false})};
  const air={name:'air',shapes:[]};
  const bot:any=Object.assign(new EventEmitter(),{_client:wire,game:{dimension:'overworld'},time:{day:99,timeOfDay:15000},
    entity:{position,height:1.8},entities:{},blockAt:(p:Vec3)=>p.floored().equals(target)?bed:air,
    sleep:vi.fn(async()=>{}),supportFeature:()=>false});
  installWorldIdentity(bot);
  const codec=minecraftData('1.21.11').loginPacket.dimensionCodec as any;
  for (const name of ['minecraft:dimension_type','minecraft:worldgen/biome','minecraft:timeline']) wire.emit('registry_data',codec[name]);
  wire.emit('login',{worldState:{name:'minecraft:custom_level'}});
  const world:any=Object.assign(Object.create(MinecraftWorld.prototype),{cfg:{reflex:{sleepAtCamp:true}},
    campScope:()=> 'test-account-world',canIdle:()=>true,campStock:{camps:()=>[{...target,radius:8}],nearby:()=>[new Vec3(-1,64,0),target]},
    executor:{submitDetailed:vi.fn(()=>({accepted:true,receipt:'queued',taskId:42}))},diag:{write:vi.fn()}});
  return {bot,world,wire,target,bed};
}

describe('nearby camp rest',()=>{
  it('submits the visible camp bed once a night through the normal queue',()=>{
    const {bot,world}=fixture();
    expect(bedsWorkHere(bot)).toBe(true);
    world.campRestTick(bot);
    expect(world.executor.submitDetailed.mock.calls[0]?.slice(0,2)).toEqual([[{skill:'use',at:[1,64,0],sleep:true}],'append']);
    world.campRestScanAfter=0;world.campRestTick(bot);
    expect(world.executor.submitDetailed).toHaveBeenCalledTimes(1);
    expect(bot.sleep).not.toHaveBeenCalled();
  });
  it.each(['day','busy','occupied','removed','other camp','disabled','nether','hostile'])('leaves the body alone when %s',reason=>{
    const {bot,world,bed}=fixture();
    if(reason==='day')bot.time.timeOfDay=900;
    if(reason==='busy')world.canIdle=()=>false;
    if(reason==='occupied')bed.getProperties=()=>({part:'foot',occupied:true});
    if(reason==='removed')bed.name='chest';
    if(reason==='other camp')world.campStock.camps=()=>[];
    if(reason==='disabled')world.cfg.reflex.sleepAtCamp=false;
    if(reason==='nether')bot.game.dimension='the_nether';
    if(reason==='hostile')bot.entities={2:{type:'hostile',name:'zombie',position:new Vec3(2,64,0)}};
    world.campRestTick(bot);
    expect(world.executor.submitDetailed).not.toHaveBeenCalled();
  });
  it('honors a server override and never clicks a replaced block',async()=>{
    const {bot,wire,bed}=fixture();
    const call={skill:'use',sleep:true,at:[1,64,0]} as const;
    const ctx:any={aborted:()=>false};
    const parse=(step:any)=>parseSteps([step],new Map() as any);
    expect(parse(call)).toMatchObject({steps:[call]});
    expect(parse({...call,item:'white_bed'})).toHaveProperty('error');
    expect(await useOnce(bot,call as any,ctx)).toContain('入睡');
    bed.name='chest';
    await expect(useOnce(bot,call as any,ctx)).rejects.toThrow(/没有可见的床/);
    wire.emit('registry_data',{id:'minecraft:worldgen/biome',entries:[{key:'custom:biome',value:{value:{attributes:{value:{'minecraft:gameplay/bed_rule':{}}}}}}]});
    expect(bedsWorkHere(bot)).toBe(false);
    await expect(useOnce(bot,call as any,ctx)).rejects.toThrow(/维度/);
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });
});

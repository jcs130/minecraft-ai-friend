import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Vec3 } from 'vec3';
import { GameMemoryBook } from '../core/game-memory.ts';
import { GameMemoryService } from '../core/game-memory-service.ts';
import { configureObservationPolicy, observedBlock, observationView } from '../core/perception-sight.ts';
import { configuredPlayerSkin } from '../core/viewer-local-skin.ts';
import { MinecraftAgentClient } from '../src/client/runtime.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { nullLogger } from '../core/support/runtime.mjs';
const directories:string[]=[];
const directory=()=>{const d=mkdtempSync(join(tmpdir(),'mc-notebook-profile-'));directories.push(d);return d;};
afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});

it('CPU vector retrieval stays offline, scopes minerals/places, and labels historical evidence after revision',async()=>{
  const d=directory(),service=new GameMemoryService(new GameMemoryBook(d),d,async()=>{throw Error('Network must stay unused');});
  const ctx={scope:{realm:'server-A',account:'offline:Alice',agent:'stable-owner'},dimension:'overworld'};
  const cfg={mode:'local-vector' as const};
  const saved:any=await service.execute({action:'remember',kind:'resource',summary:'西山发现铁矿脉',
    content:'主世界 (-12, 40, 35)，刚挖开洞壁见到两格铁矿；更深处数量未知。',tags:['铁矿','西山'],source:{kind:'agent_note',reference:'receipt:mine-1'}},ctx,cfg);
  const search:any=await service.execute({action:'search',query:'西山的铁矿'},ctx,cfg);
  expect(search.entries).toEqual([expect.objectContaining({id:saved.entry.id,summary:'西山发现铁矿脉'})]);
  expect(search.retrieval).toMatchObject({mode:'local-vector',neuralModel:false,remoteConsulted:false});
  expect(search.entries[0].content).toBeUndefined();
  for(const other of [{...ctx,scope:{...ctx.scope,realm:'server-B'}},{...ctx,dimension:'the_nether'},
    {...ctx,scope:{...ctx.scope,account:'offline:Bob'}}])expect(await service.execute({action:'search',query:'铁矿'},other,cfg)).toMatchObject({total:0});
  await service.execute({action:'revise',id:saved.entry.id,expectedRevision:1,kind:'resource',summary:'西山铁矿已采完',
    content:'已采完暴露的两格，其余未知，需要再观察。',source:{kind:'agent_note',reference:'receipt:mine-2'}},ctx,cfg);
  await expect(service.execute({action:'revise',id:saved.entry.id,expectedRevision:1,kind:'resource',summary:'旧修改',content:'不能覆盖新版本',source:{kind:'agent_note'}},ctx,cfg)).rejects.toThrow(/Revision conflict/);
  const restarted=new GameMemoryService(new GameMemoryBook(d),d);
  expect(await restarted.execute({action:'get',id:saved.entry.id},ctx,cfg)).toMatchObject({entry:{revision:2,summary:'西山铁矿已采完'}});
});

it('a server notebook survives a display-name change without starting a body or a decision turn',async()=>{
  const d=directory(),cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'Alice',memoryAgentId:'dsh:stable',memory:{mode:'local-vector' as const}};
  const first=new MinecraftAgentClient({cfg,dataDir:d,agentName:'旧名字',log:nullLogger()});
  const saved:any=await first.notebook({action:'remember',kind:'place',summary:'洞口',content:'主世界 (3, 64, 9)，是以前发现的洞口。',dimension:'overworld',source:{kind:'user_report',speaker:'owner',reference:'owner:fixture'}});
  expect(first.status().phase).toBe('disconnected');
  const renamed=new MinecraftAgentClient({cfg,dataDir:d,agentName:'新名字',log:nullLogger()});
  expect(await renamed.notebook({action:'get',id:saved.entry.id})).toMatchObject({entry:{summary:'洞口'}});
  await expect(renamed.notebook({action:'capture'})).rejects.toThrow();
  await expect(renamed.notebook({action:'service'})).rejects.toThrow(/local note operations/);
});

it('default block queries hide buried ore; mineral opt-in never means physical sight or exposes another block type',()=>{
  const target=new Vec3(0,64,-5),bot:any={entity:{position:new Vec3(.5,64,.5)},entities:{},
    blockAt:(p:Vec3)=>p.z===-6?null:{name:p.z===-5?'iron_ore':p.z===-2?'stone':'air',position:p,
      shapes:p.z===-5||p.z===-2?[[0,0,0,1,1,1]]:[]},findBlocks:()=>[target],findBlock:()=>{throw Error('Unfiltered method must not be called');}};
  const view=observationView(bot);
  expect(view.blockAt(target)).toBeNull();expect(view.findBlocks({matching:1})).toEqual([]);expect(view.findBlock({matching:1})).toBeNull();
  let enabled=true;configureObservationPolicy(bot,()=>({mineralVision:enabled}));
  expect(view.blockAt(target)?.name).toBe('iron_ore');expect(view.findBlock({matching:1})?.name).toBe('iron_ore');
  expect(observedBlock(bot,target)).toBe(false);
  expect(view.blockAt(new Vec3(0,64,-6))).toBeNull();expect(view.blockAt(new Vec3(0,64,-40))).toBeNull();
  enabled=false;expect(view.findBlocks({matching:1})).toEqual([]);
});

it('configured skins validate actual PNG bytes, dimensions and model without trusting a URL or a corrupt image',()=>{
  const bytes=PNG.sync.write(new PNG({width:64,height:64}));
  const skin=configuredPlayerSkin({bytes,model:'slim'});
  expect(skin.skinUrl).toMatch(/^\/agent-skin\/[a-f0-9]{64}\.png$/);
  expect(skin).toMatchObject({width:64,height:64,skinModel:'slim',skinSource:'local-viewer-override'});
  expect(()=>configuredPlayerSkin({bytes:bytes.subarray(0,25),model:'classic'})).toThrow(/decode/);
  expect(()=>configuredPlayerSkin({bytes:PNG.sync.write(new PNG({width:128,height:128})),model:'classic'})).toThrow(/64/);
  expect(()=>configuredPlayerSkin({bytes,model:'unknown' as any})).toThrow(/model/);
});

import { describe,it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { McapStreamReader } from '@mcap/core';
import { GameplayArchive,encodeGameplay,decodeGameplay } from '../src/learning/archive.ts';
import { gameplayFromExperience,assessGameplay } from '../src/learning/assessment.ts';
import { OperationFollower } from '../src/learning/follower.ts';
import { startGameplayRecording } from '../src/learning/recording.ts';
const scope='a'.repeat(64),at=new Date().toISOString();
const observation={at,dimension:'minecraft:overworld',position:{x:0,y:64,z:0},health:20,food:10,inventory:{wheat:3,bread:0}};
const raw=(patch:any={})=>({schema:'agent-mc-experience/v1',id:'b'.repeat(64),scopeKey:scope,run:'test',at,updatedAt:at,
  kind:'operation',tool:'mc_do',operations:['craft'],parameters:[{skill:'craft',item:'bread',count:1}],attribution:{controller:'system2'},
  dispatch:'returned',execution:{kind:'task',id:'task-1',phase:'completed',terminal:true},before:observation,
  after:{...observation,inventory:{wheat:0,bread:1}},elapsedMs:1000,...patch});
const project=(value:any)=>gameplayFromExperience(value,scope,createHash('sha256').update(JSON.stringify(value)).digest('hex'));
async function cleanup(path:string){if(dirname(resolve(path))!==resolve(tmpdir())||!path.split(/[\\/]/).at(-1)?.startsWith('mc-gameplay-'))throw Error('Unexpected test cleanup');await rm(path,{recursive:true,force:true});}
function messages(bytes:Uint8Array){
  const decompress=(zlib as any).zstdDecompressSync;
  const reader=new McapStreamReader({decompressHandlers:decompress?{zstd:decompress}:{},validateCrcs:true});reader.append(bytes);
  const rows=[];let record;while(record=reader.nextRecord())if(record.type==='Message')rows.push(decodeGameplay(record.data));
  expect(reader.done()).toBe(true);return rows;
}
describe('gameplay outcome signals',()=>{
  it('recognizes intended crafting gain while preserving ingredient cost',()=>{
    const row=project(raw());expect(row.assessment.label).toBe('positive');expect(row.assessment.goalVerified).toBe(false);
    expect(row.assessment.signals).toContainEqual({name:'intendedItemDelta',value:1});expect(row.after!.inventory!.wheat).toBe(0);
  });
  it.each(['chat','observe','probe','look','equip'])('does not punish a stationary %s by treating it as failed movement',operation=>{
    const row=project(raw({operations:[operation],parameters:[{skill:operation}],after:observation}));
    expect(row.assessment.label).toBe('unknown');
  });
  it('separates hurt from causal blame and preserves mixed outcomes',()=>{
    const mixed=project(raw({after:{...observation,health:18,inventory:{wheat:0,bread:1}}}));expect(mixed.assessment.label).toBe('mixed');
    const hurt=project(raw({operations:['goto'],parameters:[],after:{...observation,health:18}}));
    expect(hurt.assessment.label).toBe('unknown');expect(hurt.assessment.trainingUse).toBe('risk-analysis');
  });
  it('requires a declared target to score movement as progress',()=>{
    const moved={...observation,position:{x:4,y:64,z:0}};
    expect(project(raw({operations:['goto'],parameters:[],after:moved})).assessment.label).toBe('unknown');
    const row=project(raw({operations:['goto'],parameters:[{skill:'goto',at:[5,64,0]}],after:moved}));
    expect(row.assessment.label).toBe('positive');expect(row.assessment.goalVerified).toBe(false);
  });
  it('keeps missing and stale inventory unknown rather than empty or successful',()=>{
    const missing=project(raw({after:{...observation,inventory:null}}));expect(missing.assessment.label).toBe('unknown');
    const stale=project(raw({after:{...observation,at:'2000-01-01T00:00:00Z',inventory:{bread:1}}}));expect(stale.assessment.label).toBe('unknown');
    const other=project(raw({after:{...observation,dimension:'minecraft:the_nether',inventory:{bread:1}}}));expect(other.assessment.label).toBe('unknown');
  });
  it('retains genuine failures for recovery, without scoring cancellation and unknown effects as bad choices',()=>{
    const failure=project(raw({after:observation,execution:{kind:'task',id:'task-1',phase:'blocked',terminal:true}}));expect(failure.assessment.label).toBe('negative');
    expect(failure.assessment.trainingUse).toBe('recovery-review');
    for(const phase of ['cancelled','unknown','running'])expect(project(raw({execution:{kind:'task',id:'task-1',phase,terminal:phase!=='running'}})).assessment.label).toBe('unknown');
  });
  it.each(['blocked','failed','partial'])('keeps real intermediate gains when a %s operation is not a complete success',phase=>{
    const row=project(raw({execution:{kind:'task',id:'task-1',phase,terminal:true}}));
    expect(row.assessment.label).toBe('mixed');expect(row.assessment.trainingUse).toBe('contrast-review');
    expect(row.assessment.signals).toContainEqual({name:'intendedItemDelta',value:1});
  });
  it('keeps privacy boundaries, nulls, spell/method identities and memory attribution through FlatBuffers',()=>{
    const source=raw({secret:'NEVER_RECORD_THIS',code:'NEVER_RECORD_THIS',parameters:[{skill:'cast',spell:'blink',code:'NEVER_RECORD_THIS'}],
      before:{...observation,food:null,inventory:null},attribution:{controller:'system1',method:{id:'blink-method',revision:'c'.repeat(64)},memoryRefs:['mc-memory:12345678-1234-1234-1234-123456789abc:2']}});
    const row=project(source),bytes=encodeGameplay(row),restored=decodeGameplay(bytes);
    expect(Buffer.from(bytes).includes(Buffer.from('NEVER_RECORD_THIS'))).toBe(false);
    expect(restored.before!.food).toBeNull();expect(restored.before!.inventory).toBeNull();expect(restored.intents[0].spell).toBe('blink');
    expect(restored.methodRevision).toBe('c'.repeat(64));expect(restored.memoryRefs).toEqual(row.memoryRefs);
    expect(()=>gameplayFromExperience(source,'d'.repeat(64),'e'.repeat(64))).toThrow(/scope/);
  });
  it('keeps a fast-model choice as context until its real adoption/outcome arrives',()=>{
    const decision=project(raw({kind:'decision',execution:null,decision:{category:'combat',selected:'withdraw',status:'chosen',model:'fast',
      candidates:[{id:'withdraw',ready:true,probability:.8}],inputTokens:null,recalledMemoryRefs:['mc-memory:12345678-1234-1234-1234-123456789abc:1']}}));
    const restored=decodeGameplay(encodeGameplay(decision));expect(restored.assessment.label).toBe('unknown');
    expect(restored.decision!.candidates[0].probability).toBe(.8);expect(restored.decision!.inputTokens).toBeNull();
    expect(restored.memoryRefs).toEqual([]);expect(restored.decision!.recalledMemoryRefs).toHaveLength(1);
  });
  it('retains requested control parameters without treating them as observed per-tick inputs',()=>{
    const row=project(raw({requestId:'original-request',operations:['control'],parameters:[{skill:'control',keys:['forward','jump','password'],yawDeg:30,pitchDeg:-5,distance:4,land:false}]}));
    const restored=decodeGameplay(encodeGameplay(row));expect(restored.requestId).toBe('original-request');
    expect(restored.intents[0]).toMatchObject({keys:['forward','jump'],yawDeg:30,pitchDeg:-5,distance:4,land:false});
    expect(restored.after!.controlsKnown).toBe(false);
  });
});
describe('durable isolated gameplay archive',()=>{
  it('refuses output inside the source before writing any archive or status file',async()=>{
    const root=await mkdtemp(join(tmpdir(),'mc-gameplay-readonly-')),source=join(root,scope);await mkdir(source);
    try{
      await expect(startGameplayRecording({sourceDirectory:source,scopeKey:scope,directory:join(source,'archive'),statusFile:join(root,'status.json')})).rejects.toThrow(/read-only/);
      await expect(startGameplayRecording({sourceDirectory:source,scopeKey:scope,directory:join(root,'archive'),statusFile:join(source,'..status.json')})).rejects.toThrow(/read-only/);
      expect(await readdir(source)).toEqual([]);expect(await readdir(root)).toEqual([scope]);
    }finally{await cleanup(root);}
  });
  it('serializes concurrent appends and resumes without duplicate trials',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'mc-gameplay-archive-'));
    const archive=new GameplayArchive({directory,scopeKey:scope,maxRecords:2});
    try{
      await archive.start();const one=project(raw()),two=project(raw({id:'c'.repeat(64)}));
      await Promise.all([archive.append(one),archive.append(two)]);await archive.close();
      const rows=[];for(const file of (await readdir(directory)).filter(x=>x.endsWith('.mcap')))rows.push(...messages(await readFile(join(directory,file))));
      expect(rows).toHaveLength(2);expect(rows.every(x=>x.scopeKey===scope)).toBe(true);
      const resumed=new GameplayArchive({directory,scopeKey:scope});try{
        await resumed.start();expect(await resumed.append(one)).toBe(false);expect(resumed.status().records).toBe(2);
        expect(resumed.status().labels['operation:positive']).toBe(2);
      }finally{await resumed.close();}
    }finally{await archive.close();await cleanup(directory);}
  });
  it('fails closed on mutated committed data and never replaces it',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'mc-gameplay-corrupt-'));const archive=new GameplayArchive({directory,scopeKey:scope});
    try{
      await archive.start();await archive.append(project(raw()));await archive.close();const name=(await readdir(directory)).find(x=>x.endsWith('.mcap'))!;
      const path=join(directory,name),original=await readFile(path);await writeFile(path,Buffer.concat([original,Buffer.from('corrupt')]));
      const resumed=new GameplayArchive({directory,scopeKey:scope});try{await expect(resumed.start()).rejects.toThrow(/integrity/);}finally{await resumed.close();}
      expect((await stat(path)).size).toBe(original.length+7);
    }finally{await archive.close();await cleanup(directory);}
  });
  it('follows updates read-only and links revisions without losing the original source',async()=>{
    const root=await mkdtemp(join(tmpdir(),'mc-gameplay-follow-')),source=join(root,scope),output=join(root,'output');
    await mkdir(source);const value=raw(),file=join(source,value.id+'.json');await writeFile(file,JSON.stringify(value));
    const archive=new GameplayArchive({directory:output,scopeKey:scope});const follower=new OperationFollower(source,scope,archive,output);
    try{
      await archive.start();await follower.start();expect(archive.status().records).toBe(1);
      const changed=raw({after:observation,updatedAt:new Date(Date.now()+10).toISOString()});await writeFile(file,JSON.stringify(changed));await follower.reconcile();
      expect(archive.status().records).toBe(2);expect(JSON.parse(await readFile(file,'utf8'))).toEqual(changed);
      await follower.stop();await archive.close();const rows=[];for(const name of (await readdir(output)).filter(x=>x.endsWith('.mcap')))rows.push(...messages(await readFile(join(output,name))));
      expect(rows[1].previousRevision).toBe(rows[0].revision);
    }finally{await follower.stop();await archive.close();await cleanup(root);}
  });
  it('reconciles every stable changed source after a burst exceeds the watch queue',async()=>{
    const root=await mkdtemp(join(tmpdir(),'mc-gameplay-burst-')),source=join(root,scope),output=join(root,'output');await mkdir(source);
    const ids=Array.from({length:2060},(_,i)=>createHash('sha256').update('burst-'+i).digest('hex'));
    const write=async(terminal:boolean)=>{for(let offset=0;offset<ids.length;offset+=128)await Promise.all(ids.slice(offset,offset+128).map(id=>writeFile(join(source,id+'.json'),JSON.stringify(raw({id,
      updatedAt:terminal?new Date().toISOString():at,after:terminal?{...observation,inventory:{bread:1}}:null,
      execution:{kind:'task',id:'task-'+id,phase:terminal?'completed':'accepted',terminal}})))));};
    await write(false);const archive=new GameplayArchive({directory:output,scopeKey:scope,maxRecords:10000}),follower=new OperationFollower(source,scope,archive,output);
    try{
      await archive.start();await follower.start();await write(true);await new Promise(done=>setTimeout(done,50));
      await follower.reconcile();expect(archive.status().records).toBe(ids.length*2);expect(follower.status().sourceErrors).toBe(0);
    }finally{await follower.stop();await archive.close();await cleanup(root);}
  },30000);
  it('does not keep deleted source files queued forever',async()=>{
    const root=await mkdtemp(join(tmpdir(),'mc-gameplay-deleted-')),source=join(root,scope),output=join(root,'output');await mkdir(source);
    const value=raw(),file=join(source,value.id+'.json');await writeFile(file,JSON.stringify(value));
    const archive=new GameplayArchive({directory:output,scopeKey:scope}),follower=new OperationFollower(source,scope,archive,output);
    try{
      await archive.start();await follower.start();await rm(file);await new Promise(done=>setTimeout(done,50));await follower.reconcile();await follower.drain();
      expect(follower.status().pendingSources).toBe(0);expect(follower.status().sourceErrors).toBe(0);expect(archive.status().records).toBe(1);
    }finally{await follower.stop();await archive.close();await cleanup(root);}
  });
});

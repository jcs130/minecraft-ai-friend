import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Server } from 'socket.io';
import { McapStreamReader } from '@mcap/core';
import * as zlib from 'node:zlib';
import { Vec3 } from 'vec3';
import { GameplayArchive, decodeGameplay } from '../src/learning/archive.ts';
import { ViewerGameplayObserver } from '../src/learning/viewer-observer.ts';

const scope='a'.repeat(64),uuid='12345678-1234-1234-1234-123456789abc';
async function fixture({actualUuid=uuid,address='test.invalid:25565',initialChunk=null as string|null,viewers=0,maxSessions=2,recording=true}={}) {
  const directory=await mkdtemp(join(tmpdir(),'mc-gameplay-viewer-'));
  const requests:string[]=[],inbound:string[]=[];
  const http=createServer((req,res)=>{
    if(req.url==='/healthz'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,version:'1.21.1',viewers,maxSessions}));}
    else if(req.url==='/state'){requests.push(req.method!);res.setHeader('content-type','application/json');res.end(JSON.stringify({address,reachable:true}));}
    else{res.writeHead(404);res.end();}
  });
  const io=new Server(http);
  let dimension='minecraft:overworld';
  const entity={isSelf:true,username:'Test',uuid:actualUuid,pos:{x:.5,y:64,z:.5},yaw:0,pitch:0};
  const avatar=()=>({capturedAt:Date.now(),entity,velocity:{x:0,y:0,z:0},onGround:true,health:20,food:18,
    inventory:[{name:'bread',count:2,nbt:'PRIVATE_CONTENT'},{name:'bread',count:1}],sprinting:true});
  io.on('connection',socket=>{
    socket.onAny(event=>inbound.push(event));
    socket.emit('version','1.21.1');socket.emit('biome',{dimension});socket.emit('playerEntity',entity);
    socket.emit('avatarState',initialChunk?{...avatar(),capturedAt:Date.now()-5000}:avatar());
    if(initialChunk)socket.emit('loadChunk',{x:0,z:0,chunk:initialChunk});
  });
  await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(http.address() as any).port}`;
  const archive=new GameplayArchive({directory,scopeKey:scope});await archive.start();
  const observer=new ViewerGameplayObserver({url,expectedUsername:'Test',expectedUuid:uuid,sampleMs:100,
    connectionRead:{url:url+'/state',expectedAddress:'test.invalid:25565'}},scope,recording?archive:null);
  const tick=setInterval(()=>io.emit('avatarState',avatar()),40);
  observer.start();
  const frames=async()=>{
    await archive.flush();const rows=[];
    for(const name of (await readdir(directory)).filter(x=>x.endsWith('.mcap'))){
      const reader=new McapStreamReader({validateCrcs:true,decompressHandlers:(zlib as any).zstdDecompressSync?{zstd:(zlib as any).zstdDecompressSync}:{}});
      reader.append(await readFile(join(directory,name)));let record;while(record=reader.nextRecord())if(record.type==='Message')rows.push(decodeGameplay(record.data));
      expect(reader.done()).toBe(true);
    }return rows;
  };
  return {observer,io,requests,inbound,frames,
    dimension:(value:string)=>{dimension=value;io.emit('biome',{dimension});},
    move:(x:number,z:number)=>{entity.pos={x,y:64,z};io.emit('playerEntity',entity);io.emit('avatarState',avatar());},
    close:async()=>{clearInterval(tick);await observer.stop();await archive.close();await new Promise<void>(done=>io.close(()=>done()));
      if(dirname(resolve(directory))!==resolve(tmpdir())||!directory.split(/[\\/]/).at(-1)?.startsWith('mc-gameplay-'))throw Error('Unexpected cleanup');
      await rm(directory,{recursive:true,force:true});},
  };
}

it('exports a passive scene without archive writes, controls or restart after stop',async()=>{
  const f=await fixture({recording:false});try{
    await expect.poll(()=>f.observer.status().actorMatched,{timeout:4000}).toBe(true);
    const require=createRequire(import.meta.url),Chunk=require('prismarine-chunk')('1.21.1');
    const chunk=new Chunk({minY:-64,worldHeight:384});chunk.setBlockStateId(new Vec3(0,64,0),1);
    f.io.emit('loadChunk',{x:0,z:0,chunk:chunk.toJson()});
    await expect.poll(()=>f.observer.status().serializedColumns,{timeout:4000}).toBe(1);
    const scene=f.observer.readScene({radius:2,below:0,above:0,eyeHeight:1.62,fovDegrees:75});
    expect(scene.palette.some(p=>p.name==='minecraft:stone'&&p.stateId===1)).toBe(true);
    expect(scene.coverage.unknown).toBeGreaterThan(0);expect(f.observer.status().samples).toBe(0);
    expect(await f.frames()).toEqual([]);expect(f.inbound).toEqual([]);
    await f.observer.stop();
    expect(()=>f.observer.readScene({radius:0,below:0,above:0,eyeHeight:1.62,fovDegrees:75})).toThrow('fresh pinned viewer');
    expect(()=>f.observer.start()).toThrow('single use');
    await new Promise(done=>setTimeout(done,150));expect(f.observer.status().connected).toBe(false);
  }finally{await f.close();}
});

it('observes a pinned player during an idle operation journal, with no control messages or invented exact keys',async()=>{
  const f=await fixture();try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    const rows=await f.frames(),body=rows.find(x=>x.kind==='observation')!,world=rows.find(x=>x.kind==='environment')!;
    expect(body.observation!.inventory).toEqual({bread:3});expect(body.observation!.controlsKnown).toBe(false);
    expect(body.observation!.controls).toEqual(['sprint']);expect(body.controller).toBe('unknown');
    expect(world.observation!.stateIds).toEqual(Array(245).fill(-1));
    expect(body.observation!.voxels).toEqual(Array(245).fill(0));expect(body.observation!.receivedAt).toBeTruthy();expect(body.observation!.worldAt).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_CONTENT');expect(f.requests).toEqual(['GET']);expect(f.inbound).toEqual([]);
  }finally{await f.close();}
});

it('observes with multiple existing audience sessions when the advertised cap is disabled',async()=>{
  const f=await fixture({viewers:4,maxSessions:0});try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    expect(f.observer.status().connected).toBe(true);expect(f.inbound).toEqual([]);
  }finally{await f.close();}
});

it.each([{actualUuid:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},{address:'other.invalid:25565'}])('refuses cross-account or cross-server observation',async options=>{
  const f=await fixture(options);try{
    await expect.poll(()=>f.observer.status().connected,{timeout:4000}).toBe(true);
    await new Promise(done=>setTimeout(done,300));
    expect(f.observer.status().samples).toBe(0);expect(await f.frames()).toEqual([]);expect(f.inbound).toEqual([]);
  }finally{await f.close();}
});

it('clears loaded world cells at a dimension boundary',async()=>{
  const f=await fixture();try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    const require=createRequire(import.meta.url),Chunk=require('prismarine-chunk')('1.21.1');
    const chunk=new Chunk({minY:-64,worldHeight:384});chunk.setBlockStateId(new Vec3(0,64,0),1);
    f.io.emit('loadChunk',{x:0,z:0,chunk:chunk.toJson()});
    await expect.poll(()=>f.observer.status().loadedColumns,{timeout:4000}).toBe(1);
    await new Promise(done=>setTimeout(done,150));
    expect((await f.frames()).some(row=>row.kind==='environment'&&row.observation?.stateIds?.[122]===1)).toBe(true);
    f.dimension('minecraft:the_nether');
    await expect.poll(()=>f.observer.status().loadedColumns,{timeout:4000}).toBe(0);
    await new Promise(done=>setTimeout(done,150));
    const world=(await f.frames()).filter(x=>x.kind==='environment'&&x.observation?.dimension==='minecraft:the_nether');
    expect(world.length).toBeGreaterThan(0);expect(world.at(-1)!.observation!.stateIds).toEqual(Array(245).fill(-1));
  }finally{await f.close();}
});

it('retains initial local columns when cold initialization makes the first avatar stale',async()=>{
  const require=createRequire(import.meta.url),Chunk=require('prismarine-chunk')('1.21.1');
  const chunk=new Chunk({minY:-64,worldHeight:384});chunk.setBlockStateId(new Vec3(0,64,0),1);
  const f=await fixture({initialChunk:chunk.toJson()});try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    expect(f.observer.status().loadedColumns).toBe(1);expect(f.observer.status().missingPositionColumns).toBe(0);
    expect((await f.frames()).some(row=>row.kind==='environment'&&row.observation?.stateIds?.[122]===1)).toBe(true);
  }finally{await f.close();}
});

it('keeps previously streamed columns and their updates when walking beyond the decoded window',async()=>{
  const require=createRequire(import.meta.url),Chunk=require('prismarine-chunk')('1.21.1');
  const local=new Chunk({minY:-64,worldHeight:384});local.setBlockStateId(new Vec3(0,64,0),1);
  const distant=new Chunk({minY:-64,worldHeight:384});distant.setBlockStateId(new Vec3(0,64,0),2);
  const f=await fixture();try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    f.io.emit('loadChunk',{x:0,z:0,chunk:local.toJson()});f.io.emit('loadChunk',{x:32,z:0,chunk:distant.toJson()});
    f.io.emit('blockUpdate',{pos:{x:32,y:64,z:0},stateId:3});
    await expect.poll(()=>f.observer.status().serializedColumns,{timeout:4000}).toBe(2);
    const first=f.observer.status().samples;f.move(32.5,.5);
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(first+1);
    let worlds=(await f.frames()).filter(x=>x.kind==='environment'&&x.observation?.position?.[0]===32.5);
    expect(worlds.at(-1)!.observation!.stateIds![122]).toBe(3);
    f.io.emit('blockUpdate',{pos:{x:0,y:64,z:0},stateId:4});f.io.emit('unloadChunk',{x:32,z:0});
    const second=f.observer.status().samples;f.move(.5,.5);
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(second+1);
    worlds=(await f.frames()).filter(x=>x.kind==='environment'&&x.observation?.position?.[0]===.5);
    expect(worlds.at(-1)!.observation!.stateIds![122]).toBe(4);expect(f.observer.status().serializedColumns).toBe(1);
    expect(f.inbound).toEqual([]);
  }finally{await f.close();}
});

it('bounds serialized footprint and decodes only the local nine columns',async()=>{
  const require=createRequire(import.meta.url),Chunk=require('prismarine-chunk')('1.21.1');
  const bytes=new Chunk({minY:-64,worldHeight:384}).toJson(),f=await fixture();try{
    await expect.poll(()=>f.observer.status().samples,{timeout:4000}).toBeGreaterThan(0);
    for(let x=0;x<280;x++)f.io.emit('loadChunk',{x:x*16,z:0,chunk:bytes});
    await expect.poll(()=>f.observer.status().receivedColumns,{timeout:4000}).toBe(280);
    const status=f.observer.status();expect(status.serializedColumns).toBeLessThanOrEqual(256);expect(status.serializedBytes).toBeLessThanOrEqual(64*1024*1024);
    expect(status.evictedColumns).toBeGreaterThan(0);expect(status.loadedColumns).toBeLessThanOrEqual(9);
  }finally{await f.close();}
},10000);

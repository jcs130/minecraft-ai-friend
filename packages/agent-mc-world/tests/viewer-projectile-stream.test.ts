import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {io} from 'socket.io-client';
import {startModernViewer} from '../core/modern-viewer.ts';
import {viewerBot,freeViewerPort} from './fixtures/viewer-bot.ts';

it.each(['1.21.1','1.20.6'])('streams observed short-lived arrows on %s before removal without waiting for the entity batch',async version=>{
  const root=await mkdtemp(join(tmpdir(),'mc-viewer-projectile-'));
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const client='/* fixture browser */',worker='/* fixture worker */',jar='a'.repeat(64);
  let viewer:Awaited<ReturnType<typeof startModernViewer>>|undefined;
  let socket:ReturnType<typeof io>|undefined;
  try{
    for(const file of ['dist/modern-viewer.js','public/mesher.js','public/mesherWasm.js','public/threeWorker.js',
      `public/blocksStates/${version}.json`,`public/textures/${version}.png`,'render-assets/blockStatesModels.json',
      'render-assets/blocksAtlases.json','render-assets/itemsAtlases.json']){
      await mkdir(dirname(join(root,file)),{recursive:true});
      await writeFile(join(root,file),file==='dist/modern-viewer.js'?client:file==='public/mesher.js'?worker:'{}');
    }
    await writeFile(join(root,'viewer-assets.json'),JSON.stringify({minecraftVersion:version}));
    await writeFile(join(root,'public/asset-source.json'),JSON.stringify({minecraftVersion:version,clientJarSha256:jar}));
    await writeFile(join(root,'viewer-client.json'),JSON.stringify({minecraftVersion:version,clientJarSha256:jar,
      browserBundleSha256:hash(client),mesherSha256:hash(worker),runtimeRegistryVersion:1,preset:null}));
    const {bot,protocol}=viewerBot(version);Object.assign(bot,{entities:{}});
    // Incoming observations plus explicitly simulated outgoing use packets.
    // The viewer itself must never initiate one.
    protocol.write=()=>{};
    const simulated=Object.assign(bot,{heldItem:{name:'shield'},usingHeldItem:false});
    bot.inventory.slots[36]={name:'shield',count:1};bot.inventory.slots[45]={name:'shield',count:1};
    viewer=await startModernViewer(bot as never,{assetsDir:root,port:await freeViewerPort(),remoteTextures:false});
    socket=io(viewer.url,{autoConnect:false,reconnection:false,transports:['websocket']});
    const ready=new Promise(resolve=>socket!.once('version',resolve));socket.connect();await ready;
    const seen:Array<{event:string;value:any}>=[];
    const avatars:any[]=[];socket.on('avatarState',v=>avatars.push(v));
    const write=protocol.write as (name:string,params:Record<string,unknown>)=>void;
    simulated.usingHeldItem=true;write('use_item',{hand:0});
    await expect.poll(()=>avatars.at(-1)?.shieldHand).toBe('mainhand');
    expect(avatars.at(-1)?.usingOffhand).toBe(false);
    write('use_item',{hand:1});
    await expect.poll(()=>avatars.at(-1)?.shieldHand).toBe('offhand');
    expect(avatars.at(-1)?.usingOffhand).toBe(true);
    simulated.usingHeldItem=false;write('block_dig',{status:5});
    await expect.poll(()=>avatars.at(-1)?.shieldRaised).toBe(false);
    simulated.usingHeldItem=true;write('use_item',{hand:1});bot.health=0;
    await expect.poll(()=>avatars.at(-1)?.health).toBe(0);
    expect(avatars.at(-1)?.shieldRaised).toBe(false);expect(avatars.at(-1)?.shieldHand).toBe(null);
    bot.health=20;simulated.usingHeldItem=false;write('block_dig',{status:5});
    for(const event of ['entity','entityMoved'])socket.on(event,value=>seen.push({event,value}));
    const arrow={...bot.entity,id:72,name:'arrow',type:'projectile',position:bot.entity.position.offset(1,0,0),velocity:bot.entity.position.offset(0,-64,0)};
    arrow.velocity.set(2,0,0);Object.assign(bot.entities,{72:arrow});
    bot.emit('entitySpawn',arrow);
    // Gone in the same event-loop turn: the previous 100ms queue dropped all samples.
    bot.emit('entityGone',arrow);delete (bot.entities as Record<number,unknown>)[72];
    await expect.poll(()=>seen.filter(x=>x.value.id===72).length).toBe(2);
    expect(seen.filter(x=>x.value.id===72)).toMatchObject([
      {event:'entity',value:{id:72,pos:{x:1,y:64,z:0},velocity:{x:2,y:0,z:0}}},
      {event:'entity',value:{id:72,delete:true}},
    ]);
    const far={...arrow,id:73,position:bot.entity.position.offset(500,0,0)};
    bot.emit('entitySpawn',far);bot.emit('entityGone',far);
    await new Promise(resolve=>setTimeout(resolve,150));
    expect(seen.filter(x=>[72,73].includes(x.value.id))).toHaveLength(2);
    for (const [index,name] of ['potion','snowball','egg','ender_pearl','experience_bottle','fireball','small_fireball','dragon_fireball','shulker_bullet','llama_spit','wind_charge','breeze_wind_charge','wither_skull','firework_rocket'].entries()) {
      const projectile={...arrow,id:100+index,name};
      bot.emit('entitySpawn',projectile);bot.emit('entityGone',projectile);
      await expect.poll(()=>seen.filter(x=>x.value.id===projectile.id).length).toBe(2);
      expect(seen.filter(x=>x.value.id===projectile.id).map(x=>x.value.delete??false)).toEqual([false,true]);
    }
    const moving={...arrow,id:74};Object.assign(bot.entities,{74:moving});bot.emit('entitySpawn',moving);
    await expect.poll(()=>seen.filter(x=>x.value.id===74).length).toBe(1);
    moving.position=moving.position.offset(1,0,0);moving.velocity=moving.velocity.clone().set(2,-.5,0);
    bot.emit('entityMoved',moving);
    await expect.poll(()=>seen.filter(x=>x.value.id===74).length).toBe(2);
    expect(seen.find(x=>x.value.id===74&&x.event==='entityMoved')?.value).toMatchObject({pos:{x:2,y:64,z:0},velocity:{x:2,y:-.5,z:0}});
  }finally{
    socket?.disconnect();await viewer?.close();
    expect(dirname(root)).toBe(resolve(tmpdir()));expect(root.split(/[\\/]/).at(-1)).toMatch(/^mc-viewer-projectile-/);
    await rm(root,{recursive:true,force:true});
  }
},15000);

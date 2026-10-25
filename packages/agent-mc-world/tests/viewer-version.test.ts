import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import minecraftData from 'minecraft-data';
import { io } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import { startModernViewer, ownEntity } from '../core/modern-viewer.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { freeViewerPort, viewerBot } from './fixtures/viewer-bot.ts';
import { viewerVersionAssets } from '../core/viewer-version.mjs';

const engineOnly = JSON.parse(readFileSync(new URL('../dist/build.json', import.meta.url), 'utf8')).viewer.included === false;
describe.skipIf(engineOnly)('packaged exact Minecraft 1.21.1 viewer', () => {
  it('serves and streams only the matching registry, font and block-state bytes without game actions', async () => {
    const { bot, protocol } = viewerBot();
    Object.assign(bot, { version: '1.21.1', registry: minecraftData('1.21.1'), entities: {} });
    Object.assign(bot,{players:{[bot.username]:{skinData:{url:'https://textures.minecraft.net/texture/'+'a'.repeat(64)}}}});
    expect(ownEntity(bot as never)).toMatchObject({skinUrl:null,skinAvailability:'disabled'});
    expect(ownEntity(bot as never,true).skinUrl).toBe('/head-texture/'+'a'.repeat(64)+'.png');
    const viewer = await startModernViewer(bot as never, { port: await freeViewerPort(), assetsDir: MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,remoteTextures:false });
    const assets = await viewerVersionAssets(MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,bot.version);
    const socket = io(viewer.url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
    try {
      const own = new Promise<Record<string,unknown>>(resolve=>socket.once('playerEntity',resolve));
      const version = new Promise(resolve => socket.once('version', resolve)); socket.connect();
      expect(await version).toBe('1.21.1');
      expect(await own).toMatchObject({skinUrl:null,skinAvailability:'disabled'});
      expect(await (await fetch(viewer.url + '/healthz')).json()).toMatchObject({ ok: true, version: '1.21.1' });
      const font = await (await fetch(viewer.url + '/text-display-font.json')).json();
      expect(font.minecraftVersion).toBe('1.21.1');
      const content = await (await fetch(viewer.url + '/viewer-content.json')).json();
      expect(content.minecraftVersion).toBe('1.21.1');expect(content.mapColors).toHaveLength(62);
      expect((await fetch(viewer.url + '/particle-content.png')).status).toBe(200);
      const horse=Buffer.from(await(await fetch(viewer.url+'/textures/1.16.4/entity/horse/horse_skeleton.png')).arrayBuffer());
      const originalHorse=readFileSync(join(assets,'public/textures/1.21.1/entity/horse/horse_skeleton.png'));
      expect(horse).toEqual(originalHorse);
      expect(await (await fetch(viewer.url + '/speech-source')).json()).toMatchObject({available:false});
      const unavailable = await fetch(viewer.url + '/head-texture/' + 'a'.repeat(64) + '.png');
      expect(unavailable.status).toBe(503);expect(unavailable.headers.get('content-type')).toContain('application/json');
      expect(await unavailable.json()).toMatchObject({available:false,reason:'remote_textures_disabled'});
      const patch = new Promise<Record<string,unknown>>(resolve => socket.once('mapPixels', resolve));
      protocol.emit('map', {itemDamage:725,scale:0,locked:false,columns:1,rows:1,x:0,y:0,data:Buffer.from([4])});
      const received=await patch;
      expect(received).toMatchObject({mapId:725,x:0,y:0});
      // Backpressure may coalesce this patch into the exact bounded map cache.
      // Either representation must retain the actual received pixel, not fill
      // unknown pixels or require a particular socket scheduling order.
      expect([1,128]).toContain(received.columns);
      expect(received.rows).toBe(received.columns===1?1:128);
      const pixels=received.data as number[];
      expect(pixels).toHaveLength((received.columns as number)*(received.rows as number));
      expect(pixels[0]).toBe(4);
      if(received.columns===128) expect((received.coverage as number[])[0]&1).toBe(1);
      const bytes = Buffer.from(await (await fetch(viewer.url + '/blocksStates/1.21.1.json')).arrayBuffer());
      const original = readFileSync(join(assets, 'public/blocksStates/1.21.1.json'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
      expect((await fetch(viewer.url + '/fonts/1.20.6/unifont.zip')).status).toBe(404);
    } finally { socket.disconnect(); await viewer.close(); }
  }, 15000);
});

describe.skipIf(engineOnly)('packaged exact Minecraft 1.21.11 viewer',()=>{
  it('starts with actual 774 data and serves exact new-version textures and fonts',async()=>{
    const {bot}=viewerBot('1.21.11');Object.assign(bot,{entities:{}});
    expect(bot.registry.version.version).toBe(774);
    const viewer=await startModernViewer(bot as never,{port:await freeViewerPort(),assetsDir:MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir});
    const assets=await viewerVersionAssets(MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,'1.21.11');
    const socket=io(viewer.url,{autoConnect:false,reconnection:false,transports:['websocket']});
    try{
      const version=new Promise(resolve=>socket.once('version',resolve));socket.connect();expect(await version).toBe('1.21.11');
      expect(await(await fetch(viewer.url+'/healthz')).json()).toMatchObject({ok:true,version:'1.21.11'});
      expect(await(await fetch(viewer.url+'/text-display-font.json')).json()).toMatchObject({minecraftVersion:'1.21.11',
        clientJarSha256:'1473c9489ac50fda3c435049a76a70d61a10b8610db27f5ba9d8756b686cd3bd'});
      const iron=Buffer.from(await(await fetch(viewer.url+'/textures/models/armor/iron_layer_2.png')).arrayBuffer());
      expect(iron).toEqual(readFileSync(join(assets,'public/textures/1.21.11/entity/equipment/humanoid_leggings/iron.png')));
      expect((await fetch(viewer.url+'/fonts/1.21.1/unifont.zip')).status).toBe(404);
      expect((await fetch(viewer.url+'/blocksStates/1.21.1.json')).status).toBe(404);
    }finally{socket.disconnect();await viewer.close();}
  },15000);
});

describe.skipIf(engineOnly)('exact vanilla versions beyond the primary maintenance release',()=>{
  it('serves actual 1.21.5 blocks while absent optional font/icons stay local feature gaps',async()=>{
    const {bot}=viewerBot('1.21.5');Object.assign(bot,{entities:{}});
    expect(bot.registry.version.version).toBe(770);
    const viewer=await startModernViewer(bot as never,{port:await freeViewerPort(),assetsDir:MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir});
    try{
      expect(await(await fetch(viewer.url+'/healthz')).json()).toMatchObject({ok:true,version:'1.21.5'});
      const blocks=await(await fetch(viewer.url+'/blocksStates/1.21.5.json')).json();expect(blocks.stone).toBeDefined();
      expect((await fetch(viewer.url+'/icons/not_a_real_item.png')).status).toBe(404);
      expect((await fetch(viewer.url+'/text-display-font.json')).status).toBe(404);
      expect((await fetch(viewer.url+'/healthz')).status).toBe(200);
      expect((await fetch(viewer.url+'/blocksStates/1.21.1.json')).status).toBe(404);
    }finally{await viewer.close();}
  },15000);
});

describe.skipIf(engineOnly)('vanilla multiplayer skin synchronization',()=>{
  it('updates a tracked player from late server properties without movement or reconnecting',async()=>{
    const {bot}=viewerBot();const uuid='11111111-2222-3333-4444-555555555555';
    const other={...bot.entity,id:2,uuid,username:'Alice',position:bot.entity.position.offset(2,0,-2)};
    Object.assign(bot,{entities:{2:other},players:{}});
    const viewer=await startModernViewer(bot as never,{port:await freeViewerPort(),assetsDir:MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir});
    const socket=io(viewer.url,{autoConnect:false,reconnection:false,transports:['websocket']});
    try{
      const entity=(wanted:string|null)=>new Promise<any>(resolve=>{const listener=(data:any)=>{if(data.id===2&&data.skinUrl===wanted){socket.off('entity',listener);resolve(data);}};socket.on('entity',listener);});
      const initial=entity(null);socket.connect();await initial;
      const hash='a'.repeat(64),skinUrl=`/head-texture/${hash}.png`,changed=entity(skinUrl);
      Object.assign(bot.players,{Alice:{uuid,properties:[{name:'textures',value:Buffer.from(JSON.stringify({textures:{SKIN:{url:'http://textures.minecraft.net/texture/'+hash,metadata:{model:'slim'}}}})).toString('base64')}]}});
      bot.emit('playerUpdated',{uuid,username:'Alice'});
      expect(await changed).toMatchObject({id:2,uuid,skinUrl,skinModel:'slim'});
      const removed=entity(null);Object.assign(bot.players,{Alice:{uuid}});bot.emit('playerUpdated',{uuid,username:'Alice'});
      expect(await removed).toMatchObject({id:2,skinUrl:null});
    }finally{socket.disconnect();await viewer.close();}
  },15000);
});

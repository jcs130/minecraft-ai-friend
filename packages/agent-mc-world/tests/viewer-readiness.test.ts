import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../core/bridge.ts';
import {EventEmitter} from 'node:events';
import {freeViewerPort} from './fixtures/viewer-bot.ts';

const log={info(){},warn(){},error(){},debug(){},trace(){},emit(){},child(){return this;}};
function readyBridge(port:number,assets?:string) {
  const bridge=new Bridge({host:'example.test',port:25565,username:'fixture',version:'auto',viewerPort:port,
    viewerAssetsDir:assets,log:log as never,onSpawn(){},onDisconnect(){}});
  const bot=Object.assign(new EventEmitter(),{version:'1.21.11',username:'fixture',_client:{state:'play'},entity:{},quit(){}});
  Object.assign(bridge,{_bot:bot,spawnedBot:bot,started:true,protocolSpawned:true});
  return {bridge,bot};
}
it('reports a broken explicitly matching pack independently of a ready 1.21.11 game',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'viewer-readiness-'));
  await writeFile(join(directory,'viewer-assets.json'),JSON.stringify({minecraftVersion:'1.21.11'}));
  const {bridge,bot}=readyBridge(await freeViewerPort(),directory);
  try {
    (bridge as any).startViewer(bot,0);
    expect(bridge.viewerState.phase).toBe('starting');
    await vi.waitFor(()=>expect(bridge.viewerState.phase).toBe('failed'));
    expect(bridge.connected).toBe(true);
    expect(bridge.viewerState).toMatchObject({version:'1.21.11',code:'VIEWER_ASSETS_MISSING'});
    expect(bridge.viewerState.message).toContain('1.21.11');
    expect(JSON.stringify(bridge.viewerState)).not.toContain(directory);
    expect(bridge.viewerUrl).toBeNull();
    const quit=vi.spyOn(bot,'quit');
    expect(bridge.viewerResources()).toMatchObject({directory,repair:{retry:expect.stringContaining('viewer-retry')}});
    expect(bridge.retryViewer().phase).toBe('starting');
    await vi.waitFor(()=>expect(bridge.viewerState.phase).toBe('failed'));
    expect(bridge.bot).toBe(bot);expect(bridge.connected).toBe(true);expect(quit).not.toHaveBeenCalled();
    Object.assign(bridge,{generation:1});
    expect(bridge.viewerState.phase).toBe('waiting');
  } finally {await bridge.stop();await rm(directory,{recursive:true,force:true});}
});
it('retries a compatible picture once so exact resources can be adopted without reconnecting or replaying the body',async()=>{
  const {bridge,bot}=readyBridge(await freeViewerPort());
  let release!:()=>void;
  const dispose=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const start=vi.fn();
  Object.assign(bridge,{viewer:{gen:0,url:'http://127.0.0.1:12345',kind:'modern',dispose,
    resources:{mode:'compatible',requestedVersion:'1.21.11',assetVersion:'1.21.1'}},startViewer:start});
  try{
    expect(bridge.retryViewer().phase).toBe('starting');
    expect(bridge.retryViewer().phase).toBe('starting');
    expect(dispose).toHaveBeenCalledTimes(1);
    release();await vi.waitFor(()=>expect(start).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(bot,0);expect(bridge.connected).toBe(true);
  }finally{await bridge.stop();}
});
it('finishes the startup marker on readiness so a later compatible-picture refresh is not suppressed',async()=>{
  const {bridge,bot}=readyBridge(await freeViewerPort());
  const close=vi.fn();
  Object.assign(bridge,{loadViewer:async()=>({mineflayer:()=>Object.assign(bot,{viewer:{close}})})});
  try{
    (bridge as any).startViewer(bot,0);
    await vi.waitFor(()=>expect(bridge.viewerState.phase).toBe('ready'));
    expect((bridge as any).viewerStartup).toBeNull();
    expect(bridge.connected).toBe(true);
  }finally{await bridge.stop();expect(close).toHaveBeenCalledTimes(1);}
});
it('does not let an old asynchronous failure replace the new connection viewer state',async()=>{
  const {bridge,bot}=readyBridge(await freeViewerPort());
  let reject!:(error:Error)=>void;
  Object.assign(bridge,{loadViewer:()=>new Promise((_,fail)=>{reject=fail;})});
  try {
    (bridge as any).startViewer(bot,0);
    await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));
    Object.assign(bridge,{generation:1,viewerStartup:{gen:1,phase:'starting',version:'1.21.11',code:null,message:null}});
    reject(new Error('old viewer failure'));
    await new Promise(resolve=>setTimeout(resolve,15));
    expect(bridge.viewerState.phase).toBe('starting');
  }finally{await bridge.stop();}
});
it('disabled rendering remains explicit without changing game readiness',async()=>{
  const {bridge}=readyBridge(0);
  try {expect(bridge.connected).toBe(true);expect(bridge.viewerState.phase).toBe('disabled');}
  finally{await bridge.stop();}
});

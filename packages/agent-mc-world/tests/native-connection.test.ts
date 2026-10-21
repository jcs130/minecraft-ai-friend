import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import mineflayer from 'mineflayer';
import {afterEach,expect,it,vi} from 'vitest';
import {prepareNativeConnection,nativeInventoryReadout} from '../core/native-connection.ts';
import {Bridge} from '../core/bridge.ts';
const bridges:Bridge[]=[],directories:string[]=[];
it('keeps native bag readout and focused original-ID matches in the read-once contract',()=>{
 const state={available:true,inventory:{slots:[{slot:9,item:{name:'create:andesite_casing',count:3}},{slot:10,item:{name:'minecraft:apple',count:2}}]}};
 expect(JSON.parse(nativeInventoryReadout(state).text)).toEqual(state);
 expect(JSON.parse(nativeInventoryReadout(state,'create:andesite_casing').text).matches).toHaveLength(1);
 expect(JSON.parse(nativeInventoryReadout(state,'apple').text).matches[0].slot).toBe(10);
 expect(nativeInventoryReadout({available:false,reason:'offline'}).stamp).toContain('offline');
});
afterEach(async()=>{await Promise.all(bridges.splice(0).map(b=>b.stop()));vi.restoreAllMocks();await Promise.all(directories.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('requires an explicit local adapter and does not discover a native server',async()=>{
 expect(await prepareNativeConnection(undefined,0)).toBeUndefined();
 await expect(prepareNativeConnection({module:'https://example.invalid/adapter.mjs',assetsDir:'assets'},0)).rejects.toThrow(/explicit local/);
 const dir=await mkdtemp(join(tmpdir(),'mc-native-adapter-'));directories.push(dir);
 const module=join(dir,'adapter.mjs');await writeFile(module,'export async function prepareNativeConnection(options){return {attach(bot){return {query:()=>({asset:options.assetDirectory,body:bot.username}),close:async()=>{},listen:async()=>null,url:null}}}}');
 const adapter=await prepareNativeConnection({module:pathToFileURL(module).href,assetsDir:'matched-assets'},0);
 expect(adapter?.attach({username:'own'} as never).query({})).toEqual({asset:'matched-assets',body:'own'});
});
it('attaches to the action bot before early packets and disposes its connection on stop',async()=>{
 const bot=Object.assign(new EventEmitter(),{username:'own',version:'1.21.1',_client:new EventEmitter(),loadPlugin(){},quit(){},entity:{position:{x:0,y:64,z:0}}});
 vi.spyOn(mineflayer,'createBot').mockReturnValue(bot as never);
 const close=vi.fn(async()=>{}),seen:string[]=[];
 const log={info(){},warn(){},error(){},debug(){},trace(){},emit(){},child(){return this;}};
 const bridge=new Bridge({host:'example.test',port:25565,username:'own',version:'1.21.1',viewerPort:0,log:log as never,onSpawn(){},onDisconnect(){},
   nativeConnection:{attach(body){expect(body).toBe(bot);body._client.on('custom_payload',p=>seen.push(p.channel));return {query:()=>({body:'own'}),close,listen:async()=>null,url:null};}}});
 bridges.push(bridge);expect(bridge.nativeQuery({})).toMatchObject({available:false,reason:'NATIVE_CONNECTION_OFFLINE'});
 bridge.start();bot._client.emit('custom_payload',{channel:'mcviewer:native_packet'});
 expect(seen).toEqual(['mcviewer:native_packet']);expect(bridge.nativeQuery({action:'status'})).toEqual({body:'own'});
 await bridge.stop();expect(close).toHaveBeenCalledTimes(1);expect(bridge.nativeQuery({})).toMatchObject({available:false});
});

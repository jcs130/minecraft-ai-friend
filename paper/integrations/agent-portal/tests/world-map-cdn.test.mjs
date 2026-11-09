import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MapTileCdn} from '../src/world-map-tile-cdn.mjs';
import {createWorldMapService} from '../src/world-map-service.mjs';
import {validateMapState} from '../src/world-map.mjs';
import {parseMapObservation} from '../scripts/world-map-source.mjs';
import {dimensionIds,worldNames,visiblePlayers,covered} from '../public/world-map-model.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key='maps/aincrad/tiles/0/x1/z2.prbm.gz',baseUrl='https://assets.example.invalid/map-release';
const nested='maps/aincrad/tiles/0/x-1/0/z-1/0.prbm.gz';
const manifest=()=>Buffer.from(JSON.stringify({schemaVersion:1,files:[[key,'a'.repeat(64),50],[nested,'b'.repeat(64),60]]}));
async function fixture(t,{bytes=manifest(),digest=sha(bytes)}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-cdn-map-'));
 await fs.mkdir(path.join(root,'world-map'));
 await fs.writeFile(path.join(root,'world-map','.tile-cdn.json'),bytes);
 await fs.writeFile(path.join(root,'map.html'),'<title>Map shell</title>');
 const service=createWorldMapService({dataDir:root,publicDir:root,tokenHash:'f'.repeat(64),tileCdn:{baseUrl,manifestSha256:digest}});
 await service.map.write('index.html',Buffer.from('<title>Terrain</title>'));
 await service.map.write('assets/player-portraits/11111111-1111-3111-8111-111111111111.png',Buffer.from('portrait'));
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>service.server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 return{...service,root,origin:'http://127.0.0.1:'+service.server.address().port};
}
test('four worlds retain exact dimensions and an Aincrad position is never treated as overworld',()=>{
 const at=Date.now(),uuid='11111111-1111-3111-8111-111111111111';
 const maps=Object.entries(dimensionIds).map(([dimension,id])=>({id,dimension,label:worldNames[id],bounds:{minX:-4096,maxX:16384,minZ:-4096,maxZ:16384}}));
 const player={name:'ag_Example',uuid,dimension:'minecraft:aincrad',x:9000,y:70,z:8200,yaw:20,pitch:-5};
 const state=validateMapState({schemaVersion:1,sequence:1,observedAt:new Date(at).toISOString(),players:[player],maps},at);
 assert.equal(state.maps.length,4);assert.equal(visiblePlayers({...state,available:true},'',at)[0].dimension,'minecraft:aincrad');
 assert.equal(covered(player,maps),true);assert.equal(covered(player,maps.filter(v=>v.id==='overworld')),false);
 const parsed=parseMapObservation({Pos:'ag_Example has the following entity data: [9000.0d, 70.0d, 8200.0d]',Dimension:'ag_Example has the following entity data: "minecraft:aincrad"',Rotation:'ag_Example has the following entity data: [20.0f, -5.0f]'},[{name:player.name,uuid}]);
 assert.deepEqual(parsed,[player]);
 const xixi={...player,dimension:'minecraft:overworld',x:-1136.5,z:-574.5};assert.equal(covered(xixi,maps),true);
 assert.throws(()=>validateMapState({...state,maps:[...maps,{...maps[0],id:'unknown'}]},at));
});
test('HTTP terrain redirects use verified immutable objects; missing terrain never falls back to an old tile',async t=>{
 const f=await fixture(t);
 for(const method of ['GET','HEAD']){
  const response=await fetch(f.origin+'/world-map/maps/aincrad/tiles/0/x1/z2.prbm',{method,redirect:'manual'});
  assert.equal(response.status,307);assert.equal(response.headers.get('location'),baseUrl+'/'+key);
  assert.equal(response.headers.get('etag'),'"'+'a'.repeat(64)+'"');assert.equal(await response.text(),'');
 }
 assert.equal((await fetch(f.origin+'/world-map/'+key,{redirect:'manual'})).status,307);
 const grouped=await fetch(f.origin+'/world-map/'+nested.slice(0,-3),{redirect:'manual'});assert.equal(grouped.status,307);assert.equal(grouped.headers.get('location'),baseUrl+'/'+nested);
 assert.equal((await fetch(f.origin+'/world-map/'+key,{headers:{'If-None-Match':'"'+'a'.repeat(64)+'"'},redirect:'manual'})).status,304);
 const missing='maps/aincrad/tiles/0/x8/z9.prbm';await f.map.write(missing,Buffer.from('old local tile'));
 const unknown=await fetch(f.origin+'/world-map/'+missing);assert.equal(unknown.status,204);assert.equal(unknown.headers.get('x-map-tile-state'),'unknown');
 assert.equal((await fetch(f.origin+'/world-map/maps/aincrad/tiles/2/x8/z9.png')).status,404);
});
test('CDN scope preserves live players, portraits, authorization and the shell CSP',async t=>{
 const f=await fixture(t),now=Date.now(),uuid='11111111-1111-3111-8111-111111111111';
 const row={name:'ag_Example',uuid,dimension:'minecraft:aincrad',x:9000,y:70,z:8200,yaw:20,pitch:-5};
 await f.map.acceptState({schemaVersion:1,sequence:1,observedAt:new Date(now).toISOString(),players:[row],maps:[{id:'aincrad',label:'艾恩葛朗特',dimension:row.dimension,bounds:{minX:8000,maxX:11000,minZ:8000,maxZ:9000}}]});
 const players=await fetch(f.origin+'/world-map/maps/aincrad/live/players.json');assert.equal(players.status,200);assert.equal(players.headers.get('location'),null);assert.equal((await players.json()).players[0].uuid,uuid);
 assert.deepEqual((await(await fetch(f.origin+'/world-map/maps/overworld/live/players.json')).json()).players,[]);
 const portrait=await fetch(f.origin+'/world-map/maps/aincrad/assets/playerheads/'+uuid+'.png');assert.equal(portrait.status,200);assert.equal(await portrait.text(),'portrait');
 assert.equal((await fetch(f.origin+'/api/v1/internal/world-map/files/assets/test.png',{method:'PUT',body:'x'})).status,401);
 const shell=await fetch(f.origin+'/map.html'),terrain=await fetch(f.origin+'/world-map/');
 assert.doesNotMatch(shell.headers.get('content-security-policy'),/assets\.example/);assert.match(terrain.headers.get('content-security-policy'),/connect-src 'self' https:\/\/assets\.example\.invalid;/);
 assert.match(terrain.headers.get('content-security-policy'),/script-src 'self' 'unsafe-eval';/);
});
test('unverified index bytes fail closed rather than redirecting public requests',async t=>{
 const f=await fixture(t,{digest:'f'.repeat(64)});
 const response=await fetch(f.origin+'/world-map/'+key,{redirect:'manual'});assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);
});
test('the bounded index is cached once and refuses private paths, duplicates and unsupported hosts',async()=>{
 let reads=0;const bytes=manifest(),cdn=new MapTileCdn({baseUrl,manifestSha256:sha(bytes)},async()=>{reads++;return bytes;});
 await Promise.all([cdn.lookup(key),cdn.lookup('maps/overworld/tiles/0/x0/z0.png')]);assert.equal(reads,1);
 assert.equal(await cdn.lookup('assets/player-portraits/x.png'),null);assert.equal(reads,1);
 for(const files of [[['../portal.sqlite','a'.repeat(64),1]],[[key,'a'.repeat(64),1],[key,'a'.repeat(64),1]],[['maps/aincrad/assets/script.js','a'.repeat(64),1]],[[key,'bad',1]],[[key,'a'.repeat(64),0]]]){
  const bad=Buffer.from(JSON.stringify({schemaVersion:1,files}));
  await assert.rejects(new MapTileCdn({baseUrl,manifestSha256:sha(bad)},async()=>bad).lookup(key),/MANIFEST_FORMAT/);
 }
 for(const url of ['http://assets.example.invalid','https://user:pass@assets.example.invalid','https://assets.example.invalid/?token=x'])assert.throws(()=>new MapTileCdn({baseUrl:url,manifestSha256:'a'.repeat(64)},async()=>bytes));
});

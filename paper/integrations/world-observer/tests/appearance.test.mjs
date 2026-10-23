import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ObservationAppearanceSource} from '../appearance-source.mjs';
const uuid='6e8b395e-4349-3d44-99f5-b7488825e426',sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'observer-appearance-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const now=100000,stateFile=path.join(root,'appearance.json'),bytes=Buffer.from('original public model'),hash=sha(bytes),calls=[];
 const row={schemaVersion:1,source:'freesia_worker',playerUuid:uuid,entityId:12,available:true,webAvailable:true,modelId:'neko_yui',texture:'default',assetSha256:hash,assetBytes:bytes.length,ysmVersion:'2.4.1',protocolVersion:'2.4.0',jarSha256:'e'.repeat(64)};
 const state={source:'freesia_worker',writtenAt:now,epoch:'source-epoch',players:[row]};
 const config={stateFile,ysmJarSha256:row.jarSha256,skinsRestorerRoot:root};
 const save=()=>fs.writeFile(stateFile,JSON.stringify(state));await save();
 const source=new ObservationAppearanceSource({config,now:()=>now,decodeBundle:(b,h)=>{assert.equal(sha(b),h);return {modelId:'neko_yui',textures:{default:'skin.png'},files:{}}},exportBundle:async r=>{calls.push(r.modelId);return bytes;}});
 return {source,row,state,save,calls,player:{uuid,entityId:12},root,now};
}
test('fresh confirmed model is exported once and only bound to its actual UUID/body; copied resources remain immutable',async t=>{
 const f=await fixture(t);await Promise.all([f.source.forPlayer(f.player),f.source.forPlayer(f.player)]);
 const b=f.source.binding(f.player);assert.equal(b.available,true);assert.equal(b.reason,null);assert.equal(b.authority,'freesia_worker');assert.equal(f.calls.length,1);
 assert.ok(f.source.read(b.bundleSha256));assert.equal(f.source.binding({...f.player,entityId:13}),null);
 assert.equal(f.source.binding({...f.player,uuid:'822d173a-7181-3b9b-be60-804f29b24ecc'}),null);assert.equal(f.source.read('../private'),null);
})
test('stale state, a replaced body, wrong JAR or mismatched original bytes cannot render a claimed model',async t=>{
 for(const mutation of [f=>{f.state.writtenAt=0},f=>{f.row.entityId=13},f=>{f.row.jarSha256='f'.repeat(64)},f=>{f.row.assetBytes++}]){
  const f=await fixture(t);mutation(f);await f.save();await f.source.forPlayer(f.player);assert.equal(f.source.binding(f.player).available,false);assert.equal(f.source.assets.size,0);
 }
})
test('skin loading follows the original UUID-specific SkinsRestorer binding; only Mojang texture URLs are fetched',async t=>{
 const f=await fixture(t);f.row.available=false;await f.save();await fs.mkdir(path.join(f.root,'players'));await fs.mkdir(path.join(f.root,'skins'));
 await fs.writeFile(path.join(f.root,'players',uuid+'.player'),JSON.stringify({uniqueId:uuid,skinIdentifier:{type:'CUSTOM',identifier:'neko_skin'}}));
 const skinFile=path.join(f.root,'skins','neko_skin.customskin'),skin={textures:{SKIN:{url:'http://textures.minecraft.net/texture/'+'d'.repeat(64),metadata:{model:'slim'}}}};
 const save=()=>fs.writeFile(skinFile,JSON.stringify({value:Buffer.from(JSON.stringify(skin)).toString('base64')}));await save();
 const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(64,16);png.writeUInt32BE(64,20);
 f.source.fetcher=async url=>{assert.equal(url,'https://textures.minecraft.net/texture/'+'d'.repeat(64));return new Response(png)};
 await f.source.forPlayer(f.player);const b=f.source.binding(f.player);assert.equal(b.kind,'skin');assert.equal(b.authority,'skinsrestorer_uuid_binding');assert.equal(b.texture,'slim');
 f.source.bindings.clear();skin.textures.SKIN.url='http://127.0.0.1/private';await save();await f.source.forPlayer(f.player);assert.equal(f.source.binding(f.player).available,false);
})

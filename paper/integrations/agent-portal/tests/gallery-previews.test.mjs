import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';
import {Store} from '../src/store.mjs';
import {Gallery} from '../src/gallery.mjs';
import {GalleryMedia} from '../src/gallery-media.mjs';
import {PhotoScenes} from '../src/photo-scenes.mjs';
import {encodeSceneArchive} from '../src/viewer/photo-scene-archive.mjs';
import {projectScene} from '../src/scene-preview-worker.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const id=randomUUID(),owner=randomUUID(),world=randomUUID();
const meta={id,author:'Fixture',authorUuid:owner,capturedAt:new Date().toISOString(),title:'Garden',story:''};
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'portal-preview-')),store=new Store(root),gallery=new Gallery(store,null);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const insert=(data,visible)=>store.db.prepare('INSERT OR REPLACE INTO gallery_catalog VALUES(?,?,?,?)').run(id,JSON.stringify(data),visible?1:0,Date.now());
  return {store,gallery,insert};
}
test('size-limited thumbnail, revalidation, owner access and withdrawal after private OSS mirroring',async t=>{
  const {store,gallery,insert}=await fixture(t),img=new PNG({width:640,height:320});img.data.fill(255);
  const bytes=PNG.sync.write(img),photo={...meta,sha256:sha(bytes),bytes:bytes.length,width:640,height:320};
  insert(photo,true);gallery.accept(id,bytes);
  let mirror=0,sign=0;const media=new GalleryMedia(gallery,{publishPhotoMedia:async(s,original,thumb,digest)=>{assert.equal(s,sha(original));assert.equal(digest,sha(thumb));mirror++;},
    photoLocation:async()=>{sign++;return 'https://example.test/private-signed-photo';}});
  const [a,b]=await Promise.all([media.read(id,'thumbnail'),media.read(id,'thumbnail')]);
  assert.deepEqual(a.bytes,b.bytes);const image=jpeg.decode(a.bytes);assert.equal(image.width,512);assert.equal(image.height,256);
  await media.drain();assert.equal(mirror,1);assert.equal((await media.read(id,'thumbnail',null,'"'+a.digest+'"')).status,304);
  assert.equal((await media.read(id,'original')).status,307);insert(photo,false);
  await assert.rejects(media.read(id,'thumbnail'),{status:404});
  const self={uuids:new Set([owner])};assert.equal((await media.read(id,'thumbnail',self)).status,200);
  assert.equal(sign,1);await assert.rejects(media.read(id,'thumbnail',{uuids:new Set()}),{status:404});
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM gallery_thumbnails_v1').get().n,1);
});
function captured() {
  const zero=Buffer.alloc(2048).toString('base64');
  // A single known stone section below an air section, viewed from above.
  const sections=Buffer.from([16,0,0,1,0,0,0,0, 0,0,0,0,0,0,0,0]).toString('base64');
  return {schema:'mc-photo-scene/v1',photo:{id,owner,worldUuid:world,imageSha256:'a'.repeat(64),mode:'third',width:256,height:256},
    source:{protocol:'agent-mc-visual/v1',minecraftVersion:'1.21.1',rendererUuid:owner,epoch:world,startedAt:1,completedAt:2},
    camera:{position:[10008,17,20008],yawRadians:0,pitchRadians:-.6,projectionMatrix:null,nativeInstance:'private-machine'},
    frame:{dimension:'minecraft:overworld',self:{id:1,uuid:owner,name:'minecraft:player',username:'PrivateName',position:[10008,16,20008]},entities:[]},
    registry:{blocks:[{id:0,name:'minecraft:air',properties:{}},{id:1,name:'minecraft:stone',properties:{}}],biomes:[{id:0,name:'minecraft:plains'}]},
    chunks:[{x:625,z:1250,revision:1,minY:0,height:32,sections,skyLight:[zero,zero],blockLight:[zero,zero]}],
    coverage:{requestedRadius:0,saved:1,missingColumns:[],changedColumns:[],completeSceneParityVerified:false},appearances:[],resources:[],limitations:[]};
}
test('only photographed faces reach the visitor, and a cached scene immediately honours withdrawal',async t=>{
  const {store,gallery,insert}=await fixture(t),payload=captured(),encoded=await encodeSceneArchive(payload);
  const objects={put:async()=>{},readScene:async()=>encoded.bytes},scenes=new PhotoScenes(store,gallery,objects);
  const photo={...meta,sha256:'b'.repeat(64),bytes:99,width:256,height:256,scene:encoded.metadata};
  insert(photo,true);await scenes.accept(id,encoded.bytes);
  const view=await scenes.preview(id,null);assert.ok(view.faces.length>=3);assert.ok(view.faces.every(f=>f.length===5&&f[3]===3&&f.slice(0,3).every(n=>Math.abs(n)<=32)));
  assert.deepEqual(Object.keys(view).sort(),['faces','schema','yaw']);assert.doesNotMatch(JSON.stringify(view),new RegExp([owner,world,'PrivateName','private-machine','10008','20008'].join('|')));
  insert(photo,false);await assert.rejects(scenes.preview(id,null),{status:404});
  await assert.rejects(scenes.preview(id,{uuids:new Set()}),{status:404});
  assert.deepEqual(await scenes.preview(id,{uuids:new Set([owner])}),view);
  const damaged=captured();damaged.chunks[0].sections='AA==';assert.throws(()=>projectScene(damaged));
});

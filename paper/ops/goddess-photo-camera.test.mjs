import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhotoJob,nativePhotoSkin,photoLoadedRadius} from './goddess-photo-camera.mjs';
const id = '2e254cab-2738-40bb-b9bf-4f65a3c3be12';
const job = {type:'capture',job:id,nonce:id,owner:id,world:id,uploadId:id,entityId:12,mode:'first',x:0,y:64,z:0,yaw:0,pitch:0,anchorX:0,anchorY:64,anchorZ:0,uploadBase:'http://127.0.0.1:8517'};

test('photography selects a complete actual footprint without accepting holes or loading columns',()=>{
  const columns=new Map(),column={toJson:()=>'{"actual":true}'};
  const world={getColumn:(x,z)=>columns.get(`${x},${z}`),getColumnAt:()=>{throw Error('must not load world');}};
  assert.equal(photoLoadedRadius(world,{x:-.5,z:32},6),0);
  for(let x=-5;x<=3;x++)for(let z=-2;z<=6;z++)columns.set(`${x},${z}`,column);
  assert.equal(photoLoadedRadius(world,{x:-.5,z:32},6),4,'server-limited columns choose a complete 9x9 photograph');
  assert.equal(photoLoadedRadius(world,{x:-.5,z:32},3),3,'explicit smaller budget is respected');
  columns.delete('-1,2');assert.equal(photoLoadedRadius(world,{x:-.5,z:32},6),0,'central holes cannot be counted as hidden');
  columns.set('-1,2',Promise.resolve(column));assert.equal(photoLoadedRadius(world,{x:-.5,z:32},6),0,'async loading does not establish receipt');
  assert.equal(photoLoadedRadius(world,{x:NaN,z:32},6),0);
});
test('actual skin properties preserve the original texture identity and model; arbitrary downloads are rejected',()=>{
  const hash='a'.repeat(64);
  assert.deepEqual(nativePhotoSkin({url:'http://textures.minecraft.net/texture/'+hash,model:'slim'}),{hash,url:'https://textures.minecraft.net/texture/'+hash,model:'slim'});
  assert.equal(nativePhotoSkin(undefined),null);
  for(const url of ['http://127.0.0.1/private.png','https://example.com/texture/'+hash,'https://textures.minecraft.net/texture/'+hash+'?url=other','https://user:secret@textures.minecraft.net/texture/'+hash])assert.throws(()=>nativePhotoSkin({url}));
});
test('only private numeric upload destinations and supported camera angles are accepted', () => {
  for (const base of ['http://127.0.0.1:8517','http://192.168.3.163:8517','http://10.0.0.3:8517','http://172.16.0.3:8517']) {
    for (const mode of ['first','third','top']) assert.equal(validatePhotoJob({...job,mode,uploadBase:base}).mode,mode);
  }
  for (const uploadBase of ['https://example.com','http://8.8.8.8','http://localhost:8517','http://user:secret@127.0.0.1:8517','http://127.0.0.1:8517/other','http://127.0.0.1:8517/?id=secret','http://127.0.0.1:8517/#redirect','file:///private.png','http://172.32.0.1:8517']) assert.throws(() => validatePhotoJob({...job,uploadBase}));
});
test('malformed ownership, replay envelopes and nonfinite camera poses fail before rendering', () => {
  for (const key of ['job','nonce','owner','world','uploadId']) assert.throws(() => validatePhotoJob({...job,[key]:'forged'}));
  for (const key of ['x','y','z','yaw','pitch','anchorX','anchorY','anchorZ']) assert.throws(() => validatePhotoJob({...job,[key]:NaN}));
  for (const override of [{type:'say'},{mode:'free'},{entityId:1.5}]) assert.throws(() => validatePhotoJob({...job,...override}));
});

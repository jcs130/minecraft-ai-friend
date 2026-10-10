import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhotoJob,nativePhotoSkin} from './goddess-photo-camera.mjs';
const id = '2e254cab-2738-40bb-b9bf-4f65a3c3be12';
const job = {type:'capture',job:id,nonce:id,owner:id,world:id,uploadId:id,entityId:12,mode:'first',x:0,y:64,z:0,yaw:0,pitch:0,anchorX:0,anchorY:64,anchorZ:0,uploadBase:'http://127.0.0.1:8517'};
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

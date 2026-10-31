import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {validateNativeCamera,nativeCameraPose,createNativePhotoRenderer} from './native-photo-renderer.mjs';
const id='bdab127e-4ef3-4380-adca-a6f1430223d5';
const state=()=>({schema:'qiandeng-native-camera/v1',instanceId:id,playerUuid:id,at:new Date().toISOString(),connected:true,renderer:'Intel(R) UHD Graphics 770',server:'127.0.0.1:29090',shadersEnabled:true,cleanHud:true,cleanToasts:true,modelCatalogueSize:4});
const job={job:id,nonce:id,owner:id,entityId:12,mode:'first',x:0,y:64,z:0,yaw:Math.PI,pitch:-0.25,anchorX:0,anchorY:64,anchorZ:0};
test('readiness requires fresh Intel rendering, shaders, a loaded model catalogue and connection identity',()=>{
 assert.equal(validateNativeCamera(state()).connected,true);
 for(const change of [{renderer:'NVIDIA'},{shadersEnabled:false},{cleanHud:false},{cleanToasts:undefined},{modelCatalogueSize:0},{connected:false},{playerUuid:'wrong'},{at:new Date(Date.now()-5000).toISOString()},{at:new Date(Date.now()+10000).toISOString()},{screenOpen:true},{renderer:'D3D12 (Intel UHD 770)',windowVisible:false},{renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowIconified:true}])assert.throws(()=>validateNativeCamera({...state(),...change}),/NOT_READY/);
 assert.equal(validateNativeCamera({...state(),renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowIconified:false,windowPosition:[2600,40],expectedWindowPosition:[2600,40]}).connected,true);
 assert.throws(()=>validateNativeCamera({...state(),renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowPosition:[896,336],expectedWindowPosition:[2600,40]}),/NOT_READY/);
});
test('web pose is converted to actual Minecraft camera coordinates and angles without moving the body',()=>{
 const pose=nativeCameraPose(job,state(),1000);assert.equal(pose.y,65.62);assert.equal(pose.yaw,0);assert.equal(pose.pitch,0.25*180/Math.PI);assert.equal(pose.expiresAt,4000);
 assert.equal(nativeCameraPose({...job,mode:'top',y:84,pitch:-Math.PI/2},state()).pitch,90);
 for(const change of [{x:100},{pitch:NaN},{entityId:1.5},{owner:'wrong'},{mode:'free'}])assert.throws(()=>nativeCameraPose({...job,...change},state()));
});
test('native handshake uses only the existing read-only screenshot method and expires its render lease',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'native-photo-'));let timer;
 try{
  await mkdir(path.join(root,'diagnostics'));await mkdir(path.join(root,'agent-mc-bridge'));
  const file=path.join(root,'diagnostics/qiandeng-native-camera.json'),pose=path.join(root,'agent-mc-bridge/camera-pose.json');await writeFile(file,JSON.stringify(state()));
  await writeFile(path.join(root,'agent-mc-bridge/connection.json'),JSON.stringify({protocol:'agent-mc-java/v1',endpoint:'http://127.0.0.1:12345',token:'x'.repeat(64)}));
  let busy=false;timer=setInterval(async()=>{if(busy)return;busy=true;try{const row=JSON.parse(await readFile(pose,'utf8'));if(row.expiresAt>0)await writeFile(file,JSON.stringify({...state(),job:row.job,nonce:row.nonce,poseOwner:row.owner,renderedJob:row.job,renderedFrames:3,cameraPosition:[row.x,row.y,row.z],players:[{uuid:id,model:'test',modelLoaded:true}]}));}catch{}finally{busy=false;}},30);
  const png=Buffer.alloc(2048);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(256,16);png.writeUInt32BE(256,20);
  const renderer=createNativePhotoRenderer({gameDir:root,PNG:{sync:{read:()=>({width:256,height:256,data:Buffer.alloc(256*256*4,128)})}},fetchImpl:async(url,options)=>{
   assert.equal(url,'http://127.0.0.1:12345/v1/rpc');assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(64));const call=JSON.parse(options.body);assert.equal(call.method,'screenshot');assert.equal(call.params.expectedUuid,id);assert.equal('controllerId' in call.params,false);
   return new Response(JSON.stringify({mime:'image/png',base64:png.toString('base64'),state:{uuid:id,server:'127.0.0.1:29090'}}));
  }});
  const result=await renderer.capture(job,{guard:()=>{},signal:AbortSignal.timeout(3000)});assert.equal(result.png.length,2048);assert.equal(result.image.width,256);assert.equal(JSON.parse(await readFile(pose,'utf8')).expiresAt,0);
 }finally{clearInterval(timer);await new Promise(resolve=>setTimeout(resolve,60));await rm(root,{recursive:true,force:true});}
});

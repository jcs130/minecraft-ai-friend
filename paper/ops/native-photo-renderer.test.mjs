import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {validateNativeCamera,nativeCameraPose,createNativePhotoRenderer,replaceNativePhotoFile} from './native-photo-renderer.mjs';
const id='bdab127e-4ef3-4380-adca-a6f1430223d5';
const state=()=>({schema:'qiandeng-native-camera/v1',instanceId:id,playerUuid:id,at:new Date().toISOString(),connected:true,renderer:'Intel(R) UHD Graphics 770',server:'127.0.0.1:29090',shadersEnabled:true,cleanHud:true,cleanToasts:true,modelCatalogueSize:4});
const job={job:id,nonce:id,owner:id,entityId:12,mode:'first',x:0,y:64,z:0,yaw:Math.PI,pitch:-0.25,anchorX:0,anchorY:64,anchorZ:0};

test('a transient reader lock can release before atomic pose replacement, while real storage failures remain failures',async()=>{
 let attempts=0;await replaceNativePhotoFile('temporary','target',async(a,b)=>{assert.equal(a,'temporary');assert.equal(b,'target');if(++attempts<3)throw Object.assign(new Error('busy'),{code:'EPERM'});});assert.equal(attempts,3);
 attempts=0;await assert.rejects(replaceNativePhotoFile('temporary','target',async()=>{attempts++;throw Object.assign(new Error('full'),{code:'ENOSPC'});}),{code:'ENOSPC'});assert.equal(attempts,1);
 attempts=0;await assert.rejects(replaceNativePhotoFile('temporary','target',async()=>{attempts++;throw Object.assign(new Error('locked'),{code:'EACCES'});}),{code:'EACCES'});assert.equal(attempts,6);
});
test('readiness requires fresh Intel rendering, shaders, a loaded model catalogue and connection identity',()=>{
 assert.equal(validateNativeCamera(state()).connected,true);
 for(const change of [{renderer:'NVIDIA'},{shadersEnabled:false},{cleanHud:false},{cleanToasts:undefined},{modelCatalogueSize:0},{connected:false},{playerUuid:'wrong'},{at:new Date(Date.now()-5000).toISOString()},{at:new Date(Date.now()+10000).toISOString()},{screenOpen:true},{renderer:'D3D12 (Intel UHD 770)',windowVisible:false},{renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowIconified:true}])assert.throws(()=>validateNativeCamera({...state(),...change}),/NOT_READY/);
 assert.equal(validateNativeCamera({...state(),renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowIconified:false,windowPosition:[2600,40],expectedWindowPosition:[2600,40]}).connected,true);
 assert.throws(()=>validateNativeCamera({...state(),renderer:'D3D12 (Intel UHD 770)',windowVisible:true,windowPosition:[896,336],expectedWindowPosition:[2600,40]}),/NOT_READY/);
});
test('explicit non-shader policy preserves readiness guards and rejects unexpected shader activation',()=>{
 const actual={...state(),shadersEnabled:false};
 assert.equal(validateNativeCamera(actual,Date.now(),false).connected,true);
 for(const change of [{shadersEnabled:true},{shadersEnabled:undefined},{cleanHud:false},{cleanToasts:false},{screenOpen:true},{renderer:'NVIDIA'},{modelCatalogueSize:0},{connected:false},{at:new Date(Date.now()-5000).toISOString()}])assert.throws(()=>validateNativeCamera({...actual,...change},Date.now(),false),/NOT_READY/);
 for(const setting of [null,'false',0])assert.throws(()=>validateNativeCamera(actual,Date.now(),setting),/CONFIGURATION_INVALID/);
});
test('RTX opt-in verifies the exact native adapter without weakening the default Intel policy',()=>{
 const actual={...state(),renderer:'NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2',vendor:'NVIDIA Corporation',expectedGpu:'rtx3080ti'};
 assert.throws(()=>validateNativeCamera(actual),/NOT_READY/);
 assert.equal(validateNativeCamera(actual,Date.now(),true,'rtx3080ti'),actual);
 for(const change of [{renderer:'NVIDIA RTX PRO 5000 72GB Blackwell/PCIe/SSE2'},{renderer:'D3D12 (NVIDIA GeForce RTX 3080 Ti)'},{vendor:'Microsoft Corporation'},{expectedGpu:undefined},{shadersEnabled:false},{cleanHud:false},{connected:false},{modelCatalogueSize:0}])assert.throws(()=>validateNativeCamera({...actual,...change},Date.now(),true,'rtx3080ti'),/NOT_READY/);
 assert.throws(()=>validateNativeCamera(actual,Date.now(),true,'nvidia'),/CONFIGURATION_INVALID/);
});
test('web pose is converted to actual Minecraft camera coordinates and angles without moving the body',()=>{
 const pose=nativeCameraPose(job,state(),1000);assert.equal(pose.y,65.62);assert.equal(pose.yaw,0);assert.equal(pose.pitch,0.25*180/Math.PI);assert.equal(pose.expiresAt,4000);
 assert.equal(nativeCameraPose({...job,mode:'top',y:84,pitch:-Math.PI/2},state()).pitch,90);
 for(const change of [{x:100},{pitch:NaN},{entityId:1.5},{owner:'wrong'},{mode:'free'}])assert.throws(()=>nativeCameraPose({...job,...change},state()));
});
for(const scenario of [{shaders:true},{shaders:false},{shaders:false,scene:true},{shaders:false,scene:'failed'},{shaders:true,gpu:'rtx3080ti',scene:true}])test(`native handshake (${JSON.stringify(scenario)}) keeps photograph delivery independent of scene storage and expires its render lease`,async()=>{
 const shadersEnabled=scenario.shaders;
 const cameraState=()=>({...state(),shadersEnabled,...(scenario.gpu?{renderer:'NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2',vendor:'NVIDIA Corporation',expectedGpu:scenario.gpu}:{})});
 const root=await mkdtemp(path.join(os.tmpdir(),'native-photo-'));let timer;
 try{
  await mkdir(path.join(root,'diagnostics'));await mkdir(path.join(root,'agent-mc-bridge'));
  const file=path.join(root,'diagnostics/qiandeng-native-camera.json'),pose=path.join(root,'agent-mc-bridge/camera-pose.json');await writeFile(file,JSON.stringify(cameraState()));
  await writeFile(path.join(root,'agent-mc-bridge/connection.json'),JSON.stringify({protocol:'agent-mc-java/v1',endpoint:'http://127.0.0.1:12345',token:'x'.repeat(64)}));
  let busy=false;timer=setInterval(async()=>{if(busy)return;busy=true;try{const row=JSON.parse(await readFile(pose,'utf8'));if(row.expiresAt>0)await writeFile(file,JSON.stringify({...cameraState(),job:row.job,nonce:row.nonce,poseOwner:row.owner,renderedJob:row.job,renderedFrames:3,cameraPosition:[row.x,row.y,row.z],players:[{uuid:id,model:'test',modelLoaded:true}]}));}catch{}finally{busy=false;}},30);
  const png=Buffer.alloc(2048);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(256,16);png.writeUInt32BE(256,20);
  const renderer=createNativePhotoRenderer({gameDir:root,shadersEnabled,expectedGpu:scenario.gpu??'intel',...(scenario.scene?{sceneDirectory:path.join(root,'scenes'),sceneRadius:0}:{}),PNG:{sync:{read:()=>({width:256,height:256,data:Buffer.alloc(256*256*4,128)})}},fetchImpl:async(url,options)=>{
   assert.equal(url,'http://127.0.0.1:12345/v1/rpc');assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(64));const call=JSON.parse(options.body);assert.equal(call.params.expectedUuid,id);assert.equal('controllerId' in call.params,false);
   if(call.method!=='screenshot'){
    assert.ok(scenario.scene&&['visual_frame','visual_registry','visual_chunk'].includes(call.method));if(scenario.scene==='failed')return new Response(JSON.stringify({error:{code:'UNAVAILABLE'}}));
    const base={protocol:'agent-mc-visual/v1',minecraftVersion:'1.21.1',uuid:id,server:'127.0.0.1:29090',epoch:id,sampledAt:Date.now()},zero=Buffer.alloc(2048).toString('base64');
    const value=call.method==='visual_frame'?{...base,source:'same_java_client_world',self:{id:12,uuid:id,name:'minecraft:player',position:[0,64,0]},entities:[],dimension:'minecraft:overworld',columns:[{x:0,z:0,revision:1}]}:call.method==='visual_registry'?{...base,registry:{blocks:[{id:0,name:'minecraft:air',properties:{}}],biomes:[{id:0,name:'minecraft:plains'}]}}:{...base,x:0,z:0,revision:1,minY:0,height:16,sections:'AA==',skyLight:[zero],blockLight:[zero]};
    return new Response(JSON.stringify(value));
   }
   return new Response(JSON.stringify({mime:'image/png',base64:png.toString('base64'),state:{uuid:id,server:'127.0.0.1:29090'}}));
  }});
  const result=await renderer.capture({...job,world:id},{guard:()=>{},signal:AbortSignal.timeout(3000)});assert.equal(result.png.length,2048);assert.equal(result.image.width,256);assert.equal(result.diagnostics.shadersEnabled,shadersEnabled);assert.equal(JSON.parse(await readFile(pose,'utf8')).expiresAt,0);assert.equal(result.diagnostics.poseLeaseReleased,true);
  if(scenario.scene){assert.equal(result.diagnostics.scene.state,scenario.scene===true?'captured':'unavailable');assert.ok(!JSON.stringify(result.diagnostics.scene).includes('nonce'));if(scenario.scene===true)assert.ok((await readFile(path.join(root,'scenes',id+'.mcscene.gz'))).length>0);}
 }finally{clearInterval(timer);await new Promise(resolve=>setTimeout(resolve,60));await rm(root,{recursive:true,force:true});}
});

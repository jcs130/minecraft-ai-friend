import {readFile,writeFile,rename,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';import {createHash} from 'node:crypto';
import {photoImageQuality} from './photo-image-quality.mjs';
import {captureNativeScene,storeSceneArchive} from './photo-scene-archive.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function json(file,maximum){if((await stat(file)).size>maximum)throw Error('PHOTO_NATIVE_STATE_INVALID');return JSON.parse(await readFile(file,'utf8'));}
export async function replaceNativePhotoFile(temporary,target,renameFile=rename){
  for(let attempt=0;;attempt++){
    try{await renameFile(temporary,target);return;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===5)throw error;await sleep(20);}
  }
}
export function validateNativeCamera(state,now=Date.now(),shadersEnabled=true,expectedGpu='intel'){
  if(typeof shadersEnabled!=='boolean'||!['intel','rtx3080ti'].includes(expectedGpu))throw Error('PHOTO_NATIVE_CONFIGURATION_INVALID');
  const renderer=String(state?.renderer??'').toLowerCase();
  const gpuMatches=expectedGpu==='intel'?renderer.includes('intel'):state?.vendor==='NVIDIA Corporation'&&/^nvidia geforce rtx 3080 ti(?:\/.*)?$/.test(renderer)&&state.expectedGpu===expectedGpu;
  const at=Date.parse(state?.at??'');
  if(state?.schema!=='qiandeng-native-camera/v1'||!UUID.test(state.instanceId??'')||!UUID.test(state.playerUuid??'')||!state.connected||!Number.isFinite(at)||now-at>2000||at>now+1000
    ||!gpuMatches||state.shadersEnabled!==shadersEnabled||state.cleanHud!==true||state.cleanToasts!==true||!(state.modelCatalogueSize>0)||typeof state.server!=='string'||!state.server||state.screenOpen===true
    ||String(state.renderer).toLowerCase().includes('d3d12')&&(state.windowVisible!==true||state.windowIconified===true||!Array.isArray(state.windowPosition)||!Array.isArray(state.expectedWindowPosition)||state.windowPosition.length!==2||state.expectedWindowPosition.length!==2||state.windowPosition.some((value,index)=>value!==state.expectedWindowPosition[index])))throw Error('PHOTO_NATIVE_NOT_READY');
  return state;
}
export function nativeCameraPose(job,state,now=Date.now()){
  if(!['job','nonce','owner'].every(key=>UUID.test(job[key]??''))||!Number.isSafeInteger(job.entityId)||!['first','third','top'].includes(job.mode)
    ||!['x','y','z','yaw','pitch','anchorX','anchorY','anchorZ'].every(key=>Number.isFinite(job[key])))throw Error('PHOTO_NATIVE_POSE_INVALID');
  const pose={job:job.job,nonce:job.nonce,owner:job.owner,entityId:job.entityId,instanceId:state.instanceId,mode:job.mode,
    x:job.x,y:job.y+1.62,z:job.z,yaw:180-job.yaw*180/Math.PI,pitch:-job.pitch*180/Math.PI,
    anchorX:job.anchorX,anchorY:job.anchorY,anchorZ:job.anchorZ,expiresAt:now+3000};
  if(Math.hypot(pose.x-pose.anchorX,pose.y-pose.anchorY,pose.z-pose.anchorZ)>24||Math.abs(pose.pitch)>90)throw Error('PHOTO_NATIVE_POSE_INVALID');
  return pose;
}
export function createNativePhotoRenderer({gameDir,PNG,shadersEnabled=true,expectedGpu='intel',fetchImpl=fetch,sceneDirectory=null,sceneRadius=3,sceneAppearances}){
  if(!path.isAbsolute(gameDir)||!PNG?.sync?.read||typeof shadersEnabled!=='boolean'||!['intel','rtx3080ti'].includes(expectedGpu))throw Error('PHOTO_NATIVE_CONFIGURATION_INVALID');
  if(sceneDirectory!==null&&(!path.isAbsolute(sceneDirectory)||!Number.isInteger(sceneRadius)||sceneRadius<0||sceneRadius>4))throw Error('PHOTO_NATIVE_CONFIGURATION_INVALID');
  const diagnostics=path.join(gameDir,'diagnostics/qiandeng-native-camera.json'),poseFile=path.join(gameDir,'agent-mc-bridge/camera-pose.json');
  const probe=async()=>validateNativeCamera(await json(diagnostics,64*1024),Date.now(),shadersEnabled,expectedGpu);
  async function writePose(pose){const temporary=poseFile+'.writing';await writeFile(temporary,JSON.stringify(pose));await replaceNativePhotoFile(temporary,poseFile);}
  async function rpc(state){
    const connection=await json(path.join(gameDir,'agent-mc-bridge/connection.json'),8192),url=new URL(connection.endpoint);
    if(connection.protocol!=='agent-mc-java/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||typeof connection.token!=='string'||connection.token.length<32)throw Error('PHOTO_NATIVE_BRIDGE_INVALID');
    return {url:url.origin+'/v1/rpc',body:{protocol:connection.protocol,method:'screenshot',params:{expectedUuid:state.playerUuid,expectedServer:state.server}},token:connection.token};
  }
  return {probe,async capture(job,{guard,signal}){
    guard();const original=await probe(),started=Date.now();let installed=false,diagnostics;
    try{
      let nextRenew=0,ready;
      while(!ready){
        signal.throwIfAborted();guard();const now=Date.now();
        if(now-started>20000)throw Error('PHOTO_NATIVE_RENDER_TIMEOUT');
        if(now>=nextRenew){await writePose(nativeCameraPose(job,original,now));installed=true;nextRenew=now+750;}
        const state=await probe();if(state.instanceId!==original.instanceId)throw Error('PHOTO_NATIVE_INSTANCE_CHANGED');
        const owner=state.players?.find(row=>row.uuid?.toLowerCase()===job.owner.toLowerCase());
        if(state.job===job.job&&state.nonce===job.nonce&&state.poseOwner===job.owner&&state.renderedJob===job.job&&state.renderedFrames>=2&&Date.parse(state.at)>started
          &&owner&&(!owner.model||owner.modelLoaded)&&Array.isArray(state.cameraPosition)&&Math.hypot(state.cameraPosition[0]-job.x,state.cameraPosition[1]-(job.y+1.62),state.cameraPosition[2]-job.z)<0.02)ready=state;
        if(!ready)await sleep(100,undefined,{signal});
      }
      const request=await rpc(ready);guard();
      const response=await fetchImpl(request.url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{Authorization:'Bearer '+request.token,'Content-Type':'application/json'},body:JSON.stringify(request.body)});
      if(!response.ok)throw Error('PHOTO_NATIVE_CAPTURE_FAILED');
      let encoded='',bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>24*1024*1024)throw Error('PHOTO_IMAGE_SIZE_INVALID');encoded+=Buffer.from(chunk).toString('utf8');}
      const envelope=JSON.parse(encoded);const shot=envelope.result??envelope;
      if(shot.mime!=='image/png'||typeof shot.base64!=='string'||shot.state?.uuid!==ready.playerUuid||shot.state?.server!==ready.server||shot.state?.controllerId)throw Error('PHOTO_NATIVE_CAPTURE_IDENTITY_CHANGED');
      if(shot.state?.screen)throw Error('PHOTO_NATIVE_GUI_VISIBLE');
      const png=Buffer.from(shot.base64,'base64');if(png.length<1024||png.length>8*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PHOTO_IMAGE_SIZE_INVALID');
      const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(width<256||height<256||width>4096||height>4096)throw Error('PHOTO_IMAGE_SIZE_INVALID');
      const pixels=PNG.sync.read(png,{checkCRC:true});const image={...photoImageQuality(pixels),sha256:createHash('sha256').update(png).digest('hex')};guard();
      let scene=null;
      if(sceneDirectory){
        const sceneRead=async(method,params)=>{
          if(!['visual_frame','visual_registry','visual_chunk'].includes(method))throw Error('PHOTO_SCENE_METHOD');
          const response=await fetchImpl(request.url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{Authorization:'Bearer '+request.token,'Content-Type':'application/json'},body:JSON.stringify({protocol:request.body.protocol,method,params:{...request.body.params,...params}})});
          if(!response.ok)throw Error('PHOTO_SCENE_OBSERVATION_UNAVAILABLE');
          let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024)throw Error('PHOTO_SCENE_OBSERVATION_LIMIT');parts.push(chunk);}
          const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(value.error)throw Error('PHOTO_SCENE_OBSERVATION_UNAVAILABLE');return value.result??value;
        };
        try{
          const result=await captureNativeScene({rpc:sceneRead,identity:{uuid:ready.playerUuid,server:ready.server},job,image:{...image,width,height},cameraState:ready,radius:sceneRadius,guard,signal,
            renew:async()=>{if(Date.now()>=nextRenew){const current=await probe();if(current.instanceId!==original.instanceId||current.job!==job.job||current.nonce!==job.nonce)throw Error('PHOTO_NATIVE_INSTANCE_CHANGED');await writePose(nativeCameraPose(job,original));nextRenew=Date.now()+750;}},appearances:sceneAppearances});
          scene=await storeSceneArchive(sceneDirectory,result);
        }catch(error){
          signal.throwIfAborted();guard();if(error.message==='PHOTO_NATIVE_INSTANCE_CHANGED')throw error;
          scene={schema:'mc-photo-scene/v1',id:job.job,owner:job.owner,sourceImageSha256:image.sha256,state:'unavailable',reason:/^PHOTO_(?:SCENE|NATIVE)_[A-Z_]+$/.test(error.message)?error.message:'PHOTO_SCENE_SAVE_FAILED'};
          // A failed companion archive must not discard a finished photograph.
          const file=path.join(sceneDirectory,job.job+'.unavailable.json');try{await mkdir(sceneDirectory,{recursive:true});await writeFile(file,JSON.stringify(scene),{flag:'wx',mode:0o600});}catch{scene.failureReceiptSaved=false;}
        }
      }
      diagnostics={renderer:ready.renderer,shadersEnabled:ready.shadersEnabled,modelCatalogueSize:ready.modelCatalogueSize,width,height,nativeInstance:ready.instanceId,scene};return {png,image,diagnostics};
    }finally{
      if(installed){let released=false;for(let attempt=0;attempt<6&&!released;attempt++){
        try{const current=await json(poseFile,4096);if(current.job===job.job&&current.nonce===job.nonce&&current.instanceId===original.instanceId)await writePose({...current,expiresAt:0});released=true;}
        catch(error){if(!['EPERM','EACCES','EBUSY','ENOENT'].includes(error.code)&&!(error instanceof SyntaxError))break;if(attempt<5)await sleep(20);}
      }if(diagnostics)diagnostics.poseLeaseReleased=released;}
    }
  }};
}

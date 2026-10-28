import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';import {createHash} from 'node:crypto';
import {photoImageQuality} from './photo-image-quality.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function json(file,maximum){if((await stat(file)).size>maximum)throw Error('PHOTO_NATIVE_STATE_INVALID');return JSON.parse(await readFile(file,'utf8'));}
export function validateNativeCamera(state,now=Date.now()){
  const at=Date.parse(state?.at??'');
  if(state?.schema!=='qiandeng-native-camera/v1'||!UUID.test(state.instanceId??'')||!UUID.test(state.playerUuid??'')||!state.connected||!Number.isFinite(at)||now-at>2000||at>now+1000
    ||!String(state.renderer).toLowerCase().includes('intel')||state.shadersEnabled!==true||!(state.modelCatalogueSize>0)||typeof state.server!=='string'||!state.server)throw Error('PHOTO_NATIVE_NOT_READY');
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
export function createNativePhotoRenderer({gameDir,PNG,fetchImpl=fetch}){
  if(!path.isAbsolute(gameDir)||!PNG?.sync?.read)throw Error('PHOTO_NATIVE_CONFIGURATION_INVALID');
  const diagnostics=path.join(gameDir,'diagnostics/qiandeng-native-camera.json'),poseFile=path.join(gameDir,'agent-mc-bridge/camera-pose.json');
  const probe=async()=>validateNativeCamera(await json(diagnostics,64*1024));
  async function writePose(pose){const temporary=poseFile+'.writing';await writeFile(temporary,JSON.stringify(pose));await rename(temporary,poseFile);}
  async function rpc(state){
    const connection=await json(path.join(gameDir,'agent-mc-bridge/connection.json'),8192),url=new URL(connection.endpoint);
    if(connection.protocol!=='agent-mc-java/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||typeof connection.token!=='string'||connection.token.length<32)throw Error('PHOTO_NATIVE_BRIDGE_INVALID');
    return {url:url.origin+'/v1/rpc',body:{protocol:connection.protocol,method:'screenshot',params:{expectedUuid:state.playerUuid,expectedServer:state.server}},token:connection.token};
  }
  return {probe,async capture(job,{guard,signal}){
    guard();const original=await probe(),started=Date.now();let installed=false;
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
      const png=Buffer.from(shot.base64,'base64');if(png.length<1024||png.length>8*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PHOTO_IMAGE_SIZE_INVALID');
      const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(width<256||height<256||width>4096||height>4096)throw Error('PHOTO_IMAGE_SIZE_INVALID');
      const pixels=PNG.sync.read(png,{checkCRC:true});const image={...photoImageQuality(pixels),sha256:createHash('sha256').update(png).digest('hex')};guard();
      return {png,image,diagnostics:{renderer:ready.renderer,shadersEnabled:true,modelCatalogueSize:ready.modelCatalogueSize,width,height,nativeInstance:ready.instanceId}};
    }finally{
      if(installed)try{const current=await json(poseFile,4096);if(current.job===job.job&&current.nonce===job.nonce&&current.instanceId===original.instanceId)await writePose({...current,expiresAt:0});}catch{}
    }
  }};
}

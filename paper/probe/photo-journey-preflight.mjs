// Read-only diagnostics for an existing ISOLATED native camera. No RPC, command,
// account registration, camera launch or runtime configuration changes.
import {readFile} from 'node:fs/promises';import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateNativeCamera} from '../ops/native-photo-renderer.mjs';
export async function photoJourneyPreflight(gameDir,{shadersEnabled=false}={}) {
  const result={scope:'read-only native camera files; not a screenshot or game delivery',ready:false,blockers:[]};
  if(!gameDir||!path.isAbsolute(gameDir)){result.blockers.push('No explicit absolute isolated native game directory supplied');return result;}
  try {
    const state=JSON.parse(await readFile(path.join(gameDir,'diagnostics/qiandeng-native-camera.json'),'utf8'));
    validateNativeCamera(state,Date.now(),shadersEnabled);
    if(!/^127\.0\.0\.1:\d+$/.test(state.server))throw Error('ISOLATED_LOOPBACK_SERVER_REQUIRED');
    result.camera={renderer:state.renderer,modelCatalogueSize:state.modelCatalogueSize,shadersEnabled:state.shadersEnabled,ageMs:Date.now()-Date.parse(state.at)};
  }catch(error){result.blockers.push(error.code??(/^PHOTO_[A-Z_]+$|^ISOLATED_LOOPBACK_SERVER_REQUIRED$/.test(error.message)?error.message:'NATIVE_STATE_INVALID'));}
  try {
    const connection=JSON.parse(await readFile(path.join(gameDir,'agent-mc-bridge/connection.json'),'utf8'));
    const endpoint=new URL(connection.endpoint);
    if(connection.protocol!=='agent-mc-java/v1'||endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'
       ||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['','/'].includes(endpoint.pathname)
       ||typeof connection.token!=='string'||connection.token.length<32)throw Error('NATIVE_BRIDGE_FILE_INVALID');
    result.bridgeFileValid=true; // Neither endpoint credentials nor token are returned.
  }catch(error){result.blockers.push(error.code??'NATIVE_BRIDGE_FILE_INVALID');}
  result.ready=result.blockers.length===0;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await photoJourneyPreflight(process.argv[2],{shadersEnabled:process.argv.includes('--shaders-on')});
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ready?0:2;
}

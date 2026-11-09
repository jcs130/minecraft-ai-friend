import fs from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';

/** Coturn TURN REST short-lived credentials. The shared secret remains only in
 * the operator's private files, never in HTTP, SDP, browser files or logs. */
export function createTurnCredentials({secret,urls,scope,now=Date.now(),ttlSeconds=3600}){
  if(typeof secret!=='string'||secret.length<32||typeof scope!=='string'||!scope
    ||ttlSeconds<300||ttlSeconds>3600||!Number.isInteger(ttlSeconds)
    ||!Array.isArray(urls)||urls.length<1||urls.length>2
    ||urls.some(u=>typeof u!=='string'||!/^turn:[a-z0-9.-]+:[0-9]{1,5}\?transport=(udp|tcp)$/i.test(u)))throw Error('TURN_CONFIGURATION');
  // Five-minute buckets prevent repeated capabilities reads minting arbitrarily
  // many per-user quota identities. Scope is opaque, not the player's username.
  const expiresAt=(Math.floor(now/300000)*300+ttlSeconds);
  const opaque=createHmac('sha256',secret).update(scope).digest('hex').slice(0,24);
  const username=expiresAt+':'+opaque;
  return {iceServers:[{urls:[...urls],username,credential:createHmac('sha1',secret).update(username).digest('base64')}],
    iceTransportPolicy:'relay',expiresAt:expiresAt*1000};
}
export async function loadPlayRtcRuntime(configPath,{Peer,now=Date.now}={}){
  if(!configPath)return null;
  if(!isAbsolute(configPath))throw Error('RTC_OPERATOR_CONFIG_PATH');
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  if(config.mode!=='turn'){
    const {loadWebRtcRuntime}=await import('./webrtc-runtime.mjs');
    return loadWebRtcRuntime(configPath,{RTCPeerConnection:Peer});
  }
  if(config.schemaVersion!==1||!isAbsolute(config.secretFile??'')||isIP(config.bindAddress??'')!==4)throw Error('TURN_CONFIGURATION');
  const secret=(await fs.readFile(config.secretFile,'utf8')).trim();
  const credentials=scope=>createTurnCredentials({secret,urls:config.urls,scope,now:now()});
  credentials('startup-validation');
  const Connection=Peer??(await import('werift')).RTCPeerConnection;
  return {requiresOwner:true,browserConfiguration:scope=>credentials('browser:'+scope),
    createPeerConnection:scope=>new Connection({iceServers:credentials('gateway:'+scope).iceServers,iceTransportPolicy:'relay',
      iceUseIpv4:true,iceUseIpv6:false,iceInterfaceAddresses:{udp4:config.bindAddress}})};
}

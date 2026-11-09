import {createPlayRtcSession,PlayReceiptBook} from './play-rtc.mjs';
import {isIP} from 'node:net';

/** Injected into createToyServer AFTER its original cookie/origin/CSRF checks.
 * Runtime is operator configured. No client-supplied bind IP, URL or game UUID. */
export function createPlayRtcGateway({runtime,rate=()=>{}}={}){
  const peers=new Map(),books=new WeakMap();let lastCloseReason=null;
  const book=play=>{if(!books.has(play))books.set(play,new PlayReceiptBook());return books.get(play)};
  const valid=(row,play,owner,connection)=>!row.busy&&!row.expired&&row.play===play&&!play.closed&&play.authorized
    &&row.portal.owner?.id===owner&&play.ownerId===owner&&play.connectionId===connection&&play.identityMatches();
  const fail=(reason)=>Object.assign(Error(reason),{reason,status:409});
  async function offer(row,clientId,description){
    if(!runtime)throw fail('RTC_DISABLED');
    const play=row.play,owner=row.portal.owner?.id,connection=play?.connectionId;
    if(!play||!owner||!valid(row,play,owner,connection)||!play.status().sceneAvailable)throw fail('OWN_PLAY_REQUIRED');
    if(!/^[A-Za-z0-9_-]{8,80}$/.test(clientId??''))throw fail('CLIENT_ID_REQUIRED');
    if(description?.type!=='offer'||typeof description.sdp!=='string'||Buffer.byteLength(description.sdp)>16384
      ||!/^v=0\r?\n/.test(description.sdp)||(description.sdp.match(/^m=/gm)??[]).length!==1
      ||!/^m=application /m.test(description.sdp))throw fail('INVALID_RTC_OFFER');
    if(peers.has(row)||play.bridge?.snapshot().active)throw fail('CONTROL_TRANSPORT_BUSY');
    if(peers.size>=16)throw fail('RTC_CAPACITY');
    const peer=runtime.createPeerConnection(owner+':'+row.id);
    const binding={peer,clientId,session:null};peers.set(row,binding);
    const session=createPlayRtcSession({peer,clientId,receipts:book(play),
      authorize:()=>valid(row,play,owner,connection),rate:()=>{rate(row,'control',40);row.touchedAt=Date.now()},
      execute:(packet,id,receipt)=>play.control(packet,id,receipt),
      stop:()=>{const c=play.controllers.get(clientId);if(c){c.emit('disconnect');play.controllers.delete(clientId)}},
      onClose:reason=>{lastCloseReason=reason;if(peers.get(row)===binding)peers.delete(row)},
      openWorld:async signal=>{
        const url=new URL('events',play.host.url);
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||isIP(url.hostname)!==4)throw Error('WORLD_SOURCE_SCOPE');
        const response=await fetch(url,{headers:{Origin:url.origin},redirect:'error',signal});
        if(!response.ok||!response.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('WORLD_UNAVAILABLE');
        return response.body;
      }});
    binding.session=session;
    peer.onDataChannel.subscribe(c=>session.attach(c));
    peer.connectionStateChange.subscribe(s=>{if(['closed','failed','disconnected'].includes(s))session.close('PEER_DISCONNECTED')});
    try{
      await peer.setRemoteDescription(description);await peer.setLocalDescription(await peer.createAnswer());
      if(!valid(row,play,owner,connection)||session.status().closed)throw fail('AUTH_REVOKED');
      return {schemaVersion:1,answer:{type:peer.localDescription.type,sdp:peer.localDescription.sdp},readOnly:false};
    }catch(e){session.close('NEGOTIATION_FAILED');throw e}
  }
  return {offer,query(row,clientId,requestId){
    if(!row.play||!row.portal.owner?.id||!valid(row,row.play,row.portal.owner.id,row.play.connectionId))throw fail('OWN_PLAY_REQUIRED');
    if(!/^[A-Za-z0-9_-]{8,80}$/.test(clientId??''))throw fail('CLIENT_ID_REQUIRED');
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId??''))throw fail('INVALID_REQUEST_ID');
    return book(row.play).get(clientId,requestId);
  },assertHttp(row){if(peers.has(row))throw fail('RTC_CONTROL_ACTIVE')},
  capabilities(row){
    if(runtime?.requiresOwner){
      const play=row?.play,owner=row?.portal?.owner?.id;
      if(!play||!owner||!valid(row,play,owner,play.connectionId))throw fail('OWN_PLAY_REQUIRED');
      return {enabled:true,...runtime.browserConfiguration(owner+':'+row.id)};
    }
    return {enabled:!!runtime,iceServers:(runtime?.iceServers??[]).map(s=>({urls:s.urls}))};
  },
  close(){for(const p of [...peers.values()])p.session.close('GATEWAY_CLOSED')},status:()=>({enabled:!!runtime,peers:peers.size,lastCloseReason})};
}

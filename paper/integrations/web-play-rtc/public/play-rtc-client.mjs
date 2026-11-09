/** WebRTC carries only an explicitly acquired owner's inputs. HTTP fallback is
 * selected before sending an action; an uncertain action is NEVER replayed. */
import {createNativeRtcDecoder} from './native-rtc-protocol.js';
export function createPlayRtcClient({offer,queryReceipt,onLost=()=>{},Peer=globalThis.RTCPeerConnection,iceServers=[],iceTransportPolicy='all',
  now=()=>performance.now(),timeoutMs=10000}={}){
  let peer=null,commands=null,input=null,ready=false,closed=false,token=null,tokenAt=0,generation=0,seq=0,ping=null,lastFailure=null;
  const pending=new Map();let lastRttMs=null,worldListener=null,worldLost=null;
  const decoder=createNativeRtcDecoder(message=>worldListener?.(message));
  function unknown(requestId,reason){return {ok:false,requestId,status:'unknown',reason,retryable:false};}
  function close(reason='TRANSPORT_CLOSED'){
    if(closed)return;closed=true;lastFailure=reason;const wasReady=ready;ready=false;clearInterval(ping);
    for(const [id,p]of pending){clearTimeout(p.timer);p.resolve(unknown(id,reason))}pending.clear();
    decoder.close();worldLost?.(reason);worldListener=worldLost=null;
    try{peer?.close()}catch{};if(wasReady)onLost(reason);
  }
  function send(m){if(!ready||commands?.readyState!=='open')return false;
    if(commands.bufferedAmount>262144){close('CONTROL_BACKPRESSURE');return false}
    try{commands.send(JSON.stringify({schemaVersion:1,...m}));return true}catch{close('CONTROL_SEND_FAILED');return false}}
  async function connect(){
    if(!Peer)return false;
    try{
      peer=new Peer({iceServers,iceTransportPolicy});commands=peer.createDataChannel('qd.play.control',{ordered:true,protocol:'qiandengji.play.v1'});
      input=peer.createDataChannel('qd.play.input',{ordered:false,maxRetransmits:0,protocol:'qiandengji.play.v1'});
      const world=peer.createDataChannel('qd.play.world',{ordered:true,protocol:'qiandengji.play.v1'});world.binaryType='arraybuffer';
      world.onmessage=e=>{try{decoder.receive(e.data)}catch{close('INVALID_WORLD_STREAM')}};
      world.onclose=()=>close('WORLD_CHANNEL_CLOSED');
      commands.onmessage=e=>{
        let m;try{m=JSON.parse(e.data)}catch{close('INVALID_REPLY');return}
        if(m.schemaVersion!==1)return;
        if(m.kind==='clock'){token=m.token;tokenAt=now();return}
        if(m.kind==='pong'){lastRttMs=now()-m.at;return}
        if(m.kind==='receipt'){const p=pending.get(m.requestId);if(p){pending.delete(m.requestId);clearTimeout(p.timer);p.resolve(m)}}
      };
      commands.onclose=()=>close();input.onclose=()=>close();commands.onerror=input.onerror=()=>close('CHANNEL_ERROR');
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise((resolve,reject)=>{if(peer.iceGatheringState==='complete')return resolve();
        const timer=setTimeout(()=>reject(Error('ICE_TIMEOUT')),5000);
        peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);resolve()}},{once:false});});
      const response=await offer({type:peer.localDescription.type,sdp:peer.localDescription.sdp});
      if(!response?.answer)throw Error('RTC_UNAVAILABLE');await peer.setRemoteDescription(response.answer);
      await new Promise((resolve,reject)=>{const started=now();const timer=setInterval(()=>{
        if(closed||now()-started>timeoutMs){clearInterval(timer);reject(Error('RTC_TIMEOUT'))}
        else if(commands.readyState==='open'&&input.readyState==='open'&&world.readyState==='open'&&token){clearInterval(timer);resolve()}
      },25)});
      ready=true;ping=setInterval(()=>send({kind:'ping',at:now()}),1000);return true;
    }catch(e){close(e.message==='RTC_TIMEOUT'?'RTC_TIMEOUT':'RTC_NEGOTIATION_FAILED');return false}
  }
  function action(packet){
    const requestId=crypto.randomUUID();
    if(!ready)return Promise.resolve({ok:false,status:'not_sent',reason:'RTC_UNAVAILABLE',requestId});
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{pending.delete(requestId);resolve(unknown(requestId,'RECEIPT_TIMEOUT'))},timeoutMs);
      pending.set(requestId,{resolve,timer});
      const accepted=send({kind:'action',requestId,sequence:++seq,generation:++generation,packet});
      if(!accepted){clearTimeout(timer);pending.delete(requestId);resolve(unknown(requestId,'TRANSPORT_CLOSED'))}
    });
  }
  function motion(packet){
    if(!ready||input?.readyState!=='open'||!token||now()-tokenAt>300||input.bufferedAmount>16384)
      return {ok:true,active:true,status:'discarded_before_send',scope:'input_only'};
    try{input.send(JSON.stringify({schemaVersion:1,kind:'motion',sequence:++seq,generation,token,epoch:packet.epoch,input:packet.input}));
      return {ok:true,active:true,epoch:packet.epoch,status:'sent',scope:'input_only'};
    }catch{close('INPUT_SEND_FAILED');return unknown(null,'INPUT_SEND_FAILED')}
  }
  return {connect,close,action,motion,query:requestId=>queryReceipt(requestId),
    subscribeWorld(listener,lost){
      if(!ready||worldListener)return null;
      worldListener=listener;worldLost=lost;send({kind:'world',subscribe:true});
      // An interrupted SSE event may be only partly decoded. Do not reuse its
      // byte stream for a fresh snapshot: terminate this peer and its controls.
      // A new viewer starts on SSE; explicit reacquisition creates a new decoder.
      return ()=>{worldListener=worldLost=null;close('WORLD_SUBSCRIPTION_ENDED')};
    },
    status:()=>({ready,closed,transport:ready?'webrtc':'http',roundTripMs:lastRttMs,pending:pending.size,lastFailure})};
}

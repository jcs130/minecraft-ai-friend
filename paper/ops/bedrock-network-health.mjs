// Local transport health, not a claim of Xbox login or phone rendering success.
// NetherNet discovery wire format follows CloudburstMC/Network ServerData and NetherNetConstants.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import {pathToFileURL} from 'node:url';
const key=crypto.createHash('sha256').update(Buffer.from('efbeadde00000000','hex')).digest();
export function seal(data){const c=crypto.createCipheriv('aes-256-ecb',key,null);return Buffer.concat([crypto.createHmac('sha256',key).update(data).digest(),c.update(data),c.final()]);}
export function unseal(packet){
  if(packet.length<48||packet.length>4096)throw Error('DISCOVERY_SIZE');
  const c=crypto.createDecipheriv('aes-256-ecb',key,null),plain=Buffer.concat([c.update(packet.subarray(32)),c.final()]);
  if(!crypto.timingSafeEqual(packet.subarray(0,32),crypto.createHmac('sha256',key).update(plain).digest()))throw Error('DISCOVERY_INTEGRITY');
  if(plain.readUInt16LE(0)!==plain.length)throw Error('DISCOVERY_LENGTH');return plain.subarray(2);
}
export function request(){const b=Buffer.alloc(20);b.writeUInt16LE(20,0);b.writeUInt16LE(0,2);crypto.randomBytes(8).copy(b,4);return seal(b);}
export function decode(packet){
  const b=unseal(packet);if(b.readUInt16LE(0)!==1)throw Error('DISCOVERY_KIND');
  const size=b.readUInt32LE(18);if(size!==b.length-22||size>2048)throw Error('SERVER_DATA_LENGTH');
  const hex=b.subarray(22).toString('ascii');if(!/^(?:[0-9a-f]{2})+$/i.test(hex))throw Error('SERVER_DATA_HEX');
  const d=Buffer.from(hex,'hex');let i=0;
  const uint=()=>{let n=0;for(let s=0;s<35;s+=7){if(i>=d.length)throw Error('VARINT_TRUNCATED');const v=d[i++];n|=(v&127)<<s;if(!(v&128))return n>>>0;}throw Error('VARINT_TOO_LONG');};
  const int=()=>{const n=uint();return(n>>>1)^-(n&1);};
  const str=()=>{const n=uint();if(n>512||i+n>d.length)throw Error('STRING_LENGTH');const s=d.subarray(i,i+n).toString('utf8');i+=n;return s;};
  const bool=()=>{if(i>=d.length||d[i]>1)throw Error('INVALID_BOOLEAN');return Boolean(d[i++]);};
  const version=d[i++];if(version!==7)return{dataVersion:version};
  const p={dataVersion:version,name:str(),protocol:int(),version:str(),level:str(),players:int(),maxPlayers:int(),gameType:int(),editor:bool(),hardcore:bool(),onlineAuth:bool(),selfSignedAuth:bool()};
  const nonce=str();p.noncePresent=nonce.length>0;p.connection=int();
  if(i!==d.length)throw Error('SERVER_DATA_TRAILING');return p;
}
export function discover(host,port=7551,{broadcast=false,timeout=2500}={}){return new Promise((resolve,reject)=>{
  const s=dgram.createSocket('udp4');let done=false;const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);s.close();e?reject(e):resolve(v);};
  const timer=setTimeout(()=>finish(Error('LAN_DISCOVERY_TIMEOUT')),timeout);
  s.on('error',e=>finish(e));s.on('message',(b,remote)=>{if(remote.port!==port||(!broadcast&&remote.address!==host))return;try{const p=decode(b);if(p.dataVersion===7)finish(null,p);}catch(e){finish(e);}});
  s.bind(0,()=>{if(broadcast)s.setBroadcast(true);s.send(request(),port,host,e=>{if(e)finish(e);});});
});}
export async function health(host='192.168.3.163',signalingPort=19132,discoveryPort=7551){
  const result={schemaVersion:1,observedAt:new Date().toISOString(),healthy:false,checks:[],errors:[],gameLoginTested:false};
  await Promise.all([
    (async()=>{try{const r=await fetch(`http://${host}:${signalingPort}/v1/join`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('SIGNALING_HTTP_'+r.status);const p=await r.json();if(!Number.isInteger(p.protocol)||p.protocol<2225||p.onlineAuth!==true||p.selfSignedAuth!==false)throw Error('SIGNALING_METADATA');result.signaling={protocol:p.protocol,version:p.version};result.checks.push('nethernet_http');}catch(e){result.errors.push({check:'nethernet_http',reason:e.message});}})(),
    (async()=>{try{const p=await discover(host,discoveryPort);if(!p.onlineAuth||p.selfSignedAuth||!p.noncePresent||p.protocol<2225)throw Error('LAN_METADATA');result.lan={name:p.name,protocol:p.protocol,dataVersion:p.dataVersion};result.checks.push('nethernet_lan_discovery');}catch(e){result.errors.push({check:'nethernet_lan_discovery',reason:e.message});}})()
  ]);result.healthy=result.errors.length===0;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await health(process.argv[2],Number(process.argv[3]||19132),Number(process.argv[4]||7551));console.log(JSON.stringify(r));process.exitCode=r.healthy?0:1;}

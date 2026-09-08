import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import http from 'node:http';
import { isIP } from 'node:net';

// Node fetch can replace Host with the destination hostname. The viewer uses
// the exact public Host even for these two fixed internal, read-only routes.
function viewerRead(url){return new Promise((resolve,reject)=>{
  const request=http.get(url,{headers:{Host:'127.0.0.1:19092'},signal:AbortSignal.timeout(10000)},response=>{
    const chunks=[];let length=0;
    response.on('data',chunk=>{length+=chunk.length;if(length>16384){response.destroy(new Error('renderer_limit'));return;}chunks.push(chunk);});
    response.on('error',reject);response.on('end',()=>{try{if(response.statusCode!==200)throw new Error('renderer_unavailable');resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}});
  });request.on('error',reject);
});}

function cookies(req) {return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));}
async function input(req) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('json_required');
  let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>4096)throw new Error('body_limit');}
  return JSON.parse(body);
}
function peerAddress(value) {
  if(typeof value!=='string')return null;
  const address=value.startsWith('::ffff:')?value.slice(7):value;
  return isIP(address)?address:null;
}
function localAccess({origins,trustedPeers}) {
  if(!Array.isArray(origins)||!origins.length)throw new Error('Local management requires a loopback public origin');
  const allowedOrigins=new Set(),allowedHosts=new Set();
  for(const value of origins){
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.origin!==value)
      throw new Error('Local management requires a loopback public origin');
    allowedOrigins.add(url.origin);allowedHosts.add(url.host);
  }
  if(!Array.isArray(trustedPeers))throw new Error('Local trusted peers must be exact IP addresses');
  const peers=new Set(trustedPeers.map(value=>{
    const address=peerAddress(value);
    if(!address||['0.0.0.0','::','255.255.255.255'].includes(address))throw new Error('Local trusted peers must be exact IP addresses');
    return address;
  }));
  return req=>{
    // Docker's loopback-only published port may have a verified gateway peer.
    // Never infer a peer from Forwarded, X-Forwarded-For or other client headers.
    const address=peerAddress(req.socket?.remoteAddress);
    const loopback=address==='::1'||(isIP(address||'')===4&&address.startsWith('127.'));
    return !!address&&(loopback||peers.has(address))&&allowedHosts.has(req.headers.host)
      &&(!req.headers.origin||allowedOrigins.has(req.headers.origin))&&req.headers['sec-fetch-site']!=='cross-site';
  };
}
export function createManagementApi({passwordHash,token,authMode='password',localOrigins=[],localTrustedPeers=[],controlUrl='http://control:3090',eyeUrl='http://world:3080',mapUrl='http://world:3060',viewerUrl='http://world:3070',clock=Date.now,transport=fetch}={}) {
  if(!['password','local'].includes(authMode))throw new Error('Unsupported management authentication mode');
  const sessions=new Map();let failures=0,blockedUntil=0;
  const configured=typeof token==='string'&&token.length>=32&&(authMode==='local'||!!passwordHash?.salt&&!!passwordHash?.hash);
  const allowedLocal=authMode==='local'?localAccess({origins:localOrigins,trustedPeers:localTrustedPeers}):null;
  const session=req=>{const id=cookies(req).qd_admin,s=sessions.get(id);if(!s||s.expiresAt<=clock()){sessions.delete(id);return null;}
    if(allowedLocal){sessions.delete(id);sessions.set(id,s);}return s;};
  const setSessionCookie=(res,id)=>res.setHeader('Set-Cookie','qd_admin='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600');
  const newSession=res=>{
    for(const [id,s] of sessions)if(s.expiresAt<=clock())sessions.delete(id);
    if(sessions.size>=20){
      if(!allowedLocal)return null;
      // Local health checks may discard cookies. Keep a bounded LRU instead of
      // exhausting sign-in capacity; normal active requests keep their session.
      sessions.delete(sessions.keys().next().value);
    }
    const id=randomBytes(32).toString('hex'),s={csrf:randomBytes(24).toString('hex'),expiresAt:clock()+3600000};sessions.set(id,s);
    setSessionCookie(res,id);
    return s;
  };
  const upstream=async(base,route,method='GET',body)=>{
    const result=await transport(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
    const raw=await result.text();if(Buffer.byteLength(raw)>1024*1024)throw new Error('upstream_limit');
    let value;try{value=JSON.parse(raw);}catch{throw new Error('upstream_unavailable');}return {status:result.status,value};
  };
  return async(req,res,url,send)=>{
    if(!url.pathname.startsWith('/api/manage/')&&!url.pathname.startsWith('/api/eye/'))return false;
    const finish=(status,value)=>{send(res,status,value);return true;};
    try {
      if(allowedLocal&&!allowedLocal(req))return finish(403,{error:'local_access_required'});
      if(req.method==='GET'&&url.pathname==='/api/manage/session') {
        let s=session(req);
        if(configured&&allowedLocal){
          if(!s)s=newSession(res);
          else if(s.expiresAt-clock()<60000){s.expiresAt=clock()+3600000;setSessionCookie(res,cookies(req).qd_admin);}
        }
        if(configured&&allowedLocal&&!s)return finish(429,{error:'session_limit'});
        return finish(200,{configured,authMode,authenticated:!!s,csrf:s?.csrf||null,expiresAt:s?.expiresAt||null});
      }
      if(!configured)return finish(503,{error:'management_not_configured'});
      if(req.method==='POST'&&url.pathname==='/api/manage/login'){
        if(allowedLocal)return finish(404,{error:'password_login_disabled'});
        if(!req.headers.origin)return finish(403,{error:'origin_required'});
        if(clock()<blockedUntil)return finish(429,{error:'login_rate_limit'});
        const value=await input(req),password=typeof value.password==='string'?value.password:'';
        if(password.length>256)return finish(400,{error:'password_length'});
        const actual=scryptSync(password,passwordHash.salt,32),expected=Buffer.from(passwordHash.hash,'hex');
        if(expected.length!==actual.length||!timingSafeEqual(actual,expected)){failures++;if(failures>=5){blockedUntil=clock()+60000;failures=0;}return finish(401,{error:'invalid_password'});}
        failures=0;const s=newSession(res);if(!s)return finish(429,{error:'session_limit'});
        return finish(200,{authenticated:true,csrf:s.csrf,expiresAt:s.expiresAt});
      }
      const readPublic=req.method==='GET'&&['/api/manage/services','/api/eye/state','/api/eye/map.png','/api/eye/compatibility','/api/eye/renderer'].includes(url.pathname);
      const s=session(req);
      if(!readPublic&&!s)return finish(401,{error:'login_required'});
      if(req.method==='POST'&&(!req.headers.origin||!s||req.headers['x-csrf-token']!==s.csrf))return finish(403,{error:'csrf_required'});
      if(req.method==='POST'&&url.pathname==='/api/manage/logout'){
        sessions.delete(cookies(req).qd_admin);res.setHeader('Set-Cookie','qd_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return finish(200,{authenticated:false});
      }
      const routes={
        'GET /api/manage/services':[controlUrl,'/services'],
        'GET /api/manage/operations':[controlUrl,'/operations'],
        'POST /api/manage/plan':[controlUrl,'/plan'],
        'POST /api/manage/execute':[controlUrl,'/execute'],
        'GET /api/eye/state':[eyeUrl,'/state'],
        'POST /api/eye/observer':[eyeUrl,'/observer'],
      };
      if(req.method==='GET'&&['/api/eye/compatibility','/api/eye/renderer'].includes(url.pathname)){
        const route=url.pathname.endsWith('renderer')?'/healthz':'/mod_assets/compatibility-summary.json';
        return finish(200,await viewerRead(viewerUrl+route));
      }
      if(req.method==='GET'&&url.pathname==='/api/manage/logs'){
        const service=url.searchParams.get('service');if(!/^(?:[a-z]{2,12}|qwenpaw-ops)$/.test(service||''))return finish(400,{error:'invalid_service'});
        const r=await upstream(controlUrl,'/logs?service='+encodeURIComponent(service));return finish(r.status,r.value);
      }
      if(req.method==='GET'&&url.pathname==='/api/eye/map.png'){
        const cx=Number(url.searchParams.get('cx')),cz=Number(url.searchParams.get('cz')),radius=Number(url.searchParams.get('r')||32);
        if(!url.searchParams.has('cx')||!url.searchParams.has('cz')||!Number.isFinite(cx)||!Number.isFinite(cz)||Math.abs(cx)>30000000||Math.abs(cz)>30000000||!Number.isInteger(radius)||radius<8||radius>64)return finish(400,{error:'invalid_map_region'});
        const result=await transport(mapUrl+'/map.png?'+new URLSearchParams({cx:String(cx),cz:String(cz),r:String(radius)}),{signal:AbortSignal.timeout(15000)});
        if(!result.ok||!result.headers.get('content-type')?.startsWith('image/png'))return finish(503,{error:'map_unavailable'});
        const bytes=Buffer.from(await result.arrayBuffer());if(bytes.length>1024*1024)throw new Error('map_limit');
        send(res,200,bytes,'image/png');return true;
      }
      const route=routes[req.method+' '+url.pathname];if(!route)return finish(404,{error:'not_found'});
      const r=await upstream(...route,req.method,req.method==='POST'?await input(req):undefined);return finish(r.status,r.value);
    }catch{return finish(503,{error:'management_request_unavailable'});}
  };
}

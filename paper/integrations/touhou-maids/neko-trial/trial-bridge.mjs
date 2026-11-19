import fs from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const folder = path.dirname(process.argv[2]);
const config = JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const { createMaidApi } = await import(pathToFileURL(config.apiSource));
const inner = await createMaidApi(config.backend);
const route = '/api/v1/maid-body';
const digest = s => createHash('sha256').update(s).digest();
const credentials = Buffer.from(config.grantHash, 'hex');
const marker = config.handoff;
let session, lastLeaseWrite = 0, shuttingDown = false;
function report(kind, details={}) {
  return fs.appendFile(path.join(folder,'connection-events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...details})+'\n','utf8');
}
async function mark() {
  const tmp=marker+'.'+randomUUID()+'.tmp';
  const data={bodyId:config.maidId,ownerId:config.ownerId,until:Math.min(Date.now()+132000,config.until)/1000};
  try {
    await fs.writeFile(tmp,JSON.stringify(data),{flag:'wx'});
    await fs.rename(tmp,marker);
    lastLeaseWrite=Date.now();
  } finally {await fs.rm(tmp,{force:true});}
}
async function clearMark() {
  lastLeaseWrite=0;
  await fs.rm(marker,{force:true});
}
async function ready() {
  try {
    const stat=await fs.stat(config.health);
    if(Date.now()-stat.mtimeMs>15000)return false;
    const h=JSON.parse((await fs.readFile(config.health,'utf8')).replace(/^\uFEFF/,''));
    const role=h.roles.find(x=>x.bodyId===config.maidId);
    return !h.pausing && role?.controlMode==='available_for_external_controller' && !role.running && !role.unknownRequests;
  } catch {return false;}
}
async function forward(json, auth) {
  return new Promise((resolve,reject)=>{
    const bytes=Buffer.from(JSON.stringify(json));
    const req=http.request({host:'127.0.0.1',port:config.backend.port,path:route,method:'POST',timeout:9000,
      headers:{authorization:auth,'content-type':'application/json','content-length':bytes.length}},response=>{
      let body='',size=0;response.setEncoding('utf8');
      response.on('data',part=>{size+=Buffer.byteLength(part); if(size<=2*1024*1024)body+=part;else response.destroy(new Error('BODY_LIMIT'));});
      response.on('error',reject);response.on('end',()=>{try{resolve({code:response.statusCode,value:JSON.parse(body)});}catch{reject(new Error('UNKNOWN'));}});
    });
    req.on('timeout',()=>req.destroy(new Error('UNKNOWN')));
    req.on('error',reject);req.end(bytes);
  });
}
async function readBody(req) {
  let length=0;const parts=[];
  for await(const part of req){length+=part.length;if(length>16384)throw Error('TOO_LARGE');parts.push(part);}
  const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID');
  return value;
}
function send(res, status, value) {
  if(res.destroyed||res.headersSent)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
const failure=(res,status,error)=>send(res,status,{protocol:'qiandengji-maid-body/v1',error,retryAllowed:false});
const tls=https.createServer({key:await fs.readFile(config.tlsKey),cert:await fs.readFile(config.cert),minVersion:'TLSv1.2',
  headersTimeout:5000,requestTimeout:15000,connectionsCheckingInterval:1000,maxHeaderSize:8192},async(req,res)=>{
  let input;
  try {
    const remote=req.socket.remoteAddress || '';
    if (!/^192\.168\.3\.\d{1,3}$/.test(remote))return failure(res,403,'LAN_ONLY');
    if(shuttingDown||Date.now()>=config.until)return failure(res,410,'TRIAL_EXPIRED');
    if(req.method!=='POST'||![route,'/api/v1/maid-session'].includes(req.url))return failure(res,404,'NOT_FOUND');
    const auth=req.headers.authorization || '';
    const match=/^Bearer ([a-zA-Z0-9_-]{32,128})$/.exec(auth);
    if(!match)return failure(res,401,'UNAUTHORIZED');
    if(!timingSafeEqual(digest(match[1]),credentials)){
      if(!/^mdw_[A-Za-z0-9_-]{43}$/.test(match[1]))return failure(res,401,'UNAUTHORIZED');
      const proof=await forward({operation:'identity'},auth);
      if(proof.code!==200)return send(res,proof.code,proof.value);
      if(proof.value.maidId!==config.maidId||proof.value.ownerId!==config.ownerId)return failure(res,403,'BODY_SCOPE_MISMATCH');
    }
    try {input=await readBody(req);}catch(e){return failure(res,e.message==='TOO_LARGE'?413:400,'INVALID_JSON');}
    if((input.maidId&&input.maidId!==config.maidId)||(input.ownerId&&input.ownerId!==config.ownerId))return failure(res,403,'BODY_SCOPE_MISMATCH');
    if(req.url==='/api/v1/maid-session'){
      if(!['prepare','status'].includes(input.operation))return failure(res,400,'UNKNOWN_OPERATION');
      if(input.operation==='prepare'){
        await mark();await report('preparing');
      }
      return send(res,200,{bodyId:config.maidId,phase:session?'external_connected':await ready()?'ready_for_bind':Date.now()-lastLeaseWrite<132000?'draining':'server_hosted',expiresAt:new Date(config.until).toISOString()});
    }
    if(input.operation==='bind'&&!session&&!await ready()){
      if(!lastLeaseWrite||Date.now()-lastLeaseWrite>45000)await mark();
      const deadline=Date.now()+28000;
      while(Date.now()<deadline&&!await ready())await wait(220);
      if(!await ready())return failure(res,409,'ORIGINAL_HOST_DRAINING');
    }
    const dest=await forward(input,auth);
    if(dest.code===200&&input.operation==='bind'){
      await mark();
      const next={controller:input.controllerId,generation:dest.value.generation};
      if(!session||session.generation!==next.generation)await report('bound',{bodyId:config.maidId});
      session=next;
    } else if(dest.code===200&&session?.controller===input.controllerId&&session?.generation===input.generation){
      if(input.operation==='release'){session=null;await clearMark();await report('released');}
      else if(input.operation==='call' && Date.now()-lastLeaseWrite>3000)await mark();
    }
    send(res,dest.code,dest.value);
  } catch {
    failure(res,502,input?.operation==='call'?'RESULT_UNKNOWN_LOOK_UP_ORIGINAL_ID':'LOCAL_BRIDGE_UNAVAILABLE');
  }
});
tls.maxConnections=20;
await new Promise((ok,fail)=>{inner.server.once('error',fail);inner.server.listen(config.backend.port,'127.0.0.1',ok);});
await new Promise((ok,fail)=>{tls.once('error',fail);tls.listen(config.port,config.address,ok);});
await report('listening',{address:config.address,port:config.port,bodyId:config.maidId});
async function shutdown(){
  if(shuttingDown)return;
  shuttingDown=true;clearInterval(timer);
  await new Promise(ok=>tls.close(ok));
  await inner.close();
  if(session)await report('closed_and_lease_released');
  session=null;await clearMark();await report('stopped');
}
const timer=setInterval(async()=>{
  if(Date.now()>=config.until || await fs.stat(path.join(folder,'stop')).then(()=>true,()=>false)) await shutdown();
  else if(session&&Date.now()-lastLeaseWrite>132000){session=null;await report('desktop_disconnected');}
},1500);
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());

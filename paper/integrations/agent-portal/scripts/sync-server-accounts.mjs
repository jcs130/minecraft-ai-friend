import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {seal,unseal} from '../src/game-accounts.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function key(file){const value=(await fs.readFile(file,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(value))throw Error('INVALID_SERVER_ACCOUNT_KEY');return Buffer.from(value,'hex');}
function validate(settings){
 if(!/^[a-z][a-z0-9_-]{1,39}$/.test(settings.serverId||'')||settings.serverId==='qiandengji'||!path.isAbsolute(settings.bridgeDirectory))throw Error('INVALID_SERVER_ACCOUNT_TARGET');
 const u=new URL(settings.endpoint);if(u.pathname!==`/api/v1/internal/servers/${settings.serverId}/accounts/poll`||u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('INVALID_SERVER_ACCOUNT_ENDPOINT');return u;
}
export async function syncServerAccountsOnce(settings,state={watch:[]},fetcher=fetch){
 const endpoint=validate(settings),local=await key(settings.localKeyFile),remote=await key(settings.remoteKeyFile),token=(await fs.readFile(settings.tokenFile,'utf8')).trim();
 if(!/^acc_[A-Za-z0-9_-]{43}$/.test(token))throw Error('INVALID_SERVER_ACCOUNT_TOKEN');
 const label='server:'+settings.serverId+':';let ready=false;
 try{const h=unseal(local,label+'heartbeat',await fs.readFile(path.join(settings.bridgeDirectory,'heartbeat.json'),'utf8'));ready=h.serverId===settings.serverId&&h.ready===true&&Math.abs(Date.now()-h.at)<5000;}catch{}
 const results=[],delivered=[];
 for(const id of state.watch.filter(id=>uuid.test(id)).slice(0,64)){
  try{const r=unseal(local,label+'request:'+id,await fs.readFile(path.join(settings.bridgeDirectory,'requests',id+'.json'),'utf8'));if(r.serverId!==settings.serverId||r.requestId!==id)throw Error('SERVER_ACCOUNT_LOCAL_SCOPE');delivered.push(id);}catch(e){if(e.code!=='ENOENT')throw e;}
  try{
   const raw=unseal(local,label+'result:'+id,await fs.readFile(path.join(settings.bridgeDirectory,'results',id+'.json'),'utf8'));if(raw.serverId!==settings.serverId||raw.requestId!==id)throw Error('SERVER_ACCOUNT_LOCAL_SCOPE');
   // The native bridge retains claim-code hashes locally. Only a fixed receipt crosses HTTPS.
   const value={};for(const field of ['schemaVersion','serverId','requestId','username','playerUuid','state','reason','message','expiresAt'])if(raw[field]!==undefined)value[field]=raw[field];
   results.push({id,envelope:seal(remote,label+'result:'+id,value)});if(!delivered.includes(id))delivered.push(id);if(results.length>=8)break;
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({heartbeat:{serverId:settings.serverId,ready,at:Date.now()},results,delivered}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Object.assign(Error('SERVER_ACCOUNT_SYNC_REJECTED'),{status:response.status});
 const text=await response.text();if(Buffer.byteLength(text)>256*1024)throw Error('SERVER_ACCOUNT_RESPONSE_SIZE');const value=JSON.parse(text);
 if(value.serverId!==settings.serverId||!Array.isArray(value.requests)||value.requests.length>4||!Array.isArray(value.watch)||value.watch.length>64||value.watch.some(id=>!uuid.test(id))||!Array.isArray(value.acknowledged))throw Error('SERVER_ACCOUNT_RESPONSE_SCOPE');
 state.watch=[...new Set([...state.watch,...value.watch,...value.requests.map(r=>r.id)])].filter(id=>uuid.test(id)).slice(-64);
 if(settings.stateFile){const tmp=settings.stateFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(state),{mode:0o600});await fs.rename(tmp,settings.stateFile);}
 let dispatched=0;
 if(ready)for(const item of value.requests){
  if(!uuid.test(item.id||'')||typeof item.envelope!=='string')throw Error('SERVER_ACCOUNT_REQUEST_INVALID');
  const request=unseal(remote,label+'request:'+item.id,item.envelope);
  if(request.serverId!==settings.serverId||request.requestId!==item.id)throw Error('SERVER_ACCOUNT_REQUEST_SCOPE');
  const destination=path.join(settings.bridgeDirectory,'requests',item.id+'.json');
  let resultExists=false;try{await fs.access(path.join(settings.bridgeDirectory,'results',item.id+'.json'));resultExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(resultExists||request.expiresAt<Date.now())continue;
  await fs.mkdir(path.dirname(destination),{recursive:true});const temporary=destination+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,seal(local,label+'request:'+item.id,request),{flag:'wx',mode:0o600});
  try{try{await fs.link(temporary,destination);dispatched++;}catch(e){if(e.code!=='EEXIST')throw e;}}finally{await fs.unlink(temporary);}
 }
 state.watch=state.watch.filter(id=>!value.acknowledged.includes(id)||value.watch.includes(id));
 return {serverId:settings.serverId,ready,delivered:dispatched,reported:results.length};
}
async function main(){
 const ix=process.argv.indexOf('--config');if(ix<0||!path.isAbsolute(process.argv[ix+1]||''))throw Error('ABSOLUTE_PRIVATE_CONFIG_REQUIRED');
 const file=process.argv[ix+1],settings=JSON.parse(await fs.readFile(file,'utf8'));validate(settings);
 settings.stateFile||=path.join(path.dirname(file),'state.json');const lockFile=path.join(path.dirname(file),'sync.lock');let lock;
 try{lock=await fs.open(lockFile,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await fs.readFile(lockFile,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('SERVER_ACCOUNT_LOCK_UNKNOWN');try{process.kill(pid,0);throw Error('SERVER_ACCOUNT_WORKER_RUNNING');}catch(reason){if(reason.code!=='ESRCH')throw reason;}await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx');}
 await lock.writeFile(String(process.pid));let stopping=false,state={watch:[]},previous;
 try{const saved=JSON.parse(await fs.readFile(settings.stateFile,'utf8'));if(Array.isArray(saved.watch))state.watch=saved.watch.filter(id=>uuid.test(id)).slice(-64);}catch{}
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
 try{do{
  let message;try{const result=await syncServerAccountsOnce(settings,state);message=result.ready?'服务器账号桥已连接。':'等待原生账号桥；未派发新建或改密。';}catch{message='服务器账号同步暂未确认；保留原请求，不重复执行。';}
  if(message!==previous){console.log(settings.serverId+'：'+message);previous=message;}
  if(process.argv.includes('--once'))break;await new Promise(r=>setTimeout(r,Math.min(10000,Math.max(3000,settings.intervalMs||5000))));
 }while(!stopping);}finally{await lock.close();await fs.unlink(lockFile).catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();

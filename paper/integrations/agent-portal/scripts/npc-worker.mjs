import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { npcProfile, npcCatalogue } from '../src/npc-admin.mjs';
async function replace(file,value){const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}

export function residentReply(text) {
  const prefix='MC_RESIDENT ',at=text.indexOf(prefix);
  if(at<0)throw Error('NPC_RECEIPT_UNAVAILABLE');
  return JSON.parse(text.slice(at+prefix.length).trim());
}
export class NpcWorker {
  constructor(settings,{command,fetcher=fetch}={}){this.settings=settings;this.command=command;this.fetcher=fetcher;}
  async initialize(){
    if(!path.isAbsolute(this.settings.rconModule||'')||!path.isAbsolute(this.settings.journalDirectory||''))throw Error('NPC_ABSOLUTE_PATH_REQUIRED');
    const endpoint=new URL(this.settings.endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('NPC_HTTPS_REQUIRED');
    this.origin=endpoint.origin;
    this.command??=(await import(pathToFileURL(this.settings.rconModule).href)).command;
    await fs.mkdir(this.settings.journalDirectory,{recursive:true});return this;
  }
  async process(job){
    if(!/^[a-f0-9-]{36}$/.test(job.id)||!/^[a-f0-9-]{36}$/.test(job.requestId)||!Number.isSafeInteger(job.revision)||job.revision<0)throw Error('NPC_REQUEST_INVALID');
    const profile=npcProfile(job.profile),file=path.join(this.settings.journalDirectory,job.requestId+'.json');
    const identity=JSON.stringify({id:job.id,requestId:job.requestId,revision:job.revision,profile});
    let prior;try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior&&prior.identity!==identity)throw Error('NPC_REQUEST_CONFLICT');
    const unknown=reason=>({requestId:job.requestId,id:job.id,status:'unknown',completed:false,reason});
    if(prior?.result&&['applied','failed'].includes(prior.result.status))return prior.result;
    const reconcile=job.reconcileOnly||!!prior;
    if(!prior){prior={identity,dispatchedAt:Date.now()};await fs.writeFile(file,JSON.stringify(prior),{flag:'wx',mode:0o600});}
    let result;
    try{result=residentReply(await this.command(reconcile?`maidagent resident-admin receipt ${job.id} ${job.requestId}`:
      `maidagent resident-admin apply ${job.id} ${job.requestId} ${job.revision} ${JSON.stringify(profile)}`,8000));}
    catch{result=unknown('transport_unknown_query_original_request');}
    if(result.requestId!==job.requestId||result.id!==job.id)result=unknown('receipt_identity_mismatch');
    prior.result=result;await replace(file,prior);return result;
  }
  async poll(){
    const catalogue=npcCatalogue(residentReply(await this.command('maidagent resident-admin list',8000)));
    const results=[];
    for(const name of await fs.readdir(this.settings.journalDirectory))if(/^[a-f0-9-]{36}\.json$/.test(name)){
      const row=JSON.parse(await fs.readFile(path.join(this.settings.journalDirectory,name),'utf8'));
      if(row.result&&!row.acknowledged)results.push(row.result);if(results.length>=8)break;
    }
    const token=(await fs.readFile(this.settings.tokenFile,'utf8')).trim();if(!/^srv_[A-Za-z0-9_-]{43}$/.test(token))throw Error('NPC_TOKEN_INVALID');
    const response=await this.fetcher(this.origin+'/api/v1/internal/npcs/poll',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({catalogue,results}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('NPC_SYNC_'+response.status);
    const data=await response.json();if(!Array.isArray(data.requests)||data.requests.length>1||!Array.isArray(data.acknowledged))throw Error('NPC_SYNC_INVALID');
    for(const id of data.acknowledged)if(results.some(r=>r.requestId===id)){
      const file=path.join(this.settings.journalDirectory,id+'.json'),row=JSON.parse(await fs.readFile(file,'utf8'));row.acknowledged=true;await replace(file,row);
    }
    for(const job of data.requests){await this.process(job);const file=path.join(this.settings.journalDirectory,job.requestId+'.json'),row=JSON.parse(await fs.readFile(file,'utf8'));row.acknowledged=false;await replace(file,row);}
  }
}

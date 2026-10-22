import {existsSync,readFileSync} from 'node:fs';
import {readSecret} from '../../scripts/private.mjs';

export const PORTAL_TOOL={name:'mc_portal',tags:['read'],
  description:'Read this account\'s website-authorized role, saved state/profile, or public game-auth capabilities. Uses a private role-bound portal Token. Does not log in a game body, change ownership, grant a skill or modify the world. Saved website state is not a fresh game observation.',
  parameters:{type:'object',properties:{action:{type:'string',enum:['status','agents','state','profile','capabilities']}},required:['action'],additionalProperties:false}};
export function validPortal(text) {
  let url;try{url=new URL(text);}catch{throw Error('invalid_portal_url');}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'
    ||(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('portal_requires_https_or_explicit_loopback');
  return url.origin;
}
export function createPortalClient(configFile,username,transport=fetch) {
  async function config(){
    if(!configFile||!existsSync(configFile))return null;
    const input=JSON.parse(readFileSync(configFile,'utf8'));
    if(input.username!==username)throw Error('portal_game_account_mismatch');
    return {...input,baseUrl:validPortal(input.baseUrl)};
  }
  async function request(current,path,authenticated=true,signal) {
    let secret;
    try {
      const headers={Accept:'application/json'};
      if(authenticated){
        if(!current?.tokenFile)throw Error('portal_token_not_configured');
        secret=readSecret(current.tokenFile,current.tokenFormat,'portal');headers.Authorization='Bearer '+secret.toString('utf8');
      }
      const response=await transport(current.baseUrl+path,{headers,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
      if(response.status>=300 && response.status<400)throw Error('portal_redirect_refused');
      if(!response.ok)throw Error(`portal_http_${response.status}`);
      const chunks=[];let size=0;
      if(response.body){for await(const chunk of response.body){size+=chunk.length;if(size>1048576)throw Error('portal_response_too_large');chunks.push(Buffer.from(chunk));}}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_portal_response');
      return value;
    } finally {secret?.fill(0);}
  }
  return {async read(args,{signal}={}) {
    if(!args||typeof args!=='object'||Object.keys(args).some(k=>k!=='action')||!PORTAL_TOOL.parameters.properties.action.enum.includes(args.action))throw Error('invalid_portal_action');
    const current=await config();
    if(args.action==='status')return {configured:!!current,tokenConfigured:!!current?.tokenFile,portal:current?.baseUrl??null,username,gameLoginAuthorized:false,readOnly:true};
    if(!current)throw Error('portal_not_configured');
    if(args.action==='capabilities')return {source:'portal_capabilities',receivedAt:new Date().toISOString(),gameLoginAuthorized:false,data:await request(current,'/api/v1/game-capabilities',false,signal)};
    const roles=await request(current,'/api/v1/agents',true,signal);
    if(!Array.isArray(roles.agents))throw Error('invalid_portal_agents');
    const matching=roles.agents.filter(a=>a?.name===username && typeof a.id==='string'&&/^[a-f0-9]{24}$/.test(a.id));
    if(matching.length!==1)throw Error('portal_role_not_uniquely_bound_to_game_account');
    const agent=matching[0];
    const data=args.action==='agents'?{agents:matching}:await request(current,`/api/v1/agents/${agent.id}/${args.action}`,true,signal);
    return {source:'portal_saved_data',receivedAt:new Date().toISOString(),agentId:agent.id,playerUuid:agent.playerUuid,username,gameLoginAuthorized:false,readOnly:true,data};
  }};
}

import { agentOnboarding } from './agent-onboarding.mjs';
import { agentSkill } from './agent-skill.mjs';
const fail=(status,reason,message)=>Object.assign(Error(message),{status,reason});
const machine=req=>{if(req.headers.origin||req.headers.cookie)throw fail(403,'AGENT_CLIENT_REQUIRED','程序接入请使用 Bearer 凭据，不附带浏览器 Cookie 或 Origin。');};
export async function networkRoute({req,res,pathname,url,network,agentAccess,browserAuth,jsonBody,respond,rate}){
 if(req.method==='GET'&&pathname==='/api/v1/servers'){respond(res,200,await network.servers());return true;}
 if(req.method==='GET'&&pathname==='/api/v1/network/roles'){
  const {owner}=browserAuth(req);const primary=(await network.game.roster()).filter(row=>network.membership(owner,'qiandengji',row.playerUuid)).map(row=>({serverId:'qiandengji',roleId:network.catalog.roleId('qiandengji',row.playerUuid),username:row.name,playerUuid:row.playerUuid,progressScope:'qiandengji'}));
  respond(res,200,{roles:[...primary,...network.members(owner)]});return true;
 }
 if(req.method==='GET'&&pathname==='/api/v1/network/jobs'){const {owner}=browserAuth(req);respond(res,200,{jobs:network.store.db.prepare('SELECT id FROM network_flows WHERE owner_id=? ORDER BY created_at DESC LIMIT 20').all(owner.id).map(r=>network.flow(owner,r.id))});return true;}
 const recovery=/^\/api\/v1\/network\/jobs\/([a-f0-9-]{36})\/recover$/.exec(pathname);
 if(recovery&&req.method==='POST'){const {owner}=browserAuth(req,false,true);rate('network-recovery:'+owner.id,6,60000);respond(res,202,await network.recover(owner,recovery[1],(await jsonBody(req)).requestId));return true;}
 const job=/^\/api\/v1\/network\/jobs\/([a-f0-9-]{36})$/.exec(pathname);
 if(job&&req.method==='GET'){respond(res,200,network.flow(browserAuth(req).owner,job[1]));return true;}
 const bridge=/^\/api\/v1\/internal\/servers\/([a-z][a-z0-9_-]{1,39})\/accounts\/poll$/.exec(pathname);
 if(bridge&&req.method==='POST'){machine(req);network.authorizeWorker(bridge[1],req);rate('network-bridge:'+bridge[1],30,60000);respond(res,200,await network.poll(bridge[1],await jsonBody(req,512*1024)));return true;}
 const scoped=/^\/api\/v1\/servers\/([a-z][a-z0-9_-]{1,39})\/(capabilities|agent-invites|join|password|claim)$/.exec(pathname);
 if(scoped){
  const id=scoped[1],action=scoped[2];network.catalog.get(id);
  if(action==='capabilities'&&req.method==='GET'){respond(res,200,await network.capabilities(id));return true;}
  if(req.method!=='POST')return false;
  const {owner}=browserAuth(req,false,true),body=await jsonBody(req);rate('network-owner:'+owner.id,20,60000);
  if(action==='agent-invites'){
   const invite=agentAccess.issue(owner,{...body,serverId:id}),server=network.catalog.public(id),capability=await network.capabilities(id);
   respond(res,201,{...invite,onboarding:agentOnboarding({origin:req.portalOrigin.origin,invite,skill:agentSkill,gameAddress:server.addresses.mineflayer,gameReady:capability.ready,server})});return true;
  }
  respond(res,202,await network.begin(owner,id,{...body,...(action==='claim'?{operation:'claim'}:{})},{kind:action==='password'?'password':'join'}));return true;
 }
 const agent=/^\/api\/v1\/agent-access\/servers\/([a-z][a-z0-9_-]{1,39})\/(status|activate|state|jobs)(?:\/([a-f0-9-]{36}))?$/.exec(pathname);
 if(agent){
  machine(req);const context=agentAccess.authorize(req),id=agent[1],action=agent[2];network.catalog.get(id);
  if(action==='status'&&req.method==='GET'){respond(res,200,await network.agentStatus(context,id));return true;}
  if(action==='state'&&req.method==='GET'){respond(res,200,await network.agentState(context,id));return true;}
  if(action==='activate'&&req.method==='POST'){
   const body=await jsonBody(req);respond(res,202,await network.begin(context.owner,id,{...body,username:context.client.name},{client:context.client}));return true;
  }
  if(action==='jobs'&&agent[3]&&req.method==='GET'){
   const row=network.store.db.prepare('SELECT player_uuid,name,target_server FROM network_flows WHERE id=? AND owner_id=?').get(agent[3],context.owner.id);
   if(!row||row.player_uuid!==context.client.expected_uuid||row.name!==context.client.name||row.target_server!==id)throw fail(404,'NETWORK_REQUEST_NOT_FOUND','此 API 身份没有对应的原请求。');
   respond(res,200,network.flow(context.owner,agent[3]));return true;
  }
 }
 return false;
}

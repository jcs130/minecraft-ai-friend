import fs from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { seal, unseal, offlineUuid } from './game-accounts.mjs';
import { digest } from './store.mjs';
import { DEFAULT_SERVER, ServerCatalog } from './server-catalog.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=(status,reason,message)=>Object.assign(Error(message),{status,reason});
const same=(a,b)=>timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
const publicJob=r=>({id:r.id,serverId:r.server_id,operation:r.operation,username:r.name,state:r.state,...JSON.parse(r.result||'{}')});
/** Shared website identity and credentials, independent world membership and native authorities.
 * Reads never dispatch work. Only explicit writes and signed bridge delivery advance a flow.
 * A durable child ID is selected before submission; unknown children are queried, never recreated. */
export class NetworkAccounts{
 constructor(config,store,legacy,game){
  Object.assign(this,{config,store,legacy,game});this.catalog=new ServerCatalog(config);this.advancing=new Map();
  store.db.exec(`CREATE TABLE IF NOT EXISTS network_memberships(server_id TEXT NOT NULL,player_uuid TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES owners(id),name TEXT NOT NULL,normalized TEXT NOT NULL,credential_version INTEGER NOT NULL,proof TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(server_id,player_uuid),UNIQUE(server_id,normalized));
   CREATE TABLE IF NOT EXISTS network_credentials(owner_id TEXT NOT NULL REFERENCES owners(id),player_uuid TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,envelope TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_id,player_uuid));
   CREATE TABLE IF NOT EXISTS network_flows(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),player_uuid TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,target_server TEXT NOT NULL,state TEXT NOT NULL,steps TEXT NOT NULL,secret TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS network_recoveries(id TEXT PRIMARY KEY,flow_id TEXT NOT NULL,previous_step TEXT NOT NULL,new_step TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS network_flow_errors(id TEXT PRIMARY KEY,reason TEXT NOT NULL,message TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS network_flows_owner ON network_flows(owner_id,created_at);
   CREATE TABLE IF NOT EXISTS network_jobs(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES owners(id),operation TEXT NOT NULL,name TEXT NOT NULL,expected_uuid TEXT NOT NULL,state TEXT NOT NULL,result TEXT NOT NULL,request TEXT NOT NULL,reply TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,dispatched_at INTEGER,delivered_at INTEGER);
   CREATE INDEX IF NOT EXISTS network_jobs_server ON network_jobs(server_id,state,created_at);
   CREATE TABLE IF NOT EXISTS network_heartbeats(server_id TEXT PRIMARY KEY,ready INTEGER NOT NULL,received_at INTEGER NOT NULL);`);
 }
 async key(serverId=null){
  const file=serverId?this.catalog.get(serverId).accountBridge?.keyFile:this.config.networkAccounts?.keyFile;
  if(!file)throw fail(503,'NETWORK_CREDENTIALS_NOT_CONFIGURED','统一账号服务还在准备；原游戏登录仍可使用。');
  const value=(await fs.readFile(file,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(value))throw Error('INVALID_NETWORK_BRIDGE_KEY');return Buffer.from(value,'hex');
 }
 async capabilities(id){
  const server=this.catalog.get(id);
  if(id===DEFAULT_SERVER){const base=await this.legacy.capabilities(),ready=base.ready&&base.verify===true;return {...base,ready,create:ready,claim:ready,gamePassword:ready,serverId:id,unifiedPassword:ready,...(!ready?{reason:'NETWORK_BRIDGE_UPGRADE_PENDING',message:'统一账号等待原生登录桥更新；原千灯纪登录和单服账号功能保持可用。'}:{})};}
  const heartbeat=this.store.db.prepare('SELECT * FROM network_heartbeats WHERE server_id=?').get(id);
  const ready=server.accountBridge?.enabled===true&&heartbeat?.ready===1&&Date.now()-heartbeat.received_at<20000;
  return {serverId:id,ready,create:ready,claim:ready,gamePassword:ready,unifiedPassword:true,source:ready?server.loginAuthority:null,
   ...(!ready?{reason:'WORLD_ACCOUNT_BRIDGE_PENDING',message:'这个世界的账号桥尚未就绪；可先保存接入身份，稍后查询，暂不连接游戏。'}:{})};
 }
 async servers(){return {servers:await Promise.all(this.catalog.list().map(async row=>({...row,accounts:await this.capabilities(row.id)}))),defaultServerId:DEFAULT_SERVER};}
 checkName(name){if(this.store.db.prepare('SELECT 1 FROM archived_test_roles WHERE lower(name)=?').get(String(name).toLowerCase()))throw fail(403,'RETIRED_TEST_ACCOUNT','该历史测试角色已归档，请选择新的角色名。');if(typeof name!=='string'||!/^ag_[A-Za-z0-9_]{1,13}$/.test(name)||/eye$/i.test(name)||/^ag_(goddess|player|live|corti|corticam)$/i.test(name))throw fail(403,'NETWORK_ROLE_RESERVED','仅普通 ag_ 角色可使用跨服账号；管理员与 Eye 保留原接入。');}
 membership(owner,id,uuid){
  this.catalog.get(id);
  if(id===DEFAULT_SERVER)return this.store.db.prepare('SELECT agent_uuid AS player_uuid,owner_id FROM ownerships WHERE agent_uuid=? AND owner_id=?').get(uuid,owner.id)||null;
  return this.store.db.prepare('SELECT * FROM network_memberships WHERE server_id=? AND player_uuid=? AND owner_id=?').get(id,uuid,owner.id)||null;
 }
 members(owner){
  const rows=this.store.db.prepare('SELECT * FROM network_memberships WHERE owner_id=? ORDER BY server_id,name').all(owner.id);
  return rows.map(r=>({serverId:r.server_id,roleId:this.catalog.roleId(r.server_id,r.player_uuid),username:r.name,playerUuid:r.player_uuid,credentialVersion:r.credential_version,progressScope:r.server_id}));
 }
 credential(owner,uuid){return this.store.db.prepare('SELECT * FROM network_credentials WHERE owner_id=? AND player_uuid=?').get(owner.id,uuid);}
 async activeSecret(owner,uuid){const row=this.credential(owner,uuid);return row?unseal(await this.key(),'shared-credential:'+owner.id+':'+uuid,row.envelope):null;}
 assertOwnedIdentity(owner,name,uuid){
  this.checkName(name);
  const canonical=this.store.db.prepare('SELECT owner_id,name,player_uuid FROM network_memberships WHERE normalized=? LIMIT 1').get(name.toLowerCase());
  if(canonical&&canonical.owner_id!==owner.id)throw fail(409,'NETWORK_ROLE_OWNED','此角色已有网站主人，请使用自己的角色。');
  if(canonical&&(canonical.name!==name||canonical.player_uuid!==uuid))throw fail(409,'CANONICAL_ROLE_NAME_REQUIRED','这个角色名已有归属或固定大小写，请沿用已绑定角色的准确名称。');
  const reservation=this.store.db.prepare("SELECT owner_id,name,player_uuid FROM network_flows WHERE lower(name)=? AND state IN ('pending','unknown') LIMIT 1").get(name.toLowerCase());
  if(reservation&&(reservation.owner_id!==owner.id||reservation.name!==name||reservation.player_uuid!==uuid))throw fail(409,'NETWORK_ROLE_RESERVED','此名称已有原接入请求，请查询原请求或使用自己的新角色名。');
  const primary=this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(uuid);
  const foreign=this.store.db.prepare('SELECT owner_id FROM network_memberships WHERE player_uuid=? AND owner_id<>? LIMIT 1').get(uuid,owner.id);
  if(primary&&primary.owner_id!==owner.id||foreign)throw fail(409,'NETWORK_ROLE_OWNED','此角色已有网站主人，请使用自己的角色或先核验归属。');
  const client=this.store.db.prepare('SELECT owner_id FROM agent_clients WHERE normalized=? AND revoked_at IS NULL').get(name.toLowerCase());
  if(client&&client.owner_id!==owner.id)throw fail(409,'NETWORK_ROLE_OWNED','这个角色名已保留给其他网站主人。');
 }
 flow(owner,id){
  const row=this.store.db.prepare('SELECT * FROM network_flows WHERE id=? AND owner_id=?').get(id,owner.id);
  if(!row)throw fail(404,'NETWORK_REQUEST_NOT_FOUND','未找到属于你的跨服请求。');
  const issue=this.store.db.prepare('SELECT reason,message FROM network_flow_errors WHERE id=?').get(id);
  const steps=JSON.parse(row.steps).map(step=>{const job=step.serverId===DEFAULT_SERVER?this.store.db.prepare('SELECT id,state,result FROM account_jobs WHERE id=? AND owner_id=?').get(step.id,owner.id):this.store.db.prepare('SELECT id,state,result,delivered_at FROM network_jobs WHERE id=? AND owner_id=? AND server_id=?').get(step.id,owner.id,step.serverId);return {id:step.id,serverId:step.serverId,operation:step.operation,state:job?.state||'not_dispatched',...(job?this.publicResult(JSON.parse(job.result||'{}'),step.operation,step.serverId,job):{}),...(step.nextCommand&&job?.delivered_at?{nextCommand:step.nextCommand}:{})};});
  const failed=steps.find(step=>step.state==='failed');
  const recoverable=row.state==='failed'&&!!failed&&['PASSWORD_BLOCKED','PASSWORD_BUSY','SERVICE_UNAVAILABLE','REQUEST_EXPIRED','ACCOUNT_REQUEST_EXPIRED','VERIFY_BRIDGE_PENDING'].includes(failed.reason || issue?.reason);
  return {recoverable,id:row.id,serverId:row.target_server,username:row.name,playerUuid:row.player_uuid,kind:row.kind,state:row.state,steps,...(issue?{error:issue}:{}),
   synchronized:row.state==='succeeded',nextAction:row.state==='succeeded'?'connect_game':['failed','unknown'].includes(row.state)?'review_original_request':'query_status',
   message:row.state==='succeeded'?'账号已核实，统一密码已同步；各服背包、等级和任务独立保存。':row.state==='failed'?'接入未全部完成，请核对各服原因；已确认的步骤不会重复执行。':row.state==='unknown'?'有原操作结果未确认，保留原请求并等待核对；不重新建号或重复改密。':'等待各服实际回执；尚不能把请求提交当成入服或同步完成。'};
 }
 publicResult(result,operation,serverId,job){
  const out={};for(const key of ['state','reason','message','username','playerUuid','expiresAt'])if(result[key]!==undefined)out[key]=result[key];
  if(operation==='claim'){
   const delivered=serverId===DEFAULT_SERVER?!this.legacy.remote||!!this.store.db.prepare('SELECT delivered_at FROM account_outbox WHERE id=?').get(job.id)?.delivered_at:!!job.delivered_at;
   if(delivered&&result.nextCommand)out.nextCommand=result.nextCommand;
  }
  return out;
 }
 async begin(owner,serverId,body,{kind='join',client=null}={}){
  const server=this.catalog.get(serverId),name=body.username,uuid=offlineUuid(name||'');this.assertOwnedIdentity(owner,name,uuid);if(client&&(client.name!==name||client.expected_uuid!==uuid))throw fail(403,'AGENT_SCOPE_REQUIRED','只能操作本 API 身份绑定的角色。');
  if(server.state==='closed')throw fail(409,'WORLD_CLOSED','这个世界暂未开放。请从世界目录选择其他世界。');
  if(!UUID.test(body.requestId||''))throw fail(400,'REQUEST_ID_REQUIRED','先保存 requestId；超时后查询原请求，不换标识重建。');
  const prior=this.store.db.prepare('SELECT * FROM network_flows WHERE id=?').get(body.requestId);
  if(prior){if(prior.owner_id!==owner.id||prior.name!==name||prior.target_server!==serverId||prior.kind!==kind)throw fail(409,'REQUEST_ID_CONFLICT','此请求标识属于其他操作。');return this.flow(owner,prior.id);}
  const busy=this.store.db.prepare("SELECT id FROM network_flows WHERE owner_id=? AND player_uuid=? AND state IN ('pending','unknown')").get(owner.id,uuid);
  if(busy)throw fail(409,'SHARED_PASSWORD_SYNC_PENDING',`原请求 ${busy.id} 尚未确认，请先查询，暂不发起另一次加入或改密。`);
  const partial=this.store.db.prepare("SELECT id,steps FROM network_flows WHERE owner_id=? AND player_uuid=? AND state='failed' ORDER BY created_at DESC").all(owner.id,uuid).find(row=>JSON.parse(row.steps).some(step=>step.operation==='password'&&this.store.db.prepare(step.serverId===DEFAULT_SERVER?'SELECT state FROM account_jobs WHERE id=?':'SELECT state FROM network_jobs WHERE id=?').get(step.id)?.state==='succeeded'));
  if(partial)throw fail(409,'SHARED_PASSWORD_REPAIR_REQUIRED',`原请求 ${partial.id} 已有部分世界改密成功，请在原请求恢复同步，不发起新的改密。`);
  const legacyPending=this.store.db.prepare("SELECT id FROM account_jobs WHERE lower(name)=? AND operation IN ('create','password') AND state IN ('pending','unknown') LIMIT 1").get(name.toLowerCase());
  if(legacyPending)throw fail(409,'ORIGINAL_ACCOUNT_JOB_PENDING',`原账号请求 ${legacyPending.id} 尚未确认，请先查询它，再加入其他世界。`);
  const pwd=kind==='password'?body.currentGamePassword:body.gamePassword,newPwd=kind==='password'?body.newGamePassword:body.newGamePassword||pwd;
  const memberships=this.members(owner).filter(r=>r.playerUuid===uuid);
  const minimum=Math.max(server.minPasswordLength,...memberships.map(m=>this.catalog.get(m.serverId).minPasswordLength));
  if(typeof newPwd!=='string'||newPwd.length<minimum||newPwd.length>64||/\s/.test(newPwd)||/^(123456|password|qwerty|12345678)$/i.test(newPwd))throw fail(400,'INVALID_GAME_PASSWORD',`该角色统一密码至少 ${minimum} 位、至多64位且不含空格。请设置符合已加入世界要求的密码。`);
  if(this.config.networkAccounts?.enabled!==true)throw fail(503,'NETWORK_ACCOUNTS_DISABLED','统一账号正在准备，请继续使用原入口。');
  const identities=this.store.characterUuids(owner.id);
  if(!identities.has(uuid)&&owner.role!=='admin'&&identities.size>=(this.config.cloudAccounts.maxAgentsPerOwner||5))throw fail(409,'AGENT_LIMIT','角色数量达到上限；同一角色加入其他世界不会重复占名额。');
  const primaryActor=(await this.game.roster()).find(row=>row.name.toLowerCase()===name.toLowerCase());
  if(primaryActor&&(primaryActor.name!==name||primaryActor.playerUuid!==uuid||!this.membership(owner,DEFAULT_SERVER,uuid)))throw fail(409,'PRIMARY_ROLE_CLAIM_REQUIRED','原千灯纪角色尚未归属核实，请先在千灯纪认领原角色，再加入其他世界。');
  const key=await this.key(),shared=await this.activeSecret(owner,uuid);if(typeof pwd!=='string'||!pwd||pwd.length>128||/\s/.test(pwd))throw fail(400,'CURRENT_PASSWORD_REQUIRED','请提供当前游戏密码，以验证已有角色。');if(shared&&!same(pwd,shared.password))throw fail(403,'SHARED_PASSWORD_MISMATCH','请输入这个角色当前的统一游戏密码；不要另设单服密码。');if(shared&&kind!=='password'&&!same(newPwd,shared.password))throw fail(409,'USE_SHARED_PASSWORD_CHANGE','统一改密请使用独立改密操作，加入世界不会修改已有密码。');
  if(kind==='password'&&!shared)throw fail(409,'SHARED_PASSWORD_NOT_ESTABLISHED','先验证原游戏密码并加入统一账号体系，再统一改密。');
  const steps=[];
  if(kind==='password'){
   const targets=new Set(memberships.map(r=>r.serverId));if(this.membership(owner,DEFAULT_SERVER,uuid))targets.add(DEFAULT_SERVER);
   for(const id of targets)steps.push({id:randomUUID(),serverId:id,operation:'password'});
   if(!steps.length)throw fail(409,'NETWORK_MEMBERSHIP_REQUIRED','先加入一个世界，再修改统一密码。');
  }else if(!this.membership(owner,serverId,uuid)){
   if(!shared&&this.membership(owner,DEFAULT_SERVER,uuid)){steps.push({id:randomUUID(),serverId:DEFAULT_SERVER,operation:'verify'});if(!same(pwd,newPwd))steps.push({id:randomUUID(),serverId:DEFAULT_SERVER,operation:'password'});}
   steps.push({id:randomUUID(),serverId,operation:body.operation==='claim'?'claim':'create'});
   if(body.operation==='claim')steps.push({id:randomUUID(),serverId,operation:'verify'});
  }else if(!shared)steps.push({id:randomUUID(),serverId,operation:'verify'});
  if(!steps.length)return {serverId,username:name,state:'succeeded',synchronized:true,alreadyMember:true};
  // One pending flow per owner/body, rechecked after the key/file awaits.
  if(this.store.db.prepare("SELECT 1 FROM network_flows WHERE owner_id=? AND player_uuid=? AND state IN ('pending','unknown')").get(owner.id,uuid))throw fail(409,'SHARED_PASSWORD_SYNC_PENDING','已有原请求正在同步，请查询它。');
  this.assertOwnedIdentity(owner,name,uuid);
  const currentIdentities=this.store.characterUuids(owner.id);if(!currentIdentities.has(uuid)&&owner.role!=='admin'&&currentIdentities.size>=(this.config.cloudAccounts.maxAgentsPerOwner||5))throw fail(409,'AGENT_LIMIT','角色名额已变化，请查询已有请求。');
  const now=Date.now();this.store.db.prepare('INSERT INTO network_flows VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(body.requestId,owner.id,uuid,name,kind,serverId,'pending',JSON.stringify(steps),seal(key,'flow:'+body.requestId,{password:pwd,newPassword:newPwd}),now,now);
  this.store.audit(owner.id,'network.'+kind+'.requested',body.requestId);
  await this.advance(body.requestId);return this.flow(owner,body.requestId);
 }
 async recover(owner,id,requestId){
  const flow=this.store.db.prepare('SELECT * FROM network_flows WHERE id=? AND owner_id=?').get(id,owner.id);
  if(!flow)throw fail(404,'NETWORK_REQUEST_NOT_FOUND','没有属于你的接入请求。');
  if(!UUID.test(requestId||''))throw fail(400,'REQUEST_ID_REQUIRED','请保存本次恢复请求标识。');
  const prior=this.store.db.prepare('SELECT * FROM network_recoveries WHERE id=?').get(requestId);
  if(prior){if(prior.flow_id!==id)throw fail(409,'REQUEST_ID_CONFLICT','该标识属于其他恢复操作。');return this.flow(owner,id);}
  const view=this.flow(owner,id);if(!view.recoverable)throw fail(409,'NETWORK_RECOVERY_NOT_SAFE','此请求不能自动重试。结果未知只查询原请求；身份或密码冲突请联系服主核对。');
  const steps=JSON.parse(flow.steps),index=steps.findIndex(s=>view.steps.find(v=>v.id===s.id)?.state==='failed');
  const previous=steps[index].id;steps[index]={...steps[index],id:randomUUID()};
  this.store.db.exec('BEGIN IMMEDIATE');try{
   this.store.db.prepare('INSERT INTO network_recoveries VALUES(?,?,?,?,?)').run(requestId,id,previous,steps[index].id,Date.now());
   this.store.db.prepare("UPDATE network_flows SET state='pending',steps=?,updated_at=? WHERE id=?").run(JSON.stringify(steps),Date.now(),id);
   this.store.db.prepare('DELETE FROM network_flow_errors WHERE id=?').run(id);this.store.db.exec('COMMIT');
  }catch(e){this.store.db.exec('ROLLBACK');throw e;}
  this.store.audit(owner.id,'network.recovery.requested',id);await this.advance(id);return this.flow(owner,id);
 }
 async agentStatus({client,owner},serverId){
  const server=this.catalog.public(serverId),member=this.membership(owner,serverId,client.expected_uuid),credential=this.credential(owner,client.expected_uuid);
  const latest=this.store.db.prepare("SELECT id,state FROM network_flows WHERE owner_id=? AND player_uuid=? ORDER BY created_at DESC LIMIT 1").get(owner.id,client.expected_uuid);
  const job=latest?this.flow(owner,latest.id):null,ready=!!member&&!!credential&&(!latest||latest.state==='succeeded');
  return {schemaVersion:1,clientId:client.id,username:client.name,serverId,state:ready?'ready':latest?.state||'not_created',gameAccountCreated:ready,sharedPasswordReady:!!credential,job,
   game:await this.capabilities(serverId),gameAddress:server.addresses.mineflayer,gameVersion:server.version,adapter:server.adapter,guide:server.guide,
   nextAction:ready?'connect_game':latest&&['pending','unknown'].includes(latest.state)?'query_status':'activate',gamePasswordEnv:'MC_GAME_PASSWORD',apiCredentialIsGamePassword:false,progressScope:serverId};
 }
 async agentState(context,serverId){
  const status=await this.agentStatus(context,serverId);if(!status.gameAccountCreated)throw fail(409,'GAME_ACCOUNT_NOT_READY','先查询原接入状态，等待该世界账号和密码同步完成。');
  if(serverId==='qiandengji'){
   const actor=(await this.game.roster()).find(row=>row.playerUuid===context.client.expected_uuid&&row.name===context.client.name);
   if(!actor||actor.isReserved||actor.identityConflict)throw fail(409,'AGENT_IDENTITY_UNCONFIRMED','角色真实身份暂未确认，请稍后重查。');return {serverId,...await this.game.playerState(actor)};
  }
  return {schemaVersion:1,serverId,username:context.client.name,playerUuid:context.client.expected_uuid,available:false,freshness:'unavailable',
   unavailableReason:'此世界的账号已接通，背包、等级、任务和直播资料尚未接入；不会填入其他世界的记录。',connection:{gameAddress:status.gameAddress,gameVersion:status.gameVersion,adapter:status.adapter},progressScope:serverId};
 }
 async advance(id){
  if(this.advancing.has(id))return this.advancing.get(id);
  const task=this.advanceOnce(id).finally(()=>this.advancing.delete(id));this.advancing.set(id,task);return task;
 }
 async advanceOnce(id){
  const flow=this.store.db.prepare('SELECT * FROM network_flows WHERE id=?').get(id);if(!flow||!['pending','unknown'].includes(flow.state))return;
  const owner=this.store.ownerById(flow.owner_id);if(!owner)return;
  const steps=JSON.parse(flow.steps),key=await this.key(),secret=unseal(key,'flow:'+id,flow.secret);
  for(const step of steps){
   const previous=step.serverId===DEFAULT_SERVER?this.store.db.prepare('SELECT * FROM account_jobs WHERE id=?').get(step.id):this.store.db.prepare('SELECT * FROM network_jobs WHERE id=?').get(step.id);
   if(previous?.state==='succeeded')continue;
   if(previous&&['failed','unknown'].includes(previous.state)){this.store.db.prepare('UPDATE network_flows SET state=?,updated_at=? WHERE id=?').run(previous.state,Date.now(),id);return;}
   if(previous)return;
   const capability=await this.capabilities(step.serverId);if(!capability.ready||step.operation==='verify'&&step.serverId===DEFAULT_SERVER&&!capability.verify)return;
   if(flow.state==='unknown')this.store.db.prepare("UPDATE network_flows SET state='pending' WHERE id=?").run(id);
   let result;
   try{
    if(step.serverId===DEFAULT_SERVER)result=await this.legacy.start(owner,step.operation,{username:flow.name,requestId:step.id,gamePassword:secret.newPassword,currentGamePassword:secret.password},{sharedCredential:true});
    else result=await this.enqueue(owner,step.serverId,step.id,step.operation,flow.name,flow.player_uuid,secret);
   }catch(error){
    // The legacy service records a job before it can dispatch. Missing job is a known preflight failure.
    const exists=step.serverId===DEFAULT_SERVER?this.store.db.prepare('SELECT 1 FROM account_jobs WHERE id=?').get(step.id):this.store.db.prepare('SELECT 1 FROM network_jobs WHERE id=?').get(step.id);
    if(!exists){this.store.db.prepare('UPDATE network_flows SET state=?,updated_at=? WHERE id=?').run('failed',Date.now(),id);this.store.db.prepare('INSERT OR REPLACE INTO network_flow_errors VALUES(?,?,?)').run(id,String(error.reason||'PREFLIGHT_FAILED'),'服务器预检未通过；核对角色归属、密码要求和服务器接入状态后重新发起。');this.store.audit(owner.id,'network.preflight.failed',id,String(error.reason||'PREFLIGHT_FAILED'));}
    return;
   }
   if(result?.nextCommand){step.nextCommand=result.nextCommand;this.store.db.prepare('UPDATE network_flows SET steps=? WHERE id=?').run(JSON.stringify(steps),id);}
   return;
  }
  const version=(this.credential(owner,flow.player_uuid)?.version||0)+(flow.kind==='password'?1:this.credential(owner,flow.player_uuid)?0:1),now=Date.now();
  this.store.db.exec('BEGIN IMMEDIATE');try{
   this.store.db.prepare('INSERT INTO network_credentials VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,player_uuid) DO UPDATE SET version=excluded.version,envelope=excluded.envelope,updated_at=excluded.updated_at').run(owner.id,flow.player_uuid,flow.name,version,seal(key,'shared-credential:'+owner.id+':'+flow.player_uuid,{password:secret.newPassword,version}),now);
   for(const step of steps.filter(s=>['create','claim','verify'].includes(s.operation)&&s.serverId!==DEFAULT_SERVER)){
    const old=this.store.db.prepare('SELECT owner_id FROM network_memberships WHERE server_id=? AND player_uuid=?').get(step.serverId,flow.player_uuid);if(old&&old.owner_id!==owner.id)throw Error('NETWORK_OWNERSHIP_CONFLICT');
    this.store.db.prepare('INSERT INTO network_memberships VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(server_id,player_uuid) DO UPDATE SET credential_version=excluded.credential_version').run(step.serverId,flow.player_uuid,owner.id,flow.name,flow.name.toLowerCase(),version,'Verified native job '+step.id,now);
   }
   this.store.db.prepare('UPDATE network_memberships SET credential_version=? WHERE owner_id=? AND player_uuid=?').run(version,owner.id,flow.player_uuid);
   this.store.db.prepare('UPDATE network_flows SET state=?,updated_at=? WHERE id=?').run('succeeded',now,id);this.store.db.exec('COMMIT');
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
 async enqueue(owner,serverId,id,operation,name,uuid,secret){
  const key=await this.key(serverId),now=Date.now(),code=operation==='claim'?randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','').slice(0,16):null;
  const request={schemaVersion:1,serverId,requestId:id,operation,username:name,playerUuid:uuid,createdAt:now,expiresAt:now+300000,password:secret.newPassword,currentPassword:operation==='verify'?secret.newPassword:secret.password,sharedCredential:true,...(code?{code}:{})};
  const result={state:'pending',...(code?{nextCommand:`/portal bind ${id} ${code}`}:{})};
  this.store.db.prepare('INSERT INTO network_jobs VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,NULL)').run(id,serverId,owner.id,operation,name,uuid,'pending',JSON.stringify(result),seal(key,'server:'+serverId+':request:'+id,request),now,request.expiresAt);
  return {id,...result};
 }
 async observeLegacy(){
  for(const flow of this.store.db.prepare("SELECT * FROM network_flows WHERE state IN ('pending','unknown')").all()){
   for(const step of JSON.parse(flow.steps).filter(s=>s.serverId===DEFAULT_SERVER))if(this.store.db.prepare('SELECT 1 FROM account_jobs WHERE id=?').get(step.id))await this.legacy.job(this.store.ownerById(flow.owner_id),step.id);
   await this.advance(flow.id);
  }
 }
 authorizeWorker(serverId,req){
  const bridge=this.catalog.get(serverId).accountBridge,token=/^Bearer (acc_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1];
  if(!bridge?.enabled||!token||!/^[a-f0-9]{64}$/.test(bridge.tokenHash||'')||!same(digest(token),bridge.tokenHash))throw fail(401,'SERVER_BRIDGE_CREDENTIAL','这个服务器的账号同步凭据无效。');
 }
 async poll(serverId,body){
  this.catalog.get(serverId);const now=Date.now();if(!body.heartbeat||body.heartbeat.serverId!==serverId||typeof body.heartbeat.ready!=='boolean'||!Number.isFinite(body.heartbeat.at)||Math.abs(now-body.heartbeat.at)>10000||!Array.isArray(body.results)||body.results.length>16)throw fail(400,'SERVER_ACCOUNT_POLL_INVALID','服务器账号回执格式或所属世界不正确。');
  const key=await this.key(serverId),updates=[];
  for(const item of body.results){
   if(!UUID.test(item.id||'')||typeof item.envelope!=='string')throw fail(400,'SERVER_ACCOUNT_RESULT_INVALID','账号回执格式无效。');
   const job=this.store.db.prepare('SELECT * FROM network_jobs WHERE id=? AND server_id=?').get(item.id,serverId);if(!job)throw fail(404,'SERVER_ACCOUNT_JOB_NOT_FOUND','这个服务器没有对应的账号请求。');
   let value;try{value=unseal(key,'server:'+serverId+':result:'+item.id,item.envelope);}catch{throw fail(400,'SERVER_ACCOUNT_RESULT_INVALID','账号回执加密校验失败。');}
   if(value.serverId!==serverId||value.requestId!==job.id||value.username!==job.name||!['succeeded','failed','waiting','running','unknown'].includes(value.state)||value.state==='succeeded'&&value.playerUuid!==job.expected_uuid)throw fail(400,'SERVER_ACCOUNT_IDENTITY','账号回执的世界或角色身份不匹配。');
   if(['succeeded','failed'].includes(job.state)&&JSON.stringify(JSON.parse(job.result))!==JSON.stringify(value))throw fail(409,'SERVER_ACCOUNT_FINAL','最终账号回执不能改写。');updates.push({job,value,envelope:item.envelope});
  }
  const delivered=body.delivered||[];if(!Array.isArray(delivered)||delivered.length>64||delivered.some(id=>!UUID.test(id)||!this.store.db.prepare('SELECT 1 FROM network_jobs WHERE id=? AND server_id=? AND dispatched_at IS NOT NULL').get(id,serverId)))throw fail(400,'SERVER_ACCOUNT_DELIVERY','账号送达回执不属于当前服务器。');
  this.store.db.exec('BEGIN IMMEDIATE');try{
   for(const {job,value,envelope}of updates)this.store.db.prepare('UPDATE network_jobs SET state=?,result=?,reply=? WHERE id=? AND server_id=?').run(value.state==='waiting'||value.state==='running'?'pending':value.state,JSON.stringify(value),envelope,job.id,serverId);
   for(const id of delivered)this.store.db.prepare('UPDATE network_jobs SET delivered_at=COALESCE(delivered_at,?) WHERE id=? AND server_id=?').run(now,id,serverId);
   this.store.db.prepare('INSERT INTO network_heartbeats VALUES(?,?,?) ON CONFLICT(server_id) DO UPDATE SET ready=excluded.ready,received_at=excluded.received_at').run(serverId,body.heartbeat.ready?1:0,now);
   this.store.db.exec('COMMIT');
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  for(const row of this.store.db.prepare("SELECT id,dispatched_at FROM network_jobs WHERE server_id=? AND state='pending' AND expires_at<?").all(serverId,now-30000)){
   const unknown=row.dispatched_at!==null,result={state:unknown?'unknown':'failed',reason:unknown?'ACCOUNT_RESULT_UNKNOWN':'ACCOUNT_REQUEST_EXPIRED',message:unknown?'已送达的操作尚未确认；只查询原请求，不重放。':'请求送达前过期，未执行。'};
   this.store.db.prepare('UPDATE network_jobs SET state=?,result=? WHERE id=? AND server_id=?').run(result.state,JSON.stringify(result),row.id,serverId);
  }
  await this.observeLegacy();
  const requests=body.heartbeat.ready?this.store.db.prepare("SELECT id,request AS envelope FROM network_jobs WHERE server_id=? AND state='pending' AND expires_at>? AND reply IS NULL ORDER BY created_at LIMIT 4").all(serverId,now):[];
  for(const r of requests)this.store.db.prepare('UPDATE network_jobs SET dispatched_at=COALESCE(dispatched_at,?) WHERE id=? AND server_id=?').run(now,r.id,serverId);
  const watch=this.store.db.prepare("SELECT id FROM network_jobs WHERE server_id=? AND state IN ('pending','unknown') AND dispatched_at IS NOT NULL LIMIT 64").all(serverId).map(r=>r.id);
  return {serverId,requests,watch,acknowledged:updates.map(r=>r.job.id)};
 }
}

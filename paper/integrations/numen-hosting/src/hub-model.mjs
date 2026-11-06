import {createHash,randomUUID} from 'node:crypto';
import {keyOf,fail} from './protocol.mjs';

// A separate BYOK-only Hub. The existing shared Hub is never a fallback.
export function hubByokAdapter({endpoint,internalKey,catalogue,store,backend='opencode',settings,fetcher=fetch}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash
      ||typeof internalKey!=='string'||internalKey.length<32)throw new Error('Dedicated loopback Hub required');
  const running=new Map(),db=store.db,connection='website-hosted';
  // The CLI is a JSON planner. Actual world tools run through the scoped MC
  // core; it must not independently execute shell, filesystem or network tools.
  const disabledTools='read,edit,glob,grep,list,bash,task,external_directory,todowrite,question,webfetch,websearch,lsp,doom_loop,skill';
  db.exec('CREATE TABLE IF NOT EXISTS hub_model_bindings(role TEXT PRIMARY KEY,org TEXT NOT NULL,binding TEXT NOT NULL,model TEXT NOT NULL,backend TEXT NOT NULL);');
  async function request(role,org,path,method='GET',value) {
    let response,result;
    try{response=await fetcher(new URL(path,url),{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{
      'x-harness-internal':internalKey,'x-harness-org':org,'x-harness-member':role.ownerId,'content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
      const text=await response.text();if(text.length>65536)throw Error();result=JSON.parse(text);}
    catch{throw fail('HUB_CONFIGURATION_UNKNOWN','独立 Hub 配置结果未确认，请保持暂停并查询状态。',503);}
    if(!response.ok)throw fail('HUB_CONFIGURATION_REFUSED','独立 Hub 未接受用户连接配置；请保持暂停并检查供应商及运行方式。',503);
    return result;
  }
  async function abort({role}) {
    const key=keyOf(role),row=db.prepare('SELECT * FROM hub_model_bindings WHERE role=?').get(key);
    if(!row)return{stopped:true};
    // Disable new model work first, then erase the provider secret and revoke
    // every token in this role's dedicated organization, including descendants.
    await request(role,row.org,`/v1/orgs/${row.org}/policy/${row.backend}`,'PUT',{connections:[]});
    await request(role,row.org,`/v1/orgs/${row.org}/connections/${connection}`,'PUT',{backend:row.backend,provider:'custom',model:row.model,api_key:''});
    const result=await request(role,row.org,`/v1/orgs/${row.org}/keys`);
    if(!Array.isArray(result.keys))throw fail('HUB_STOP_UNCONFIRMED','独立 Hub 未返回撤销凭据的确认。',503);
    for(const token of result.keys){if(typeof token.id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(token.id))throw fail('HUB_STOP_UNCONFIRMED','独立 Hub 凭据编号无效。',503);
      await request(role,row.org,`/v1/orgs/${row.org}/keys/${token.id}`,'DELETE');}
    running.delete(key);db.prepare('DELETE FROM hub_model_bindings WHERE role=?').run(key);return{stopped:true};
  }
  return {isolatedByok:true,abort,async bind({role,profile,apiKey}) {
    const capability=await request(role,'', '/internal/hosted-byok-capabilities');
    if(capability.schema!=='qiandengji-hosted-byok/v1'||capability.isolatedByok!==true||capability.sharedFallback!==false)
      throw fail('HUB_ISOLATION_REQUIRED','需要专用的用户 Key Hub，不能使用原共享 Hub。',503);
    await abort({role});
    const provider=catalogue.providers.find(p=>p.id===profile.provider),model=provider?.models.find(m=>m.id===profile.model);
    if(!provider?.hub||!model)throw fail('MODEL_NOT_SUPPORTED','此供应商尚未接入该 Harness。',400);
    const org='qd-hosted-'+createHash('sha256').update(keyOf(role)+':'+role.ownerId).digest('hex').slice(0,32),binding=randomUUID();
    db.prepare('INSERT INTO hub_model_bindings VALUES(?,?,?,?,?)').run(keyOf(role),org,binding,profile.model,backend);
    await request(role,org,`/v1/orgs/${org}/connections/${connection}`,'PUT',{...provider.hub,backend,model:profile.model,api_key:apiKey,disabled_tools:disabledTools});
    await request(role,org,`/v1/orgs/${org}/policy/${backend}`,'PUT',{connections:[connection]});
    const token=await request(role,org,`/v1/orgs/${org}/keys`,'POST',{member_id:role.ownerId,name:'website-hosted/'+binding});
    if(typeof token.key!=='string'||token.key.length<24)throw fail('HUB_BINDING_UNCONFIRMED','独立 Hub 尚未确认角色运行凭据。',503);
    running.set(keyOf(role),{role,goal:profile.goal,model:profile.model,token:token.key});
    return{isolatedByok:true,ownerId:role.ownerId,model:profile.model,close:()=>abort({role})};
  },configurationFor(role) {
    const row=running.get(keyOf(role));if(!row||JSON.stringify(row.role)!==JSON.stringify(role))throw fail('MODEL_LEASE_REQUIRED','此角色尚未绑定自己的模型连接。');
    return {settings:structuredClone(settings),goal:row.goal,planner:{base_url:url.origin,harness_id:backend,model:row.model,api_key_env:'QDJ_HOSTED_HUB_TOKEN',max_step:8,poll_seconds:0.5},
      environment:{QDJ_HOSTED_HUB_TOKEN:row.token}};
  }};
}

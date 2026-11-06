import {seal,unseal} from '../../agent-portal/src/game-accounts.mjs';
import {identity,keyOf,fail} from './protocol.mjs';

// The assembly supplies a reviewed catalogue and adapters. Browsers never
// supply endpoints, environment variables, executable paths or Hub admin IDs.
export class HostedProfiles {
  constructor({store,key,catalogue,adapters={},now=Date.now}) {
    if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('A separate 32-byte hosting vault key is required');
    this.store=store;this.key=key;this.adapters=adapters;this.now=now;this.active=new Map();
    this.catalogue=structuredClone(catalogue);
    for(const group of ['providers','harnesses']) {
      const ids=new Set();
      if(!Array.isArray(this.catalogue[group]))throw new Error('Invalid hosting catalogue');
      for(const row of this.catalogue[group]) {
        if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(row.id)||ids.has(row.id)||typeof row.label!=='string')throw new Error('Invalid hosting catalogue entry');
        ids.add(row.id);
      }
    }
    for(const p of this.catalogue.providers){
      if(!Array.isArray(p.models)||!p.models.length||p.models.some(m=>typeof m.id!=='string'||!m.id||typeof m.label!=='string')
          ||new Set(p.models.map(m=>m.id)).size!==p.models.length)throw new Error('Invalid provider models');
    }
    for(const h of this.catalogue.harnesses){
      if(!['numen','harness'].includes(h.mode)||!Array.isArray(h.providers)||!h.providers.length
          ||h.providers.some(id=>!this.catalogue.providers.some(p=>p.id===id)))throw new Error('Invalid harness providers');
    }
    store.db.exec(`CREATE TABLE IF NOT EXISTS hosted_profiles(role TEXT PRIMARY KEY,binding TEXT NOT NULL,
      revision INTEGER NOT NULL,profile TEXT NOT NULL,secret TEXT,updated INTEGER NOT NULL);`);
  }
  cataloguePublic() {
    return {requiresOwnKey:true,providers:this.catalogue.providers.map(p=>({id:p.id,label:p.label,models:p.models.map(m=>({id:m.id,label:m.label}))})),
      harnesses:this.catalogue.harnesses.map(h=>({id:h.id,label:h.label,mode:h.mode,providers:h.providers,
        available:this.adapters[h.id]?.isolatedByok===true,
        reason:this.adapters[h.id]?.isolatedByok===true?null:'该运行方式尚未完成用户独立密钥接线，暂不能启动。'}))};
  }
  row(role) {
    role=identity(role);const row=this.store.db.prepare('SELECT * FROM hosted_profiles WHERE role=?').get(keyOf(role));
    if(row&&row.binding!==JSON.stringify(role))throw fail('PROFILE_OWNER_CHANGED','角色归属已变化；旧主人的模型配置不可继续使用。',403);
    return row;
  }
  read(role) {
    const row=this.row(role);
    return row?{...JSON.parse(row.profile),revision:row.revision,keyConfigured:!!row.secret,updatedAt:row.updated}
      :{revision:0,keyConfigured:false};
  }
  save(role,input) {
    role=identity(role);const id=keyOf(role),row=this.row(role);
    if(this.active.has(id))throw fail('HOSTING_MUST_PAUSE','请先暂停托管，再更换 Harness、模型或密钥。');
    if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['revision','harness','provider','model','goal','apiKey','removeKey'].includes(k)))
      throw fail('PROFILE_INVALID','请选择 Harness、供应商和模型，只在密钥输入框填写 API Key。',400);
    if(input.revision!==(row?.revision??0))throw fail('PROFILE_CHANGED','配置已被另一页面更新，请刷新后再保存。');
    const h=this.catalogue.harnesses.find(h=>h.id===input.harness),p=this.catalogue.providers.find(p=>p.id===input.provider);
    if(!h||!p||!h.providers.includes(p.id)||!p.models.some(m=>m.id===input.model))
      throw fail('MODEL_NOT_SUPPORTED','该 Harness 不支持所选模型，请从当前目录重新选择。',400);
    if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>4000)
      throw fail('GOAL_REQUIRED','请填写 1–4000 字的托管目标。',400);
    if(input.removeKey!==undefined&&typeof input.removeKey!=='boolean')throw fail('PROFILE_INVALID','删除密钥选项无效。',400);
    if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>8192||/[\x00-\x20\x7f]/.test(input.apiKey)))
      throw fail('API_KEY_INVALID','API Key 不得包含空格或换行；请只填密钥本身。',400);
    if(input.apiKey&&input.removeKey)throw fail('PROFILE_INVALID','更换和删除密钥不能同时进行。',400);
    const profile={harness:h.id,provider:p.id,model:input.model,goal:input.goal.trim()};
    const old=row?JSON.parse(row.profile):null;
    // A key belongs to its provider: switching providers never reuses it.
    let secret=input.removeKey||old?.provider!==p.id?null:row?.secret??null;
    if(input.apiKey)secret=seal(this.key,'hosted-key:'+JSON.stringify(role)+':'+p.id,{apiKey:input.apiKey});
    const revision=(row?.revision??0)+1;
    this.store.db.prepare(`INSERT INTO hosted_profiles VALUES(?,?,?,?,?,?) ON CONFLICT(role) DO UPDATE SET
      revision=excluded.revision,profile=excluded.profile,secret=excluded.secret,updated=excluded.updated`)
      .run(id,JSON.stringify(role),revision,JSON.stringify(profile),secret,this.now());
    return this.read(role);
  }
  require(role,mode,runtime) {
    const row=this.row(role),profile=this.read(role),h=this.catalogue.harnesses.find(h=>h.id===profile.harness);
    if(!row?.secret)throw fail('API_KEY_REQUIRED','服务器托管需要你自己的 API Key，请在角色的托管设置中保存；不会使用服主的 Key。',400);
    if(!h||h.mode!==mode||(mode==='harness'&&runtime!==h.id))throw fail('HARNESS_PROFILE_MISMATCH','启动方式与已保存配置不同，请先在托管设置中选择并保存。',400);
    const adapter=this.adapters[h.id];
    if(adapter?.isolatedByok!==true||typeof adapter.bind!=='function')throw fail('BYOK_ADAPTER_UNAVAILABLE','所选 Harness 尚未完成独立密钥接线；已阻止回退到服务器共享模型。',503);
    return {row,profile,adapter};
  }
  async start(role,mode,runtime) {
    const id=keyOf(role);if(this.active.has(id))throw fail('MODEL_LEASE_ACTIVE','旧模型连接尚未停止。');
    const {row,profile,adapter}=this.require(role,mode,runtime);
    let value;
    try{value=unseal(this.key,'hosted-key:'+JSON.stringify(identity(role))+':'+profile.provider,row.secret);}catch{throw fail('KEY_UNREADABLE','模型密钥无法解密，请重新保存自己的 API Key。',503);}
    const active={adapter,revision:row.revision,lease:null};this.active.set(id,active);
    try {
      // bind only talks to a trusted private model connector, never the agent's
      // prompts, game tools or browser. It must implement exact-model/no-fallback.
      active.lease=await adapter.bind({role,profile,apiKey:value.apiKey});
      if(!active.lease||active.lease.isolatedByok!==true||active.lease.model!==profile.model||active.lease.ownerId!==role.ownerId
          ||typeof active.lease.close!=='function')throw new Error('unverified model binding');
    }catch{throw fail('MODEL_BINDING_UNCONFIRMED','用户模型连接未确认，请暂停并检查配置；不会改用共享模型。',503);}
    finally{value.apiKey='';}
  }
  async stop(role) {
    const id=keyOf(role),active=this.active.get(id);
    if(!active){for(const adapter of Object.values(this.adapters))if(adapter.abort){const result=await adapter.abort({role});if(result?.stopped!==true)throw fail('MODEL_STOP_UNCONFIRMED','旧模型连接尚未确认撤销，请保持暂停。',503);}return;}
    // Failed binding is retained too; adapter must confirm cleanup by identity.
    let result;try{result=active.lease?await active.lease.close():await active.adapter.abort({role,revision:active.revision});}catch{}
    if(result?.stopped!==true)throw fail('MODEL_STOP_UNCONFIRMED','原模型连接未确认撤销，请保持暂停并查询状态。',503);
    this.active.delete(id);
  }
}

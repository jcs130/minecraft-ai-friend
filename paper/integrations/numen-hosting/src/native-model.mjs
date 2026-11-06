import {createHmac,randomUUID} from 'node:crypto';
import {keyOf,fail} from './protocol.mjs';

// The control key authenticates the website's reviewed connection catalogue;
// ordinary Numen MCP tokens alone cannot choose server-side HTTP targets.
export function nativeByokAdapter({body,catalogue,controlKey,store,now=Date.now}) {
  if(!Buffer.isBuffer(controlKey)||controlKey.length!==32)throw new Error('A separate native model control key is required');
  const bindings=new Map();
  store?.db.exec('CREATE TABLE IF NOT EXISTS native_model_bindings(role TEXT PRIMARY KEY,id TEXT NOT NULL);');
  const binding=key=>bindings.get(key)??store?.db.prepare('SELECT id FROM native_model_bindings WHERE role=?').get(key)?.id;
  const sign=value=>{const payload=Buffer.from(JSON.stringify({...value,expires:now()+45000})).toString('base64url');
    return{payload,signature:createHmac('sha256',controlKey).update(payload).digest('base64url')};};
  const change=(role,op,bindingId,extra={})=>body.rpc(role,op,sign({op,bindingId,roleUuid:role.roleUuid,ownerUuid:role.numenOwnerUuid,name:role.name,...extra}));
  async function abort({role}) {
    const key=keyOf(role),id=binding(key);if(!id)return{stopped:true};
    const result=await change(role,'model_unbind',id);
    if(result.bindingId!==id||result.stopped!==true)throw fail('MODEL_STOP_UNCONFIRMED','Numen 尚未确认撤销用户模型。',503);
    bindings.delete(key);store?.db.prepare('DELETE FROM native_model_bindings WHERE role=?').run(key);return{stopped:true};
  }
  return {isolatedByok:true,abort,async bind({role,profile,apiKey}) {
    if((await body.rpc(role,'capabilities')).isolatedModels!==true)throw fail('NATIVE_BYOK_NOT_INSTALLED','当前 Numen 尚未安装独立用户模型绑定。',503);
    const key=keyOf(role);if(binding(key))await abort({role});
    const provider=catalogue.providers.find(p=>p.id===profile.provider),model=provider?.models.find(m=>m.id===profile.model);
    if(!provider||!model)throw fail('MODEL_NOT_SUPPORTED','请重新选择当前模型目录。',400);
    const id=randomUUID();bindings.set(key,id);store?.db.prepare('INSERT INTO native_model_bindings VALUES(?,?)').run(key,id);
    const result=await change(role,'model_bind',id,{profile:{...provider.connection,...model.connection,provider:provider.id,model:model.id},apiKey,goal:profile.goal});
    if(result.bindingId!==id||result.isolatedByok!==true||result.model!==profile.model)throw fail('MODEL_BINDING_UNCONFIRMED','Numen 未确认所选用户模型。',503);
    return{isolatedByok:true,ownerId:role.ownerId,model:profile.model,close:()=>abort({role})};
  }};
}
